// ═══════════════════════════════════════════════════════════════════════════
// /api/ordens-corte-gerar-oficina — PONTE SALA DE CORTE → OFICINAS
// (Ailson 30/08/2026 — fluxo validado por ele antes de codar)
// ---------------------------------------------------------------------------
// O fluxo real: Pedro lança a QTD do corte na lista do Salas de Corte; depois
// o Jean criava o corte no módulo Oficinas NA MÃO. Esta ponte liga os dois:
// seleciona ordem(ns) CONCLUÍDA(s) na tela Ordem de Corte, informa oficina e
// número, e o corte nasce no módulo Oficinas idêntico a um manual.
//
// Regras validadas com ele:
//   · juntar cards: SÓ mesma REF (dias diferentes pode — 1H + 3A ok)
//   · só status concluída, com qtd lançada (qtdPecas do corte da sala)
//   · qtd = SOMA dos cards; valor da peça vem do cadastro (editável)
//   · card que já gerou não gera de novo (carimbo trava)
//   · o corte nasce SÓ NO ESPELHO (oficinas_cortes_espelho): a restauração
//     automática do App (21/08) puxa pro payload principal no próximo load —
//     zero risco de last-write-wins no payload gigante do amicia-admin
//   · editar depois no Oficinas NÃO retropropaga pra ordem (decisão dele)
//
//   GET  ?ids=uuid,uuid   → prévia validada { ref, qtd_total, valor_sugerido,
//                            grupos, oficinas[] }
//   POST { ids, oficina, n_corte, valor_unit, data?, usuario }
// ═══════════════════════════════════════════════════════════════════════════
import {
  supabase, setCors, getUserFromReq, parseBody,
  buscarProdutoPorRef, insertHistorico,
} from './_ordens-corte-helpers.js';

export const config = { maxDuration: 60 };

// Carrega e valida as ordens selecionadas. Devolve { erro } ou os dados.
async function validarSelecao(ids) {
  if (!ids.length) return { erro: 'selecione ao menos uma ordem' };
  if (ids.length > 10) return { erro: 'no máximo 10 ordens por corte' };

  const { data: ordens, error } = await supabase.from('ordens_corte')
    .select('id, ref, descricao, grupo, status, corte_id, oficina_corte_num, oficina_nome, version')
    .in('id', ids);
  if (error) return { erro: error.message };
  if ((ordens || []).length !== ids.length) return { erro: 'ordem não encontrada' };

  const naoConcluida = ordens.find(o => o.status !== 'concluido');
  if (naoConcluida) return { erro: `ordem ${naoConcluida.grupo || naoConcluida.ref} não está concluída` };

  const jaGerada = ordens.find(o => o.oficina_corte_num);
  if (jaGerada) return { erro: `grupo ${jaGerada.grupo || '?'} já gerou o corte ${jaGerada.oficina_corte_num} (${jaGerada.oficina_nome})` };

  const norm = (r) => String(r || '').replace(/^0+/, '').trim();
  const refs = [...new Set(ordens.map(o => norm(o.ref)))];
  if (refs.length > 1) return { erro: `só dá pra juntar cards da MESMA ref — selecionados: ${refs.join(', ')}` };

  const semVinculo = ordens.find(o => !o.corte_id);
  if (semVinculo) return { erro: `grupo ${semVinculo.grupo || '?'} não tem corte vinculado na sala` };

  // qtd lançada pelo Pedro: espelho do salas-corte (dados.qtdPecas)
  const corteIds = ordens.map(o => String(o.corte_id));
  const { data: espSala } = await supabase.from('salas_corte_espelho')
    .select('corte_id, dados').in('corte_id', corteIds).is('deletado_em', null);
  const qtdDe = {};
  for (const r of (espSala || [])) qtdDe[String(r.corte_id)] = Number(r.dados?.qtdPecas) || 0;

  const semQtd = ordens.find(o => !(qtdDe[String(o.corte_id)] > 0));
  if (semQtd) return { erro: `grupo ${semQtd.grupo || '?'} ainda está sem quantidade lançada na sala` };

  const qtdTotal = ordens.reduce((s, o) => s + qtdDe[String(o.corte_id)], 0);
  return { ordens, qtdTotal, qtdDe, ref: ordens[0].ref };
}

// Oficinas conhecidas: cadastro do payload principal + as já usadas em cortes
async function listarOficinas() {
  const nomes = new Set();
  try {
    const { data } = await supabase.from('amicia_data')
      .select('payload->oficinasCAD').eq('user_id', 'amicia-admin').maybeSingle();
    for (const o of (data?.oficinasCAD || [])) {
      const n = typeof o === 'string' ? o : (o?.nome || '');
      if (n) nomes.add(n);
    }
  } catch { /* segue com as dos cortes */ }
  try {
    const { data } = await supabase.from('oficinas_cortes_espelho')
      .select('dados->oficina').is('deletado_em', null).limit(400);
    for (const r of (data || [])) if (r.oficina) nomes.add(String(r.oficina));
  } catch { /* */ }
  return [...nomes].sort((a, b) => a.localeCompare(b));
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    // ── GET: prévia validada pro modal ──
    if (req.method === 'GET') {
      const ids = String(req.query?.ids || '').split(',').map(s => s.trim()).filter(Boolean);
      const v = await validarSelecao(ids);
      if (v.erro) return res.status(400).json({ ok: false, erro: v.erro });
      const produto = await buscarProdutoPorRef(v.ref);
      return res.status(200).json({
        ok: true,
        ref: v.ref,
        descricao: produto?.descricao || v.ordens[0].descricao || '',
        marca: produto?.marca || 'Amícia',
        qtd_total: v.qtdTotal,
        valor_sugerido: Number(produto?.valorUnit) || null,
        grupos: v.ordens.map(o => ({ id: o.id, grupo: o.grupo, qtd: v.qtdDe[String(o.corte_id)] })),
        oficinas: await listarOficinas(),
      });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'método não suportado' });

    // ── POST: gera o corte ──
    const body = parseBody(req);
    const usuario = getUserFromReq(req) || body.usuario || 'admin';
    const ids = (body.ids || []).map(String).filter(Boolean);
    const oficina = String(body.oficina || '').trim();
    const nCorte = String(body.n_corte || '').trim();
    const valorUnit = Number(body.valor_unit);

    if (!oficina) return res.status(400).json({ ok: false, erro: 'informe a oficina' });
    if (!nCorte) return res.status(400).json({ ok: false, erro: 'informe o número do corte' });
    if (!(valorUnit > 0)) return res.status(400).json({ ok: false, erro: 'valor da peça inválido' });

    const v = await validarSelecao(ids);
    if (v.erro) return res.status(400).json({ ok: false, erro: v.erro });

    // número de corte repetido é quase sempre engano — barra aqui
    const { data: dup } = await supabase.from('oficinas_cortes_espelho')
      .select('corte_id').eq('dados->>nCorte', nCorte).is('deletado_em', null).limit(1);
    if (dup?.length) return res.status(409).json({ ok: false, erro: `já existe um corte nº ${nCorte} no módulo Oficinas` });

    const produto = await buscarProdutoPorRef(v.ref);
    const dataCorte = /^\d{4}-\d{2}-\d{2}$/.test(String(body.data || '')) ? body.data : new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
    const agora = Date.now();

    // ── Corte IDÊNTICO ao manual do módulo Oficinas (mesma estrutura do
    // espelho). Campos extras de rastreio não atrapalham: o App espalha
    // {...c} nas edições e ignora o que não conhece.
    const corte = {
      id: agora,
      nCorte,
      oficina,
      ref: String(v.ref),
      descricao: produto?.descricao || v.ordens[0].descricao || '',
      marca: produto?.marca || 'Amícia',
      qtd: v.qtdTotal,
      valorUnit,
      valorTotal: Math.round(v.qtdTotal * valorUnit * 100) / 100,
      data: dataCorte,
      pago: false,
      entregue: false,
      obs: '',
      dataEntrega: null,
      dataPagamento: null,
      _mod: agora,
      // rastreio da ponte (não aparece no card):
      origem_ponte: 'sala_corte',
      ordens_origem: v.ordens.map(o => ({ id: o.id, grupo: o.grupo, qtd: v.qtdDe[String(o.corte_id)] })),
      criado_por_ponte: usuario,
    };

    // 1) espelho — a restauração automática do App puxa pro payload no load
    const { error: errEsp } = await supabase.from('oficinas_cortes_espelho')
      .insert({ corte_id: String(corte.id), dados: corte, criado_em: new Date().toISOString() });
    if (errEsp) return res.status(500).json({ ok: false, erro: 'falha ao gravar o corte: ' + errEsp.message });

    // 2) carimbo nas ordens de origem
    const { error: errCar } = await supabase.from('ordens_corte')
      .update({
        oficina_nome: oficina,
        oficina_corte_num: nCorte,
        oficina_corte_id: String(corte.id),
        oficina_gerada_em: new Date().toISOString(),
      })
      .in('id', ids);
    if (errCar) {
      // corte já existe no espelho; sem carimbo as ordens poderiam gerar de
      // novo — desfaz o corte pra não deixar o meio-termo perigoso
      await supabase.from('oficinas_cortes_espelho').delete().eq('corte_id', String(corte.id));
      return res.status(500).json({ ok: false, erro: 'falha ao carimbar as ordens: ' + errCar.message });
    }

    // 3) histórico por ordem
    for (const o of v.ordens) {
      await insertHistorico({
        ordem_id: o.id, acao: 'gerar_corte_oficina', user_id: usuario,
        payload_depois: { oficina, n_corte: nCorte, corte_id: String(corte.id), qtd_total: v.qtdTotal, juntou: v.ordens.length },
      }).catch(() => {});
    }

    return res.status(200).json({
      ok: true, corte_id: String(corte.id), n_corte: nCorte, oficina,
      qtd_total: v.qtdTotal, valor_total: corte.valorTotal, ordens: ids.length,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: String(e?.message || e) });
  }
}
