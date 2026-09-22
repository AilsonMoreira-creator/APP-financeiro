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
// Regua variavel dele (22/09): quanto menor o volume, maior a variacao exigida.
//  SUBIDA  (base = pecas dos ULTIMOS 15 dias): <30 nao considera; 30-39 => +40%; 40-49 => +30%; 50-60 => +25%; >60 => +20%
//  QUEDA   (base = pecas dos 15 dias ANTERIORES): <20 nao considera; 20-39 => -30%; 40-60 => -25%; >60 => -20%
function limiarSubida(ult) { if (ult < 30) return null; if (ult < 40) return 40; if (ult < 50) return 30; if (ult <= 60) return 25; return 20; }
function limiarQueda(ant)  { if (ant < 20) return null; if (ant < 40) return 30; if (ant <= 60) return 25; return 20; }
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=600');
  try {
    const { data, error } = await supabase.from('vw_top_movers_unificado_15d').select('ref_norm, u_ult15, u_ant15, var_pct');
    if (error) throw error;
    const out = {};
    for (const r of data || []) {
      const ult = Number(r.u_ult15) || 0, ant = Number(r.u_ant15) || 0, v = Number(r.var_pct);
      if (!Number.isFinite(v)) continue;
      if (v > 0) { const lim = limiarSubida(ult); if (lim != null && v >= lim) out[String(r.ref_norm)] = { tendencia: 'quente', ult, ant, var: Math.round(v), limiar: lim }; }
      else if (v < 0) { const lim = limiarQueda(ant); if (lim != null && -v >= lim) out[String(r.ref_norm)] = { tendencia: 'fria', ult, ant, var: Math.round(v), limiar: lim }; }
    }
    return res.status(200).json({ ok: true, regra: 'régua variável por volume (ver comentário no código)', refs: out });
  } catch (e) { return res.status(500).json({ ok: false, erro: String(e?.message || e) }); }
}
