// ============================================================================
// bling-fotos-sync — baixa a foto EM TAMANHO CHEIO de cada variação do Bling e
// re-hospeda no bucket sofia-midias (URL pública estável), gravando o ponteiro
// em meluni_produto_fotos (chave = sku, o mesmo do carrinho Meluni).
// ----------------------------------------------------------------------------
// v3 (Ailson 02/07/2026):
//  - Imagem cheia via GET /produtos/{id} -> midia.imagens.internas[0].link
//    (fallback externas[0], fallback foto do produto-pai da variação).
//  - Detecção de mudança BARATA: o pathname do imagemURL (thumb) da LISTAGEM
//    muda quando a foto troca no Bling. Se thumb_key igual e full_size já
//    baixado -> pula sem gastar o GET de detalhe.
//  - Cursor auto-retomável em meluni_config (bling_fotos_sync_cursor_<conta>).
//  - CRON */15min: completa o catálogo em rodadas e depois vira manutenção
//    (foto trocada no Bling entra sozinha em até ~15min).
//  - Modo direcionado: ?run=1&skus=a,b,c -> sincroniza só esses SKUs
//    (resolve id via /produtos?codigo=). Usado pros carrinhos pendentes.
//  - ?force=1 re-baixa tudo; ?dry=1 simula.
// ============================================================================
import { supabase, refreshBlingToken, blingFetch, parseDescricao } from './_bling-helpers.js';

export const config = { maxDuration: 60 };
const API = 'https://api.bling.com.br/Api/v3';
const BUCKET = 'sofia-midias';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const imgKey = (url) => { try { return new URL(url).pathname; } catch { return null; } };

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
  return { path, url: pub.publicUrl };
}

const linkDoDetalhe = (det) =>
  det?.midia?.imagens?.internas?.[0]?.link
  || det?.midia?.imagens?.externas?.[0]?.link
  || null;

// marca sem_foto na tabela (não trava reprocessos futuros: thumb_key nulo)
async function marcarSemFoto(sku, parsed, conta, dry) {
  if (dry) return;
  await supabase.from('meluni_produto_fotos').upsert({
    sku, ref: parsed.ref || null, cor: parsed.cor || null,
    origem: 'bling_' + conta, sem_foto: true, atualizado_em: new Date().toISOString(),
  });
}

// baixa a imagem cheia de UM produto (com fallback no pai) e grava o ponteiro
async function processarDetalhe(prod, parsed, tkey, conta, headers, cachePai, dry, out) {
  await sleep(300); // rate limit Bling ~3 req/s
  const rd = await blingFetch(`${API}/produtos/${prod.id}`, headers);
  const jd = await rd.json().catch(() => null);
  if (rd.status !== 200) { out.erros++; return; }
  const det = jd?.data || {};
  let link = linkDoDetalhe(det);
  const paiId = det?.variacao?.produtoPai?.id || null;
  if (!link && paiId) {
    if (!(paiId in cachePai)) {
      await sleep(300);
      const rp = await blingFetch(`${API}/produtos/${paiId}`, headers);
      const jp = await rp.json().catch(() => null);
      cachePai[paiId] = rp.status === 200 ? linkDoDetalhe(jp?.data || {}) : null;
    }
    link = cachePai[paiId];
  }
  if (!link) { out.sem_foto++; await marcarSemFoto(prod.codigo, parsed, conta, dry); return; }
  if (dry) { out.baixados++; return; }
  try {
    const { path, url: pub } = await baixarESubir(prod.codigo, link);
    await supabase.from('meluni_produto_fotos').upsert({
      sku: prod.codigo, ref: parsed.ref || null, cor: parsed.cor || null,
      storage_path: path, url_publica: pub, origem: 'bling_' + conta,
      bling_img_key: imgKey(link), bling_thumb_key: tkey || null, full_size: true,
      sem_foto: false, cacheado_em: new Date().toISOString(), atualizado_em: new Date().toISOString(),
    });
    out.baixados++;
  } catch { out.erros++; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const q = req.query || {};
  const ua = req.headers?.['user-agent'] || '';
  const ehCron = ua.startsWith('vercel-cron') || !!req.headers?.['x-vercel-cron'];
  const conta = q.conta || 'exitus';
  const dry = q.dry === '1';
  const force = q.force === '1';
  if (q.run !== '1' && !dry && !ehCron) return res.status(403).json({ erro: 'use ?run=1 (ou ?dry=1)' });

  try {
    const token = await refreshBlingToken(conta);
    const headers = { Authorization: 'Bearer ' + token, Accept: 'application/json' };
    const t0 = Date.now();
    // budget: ?budget=segundos (cap 280, maxDuration=300 no vercel.json).
    // cron agora usa 240s por rodada (antes 48s: catálogo de ~2k SKUs levava horas).
    const budgetQ = parseInt(q.budget || '', 10);
    const BUDGET_MS = budgetQ > 0 ? Math.min(budgetQ, 280) * 1000 : (ehCron ? 240000 : 20000);
    const out = { conta, dry, cron: ehCron, lidos: 0, baixados: 0, pulados: 0, sem_foto: 0, erros: 0, fim: false };
    const cachePai = {};

    // ── MODO DIRECIONADO: ?skus=a,b,c ──
    if (q.skus) {
      const skus = String(q.skus).split(',').map(s => s.trim()).filter(Boolean).slice(0, 40);
      for (const sku of skus) {
        out.lidos++;
        await sleep(300);
        const rb = await blingFetch(`${API}/produtos?codigo=${encodeURIComponent(sku)}`, headers);
        const jb = await rb.json().catch(() => null);
        const prod = jb?.data?.[0];
        if (!prod?.id) { out.erros++; continue; }
        const parsed = parseDescricao(prod.nome || '');
        const tkey = imgKey(prod.imagemURL || '');
        if (!prod.imagemURL) { out.sem_foto++; await marcarSemFoto(sku, parsed, conta, dry); continue; }
        await processarDetalhe({ id: prod.id, codigo: sku }, parsed, tkey, conta, headers, cachePai, dry, out);
      }
      return res.json(out);
    }

    // ── VARREDURA COM CURSOR ──
    let pagina, offset;
    if (q.pagina != null) {
      pagina = Math.max(1, parseInt(q.pagina, 10) || 1);
      offset = Math.max(0, parseInt(q.offset || '0', 10) || 0);
    } else {
      const cur = await cfg('bling_fotos_sync_cursor_' + conta);
      pagina = cur?.pagina || 1; offset = cur?.offset || 0;
    }

    laço:
    while (true) {
      if ((Date.now() - t0) > BUDGET_MS) break;
      const rl = await blingFetch(`${API}/produtos?pagina=${pagina}&limite=100`, headers);
      const jl = await rl.json().catch(() => null);
      if (rl.status !== 200) { out.erro_listagem = jl?.error || rl.status; break; }
      const produtos = Array.isArray(jl?.data) ? jl.data : [];
      if (!produtos.length) { out.fim = true; break; }

      // estado atual dos SKUs da página em UMA query (skip barato)
      const skusPag = produtos.map(p => (p.codigo || '').trim()).filter(Boolean);
      const { data: exRows } = await supabase.from('meluni_produto_fotos')
        .select('sku,bling_thumb_key,full_size').in('sku', skusPag);
      const exMap = new Map((exRows || []).map(r => [r.sku, r]));

      for (let i = offset; i < produtos.length; i++) {
        if ((Date.now() - t0) > BUDGET_MS) { offset = i; break laço; }
        const prod = produtos[i];
        out.lidos++;
        const sku = (prod.codigo || '').trim();
        if (!sku) { out.pulados++; continue; }
        const parsed = parseDescricao(prod.nome || '');

        if (!prod.imagemURL) { out.sem_foto++; await marcarSemFoto(sku, parsed, conta, dry); continue; }

        const tkey = imgKey(prod.imagemURL);
        const ex = exMap.get(sku);
        if (ex && ex.full_size && ex.bling_thumb_key === tkey && !force) { out.pulados++; continue; }

        await processarDetalhe({ id: prod.id, codigo: sku }, parsed, tkey, conta, headers, cachePai, dry, out);
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
