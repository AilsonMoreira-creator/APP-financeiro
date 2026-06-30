/**
 * bling-saldo-raw.js — SÓ LEITURA / DEBUG. Mostra o JSON CRU do saldo de UM
 * produto numa conta, pra descobrir ONDE a API expõe o saldo do depósito
 * MULTIEMPRESA (a tela do Bling mostra cheio, mas /estoques/saldos vem 0).
 *
 * Tenta fontes pro mesmo produto:
 *  1. GET /estoques/saldos?idsProdutos[]=ID            (cru, todos os campos)
 *  2. GET /produtos/{id}                               (campo estoque/depositos)
 *  3. GET /estoques/saldos/{idDeposito}?idsProdutos[]=ID  (por depósito, se ?dep=)
 *
 * Uso:
 *  /api/bling-saldo-raw?conta=exitus&sku=I82gqdf457u524
 *  /api/bling-saldo-raw?conta=exitus&id=16660379214
 *  /api/bling-saldo-raw?conta=exitus&id=16660379214&dep=14888974538
 *
 * Ailson 30/06/2026.
 */
import { refreshBlingToken, blingFetch } from './_bling-helpers.js';

export const config = { maxDuration: 30 };
const API = 'https://api.bling.com.br/Api/v3';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const conta = (req.query.conta || 'exitus').toLowerCase();
  const dep = req.query.dep ? String(req.query.dep) : null;
  let pid = req.query.id ? String(req.query.id) : null;
  const sku = req.query.sku ? String(req.query.sku).trim() : null;
  const out = { conta, id: pid, sku, dep, etapas: {} };

  try {
    const token = await refreshBlingToken(conta);
    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };

    if (!pid && sku) {
      const rp = await blingFetch(`${API}/produtos?codigo=${encodeURIComponent(sku)}`, headers);
      const jp = await rp.json().catch(() => ({}));
      pid = jp.data?.[0]?.id ? String(jp.data[0].id) : null;
      out.etapas.produto_por_sku = { status: rp.status, achou: pid, nome: jp.data?.[0]?.nome || null };
    }
    if (!pid) return res.status(400).json({ ...out, erro: 'passa ?id= ou ?sku=' });

    // 1. saldos cru — JSON inteiro, sem filtrar campo nenhum
    const r1 = await blingFetch(`${API}/estoques/saldos?idsProdutos[]=${encodeURIComponent(pid)}`, headers);
    out.etapas.saldos = { status: r1.status, body: await r1.json().catch(() => null) };

    // 2. produto cru — campo estoque / depositos
    const r2 = await blingFetch(`${API}/produtos/${encodeURIComponent(pid)}`, headers);
    const j2 = await r2.json().catch(() => null);
    out.etapas.produto = {
      status: r2.status,
      estoque: j2?.data?.estoque ?? null,
      depositos: j2?.data?.depositos ?? null,
    };

    // 3. saldos por depósito específico (se a rota existir)
    if (dep) {
      const r3 = await blingFetch(`${API}/estoques/saldos/${encodeURIComponent(dep)}?idsProdutos[]=${encodeURIComponent(pid)}`, headers);
      out.etapas.saldos_por_deposito = { status: r3.status, body: await r3.json().catch(() => null) };
    }

    return res.status(200).json(out);
  } catch (e) {
    return res.status(500).json({ ...out, erro: e.message || String(e) });
  }
}
