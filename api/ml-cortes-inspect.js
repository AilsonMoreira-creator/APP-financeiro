/**
 * ml-cortes-inspect.js — Mostra detalhes da matriz de cortes ativos
 *                       pra REFs específicas (debug do forecast).
 *
 * Uso:
 *   GET /api/ml-cortes-inspect?refs=02832,02708,02773
 *   GET /api/ml-cortes-inspect  (sem params: mostra TODAS as refs com cortes ativos)
 */
import { supabase, setCors } from './_ml-helpers.js';

const JANELA_DIAS = 30;

function refMatch(a, b) {
  if (!a || !b) return false;
  return String(a).replace(/^0+/, '').trim() === String(b).replace(/^0+/, '').trim();
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const refsParam = String(req.query.refs || '').trim();
  const refsFiltro = refsParam ? refsParam.split(',').map(r => r.trim()) : null;

  const { data: row } = await supabase.from('amicia_data')
    .select('payload').eq('user_id', 'ailson_cortes').maybeSingle();
  const todosCortes = row?.payload?.cortes || [];

  const desdeMs = Date.now() - JANELA_DIAS * 86400000;
  const ativos = todosCortes.filter(c => {
    if (!c || c.entregue) return false;
    if (refsFiltro && !refsFiltro.some(r => refMatch(c.ref, r))) return false;
    const dt = new Date(c.data).getTime();
    if (isNaN(dt) || dt < desdeMs) return false;
    return true;
  });

  // Agrupa por ref
  const porRef = {};
  for (const c of ativos) {
    const refNorm = String(c.ref).replace(/^0+/, '').padStart(5, '0');
    if (!porRef[refNorm]) porRef[refNorm] = [];
    const dias = Math.floor((Date.now() - new Date(c.data).getTime()) / 86400000);
    porRef[refNorm].push({
      id: c.id,
      nCorte: c.nCorte,
      ref: c.ref,
      descricao: c.descricao,
      oficina: c.oficina,
      data: c.data,
      dias_decorridos: dias,
      qtd: c.qtd,
      qtdEntregue: c.qtdEntregue,
      entregue: c.entregue,
      cores_matriz: c.detalhes?.cores || null,
      tamanhos_matriz: c.detalhes?.tamanhos || null,
      tem_matriz: !!(c.detalhes?.cores?.length),
    });
  }

  return res.status(200).json({
    timestamp: new Date().toISOString(),
    total_cortes_payload: todosCortes.length,
    refs_filtradas: refsFiltro,
    refs_encontradas: Object.keys(porRef),
    cortes_por_ref: porRef,
  });
}
