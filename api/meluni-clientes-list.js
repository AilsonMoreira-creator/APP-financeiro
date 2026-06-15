// ============================================================================
// MELUNI — leitura da carteira de clientes (pro card do front, via service-role).
// Filtros (query): aba (carteira|clientes), ordenar (valor|compras|recente),
//   periodo_dias (ultima_compra >= hoje-N), janela_min/janela_max (ultima compra
//   entre hoje-max e hoje-min, ex 10 a 15 dias), msg_dias (recebeu msg nos ult. N
//   dias — cruza meluni_conversas), limite. Ailson 13/06/2026.
// ============================================================================
import { supabase } from './_bling-helpers.js';

const diaISO = (d) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const q = req.query || {};
  const aba = q.aba || 'clientes';
  const ordenar = q.ordenar || 'valor';
  const periodoDias = q.periodo_dias ? parseInt(q.periodo_dias, 10) : null;
  const janelaMin = q.janela_min ? parseInt(q.janela_min, 10) : null;
  const janelaMax = q.janela_max ? parseInt(q.janela_max, 10) : null;
  const msgDias = q.msg_dias ? parseInt(q.msg_dias, 10) : null;
  const limite = Math.min(500, parseInt(q.limite || '200', 10) || 200);

  try {
    let qy = supabase.from('meluni_clientes').select('*');

    if (aba === 'carteira') qy = qy.gt('n_compras', 0);
    if (periodoDias) qy = qy.gte('ultima_compra', diaISO(periodoDias));
    if (janelaMax != null) qy = qy.gte('ultima_compra', diaISO(janelaMax));
    if (janelaMin != null) qy = qy.lte('ultima_compra', diaISO(janelaMin));

    const col = ordenar === 'compras' ? 'n_compras' : ordenar === 'recente' ? 'ultima_compra' : 'valor_lifetime';
    qy = qy.order(col, { ascending: false, nullsFirst: false }).limit(limite);

    const { data, error } = await qy;
    if (error) throw new Error(error.message);
    let lista = data || [];

    // filtro "recebeu mensagem nos ult. N dias" (cruza conversas por telefone)
    if (msgDias && lista.length) {
      const desde = new Date(Date.now() - msgDias * 86400000).toISOString();
      const tels = lista.map(c => c.telefone).filter(Boolean);
      const comMsg = new Set();
      for (let i = 0; i < tels.length; i += 200) {
        const chunk = tels.slice(i, i + 200);
        const { data: conv } = await supabase
          .from('meluni_conversas')
          .select('telefone, ultima_msg_em')
          .in('telefone', chunk)
          .gte('ultima_msg_em', desde);
        for (const c of conv || []) comMsg.add(c.telefone);
      }
      lista = lista.filter(c => comMsg.has(c.telefone));
    }

    return res.json({ ok: true, total: lista.length, clientes: lista });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: e?.message || String(e) });
  }
}
