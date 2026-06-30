/**
 * bling-depositos-debug.js — SÓ LEITURA. Lista os depósitos de uma conta Bling
 * e mostra o saldo de uma amostra de produtos POR depósito (geral vs multiempresa).
 *
 * Não grava nada. Serve pra descobrir o id do depósito MULTIEMPRESA e confirmar
 * onde o estoque realmente está (Lumia: geral vazio, multiempresa cheio).
 *
 * Uso:
 *  GET /api/bling-depositos-debug                 -> conta lumia, amostra geral
 *  GET /api/bling-depositos-debug?conta=exitus
 *  GET /api/bling-depositos-debug?ref=2655        -> foca os produtos de uma ref
 *
 * Ailson 30/06/2026.
 */
import { refreshBlingToken, blingFetch, parseDescricao } from './_bling-helpers.js';

export const config = { maxDuration: 60 };

const API = 'https://api.bling.com.br/Api/v3';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const normRef = (r) => String(r || '').replace(/\D/g, '').replace(/^0+/, '') || '';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const conta = (req.query.conta || 'lumia').toLowerCase();
  const refAlvo = req.query.ref ? normRef(req.query.ref) : null;
  const out = { conta, ref: refAlvo, depositos: [], produtos_amostrados: 0, amostra_saldos: [], erros: [] };

  try {
    const token = await refreshBlingToken(conta);
    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };

    // ── 1. Lista TODOS os depósitos (aqui aparece geral, multiempresa, etc.) ──
    const rd = await blingFetch(`${API}/depositos?pagina=1&limite=100`, headers);
    const jd = await rd.json().catch(() => ({}));
    if (!rd.ok) { out.erros.push(`depositos HTTP ${rd.status}: ${JSON.stringify(jd).slice(0, 200)}`); return res.status(502).json(out); }
    out.depositos = (jd.data || []).map(d => ({
      id: d.id, descricao: d.descricao, padrao: d.padrao, situacao: d.situacao, desconsiderarSaldo: d.desconsiderarSaldo,
    }));

    // ── 2. Acha uma amostra de produtos (foca a ref se passada) ──
    const produtos = [];
    for (let pagina = 1; pagina <= 30 && produtos.length < 8; pagina++) {
      const r = await blingFetch(`${API}/produtos?pagina=${pagina}&limite=100`, headers);
      if (!r.ok) { out.erros.push(`produtos pag ${pagina} HTTP ${r.status}`); break; }
      const j = await r.json().catch(() => ({}));
      const arr = j.data || [];
      if (!arr.length) break;
      for (const p of arr) {
        if (!p.id) continue;
        const ref = normRef(parseDescricao(p.nome || '').ref);
        if (refAlvo) { if (ref === refAlvo) produtos.push({ id: p.id, sku: p.codigo, nome: p.nome, ref }); }
        else produtos.push({ id: p.id, sku: p.codigo, nome: p.nome, ref });
        if (produtos.length >= 8) break;
      }
      if (arr.length < 100) break;
      await sleep(120);
    }
    out.produtos_amostrados = produtos.length;

    // ── 3. Saldo cru POR depósito desses produtos ──
    if (produtos.length) {
      const ids = produtos.map(p => p.id);
      const qs = ids.map(id => `idsProdutos[]=${id}`).join('&');
      const r = await blingFetch(`${API}/estoques/saldos?${qs}`, headers);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { out.erros.push(`saldos HTTP ${r.status}: ${JSON.stringify(j).slice(0, 200)}`); }
      else {
        for (const s of (j.data || [])) {
          const pid = String(s.produto?.id ?? s.id ?? '');
          const prod = produtos.find(p => String(p.id) === pid);
          out.amostra_saldos.push({
            produto_id: pid,
            sku: prod?.sku || null,
            nome: prod?.nome || null,
            saldoFisicoTotal: s.saldoFisicoTotal ?? s.estoqueAtual ?? null,
            por_deposito: (s.depositos || []).map(d => ({
              id: d.id ?? d.deposito?.id ?? null,
              saldoFisico: d.saldoFisico ?? d.saldo ?? d.deposito?.saldoFisico ?? null,
            })),
          });
        }
      }
    }

    return res.status(200).json(out);
  } catch (e) {
    out.erros.push(e.message || String(e));
    return res.status(500).json(out);
  }
}
