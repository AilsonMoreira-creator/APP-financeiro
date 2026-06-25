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

    // CARTEIRA = só clientes de verdade (com compra). Cadastros sem compra ficam
    // ocultos aqui, mas continuam no banco pra alimentar o match de carrinho.
    // Ailson 16/06/2026.
    if (!etapa || etapa === 'carteira') {
      qy = qy.or('n_compras.gt.0,valor_lifetime.gt.0');
    }

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

    // conversa sem resposta (origem cliente, última msg "in") — marca card + conta por aba
    const { data: convsPend } = await supabase.from('meluni_conversas')
      .select('cliente_id, telefone, etapa, visto_em, ultima_msg_em')
      .eq('origem', 'cliente')
      .in('ultima_msg_direcao', ['in', 'entrada']);
    const pendCli = new Set(), pendTel = new Set();
    const pendEmCli = new Map(), pendEmTel = new Map();
    const unread = {};
    for (const c of (convsPend || [])) {
      // já vista (aberta depois da última entrada) não conta mais
      if (c.visto_em && c.ultima_msg_em && new Date(c.ultima_msg_em) <= new Date(c.visto_em)) continue;
      if (c.cliente_id) { pendCli.add(c.cliente_id); pendEmCli.set(c.cliente_id, c.ultima_msg_em); }
      const t = (c.telefone || '').replace(/\D/g, '');
      if (t.length >= 10) { pendTel.add(t.slice(-10)); pendEmTel.set(t.slice(-10), c.ultima_msg_em); }
      const et = c.etapa || 'conversando';
      unread[et] = (unread[et] || 0) + 1;
    }
    lista = lista.map(c => {
      const t = (c.whatsapp || c.telefone || '').replace(/\D/g, '').slice(-10);
      const pend = (pendCli.has(c.id)) || (t && pendTel.has(t));
      const pendente_em = pend ? (pendEmCli.get(c.id) || (t && pendEmTel.get(t)) || null) : null;
      return { ...c, conversa_pendente: !!pend, pendente_em };
    });

    return res.json({ ok: true, total: lista.length, etapa, unread, clientes: lista });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: e?.message || String(e) });
  }
}
