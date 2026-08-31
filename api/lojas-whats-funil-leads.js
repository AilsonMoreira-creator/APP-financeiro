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

    const [funilQ, vendsQ, vendas30Q, siteQ, recQ] = await Promise.all([
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
        .select('id, nome_cliente, telefone, documento, vendeu_valor, vendeu_em, vendeu_canal, origem_lead, qtd_pecas, vendedora_atribuida_id, carrinho_id, ultima_atividade_em')
        .eq('etapa', 'vendeu')
        .or(`vendeu_em.gte.${new Date(Date.now() - 30 * 86400000).toISOString()},vendeu_em.is.null`)
        .order('vendeu_em', { ascending: false, nullsFirst: false }),
      // Vendas do SITE (vendedor CONVERTR) dos ultimos 30d — card "compra
      // direta" da Conversao (Ailson 30/07/2026)
      supabase.from('lojas_vendas')
        .select('numero_pedido, data_venda, valor_liquido, cliente_razao_raw, documento_cliente_raw, cliente_whatsapp_raw')
        .eq('vendedora_nome_raw', 'CONVERTR')
        .gte('data_venda', d30)
        .order('data_venda', { ascending: false }),
      // 31/08 (regra dele): RECOMPRA de cliente que ja comprou antes NAO e
      // conversao nova de origem — vai pro card "Compras recorrentes". Unica
      // excecao: compra direta no site sem conversa, que segue no card do site.
      supabase.rpc('fn_sofia_vendas_recorrentes', {
        p_ini: dataInicio + 'T00:00:00Z',
        p_fim: fimExcl,
      }),
    ]);

    if (funilQ.error) {
      console.error('[funil-leads] rpc:', funilQ.error);
      return res.status(500).json({ error: funilQ.error.message });
    }

    // Recorrentes do periodo por origem (e itens pro card novo).
    const recRows = (recQ?.data || []).filter(r => r.recorrente);
    const recPorOrigem = {};
    for (const r of recRows) {
      const o = r.origem || 'desconhecida';
      if (!recPorOrigem[o]) recPorOrigem[o] = { qtd: 0, valor: 0 };
      recPorOrigem[o].qtd += 1;
      recPorOrigem[o].valor += Number(r.vendeu_valor || 0);
    }

    const origens = (funilQ.data || []).map(r => ({
      ...r,
      valor_vendas: Number(r.valor_vendas || 0),
      // Vendas do PERIODO por data da venda (qualquer safra, inclui manuais).
      // E o numero que a tela exibe desde 23/07/2026.
      // vendas do periodo LIQUIDAS de recompra: o card da origem mede venda
      // NOVA; a recompra vive no card "Compras recorrentes". Ailson 31/08.
      vendas_periodo: Math.max(0, Number(r.vendas_periodo || 0) - (recPorOrigem[r.origem]?.qtd || 0)),
      valor_vendas_periodo: Math.max(0, Number(r.valor_vendas_periodo || 0) - (recPorOrigem[r.origem]?.valor || 0)),
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
      // Card novo (Ailson 31/08): recompras do periodo — mesmo filtro de datas
      // dos outros cards. Excecao ja garantida pela estrutura: compra direta no
      // site sem conversa nao passa por aqui (vive em site_direto_30d).
      recorrentes: {
        qtd: recRows.length,
        valor: recRows.reduce((a, r) => a + Number(r.vendeu_valor || 0), 0),
        itens: recRows
          .sort((a, b) => new Date(b.vendeu_em) - new Date(a.vendeu_em))
          .slice(0, 60)
          .map(r => ({
            conversa_id: r.conversa_id,
            nome_cliente: r.nome_cliente,
            valor: Number(r.vendeu_valor || 0),
            vendeu_em: r.vendeu_em,
            origem: r.origem,
            compras_antes: Number(r.compras_antes || 0),
            primeira_compra: r.primeira_compra,
          })),
      },
      vendas_30d: {
        qtd: itens30.length,
        valor: itens30.reduce((a, x) => a + x.vendeu_valor, 0),
        itens: itens30,
      },
      // COMPRA DIRETA no site (Ailson 30/07/2026): pedidos CONVERTR SEM
      // carrinho/conversa antes. Quem teve carrinho e finalizou no site ja
      // aparece na aba Vendeu — dedup por documento OU telefone da conversa.
      site_direto_30d: (() => {
        const soDig = (x) => String(x || '').replace(/\D/g, '');
        const semDdi = (t) => { const d = soDig(t); return d.startsWith('55') && d.length >= 12 ? d.slice(2) : d; };
        const docsVendeu = new Set((vendas30Q.data || []).map(c => soDig(c.documento)).filter(Boolean));
        const telsVendeu = new Set((vendas30Q.data || []).map(c => semDdi(c.telefone)).filter(Boolean));
        const itens = (siteQ.data || []).filter(v => {
          const doc = soDig(v.documento_cliente_raw);
          const tel = semDdi(v.cliente_whatsapp_raw);
          if (doc && docsVendeu.has(doc)) return false;
          if (tel && telsVendeu.has(tel)) return false;
          return true;
        }).map(v => ({
          numero_pedido: v.numero_pedido,
          nome_cliente: v.cliente_razao_raw,
          valor: Number(v.valor_liquido || 0),
          data: v.data_venda,
        }));
        return { qtd: itens.length, valor: itens.reduce((a, x) => a + x.valor, 0), itens };
      })(),
    });
  } catch (e) {
    console.error('[funil-leads]', e);
    return res.status(500).json({ error: 'erro_interno' });
  }
}
