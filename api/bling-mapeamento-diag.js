/**
 * bling-mapeamento-diag.js — SOMENTE LEITURA (Ailson 13/08/2026)
 *
 * Responde o "ponto 30" do guia dele: os GETs de Produtos–Lojas e Canais de
 * venda funcionam com os escopos ATUAIS, sem habilitar "controlar anúncios
 * marketplaces"? (ele não quer esse escopo: não tem versão só-leitura e um
 * erro derrubaria anúncio)
 *
 * GET ?conta=exitus[&sku=03209-AZUL-GG]
 * Só GET. Nenhuma rota de escrita neste arquivo.
 */
import { blingFetch, refreshBlingToken } from './_bling-helpers.js';

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const conta = String(req.query?.conta || 'exitus');
  const sku = String(req.query?.sku || '').trim();

  try {
    const token = await refreshBlingToken(conta);
    const headers = { Authorization: 'Bearer ' + token, Accept: 'application/json' };
    const out = { conta, testes: {} };

    const ler = async (tag, url) => {
      try {
        const r = await blingFetch(url, headers);
        const j = typeof r.json === 'function' ? await r.json().catch(() => ({})) : {};
        const lista = Array.isArray(j?.data) ? j.data : (j?.data ? [j.data] : []);
        out.testes[tag] = {
          http: r.status,
          qtd: lista.length,
          chaves: lista[0] ? Object.keys(lista[0]) : null,
          amostra: lista.slice(0, 2),
          erro: r.status >= 400 ? JSON.stringify(j).slice(0, 260) : null,
        };
        return lista;
      } catch (e) {
        out.testes[tag] = { erro: String(e.message).slice(0, 150) };
        return [];
      }
    };

    // ?detalhe=1&id= — o detalhe do produto traz os vínculos de loja junto?
    if (req.query?.detalhe === '1' && req.query?.id) {
      const r = await blingFetch(`https://api.bling.com.br/Api/v3/produtos/${req.query.id}`, headers);
      const j = typeof r.json === 'function' ? await r.json().catch(() => ({})) : {};
      const d = j?.data || {};
      return res.status(200).json({
        http: r.status,
        chaves: Object.keys(d),
        codigo: d.codigo, nome: d.nome,
        // procurando qualquer coisa que cheire a vínculo com canal
        variacoes_qtd: (d.variacoes || []).length,
        variacao_exemplo: (d.variacoes || [])[0] ? Object.keys((d.variacoes || [])[0]) : null,
        campos_suspeitos: Object.fromEntries(Object.entries(d).filter(([k]) =>
          /loja|canal|marketplace|integra|anuncio|externo|codigos/i.test(k))),
      });
    }

    // ?movimentos=1&produto=16680501330 — histórico de estoque no Bling
    // (quem lançou, quando, tipo de operação)
    if (req.query?.movimentos === '1' && req.query?.produto) {
      const id = String(req.query.produto);
      const out = { conta, produto: id, rotas: {} };
      for (const [tag, url] of [
        ['saldos', `https://api.bling.com.br/Api/v3/estoques/saldos?idsProdutos[]=${id}`],
        ['estoques_prod', `https://api.bling.com.br/Api/v3/estoques?idProduto=${id}&limite=20`],
        ['estoques_ids', `https://api.bling.com.br/Api/v3/estoques?idsProdutos[]=${id}&limite=20`],
        ['produto_estoque', `https://api.bling.com.br/Api/v3/produtos/${id}`],
      ]) {
        const r = await blingFetch(url, headers);
        const j = typeof r.json === 'function' ? await r.json().catch(() => ({})) : {};
        const d = j?.data;
        out.rotas[tag] = {
          http: r.status,
          resumo: tag === 'produto_estoque'
            ? { nome: d?.nome, estoque: d?.estoque }
            : JSON.stringify(d ?? j).slice(0, 700),
        };
        await new Promise(r2 => setTimeout(r2, 350));
      }
      return res.status(200).json(out);
    }

    // ?loja=206144802 — vínculos DAQUELA loja (o Convertr registra ou não?)
    if (req.query?.loja) {
      const idLoja = String(req.query.loja);
      const out = { conta, loja: idLoja, filtros: {}, varredura: null };
      for (const [tag, url] of [
        ['idLoja', `https://api.bling.com.br/Api/v3/produtos/lojas?idLoja=${idLoja}&limite=5`],
        ['idsLojas', `https://api.bling.com.br/Api/v3/produtos/lojas?idsLojas[]=${idLoja}&limite=5`],
        ['loja', `https://api.bling.com.br/Api/v3/produtos/lojas?loja=${idLoja}&limite=5`],
      ]) {
        const r = await blingFetch(url, headers);
        const j = typeof r.json === 'function' ? await r.json().catch(() => ({})) : {};
        const lista = j?.data || [];
        out.filtros[tag] = {
          http: r.status, qtd: lista.length,
          so_dessa_loja: lista.length ? lista.every(v => String(v.loja?.id) === idLoja) : null,
          amostra: lista.slice(0, 3).map(v => ({ idProdutoLoja: v.id, codigo: v.codigo, produto: v.produto?.id, loja: v.loja?.id })),
        };
        await new Promise(r2 => setTimeout(r2, 350));
      }
      // varredura profunda (até 20 páginas) contando essa loja
      let achados = [], paginas = 0;
      for (let pg = 1; pg <= 20; pg++) {
        const r = await blingFetch(`https://api.bling.com.br/Api/v3/produtos/lojas?limite=100&pagina=${pg}`, headers);
        const j = typeof r.json === 'function' ? await r.json().catch(() => ({})) : {};
        const lista = j?.data || [];
        paginas = pg;
        for (const v of lista) if (String(v.loja?.id) === idLoja) achados.push({ produto: v.produto?.id, codigo: v.codigo, idProdutoLoja: v.id });
        if (lista.length < 100) break;
        await new Promise(r2 => setTimeout(r2, 330));
      }
      out.varredura = { paginas, achados_nessa_loja: achados.length, amostra: achados.slice(0, 8) };
      return res.status(200).json(out);
    }

    // ?lojas_usadas=1 — quais lojas APARECEM nos vínculos do catálogo inteiro?
    // (pra saber se o canal Convertr/Api registra produto-loja ou não)
    if (req.query?.lojas_usadas === '1') {
      const canaisR = await blingFetch('https://api.bling.com.br/Api/v3/canais-venda', headers);
      const canaisJ = typeof canaisR.json === 'function' ? await canaisR.json().catch(() => ({})) : {};
      const nomes = {};
      for (const c of (canaisJ?.data || [])) nomes[c.id] = `${c.descricao} [${c.tipo}]${c.situacao === 1 ? '' : ' (inativo)'}`;
      await new Promise(r => setTimeout(r, 350));
      const cont = {};
      for (let pg = 1; pg <= 6; pg++) {
        const r = await blingFetch(`https://api.bling.com.br/Api/v3/produtos/lojas?limite=100&pagina=${pg}`, headers);
        const j = typeof r.json === 'function' ? await r.json().catch(() => ({})) : {};
        const lista = j?.data || [];
        for (const v of lista) {
          const id = v.loja?.id;
          cont[id] = cont[id] || { loja: nomes[id] || `loja ${id}`, vinculos: 0, exemplo_codigo: v.codigo || '(vazio)' };
          cont[id].vinculos++;
        }
        if (lista.length < 100) break;
        await new Promise(r2 => setTimeout(r2, 350));
      }
      return res.status(200).json({ conta, amostra: 'até 600 vínculos do catálogo', por_loja: Object.values(cont) });
    }

    // ?ref=02671 — PROTÓTIPO DA AUDITORIA: acha os produtos da referência,
    // pega as variações e cruza com os vínculos de loja (só leitura)
    if (req.query?.ref) {
      const ref = String(req.query.ref).replace(/^0+/, '');
      const canaisR = await blingFetch('https://api.bling.com.br/Api/v3/canais-venda', headers);
      const canaisJ = typeof canaisR.json === 'function' ? await canaisR.json().catch(() => ({})) : {};
      const canais = {};
      for (const c of (canaisJ?.data || [])) canais[c.id] = { nome: c.descricao, tipo: c.tipo, ativo: c.situacao === 1 };
      await new Promise(r => setTimeout(r, 350));

      // achar o produto pai pela ref no nome (paginando o catálogo)
      let pai = null;
      for (let pg = 1; pg <= 8 && !pai; pg++) {
        const r = await blingFetch(`https://api.bling.com.br/Api/v3/produtos?limite=100&pagina=${pg}&tipo=P`, headers);
        const j = typeof r.json === 'function' ? await r.json().catch(() => ({})) : {};
        const lista = j?.data || [];
        pai = lista.find(p2 => new RegExp(`ref[ .]?0*${ref}\\b`, 'i').test(String(p2.nome || '')) && p2.formato === 'V');
        if (lista.length < 100) break;
        await new Promise(r2 => setTimeout(r2, 350));
      }
      if (!pai) return res.status(200).json({ ref, erro: 'não achei o produto pai dessa ref no catálogo (8 páginas)' });

      // variações do pai
      const detR = await blingFetch(`https://api.bling.com.br/Api/v3/produtos/${pai.id}`, headers);
      const det = typeof detR.json === 'function' ? await detR.json().catch(() => ({})) : {};
      const variacoes = (det?.data?.variacoes || []).map(v => ({ id: v.id, sku: v.codigo, nome: String(v.variacao?.nome || v.nome || '').slice(-30), estoque: v.estoque?.saldoVirtualTotal }));
      await new Promise(r => setTimeout(r, 350));

      // vínculos do PAI e de algumas variações
      const vinculosDe = async (idProd) => {
        const r = await blingFetch(`https://api.bling.com.br/Api/v3/produtos/lojas?idProduto=${idProd}`, headers);
        const j = typeof r.json === 'function' ? await r.json().catch(() => ({})) : {};
        return (j?.data || []).map(v => ({
          idProdutoLoja: v.id, codigo_no_canal: v.codigo, preco: v.preco,
          loja_id: v.loja?.id, canal: canais[v.loja?.id]?.nome || `loja ${v.loja?.id}`, tipo: canais[v.loja?.id]?.tipo,
        }));
      };
      const doPai = await vinculosDe(pai.id);
      await new Promise(r => setTimeout(r, 400));
      const amostraVar = [];
      for (const v of variacoes.slice(0, 3)) {
        amostraVar.push({ variacao: v.nome, sku: v.sku, estoque: v.estoque, vinculos: await vinculosDe(v.id) });
        await new Promise(r => setTimeout(r, 400));
      }
      return res.status(200).json({
        ref, produto_pai: { id: pai.id, nome: pai.nome, codigo: pai.codigo },
        canais_cadastrados: Object.entries(canais).map(([id, c]) => ({ id: Number(id), ...c })),
        variacoes_qtd: variacoes.length,
        vinculos_do_pai: doPai,
        amostra_variacoes: amostraVar,
      });
    }

    // 1. produtos (base) — pegar um id real pra testar o vínculo
    const prods = await ler('produtos', 'https://api.bling.com.br/Api/v3/produtos?limite=3&criterio=2');
    await new Promise(r => setTimeout(r, 400));

    // 2. produto por SKU (o filtro oficial é ?codigo=)
    if (sku) {
      await ler('produto_por_sku', `https://api.bling.com.br/Api/v3/produtos?codigo=${encodeURIComponent(sku)}`);
      await new Promise(r => setTimeout(r, 400));
    }

    // 3. A PERGUNTA CENTRAL: produtos/lojas responde com os escopos atuais?
    await ler('produtos_lojas_lista', 'https://api.bling.com.br/Api/v3/produtos/lojas?limite=5');
    await new Promise(r => setTimeout(r, 400));

    const idProd = prods?.[0]?.id;
    if (idProd) {
      out.produto_testado = { id: idProd, codigo: prods[0].codigo, nome: prods[0].nome };
      await ler('produtos_lojas_por_produto', `https://api.bling.com.br/Api/v3/produtos/lojas?idsProdutos[]=${idProd}&limite=10`);
      await new Promise(r => setTimeout(r, 400));
      await ler('produtos_lojas_idProduto', `https://api.bling.com.br/Api/v3/produtos/lojas?idProduto=${idProd}`);
      await new Promise(r => setTimeout(r, 400));
    }

    // 4. canais de venda / lojas cadastradas
    await ler('canais_venda', 'https://api.bling.com.br/Api/v3/canais-venda');
    await new Promise(r => setTimeout(r, 400));
    await ler('lojas', 'https://api.bling.com.br/Api/v3/lojas');

    return res.status(200).json(out);
  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
}
