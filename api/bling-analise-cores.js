/**
 * bling-analise-cores.js — ranking de cores vendidas num período (API Bling).
 *
 * Pedido Ailson 10/07/2026: top cores vendidas 10-30/07/2025 na Exitus (dado
 * de 2025 não existe no banco — só via API). Uso: planejar corte do mesmo
 * período deste ano.
 *
 * GET ?de=2025-07-10&ate=2025-07-30&conta=exitus[&reset=1]
 * Processa incremental (estado em amicia_data user_id='bling-analise-cores'):
 * 1. pagina /pedidos/vendas (situação Atendido) e guarda os ids
 * 2. detalha pedido a pedido (/pedidos/vendas/{id}) somando quantidade por cor
 *    - cor: lookup bling_sku -> cor_label/cor_norm no bling_estoque local;
 *      fallback regex Cor:XXX na descrição do item
 * 3. quando termina, responde ranking completo; senão, responde progresso.
 * Guarda ~4min por invocação (maxDuration 300). Chamar de novo até done=true.
 */
import { refreshBlingToken, blingFetch, supabase } from './_bling-helpers.js';

export const config = { maxDuration: 300 };
const API = 'https://api.bling.com.br/Api/v3';
const pausa = ms => new Promise(r => setTimeout(r, ms));
const STATE_ID = 'bling-analise-cores';

export default async function handler(req, res) {
  const t0 = Date.now();
  const de = String(req.query?.de || '2025-07-10');
  const ate = String(req.query?.ate || '2025-07-30');
  const conta = String(req.query?.conta || 'exitus');
  const reset = String(req.query?.reset || '') === '1';

  try {
    // estado
    let st = null;
    if (!reset) {
      const { data } = await supabase.from('amicia_data').select('payload').eq('user_id', STATE_ID).maybeSingle();
      st = data?.payload || null;
      if (st && (st.de !== de || st.ate !== ate || st.conta !== conta)) st = null;
    }
    if (!st) st = { de, ate, conta, fase: 'listar', pagina: 1, ids: [], idx: 0, cores: {}, pedidos_total: 0, itens_sem_cor: 0, pecas_total: 0 };

    const token = await refreshBlingToken(conta);
    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };

    // mapa sku->cor do banco (1 query, cache local da invocação)
    const skuCor = new Map();
    {
      let from = 0;
      while (true) {
        const { data: rows } = await supabase.from('bling_estoque')
          .select('bling_sku,cor_label,cor_norm').not('bling_sku', 'is', null).range(from, from + 999);
        (rows || []).forEach(r => skuCor.set(String(r.bling_sku), r.cor_label || r.cor_norm));
        if (!rows || rows.length < 1000) break;
        from += 1000;
      }
    }

    // fase 1: listar ids dos pedidos do período (situação 9 = Atendido)
    while (st.fase === 'listar' && Date.now() - t0 < 220000) {
      const url = `${API}/pedidos/vendas?pagina=${st.pagina}&limite=100&dataInicial=${de}&dataFinal=${ate}&idsSituacoes%5B%5D=9`;
      const r = await blingFetch(url, headers);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(`listagem HTTP ${r.status}`);
      const lote = j.data || [];
      lote.forEach(p => st.ids.push(p.id));
      if (lote.length < 100) { st.fase = 'detalhar'; st.pedidos_total = st.ids.length; }
      else st.pagina++;
      await pausa(300);
    }

    // fase 2: detalhar pedidos e agregar cor
    while (st.fase === 'detalhar' && st.idx < st.ids.length && Date.now() - t0 < 220000) {
      const id = st.ids[st.idx];
      try {
        const r = await blingFetch(`${API}/pedidos/vendas/${id}`, headers);
        const j = await r.json().catch(() => ({}));
        if (r.ok) {
          for (const it of (j.data?.itens || [])) {
            const q = Number(it.quantidade) || 0;
            if (q <= 0) continue;
            let cor = skuCor.get(String(it.codigo || '')) || null;
            if (!cor) {
              const m = String(it.descricao || '').match(/Cor:\s*([^;,]+)/i);
              cor = m ? m[1].trim() : null;
            }
            if (!cor) { st.itens_sem_cor += q; continue; }
            const chave = cor.toUpperCase().trim();
            st.cores[chave] = (st.cores[chave] || 0) + q;
            st.pecas_total += q;
          }
        }
      } catch { /* pedido individual falhou: segue */ }
      st.idx++;
      await pausa(280);
    }

    const done = st.fase === 'detalhar' && st.idx >= st.ids.length;
    await supabase.from('amicia_data').upsert(
      { user_id: STATE_ID, payload: st, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    );

    const ranking = Object.entries(st.cores).sort((a, b) => b[1] - a[1]).slice(0, 25)
      .map(([cor, pecas], i) => ({ pos: i + 1, cor, pecas }));

    return res.status(200).json({
      done, periodo: `${de} a ${ate}`, conta,
      fase: st.fase, pedidos: st.pedidos_total || st.ids.length, detalhados: st.idx,
      pecas_total: st.pecas_total, itens_sem_cor: st.itens_sem_cor,
      ranking_parcial: ranking, duracao_s: Math.round((Date.now() - t0) / 1000),
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
}
