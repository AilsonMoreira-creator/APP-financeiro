/**
 * lojas-leads-conversoes-cron.js — Cron de detecção automática de conversões
 *
 * Roda 1x por dia (madrugada BRT). Cruza:
 *   lojas_vendas (snapshot Miré, atualizado por outro cron) ↔
 *   lojas_leads_carrinho (leads do site Convertr, via doc/CNPJ/CPF)
 *
 * Janela: 14 dias retroativos (default).
 *
 * Pra cada match novo:
 *   - canal_pedido = 'site' se venda foi feita por vendedora 'CONVERTR'
 *   - canal_pedido = 'manual' caso contrário (Whats/loja física)
 *   - Crédito SITE: pra última vendedora que mandou msg no lead (se mandou
 *     dentro da janela). Sem msg = orgânica (não entra em lojas_conversoes).
 *   - Crédito MANUAL: pra vendedora que fez a venda no Miré.
 *
 * EXTENSÃO 18/05/2026 (Ailson — Sprint A Modal Fechamento):
 *   Após detectar conversões, gera AVISO celebrativo pra vendas no SITE que
 *   foram ORGÂNICAS (sem mensagem prévia) mas a cliente JÁ tem vendedora
 *   responsável atribuída (lojas_clientes.vendedora_id). Esses casos hoje
 *   passam invisíveis pra vendedora — agora aparecem no primeiro card como
 *   "🎉 sua cliente comprou! anota aí, vai pra tua comissão".
 *   Prefixo no texto: [VENDA_SITE_ORGANICA] — frontend renderiza diferente.
 *
 * Sessão Ailson 13/05/2026 — Onda 4 + extensão 18/05/2026.
 */
import { supabase, setCors } from './_lojas-helpers.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const userAgent = req.headers['user-agent'] || '';
  const ehCron = userAgent.startsWith('vercel-cron') || !!req.headers['x-vercel-cron'];
  if (!ehCron && req.query?.force !== '1') {
    return res.status(403).json({
      error: 'Endpoint só é chamado pelo cron Vercel. Use ?force=1 pra teste manual.',
    });
  }

  const tInicio = Date.now();
  // Janela ampliada pra 30 dias (era 14) — Ailson 19/05/2026.
  // Casos como Samanta (carrinho 23/04, compra 27/04) ficavam fora porque
  // o cron olha pra tras a partir de hoje. Se o cron pula 1-2 dias,
  // carrinhos antigos saem da janela. 30 dias cobre gaps de execucao.
  const dias = parseInt(req.query?.dias || '30', 10);

  try {
    // ───────────────────────────────────────────────────────────────
    // 1A. Detecta conversões de LEAD CARRINHO (lógica existente)
    // ───────────────────────────────────────────────────────────────
    const { data, error } = await supabase
      .rpc('lojas_leads_detectar_conversoes', { p_dias: dias })
      .maybeSingle();

    if (error) {
      console.error('[lojas-leads-conversoes-cron] erro lead:', error);
      return res.status(500).json({ error: error.message });
    }

    // ───────────────────────────────────────────────────────────────
    // 1B. Detecta conversões de SUGESTÃO IA — Ailson 19/05/2026.
    // Cruza lojas_acoes (mensagem_enviada) ↔ lojas_vendas pra detectar
    // que cliente comprou após receber mensagem da vendedora. Usa
    // dedup por (cliente_id, venda_id) - última msg antes da compra.
    // ───────────────────────────────────────────────────────────────
    let sugestoesInseridas = 0;
    let sugestoesMsgsAvaliadas = 0;
    try {
      const { data: dataSug, error: errSug } = await supabase
        .rpc('lojas_detectar_conversoes_sugestoes', { p_dias: dias })
        .maybeSingle();
      if (errSug) {
        console.error('[lojas-leads-conversoes-cron] erro sugestao:', errSug);
      } else {
        sugestoesInseridas = dataSug?.inseridas || 0;
        sugestoesMsgsAvaliadas = dataSug?.msgs_avaliadas || 0;
      }
    } catch (e) {
      console.error('[lojas-leads-conversoes-cron] excecao sugestao:', e.message);
    }

    // ───────────────────────────────────────────────────────────────
    // 1C. Auto-vendeu Sofia (Ailson 26/05/2026)
    // Marca conversas Sofia ativas como etapa='vendeu' quando cliente
    // fechou compra dentro da janela (5d site / 15d loja) apos msg Sofia.
    // ───────────────────────────────────────────────────────────────
    let sofiaConvVendeu = 0;
    let sofiaValorVendeu = 0;
    try {
      const { data: dataSofia, error: errSofia } = await supabase
        .rpc('lojas_whats_auto_vendeu')
        .maybeSingle();
      if (errSofia) {
        console.error('[lojas-leads-conversoes-cron] erro sofia auto-vendeu:', errSofia);
      } else {
        sofiaConvVendeu = dataSofia?.conversas_atualizadas || 0;
        sofiaValorVendeu = dataSofia?.valor_total || 0;
      }
    } catch (e) {
      console.error('[lojas-leads-conversoes-cron] excecao sofia auto-vendeu:', e.message);
    }

    // ───────────────────────────────────────────────────────────────
    // 1D. Auto-vendeu Vesti (Ailson 02/06/2026 — teste A/B Fase 2)
    // Marca conversas do teste Vesti como etapa='vendeu', vendeu_canal='vesti'
    // quando (1) o link Vesti foi enviado na conversa E (2) rolou venda Vesti
    // depois, casada por telefone. Idempotente, additiva — roda junto sem risco.
    // ───────────────────────────────────────────────────────────────
    let vestiConvVendeu = 0;
    let vestiValorVendeu = 0;
    try {
      const { data: dataVesti, error: errVesti } = await supabase
        .rpc('lojas_whats_vesti_auto_vendeu')
        .maybeSingle();
      if (errVesti) {
        console.error('[lojas-leads-conversoes-cron] erro vesti auto-vendeu:', errVesti);
      } else {
        vestiConvVendeu = dataVesti?.conversas_marcadas || 0;
        vestiValorVendeu = dataVesti?.valor_total || 0;
      }
    } catch (e) {
      console.error('[lojas-leads-conversoes-cron] excecao vesti auto-vendeu:', e.message);
    }

    // ───────────────────────────────────────────────────────────────
    // 2. EXTENSÃO Ailson 18/05/2026 — Aviso venda_site_organica
    // ───────────────────────────────────────────────────────────────
    // Pra vendas no site dos últimos 2 dias que NÃO entraram em
    // lojas_conversoes (orgânicas), mas a cliente tem vendedora_responsavel:
    // cria aviso celebrativo pra vendedora ver no primeiro card.
    let avisosOrganicasCriados = 0;
    try {
      const dataLimiteOrg = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);

      // Vendas do site nos últimos 2 dias com cliente_id válido
      const { data: vendasSite } = await supabase
        .from('lojas_vendas')
        .select('id, cliente_id, data_venda, valor_liquido, canal_origem')
        .in('canal_origem', ['convertr', 'vesti'])
        .gte('data_venda', dataLimiteOrg)
        .not('cliente_id', 'is', null);

      if (vendasSite?.length > 0) {
        // IDs das vendas que JÁ entraram em lojas_conversoes
        const vendaIds = vendasSite.map(v => v.id);
        const { data: convExistentes } = await supabase
          .from('lojas_conversoes')
          .select('venda_id, atendido_por')
          .in('venda_id', vendaIds);
        // Vendas tratadas por outro caminho (vendedora chamou / sofia / venda na loja)
        // NAO precisam do aviso "comprou no site". Mas as 'dona_carteira' (cliente
        // da vendedora comprou no site direto, sem ela ver) PRECISAM do aviso +
        // ja contam comissao pra ela — entao NAO entram no set de exclusao.
        // Ailson 29/05/2026 (Regra A).
        const tratadasSet = new Set(
          (convExistentes || [])
            .filter(c => c.atendido_por !== 'dona_carteira')
            .map(c => c.venda_id)
        );

        // Processa orgânicas + dona_carteira (ambas = cliente comprou no site sem a vendedora)
        const organicas = vendasSite.filter(v => !tratadasSet.has(v.id));

        if (organicas.length > 0) {
          // Busca vendedora responsavel de cada cliente
          const clienteIds = [...new Set(organicas.map(v => v.cliente_id))];
          const { data: clientes } = await supabase
            .from('lojas_clientes')
            .select('id, apelido, comprador_nome, vendedora_id')
            .in('id', clienteIds)
            .not('vendedora_id', 'is', null);
          const vendedoraDoCliente = {};
          const nomeDoCliente = {};
          (clientes || []).forEach(c => {
            vendedoraDoCliente[c.id] = c.vendedora_id;
            nomeDoCliente[c.id]      = c.apelido || c.comprador_nome || 'sua cliente';
          });

          // Pra cada venda orgânica com vendedora atribuída, cria aviso
          // (idempotência: checa se já existe aviso pra esse venda_id)
          for (const v of organicas) {
            const vendedoraId = vendedoraDoCliente[v.cliente_id];
            if (!vendedoraId) continue;

            const dataDisparo = new Date(new Date(v.data_venda + 'T00:00:00').getTime() + 86400000)
              .toISOString().slice(0, 10);
            const nomeCli = nomeDoCliente[v.cliente_id];
            const valor = parseFloat(v.valor_liquido || 0).toFixed(2).replace('.', ',');
            const texto = `[VENDA_SITE_ORGANICA] 🎉 Sua cliente ${nomeCli} comprou no site! R$ ${valor}. Anota aí, vai pra tua comissão 💰`;

            // Idempotência: 1 aviso por venda
            const { data: avisoExistente } = await supabase
              .from('lojas_avisos')
              .select('id')
              .eq('cliente_id', v.cliente_id)
              .contains('vendedoras_ids', [vendedoraId])
              .ilike('texto', `%VENDA_SITE_ORGANICA%R$ ${valor}%`)
              .gte('data_disparo', dataLimiteOrg)
              .limit(1);

            if (avisoExistente?.length > 0) continue;

            const { error: errAviso } = await supabase
              .from('lojas_avisos')
              .insert({
                texto,
                data_disparo:   dataDisparo,
                vendedoras_ids: [vendedoraId],
                cliente_id:     v.cliente_id,
                status:         'pendente',
                criado_por:     'cron_organica',
              });

            if (!errAviso) avisosOrganicasCriados++;
          }
        }
      }
    } catch (e) {
      // Falha aqui não derruba o cron principal — log e segue
      console.warn('[lojas-leads-conversoes-cron] erro avisos orgânicas:', e.message);
    }

    return res.json({
      ok: true,
      janela_dias: dias,
      duracao_ms: Date.now() - tInicio,
      conversoes_inseridas: data?.conversoes_inseridas || 0,
      conv_site: data?.conv_site || 0,
      conv_manual: data?.conv_manual || 0,
      conv_organicas: data?.conv_organicas || 0,
      valor_total: data?.valor_total || 0,
      avisos_organicas_criados: avisosOrganicasCriados,
      // Conversoes por sugestao IA — Ailson 19/05/2026
      sugestoes_conv_inseridas: sugestoesInseridas,
      sugestoes_msgs_avaliadas: sugestoesMsgsAvaliadas,
      // Sofia auto-vendeu — Ailson 26/05/2026
      sofia_conv_vendeu: sofiaConvVendeu,
      sofia_valor_vendeu: sofiaValorVendeu,
      // Vesti auto-vendeu (teste A/B Fase 2) — Ailson 02/06/2026
      vesti_conv_vendeu: vestiConvVendeu,
      vesti_valor_vendeu: vestiValorVendeu,
    });
  } catch (e) {
    console.error('[lojas-leads-conversoes-cron] exception:', e);
    return res.status(500).json({
      error: e.message || 'Erro interno',
      duracao_ms: Date.now() - tInicio,
    });
  }
}
