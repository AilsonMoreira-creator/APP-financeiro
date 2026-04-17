/**
 * ml-estoque-debug.js — Endpoint de diagnóstico temporário
 *
 * GET /api/ml-estoque-debug
 *   → retorna amostras dos dados pra entender por quê os joins não estão funcionando
 *   → NÃO é usado em produção. Apagar depois do diagnóstico.
 */
import { supabase, getValidToken } from './_ml-helpers.js';

const ML_API = 'https://api.mercadolibre.com';

export default async function handler(req, res) {
  try {
    // ── 1. Amostra do snapshot atual ──
    const { data: snapshot } = await supabase.from('ml_estoque_snapshot')
      .select('*').limit(10);

    // ── 2. Amostra do mapa SKU→ref ──
    const { data: mapa } = await supabase.from('ml_sku_ref_map')
      .select('sku, ref, fonte, qtd_pedidos').limit(10);

    // ── 3. Total de linhas em cada tabela ──
    const { count: snapCount } = await supabase.from('ml_estoque_snapshot')
      .select('sku', { count: 'exact', head: true });
    const { count: mapCount } = await supabase.from('ml_sku_ref_map')
      .select('sku', { count: 'exact', head: true });

    // ── 4. Checar se algum SKU do snapshot existe no mapa ──
    const skusDoSnapshot = (snapshot || []).map(s => s.sku);
    const { data: matches } = skusDoSnapshot.length > 0
      ? await supabase.from('ml_sku_ref_map').select('sku, ref').in('sku', skusDoSnapshot)
      : { data: [] };

    // ── 5. Buscar um anúncio "cru" da Lumia pra ver o formato real dos SKUs ──
    let anuncioRaw = null;
    let anuncioSemVarRaw = null;
    try {
      const token = await getValidToken('Lumia');
      const { data: tokRec } = await supabase.from('ml_tokens').select('seller_id').eq('brand', 'Lumia').single();
      const sellerId = tokRec?.seller_id;

      // Pega 1º anúncio ativo
      const sr = await fetch(
        `${ML_API}/users/${sellerId}/items/search?status=active&offset=0&limit=5`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const srData = await sr.json();
      const ids = (srData.results || []).slice(0, 5);

      if (ids.length > 0) {
        const multi = await fetch(
          `${ML_API}/items?ids=${ids.join(',')}&attributes=id,title,status,available_quantity,variations,attributes,seller_custom_field`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const arr = await multi.json();

        // Busca 1 com variação e 1 sem variação pra amostra
        for (const entry of arr) {
          if (entry.code === 200 && entry.body) {
            const item = entry.body;
            if (item.variations && item.variations.length > 0 && !anuncioRaw) {
              anuncioRaw = {
                id: item.id,
                title: item.title,
                status: item.status,
                seller_custom_field: item.seller_custom_field,
                item_attributes_sample: (item.attributes || []).filter(a =>
                  ['SELLER_SKU', 'GTIN'].includes(a.id)
                ).slice(0, 5),
                variation_count: item.variations.length,
                primeira_variacao: {
                  id: item.variations[0].id,
                  available_quantity: item.variations[0].available_quantity,
                  attribute_combinations: item.variations[0].attribute_combinations,
                  attributes: item.variations[0].attributes,  // aqui que deveria ter SELLER_SKU
                },
              };
            }
            if ((!item.variations || item.variations.length === 0) && !anuncioSemVarRaw) {
              anuncioSemVarRaw = {
                id: item.id,
                title: item.title,
                status: item.status,
                seller_custom_field: item.seller_custom_field,
                available_quantity: item.available_quantity,
                item_attributes: item.attributes,  // lista inteira pra procurar SKU
              };
            }
          }
        }
      }
    } catch (e) {
      anuncioRaw = { erro_busca: e.message };
    }

    // ── 6. Diagnóstico crítico: refs da Calculadora vs. refs encontradas no mapa ──
    //    Ref que o mapa tem mas Calculadora não, NÃO aparece no ml_estoque_ref_atual
    function normRef(r) { return String(r || '').replace(/\D/g, '').replace(/^0+/, '').trim(); }

    const { data: calcData } = await supabase.from('amicia_data')
      .select('payload').eq('user_id', 'calc-meluni').maybeSingle();
    const prodsCalc = calcData?.payload?.prods || [];
    const refsCalculadora = prodsCalc.map(p => normRef(p.ref)).filter(Boolean);

    // Pega TODAS as refs distintas do mapa (pra saber o que o Bling conhece)
    const refsDoMapaSet = new Set();
    let off = 0;
    while (true) {
      const { data } = await supabase.from('ml_sku_ref_map').select('ref').range(off, off + 999);
      if (!data || data.length === 0) break;
      for (const r of data) refsDoMapaSet.add(normRef(r.ref));
      if (data.length < 1000) break;
      off += 1000;
    }
    const refsDoMapa = Array.from(refsDoMapaSet).sort();

    // Simula resolução: pegar TODAS as refs que o snapshot conseguiria resolver
    const { data: snapshotTodo } = await supabase.from('ml_estoque_snapshot').select('sku');
    const skusNoSnapshot = new Set((snapshotTodo || []).map(s => s.sku));

    const { data: mapaTodo } = await supabase.from('ml_sku_ref_map').select('sku, ref').range(0, 9999);
    const refsResolvidasSnapshot = new Set();
    for (const m of (mapaTodo || [])) {
      if (skusNoSnapshot.has(m.sku)) refsResolvidasSnapshot.add(normRef(m.ref));
    }

    const calcSet = new Set(refsCalculadora);
    const refsResolvidasNaCalc = [];
    const refsResolvidasForaCalc = [];
    for (const r of refsResolvidasSnapshot) {
      if (calcSet.has(r)) refsResolvidasNaCalc.push(r);
      else refsResolvidasForaCalc.push(r);
    }
    const calcSemDadosSet = [];
    for (const r of refsCalculadora) {
      if (!refsResolvidasSnapshot.has(r)) calcSemDadosSet.push(r);
    }

    // ── 8. Verificação final: ref 2782 (da Calculadora, sem dados) está em algum pedido Bling? ──
    // Pega 3 refs da Calc sem dados e procura em qualquer pedido do Bling
    const refsTest = calcSemDadosSet.slice(0, 5);
    const refsEncontradasEmPedidos = {};
    for (const refTest of refsTest) {
      const { data: samples } = await supabase
        .from('bling_vendas_detalhe')
        .select('pedido_id, data_pedido, itens')
        .limit(500);
      let encontrou = [];
      for (const p of (samples || [])) {
        for (const it of (p.itens || [])) {
          if (normRef(it.ref) === refTest) {
            encontrou.push({ pedido: p.pedido_id, data: p.data_pedido, codigo: it.codigo, ref_original: it.ref });
            if (encontrou.length >= 3) break;
          }
        }
        if (encontrou.length >= 3) break;
      }
      refsEncontradasEmPedidos[refTest] = encontrou;
    }

    // Também: pega 3 refs do mapa (que bateram com Calc) e mostra
    const refsOk = refsResolvidasNaCalc.slice(0, 3);
    const skusDasRefsOk = {};
    for (const refOk of refsOk) {
      const { data } = await supabase.from('ml_sku_ref_map').select('sku, ref, ultima_venda').eq('ref', refOk).limit(5);
      skusDasRefsOk[refOk] = data;
    }

    // ── 9. Diagnóstico ULTRA específico pra ref 02277/2277 ──
    // Pergunta: quantos pedidos do Bling têm essa ref? Os itens têm código?
    //          Os códigos batem com os SKUs do ML Lumia?
    const { data: pedidosComRef } = await supabase
      .from('bling_vendas_detalhe')
      .select('pedido_id, data_pedido, conta, itens')
      .limit(2000);

    let pedidosTotal = pedidosComRef?.length || 0;
    let itensTotal = 0;
    let itensDa2277 = 0;
    let itensDa2277SemCodigo = 0;
    let itensDa2277ComCodigo = 0;
    const codigosUnicos2277 = new Map(); // codigo → qtdVezes
    const refOriginaisVariantes = new Map(); // ref parseada → qtdVezes

    for (const p of (pedidosComRef || [])) {
      for (const it of (p.itens || [])) {
        itensTotal++;
        const refN = normRef(it.ref);
        if (refN === '2277') {
          itensDa2277++;
          refOriginaisVariantes.set(it.ref || '(vazio)', (refOriginaisVariantes.get(it.ref || '(vazio)') || 0) + 1);
          if (!it.codigo || !it.codigo.trim()) {
            itensDa2277SemCodigo++;
          } else {
            itensDa2277ComCodigo++;
            codigosUnicos2277.set(it.codigo, (codigosUnicos2277.get(it.codigo) || 0) + 1);
          }
        }
      }
    }

    // Verificar se esses códigos existem no snapshot ML
    const codigosList = Array.from(codigosUnicos2277.keys());
    const { data: matchesML } = codigosList.length > 0
      ? await supabase.from('ml_estoque_snapshot').select('sku, item_id, ml_title, available').in('sku', codigosList)
      : { data: [] };

    // Ver se Lumia tem um anúncio com "02277" ou "2277" no título
    let anunciosComRef2277 = [];
    try {
      const token = await getValidToken('Lumia');
      const { data: tokRec } = await supabase.from('ml_tokens').select('seller_id').eq('brand', 'Lumia').single();
      const sellerId = tokRec?.seller_id;
      // Busca com filtro por texto
      const sr = await fetch(
        `${ML_API}/users/${sellerId}/items/search?q=02277&status=active&limit=10`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const srData = await sr.json();
      const ids = srData.results || [];
      if (ids.length > 0) {
        const multi = await fetch(
          `${ML_API}/items?ids=${ids.slice(0, 5).join(',')}&attributes=id,title,status,variations,seller_custom_field`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const arr = await multi.json();
        for (const entry of arr) {
          if (entry.code === 200 && entry.body) {
            const item = entry.body;
            const firstVar = (item.variations || [])[0];
            const firstSku = firstVar ? (firstVar.attributes || []).find(a => a.id === 'SELLER_SKU')?.value_name : null;
            anunciosComRef2277.push({
              mlb: item.id,
              title: item.title,
              status: item.status,
              seller_custom_field: item.seller_custom_field,
              qtd_variacoes: (item.variations || []).length,
              primeiro_sku: firstSku,
              primeiros_3_skus: (item.variations || []).slice(0, 3).map(v => (v.attributes || []).find(a => a.id === 'SELLER_SKU')?.value_name),
            });
          }
        }
      }
    } catch (e) {
      anunciosComRef2277 = [{ erro: e.message }];
    }

    // ── 7. Retorna ──
    return res.json({
      ok: true,
      totais: {
        snapshot_linhas: snapCount,
        mapa_linhas: mapCount,
      },
      snapshot_amostra: snapshot,
      mapa_amostra: mapa,
      intersecao_snapshot_x_mapa: {
        skus_snapshot_testados: skusDoSnapshot,
        encontrados_no_mapa: matches,
        qtd_encontrados: matches?.length || 0,
      },
      DIAGNOSTICO_REFS: {
        qtd_refs_calculadora: refsCalculadora.length,
        qtd_refs_unicas_no_mapa: refsDoMapa.length,
        qtd_refs_que_snapshot_resolveria: refsResolvidasSnapshot.size,
        qtd_resolvidas_que_estao_na_calc: refsResolvidasNaCalc.length,
        qtd_resolvidas_QUE_NAO_ESTAO_na_calc: refsResolvidasForaCalc.length,
        qtd_calc_SEM_dados_no_snapshot: calcSemDadosSet.length,

        refs_calculadora_sample: refsCalculadora.slice(0, 50),
        refs_resolvidas_DENTRO_calc: refsResolvidasNaCalc.sort(),
        refs_resolvidas_FORA_calc_amostra: refsResolvidasForaCalc.slice(0, 30),
        refs_calc_SEM_dados_amostra: calcSemDadosSet.slice(0, 30),
      },
      VERIFICACAO_BLING: {
        comentario: "Procurando 5 refs da Calculadora sem dados em qualquer pedido Bling (500 mais recentes)",
        refs_testadas: refsEncontradasEmPedidos,
      },
      VERIFICACAO_MAPA_OK: {
        comentario: "Mostrando SKUs das refs que bateram com Calculadora",
        refs_ok: skusDasRefsOk,
      },
      AUTOPSIA_REF_2277: {
        pedidos_bling_analisados: pedidosTotal,
        itens_total_analisados: itensTotal,
        itens_da_2277: itensDa2277,
        itens_da_2277_sem_codigo: itensDa2277SemCodigo,
        itens_da_2277_com_codigo: itensDa2277ComCodigo,
        formatos_ref_encontrados: Object.fromEntries(refOriginaisVariantes),
        codigos_distintos: codigosUnicos2277.size,
        amostra_codigos: Array.from(codigosUnicos2277.entries()).slice(0, 10).map(([c, q]) => ({ codigo: c, apareceu_vezes: q })),
        esses_codigos_existem_no_ml_snapshot: matchesML || [],
      },
      ANUNCIOS_LUMIA_COM_02277: anunciosComRef2277,
      anuncio_com_variacao: anuncioRaw,
      anuncio_sem_variacao: anuncioSemVarRaw,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: e.message });
  }
}
