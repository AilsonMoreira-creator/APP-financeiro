/**
 * lojas-ia-cron-diario.js — Cron diário das sugestões da IA Lojas.
 *
 * Schedule: 0 10 * * 1-5 (07:00 BRT, segunda a sexta)
 *   - 10:00 UTC = 07:00 BRT (UTC-3)
 *
 * Pra cada vendedora ATIVA não-placeholder, dispara internamente
 * /api/lojas-ia { action: 'gerar_sugestoes', vendedora_id }.
 *
 * Cada vendedora recebe 7 sugestões: 1 reativar + 2 atenção + 3 novidade +
 * 1 followup (com sacola substituindo novidade quando há).
 */

import { supabase, setCors } from './_lojas-helpers.js';

export const config = { maxDuration: 600 };

export default async function handler(req, res) {
  setCors(res);

  // ═══ LOG DE INVOCAÇÃO (sempre, antes de qualquer guard) ═══
  // Garante que conseguimos ver no Supabase se o Vercel chamou esse handler
  // — independente de retornar 403, sucesso ou erro depois.
  const userAgent = req.headers['user-agent'] || '';
  // Vercel sempre envia user-agent 'vercel-cron/1.0' quando dispara cron.
  // Header 'x-vercel-cron' foi descontinuado (não vem mais — bug 30/04/2026
  // descoberto qdo cron retornou 403 todo dia 7h e nenhuma sugestão era gerada).
  // Mantemos check do header legado por compatibilidade defensiva.
  const ehCron = userAgent.startsWith('vercel-cron') || req.headers['x-vercel-cron'] !== undefined;
  const userId = req.query?.user || req.headers['x-user'];

  let healthId = null;
  try {
    const { data: hl } = await supabase
      .from('lojas_cron_health')
      .insert({
        cron_name: 'lojas-ia-cron-diario',
        origem: ehCron ? 'vercel-cron' : (userId === 'ailson' ? 'manual-admin' : 'unknown'),
        user_agent: userAgent,
        triggered_by: userId || (ehCron ? 'vercel' : null),
        status: 'iniciada',
      })
      .select('id')
      .single();
    healthId = hl?.id || null;
  } catch (e) {
    console.warn('[cron-health] insert falhou:', e?.message);
  }

  const inicio = Date.now();

  // Helper pra finalizar log antes de retornar
  const finalizar = async (status, detalhes = {}) => {
    if (!healthId) return;
    try {
      await supabase
        .from('lojas_cron_health')
        .update({
          finished_at: new Date().toISOString(),
          duracao_ms: Date.now() - inicio,
          status,
          ...detalhes,
        })
        .eq('id', healthId);
    } catch (e) {
      console.warn('[cron-health] update falhou:', e?.message);
    }
  };

  // ═══ Guard de auth ═══
  const ehAdmin = userId === 'ailson';
  if (!ehCron && !ehAdmin) {
    await finalizar('erro', { erro_msg: 'auth-403: nao eh cron nem admin' });
    return res.status(403).json({
      error: 'Apenas cron Vercel ou admin',
      uso_manual: '/api/lojas-ia-cron-diario?user=ailson',
    });
  }

  // Carrega vendedoras ativas (não placeholders)
  const { data: vendedoras, error } = await supabase
    .from('lojas_vendedoras')
    .select('id, nome, loja')
    .eq('ativa', true)
    .eq('is_placeholder', false);
  if (error) {
    await finalizar('erro', { erro_msg: `load-vendedoras: ${error.message}` });
    return res.status(500).json({ error: error.message });
  }
  if (!vendedoras || vendedoras.length === 0) {
    await finalizar('sucesso', { total_alvos: 0, sucessos: 0, erros: 0, detalhes: { vazio: true } });
    return res.status(200).json({ ok: true, mensagem: 'Nenhuma vendedora ativa', total: 0 });
  }

  // Dispara em SÉRIE com delay (Anthropic rate limit: 30k input tokens/min).
  // Cada vendedora consome ~70-90k tokens. Sem delay, 2ª vendedora em diante
  // estoura limite (erro 429). Solução: 75s entre cada uma garante reset
  // do contador por minuto.
  const baseUrl = `https://${req.headers.host}`;
  const resultados = [];
  const DELAY_ENTRE_VENDEDORAS_MS = 75000; // 75s

  for (let i = 0; i < vendedoras.length; i++) {
    const v = vendedoras[i];

    // Delay antes de cada vendedora (exceto a 1ª)
    if (i > 0) {
      await new Promise(resolve => setTimeout(resolve, DELAY_ENTRE_VENDEDORAS_MS));
    }

    try {
      const r = await fetch(`${baseUrl}/api/lojas-ia`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User': 'ailson',  // admin pra bypassar rate limit individual
          'X-Internal-Cron': '1',
        },
        body: JSON.stringify({
          action: 'gerar_sugestoes',
          vendedora_id: v.id,
        }),
      });
      const data = await r.json();
      resultados.push({
        vendedora: v.nome, loja: v.loja,
        ok: r.ok,
        status: r.status,
        sugestoes: data?.sugestoes?.length || 0,
        erro: data?.error || null,
      });
    } catch (e) {
      resultados.push({ vendedora: v.nome, ok: false, erro: e.message });
    }
  }

  const sucessos = resultados.filter(r => r.ok).length;
  const erros = resultados.filter(r => !r.ok).length;
  await finalizar(erros > 0 ? (sucessos > 0 ? 'sucesso' : 'erro') : 'sucesso', {
    total_alvos: vendedoras.length,
    sucessos,
    erros,
    detalhes: { resultados: resultados.slice(0, 10) }, // primeiros 10 pra não inflar
    erro_msg: erros > 0 ? `${erros}/${vendedoras.length} falharam` : null,
  });

  return res.status(200).json({
    ok: true,
    duracao_ms: Date.now() - inicio,
    total: vendedoras.length,
    sucessos,
    erros,
    resultados,
  });
}
