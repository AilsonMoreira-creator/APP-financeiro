/**
 * bling-produtos-sync.js — Sync do catalogo Bling -> ml_sku_ref_map
 *
 * Opcao B do plano de estoque: ao inves de aprender SKU->ref so via vendas
 * (bling_vendas_detalhe -> ml_sku_ref_map), puxa direto do CATALOGO Bling
 * que ja tem MLB, SKU, ref, cor e tamanho consolidados.
 *
 * Baseado no recon (bling-produtos-recon.js): a listagem do Bling v3 ja traz
 * cada variacao como produto independente com:
 *   - codigo: SKU real
 *   - nome: "Vestido... (ref 02277) (B) Cor:FIGO;Tamanho:GG"
 *   - idProdutoPai: agrupa variacoes da mesma ref
 *
 * O parseDescricao() do _bling-helpers.js ja extrai ref/cor/tam desse formato.
 *
 * Por que so a Lumia: as 3 contas Bling compartilham o mesmo catalogo (mesma
 * ref/SKU/cor/tam). So muda titulo do anuncio em cada canal. Uma conta basta.
 *
 * Ref no Bling vem com zero a esquerda ("02277"). normRef() tira (-> "2277")
 * pra bater com o padrao usado no resto do app (ml_sku_ref_map, ml_estoque_*).
 *
 * Uso:
 *   GET  /api/bling-produtos-sync             - executa
 *   GET  /api/bling-produtos-sync?dry=1       - dry-run (nao escreve, mostra estatisticas)
 *   GET  /api/bling-produtos-sync?conta=lumia - escolhe conta (default lumia)
 *   POST /api/bling-produtos-sync             - mesmo que GET
 *
 * Tambem chamado pelo cron /api/bling-produtos-sync (diario 6h) configurado
 * no vercel.json.
 */
import { refreshBlingToken, blingFetch, parseDescricao, supabase } from './_bling-helpers.js';

export const config = { maxDuration: 300 };

const PAGE_SIZE = 100;          // limite maximo da API Bling
const MAX_PAGES = 200;          // safety cap (200 paginas x 100 = 20k variacoes)
const DELAY_MS = 350;           // 350ms entre requests = ~3 req/s (rate limit Bling)
const SAFETY_TIMEOUT_MS = 270000; // 270s — sai antes do limite de 300s do Vercel

// Mesma normRef do ml-estoque-cron.js — tira zeros a esquerda e nao-numericos
function normRef(ref) {
  return String(ref || '').replace(/\D/g, '').replace(/^0+/, '').trim();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const inicio = Date.now();
  const conta = (req.query?.conta || 'lumia').toLowerCase();
  const isDry = req.query?.dry === '1' || req.query?.dry === 'true';

  const resumo = {
    ok: false,
    fase: 'init',
    conta,
    dry_run: isDry,
    timestamp_inicio: new Date().toISOString(),
    paginas_lidas: 0,
    produtos_lidos: 0,
    com_ref_valida: 0,
    sem_ref: 0,
    sem_codigo: 0,
    skus_novos: 0,
    skus_atualizados: 0,
    skus_inalterados: 0,
    refs_unicas: 0,
    erros: 0,
    duracao_ms: 0,
    refs_amostra: [],
    sem_ref_amostra: [],
  };

  try {
    // ── FASE 1: token Lumia ────────────────────────────────────────────
    resumo.fase = 'token';
    const token = await refreshBlingToken(conta);
    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };

    // ── FASE 2: paginar /produtos coletando SKU + ref/cor/tam ─────────
    resumo.fase = 'paginar_catalogo';
    const skuMap = new Map(); // sku -> { ref, cor, tamanho, nome, idProdutoPai, idBling }
    const semRefSamples = [];

    for (let pagina = 1; pagina <= MAX_PAGES; pagina++) {
      // Safety timeout — se passar de 270s, salva o que tem e sai
      if (Date.now() - inicio > SAFETY_TIMEOUT_MS) {
        console.log(`[bling-produtos-sync] safety timeout na pagina ${pagina}, salvando parcial`);
        resumo.aviso_timeout = true;
        break;
      }

      const url = `https://api.bling.com.br/Api/v3/produtos?pagina=${pagina}&limite=${PAGE_SIZE}`;
      const r = await blingFetch(url, headers);
      if (!r.ok) {
        const errBody = await r.text().catch(() => '');
        console.error(`[bling-produtos-sync] pagina ${pagina} HTTP ${r.status}: ${errBody.slice(0, 200)}`);
        resumo.erros++;
        // 401 = token problem, abortar
        if (r.status === 401) throw new Error(`HTTP 401 — token sem permissao de Produtos`);
        // Outros: skip pagina e continua
        await new Promise(resolve => setTimeout(resolve, DELAY_MS));
        continue;
      }

      const json = await r.json();
      const produtos = json?.data || [];
      resumo.paginas_lidas++;

      if (produtos.length === 0) {
        // Fim da paginacao — Bling retornou vazio
        console.log(`[bling-produtos-sync] pagina ${pagina} vazia, fim da paginacao`);
        break;
      }

      for (const p of produtos) {
        resumo.produtos_lidos++;
        const sku = (p.codigo || '').trim();
        if (!sku) { resumo.sem_codigo++; continue; }

        const parsed = parseDescricao(p.nome || '');
        const refNorm = normRef(parsed.ref);
        if (!refNorm) {
          resumo.sem_ref++;
          if (semRefSamples.length < 5) {
            semRefSamples.push({ sku, nome: (p.nome || '').slice(0, 100) });
          }
          continue;
        }

        resumo.com_ref_valida++;
        // Se SKU duplicado entre paginas (nao deveria, mas seguro), ultima escrita vence
        skuMap.set(sku, {
          ref: refNorm,
          cor: parsed.cor || null,
          tamanho: parsed.tamanho || null,
          nome: p.nome || '',
          id_bling: p.id || null,
          id_produto_pai: p.idProdutoPai || null,
          marca: p.marca || conta,
        });
      }

      // Se veio menos que page size, e fim
      if (produtos.length < PAGE_SIZE) {
        console.log(`[bling-produtos-sync] pagina ${pagina} com ${produtos.length} itens (<${PAGE_SIZE}), fim`);
        break;
      }

      await new Promise(resolve => setTimeout(resolve, DELAY_MS));
    }

    resumo.refs_unicas = new Set(Array.from(skuMap.values()).map(v => v.ref)).size;
    resumo.sem_ref_amostra = semRefSamples;

    // Amostra de 10 SKUs mapeados pro debug
    const amostra = [];
    let i = 0;
    for (const [sku, info] of skuMap.entries()) {
      if (i++ >= 10) break;
      amostra.push({ sku, ref: info.ref, cor: info.cor, tamanho: info.tamanho });
    }
    resumo.refs_amostra = amostra;

    if (isDry) {
      resumo.fase = 'dry_run_done';
      resumo.ok = true;
      resumo.duracao_ms = Date.now() - inicio;
      resumo.timestamp_fim = new Date().toISOString();
      return res.status(200).json(resumo);
    }

    // ── FASE 3: buscar estado atual do mapa pra contar novos vs atualizados ──
    resumo.fase = 'ler_mapa_atual';
    const mapaAtual = new Map();
    let offsetMap = 0;
    while (true) {
      const { data: pageMap, error } = await supabase
        .from('ml_sku_ref_map')
        .select('sku, ref, fonte')
        .range(offsetMap, offsetMap + 999);
      if (error) { console.error('[bling-produtos-sync] ler mapa:', error.message); break; }
      if (!pageMap || pageMap.length === 0) break;
      for (const m of pageMap) mapaAtual.set(m.sku, m);
      if (pageMap.length < 1000) break;
      offsetMap += 1000;
    }

    // ── FASE 4: upsert em ml_sku_ref_map ──────────────────────────────
    resumo.fase = 'upsert';
    const agora = new Date().toISOString();
    const rows = [];
    for (const [sku, info] of skuMap.entries()) {
      const existente = mapaAtual.get(sku);
      if (!existente) {
        resumo.skus_novos++;
      } else if (existente.ref === info.ref) {
        resumo.skus_inalterados++;
      } else {
        resumo.skus_atualizados++;
      }
      rows.push({
        sku,
        ref: info.ref,
        fonte: 'bling_catalogo',
        updated_at: agora,
        // Campos opcionais — preenche se a tabela tiver as colunas (ignora se nao)
        // Nao mexemos em primeira_venda/ultima_venda/qtd_pedidos pq eles sao
        // do tracking de vendas, nao do catalogo
      });
    }

    let totalGravado = 0;
    for (let j = 0; j < rows.length; j += 500) {
      const batch = rows.slice(j, j + 500);
      const { error } = await supabase
        .from('ml_sku_ref_map')
        .upsert(batch, { onConflict: 'sku' });
      if (error) {
        console.error('[bling-produtos-sync] upsert batch:', error.message);
        resumo.erros++;
      } else {
        totalGravado += batch.length;
      }
    }
    resumo.skus_gravados = totalGravado;

    // ── FASE 4.5: salva catalogo COMPLETO (sku -> {ref, cor, tamanho}) em amicia_data ──
    // ml_sku_ref_map so guarda sku/ref. cor/tam ficam aqui pra ml-estoque-cron usar
    // como fallback quando ML nao retorna attribute_combinations (caso familia).
    resumo.fase = 'salvar_catalogo';
    const catalogoSkus = {};
    for (const [sku, info] of skuMap.entries()) {
      catalogoSkus[sku] = {
        ref: info.ref,
        cor: info.cor || null,
        tamanho: info.tamanho || null,
      };
    }
    const { error: catErr } = await supabase.from('amicia_data').upsert(
      { user_id: 'bling-catalogo-skus', payload: { skus: catalogoSkus, total: skuMap.size, _updated: agora } },
      { onConflict: 'user_id' }
    );
    if (catErr) { console.error('[bling-produtos-sync] catalogo:', catErr.message); resumo.erros++; }
    else resumo.catalogo_skus_salvos = skuMap.size;

    // ── FASE 5: salvar status ─────────────────────────────────────────
    resumo.fase = 'salvar_status';
    resumo.duracao_ms = Date.now() - inicio;
    resumo.timestamp_fim = new Date().toISOString();
    resumo.ok = true;

    const status = {
      last_run: resumo.timestamp_fim,
      duracao_s: Math.round(resumo.duracao_ms / 1000),
      conta_origem: conta,
      paginas_lidas: resumo.paginas_lidas,
      produtos_lidos: resumo.produtos_lidos,
      com_ref_valida: resumo.com_ref_valida,
      sem_ref: resumo.sem_ref,
      skus_novos: resumo.skus_novos,
      skus_atualizados: resumo.skus_atualizados,
      skus_inalterados: resumo.skus_inalterados,
      refs_unicas: resumo.refs_unicas,
      erros: resumo.erros,
    };
    await supabase.from('amicia_data').upsert(
      { user_id: 'bling-produtos-sync-status', payload: status },
      { onConflict: 'user_id' }
    );

    return res.status(200).json(resumo);

  } catch (e) {
    resumo.error = e.message;
    resumo.duracao_ms = Date.now() - inicio;
    resumo.timestamp_fim = new Date().toISOString();
    return res.status(500).json(resumo);
  }
}
