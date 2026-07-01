// Disparo da etapa CLIENTES (carteira) da Lara — mensagem pós-compra.
// Recebe ids de clientes selecionados (manual, humano clica), envia o template
// pós-compra em A/B (curta x pessoal, ab_pct_curta), cria/atualiza a conversa
// origem='cliente' movendo pra etapa 'enviados', e registra a mensagem.
//
// É MANUAL — não passa pela janela de envio automático (quem decide a hora é o
// humano). Teto por chamada e idempotência de 24h evitam disparo acidental duplo.
//
// POST { ids: [clienteId, ...] }
import { supabase, cfgMeluni } from './_meluni-whats-helpers.js';
import { enviarTemplateLara } from './_meluni-whats-meta.js';

const ETAPAS_FECHADAS = ['conversao', 'ganho', 'perdido'];
const MAX_POR_CHAMADA = 30;
const MIN_DIAS_POS_COMPRA = 10; // trava: nao dispara pos-compra manual antes de 10 dias da compra (mercadoria pode nao ter chegado)

const soDigitos = (s) => String(s || '').replace(/\D/g, '');
// canônico = sem o 55 da frente (igual ao inbound canonTel), pra casar a conversa
function canonTel(s) { let d = soDigitos(s); if (d.length >= 12 && d.startsWith('55')) d = d.slice(2); return d; }
function primeiroNome(nome) {
  const t = String(nome || '').trim().split(/\s+/)[0] || '';
  return t ? t.charAt(0).toUpperCase() + t.slice(1).toLowerCase() : '';
}
function renderTpl(body, params) {
  let s = String(body || '');
  params.forEach((p, i) => { s = s.split('{{' + (i + 1) + '}}').join(String(p)); });
  return s;
}
// data ISO (YYYY-MM-DD) de N dias atras no fuso BRT (UTC-3), igual ao cron pos-compra
function diaBRT(offsetDias) {
  const d = new Date(Date.now() - 3 * 3600e3 - offsetDias * 86400e3);
  return d.toISOString().slice(0, 10);
}

async function acharOuCriarConversaCliente(tel, nome, clienteId) {
  const { data: ex } = await supabase.from('meluni_conversas').select('id, etapa, cliente_id')
    .eq('canal', 'whatsapp').eq('telefone', tel)
    .order('ultima_msg_em', { ascending: false }).limit(1).maybeSingle();
  if (ex?.id) {
    if (clienteId && !ex.cliente_id) await supabase.from('meluni_conversas').update({ cliente_id: clienteId }).eq('id', ex.id);
    return ex;
  }
  const { data: nova } = await supabase.from('meluni_conversas').insert({
    canal: 'whatsapp', telefone: tel, externo_id: tel, nome_cliente: nome || null,
    cliente_id: clienteId || null, origem: 'cliente', etapa: 'enviados',
    ultima_msg_direcao: 'saida', ultima_msg_em: new Date().toISOString(),
  }).select('id, etapa, cliente_id').single();
  return nova || null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, erro: 'use POST' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  let ids = Array.isArray(body?.ids) ? body.ids.filter(Boolean) : [];
  if (!ids.length) return res.status(400).json({ ok: false, erro: 'sem ids' });
  const cortado = ids.length > MAX_POR_CHAMADA;
  if (cortado) ids = ids.slice(0, MAX_POR_CHAMADA);

  const cfg = (await cfgMeluni('lara_templates_clientes', {})) || {};
  const tpls = cfg.templates || {};
  const curta = tpls.curta, pessoal = tpls.pessoal;
  if (!curta?.name || !pessoal?.name) return res.status(400).json({ ok: false, erro: 'templates_clientes nao configurados' });
  const pctCurta = Number(cfg.ab_pct_curta ?? 50);
  const lang = cfg.idioma || 'pt_BR';

  const { data: clientes } = await supabase.from('meluni_clientes')
    .select('id, nome, telefone, whatsapp, bloqueado, ultima_compra').in('id', ids);
  const mapC = new Map((clientes || []).map(c => [c.id, c]));

  let enviados = 0, pulados = 0, erros = 0;
  const detalhe = [];

  for (const id of ids) {
    const c = mapC.get(id);
    try {
      if (!c) { pulados++; detalhe.push({ id, status: 'nao_encontrado' }); continue; }
      if (c.bloqueado) { pulados++; detalhe.push({ id, status: 'bloqueado' }); continue; }
      const tel = canonTel(c.whatsapp || c.telefone);
      if (!tel || tel.length < 10) { pulados++; detalhe.push({ id, status: 'sem_telefone' }); continue; }
      const nome = primeiroNome(c.nome);
      if (!nome) { pulados++; detalhe.push({ id, status: 'sem_nome' }); continue; }

      // trava pos-compra: so dispara a partir de MIN_DIAS_POS_COMPRA dias da compra.
      // Meluni vai tudo por transportadora, antes disso a mercadoria pode nao ter chegado.
      if (c.ultima_compra && c.ultima_compra > diaBRT(MIN_DIAS_POS_COMPRA)) {
        const dias = Math.floor((new Date(diaBRT(0)) - new Date(c.ultima_compra)) / 86400e3);
        pulados++; detalhe.push({ id, status: 'compra_recente', dias, minimo: MIN_DIAS_POS_COMPRA }); continue;
      }

      const conv = await acharOuCriarConversaCliente(tel, c.nome, c.id);
      if (conv && ETAPAS_FECHADAS.includes(conv.etapa)) { pulados++; detalhe.push({ id, status: 'conversa_fechada' }); continue; }

      // idempotência: não re-disparar pós-compra nas últimas 24h
      if (conv?.id) {
        const desde = new Date(Date.now() - 24 * 3600e3).toISOString();
        const { data: jaMsg } = await supabase.from('meluni_mensagens')
          .select('id').eq('conversa_id', conv.id).eq('autor', 'lara_clientes')
          .gte('enviada_em', desde).limit(1).maybeSingle();
        if (jaMsg) { pulados++; detalhe.push({ id, status: 'ja_enviado_24h' }); continue; }
      }

      const versao = (Math.random() * 100 < pctCurta) ? 'curta' : 'pessoal';
      const tpl = versao === 'curta' ? curta : pessoal;
      const r = await enviarTemplateLara('55' + tel, tpl.name, [nome], { language: lang });
      const metaMsgId = r?.messages?.[0]?.id || null;
      const nowIso = new Date().toISOString();

      if (conv?.id) {
        await supabase.from('meluni_mensagens').insert({
          conversa_id: conv.id, direcao: 'saida', autor: 'lara_clientes',
          tipo_midia: 'template', template_usado: tpl.name,
          texto: renderTpl(tpl.body, [nome]),
          meta_message_id: metaMsgId, enviada_em: nowIso,
        });
        await supabase.from('meluni_conversas').update({
          etapa: 'enviados', ultima_msg_direcao: 'saida', ultima_msg_em: nowIso, responder_em: null,
        }).eq('id', conv.id);
      }
      enviados++; detalhe.push({ id, status: 'enviado', versao, meta_message_id: metaMsgId });
    } catch (e) {
      erros++; detalhe.push({ id, status: 'erro', erro: String(e?.message || e) });
    }
  }

  return res.status(200).json({ ok: true, enviados, pulados, erros, total: ids.length, cortado, max: MAX_POR_CHAMADA, detalhe });
}
