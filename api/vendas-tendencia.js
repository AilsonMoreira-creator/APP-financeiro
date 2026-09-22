/**
 * vendas-tendencia.js — "Vendas esquentando / esfriando" por REF (Ailson, 22/09/2026).
 * Regra dele: ultimos 15 dias x 15 dias anteriores, variacao de 20% pra cima ou pra baixo.
 * Fonte: a mesma view do ranking de subidas/quedas do OS Amicia (vw_top_movers_unificado_15d,
 * marketplaces unificados). Filtro de ruido: so quando uma das janelas tem >= 10 pecas
 * (1 -> 2 pecas seria "+100%" e nao significa nada).
 * Some sozinho: a janela e rolante, quando a variacao cai abaixo de 20% o selo desaparece.
 */
import { supabase } from './_ml-helpers.js';
export const config = { maxDuration: 15 };
const MIN_PECAS = 10, LIMIAR = 20;
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=600');
  try {
    const { data, error } = await supabase.from('vw_top_movers_unificado_15d').select('ref_norm, u_ult15, u_ant15, var_pct');
    if (error) throw error;
    const out = {};
    for (const r of data || []) {
      const ult = Number(r.u_ult15) || 0, ant = Number(r.u_ant15) || 0, v = Number(r.var_pct);
      if (Math.max(ult, ant) < MIN_PECAS || !Number.isFinite(v)) continue;
      if (v >= LIMIAR) out[String(r.ref_norm)] = { tendencia: 'quente', ult, ant, var: Math.round(v) };
      else if (v <= -LIMIAR) out[String(r.ref_norm)] = { tendencia: 'fria', ult, ant, var: Math.round(v) };
    }
    return res.status(200).json({ ok: true, regra: `15d x 15d anteriores, ±${LIMIAR}%, min ${MIN_PECAS} peças`, refs: out });
  } catch (e) { return res.status(500).json({ ok: false, erro: String(e?.message || e) }); }
}
