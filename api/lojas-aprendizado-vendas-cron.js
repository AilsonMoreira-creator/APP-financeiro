/**
 * lojas-aprendizado-vendas-cron.js — Cron diário de aprendizado pós-sugestão
 *
 * Roda 1x/dia (madrugada BRT). Pra cada sugestão dos últimos 6 dias
 * (D-1 a D-6) que a vendedora ENVIOU via WhatsApp, busca vendas do cliente
 * em D+1 a D+5 (janela curta = causalidade forte).
 *
 * Diferenças vs lojas-leads-conversoes-cron:
 *   • Captura TODOS os status no envio (inclusive ATIVO) — invisível hoje
 *   • Janela 1-5 dias (não 0-15)
 *   • Inclui match de produto (produto_ref sugerido × refs efetivamente compradas)
 *   • NÃO afeta métrica de conversão do dashboard (tabela complementar)
 *
 * Idempotência: UNIQUE INDEX (sugestao_id, venda_id) evita duplicar.
 *
 * Sessão Ailson 18/05/2026 — Sprint A "Aprendizado IA em Clientes Ativos".
 */
import { supabase, setCors } from './_lojas-helpers.js';

// Mapeia tipo da sugestão → status_no_envio aproximado
// (mais barato que consultar KPI histórico, e suficiente pro learning)
function inferirStatusNoEnvio(tipoSugestao) {
  if (tipoSugestao === 'reativar')                          return 'inativo';
  if (tipoSugestao === 'atencao')                           return 'atencao';
  if (tipoSugestao === 'novidade')                          return 'ativo';
  if (tipoSugestao === 'followup' || tipoSugestao === 'followup_nova') return 'ativo';
  if (tipoSugestao === 'sacola')                            return 'ativo';
  return 'ativo'; // default seguro
}

function calcularProdutoMatch(refSugerida, refsCompradas) {
  if (!refSugerida)                                  return 'sem_ref';
  if (!Array.isArray(refsCompradas) || refsCompradas.length === 0) return 'sem_ref';

  // Normaliza (sem zero à esquerda)
  const norm = (r) => String(r || '').replace(/^0+/, '') || '0';
  const refNorm = norm(refSugerida);
  const refsNorm = refsCompradas.map(norm);

  const matched = refsNorm.includes(refNorm);
  if (!matched)                       return 'nenhum';
  if (refsNorm.length === 1)          return 'total';
  return 'parcial';
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Só permite cron Vercel ou ?force=1 manual
  const userAgent = req.headers['user-agent'] || '';
  const ehCron = userAgent.startsWith('vercel-cron') || !!req.headers['x-vercel-cron'];
  if (!ehCron && req.query?.force !== '1') {
    return res.status(403).json({
      error: 'Endpoint só é chamado pelo cron Vercel. Use ?force=1 pra teste manual.',
    });
  }

  const tInicio = Date.now();
  const hoje    = new Date();
  // Janela: sugestões de D-6 até D-1. Pra cada, vendas em D_sug+1..D_sug+5.
  // D-6 garante que mesmo sugestões mais antigas com janela 5d sejam cobertas.
  const dataInicio = new Date(hoje.getTime() - 6 * 86400000).toISOString().slice(0, 10);
  const dataFim    = new Date(hoje.getTime() - 1 * 86400000).toISOString().slice(0, 10);

  try {
    // ───────────────────────────────────────────────────────────────
    // 1. Carrega sugestões enviadas (com mensagem_enviada em lojas_acoes)
    // ───────────────────────────────────────────────────────────────
    const { data: sugestoes, error: errSug } = await supabase
      .from('lojas_sugestoes_diarias')
      .select('id, vendedora_id, cliente_id, data_geracao, tipo, produto_ref, alvo_tipo')
      .gte('data_geracao', dataInicio)
      .lte('data_geracao', dataFim)
      .eq('alvo_tipo', 'cliente')
      .not('cliente_id', 'is', null);

    if (errSug) {
      return res.status(500).json({ error: errSug.message });
    }

    if (!sugestoes || sugestoes.length === 0) {
      return res.json({
        ok: true,
        janela: { de: dataInicio, ate: dataFim },
        sugestoes_examinadas: 0,
        registros_inseridos: 0,
        duracao_ms: Date.now() - tInicio,
      });
    }

    // Filtra só as que tiveram mensagem_enviada
    const sugestaoIds = sugestoes.map(s => s.id);
    const { data: acoesEnvio } = await supabase
      .from('lojas_acoes')
      .select('sugestao_id')
      .in('sugestao_id', sugestaoIds)
      .eq('tipo_acao', 'mensagem_enviada');
    const enviadasSet = new Set((acoesEnvio || []).map(a => a.sugestao_id));
    const sugestoesEnviadas = sugestoes.filter(s => enviadasSet.has(s.id));

    if (sugestoesEnviadas.length === 0) {
      return res.json({
        ok: true,
        janela: { de: dataInicio, ate: dataFim },
        sugestoes_examinadas: sugestoes.length,
        sugestoes_enviadas: 0,
        registros_inseridos: 0,
        duracao_ms: Date.now() - tInicio,
      });
    }

    // ───────────────────────────────────────────────────────────────
    // 2. Pra cada sugestão, busca vendas do cliente em D+1..D+5
    // ───────────────────────────────────────────────────────────────
    const registros = [];
    let pulados = 0;

    for (const sug of sugestoesEnviadas) {
      const dataSugDate = new Date(sug.data_geracao + 'T00:00:00');
      const janelaIni   = new Date(dataSugDate.getTime() + 1 * 86400000).toISOString().slice(0, 10);
      const janelaFim   = new Date(dataSugDate.getTime() + 5 * 86400000).toISOString().slice(0, 10);

      const { data: vendas } = await supabase
        .from('lojas_vendas')
        .select('id, data_venda, valor_liquido, vendedora_id')
        .eq('cliente_id', sug.cliente_id)
        .gte('data_venda', janelaIni)
        .lte('data_venda', janelaFim);

      if (!vendas || vendas.length === 0) continue;

      for (const v of vendas) {
        // Pega refs do pedido (lojas_vendas_itens)
        const { data: itens } = await supabase
          .from('lojas_vendas_itens')
          .select('ref')
          .eq('venda_id', v.id);
        const refsCompradas = (itens || []).map(i => i.ref).filter(Boolean);

        const dataVendaDate = new Date(v.data_venda + 'T00:00:00');
        const dias = Math.round((dataVendaDate - dataSugDate) / 86400000);
        if (dias < 1 || dias > 5) { pulados++; continue; }

        // Snapshot do nome do cliente (pra histórico estável)
        const { data: cli } = await supabase
          .from('lojas_clientes')
          .select('apelido, comprador_nome')
          .eq('id', sug.cliente_id)
          .maybeSingle();

        registros.push({
          vendedora_id:    sug.vendedora_id,
          cliente_id:      sug.cliente_id,
          sugestao_id:     sug.id,
          data_sugestao:   sug.data_geracao,
          venda_id:        v.id,
          data_venda:      v.data_venda,
          dias_ate_compra: dias,
          valor_venda:     v.valor_liquido || 0,
          status_no_envio: inferirStatusNoEnvio(sug.tipo),
          ref_sugerida:    sug.produto_ref || null,
          refs_compradas:  refsCompradas.length > 0 ? refsCompradas : null,
          produto_match:   calcularProdutoMatch(sug.produto_ref, refsCompradas),
          cliente_nome:    cli?.apelido || cli?.comprador_nome || null,
        });
      }
    }

    // ───────────────────────────────────────────────────────────────
    // 3. UPSERT (idempotente via unique sugestao_id+venda_id)
    // ───────────────────────────────────────────────────────────────
    let inseridos = 0;
    if (registros.length > 0) {
      // Upsert em lotes de 100 (Supabase já lida bem)
      for (let i = 0; i < registros.length; i += 100) {
        const lote = registros.slice(i, i + 100);
        const { error: errUp, count } = await supabase
          .from('lojas_aprendizado_vendas')
          .upsert(lote, {
            onConflict: 'sugestao_id,venda_id',
            ignoreDuplicates: false,
            count: 'exact',
          });
        if (errUp) {
          console.error('[lojas-aprendizado-cron] upsert erro:', errUp.message);
        } else {
          inseridos += count || lote.length;
        }
      }
    }

    return res.json({
      ok: true,
      janela: { de: dataInicio, ate: dataFim },
      sugestoes_examinadas: sugestoes.length,
      sugestoes_enviadas:   sugestoesEnviadas.length,
      registros_inseridos:  inseridos,
      pulados,
      duracao_ms: Date.now() - tInicio,
    });
  } catch (e) {
    console.error('[lojas-aprendizado-cron] exception:', e);
    return res.status(500).json({
      error: e.message || 'Erro interno',
      duracao_ms: Date.now() - tInicio,
    });
  }
}
