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

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  setCors(res);

  // Defesa contra disparo manual direto (sem header de cron Vercel)
  // Permite admin testar via X-User=ailson ou ?user=ailson na URL
  const ehCron = req.headers['x-vercel-cron'] !== undefined;
  const userId = req.query?.user || req.headers['x-user'];
  const ehAdmin = userId === 'ailson';
  if (!ehCron && !ehAdmin) {
    return res.status(403).json({
      error: 'Apenas cron Vercel ou admin',
      uso_manual: '/api/lojas-ia-cron-diario?user=ailson',
    });
  }

  const inicio = Date.now();

  // Carrega vendedoras ativas (não placeholders)
  const { data: vendedoras, error } = await supabase
    .from('lojas_vendedoras')
    .select('id, nome, loja')
    .eq('ativa', true)
    .eq('is_placeholder', false);
  if (error) {
    return res.status(500).json({ error: error.message });
  }
  if (!vendedoras || vendedoras.length === 0) {
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

  return res.status(200).json({
    ok: true,
    duracao_ms: Date.now() - inicio,
    total: vendedoras.length,
    sucessos: resultados.filter(r => r.ok).length,
    erros: resultados.filter(r => !r.ok).length,
    resultados,
  });
}
