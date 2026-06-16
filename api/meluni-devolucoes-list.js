// ============================================================================
// MELUNI — leitura das devoluções POR PEÇA (cards + chat), via service-role.
// Lê de vw_meluni_devolucoes (deriva fluxo_status, recebido automático do
// histórico, ordena com completas/canceladas apagadas no fim, esconde arquivadas).
// Query: etapa (todas | aguardando_conferir | aguardando_estorno | canceladas).
// Marca conversa_pendente quando existe conversa de devolução com última msg "in".
// Ailson 15/06/2026.
// ============================================================================
import { supabase } from './_bling-helpers.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const etapa = (req.query || {}).etapa || 'todas';

  try {
    let qy = supabase.from('vw_meluni_devolucoes')
      .select('*')
      .order('rank_aberto', { ascending: true })
      .order('fluxo_desde', { ascending: true, nullsFirst: false });

    if (etapa === 'aguardando_conferir') qy = qy.eq('fluxo_status', 'aguardando_conferir');
    else if (etapa === 'aguardando_estorno') qy = qy.eq('fluxo_status', 'aguardando_estorno');
    else if (etapa === 'canceladas') qy = qy.eq('fluxo_status', 'cancelada');

    const { data, error } = await qy;
    if (error) throw new Error(error.message);
    let lista = data || [];

    // conversa sem resposta: conversa origem='devolucao' com última msg "in"
    const cids = [...new Set(lista.map(d => d.cliente_id).filter(Boolean))];
    const tels = [...new Set(lista.map(d => (d.telefone || '').replace(/\D/g, '')).filter(t => t.length >= 10))];
    let convCli = new Set(), convTel = new Set();
    if (cids.length || tels.length) {
      const { data: convs } = await supabase.from('meluni_conversas')
        .select('cliente_id,telefone,ultima_msg_direcao,etapa')
        .eq('origem', 'devolucao')
        .eq('ultima_msg_direcao', 'in');
      for (const c of (convs || [])) {
        if (c.cliente_id) convCli.add(c.cliente_id);
        const t = (c.telefone || '').replace(/\D/g, '');
        if (t.length >= 10) convTel.add(t.slice(-10));
      }
    }
    lista = lista.map(d => {
      const t = (d.telefone || '').replace(/\D/g, '').slice(-10);
      const pend = (d.cliente_id && convCli.has(d.cliente_id)) || (t && convTel.has(t));
      return { ...d, conversa_pendente: !!pend };
    });

    // contagem de conversas sem resposta por aba (badge vermelho, idêntico Sofia)
    const unread = { todas: 0, aguardando_conferir: 0, aguardando_estorno: 0, canceladas: 0 };
    if (convCli.size || convTel.size) {
      const { data: todos } = await supabase.from('vw_meluni_devolucoes')
        .select('cliente_id,telefone,fluxo_status');
      for (const d of (todos || [])) {
        const t = (d.telefone || '').replace(/\D/g, '').slice(-10);
        const pend = (d.cliente_id && convCli.has(d.cliente_id)) || (t && convTel.has(t));
        if (!pend) continue;
        unread.todas++;
        if (d.fluxo_status === 'aguardando_conferir') unread.aguardando_conferir++;
        else if (d.fluxo_status === 'aguardando_estorno') unread.aguardando_estorno++;
        else if (d.fluxo_status === 'cancelada') unread.canceladas++;
      }
    }

    return res.json({ ok: true, etapa, total: lista.length, unread, devolucoes: lista });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: e?.message || String(e) });
  }
}
