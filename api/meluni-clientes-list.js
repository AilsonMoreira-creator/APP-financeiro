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
import { anexarTags } from './_meluni-tags-anexar.js';

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

    // CONVERSAO (Ailson 04/08/2026): agora e REGISTRO — le do log meluni_conversoes
    // (nome, valor, data, template de origem); a cliente nao fica presa em etapa.
    let extrasConv = null;
    if (etapa === 'conversao') {
      const { data: convsLog } = await supabase
        .from('meluni_conversoes')
        .select('cliente_id, pedido_id, valor, template_origem, convertido_em')
        .order('convertido_em', { ascending: false })
        .limit(500);
      const idsSeq = [];
      extrasConv = new Map();
      (convsLog || []).forEach(cv => {
        if (!cv.cliente_id) return;
        if (!extrasConv.has(cv.cliente_id)) { extrasConv.set(cv.cliente_id, cv); idsSeq.push(cv.cliente_id); }
      });
      if (!idsSeq.length) return res.json({ ok: true, total: 0, etapa, clientes: [] });
      qy = qy.in('id', idsSeq);
    }
    // etapas enviados/conversando/follow_up vem do funil de conversas (origem cliente)
    if (etapa && etapa !== 'carteira' && etapa !== 'conversao') {
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
    if (extrasConv) {
      lista.forEach(c => {
        const cv = extrasConv.get(c.id);
        if (cv) { c.conv_valor = cv.valor; c.conv_em = cv.convertido_em; c.conv_origem = cv.template_origem; c.conv_pedido = cv.pedido_id; }
      });
      lista.sort((a, b) => new Date(b.conv_em || 0) - new Date(a.conv_em || 0));
    }

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

    // conversões dos últimos 30 dias -> badge azul na aba Conversão (espelha o carrinho)
    const desde30 = new Date(Date.now() - 30 * 86400000).toISOString();
    const { count: conv30 } = await supabase.from('meluni_conversoes')
      .select('id', { count: 'exact', head: true })
      .gte('convertido_em', desde30);

    await anexarTags(supabase, lista, c => c.whatsapp || c.telefone);

    // DISPAROS DE HOJE (Ailson 04/08/2026): contadores por grupo (pos-compra,
    // cross-sell, campanha manual) + marcador por cliente pros filtros dos pills
    const disparosHoje = { poscompra: 0, crossell: 0, campanha: 0 };
    try {
      const { data: cfgPosRow } = await supabase.from('meluni_config').select('valor').eq('chave', 'lara_templates_clientes').maybeSingle();
      const { data: cfgNovRow } = await supabase.from('meluni_config').select('valor').eq('chave', 'lara_templates_novidade').maybeSingle();
      const vPos = typeof cfgPosRow?.valor === 'string' ? JSON.parse(cfgPosRow.valor) : (cfgPosRow?.valor || {});
      const vNov = typeof cfgNovRow?.valor === 'string' ? JSON.parse(cfgNovRow.valor) : (cfgNovRow?.valor || {});
      const grupoPorNome = {};
      [vPos?.templates?.curta?.name, vPos?.templates?.pessoal?.name].filter(Boolean).forEach(n => { grupoPorNome[n] = 'poscompra'; });
      ['crossell_mesmo_modelo', 'crossell_outro_modelo'].forEach(n => { grupoPorNome[n] = 'crossell'; });
      Object.values(vNov?.templates || {}).forEach(t => { if (t?.name) grupoPorNome[t.name] = 'campanha'; });
      const nomes = Object.keys(grupoPorNome);
      if (nomes.length) {
        const hoje0 = new Date(); // 00h de hoje em BRT
        const brtNow = new Date(hoje0.getTime() - 3 * 3600e3);
        const dia0 = new Date(Date.UTC(brtNow.getUTCFullYear(), brtNow.getUTCMonth(), brtNow.getUTCDate(), 3, 0, 0)).toISOString();
        const { data: msgsHoje } = await supabase.from('meluni_mensagens')
          .select('conversa_id, template_usado')
          .in('template_usado', nomes).gte('enviada_em', dia0).limit(3000);
        const grupoPorConv = new Map();
        (msgsHoje || []).forEach(m => {
          const g = grupoPorNome[m.template_usado];
          if (!g) return;
          disparosHoje[g]++;
          if (m.conversa_id && !grupoPorConv.has(m.conversa_id)) grupoPorConv.set(m.conversa_id, new Set());
          if (m.conversa_id) grupoPorConv.get(m.conversa_id).add(g);
        });
        const convIdsH = [...grupoPorConv.keys()];
        if (convIdsH.length) {
          const porCliH = new Map(), porTelH = new Map();
          for (let i = 0; i < convIdsH.length; i += 300) {
            const chunk = convIdsH.slice(i, i + 300);
            const { data: convsH } = await supabase.from('meluni_conversas').select('id, telefone, cliente_id').in('id', chunk);
            (convsH || []).forEach(cv => {
              const gs = grupoPorConv.get(cv.id) || new Set();
              if (cv.cliente_id) porCliH.set(cv.cliente_id, new Set([...(porCliH.get(cv.cliente_id) || []), ...gs]));
              if (cv.telefone) porTelH.set(cv.telefone, new Set([...(porTelH.get(cv.telefone) || []), ...gs]));
            });
          }
          lista.forEach(c => {
            const gs = porCliH.get(c.id) || porTelH.get(c.whatsapp || c.telefone);
            if (!gs) return;
            if (gs.has('poscompra')) c.poscompra_hoje = true;
            if (gs.has('crossell')) c.crossell_hoje = true;
            if (gs.has('campanha')) c.campanha_hoje = true;
          });
        }
      }
    } catch (eDh) { console.error('[clientes-list] disparos hoje', eDh?.message); }

    // tag CROSS-SELL (Ailson 03/08/2026): marca quem ja recebeu o cross-sell
    // automatico (mensagens dos templates crossell_*), pro card mostrar a tag
    try {
      const { data: msgsCross } = await supabase.from('meluni_mensagens')
        .select('conversa_id, enviada_em')
        .in('template_usado', ['crossell_mesmo_modelo', 'crossell_outro_modelo'])
        .limit(5000);
      const convCross = [...new Set((msgsCross || []).map(m => m.conversa_id).filter(Boolean))];
      if (convCross.length) {
        const emPorConv = {};
        (msgsCross || []).forEach(m => { if (m.conversa_id) emPorConv[m.conversa_id] = m.enviada_em; });
        const { data: convsC } = await supabase.from('meluni_conversas')
          .select('id, telefone, cliente_id').in('id', convCross);
        const porCli = new Map(), porTel = new Map();
        (convsC || []).forEach(cv => {
          if (cv.cliente_id) porCli.set(cv.cliente_id, emPorConv[cv.id]);
          if (cv.telefone) porTel.set(cv.telefone, emPorConv[cv.id]);
        });
        lista.forEach(c => {
          const em = porCli.get(c.id) || porTel.get(c.whatsapp || c.telefone) || null;
          if (em) c.crossell_em = em;
        });
      }
    } catch (eCx) { console.error('[clientes-list] tag crossell', eCx?.message); }

    return res.json({ ok: true, total: lista.length, etapa, unread, conv30: conv30 || 0, disparos_hoje: disparosHoje, clientes: lista });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: e?.message || String(e) });
  }
}
