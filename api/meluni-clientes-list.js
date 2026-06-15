// ============================================================================
// MELUNI — leitura da carteira de clientes (cards do front, via service-role).
// Filtros (query):
//   etapa: carteira (pool) | enviados | conversando | follow_up
//          (as 3 ultimas cruzam meluni_conversas origem='cliente' por etapa)
//   nome: busca por nome (ilike)
//   ordenar: valor | compras | recente
//   periodo_dias, janela_min/janela_max, msg_dias (recebeu msg nos ult. N dias)
//   limite. Ailson 13/06/2026.
// ============================================================================
import { supabase } from './_bling-helpers.js';

const diaISO = (d) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const q = req.query || {};
  const etapa = q.etapa || q.aba || 'carteira';
  const ordenar = q.ordenar || 'valor';
  const nome = (q.nome || '').trim();
  const periodoDias = q.periodo_dias ? parseInt(q.periodo_dias, 10) : null;
  const janelaMin = q.janela_min ? parseInt(q.janela_min, 10) : null;
  const janelaMax = q.janela_max ? parseInt(q.janela_max, 10) : null;
  const msgDias = q.msg_dias ? parseInt(q.msg_dias, 10) : null;
  const limite = Math.min(1000, parseInt(q.limite || '300', 10) || 300);

  try {
    let qy = supabase.from('meluni_clientes').select('*');

    // etapas enviados/conversando/follow_up vem do funil de conversas (origem cliente)
    if (etapa && etapa !== 'carteira') {
      const { data: convs } = await supabase
        .from('meluni_conversas')
        .select('cliente_id')
        .eq('origem', 'cliente')
        .eq('etapa', etapa)
        .not('cliente_id', 'is', null);
      const ids = [...new Set((convs || []).map(c => c.cliente_id))];
      if (!ids.length) return res.json({ ok: true, total: 0, etapa, clientes: [] });
      qy = qy.in('id', ids);
    }

    if (nome) qy = qy.ilike('nome', `%${nome}%`);
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
      const tels = lista.map(c => c.whatsapp || c.telefone).filter(Boolean);
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
      lista = lista.filter(c => comMsg.has(c.whatsapp || c.telefone));
    }

    return res.json({ ok: true, total: lista.length, etapa, clientes: lista });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: e?.message || String(e) });
  }
}
