/**
 * lojas-janela-cliente.js
 *
 * Le da view vw_lojas_clientes_janela (criada Ailson 06/05/2026 noite).
 *
 * Modos:
 *   - GET ?cliente_id=UUID
 *     Retorna dados de janela de 1 cliente (pro card).
 *
 *   - GET ?vendedora_id=UUID&filtro=na_janela
 *     Retorna lista de clientes daquela vendedora dentro da janela.
 *     filtro pode ser: na_janela | passou_janela | todos
 *
 * Auth: admin OU vendedora (vendedora so ve a propria carteira).
 *
 * Resposta cliente individual:
 *   { cliente_id, nome, qtd_compras, qtd_datas_unicas, media_dias_compras,
 *     media_confiavel, dias_sem_comprar, limite_atencao,
 *     dias_ate_janela_atencao, dentro_janela_compra,
 *     status_recalculado, status_gravado_kpi }
 *
 * Resposta lista:
 *   { vendedora_id, filtro, total, itens: [...] }
 */
import { supabase, validarUsuario, setCors } from './_lojas-helpers.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Use GET' });

  const auth = await validarUsuario(req);
  if (!auth.ok) return res.status(auth.status || 403).json({ error: auth.error });

  const { cliente_id, vendedora_id, filtro = 'na_janela' } = req.query;

  // ─── Modo 1: dados de 1 cliente ─────────────────────────────────────
  if (cliente_id) {
    const { data, error } = await supabase
      .from('vw_lojas_clientes_janela')
      .select('*')
      .eq('cliente_id', cliente_id)
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Cliente nao encontrado' });

    // Vendedora so pode ver clientes dela
    if (!auth.isAdmin && data.vendedora_id !== auth.vendedoraId) {
      return res.status(403).json({ error: 'Cliente nao pertence a sua carteira' });
    }

    return res.json(data);
  }

  // ─── Modo 2: lista filtrada por vendedora ───────────────────────────
  if (!vendedora_id) {
    return res.status(400).json({ error: 'cliente_id ou vendedora_id obrigatorio' });
  }

  // Vendedora so ve a propria carteira
  if (!auth.isAdmin && vendedora_id !== auth.vendedoraId) {
    return res.status(403).json({ error: 'So pode ver a propria carteira' });
  }

  let query = supabase
    .from('vw_lojas_clientes_janela')
    .select('cliente_id, nome, qtd_compras, qtd_datas_unicas, media_dias_compras, media_confiavel, dias_sem_comprar, limite_atencao, dias_ate_janela_atencao, dentro_janela_compra, status_recalculado, status_gravado_kpi')
    .eq('vendedora_id', vendedora_id)
    .gt('qtd_compras', 0); // ignora cliente sem nenhuma compra

  if (filtro === 'na_janela') {
    query = query.eq('dentro_janela_compra', true);
  } else if (filtro === 'passou_janela') {
    // Passou da janela = dias_sem_comprar > limite_atencao
    // Equivale a status_recalculado in ('atencao', 'semAtividade', 'inativo')
    query = query.in('status_recalculado', ['atencao', 'semAtividade', 'inativo']);
  }
  // filtro='todos' nao adiciona condicao extra

  query = query.order('dias_ate_janela_atencao', { ascending: true });

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  return res.json({
    vendedora_id,
    filtro,
    total: (data || []).length,
    itens: data || [],
  });
}
