// ============================================================================
// BLING — DEBUG: vê se o detalhe do produto traz imagem por VARIAÇÃO (cor).
// Objetivo: validar se dá pra usar foto da cor exata em carrinho/cross-sell.
//   1) confirma se o escopo "Produtos" está liberado na conta (401/403 = não).
//   2) lista /produtos, agrupa por idProdutoPai, pega 2 variações (cores) da
//      mesma ref e busca o detalhe /produtos/{id} de cada pra comparar a mídia.
// Uso: /api/bling-produto-debug                 -> conta exitus, acha sozinho
//      /api/bling-produto-debug?conta=lumia     -> outra conta
//      /api/bling-produto-debug?id=NNN          -> testa um id de produto direto
//      /api/bling-produto-debug?pagina=2        -> outra página da listagem
// Descartável (debug). Ailson 29/06/2026.
// ============================================================================
import { refreshBlingToken, blingFetch } from './_bling-helpers.js';

const API = 'https://api.bling.com.br/Api/v3';

// extrai um resumo de mídia de um produto detalhado do Bling v3
function resumoMidia(d) {
  const m = d?.midia || {};
  const ext = Array.isArray(m?.imagens?.externas) ? m.imagens.externas : [];
  const int = Array.isArray(m?.imagens?.internas) ? m.imagens.internas : [];
  const urls = [
    ...ext.map(x => x?.link).filter(Boolean),
    ...int.map(x => x?.link || x?.linkMiniatura).filter(Boolean),
  ];
  return {
    tem_imagem: urls.length > 0,
    qtd_externas: ext.length,
    qtd_internas: int.length,
    urls: urls.slice(0, 6),
  };
}

async function detalhe(id, headers) {
  const r = await blingFetch(`${API}/produtos/${id}`, headers);
  const j = await r.json().catch(() => null);
  const d = j?.data;
  return {
    id,
    http: r.status,
    erro: j?.error || null,
    codigo: d?.codigo || null,
    nome: d?.nome || null,
    idProdutoPai: d?.idProdutoPai || d?.produtoPai?.id || null,
    midia: d ? resumoMidia(d) : null,
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const q = req.query || {};
  const conta = q.conta || 'exitus';
  try {
    const token = await refreshBlingToken(conta);
    const headers = { Authorization: 'Bearer ' + token, Accept: 'application/json' };
    const out = { conta, token_ok: !!token };

    // id direto
    if (q.id) {
      out.detalhe = await detalhe(q.id, headers);
      return res.json(out);
    }

    // 1) lista uma página de produtos
    const pagina = q.pagina || 1;
    const rl = await blingFetch(`${API}/produtos?pagina=${pagina}&limite=100`, headers);
    const jl = await rl.json().catch(() => null);
    out.listagem = {
      http: rl.status,
      erro: jl?.error || null,            // escopo "Produtos" não liberado aparece aqui
      qtd: Array.isArray(jl?.data) ? jl.data.length : 0,
    };
    const produtos = Array.isArray(jl?.data) ? jl.data : [];
    if (!produtos.length) return res.json(out);

    // amostra crua do 1º item da LISTAGEM (pra ver se a listagem já traz midia)
    out.amostra_listagem = {
      campos: Object.keys(produtos[0] || {}),
      tem_midia_na_listagem: !!produtos[0]?.midia,
    };

    // 2) agrupa por idProdutoPai e acha uma ref com 2+ variações (cores)
    const grupos = new Map();
    for (const p of produtos) {
      const pai = p.idProdutoPai || p.id;
      if (!grupos.has(pai)) grupos.set(pai, []);
      grupos.get(pai).push(p);
    }
    let escolhidos = null;
    for (const [, arr] of grupos) { if (arr.length >= 2) { escolhidos = arr.slice(0, 2); break; } }
    if (!escolhidos) escolhidos = produtos.slice(0, 2); // sem grupo, pega 2 quaisquer

    // 3) detalhe de cada variação escolhida -> compara mídia
    out.variacoes = [];
    for (const p of escolhidos) out.variacoes.push(await detalhe(p.id, headers));

    out.veredito = {
      escopo_produtos_ok: out.listagem.http === 200,
      alguma_tem_imagem: out.variacoes.some(v => v?.midia?.tem_imagem),
      imagens_diferentes_entre_cores:
        out.variacoes.length === 2 &&
        out.variacoes[0]?.midia?.urls?.[0] &&
        out.variacoes[1]?.midia?.urls?.[0] &&
        out.variacoes[0].midia.urls[0] !== out.variacoes[1].midia.urls[0],
    };
    return res.json(out);
  } catch (e) {
    return res.status(500).json({ conta, erro: String(e?.message || e) });
  }
}
