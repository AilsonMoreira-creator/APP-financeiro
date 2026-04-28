/**
 * lojas-ia-trigger.js — Trigger manual de geração de sugestões.
 *
 * Endpoint GET (pra colar URL no navegador) que dispara gerar_sugestoes
 * pra 1 vendedora específica.
 *
 * Uso: GET /api/lojas-ia-trigger?vendedora=Cleide&user=ailson
 *
 * Por que GET: facilita teste manual sem PowerShell. Em produção o cron
 * é POST direto pro lojas-ia.js.
 */

import { supabase, setCors } from './_lojas-helpers.js';

export const config = { maxDuration: 90 };

export default async function handler(req, res) {
  setCors(res);

  // Auth via query param (só pra teste manual)
  const userId = req.query.user || req.headers['x-user'];
  if (userId !== 'ailson') {
    return res.status(403).json({ error: 'Apenas admin (?user=ailson)' });
  }

  const nomeVendedora = req.query.vendedora;
  if (!nomeVendedora) {
    return res.status(400).json({
      error: 'Parametro ?vendedora=NOME obrigatório',
      exemplo: '/api/lojas-ia-trigger?vendedora=Cleide&user=ailson',
    });
  }

  // Busca UUID da vendedora
  const { data: v, error } = await supabase
    .from('lojas_vendedoras')
    .select('id, nome, loja, ativa')
    .ilike('nome', nomeVendedora)
    .eq('ativa', true)
    .maybeSingle();
  if (error || !v) {
    return res.status(404).json({ error: `Vendedora "${nomeVendedora}" não encontrada` });
  }

  // Dispara internamente via fetch
  const baseUrl = `https://${req.headers.host}`;
  try {
    const r = await fetch(`${baseUrl}/api/lojas-ia`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-User': 'ailson',
      },
      body: JSON.stringify({
        action: 'gerar_sugestoes',
        vendedora_id: v.id,
      }),
    });
    const data = await r.json();

    return res.status(r.ok ? 200 : 500).json({
      ok: r.ok,
      vendedora: v.nome,
      loja: v.loja,
      resultado: data,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
