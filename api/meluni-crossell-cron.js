// ============================================================================
// /api/meluni-crossell-cron — AUTO CROSS-SELL da Lara (Ailson 03/08/2026).
//
// 7 dias depois de RECEBER o pós-compra, a cliente recebe uma oferta de
// cross-sell de COR ou MODELO (virada de coleção inverno→verão), sempre com
// foto (mesmo caminho do carrinho: meluni_produto_fotos).
//
// MOTOR DE DECISÃO (regras do Ailson):
//   Cores-alvo (democráticas): AZUL CLARO e VERDE SÁLVIA.
//   1. Comprou REF 3150, 2927 (couro) OU 3228 (moletinho) -> oferecer um
//      vestido midi BEGE (neutro, ex 2790) -> template OUTRO_MODELO.
//   2. Caso geral, item mais recente primeiro: se a MESMA REF tem cor-alvo em
//      estoque que a cliente ainda nao comprou -> oferece a de MAIOR estoque
//      -> template MESMO_MODELO. (Cobre tudo: comprou inverno/bege/preto ->
//      alvo; comprou azul claro -> sálvia; comprou rosa/amarelo -> alvo.)
//   3. REF sem cor de verao -> outra REF da MESMA CATEGORIA (lojas_produtos;
//      fallback: 1a palavra da descricao) com cor-alvo em estoque, que a
//      cliente nunca comprou, maior estoque primeiro -> template OUTRO_MODELO.
//   4. Nada encontrado -> pula a cliente.
//   Estoque minimo da oferta: 10 pcs vendaveis (exitus+lumia+muniam).
//
// Elegivel = recebeu o template pos-compra ha 7–14 dias E nunca recebeu
// cross-sell (dedupe permanente por template_usado) E nao bloqueada E sem
// devolucao nao-cancelada E telefone valido. Seg–sab. 1 envio por cliente.
//
// Toggle: meluni_config.lara_crossell_auto = { ativo }.
// Templates: meluni_config.lara_templates_crossell =
//   { mesmo_modelo: { name, body }, outro_modelo: { name, body } }
//   Body params enviados: {{1}}=primeiro nome, {{2}}=nome curto do produto.
// Seguranca: cron (user-agent vercel-cron) OU ?force=1 OU ?dry=1.
//   ?dry=1 -> SIMULA: mostra quem receberia o que, nao envia nada.
// ============================================================================
import { supabase, cfgMeluni } from './_meluni-whats-helpers.js';
import { enviarTemplateLara } from './_meluni-whats-meta.js';
import { chaveTel } from './_meluni-tel.js';
import { telefonesCongelados } from './_meluni-tags-core.js';

const LOTE = 60;
const MIN_ESTOQUE = 10;
const CORES_ALVO = ['azulclaro', 'verdesalvia'];
const LABEL_COR = { azulclaro: 'Azul Claro', verdesalvia: 'Verde Sálvia', bege: 'Bege' };
// Gatilho do grupo neutro (Ailson 03/08 corrigido): couro 3150/2927 E o
// moletinho 3228 recebem a MESMA oferta — vestido midi em cor neutra (bege).
const REFS_GATILHO_NEUTRO = new Set(['3150', '2927', '3228']);
const ETAPAS_FECHADAS = ['conversao', 'ganho', 'perdido'];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const soDigitos = (s) => String(s || '').replace(/\D/g, '');
function canonTel(s) { let d = soDigitos(s); if (d.length >= 12 && d.startsWith('55')) d = d.slice(2); return d; }
function primeiroNome(nome) {
  const t = String(nome || '').trim().split(/\s+/)[0] || '';
  return t ? t.charAt(0).toUpperCase() + t.slice(1).toLowerCase() : '';
}
const l0 = (r) => String(r || '').replace(/^0+/, '') || '0';
const normCor = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/g, '');
function renderTpl(body, params) {
  let s = String(body || '');
  params.forEach((p, i) => { s = s.split('{{' + (i + 1) + '}}').join(String(p)); });
  return s;
}
function diaISO(offsetDias) {
  return new Date(Date.now() - 3 * 3600e3 - offsetDias * 86400e3).toISOString().slice(0, 10);
}
// categoria por 1a palavra da descricao (fallback quando lojas_produtos nao tem)
function categoriaDaDesc(desc) {
  const p = String(desc || '').trim().split(/\s+/)[0].toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const mapa = { SAIA: 'SAIA', VESTIDO: 'VESTIDO', CALCA: 'CALÇA', BLUSA: 'BLUSA', BLAZER: 'BLAZER', MACACAO: 'MACACÃO', SHORT: 'SHORTS', SHORTS: 'SHORTS', BERMUDA: 'SHORTS', CONJUNTO: 'CONJUNTO', CROPPED: 'CROPPED', CASAQUINHO: 'CASAQUINHO' };
  return mapa[p] || null;
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
  const ua = String(req.headers['user-agent'] || '');
  const ehCron = ua.startsWith('vercel-cron');
  const force = req.query?.force === '1';
  const dry = req.query?.dry === '1';
  if (!ehCron && !force && !dry) {
    return res.status(403).json({ ok: false, erro: 'Cron only. Use ?dry=1 pra simular ou ?force=1.' });
  }
  try {
    const cfgAuto = (await cfgMeluni('lara_crossell_auto', { ativo: false })) || {};
    const ativo = cfgAuto.ativo === true;
    if (!ativo && !force && !dry) return res.status(200).json({ ok: true, pulado: 'toggle_desligado', enviados: 0 });
    const diaSemanaBRT = new Date(Date.now() - 3 * 3600e3).getUTCDay();
    if (diaSemanaBRT === 0 && !force && !dry) return res.status(200).json({ ok: true, pulado: 'domingo', enviados: 0 });

    // templates do cross-sell (2: mesmo modelo em cor de verao | outro modelo da categoria)
    const cfgT = (await cfgMeluni('lara_templates_crossell', {})) || {};
    const tplMesmo = cfgT.mesmo_modelo, tplOutro = cfgT.outro_modelo;
    const temTemplates = !!(tplMesmo?.name && tplOutro?.name);
    if (!temTemplates && !dry) return res.status(400).json({ ok: false, erro: 'lara_templates_crossell nao configurado (mesmo_modelo/outro_modelo)' });
    const lang = cfgT.idioma || 'pt_BR';

    // ── ancora: quem RECEBEU o pos-compra ha 7–14 dias ──────────────────────
    const cfgPos = (await cfgMeluni('lara_templates_clientes', {})) || {};
    const nomesPos = [cfgPos.templates?.curta?.name, cfgPos.templates?.pessoal?.name].filter(Boolean);
    if (!nomesPos.length) return res.status(400).json({ ok: false, erro: 'templates pos-compra nao configurados (ancora dos 7 dias)' });
    const de = diaISO(14) + 'T00:00:00', ate = diaISO(7) + 'T23:59:59';
    const { data: msgsPos } = await supabase.from('meluni_mensagens')
      .select('conversa_id, enviada_em')
      .in('template_usado', nomesPos)
      .gte('enviada_em', de).lte('enviada_em', ate)
      .limit(800);
    const convIds = [...new Set((msgsPos || []).map(m => m.conversa_id).filter(Boolean))];
    if (!convIds.length) return res.status(200).json({ ok: true, dry, elegiveis: 0, motivo: 'ninguem recebeu pos-compra ha 7-14 dias' });
    const { data: convs } = await supabase.from('meluni_conversas')
      .select('id, telefone, cliente_id').in('id', convIds);
    const cliIds = [...new Set((convs || []).map(c => c.cliente_id).filter(Boolean))];

    // ── clientes + guardas (bloqueio, devolucao) ────────────────────────────
    const { data: clientes0 } = await supabase.from('meluni_clientes')
      .select('id, nome, telefone, whatsapp, convertr_id, bloqueado')
      .in('id', cliIds.length ? cliIds : ['00000000-0000-0000-0000-000000000000']);
    let cands = (clientes0 || []).filter(c => c.bloqueado !== true && canonTel(c.whatsapp || c.telefone).length >= 10 && primeiroNome(c.nome));
    const { data: devs } = await supabase.from('meluni_devolucoes').select('cliente_id, telefone, convertr_id, cancelada');
    const devCliId = new Set(), devTel = new Set(), devConv = new Set();
    (devs || []).forEach(d => {
      if (d.cancelada === true) return;
      if (d.cliente_id) devCliId.add(d.cliente_id);
      const t = canonTel(d.telefone); if (t.length >= 10) devTel.add(t);
      if (d.convertr_id) devConv.add(String(d.convertr_id));
    });
    cands = cands.filter(c => {
      const t = canonTel(c.whatsapp || c.telefone);
      return !devCliId.has(c.id) && !(t && devTel.has(t)) && !(c.convertr_id && devConv.has(String(c.convertr_id)));
    });

    // ── dedupe permanente: nunca recebeu cross-sell ─────────────────────────
    const nomesCross = [tplMesmo?.name, tplOutro?.name].filter(Boolean);
    if (nomesCross.length) {
      const { data: jaMsgs } = await supabase.from('meluni_mensagens')
        .select('conversa_id').in('template_usado', nomesCross).limit(5000);
      const jaConv = new Set((jaMsgs || []).map(m => m.conversa_id));
      if (jaConv.size) {
        const { data: jaConvs } = await supabase.from('meluni_conversas')
          .select('id, telefone, cliente_id').in('id', [...jaConv]);
        const jaTel = new Set(), jaCli = new Set();
        (jaConvs || []).forEach(cv => { if (cv.telefone) jaTel.add(canonTel(cv.telefone)); if (cv.cliente_id) jaCli.add(cv.cliente_id); });
        cands = cands.filter(c => !jaCli.has(c.id) && !jaTel.has(canonTel(c.whatsapp || c.telefone)));
      }
    }
    if (!cands.length) return res.status(200).json({ ok: true, dry, elegiveis: 0, motivo: 'sem candidatos apos guardas/dedupe' });

    // ── bases do motor: estoque (cores alvo + bege), categorias, fotos ──────
    const { data: est } = await supabase.from('bling_estoque')
      .select('ref, cor_norm, qtd, qtd_lumia, qtd_muniam, titulo')
      .in('cor_norm', ['azulclaro', 'verdesalvia', 'bege']);
    // estoquePorRefCor[ref][cor] = pcs; tituloPorRef[ref]
    const estoquePorRefCor = {}, tituloPorRef = {};
    (est || []).forEach(r => {
      const ref = l0(r.ref); const cor = normCor(r.cor_norm);
      const v = (r.qtd || 0) + (r.qtd_lumia || 0) + (r.qtd_muniam || 0);
      if (!estoquePorRefCor[ref]) estoquePorRefCor[ref] = {};
      estoquePorRefCor[ref][cor] = (estoquePorRefCor[ref][cor] || 0) + v;
      if (!tituloPorRef[ref] && r.titulo) tituloPorRef[ref] = String(r.titulo).split('(')[0].trim();
    });
    const { data: prods } = await supabase.from('lojas_produtos').select('ref, categoria, nome');
    const catPorRef = {}, nomePorRef = {};
    (prods || []).forEach(p => { const ref = l0(p.ref); if (p.categoria) catPorRef[ref] = p.categoria; if (p.nome) nomePorRef[ref] = p.nome; });
    // categoria derivada do TITULO do estoque quando lojas_produtos nao cobre
    Object.keys(tituloPorRef).forEach(ref => {
      if (!catPorRef[ref]) { const c = categoriaDaDesc(tituloPorRef[ref]); if (c) catPorRef[ref] = c; }
    });
    // refs por categoria COM cor alvo em estoque (pro fallback de modelo)
    const refsPorCategoria = {};
    Object.keys(estoquePorRefCor).forEach(ref => {
      const cat = catPorRef[ref]; if (!cat) return;
      const temAlvo = CORES_ALVO.some(c => (estoquePorRefCor[ref][c] || 0) >= MIN_ESTOQUE);
      if (!temAlvo) return;
      if (!refsPorCategoria[cat]) refsPorCategoria[cat] = [];
      refsPorCategoria[cat].push(ref);
    });
    // fotos: por ref (prefere a da cor alvo)
    const { data: fotos } = await supabase.from('meluni_produto_fotos')
      .select('ref, cor, url_publica, sem_foto').eq('sem_foto', false).not('url_publica', 'is', null);
    const fotoPorRefCor = {}, fotoPorRef = {};
    (fotos || []).forEach(f => {
      const ref = l0(f.ref); const cor = normCor(f.cor);
      if (cor && !fotoPorRefCor[ref + '|' + cor]) fotoPorRefCor[ref + '|' + cor] = f.url_publica;
      if (!fotoPorRef[ref]) fotoPorRef[ref] = f.url_publica;
    });
    const fotoDe = (ref, cor) => fotoPorRefCor[ref + '|' + cor] || fotoPorRef[ref] || null;
    const tituloDe = (ref) => nomePorRef[ref] || tituloPorRef[ref] || ('ref ' + ref);
    const melhorAlvo = (ref, coresJaCompradas) => {
      const ops = CORES_ALVO
        .filter(c => !coresJaCompradas.has(c))
        .map(c => ({ cor: c, pcs: (estoquePorRefCor[ref]?.[c] || 0) }))
        .filter(o => o.pcs >= MIN_ESTOQUE)
        .sort((a, b) => b.pcs - a.pcs);
      return ops[0] || null;
    };

    // ── compras por cliente (itens ref+cor) ─────────────────────────────────
    const { data: vendas } = await supabase.from('meluni_vendas')
      .select('cliente_id, data_pedido, itens')
      .in('cliente_id', cands.map(c => c.id))
      .neq('situacao_id', 12)
      .order('data_pedido', { ascending: false });
    const comprasPorCli = {};
    (vendas || []).forEach(v => {
      if (!comprasPorCli[v.cliente_id]) comprasPorCli[v.cliente_id] = [];
      (Array.isArray(v.itens) ? v.itens : []).forEach(i => {
        comprasPorCli[v.cliente_id].push({ ref: l0(i.ref), cor: normCor(i.cor), desc: i.descLimpa || i.descricao || '' });
      });
    });

    // ── MOTOR ───────────────────────────────────────────────────────────────
    const decidir = (compras) => {
      if (!compras?.length) return null;
      const refsCompradas = new Set(compras.map(i => i.ref));
      const coresPorRef = {};
      compras.forEach(i => { if (!coresPorRef[i.ref]) coresPorRef[i.ref] = new Set(); coresPorRef[i.ref].add(i.cor); });
      // 1. couro/moletinho -> vestido midi bege (neutro), midi primeiro, maior estoque
      if (compras.some(i => REFS_GATILHO_NEUTRO.has(i.ref))) {
        const vestidos = Object.keys(estoquePorRefCor)
          .filter(r => catPorRef[r] === 'VESTIDO')
          .filter(r => !refsCompradas.has(r) && (estoquePorRefCor[r]?.bege || 0) >= MIN_ESTOQUE)
          .map(r => ({ ref: r, pcs: estoquePorRefCor[r].bege, midi: /midi/i.test(tituloDe(r)) }))
          .sort((a, b) => (b.midi - a.midi) || (b.pcs - a.pcs));
        if (vestidos.length) return { tipo: 'outro_modelo', ref: vestidos[0].ref, cor: 'bege', pcs: vestidos[0].pcs, motivo: 'comprou couro/moletinho → vestido midi bege' };
        // sem vestido bege disponivel: segue pro fluxo geral (cores de verao)
      }
      // 2. mesma ref em cor alvo que ainda nao comprou
      for (const item of compras) {
        const alvo = melhorAlvo(item.ref, coresPorRef[item.ref] || new Set());
        if (alvo) return { tipo: 'mesmo_modelo', ref: item.ref, cor: alvo.cor, pcs: alvo.pcs, base: item, motivo: 'mesmo modelo em cor de verão' };
      }
      // 3. outra ref da mesma categoria
      for (const item of compras) {
        const cat = catPorRef[item.ref] || categoriaDaDesc(item.desc);
        if (!cat) continue;
        const ops = (refsPorCategoria[cat] || [])
          .filter(r => !refsCompradas.has(r))
          .map(r => { const alvo = melhorAlvo(r, new Set()); return alvo ? { ref: r, ...alvo } : null; })
          .filter(Boolean)
          .sort((a, b) => b.pcs - a.pcs);
        if (ops.length) return { tipo: 'outro_modelo', ref: ops[0].ref, cor: ops[0].cor, pcs: ops[0].pcs, base: item, motivo: `mesma categoria (${cat})` };
      }
      return null;
    };

    const planos = [];
    for (const c of cands) {
      const oferta = decidir(comprasPorCli[c.id]);
      if (!oferta) continue;
      planos.push({ cliente: c, oferta });
      if (planos.length >= LOTE) break;
    }

    if (dry) {
      return res.status(200).json({
        ok: true, dry: true, ativo, templates_ok: temTemplates,
        recebeu_poscompra_7_14d: cliIds.length, apos_guardas: cands.length, com_oferta: planos.length,
        planos: planos.slice(0, 30).map(p => ({
          cliente: p.cliente.nome,
          comprou: (comprasPorCli[p.cliente.id] || []).slice(0, 4).map(i => `${i.ref} ${i.cor}`).join(', '),
          oferta: `${p.oferta.tipo === 'mesmo_modelo' ? 'MESMO MODELO' : 'OUTRO MODELO'} → ref ${p.oferta.ref} ${LABEL_COR[p.oferta.cor] || p.oferta.cor} (${p.oferta.pcs} pçs) · ${p.oferta.motivo}`,
          produto: tituloDe(p.oferta.ref),
          foto: fotoDe(p.oferta.ref, p.oferta.cor) ? 'ok' : 'SEM FOTO',
        })),
      });
    }

    // ── ENVIO REAL ──────────────────────────────────────────────────────────
    let enviados = 0, pulados = 0, erros = 0;
    const congelados = await telefonesCongelados(supabase);
    for (const p of planos) {
      try {
        const c = p.cliente;
        const tel = canonTel(c.whatsapp || c.telefone);
        if (congelados.has(chaveTel(c.whatsapp || c.telefone))) { pulados++; continue; }
        const foto = fotoDe(p.oferta.ref, p.oferta.cor);
        if (!foto) { pulados++; continue; } // regra do Ailson: sempre com foto
        const conv = await acharOuCriarConversaCliente(tel, c.nome, c.id);
        if (conv && ETAPAS_FECHADAS.includes(conv.etapa)) { pulados++; continue; }
        const tpl = p.oferta.tipo === 'mesmo_modelo' ? tplMesmo : tplOutro;
        const nome = primeiroNome(c.nome);
        const produto = tituloDe(p.oferta.ref);
        // mesmo_modelo: {{1}} nome, {{2}} produto, {{3}} cor (template do Ailson)
        // outro_modelo: {{1}} nome, {{2}} produto (ate o texto dele chegar)
        const params = p.oferta.tipo === 'mesmo_modelo'
          ? [nome, produto, LABEL_COR[p.oferta.cor] || p.oferta.cor]
          : [nome, produto];
        const headerImage = foto + (foto.includes('?') ? '&' : '?') + 'v=' + Date.now();
        const r = await enviarTemplateLara('55' + tel, tpl.name, params, { language: lang, headerImage });
        const metaMsgId = r?.messages?.[0]?.id || null;
        if (!metaMsgId) { erros++; continue; }
        const nowIso = new Date().toISOString();
        if (conv?.id) {
          await supabase.from('meluni_mensagens').insert({
            conversa_id: conv.id, direcao: 'saida', autor: 'lara_crossell',
            tipo_midia: 'template', template_usado: tpl.name,
            texto: renderTpl(tpl.body, params),
            meta_message_id: metaMsgId, enviada_em: nowIso,
          });
          await supabase.from('meluni_conversas').update({
            etapa: 'enviados', ultima_msg_direcao: 'saida', ultima_msg_em: nowIso, responder_em: null,
          }).eq('id', conv.id);
        }
        enviados++;
        await sleep(300);
      } catch (e) { erros++; }
    }
    return res.status(200).json({ ok: true, ativo, enviados, pulados, erros, com_oferta: planos.length, lote: LOTE });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: String(e?.message || e) });
  }
}
