/**
 * bling-estoque-set.js — Escreve o saldo no Bling (app -> Bling) por BALANÇO.
 *
 * Chamado pelo botão Salvar do modal de ajuste. Seta o saldo absoluto no
 * depósito geral (operacao 'B' = balanço → vira o saldo atual no Bling).
 *
 * POST body: { conta?, ref, cor_norm, tam, qtd, deposito? }
 *  - resolve o id do produto via bling_estoque (bling_produto_id) ou /produtos?codigo=sku
 *  - depósito: usa amicia_data 'bling-estoque-config'.deposito_geral (ou detecta)
 */
import { refreshBlingToken, blingFetch, supabase } from './_bling-helpers.js';

export const config = { maxDuration: 60 };
const API = 'https://api.bling.com.br/Api/v3';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'use POST' });
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const conta = (body.conta || 'exitus').toLowerCase();
  const ref = String(body.ref || '').replace(/\D/g, '').replace(/^0+/, '');
  const cor_norm = String(body.cor_norm || '');
  const tam = String(body.tam || '').toUpperCase().trim();
  const qtd = Math.max(0, Math.round(Number(body.qtd)));
  if (!ref || !cor_norm || !tam || isNaN(qtd)) return res.status(400).json({ error: 'ref, cor_norm, tam, qtd obrigatórios' });

  try {
    const token = await refreshBlingToken(conta);
    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' };

    // ── id do produto ──
    const { data: lin } = await supabase.from('bling_estoque')
      .select('bling_produto_id,bling_sku').eq('ref', ref).eq('cor_norm', cor_norm).eq('tam', tam).maybeSingle();
    let produtoId = lin?.bling_produto_id || null;
    if (!produtoId && lin?.bling_sku) {
      const rp = await blingFetch(`${API}/produtos?codigo=${encodeURIComponent(lin.bling_sku)}`, headers);
      const jp = await rp.json().catch(() => ({}));
      produtoId = jp.data?.[0]?.id || null;
    }
    if (!produtoId) return res.status(404).json({ error: 'produto não encontrado no Bling (rode a leitura primeiro pra mapear o SKU)' });

    // ── depósito geral ──
    let depositoId = body.deposito ? String(body.deposito) : null;
    if (!depositoId) {
      const { data: cfg } = await supabase.from('amicia_data').select('payload').eq('user_id', 'bling-estoque-config').maybeSingle();
      depositoId = cfg?.payload?.deposito_geral || null;
    }
    if (!depositoId) {
      const rd = await blingFetch(`${API}/depositos?pagina=1&limite=100`, headers);
      const jd = await rd.json().catch(() => ({}));
      const deps = jd.data || [];
      const pick = deps.find(d => d.padrao === true) || deps.find(d => /geral/i.test(d.descricao || '')) || deps[0];
      depositoId = pick ? String(pick.id) : null;
    }
    if (!depositoId) return res.status(502).json({ error: 'depósito geral não encontrado' });

    // ── POST balanço ──
    const r = await fetch(`${API}/estoques`, {
      method: 'POST', headers,
      body: JSON.stringify({ produto: { id: Number(produtoId) }, deposito: { id: Number(depositoId) }, operacao: 'B', quantidade: qtd }),
    });
    const txt = await r.text();
    let data; try { data = JSON.parse(txt); } catch { data = txt; }
    if (!r.ok) return res.status(502).json({ error: `Bling HTTP ${r.status}`, detalhe: data, produtoId, depositoId });

    return res.status(200).json({ ok: true, ref, cor_norm, tam, qtd, produtoId, depositoId });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
}
