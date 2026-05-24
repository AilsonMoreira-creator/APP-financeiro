// ═══════════════════════════════════════════════════════════════════════════
// lojas-whats-cron-resumir.js — Gera resumo semanal do que Sofia aprendeu
// ═══════════════════════════════════════════════════════════════════════════
//
// Roda toda SEGUNDA 06h BRT (09h UTC). Verifica se houve >=30 atendimentos
// novos desde o ultimo resumo. Se sim, manda os padroes pro Claude Sonnet
// gerar prosa "O que aprendi essa semana".
//
// Salva em lojas_whats_aprendizado_resumos pra auditoria via UI.
//
// Decisao 2C (Ailson): semanal + condicional >=30 atendimentos.
// ═══════════════════════════════════════════════════════════════════════════

import { supabase, setCors } from './_lojas-whats-helpers.js';

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const MODELO_RESUMO = 'claude-sonnet-4-6';
const MIN_NOVOS_PARA_RESUMIR = 30;

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const ua = req.headers['user-agent'] || '';
  const ehCron = ua.startsWith('vercel-cron') || !!req.headers['x-vercel-cron'];
  if (!ehCron && req.query?.force !== '1') {
    return res.status(403).json({ error: 'Cron only. Use ?force=1 pra teste.' });
  }
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY nao definida' });

  const tInicio = Date.now();
  try {
    // Pega data do ultimo resumo
    const { data: ultimoResumo } = await supabase
      .from('lojas_whats_aprendizado_resumos')
      .select('ate_data, criado_em')
      .order('ate_data', { ascending: false })
      .limit(1).maybeSingle();

    const corte = ultimoResumo?.ate_data || '2026-01-01';

    // Quantos atendimentos novos desde o corte?
    const { count: totalNovos } = await supabase
      .from('lojas_whats_conversas')
      .select('*', { count: 'exact', head: true })
      .in('etapa', ['vendeu', 'perdida', 'atendida'])
      .gt('atualizado_em', corte + 'T00:00:00Z');

    if ((totalNovos || 0) < MIN_NOVOS_PARA_RESUMIR && req.query?.force !== '1') {
      return res.json({
        ok: true,
        skipped: true,
        razao: `So ${totalNovos || 0} atendimentos novos desde ${corte} (minimo ${MIN_NOVOS_PARA_RESUMIR})`,
      });
    }

    // Quantos viraram venda?
    const { count: vendas } = await supabase
      .from('lojas_whats_conversas')
      .select('*', { count: 'exact', head: true })
      .eq('etapa', 'vendeu')
      .gt('atualizado_em', corte + 'T00:00:00Z');

    const taxaConversao = (totalNovos || 0) > 0
      ? Math.round((vendas / totalNovos) * 1000) / 1000
      : 0;

    // Top padroes (5 melhores + 5 piores)
    const { data: topUsar } = await supabase
      .from('lojas_whats_aprendizado_padroes')
      .select('tipo, chave, contexto, amostras, sucessos, taxa_sucesso')
      .eq('ativo', true).eq('recomendacao', 'usar')
      .gte('amostras', 5)
      .order('taxa_sucesso', { ascending: false })
      .order('amostras', { ascending: false })
      .limit(8);

    const { data: topEvitar } = await supabase
      .from('lojas_whats_aprendizado_padroes')
      .select('tipo, chave, contexto, amostras, sucessos, taxa_sucesso')
      .eq('ativo', true).eq('recomendacao', 'evitar')
      .gte('amostras', 5)
      .order('taxa_sucesso', { ascending: true })
      .order('amostras', { ascending: false })
      .limit(5);

    const { data: paraExperimentar } = await supabase
      .from('lojas_whats_aprendizado_padroes')
      .select('tipo, chave, taxa_sucesso, amostras')
      .eq('ativo', true).eq('recomendacao', 'experimentar')
      .order('amostras', { ascending: false })
      .limit(5);

    // Monta prompt
    const fmtPad = (lista) => (lista || []).map(p =>
      `  ${p.tipo} "${p.chave}" → ${Math.round((p.taxa_sucesso || 0) * 100)}% (n=${p.amostras})`
    ).join('\n');

    const promptUsuario = `Você é Sofia, assistente IA de vendas WhatsApp da Amícia (loja moda feminina SP).

DADOS DESTA SEMANA (desde ${corte}):
- Total atendimentos analisados: ${totalNovos}
- Atendimentos que viraram VENDA: ${vendas || 0} (${Math.round(taxaConversao * 100)}%)

PADROES MAIS BEM-SUCEDIDOS:
${fmtPad(topUsar) || '  (ainda poucos dados)'}

PADROES COM RESULTADO RUIM (devo evitar):
${fmtPad(topEvitar) || '  (nenhum identificado)'}

PADROES NOVOS PRA EXPERIMENTAR MAIS:
${fmtPad(paraExperimentar) || '  (sem dados suficientes)'}

TAREFA:
Escreve um resumo em primeira pessoa (3-5 paragrafos curtos) sobre o que eu (Sofia) aprendi nesta semana. Comeca com "Esta semana atendi ${totalNovos} clientes e..." e segue.

Inclui:
1. O que esta funcionando bem (palavras, emojis, horarios que dao certo)
2. O que NAO esta funcionando (e estou evitando)
3. Hipoteses pra testar na proxima semana (variacoes que podem dar resultado)
4. Uma observacao sobre o estilo (formal/casual/urgente) ou abordagem geral

Tom: profissional mas humano. Direto. Sem floreios. PT-BR informal mas correto.

Retorna APENAS o texto do resumo, sem markdown.`;

    // Chama Claude
    const rResp = await fetch(ANTHROPIC_API, {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODELO_RESUMO,
        max_tokens: 1200,
        temperature: 0.5,
        messages: [{ role: 'user', content: promptUsuario }],
      }),
    });

    if (!rResp.ok) {
      const t = await rResp.text();
      return res.status(500).json({ error: 'Claude erro: ' + t.slice(0, 200) });
    }
    const j = await rResp.json();
    const resumoTexto = (j.content?.[0]?.text || '').trim();
    const inputT = j.usage?.input_tokens || 0;
    const outputT = j.usage?.output_tokens || 0;
    // Sonnet 4.6: ~$3/M input, ~$15/M output
    const custoUsd = (inputT * 3 / 1_000_000) + (outputT * 15 / 1_000_000);

    // Salva resumo
    const hojeISO = new Date().toISOString().slice(0, 10);
    const { data: novoResumo, error: errIns } = await supabase
      .from('lojas_whats_aprendizado_resumos')
      .insert({
        ate_data: hojeISO,
        atendimentos_analisados: totalNovos || 0,
        vendas_neste_periodo: vendas || 0,
        taxa_conversao_geral: taxaConversao,
        resumo_ia: resumoTexto,
        top_padroes: { usar: topUsar || [], evitar: topEvitar || [], experimentar: paraExperimentar || [] },
        prompt_usado: promptUsuario.slice(0, 5000),
        custo_estimado_usd: Math.round(custoUsd * 10000) / 10000,
      })
      .select().single();

    if (errIns) return res.status(500).json({ error: errIns.message });

    return res.json({
      ok: true,
      resumo_id: novoResumo.id,
      duracao_ms: Date.now() - tInicio,
      atendimentos_analisados: totalNovos,
      vendas: vendas || 0,
      taxa_conversao_pct: Math.round(taxaConversao * 100),
      tokens: { input: inputT, output: outputT },
      custo_estimado_usd: novoResumo.custo_estimado_usd,
    });
  } catch (e) {
    console.error('[cron-resumir] exception:', e);
    return res.status(500).json({ error: e.message, duracao_ms: Date.now() - tInicio });
  }
}
