// saude-monitor.js — FASE 0 do circuit breaker (Ailson 12/09/2026)
//
//   GET /api/saude-monitor            (cron a cada 5 min ou admin)
//   GET /api/saude-monitor?painel=1   (pagina Configuracao -> Saude)
//   POST { chave, valor }             (admin: salva config, ex. whats_admin)
//
// SO MEDE, CLASSIFICA E AVISA. Nao desliga nada — decisao e sempre dele.
//   verde    = normal
//   aviso    = importante mas nao iminente -> so aparece na pagina Saude
//   amarelo  = risco IMINENTE de vermelho (travar o app / estourar o Supabase)
//   vermelho = app travado / absurdo de requisicoes ou erros
// WhatsApp (pela Sofia, template aprovado na Meta, numero direto dele):
//   amarelo max 2/dia, vermelho max 3/dia, 06:00-22:00 BRT, 2h entre envios.
//   Sem mensagem de "voltou ao normal".
// Cada alerta grava um DOSSIE em saude_incidentes com codigo #INC-MMDD-N — ele
// cola o codigo no Claude e a investigacao ja comeca pelo dossie.

import { supabase, validarUsuario, setCors } from './_lojas-helpers.js';
import { enviarTemplate } from './_lojas-whats-meta-client.js';

export const config = { maxDuration: 30 };

const agoraBrt = () => new Date(Date.now() - 3 * 3600000);
const hojeBrt = () => agoraBrt().toISOString().slice(0, 10);

async function cfg() {
  const { data } = await supabase.from('saude_config').select('chave, valor');
  const m = {}; for (const r of (data || [])) m[r.chave] = r.valor;
  return m;
}

// ── coleta ─────────────────────────────────────────────────────────────────
async function coletar() {
  const t0 = Date.now();
  const { data: snap, error } = await supabase.rpc('saude_snapshot');
  const latencia = Date.now() - t0;
  if (error) return { falhou: true, erro: error.message, latencia_ms: latencia };
  const s = snap || {};
  // deltas contra a leitura anterior (5 min)
  const { data: ant } = await supabase.from('saude_leituras').select('bruto, lida_em').order('lida_em', { ascending: false }).limit(1).maybeSingle();
  const b0 = ant?.bruto || {};
  const minutos = ant ? Math.max(1, (Date.now() - new Date(ant.lida_em).getTime()) / 60000) : 5;
  const delta = (k) => (b0[k] != null && s[k] != null && s[k] >= b0[k]) ? Math.round((s[k] - b0[k]) * 5 / minutos) : null;
  const h1 = new Date(Date.now() - 3600000).toISOString();
  const { count: erros1h } = await supabase.from('wms_nfe_log').select('id', { count: 'exact', head: true }).eq('resultado', 'erro').gte('criado_em', h1);
  const { count: e429 } = await supabase.from('wms_nfe_log').select('id', { count: 'exact', head: true }).gte('criado_em', h1).or('http.eq.429,mensagem.ilike.%429%');
  return {
    conexoes: s.conexoes, conexoes_max: s.conexoes_max, ativas: s.ativas, idle_tx: s.idle_tx,
    query_mais_longa_s: s.query_mais_longa_s, latencia_ms: latencia,
    db_calls_5min: delta('db_calls_total'), storage_calls_5min: delta('storage_calls_total'),
    esteira_erros_1h: erros1h || 0, bling_429_1h: e429 || 0, bruto: s,
  };
}

// media das ultimas 24h do mesmo sinal (linha de base pro "X vezes o normal")
async function baseline(campo) {
  const { data } = await supabase.from('saude_leituras').select(campo).gte('lida_em', new Date(Date.now() - 86400000).toISOString()).not(campo, 'is', null);
  const v = (data || []).map(r => Number(r[campo])).filter(x => x > 0);
  if (v.length < 12) return null;              // menos de 1h de historico: sem baseline
  v.sort((a, b) => a - b);
  return v[Math.floor(v.length / 2)];         // mediana (robusta a picos)
}

// ── classificacao ──────────────────────────────────────────────────────────
async function classificar(m) {
  const motivos = { vermelho: [], amarelo: [], aviso: [] };
  if (m.falhou) {
    motivos.vermelho.push(`banco não respondeu (${m.erro || 'timeout'})`);
    return { nivel: 'vermelho', motivos };
  }
  const pct = m.conexoes_max ? Math.round(100 * m.conexoes / m.conexoes_max) : 0;
  const baseStorage = await baseline('storage_calls_5min');
  const baseDb = await baseline('db_calls_5min');
  // VERMELHO
  if (pct >= 90) motivos.vermelho.push(`banco em ${pct}% das conexões (${m.conexoes}/${m.conexoes_max})`);
  if (m.latencia_ms >= 8000) motivos.vermelho.push(`banco respondendo em ${(m.latencia_ms / 1000).toFixed(1)}s`);
  if (baseStorage && m.storage_calls_5min > 10 * baseStorage && m.storage_calls_5min > 2000) motivos.vermelho.push(`Storage ${Math.round(m.storage_calls_5min / baseStorage)}× o normal (${m.storage_calls_5min} em 5 min) — padrão de loop de fotos`);
  if (m.esteira_erros_1h >= 100) motivos.vermelho.push(`${m.esteira_erros_1h} erros na esteira na última hora`);
  // AMARELO (iminente)
  if (pct >= 75 && pct < 90) motivos.amarelo.push(`banco em ${pct}% das conexões (${m.conexoes}/${m.conexoes_max})`);
  if (m.latencia_ms >= 3000 && m.latencia_ms < 8000) motivos.amarelo.push(`banco lento: ${(m.latencia_ms / 1000).toFixed(1)}s`);
  if (baseStorage && m.storage_calls_5min > 5 * baseStorage && m.storage_calls_5min > 1000 && !motivos.vermelho.length) motivos.amarelo.push(`Storage ${Math.round(m.storage_calls_5min / baseStorage)}× o normal (${m.storage_calls_5min} em 5 min)`);
  if (baseDb && m.db_calls_5min > 5 * baseDb) motivos.amarelo.push(`consultas ao banco ${Math.round(m.db_calls_5min / baseDb)}× o normal`);
  if (m.idle_tx >= 10) motivos.amarelo.push(`${m.idle_tx} conexões presas em transação`);
  if (m.bling_429_1h >= 20) motivos.amarelo.push(`${m.bling_429_1h} respostas 429 do Bling na última hora`);
  // AVISO (so na pagina)
  if (m.esteira_erros_1h >= 20 && m.esteira_erros_1h < 100) motivos.aviso.push(`${m.esteira_erros_1h} erros na esteira na última hora`);
  if (m.query_mais_longa_s >= 60) motivos.aviso.push(`consulta rodando há ${m.query_mais_longa_s}s`);
  if (pct >= 60 && pct < 75) motivos.aviso.push(`banco em ${pct}% das conexões`);
  const nivel = motivos.vermelho.length ? 'vermelho' : motivos.amarelo.length ? 'amarelo' : motivos.aviso.length ? 'aviso' : 'verde';
  return { nivel, motivos };
}

// ── cotas e envio ──────────────────────────────────────────────────────────
async function podeEnviar(nivel, c) {
  const h = agoraBrt().getUTCHours();
  if (h < Number(c.hora_ini || 6) || h >= Number(c.hora_fim || 22)) return { ok: false, motivo: 'fora do horário 06-22' };
  const ini = new Date(hojeBrt() + 'T03:00:00Z').toISOString();
  const { data: hoje } = await supabase.from('saude_incidentes').select('nivel, enviado_em').eq('enviado_whats', true).gte('enviado_em', ini);
  const doNivel = (hoje || []).filter(i => i.nivel === nivel).length;
  const max = nivel === 'vermelho' ? Number(c.max_vermelho_dia || 3) : Number(c.max_amarelo_dia || 2);
  if (doNivel >= max) return { ok: false, motivo: `cota do dia (${max}) atingida` };
  const ultimo = (hoje || []).map(i => new Date(i.enviado_em).getTime()).sort((a, b) => b - a)[0];
  if (ultimo && Date.now() - ultimo < Number(c.intervalo_min || 120) * 60000) return { ok: false, motivo: 'intervalo de 2h' };
  return { ok: true };
}

async function proximoCodigo() {
  const mmdd = hojeBrt().slice(5, 7) + hojeBrt().slice(8, 10);
  const { count } = await supabase.from('saude_incidentes').select('id', { count: 'exact', head: true }).like('codigo', `#INC-${mmdd}-%`);
  return `#INC-${mmdd}-${(count || 0) + 1}`;
}

function sugestaoPara(motivos) {
  const t = motivos.join(' ');
  if (/loop de fotos|Storage/.test(t)) return 'ver quem está com tela de fotos aberta (Bling Estoque/Calculadora) e fechar; se persistir, me chamar';
  if (/conexões|banco/.test(t)) return 'abrir o painel do Supabase e me chamar com o código; se travado, reiniciar o banco';
  if (/429/.test(t)) return 'o Bling está limitando; aguardar 10 min e evitar varredura geral';
  return 'me chamar no Claude com o código';
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  const ua = req.headers['user-agent'] || '';
  const ehCron = ua.includes('vercel-cron');
  let auth = { ok: false, isAdmin: false };
  if (req.query?.user === 'ailson') req.headers['x-user'] = 'ailson';
  if (!ehCron) { auth = await validarUsuario(req); if (!auth.ok || !auth.isAdmin) return res.status(403).json({ error: 'Apenas admin' }); }

  if (req.method === 'POST') {
    const { chave, valor } = req.body || {};
    if (!chave) return res.status(400).json({ error: 'chave' });
    if (chave === 'marcar_lido') { await supabase.from('saude_incidentes').update({ lido_em: new Date().toISOString() }).eq('codigo', valor); return res.status(200).json({ ok: true }); }
    await supabase.from('saude_config').upsert({ chave, valor: String(valor ?? ''), atualizado_em: new Date().toISOString() }, { onConflict: 'chave' });
    return res.status(200).json({ ok: true });
  }

  // 12/09: ?teste=1 (admin) — manda o template com nivel "teste" pro numero cadastrado
  if (req.query?.teste === '1') {
    const c = await cfg();
    if (!c.whats_admin) return res.status(200).json({ ok: false, erro: 'sem numero cadastrado' });
    const r = await enviarTemplate(String(c.whats_admin), c.template || 'alerta_saude_app_v3', ['teste', 'INC-TESTE']);
    return res.status(200).json({ ok: !!(r?.messages || r?.ok || r?.id), resposta: r });
  }
  if (req.query?.painel === '1') {
    const [{ data: leituras }, { data: incidentes }, c] = await Promise.all([
      supabase.from('saude_leituras').select('*').order('lida_em', { ascending: false }).limit(288),
      supabase.from('saude_incidentes').select('*').order('aberto_em', { ascending: false }).limit(30),
      cfg(),
    ]);
    return res.status(200).json({ ok: true, agora: leituras?.[0] || null, leituras: leituras || [], incidentes: incidentes || [], config: { ...c, whats_admin: c.whats_admin ? '•••' + String(c.whats_admin).slice(-4) : '' } });
  }

  // ── uma leitura ──
  const m = await coletar();
  const { nivel, motivos } = await classificar(m);
  await supabase.from('saude_leituras').insert({
    nivel, conexoes: m.conexoes, conexoes_max: m.conexoes_max, ativas: m.ativas, idle_tx: m.idle_tx,
    latencia_ms: m.latencia_ms, db_calls_5min: m.db_calls_5min, storage_calls_5min: m.storage_calls_5min,
    esteira_erros_1h: m.esteira_erros_1h, bling_429_1h: m.bling_429_1h, motivos, bruto: m.bruto || { erro: m.erro },
  });
  // apaga leituras com mais de 7 dias
  await supabase.from('saude_leituras').delete().lt('lida_em', new Date(Date.now() - 7 * 86400000).toISOString());

  const out = { ok: true, nivel, motivos, medidas: { conexoes: m.conexoes, max: m.conexoes_max, latencia_ms: m.latencia_ms, storage_5min: m.storage_calls_5min, db_5min: m.db_calls_5min } };
  if (nivel !== 'amarelo' && nivel !== 'vermelho') return res.status(200).json(out);

  // incidente: abre um por episodio (nao repete se o ultimo do mesmo nivel tem < 2h)
  const c = await cfg();
  const { data: ultInc } = await supabase.from('saude_incidentes').select('codigo, aberto_em').eq('nivel', nivel).order('aberto_em', { ascending: false }).limit(1).maybeSingle();
  if (ultInc && Date.now() - new Date(ultInc.aberto_em).getTime() < 2 * 3600000) return res.status(200).json({ ...out, incidente: ultInc.codigo, nota: 'episódio já registrado' });
  const codigo = await proximoCodigo();
  const lista = motivos[nivel];
  const resumo = lista.join(' · ');
  const sugestao = sugestaoPara(lista);
  await supabase.from('saude_incidentes').insert({ codigo, nivel, resumo, sugestao, dossie: { medidas: m, motivos, lida_em: new Date().toISOString() } });
  out.incidente = codigo;

  const pode = await podeEnviar(nivel, c);
  if (c.enviar_whats !== '1' || !c.whats_admin) { out.whats = 'desligado ou sem número'; return res.status(200).json(out); }
  if (!pode.ok) { out.whats = 'não enviado: ' + pode.motivo; return res.status(200).json(out); }
  try {
    // template v3 (minimo): so nivel e codigo — o relatorio esta na pagina Saude
    const r = await enviarTemplate(String(c.whats_admin), c.template || 'alerta_saude_app_v3', [nivel, codigo.replace('#', '')]);
    const okEnv = !!(r?.ok || r?.messages || r?.id);
    await supabase.from('saude_incidentes').update({ enviado_whats: okEnv, enviado_em: okEnv ? new Date().toISOString() : null, envio_erro: okEnv ? null : JSON.stringify(r).slice(0, 300) }).eq('codigo', codigo);
    out.whats = okEnv ? 'enviado' : 'falhou';
  } catch (e) {
    await supabase.from('saude_incidentes').update({ envio_erro: String(e?.message || e).slice(0, 300) }).eq('codigo', codigo);
    out.whats = 'erro: ' + String(e?.message || e);
  }
  return res.status(200).json(out);
}
