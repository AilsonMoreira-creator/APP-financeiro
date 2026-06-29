// ============================================================================
// _meluni-fotos — leitura da foto cacheada de uma variação (sku do Bling, que é
// o mesmo sku do carrinho Meluni). Alimentado por bling-fotos-sync.
// Usar depois no carrinho abandonado (foto da cor que ela colocou) e no
// cross-sell. Retorna sempre URL pública estável do bucket, ou null se não há
// foto cacheada (aí o disparo manda sem header de imagem). Ailson 29/06/2026.
// ============================================================================
import { supabase } from './_bling-helpers.js';

// foto de um sku específico, ou null
export async function urlFotoSku(sku) {
  if (!sku) return null;
  const { data } = await supabase.from('meluni_produto_fotos')
    .select('url_publica').eq('sku', sku).maybeSingle();
  return data?.url_publica || null;
}

// primeira foto disponível seguindo a ordem dos itens do carrinho
export async function urlFotoCarrinho(itens) {
  const skus = (Array.isArray(itens) ? itens : []).map(i => i?.sku).filter(Boolean);
  if (!skus.length) return null;
  const { data } = await supabase.from('meluni_produto_fotos')
    .select('sku, url_publica').in('sku', skus).not('url_publica', 'is', null);
  if (!data?.length) return null;
  const byKey = new Map(data.map(d => [d.sku, d.url_publica]));
  for (const s of skus) { if (byKey.has(s)) return byKey.get(s); }
  return null;
}
