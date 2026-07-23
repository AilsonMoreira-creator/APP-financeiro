// api/lojas-whats-funil-leads.js
// Funil de engajamento de leads da tela Conversao Sofia (Ailson 05/07/2026).
//
//   GET ?data_inicio=YYYY-MM-DD&data_fim=YYYY-MM-DD&vendedora_id=uuid
//
// Classificacao (cada lead numa UNICA faixa, hierarquia de cima pra baixo):
//   vendas  = etapa 'vendeu'
//   quente  = foi atribuida a vendedora OU (5+ msgs da cliente alem da
//             abertura E mandou foto)
//   media   = 3+ msgs alem da abertura (sem foto / sem vendedora)
//   leve    = 1-2 msgs alem da abertura
//   sem     = so a mensagem de abertura (ou nenhuma resposta, em lead de
//             template tipo carrinho/visita site)
// Calculo pesado fica na fn_sofia_funil_leads (SQL, uma passada).
//
// Resposta:
//   { periodo, origens: [{origem, total, sem_interacao, leve, media, quente,
//     vendas, valor_vendas}], totais: {...}, vendedoras: [{id, nome}],
//     vendas_30d: { qtd, valor, itens: [...] } }  <- SEMPRE ultimos 30d,
//     independente do filtro (bloco fixo do topo da tela).

import { supabase, setCors } from './_lojas-whats-helpers.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const hoje = new Date();
    const hojeStr = hoje.toISOString().slice(0, 10);
    const d30 = new Date(hoje.getTime() - 30 * 86400000).toISOString().slice(0, 10);

    const dataInicio = req.query?.data_inicio || d30;
    const dataFim = req.query?.data_fim || hojeStr;
    const vendedoraId = req.query?.vendedora_id || null;

    const reData = /^\d{4}-\d{2}-\d{2}$/;
    if (!reData.test(dataInicio) || !reData.test(dataFim)) {
      return res.status(400).json({ error: 'data_inicio/data_fim devem ser YYYY-MM-DD' });
    }

    // fim exclusivo: dia seguinte 00:00 (pega o dia inteiro de data_fim)
    const fimExcl = new Date(new Date(dataFim + 'T00:00:00Z').getTime() + 86400000)
      .toISOString();

    const [funilQ, vendsQ, vendas30Q] = await Promise.all([
      supabase.rpc('fn_sofia_funil_leads', {
        p_ini: dataInicio + 'T00:00:00Z',
        p_fim: fimExcl,
        p_vendedora: vendedoraId || null,
      }),
      supabase.from('lojas_vendedoras').select('id, nome').order('nome'),
      // Bloco fixo do topo: vendas dos ultimos 30 dias (etapa vendeu),
      // com dados pros cards iguais aos da lista de conversas.
      // vendeu_em null entra tambem (cinto de seguranca: venda marcada sem
      // data nunca some do topo; fallback de data no map). Ailson 05/07/2026.
      supabase.from('lojas_whats_conversas')
        .select('id, nome_cliente, telefone, vendeu_valor, vendeu_em, vendeu_canal, origem_lead, qtd_pecas, vendedora_atribuida_id, carrinho_id, ultima_atividade_em')
        .eq('etapa', 'vendeu')
        .or(`vendeu_em.gte.${new Date(Date.now() - 30 * 86400000).toISOString()},vendeu_em.is.null`)
        .order('vendeu_em', { ascending: false, nullsFirst: false }),
    ]);

    if (funilQ.error) {
      console.error('[funil-leads] rpc:', funilQ.error);
      return res.status(500).json({ error: funilQ.error.message });
    }

    const origens = (funilQ.data || []).map(r => ({
      ...r,
      valor_vendas: Number(r.valor_vendas || 0),
      // Vendas do PERIODO por data da venda (qualquer safra, inclui manuais).
      // E o numero que a tela exibe desde 23/07/2026.
      vendas_periodo: Number(r.vendas_periodo || 0),
      valor_vendas_periodo: Number(r.valor_vendas_periodo || 0),
    }));

    const totais = origens.reduce((a, r) => ({
      total: a.total + Number(r.total),
      sem_interacao: a.sem_interacao + Number(r.sem_interacao),
      leve: a.leve + Number(r.leve),
      media: a.media + Number(r.media),
      quente: a.quente + Number(r.quente),
      vendas: a.vendas + Number(r.vendas),
      valor_vendas: a.valor_vendas + Number(r.valor_vendas),
      vendas_periodo: a.vendas_periodo + Number(r.vendas_periodo || 0),
      valor_vendas_periodo: a.valor_vendas_periodo + Number(r.valor_vendas_periodo || 0),
    }), { total: 0, sem_interacao: 0, leve: 0, media: 0, quente: 0, vendas: 0, valor_vendas: 0, vendas_periodo: 0, valor_vendas_periodo: 0 });

    const nomeV = new Map((vendsQ.data || []).map(v => [v.id, v.nome]));
    const itens30 = (vendas30Q.data || []).map(c => ({
      id: c.id,
      nome_cliente: c.nome_cliente,
      telefone: c.telefone,
      vendeu_valor: Number(c.vendeu_valor || 0),
      vendeu_em: c.vendeu_em || c.ultima_atividade_em,
      vendeu_canal: c.vendeu_canal,
      origem_lead: (c.carrinho_id && !c.origem_lead) ? 'carrinho_site_amicialoja' : c.origem_lead,
      qtd_pecas: c.qtd_pecas,
      vendedora_nome: nomeV.get(c.vendedora_atribuida_id) || null,
    }));

    return res.status(200).json({
      periodo: { inicio: dataInicio, fim: dataFim },
      origens,
      totais,
      vendedoras: vendsQ.data || [],
      vendas_30d: {
        qtd: itens30.length,
        valor: itens30.reduce((a, x) => a + x.vendeu_valor, 0),
        itens: itens30,
      },
    });
  } catch (e) {
    console.error('[funil-leads]', e);
    return res.status(500).json({ error: 'erro_interno' });
  }
}
