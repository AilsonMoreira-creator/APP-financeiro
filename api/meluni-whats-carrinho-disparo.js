// ============================================================================
// /api/meluni-whats-carrinho-disparo — 1º disparo do carrinho abandonado.
// ----------------------------------------------------------------------------
// Dois modos:
//  - MANUAL: POST { ids:[...] } -> dispara só os carrinhos selecionados (status
//    processando), sem gate/idade. É o botão "gerar mensagem e disparar".
//  - CRON/GATE: sem ids -> varre processando dentro da janela, respeita
//    lara_carrinho_disparo_ativo (?force=1&teste=1 ignora o gate).
// Em ambos: escolhe versão (leve/elegante/sem_nome), envia, registra na conversa
// e MOVE o carrinho pra status 'enviada' (enviado_em/enviado_template).
// Ailson 17/06/2026.
// ============================================================================
import { supabase, cfgMeluni, dentroJanelaEnvio } from './_meluni-whats-helpers.js';
import { enviarTemplateLara } from './_meluni-whats-meta.js';
import { resolverResumoItens, resolverPrimeiroNome } from './_meluni-carrinho-resumo.js';
import { urlFotoCarrinho } from './_meluni-fotos.js';
import { acharConversaWhats } from './_meluni-tel.js';

const ETAPAS_FECHADAS = ['vendeu', 'perdida', 'resolvido'];

// renderiza o corpo do template (com {{1}},{{2}}) pro texto real que a cliente recebe
function renderTpl(body, params) {
  let t = String(body || '');
  (params || []).forEach((p, i) => { t = t.split(`{{${i + 1}}}`).join(p == null ? '' : String(p)); });
  return t.trim();
}

async function acharOuCriarConversa(telefone, nome) {
  const ex = await acharConversaWhats(supabase, telefone);
  if (ex?.id) return ex;
  const { data: nova } = await supabase.from('meluni_conversas').insert({
    canal: 'whatsapp', telefone, externo_id: telefone, nome_cliente: nome || null,
    origem: 'carrinho', etapa: 'conversando',
    ultima_msg_direcao: 'saida', ultima_msg_em: new Date().toISOString(),
  }).select('id, etapa').single();
  return nova || null;
}

// envia o 1º template pra um carrinho e move pra 'enviada'. Retorna {ok}|{skip}.
async function enviarCarrinho(c, pctLeve, exigirNome, tpls, imgAtivo) {
  const itens = Array.isArray(c.itens) ? c.itens.filter(i => i?.sku) : [];
  if (!itens.length) return { skip: 'sem_itens' };
  if (c.enviado_em || c.dados_extra?.lara_template_enviado_em) return { skip: 'ja_enviado' };

  const nome = await resolverPrimeiroNome(c.telefone, c.nome);
  if (nome && !c.nome) { try { await supabase.from('meluni_carrinhos').update({ nome }).eq('id', c.id); } catch {} }
  if (!nome && exigirNome) return { skip: 'sem_nome' };
  const { resumo } = await resolverResumoItens(itens);

  // ── Escolha do template (Ailson 02/07/2026): FOTO PRIMEIRO ──
  // Com gate lara_carrinho_img_ativo ligado, nome e foto cacheada
  // (meluni_produto_fotos, tamanho cheio): sorteio 50/50 ENTRE OS DOIS templates
  // com imagem -> leve_img (nome+resumo) | atemporal_img (só nome).
  // ?v=timestamp força a Meta a baixar a foto atual (path do bucket é fixo por sku).
  // Sem foto ou gate desligado: sorteio de sempre entre os templates texto
  // (pctLeve leve/elegante). Se o envio COM imagem falhar, cai automático pro
  // texto correspondente (leve_img->leve, atemporal_img->elegante).
  let versao, nameTpl, bodyParams;
  let headerImage = null, versaoTexto = null, nameTplTexto = null;
  if (nome) {
    const foto = imgAtivo ? await urlFotoCarrinho(itens) : null;
    if (foto) {
      versao = Math.random() < 0.5 ? 'leve_img' : 'atemporal_img';
      if (versao === 'leve_img' && !resumo) versao = 'atemporal_img';
      nameTpl = versao === 'leve_img' ? 'meluni_carrinho_leve_img' : 'meluni_carrinho_atemporal_img';
      bodyParams = versao === 'leve_img' ? [nome, resumo] : [nome];
      headerImage = foto + (foto.includes('?') ? '&' : '?') + 'v=' + Date.now();
      versaoTexto = versao === 'leve_img' ? 'leve' : 'elegante';
      nameTplTexto = versaoTexto === 'leve' ? 'meluni_carrinho_leve' : 'meluni_carrinho_elegante';
    } else {
      versao = Math.random() * 100 < pctLeve ? 'leve' : 'elegante';
      if (versao === 'leve' && !resumo) versao = 'elegante';
      nameTpl = versao === 'leve' ? 'meluni_carrinho_leve' : 'meluni_carrinho_elegante';
      bodyParams = versao === 'leve' ? [nome, resumo] : [nome];
    }
  } else {
    if (!resumo) return { skip: 'sem_nome_sem_resumo' };
    versao = 'sem_nome'; nameTpl = 'meluni_carrinho_sem_nome'; bodyParams = [resumo];
  }

  const conv = await acharOuCriarConversa(c.telefone, nome);
  if (conv && ETAPAS_FECHADAS.includes(conv.etapa)) return { skip: 'conversa_fechada' };

  let r;
  try {
    r = await enviarTemplateLara(c.telefone, nameTpl, bodyParams, headerImage ? { headerImage } : {});
  } catch (e) {
    if (!headerImage) throw e;
    // imagem falhou (foto fora do ar, template reprovado etc) -> manda o texto
    versao = versaoTexto; nameTpl = nameTplTexto;
    bodyParams = versao === 'leve' ? [nome, resumo] : [nome];
    r = await enviarTemplateLara(c.telefone, nameTpl, bodyParams);
  }
  const metaMsgId = r?.messages?.[0]?.id || null;
  const nowIso = new Date().toISOString();

  if (conv?.id) {
    const textoReal = renderTpl(tpls?.[versao]?.body, bodyParams)
      || (versao === 'sem_nome' ? resumo : (versao === 'leve' || versao === 'leve_img') ? `${nome}: ${resumo}` : nome);
    await supabase.from('meluni_mensagens').insert({
      conversa_id: conv.id, direcao: 'saida', autor: 'lara_carrinho',
      tipo_midia: 'template', template_usado: nameTpl,
      texto: textoReal,
      meta_message_id: metaMsgId, enviada_em: nowIso,
    });
    await supabase.from('meluni_conversas').update({
      ultima_msg_direcao: 'saida', ultima_msg_em: nowIso, responder_em: null,
    }).eq('id', conv.id);
  }

  await supabase.from('meluni_carrinhos').update({
    status: 'enviada', enviado_em: nowIso, enviado_template: nameTpl,
    dados_extra: { ...(c.dados_extra || {}), lara_template_enviado_em: nowIso, lara_template_versao: versao, lara_template_name: nameTpl },
  }).eq('id', c.id);

  return { ok: true, versao, meta_message_id: metaMsgId };
}

const COLS = 'id, nome, telefone, itens, dados_extra, data_carrinho, status, enviado_em';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const pctLeve = Number(await cfgMeluni('lara_carrinho_ab_pct_leve', 50));
  const imgAtivo = (await cfgMeluni('lara_carrinho_img_ativo', false)) === true;
  const exigirNome = (await cfgMeluni('lara_carrinho_exigir_nome', false)) === true;
  // merge: base texto + specs com foto (lara_templates_carrinho_img é a fonte
  // de verdade pros bodies aprovados de leve_img/atemporal_img)
  const tplsBase = ((await cfgMeluni('lara_templates_carrinho', {})) || {}).templates || {};
  const tplsImg = ((await cfgMeluni('lara_templates_carrinho_img', {})) || {}).templates || {};
  const tpls = { ...tplsBase, ...tplsImg };

  // corpo pode chegar como objeto (parse automático) ou string crua — trata os dois.
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  if (!body || typeof body !== 'object') body = {};

  // ── MODO MANUAL: ids selecionados (botão "gerar e disparar") ──
  // aceita POST {ids:[...]} ou, pra teste/diagnóstico, GET/POST ?force=1&ids=a,b
  const idsBody = Array.isArray(body.ids) ? body.ids.filter(Boolean) : null;
  const idsQs = (req.query?.force === '1' && req.query?.ids)
    ? String(req.query.ids).split(',').map(s => s.trim()).filter(Boolean) : null;
  const ids = idsBody || idsQs;
  if (ids) {
    if (!ids.length) return res.status(400).json({ ok: false, erro: 'ids vazio' });
    let enviados = 0, pulados = 0, erros = 0; const detalhe = [];
    const { data: carts } = await supabase.from('meluni_carrinhos').select(COLS).in('id', ids).eq('status', 'processando');
    for (const c of (carts || [])) {
      try {
        const r = await enviarCarrinho(c, pctLeve, exigirNome, tpls, imgAtivo);
        if (r.ok) { enviados++; detalhe.push({ id: c.id, versao: r.versao }); }
        else { pulados++; detalhe.push({ id: c.id, pulado: r.skip }); }
      } catch (e) { erros++; detalhe.push({ id: c.id, erro: String(e?.message || e) }); }
    }
    return res.status(200).json({ ok: true, modo: 'manual', enviados, pulados, erros, detalhe });
  }

  // ── MODO CRON/GATE ──
  const ua = req.headers?.['user-agent'] || '';
  const ehCron = ua.startsWith('vercel-cron') || !!req.headers?.['x-vercel-cron'];
  const force = req.query?.force === '1';
  if (!ehCron && !force) return res.status(403).json({ erro: 'Cron only. Use ?force=1 ou POST {ids}.' });

  const ativo = (await cfgMeluni('lara_carrinho_disparo_ativo', false)) === true;
  const ignoraGate = force && req.query?.teste === '1';
  if (!ativo && !ignoraGate) return res.status(200).json({ ok: true, gate: 'desligado', enviados: 0 });
  // janela de envio automático (seg–sáb 09–20). Fora dela segura pra próxima janela.
  if (!ignoraGate && !dentroJanelaEnvio()) return res.status(200).json({ ok: true, gate: 'fora_da_janela', janela: 'seg-sab 09:00-20:00', enviados: 0 });

  const idadeMinH = Number(await cfgMeluni('lara_carrinho_idade_min_horas', 2)) || 2;
  const idadeMaxD = Number(await cfgMeluni('lara_carrinho_idade_max_dias', 30)) || 30;
  const lote = Number(await cfgMeluni('lara_carrinho_lote', 20)) || 20;
  const limite = force ? Math.min(lote, Number(req.query?.n) || lote) : lote;
  const agora = Date.now();
  const teto = new Date(agora - idadeMinH * 3600e3).toISOString();
  const piso = new Date(agora - idadeMaxD * 86400e3).toISOString();

  let enviados = 0, pulados = 0, erros = 0; const detalhe = [];
  try {
    const { data: carts, error } = await supabase.from('meluni_carrinhos').select(COLS)
      .eq('status', 'processando').not('telefone', 'is', null)
      .lte('data_carrinho', teto).gte('data_carrinho', piso)
      .order('data_carrinho', { ascending: false }).limit(limite * 3);
    if (error) throw error;
    for (const c of (carts || [])) {
      if (enviados >= limite) break;
      try {
        const r = await enviarCarrinho(c, pctLeve, exigirNome, tpls, imgAtivo);
        if (r.ok) { enviados++; detalhe.push({ id: c.id, versao: r.versao }); }
        else { pulados++; }
      } catch (e) { erros++; detalhe.push({ id: c.id, erro: String(e?.message || e) }); }
    }
    return res.status(200).json({ ok: true, gate: ativo ? 'ligado' : 'teste', enviados, pulados, erros, limite, detalhe });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: String(e?.message || e), enviados, pulados, erros });
  }
}
