/**
 * lojas-curadoria-listar.js
 *
 * Lista REFs misturadas (manual + automatico) pra tela de Curadoria.
 *
 * Sprint Ailson 04/05/2026 — visibilidade total + sistema de exclusoes.
 *
 * REGRA CORRIGIDA NESTA SPRINT:
 *   • best_seller → SO MANUAL (sem automatico)
 *   • em_alta     → manual + top 10 curva A (vw_lojas_top_vendas_loja_fisica)
 *   • novidade_manual → manual + 5-12 dias da oficina (vw_lojas_novidades_auto)
 *
 * Refs em lojas_curadoria_exclusoes nao aparecem (admin "vetou").
 * Em duplicata (manual + auto), manual ganha (mostra so 1).
 *
 * Auth: so admin.
 *
 * Query params:
 *   tipo = best_seller | em_alta | novidade_manual
 *
 * Resposta:
 *   {
 *     tipo,
 *     itens: [
 *       { ref, descricao, origem: 'manual', motivo, adicionado_em, data_fim, id_curadoria },
 *       { ref, descricao, origem: 'automatica', dias_apos_entrega, posicao, pecas_45d }
 *     ],
 *     manuais_count, auto_count
 *   }
 */
import { supabase, validarUsuario, setCors } from './_lojas-helpers.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Use GET' });

  const auth = await validarUsuario(req);
  if (!auth.ok) return res.status(auth.status || 403).json({ error: auth.error });
  if (!auth.isAdmin) return res.status(403).json({ error: 'Apenas admin' });

  const tipo = req.query.tipo || 'novidade_manual';
  if (!['best_seller', 'em_alta', 'novidade_manual', 'reposicao'].includes(tipo)) {
    return res.status(400).json({ error: 'tipo invalido' });
  }

  try {
    // ─── 1. Manuais (lojas_produtos_curadoria) ─────────────────────────
    const hoje = new Date().toISOString().slice(0, 10);
    const { data: manuais, error: errMan } = await supabase
      .from('lojas_produtos_curadoria')
      .select('id, ref, motivo, adicionado_em, data_fim')
      .eq('tipo', tipo)
      .eq('ativo', true)
      .or(`data_fim.is.null,data_fim.gte.${hoje}`);
    if (errMan) return res.status(500).json({ error: errMan.message });

    const refsManuais = new Set((manuais || []).map(m => m.ref));

    // ─── 2. Exclusoes do admin ─────────────────────────────────────────
    const { data: excluidasRaw } = await supabase
      .from('lojas_curadoria_exclusoes')
      .select('ref')
      .eq('tipo', tipo);
    const refsExcluidas = new Set((excluidasRaw || []).map(e => e.ref));

    // ─── 3. Automaticos por tipo ───────────────────────────────────────
    let automaticos = [];

    if (tipo === 'best_seller') {
      // Best-seller agora e SO manual — nao tem automatico
      automaticos = [];
    } else if (tipo === 'em_alta') {
      // Top 10 curva A
      const { data } = await supabase
        .from('vw_lojas_top_vendas_loja_fisica')
        .select('ref, posicao_ranking, pecas_45d')
        .eq('curva', 'a')
        .order('posicao_ranking', { ascending: true })
        .limit(10);
      automaticos = (data || []).map(a => ({
        ref: a.ref,
        origem: 'automatica',
        posicao: a.posicao_ranking,
        pecas_45d: a.pecas_45d,
      }));
    } else if (tipo === 'novidade_manual') {
      // 5-12 dias da oficina, ref nunca foi vendida antes (novidade real)
      const { data } = await supabase
        .from('vw_lojas_novidades_auto')
        .select('ref, data_entrega, dias_apos_entrega, qtd_entregue');
      automaticos = (data || []).map(a => ({
        ref: a.ref,
        origem: 'automatica',
        data_entrega: a.data_entrega,
        dias_apos_entrega: a.dias_apos_entrega,
        qtd_entregue: a.qtd_entregue,
      }));
    } else if (tipo === 'reposicao') {
      // 5-12 dias da oficina, ref JA FOI vendida antes (reposicao)
      // Ailson 06/05/2026: separado de novidade pra IA tratar diferente
      const { data } = await supabase
        .from('vw_lojas_reposicoes_auto')
        .select('ref, data_entrega, dias_apos_entrega, qtd_entregue');
      automaticos = (data || []).map(a => ({
        ref: a.ref,
        origem: 'automatica',
        data_entrega: a.data_entrega,
        dias_apos_entrega: a.dias_apos_entrega,
        qtd_entregue: a.qtd_entregue,
      }));
    }

    // ─── 4. Filtra: tira auto que ja eh manual + tira excluidas ────────
    const automaticosFiltrados = automaticos.filter(
      a => !refsManuais.has(a.ref) && !refsExcluidas.has(a.ref)
    );

    // ─── 5. Hidrata com descricao do produto ───────────────────────────
    // Fonte primaria: lojas_produtos (catalogo Mire)
    // Fallback: ficha tecnica (amicia_data user_id='ficha-tecnica')
    // Ailson 06/05/2026: produto pode estar so na ficha (ainda nao virou
    // SKU no Mire), ex: 3202 que entregou da oficina mas nao tem cadastro
    // no Mire.
    const todasRefs = [
      ...(manuais || []).map(m => m.ref),
      ...automaticosFiltrados.map(a => a.ref),
    ];
    let prodMap = new Map();
    if (todasRefs.length > 0) {
      const { data: produtos } = await supabase
        .from('lojas_produtos')
        .select('ref, descricao, categoria, qtd_estoque')
        .in('ref', todasRefs);
      prodMap = new Map((produtos || []).map(p => [p.ref, p]));

      // Fallback: pra refs que nao acharam em lojas_produtos, busca em
      // amicia_data.payload.fichas[]
      const refsFaltando = todasRefs.filter(r => !prodMap.has(r));
      if (refsFaltando.length > 0) {
        const { data: ftRow } = await supabase
          .from('amicia_data')
          .select('payload')
          .eq('user_id', 'ficha-tecnica')
          .maybeSingle();
        const fichas = ftRow?.payload?.fichas || [];
        const setFaltando = new Set(refsFaltando.map(r => String(r).replace(/^0+/, '') || '0'));
        for (const f of fichas) {
          const refNorm = String(f.ref || '').replace(/^0+/, '') || '0';
          if (setFaltando.has(refNorm) && !prodMap.has(refNorm)) {
            prodMap.set(refNorm, {
              ref: refNorm,
              descricao: f.descricao || '',
              categoria: f.categoria || null,
              qtd_estoque: 0, // ficha tecnica nao tem estoque
            });
          }
        }
      }
    }

    // ─── 6. Resposta unificada ─────────────────────────────────────────
    const itens = [
      ...(manuais || []).map(m => ({
        ref: m.ref,
        descricao: prodMap.get(m.ref)?.descricao || '(produto não encontrado no catálogo)',
        categoria: prodMap.get(m.ref)?.categoria || null,
        qtd_estoque: prodMap.get(m.ref)?.qtd_estoque || 0,
        origem: 'manual',
        motivo: m.motivo,
        adicionado_em: m.adicionado_em,
        data_fim: m.data_fim,
        id_curadoria: m.id,
      })),
      ...automaticosFiltrados.map(a => ({
        ref: a.ref,
        descricao: prodMap.get(a.ref)?.descricao || '(produto não encontrado no catálogo)',
        categoria: prodMap.get(a.ref)?.categoria || null,
        qtd_estoque: prodMap.get(a.ref)?.qtd_estoque || 0,
        origem: 'automatica',
        // Campos contextuais por tipo:
        ...(a.dias_apos_entrega !== undefined && {
          dias_apos_entrega: a.dias_apos_entrega,
          data_entrega: a.data_entrega,
        }),
        ...(a.posicao !== undefined && {
          posicao: a.posicao,
          pecas_45d: a.pecas_45d,
        }),
      })),
    ];

    return res.json({
      tipo,
      itens,
      manuais_count: manuais?.length || 0,
      auto_count: automaticosFiltrados.length,
      excluidas_count: refsExcluidas.size,
    });
  } catch (e) {
    console.error('[lojas-curadoria-listar] erro:', e?.message);
    return res.status(500).json({ error: e?.message || 'Erro' });
  }
}
