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

// Normaliza ref pra comparação:
// - remove zeros à esquerda
// - remove espaços e caracteres não-numéricos internos
// Ex: "02 897" → "2897", "ref. 2410" → "2410"
function normRef(ref) {
  return String(ref || '').replace(/\D/g, '').replace(/^0+/, '').trim();
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

// ── 5. EXTRAIR REF DO seller_custom_field ──
// Hierarquia:
//   1. Se scfMap tem esse scf exato, usa o ref do mapa (caminho principal — 95%)
//   2. Se scf tem padrão "xxx(02277)", extrai os dígitos entre parênteses
//   3. Se scf é só dígitos (ex: "02277"), usa direto
//   4. null caso contrário
function extractRefFromCustomField(scf, scfMap) {
  if (!scf) return null;
  const scfTrim = String(scf).trim();
  // Caminho 1: match direto no mapa (produto-pai Ideris)
  if (scfMap && scfMap.has(scfTrim)) return scfMap.get(scfTrim);
  // Caminho 2: regex parênteses "(02277)"
  const m = scfTrim.match(/\((\d{3,5})\)/);
  if (m) return normRef(m[1]);
  // Caminho 3: campo inteiro é só a ref (ex: "02277")
  const m2 = scfTrim.match(/^\s*0*(\d{3,5})\s*$/);
  if (m2) return normRef(m2[1]);
  return null;
}

// ── 5b. EXTRAIR REF DO TÍTULO DO ANÚNCIO ──
// Fallback pra anúncios novos sem venda (não entram no mapa SKU→ref)
// cujo SCF também não está mapeado.
// Padrões típicos do título espelhado do Ideris:
//   "Camisa De Tricoline Estruturada Com Design Moderno (03186)"
//   "Vestido Plus Size Verona (ref 02934)"
//   "Vestido Midi De Couro (ref 02927) Lumia/Exitus/Muniam"
// Tenta em ordem: (ref XXXX) → (XXXX) → "ref XXXX"
function extractRefFromTitle(title) {
  if (!title) return null;
  const t = String(title);
  // Caminho A: "(ref 02934)" — mais confiável, marcação explícita
  const mRef = t.match(/\(\s*ref\.?\s*(\d{3,5})\s*\)/i);
  if (mRef) return normRef(mRef[1]);
  // Caminho B: "(03186)" — dígitos sozinhos entre parênteses
  const mPar = t.match(/\((\d{3,5})\)/);
  if (mPar) return normRef(mPar[1]);
  // Caminho C: "ref 02934" fora de parênteses
  const mRefSolto = t.match(/(?:^|[\s,;])ref\.?\s*(\d{3,5})(?:[\s,;.]|$)/i);
  if (mRefSolto) return normRef(mRefSolto[1]);
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

    // ═══ FASE 3.5: carregar mapa SCF→REF (código-pai Ideris → ref interna) ═══
    // É o caminho principal pra resolver anúncios antigos (95% da Lumia).
    // Populado manualmente via /api/ml-estoque-import-scf
    resumo.fase = 'carregar_scf_map';
    const scfToRef = new Map();
    let scfPage = 0;
    while (true) {
      const { data: page } = await supabase
        .from('ml_scf_ref_map')
        .select('scf, ref')
        .range(scfPage, scfPage + 999);
      if (!page || page.length === 0) break;
      for (const row of page) scfToRef.set(row.scf.trim(), normRef(row.ref));
      if (page.length < 1000) break;
      scfPage += 1000;
    }
    resumo.scf_map_carregado = scfToRef.size;
    console.log(`[estoque-cron] scf map: ${scfToRef.size} entries`);

    // ═══ FASE 4: multiget e extração ═══
    resumo.fase = 'multiget';
    const snapshotRows = [];
    // mlbInfo agora tem opcional refDireta (quando ref veio do seller_custom_field)
    const mlbInfo = {};
    let multigetOk = 0;
    let multigetSkippedNaoAtivo = 0;
    let multigetErroCode = 0;
    let anunciosSemSkuEmNenhumaVar = 0;
    let anunciosComRefDireta = 0;  // NOVO: anúncios cuja ref veio do custom_field
    let anunciosRefViaTitle = 0;   // NOVO: anúncios cuja ref veio do título (fallback)

    for (let i = 0; i < itemIds.length; i += 20) {
      if (Date.now() - inicio > 240000) {
        console.log(`[estoque-cron] ⚠ safety timeout, parando em ${i}/${itemIds.length}`);
        break;
      }
      const batch = itemIds.slice(i, i + 20);
      const url = `${ML_API}/items?ids=${batch.join(',')}&attributes=id,title,status,available_quantity,variations,attributes,seller_custom_field`;
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) {
        console.error(`[estoque-cron] multiget HTTP ${r.status}`);
        resumo.erros++;
        await new Promise(r => setTimeout(r, DELAY_MS));
        continue;
      }
      const arr = await r.json();

      for (const entry of arr) {
        if (entry.code !== 200 || !entry.body) { multigetErroCode++; continue; }
        const item = entry.body;
        if (item.status !== 'active') { multigetSkippedNaoAtivo++; continue; }
        multigetOk++;

        const itemId = item.id;
        const title = item.title || '';
        const sellerField = item.seller_custom_field || '';
        const variations = item.variations || [];
        const varList = [];
        let totalEstoque = 0;

        // Tenta extrair ref DIRETO do seller_custom_field (caminho principal)
        // Hierarquia: scfToRef (manual) > regex "(02277)" > regex só dígitos
        let refDireta = extractRefFromCustomField(sellerField, scfToRef);
        let refDiretaFonte = refDireta ? 'scf' : null;
        // Fallback: extrai do título do anúncio (resolve produtos novos sem venda)
        if (!refDireta) {
          const refTitle = extractRefFromTitle(title);
          if (refTitle) { refDireta = refTitle; refDiretaFonte = 'title'; }
        }

        if (variations.length > 0) {
          for (const v of variations) {
            const { cor, tamanho } = extractColorSize(v.attribute_combinations);
            const skuReal = extractSellerSku(v.attributes);
            const qtd = v.available_quantity || 0;

            if (skuReal) {
              // Caminho 1: tem SELLER_SKU — snapshot com SKU real (chave pra mapa)
              snapshotRows.push({
                sku: skuReal,
                item_id: itemId,
                variation_id: String(v.id || ''),
                cor, tamanho,
                available: qtd,
                ml_title: title,
                ml_status: 'active',
                updated_at: new Date().toISOString(),
              });
              varList.push({ sku: skuReal, cor, tam: tamanho, qtd });
            } else if (refDireta) {
              // Caminho 2: sem SKU mas ref veio do custom_field — salva com SKU sintético
              // SKU sintético = item_id + variation_id (único, não conflita com SKUs reais)
              const skuSint = `_SINT_${itemId}_${v.id}`;
              snapshotRows.push({
                sku: skuSint,
                item_id: itemId,
                variation_id: String(v.id || ''),
                cor, tamanho,
                available: qtd,
                ml_title: title,
                ml_status: 'active',
                updated_at: new Date().toISOString(),
              });
              varList.push({ sku: skuSint, cor, tam: tamanho, qtd });
            } else {
              // Sem SKU e sem ref — não dá pra rastrear, pula essa variação
              continue;
            }
            totalEstoque += qtd;
          }
        } else {
          // Anúncio sem variação
          const skuReal = extractSellerSku(item.attributes) || sellerField;
          const qtd = item.available_quantity || 0;
          if (skuReal) {
            snapshotRows.push({
              sku: skuReal,
              item_id: itemId,
              variation_id: null,
              cor: null, tamanho: null,
              available: qtd,
              ml_title: title,
              ml_status: 'active',
              updated_at: new Date().toISOString(),
            });
            varList.push({ sku: skuReal, cor: null, tam: null, qtd });
            totalEstoque = qtd;
          }
        }

        if (refDireta) anunciosComRefDireta++;
        if (refDiretaFonte === 'title') anunciosRefViaTitle++;

        mlbInfo[itemId] = { title, variations: varList, total: totalEstoque, refDireta, refDiretaFonte };
        if (varList.length === 0) anunciosSemSkuEmNenhumaVar++;
      }

      await new Promise(r => setTimeout(r, DELAY_MS));
    }

    resumo.total_variacoes = snapshotRows.length;
    resumo.multiget_ok = multigetOk;
    resumo.multiget_nao_ativo = multigetSkippedNaoAtivo;
    resumo.multiget_erro_code = multigetErroCode;
    resumo.anuncios_sem_sku = anunciosSemSkuEmNenhumaVar;
    resumo.anuncios_com_ref_direta = anunciosComRefDireta;
    resumo.anuncios_ref_via_title = anunciosRefViaTitle;

    // ═══ FASE 5: reescrever ml_estoque_snapshot ═══
    resumo.fase = 'snapshot_write';

    // DEDUP por SKU: mesmo SKU pode estar em vários MLBs (duplicata de anúncio).
    // Mantemos a linha com maior available (regra consistente com a de ref_atual).
    // Sem isso, upsert falha com "ON CONFLICT DO UPDATE command cannot affect row a second time"
    const skuDedup = new Map();
    let dupsEncontradas = 0;
    for (const row of snapshotRows) {
      const existing = skuDedup.get(row.sku);
      if (!existing) {
        skuDedup.set(row.sku, row);
      } else {
        dupsEncontradas++;
        if ((row.available || 0) > (existing.available || 0)) {
          skuDedup.set(row.sku, row);
        }
      }
    }
    const snapshotDedup = Array.from(skuDedup.values());
    resumo.skus_duplicados_no_ml = dupsEncontradas;

    await supabase.from('ml_estoque_snapshot').delete().neq('sku', '__nada__');
    for (let i = 0; i < snapshotDedup.length; i += 500) {
      const batch = snapshotDedup.slice(i, i + 500);
      const { error } = await supabase.from('ml_estoque_snapshot').upsert(batch, { onConflict: 'sku' });
      if (error) { console.error('[estoque-cron] snapshot insert:', error.message); resumo.erros++; }
      else resumo.snapshot_inseridos += batch.length;
    }

    // ═══ FASE 6: resolver ref — busca mapa + refs ativas ═══
    resumo.fase = 'resolver_ref';

    // IMPORTANTE: Supabase limita select em 1000 linhas por padrão.
    // Paginamos pra pegar o mapa inteiro (pode ter milhares de SKUs).
    const skuToRef = new Map();
    let offsetMap = 0;
    const PAGE = 1000;
    while (true) {
      const { data: mapaPage, error: mapaErr } = await supabase
        .from('ml_sku_ref_map')
        .select('sku, ref')
        .range(offsetMap, offsetMap + PAGE - 1);
      if (mapaErr) { console.error('[estoque-cron] mapa paginação:', mapaErr.message); break; }
      if (!mapaPage || mapaPage.length === 0) break;
      for (const m of mapaPage) {
        // normRef também remove espaços internos: "2 897" → "2897"
        skuToRef.set(m.sku, normRef(m.ref));
      }
      if (mapaPage.length < PAGE) break;
      offsetMap += PAGE;
    }
    resumo.mapa_carregado = skuToRef.size;

    const { data: calcData } = await supabase.from('amicia_data')
      .select('payload').eq('user_id', 'calc-meluni').maybeSingle();
    const prodsCalc = calcData?.payload?.prods || [];
    const refDescMap = new Map();
    for (const p of prodsCalc) {
      const r = normRef(p.ref);
      if (r) refDescMap.set(r, p.descricao || '');
    }
    const refsAtivas = Array.from(refDescMap.keys());
    resumo.refs_ativas = refsAtivas.length;

    // Agrupa: ref → [{itemId, total, variations}]
    // Hierarquia de resolução:
    //   1. refDireta (vem do seller_custom_field em formato "xxx(02277)")
    //   2. Via SKU no mapa ml_sku_ref_map (se variações têm SELLER_SKU real)
    const mlbsPorRef = new Map();
    let skusSemRef = 0;
    let mlbsResolvidosPorRefDireta = 0;
    let mlbsResolvidosPorMapa = 0;
    for (const itemId in mlbInfo) {
      const info = mlbInfo[itemId];

      // Prioridade 1: refDireta
      if (info.refDireta) {
        const refDom = info.refDireta;
        if (!mlbsPorRef.has(refDom)) mlbsPorRef.set(refDom, []);
        mlbsPorRef.get(refDom).push({ itemId, total: info.total, variations: info.variations, via: 'custom_field' });
        mlbsResolvidosPorRefDireta++;
        continue;
      }

      // Prioridade 2: via SKUs reais no mapa
      const contRef = new Map();
      for (const v of info.variations) {
        // Ignora SKUs sintéticos (não estão no mapa)
        if (v.sku && v.sku.startsWith('_SINT_')) continue;
        const ref = skuToRef.get(v.sku);
        if (ref) contRef.set(ref, (contRef.get(ref) || 0) + 1);
        else skusSemRef++;
      }
      if (contRef.size === 0) continue;
      // Ref dominante (mais comum entre as variações)
      let refDom = null; let maxC = 0;
      for (const [r, c] of contRef) if (c > maxC) { maxC = c; refDom = r; }
      if (!refDom) continue;
      if (!mlbsPorRef.has(refDom)) mlbsPorRef.set(refDom, []);
      mlbsPorRef.get(refDom).push({ itemId, total: info.total, variations: info.variations, via: 'mapa_sku' });
      mlbsResolvidosPorMapa++;
    }
    resumo.skus_sem_ref = skusSemRef;
    resumo.mlbs_resolvidos_por_ref_direta = mlbsResolvidosPorRefDireta;
    resumo.mlbs_resolvidos_por_mapa = mlbsResolvidosPorMapa;

    // Pra cada ref ativa: consolida variações de TODOS os MLBs da ref.
    // Regra de dedupe por SKU:
    //   - SKU real (mesmo SKU em 2+ MLBs) = espelho Ideris → pega o MAIOR (não soma)
    //   - SKU sintético (_SINT_ = item_id + variation_id, único por anúncio) → soma natural
    // Isso resolve o bug das DUPs: antes pegava só o MLB maior e perdia variações dos outros.
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

      // Consolida: chave efetiva → melhor entrada (maior qtd se repetido)
      // - SKU real → chave = SKU (espelho Ideris se mesmo SKU em 2 MLBs)
      // - SKU sintético (_SINT_MLB_varId) → chave = cor+tam (porque sintético é único
      //   por MLB, mas variação física é o mesmo par cor+tam entre MLBs espelho)
      // Isso evita que anúncios antigos sem SELLER_SKU tenham estoque dobrado quando
      // existem múltiplos MLBs da mesma ref (refs 2782, 2798, 2773 reportadas dobrando).
      const skuMap = new Map();
      for (const c of candidatos) {
        for (const v of (c.variations || [])) {
          if (!v.sku) continue;
          const isSint = String(v.sku).startsWith('_SINT_');
          const chave = isSint
            ? `__cortam__${v.cor || ''}__${v.tam || ''}`
            : v.sku;
          const existing = skuMap.get(chave);
          if (!existing || (v.qtd || 0) > (existing.qtd || 0)) {
            skuMap.set(chave, { ...v, _source_mlb: c.itemId });
          }
        }
      }
      const variacoesConsolidadas = Array.from(skuMap.values()).map(({ _source_mlb, ...rest }) => rest);
      const totalConsolidado = variacoesConsolidadas.reduce((a, v) => a + (v.qtd || 0), 0);

      // MLB "dominante" (só pra referência visual) = o que contribuiu com mais variações únicas
      const contribPorMlb = new Map();
      for (const v of skuMap.values()) {
        contribPorMlb.set(v._source_mlb, (contribPorMlb.get(v._source_mlb) || 0) + 1);
      }
      let mlbDominante = candidatos[0].itemId;
      let maxContrib = 0;
      for (const [mlb, c] of contribPorMlb) {
        if (c > maxContrib) { maxContrib = c; mlbDominante = mlb; }
      }

      refAtualRows.push({
        ref,
        descricao: refDescMap.get(ref) || '',
        qtd_total: totalConsolidado,
        variations: variacoesConsolidadas,
        mlb_escolhido: mlbDominante,
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
