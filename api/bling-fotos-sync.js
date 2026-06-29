// ============================================================================
// bling-fotos-sync — baixa a foto de cada variação do Bling e re-hospeda no
// bucket sofia-midias (URL estável, sem expiração), gravando o ponteiro em
// meluni_produto_fotos (chave = sku, o mesmo do carrinho Meluni).
// ----------------------------------------------------------------------------
// Por que re-hospedar: as URLs do Bling são S3 assinadas e EXPIRAM (horas/dias),
// então não dá pra mandar direto no template da Meta. Aqui a foto vira nossa.
// Fonte da imagem: imagemURL da listagem /produtos (1 req por página de 100).
//   (Se um dia quiser foto em tamanho cheio: trocar por GET /produtos/{id} e
//    usar midia.imagens.internas[0].link — 1 req por produto, mais lento.)
// Idempotente: só re-baixa quando a foto mudou (bling_img_key) ou com ?force=1.
// Roda SOB DEMANDA, em lotes, pra não estourar o timeout:
//   /api/bling-fotos-sync?dry=1                 -> simula, não escreve
//   /api/bling-fotos-sync?run=1                 -> executa (pág 1 em diante)
//   /api/bling-fotos-sync?run=1&pagina=3        -> retoma da página 3
//   /api/bling-fotos-sync?run=1&paginas=2       -> nº de páginas por chamada
//   /api/bling-fotos-sync?run=1&conta=lumia     -> outra conta
//   /api/bling-fotos-sync?run=1&force=1         -> re-baixa tudo
// NÃO tem cron: só roda quando chamado. Ailson 29/06/2026.
// ============================================================================
import { supabase, refreshBlingToken, blingFetch, parseDescricao } from './_bling-helpers.js';

const API = 'https://api.bling.com.br/Api/v3';
const BUCKET = 'sofia-midias';

// caminho-base da imagem no S3 (sem a querystring assinada) -> muda quando a foto troca
const imgKey = (url) => { try { return new URL(url).pathname; } catch { return null; } };

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
    const pagInicio = parseInt(q.pagina || '1', 10);
    const maxPags = Math.min(parseInt(q.paginas || '3', 10) || 3, 10);

    const out = { conta, dry, lidos: 0, baixados: 0, pulados: 0, sem_foto: 0, erros: 0, pagina_ini: pagInicio, pagina_fim: pagInicio, fim: false };

    for (let p = pagInicio; p < pagInicio + maxPags; p++) {
      const rl = await blingFetch(`${API}/produtos?pagina=${p}&limite=100`, headers);
      const jl = await rl.json().catch(() => null);
      if (rl.status !== 200) { out.erro_listagem = jl?.error || rl.status; break; }
      const produtos = Array.isArray(jl?.data) ? jl.data : [];
      out.pagina_fim = p;
      if (!produtos.length) { out.fim = true; break; }

      for (const prod of produtos) {
        out.lidos++;
        const sku = (prod.codigo || '').trim();
        if (!sku) { out.pulados++; continue; }
        const parsed = parseDescricao(prod.nome || '');
        const url = prod.imagemURL || null;

        if (!url) {
          out.sem_foto++;
          if (!dry) await supabase.from('meluni_produto_fotos').upsert({
            sku, ref: parsed.ref || null, cor: parsed.cor || null,
            origem: 'bling_' + conta, sem_foto: true, atualizado_em: new Date().toISOString(),
          });
          continue;
        }

        const key = imgKey(url);
        const { data: ex } = await supabase.from('meluni_produto_fotos')
          .select('bling_img_key').eq('sku', sku).maybeSingle();
        if (ex && ex.bling_img_key === key && !force) { out.pulados++; continue; }
        if (dry) { out.baixados++; continue; }

        try {
          const { path, url: pub } = await baixarESubir(sku, url);
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
    }

    out.proxima_pagina = out.fim ? null : out.pagina_fim + 1;
    return res.json(out);
  } catch (e) {
    return res.status(500).json({ conta, erro: String(e?.message || e) });
  }
}
