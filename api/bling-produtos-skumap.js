/**
 * bling-produtos-skumap.js — Importa SKUs do catálogo Bling pro ml_sku_ref_map
 *
 * PROBLEMA QUE RESOLVE:
 * - O cron de estoque popula ml_sku_ref_map a partir de pedidos Bling (bling_vendas_detalhe)
 * - Produto novo sem venda → não tem SKU no mapa → fica órfão no cron de estoque
 * - ML adotou padrão "1 SKU = 1 anúncio" para produtos novos, agravando o problema
 *
 * SOLUÇÃO:
 * - Listar produtos do Bling v3 (API direta, não pedidos)
 * - Extrair {sku, ref} do código + nome (regex estrita "(ref 0XXXX)" — rejeita sufixos tipo "02601kit")
 * - Fazer INSERT só de SKUs que NÃO existem no mapa (não sobrescreve dados confiáveis de pedidos)
 *
 * COMO RODAR:
 * - GET /api/bling-produtos-skumap — usa token Bling da Lumia
 * - GET /api/bling-produtos-skumap?conta=Exitus — outra conta
 * - GET /api/bling-produtos-skumap?dryRun=true — só mostra o que seria inserido
 */
import { supabase, refreshBlingToken, blingFetch } from './_bling-helpers.js';

export const config = { maxDuration: 300 };

// Extrai ref de um título/nome Bling.
// Regex ESTRITA: "(ref 02601)" sim, "(ref 02601kit)" não — sufixo alfa rejeita.
// Isso evita que kits/combos contaminem o mapa do produto principal.
function extractRefFromTitle(title) {
  if (!title) return null;
  const m = String(title).match(/\(\s*ref\.?\s*(\d{3,5})\s*\)/i);
  if (!m) return null;
  return String(m[1]).replace(/^0+/, '').trim();
}

export default async function handler(req, res) {
  const inicio = Date.now();
  const conta = String(req.query?.conta || 'lumia').toLowerCase().trim();
  const dryRun = req.query?.dryRun === 'true';

  const resumo = {
    conta,
    dryRun,
    fase: 'start',
    produtos_lidos: 0,
    produtos_sem_ref: 0,
    produtos_sem_codigo: 0,
    pares_candidatos: 0,
    ja_mapeados: 0,
    novos_inseridos: 0,
    paginas_lidas: 0,
    erros: 0,
  };

  try {
    // ── 1. Token da conta Bling ──
    resumo.fase = 'token';
    const token = await refreshBlingToken(conta);

    // ── 2. Paginação por listagem ──
    resumo.fase = 'listagem';
    const paresExtraidos = new Map(); // sku → { ref, nome }
    const PAGE_LIMIT = 100;
    let pagina = 1;

    while (true) {
      if (Date.now() - inicio > 240000) {
        console.log('[bling-produtos-skumap] safety timeout');
        resumo.fase = 'safety_timeout';
        break;
      }

      const url = `https://www.bling.com.br/Api/v3/produtos?limite=${PAGE_LIMIT}&pagina=${pagina}`;
      const resp = await blingFetch(url, {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      });

      // Debug da primeira página — captura ANTES do break pra ver erros HTTP
      if (pagina === 1) {
        resumo.primeira_pagina_status = resp.status;
        resumo.primeira_pagina_url = url;
      }

      if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        console.error(`[bling-produtos-skumap] página ${pagina} HTTP ${resp.status}: ${body.slice(0, 200)}`);
        if (pagina === 1) resumo.primeira_pagina_body = body.slice(0, 400);
        resumo.erros++;
        break;
      }

      const json = await resp.json();
      const lista = json?.data || [];

      // Debug: na primeira página, guarda amostra do que a API Bling retornou
      if (pagina === 1) {
        resumo.primeira_pagina_total_itens = lista.length;
        resumo.primeira_pagina_exemplo = lista[0] ? {
          id: lista[0].id,
          codigo: lista[0].codigo,
          nome: lista[0].nome,
          tipo: lista[0].tipo,
          situacao: lista[0].situacao,
          formato: lista[0].formato,
          keys: Object.keys(lista[0]).slice(0, 20),
        } : null;
        if (!lista[0]) {
          resumo.primeira_pagina_raw_keys = Object.keys(json || {});
          resumo.primeira_pagina_raw_sample = JSON.stringify(json).slice(0, 400);
        }
      }

      if (lista.length === 0) break;
      resumo.paginas_lidas++;

      for (const p of lista) {
        resumo.produtos_lidos++;
        const sku = String(p.codigo || '').trim();
        const nome = String(p.nome || '');
        if (!sku) { resumo.produtos_sem_codigo++; continue; }
        const ref = extractRefFromTitle(nome);
        if (!ref) { resumo.produtos_sem_ref++; continue; }
        // Conflito raro: mesmo SKU com duas refs diferentes → mantém o primeiro
        if (!paresExtraidos.has(sku)) {
          paresExtraidos.set(sku, { ref, nome });
        }
      }

      if (lista.length < PAGE_LIMIT) break;
      pagina++;
      await new Promise(r => setTimeout(r, 350)); // respeita rate limit 3 req/s
    }

    resumo.pares_candidatos = paresExtraidos.size;

    if (paresExtraidos.size === 0) {
      resumo.fase = 'done';
      return res.json({ ok: true, resumo, msg: 'Nenhum par SKU→ref extraído.' });
    }

    // ── 3. Filtra só os que NÃO existem no mapa (estratégia aditiva) ──
    resumo.fase = 'diff_mapa';
    const skus = Array.from(paresExtraidos.keys());
    const existentes = new Set();

    // Query em lotes de 500 pra evitar URL gigante
    for (let i = 0; i < skus.length; i += 500) {
      const batch = skus.slice(i, i + 500);
      const { data, error } = await supabase
        .from('ml_sku_ref_map')
        .select('sku')
        .in('sku', batch);
      if (error) {
        console.error('[bling-produtos-skumap] erro lendo mapa:', error.message);
        resumo.erros++;
        continue;
      }
      for (const row of (data || [])) existentes.add(row.sku);
    }

    resumo.ja_mapeados = existentes.size;
    const paresNovos = [];
    for (const [sku, info] of paresExtraidos) {
      if (existentes.has(sku)) continue;
      paresNovos.push({
        sku,
        ref: info.ref,
        fonte: 'bling_produtos',
        // primeira_venda / ultima_venda / qtd_pedidos ficam com defaults do schema
      });
    }

    // ── 4. Insert em lote (dry-run apenas conta) ──
    if (dryRun) {
      resumo.fase = 'dry_run_ok';
      resumo.novos_inseridos = 0;
      resumo.amostra_novos = paresNovos.slice(0, 20);
      resumo.duracao_s = ((Date.now() - inicio) / 1000).toFixed(1);
      return res.json({ ok: true, resumo, msg: `${paresNovos.length} SKUs seriam inseridos.` });
    }

    resumo.fase = 'insert';
    let inseridos = 0;
    for (let i = 0; i < paresNovos.length; i += 500) {
      const batch = paresNovos.slice(i, i + 500);
      const { error } = await supabase.from('ml_sku_ref_map').insert(batch);
      if (error) {
        console.error('[bling-produtos-skumap] erro insert:', error.message);
        resumo.erros++;
        continue;
      }
      inseridos += batch.length;
    }
    resumo.novos_inseridos = inseridos;
    resumo.fase = 'done';
    resumo.duracao_s = ((Date.now() - inicio) / 1000).toFixed(1);

    return res.json({ ok: true, resumo, msg: `${inseridos} SKUs novos inseridos no mapa.` });

  } catch (e) {
    console.error('[bling-produtos-skumap] erro fase', resumo.fase, ':', e);
    resumo.erros++;
    resumo.duracao_s = ((Date.now() - inicio) / 1000).toFixed(1);
    return res.status(500).json({ ok: false, resumo, erro: e.message });
  }
}
