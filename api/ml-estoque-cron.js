/**
 * ml-estoque-cron.js — Cron a cada 6h (Vercel Pro)
 *
 * Por quê só Lumia:
 * As 3 contas (Exitus/Lumia/Muniam) compartilham o mesmo estoque via Ideris.
 * Uma conta basta como proxy de leitura.
 *
 * Fluxo:
 * 1. Atualiza ml_sku_ref_map a partir de bling_vendas_detalhe
 *    (pra cada SKU novo em pedido, associa com a ref que vem parseada)
 * 2. Lista anúncios ativos da Lumia (paginando /users/{seller_id}/items/search)
 * 3. Multiget em batches de 20 (/items?ids=...)
 * 4. Extrai por variação: SKU (SELLER_SKU), cor (COLOR), tamanho (SIZE), qtd
 * 5. DELETE + INSERT em ml_estoque_snapshot
 * 6. JOIN snapshot × mapa SKU→ref em memória
 * 7. Agrupa por ref, aplica regra de duplicata (maior estoque vence)
 * 8. DELETE + INSERT em ml_estoque_ref_atual (só refs da Calculadora)
 * 9. Upsert em ml_estoque_total_mensal (total geral do mês corrente)
 *
 * maxDuration: 300s (Vercel Pro). Safety de 270s pra parar antes do timeout.
 */
import { supabase, getValidToken } from './_ml-helpers.js';

const ML_API = 'https://api.mercadolibre.com';
const BRAND = 'Lumia';
const DELAY_MS = 200;

export const config = { maxDuration: 300 };

// Normaliza ref pra comparação (remove zeros à esquerda e espaços)
function normRef(ref) {
  return String(ref || '').replace(/^0+/, '').trim();
}

// ── 1. ATUALIZAR MAPA SKU→REF a partir do cache do Bling ──
// Varre bling_vendas_detalhe (últimos 45 dias, que é o que o cron do Bling popula)
// Cada item tem {codigo: SKU, ref: referência parseada}
// Insere novos SKUs ou atualiza ultima_venda/qtd_pedidos
async function atualizarSkuRefMap() {
  const stats = { skus_novos: 0, skus_atualizados: 0, itens_analisados: 0, sem_sku_ou_ref: 0 };

  // Puxa todos os pedidos com itens (paginando por segurança — pode ter 15k+)
  const batchSize = 1000;
  let offset = 0;
  const skuAgregado = new Map(); // sku → { ref, primeira, ultima, qtd }

  while (true) {
    const { data: pedidos, error } = await supabase
      .from('bling_vendas_detalhe')
      .select('data_pedido, itens, created_at')
      .order('data_pedido', { ascending: false })
      .range(offset, offset + batchSize - 1);

    if (error) {
      console.error('[sku-map] erro lendo bling_vendas_detalhe:', error.message);
      break;
    }
    if (!pedidos || pedidos.length === 0) break;

    for (const p of pedidos) {
      const itens = p.itens || [];
      for (const it of itens) {
        stats.itens_analisados++;
        const sku = (it.codigo || '').trim();
        const ref = normRef(it.ref);
        if (!sku || !ref) { stats.sem_sku_ou_ref++; continue; }

        const ts = p.data_pedido || p.created_at;
        const existing = skuAgregado.get(sku);
        if (!existing) {
          skuAgregado.set(sku, { ref, primeira: ts, ultima: ts, qtd: 1 });
        } else {
          // Mantém primeira_venda como a mais antiga, ultima como a mais recente
          if (ts < existing.primeira) existing.primeira = ts;
          if (ts > existing.ultima) existing.ultima = ts;
          existing.qtd++;
          // Se houver divergência de ref (raro), última escrita vence
          if (existing.ref !== ref) existing.ref = ref;
        }
      }
    }

    if (pedidos.length < batchSize) break;
    offset += batchSize;
  }

  // Busca estado atual do mapa pra saber quem é novo
  const { data: mapExistente } = await supabase
    .from('ml_sku_ref_map')
    .select('sku, ref, qtd_pedidos');

  const mapSet = new Set((mapExistente || []).map(m => m.sku));

  // Monta lote de upsert
  const agora = new Date().toISOString();
  const rows = [];
  for (const [sku, info] of skuAgregado.entries()) {
    rows.push({
      sku,
      ref: info.ref,
      primeira_venda: info.primeira,
      ultima_venda: info.ultima,
      qtd_pedidos: info.qtd,
      fonte: 'bling_vendas',
      updated_at: agora,
    });
    if (!mapSet.has(sku)) stats.skus_novos++;
    else stats.skus_atualizados++;
  }

  // Upsert em lotes de 500
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const { error } = await supabase
      .from('ml_sku_ref_map')
      .upsert(batch, { onConflict: 'sku' });
    if (error) console.error('[sku-map] upsert erro:', error.message);
  }

  return stats;
}

// ── 2. LISTAR TODOS ANÚNCIOS ATIVOS DA LUMIA ──
async function fetchAllActiveItems(sellerId, token) {
  const ids = [];
  let offset = 0;
  const SAFETY_CAP = 5000;
  while (offset < SAFETY_CAP) {
    const r = await fetch(
      `${ML_API}/users/${sellerId}/items/search?status=active&offset=${offset}&limit=100`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!r.ok) {
      console.error(`[estoque-cron] items/search HTTP ${r.status}`);
      break;
    }
    const d = await r.json();
    const results = d.results || [];
    if (results.length === 0) break;
    ids.push(...results);
    const total = d.paging?.total || 0;
    if (ids.length >= total || results.length < 100) break;
    offset += 100;
    await new Promise(r => setTimeout(r, DELAY_MS));
  }
  return ids;
}

// ── 3. EXTRAIR COR E TAMANHO DE attribute_combinations ──
function extractColorSize(combos) {
  const result = { cor: null, tamanho: null };
  for (const a of (combos || [])) {
    if (a.id === 'COLOR' || a.id === 'MAIN_COLOR') result.cor = a.value_name || null;
    else if (a.id === 'SIZE') result.tamanho = a.value_name || null;
  }
  return result;
}

// ── 4. EXTRAIR SELLER_SKU do array de attributes ──
function extractSellerSku(attrs) {
  for (const a of (attrs || [])) {
    if (a.id === 'SELLER_SKU') return (a.value_name || '').trim() || null;
  }
  return null;
}

// ── HANDLER PRINCIPAL ──────────────────────────────────────
export default async function handler(req, res) {
  const inicio = Date.now();
  const resumo = {
    fase: 'start',
    mapa: null,
    total_anuncios: 0,
    total_variacoes: 0,
    snapshot_inseridos: 0,
    refs_ativas: 0,
    refs_resolvidas: 0,
    refs_sem_dados: 0,
    refs_com_duplicata: 0,
    skus_sem_ref: 0,
    erros: 0,
  };

  try {
    // ═══ FASE 1: atualizar mapa SKU→ref ═══
    resumo.fase = 'mapa_sku_ref';
    console.log('[estoque-cron] FASE 1: atualizando mapa SKU→ref...');
    resumo.mapa = await atualizarSkuRefMap();
    console.log(`[estoque-cron] mapa: ${resumo.mapa.skus_novos} novos, ${resumo.mapa.skus_atualizados} atualizados`);

    // ═══ FASE 2: token + seller_id Lumia ═══
    resumo.fase = 'token';
    const token = await getValidToken(BRAND);
    const { data: tokRec } = await supabase.from('ml_tokens').select('seller_id').eq('brand', BRAND).single();
    const sellerId = tokRec?.seller_id;
    if (!sellerId) throw new Error('Lumia sem seller_id em ml_tokens');

    // ═══ FASE 3: lista anúncios ativos ═══
    resumo.fase = 'lista_anuncios';
    const itemIds = await fetchAllActiveItems(sellerId, token);
    resumo.total_anuncios = itemIds.length;
    console.log(`[estoque-cron] Lumia: ${itemIds.length} anúncios ativos`);

    // ═══ FASE 4: multiget e extração ═══
    resumo.fase = 'multiget';
    const snapshotRows = [];
    const mlbInfo = {}; // { itemId: { title, variations: [{sku,cor,tam,qtd}], total } }

    for (let i = 0; i < itemIds.length; i += 20) {
      if (Date.now() - inicio > 240000) {
        console.log(`[estoque-cron] ⚠ safety timeout, parando em ${i}/${itemIds.length}`);
        break;
      }
      const batch = itemIds.slice(i, i + 20);
      const url = `${ML_API}/items?ids=${batch.join(',')}&attributes=id,title,status,available_quantity,variations,attributes`;
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) {
        console.error(`[estoque-cron] multiget HTTP ${r.status}`);
        resumo.erros++;
        await new Promise(r => setTimeout(r, DELAY_MS));
        continue;
      }
      const arr = await r.json();

      for (const entry of arr) {
        if (entry.code !== 200 || !entry.body) continue;
        const item = entry.body;
        if (item.status !== 'active') continue;

        const itemId = item.id;
        const title = item.title || '';
        const variations = item.variations || [];
        const varList = [];
        let totalEstoque = 0;

        if (variations.length > 0) {
          for (const v of variations) {
            const { cor, tamanho } = extractColorSize(v.attribute_combinations);
            const sku = extractSellerSku(v.attributes);
            const qtd = v.available_quantity || 0;
            if (!sku) continue; // sem SKU não conseguimos cruzar com ref
            snapshotRows.push({
              sku,
              item_id: itemId,
              variation_id: String(v.id || ''),
              cor,
              tamanho,
              available: qtd,
              ml_title: title,
              ml_status: 'active',
              updated_at: new Date().toISOString(),
            });
            varList.push({ sku, cor, tam: tamanho, qtd });
            totalEstoque += qtd;
          }
        } else {
          // Anúncio sem variação — SKU no nível do item
          const sku = extractSellerSku(item.attributes);
          if (sku) {
            const qtd = item.available_quantity || 0;
            snapshotRows.push({
              sku,
              item_id: itemId,
              variation_id: null,
              cor: null,
              tamanho: null,
              available: qtd,
              ml_title: title,
              ml_status: 'active',
              updated_at: new Date().toISOString(),
            });
            varList.push({ sku, cor: null, tam: null, qtd });
            totalEstoque = qtd;
          }
        }

        mlbInfo[itemId] = { title, variations: varList, total: totalEstoque };
      }

      await new Promise(r => setTimeout(r, DELAY_MS));
    }

    resumo.total_variacoes = snapshotRows.length;

    // ═══ FASE 5: reescrever ml_estoque_snapshot ═══
    resumo.fase = 'snapshot_write';
    await supabase.from('ml_estoque_snapshot').delete().neq('sku', '__nada__');
    for (let i = 0; i < snapshotRows.length; i += 500) {
      const batch = snapshotRows.slice(i, i + 500);
      const { error } = await supabase.from('ml_estoque_snapshot').upsert(batch, { onConflict: 'sku' });
      if (error) { console.error('[estoque-cron] snapshot insert:', error.message); resumo.erros++; }
      else resumo.snapshot_inseridos += batch.length;
    }

    // ═══ FASE 6: resolver ref — busca mapa + refs ativas ═══
    resumo.fase = 'resolver_ref';
    const [{ data: mapaRows }, { data: calcData }] = await Promise.all([
      supabase.from('ml_sku_ref_map').select('sku, ref'),
      supabase.from('amicia_data').select('payload').eq('user_id', 'calc-meluni').maybeSingle(),
    ]);

    const skuToRef = new Map();
    for (const m of (mapaRows || [])) skuToRef.set(m.sku, normRef(m.ref));

    const prodsCalc = calcData?.payload?.prods || [];
    const refDescMap = new Map();
    for (const p of prodsCalc) {
      const r = normRef(p.ref);
      if (r) refDescMap.set(r, p.descricao || '');
    }
    const refsAtivas = Array.from(refDescMap.keys());
    resumo.refs_ativas = refsAtivas.length;

    // Agrupa: ref → [{itemId, total, variations}]
    const mlbsPorRef = new Map();
    let skusSemRef = 0;
    for (const itemId in mlbInfo) {
      const info = mlbInfo[itemId];
      // Pra cada variação, descobre a ref via SKU. Se tiver múltiplas refs num MLB
      // (estranho, mas possível), usa a mais comum.
      const contRef = new Map();
      for (const v of info.variations) {
        const ref = skuToRef.get(v.sku);
        if (ref) contRef.set(ref, (contRef.get(ref) || 0) + 1);
        else skusSemRef++;
      }
      if (contRef.size === 0) continue;
      // Ref dominante
      let refDom = null; let maxC = 0;
      for (const [r, c] of contRef) if (c > maxC) { maxC = c; refDom = r; }
      if (!refDom) continue;
      if (!mlbsPorRef.has(refDom)) mlbsPorRef.set(refDom, []);
      mlbsPorRef.get(refDom).push({ itemId, total: info.total, variations: info.variations });
    }
    resumo.skus_sem_ref = skusSemRef;

    // Pra cada ref ativa, escolhe MLB com MAIOR estoque
    const refAtualRows = [];
    const agoraISO = new Date().toISOString();
    for (const ref of refsAtivas) {
      const candidatos = mlbsPorRef.get(ref) || [];
      if (candidatos.length === 0) {
        refAtualRows.push({
          ref,
          descricao: refDescMap.get(ref) || '',
          qtd_total: 0,
          variations: [],
          mlb_escolhido: null,
          mlbs_encontrados: [],
          alerta_duplicata: false,
          sem_dados: true,
          updated_at: agoraISO,
        });
        resumo.refs_sem_dados++;
        continue;
      }
      const escolhido = candidatos.reduce((best, c) => (c.total > best.total ? c : best), candidatos[0]);
      refAtualRows.push({
        ref,
        descricao: refDescMap.get(ref) || '',
        qtd_total: escolhido.total,
        variations: escolhido.variations,
        mlb_escolhido: escolhido.itemId,
        mlbs_encontrados: candidatos.map(c => ({ item_id: c.itemId, total: c.total })),
        alerta_duplicata: candidatos.length > 1,
        sem_dados: false,
        updated_at: agoraISO,
      });
      resumo.refs_resolvidas++;
      if (candidatos.length > 1) resumo.refs_com_duplicata++;
    }

    // ═══ FASE 7: reescrever ml_estoque_ref_atual ═══
    resumo.fase = 'ref_atual_write';
    await supabase.from('ml_estoque_ref_atual').delete().neq('ref', '__nada__');
    for (let i = 0; i < refAtualRows.length; i += 200) {
      const batch = refAtualRows.slice(i, i + 200);
      const { error } = await supabase.from('ml_estoque_ref_atual').upsert(batch, { onConflict: 'ref' });
      if (error) { console.error('[estoque-cron] ref_atual insert:', error.message); resumo.erros++; }
    }

    // ═══ FASE 8: total mensal (upsert) ═══
    resumo.fase = 'total_mensal';
    const totalGeral = refAtualRows.reduce((a, r) => a + (r.qtd_total || 0), 0);
    const refsComEstoque = refAtualRows.filter(r => !r.sem_dados).length;
    const anoMes = new Date().toISOString().slice(0, 7);
    const { error: errMensal } = await supabase.from('ml_estoque_total_mensal').upsert({
      ano_mes: anoMes,
      qtd_total: totalGeral,
      qtd_refs: refsComEstoque,
      snapshot_date: new Date().toISOString().slice(0, 10),
      updated_at: agoraISO,
    }, { onConflict: 'ano_mes' });
    if (errMensal) { console.error('[estoque-cron] total_mensal:', errMensal.message); resumo.erros++; }

    // ═══ FASE 9: salvar status pro painel ═══
    resumo.fase = 'done';
    const duracao = ((Date.now() - inicio) / 1000).toFixed(1);
    await supabase.from('amicia_data').upsert({
      user_id: 'ml-estoque-status',
      payload: {
        last_run: agoraISO,
        duracao_s: duracao,
        total_geral: totalGeral,
        resumo,
      },
    }, { onConflict: 'user_id' });

    console.log(`[estoque-cron] ✓ ${duracao}s — ${resumo.refs_resolvidas}/${resumo.refs_ativas} refs, total=${totalGeral}, ${resumo.skus_sem_ref} SKUs órfãos`);
    return res.json({ ok: true, duracao: duracao + 's', total_geral: totalGeral, ...resumo });

  } catch (e) {
    console.error('[estoque-cron] erro na fase', resumo.fase, ':', e);
    return res.status(500).json({ ok: false, fase: resumo.fase, erro: e.message, resumo });
  }
}
