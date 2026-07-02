// ============================================================================
// bling-fotos-sync — baixa a foto EM TAMANHO CHEIO de cada variação do Bling e
// re-hospeda no bucket sofia-midias (URL pública estável), gravando o ponteiro
// em meluni_produto_fotos (chave = sku, o mesmo do carrinho Meluni).
// ----------------------------------------------------------------------------
// v2 (Ailson 02/07/2026): a listagem /produtos só dá imagemURL MINIATURA
// (~1.5KB) — não serve pra header de HSM. Agora cada produto que precisa de
// foto ganha um GET /produtos/{id} e usamos midia.imagens.internas[0].link
// (fallback externas[0], fallback pai da variação). 1 req por produto, com
// pacing de 350ms (rate limit Bling ~3/s), então roda em LOTES com cursor:
//   /api/bling-fotos-sync?run=1                        -> lote a partir do início
//   /api/bling-fotos-sync?run=1&pagina=4&offset=37     -> retoma do cursor
//   /api/bling-fotos-sync?run=1&lote=30                -> nº de downloads por chamada
//   /api/bling-fotos-sync?run=1&force=1                -> re-baixa tudo
//   /api/bling-fotos-sync?dry=1                        -> simula
// Resposta traz {proxima:{pagina,offset}} pra encadear até fim=true.
// Idempotente: bling_img_key = pathname da imagem cheia; só re-baixa se mudou.
// NÃO tem cron: roda sob demanda. Ailson 29/06/2026, full-size 02/07/2026.
// ============================================================================
import { supabase, refreshBlingToken, blingFetch, parseDescricao } from './_bling-helpers.js';

export const config = { maxDuration: 60 };
const API = 'https://api.bling.com.br/Api/v3';
const BUCKET = 'sofia-midias';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// caminho-base da imagem (sem querystring assinada) -> muda quando a foto troca
const imgKey = (url) => { try { return new URL(url).pathname; } catch { return null; } };

// cursor persistido em meluni_config (retomada automática entre chamadas)
async function cfg(chave) {
  const { data } = await supabase.from('meluni_config').select('valor').eq('chave', chave).maybeSingle();
  return data?.valor ?? null;
}
async function cfgSet(chave, valor) {
  await supabase.from('meluni_config').upsert({ chave, valor }, { onConflict: 'chave' });
}

async function baixarESubir(sku, urlBling) {
  const r = await fetch(urlBling);
  if (!r.ok) throw new Error('download HTTP ' + r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  const path = `produtos/${sku}.jpg`;
  const up = await supabase.storage.from(BUCKET).upload(path, buf, { contentType: 'image/jpeg', upsert: true });
  if (up.error) throw new Error('upload ' + up.error.message);
  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { path, url: pub.publicUrl, bytes: buf.length };
}

// extrai o link da imagem cheia do detalhe do produto
const linkDoDetalhe = (det) =>
  det?.midia?.imagens?.internas?.[0]?.link
  || det?.midia?.imagens?.externas?.[0]?.link
  || null;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const q = req.query || {};
  const conta = q.conta || 'exitus';
  const dry = q.dry === '1';
  const force = q.force === '1';
  if (q.run !== '1' && !dry) return res.status(403).json({ erro: 'use ?run=1 pra executar (ou ?dry=1 pra simular)' });

  try {
    const token = await refreshBlingToken(conta);
    const headers = { Authorization: 'Bearer ' + token, Accept: 'application/json' };
    // cursor: querystring manda; sem querystring, retoma do último salvo no config
    let pagina, offset;
    if (q.pagina != null) {
      pagina = Math.max(1, parseInt(q.pagina, 10) || 1);
      offset = Math.max(0, parseInt(q.offset || '0', 10) || 0);
    } else {
      const cur = await cfg('bling_fotos_sync_cursor_' + conta);
      pagina = cur?.pagina || 1; offset = cur?.offset || 0;
    }
    const lote = Math.min(Math.max(parseInt(q.lote || '15', 10) || 15, 1), 60); // downloads por chamada
    const t0 = Date.now();
    const BUDGET_MS = 20000; // rodadas curtas; o cursor persiste e a próxima chamada retoma

    const out = { conta, dry, lidos: 0, baixados: 0, pulados: 0, sem_foto: 0, erros: 0, fim: false };
    const cachePai = {}; // id do pai -> link (variações da mesma peça compartilham foto)

    laço:
    while (true) {
      const rl = await blingFetch(`${API}/produtos?pagina=${pagina}&limite=100`, headers);
      const jl = await rl.json().catch(() => null);
      if (rl.status !== 200) { out.erro_listagem = jl?.error || rl.status; break; }
      const produtos = Array.isArray(jl?.data) ? jl.data : [];
      if (!produtos.length) { out.fim = true; break; }

      for (let i = offset; i < produtos.length; i++) {
        if (out.baixados >= lote || (Date.now() - t0) > BUDGET_MS) { offset = i; break laço; }
        const prod = produtos[i];
        out.lidos++;
        const sku = (prod.codigo || '').trim();
        if (!sku) { out.pulados++; continue; }
        const parsed = parseDescricao(prod.nome || '');

        // sem nem thumb na listagem = produto sem foto no Bling
        if (!prod.imagemURL) {
          out.sem_foto++;
          if (!dry) await supabase.from('meluni_produto_fotos').upsert({
            sku, ref: parsed.ref || null, cor: parsed.cor || null,
            origem: 'bling_' + conta, sem_foto: true, atualizado_em: new Date().toISOString(),
          });
          continue;
        }

        // detalhe do produto -> link da imagem cheia (pai como fallback)
        await sleep(350); // rate limit Bling ~3 req/s
        const rd = await blingFetch(`${API}/produtos/${prod.id}`, headers);
        const jd = await rd.json().catch(() => null);
        if (rd.status !== 200) { out.erros++; continue; }
        const det = jd?.data || {};
        let link = linkDoDetalhe(det);
        const paiId = det?.variacao?.produtoPai?.id || null;
        if (!link && paiId) {
          if (!(paiId in cachePai)) {
            await sleep(350);
            const rp = await blingFetch(`${API}/produtos/${paiId}`, headers);
            const jp = await rp.json().catch(() => null);
            cachePai[paiId] = rp.status === 200 ? linkDoDetalhe(jp?.data || {}) : null;
          }
          link = cachePai[paiId];
        }
        if (!link) {
          out.sem_foto++;
          if (!dry) await supabase.from('meluni_produto_fotos').upsert({
            sku, ref: parsed.ref || null, cor: parsed.cor || null,
            origem: 'bling_' + conta, sem_foto: true, atualizado_em: new Date().toISOString(),
          });
          continue;
        }

        const key = imgKey(link);
        const { data: ex } = await supabase.from('meluni_produto_fotos')
          .select('bling_img_key').eq('sku', sku).maybeSingle();
        if (ex && ex.bling_img_key === key && !force) { out.pulados++; continue; }
        if (dry) { out.baixados++; continue; }

        try {
          const { path, url: pub } = await baixarESubir(sku, link);
          await supabase.from('meluni_produto_fotos').upsert({
            sku, ref: parsed.ref || null, cor: parsed.cor || null,
            storage_path: path, url_publica: pub, origem: 'bling_' + conta,
            bling_img_key: key, sem_foto: false,
            cacheado_em: new Date().toISOString(), atualizado_em: new Date().toISOString(),
          });
          out.baixados++;
        } catch (e) { out.erros++; }
      }

      if (produtos.length < 100) { out.fim = true; break; }
      pagina++; offset = 0;
    }

    out.proxima = out.fim ? null : { pagina, offset };
    await cfgSet('bling_fotos_sync_cursor_' + conta, out.fim ? null : { pagina, offset, em: new Date().toISOString() });
    out.ms = Date.now() - t0;
    return res.json(out);
  } catch (e) {
    return res.status(500).json({ conta, erro: String(e?.message || e) });
  }
}
