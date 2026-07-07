/**
 * bling-estoque-debug-saldos.js — raio-X de saldos de um SKU nas 3 contas.
 * (Ailson 07/07/2026 — investigação do reflexo multiempresa: zerar o negativo
 * do filho devolve saldo em QUAL depósito/campo da Exitus?)
 *
 * GET ?ref=3228&cor_norm=bege&tam=G
 * → por conta: produtoId, saldoFisicoTotal, saldoVirtualTotal e cada depósito
 *   (id, nome, saldoFisico, saldoVirtual). Read-only.
 */
import { refreshBlingToken, blingFetch } from './_bling-helpers.js';
import { supabase } from './_bling-helpers.js';

export const config = { maxDuration: 60 };
const API = 'https://api.bling.com.br/Api/v3';

export default async function handler(req, res) {
  const ref = String(req.query.ref || '').replace(/\D/g, '').replace(/^0+/, '');
  const cor_norm = String(req.query.cor_norm || '');
  const tam = String(req.query.tam || '').toUpperCase().trim();
  if (!ref || !cor_norm || !tam) return res.status(400).json({ error: 'ref, cor_norm e tam obrigatórios' });

  const { data: row } = await supabase.from('bling_estoque')
    .select('bling_sku').eq('ref', ref).eq('cor_norm', cor_norm).eq('tam', tam).maybeSingle();
  if (!row?.bling_sku) return res.status(404).json({ error: 'SKU não mapeado em bling_estoque' });
  const sku = row.bling_sku;

  const contas = {};
  for (const conta of ['exitus', 'lumia', 'muniam']) {
    const c = { produtoId: null, saldoFisicoTotal: null, saldoVirtualTotal: null, depositos: [], erro: null };
    try {
      const token = await refreshBlingToken(conta);
      const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };

      const rp = await blingFetch(`${API}/produtos?codigo=${encodeURIComponent(sku)}`, headers);
      const jp = await rp.json().catch(() => ({}));
      if (!rp.ok) throw new Error(`produtos HTTP ${rp.status}`);
      c.produtoId = jp.data?.[0]?.id || null;
      if (!c.produtoId) { c.erro = 'SKU não existe nessa conta'; contas[conta] = c; continue; }

      // nomes dos depósitos
      const rd = await blingFetch(`${API}/depositos?pagina=1&limite=100`, headers);
      const jd = await rd.json().catch(() => ({}));
      const nomes = {};
      for (const d of (jd.data || [])) nomes[String(d.id)] = d.descricao || d.nome || '';

      const rs = await blingFetch(`${API}/estoques/saldos?idsProdutos[]=${c.produtoId}`, headers);
      const js = await rs.json().catch(() => ({}));
      if (!rs.ok) throw new Error(`saldos HTTP ${rs.status}`);
      const s = (js.data || []).find(x => String(x.produto?.id ?? x.id ?? '') === String(c.produtoId)) || (js.data || [])[0] || {};
      c.saldoFisicoTotal = s.saldoFisicoTotal ?? s.saldoFisico ?? null;
      c.saldoVirtualTotal = s.saldoVirtualTotal ?? s.saldoVirtual ?? null;
      c.depositos = (s.depositos || []).map(d => ({
        id: String(d.id ?? d.deposito?.id ?? ''),
        nome: nomes[String(d.id ?? d.deposito?.id ?? '')] || null,
        saldoFisico: d.saldoFisico ?? null,
        saldoVirtual: d.saldoVirtual ?? null,
      }));
    } catch (e) { c.erro = e?.message; }
    contas[conta] = c;
  }
  return res.status(200).json({ sku, ref, cor_norm, tam, contas });
}
