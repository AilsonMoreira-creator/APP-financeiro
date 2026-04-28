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
  // Permite admin testar via X-User=ailson também
  const ehCron = req.headers['x-vercel-cron'] !== undefined;
  const ehAdmin = req.headers['x-user'] === 'ailson';
  if (!ehCron && !ehAdmin) {
    return res.status(403).json({ error: 'Apenas cron Vercel ou admin' });
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

  // Dispara em paralelo (cuidado: rate limit interno do lojas-ia já cuida)
  const baseUrl = `https://${req.headers.host}`;
  const resultados = [];

  for (const v of vendedoras) {
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
