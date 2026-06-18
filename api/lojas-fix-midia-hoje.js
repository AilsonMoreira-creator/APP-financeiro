// ============================================================================
// /api/lojas-fix-midia-hoje — one-shot (Ailson 18/06/2026)
// Reaplica a mídia das sugestões de HOJE com a regra nova:
//   - sugestão que FALA da promoção (30% off) -> catálogo de promoção
//   - demais (novidade etc.) -> fotos normais (re-resolvidas)
// Necessário porque eu tinha forçado o catálogo em TODAS as sugestões de hoje.
// Idempotente. Uso: GET ?force=1 (depois pode apagar este arquivo).
// ============================================================================
import { supabase, setCors } from './_lojas-helpers.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.query?.force !== '1') return res.status(403).json({ erro: 'Use ?force=1' });

  try {
    const { resolverFotosSugestoes, resolverCatalogoPromoAtivo, sugestaoFalaDePromo } =
      await import('./_lojas-fotos-helpers.js');

    const hoje = new Date().toISOString().slice(0, 10);
    const { data: sugs, error } = await supabase
      .from('lojas_sugestoes_diarias')
      .select('id, titulo, contexto, acao_sugerida, fatos, produto_ref, metadados_ia')
      .eq('data_geracao', hoje);
    if (error) return res.status(500).json({ erro: error.message });

    const catPromo = await resolverCatalogoPromoAtivo(supabase);
    let comCatalogo = 0, comFotos = 0, erros = 0;

    for (const s of (sugs || [])) {
      try {
        if (catPromo && sugestaoFalaDePromo(s)) {
          await supabase.from('lojas_sugestoes_diarias')
            .update({ catalogo: catPromo, fotos: null })
            .eq('id', s.id);
          comCatalogo++;
        } else {
          const tmp = { produto_ref: s.produto_ref, metadados_ia: s.metadados_ia, fotos: null };
          await resolverFotosSugestoes(supabase, [tmp]);
          await supabase.from('lojas_sugestoes_diarias')
            .update({ fotos: tmp.fotos || null, catalogo: null })
            .eq('id', s.id);
          comFotos++;
        }
      } catch (e) { erros++; }
    }

    return res.status(200).json({
      ok: true, data: hoje, total: (sugs || []).length,
      catalogo_promo_ativo: !!catPromo, comCatalogo, comFotos, erros,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: String(e?.message || e) });
  }
}
