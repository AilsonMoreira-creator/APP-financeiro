/**
 * wms-listas.js — Picking WMS: dashboard, pedidos e ações de lista
 * GET  ?acao=dashboard                      → contadores por conta + prazos
 * GET  ?acao=pedidos&status=aberto[&conta=][&loja=] → pedidos com itens
 * POST { acao:'imprimir', pedido_ids:[], criado_por, filtros } → cria lista,
 *      marca em_separacao
 * POST { acao:'voltar', pedido_ids:[] }     → volta pra aberto
 * POST { acao:'finalizar', pedido_ids:[] }  → marca finalizado (fase 2: bipagem
 *      muda situação no Bling pra Verificado)
 */
import { supabase } from './_bling-helpers.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const acao = String(req.query?.acao || 'dashboard');

      if (acao === 'dashboard') {
        const { data: rows, error } = await supabase.from('wms_pedidos')
          .select('conta, status_wms, qtd_pecas, data_pedido, impresso_em, finalizado_em')
          .neq('status_wms', 'cancelado');
        if (error) throw error;
        const hoje = new Date().toISOString().slice(0, 10);
        const porConta = {};
        const tot = { abertos: 0, em_separacao: 0, finalizados_hoje: 0, pecas_abertas: 0 };
        for (const r of (rows || [])) {
          const c = porConta[r.conta] || (porConta[r.conta] = { abertos: 0, em_separacao: 0, finalizados_hoje: 0, pecas_abertas: 0 });
          if (r.status_wms === 'aberto') { c.abertos++; tot.abertos++; c.pecas_abertas += r.qtd_pecas || 0; tot.pecas_abertas += r.qtd_pecas || 0; }
          else if (r.status_wms === 'em_separacao') { c.em_separacao++; tot.em_separacao++; }
          else if (r.status_wms === 'finalizado' && String(r.finalizado_em || '').slice(0, 10) === hoje) { c.finalizados_hoje++; tot.finalizados_hoje++; }
        }
        const { data: ultSync } = await supabase.from('wms_pedidos')
          .select('visto_em').order('visto_em', { ascending: false }).limit(1);
        return res.status(200).json({ ok: true, total: tot, por_conta: porConta, ultimo_sync: ultSync?.[0]?.visto_em || null });
      }

      if (acao === 'pedidos') {
        const status = String(req.query?.status || 'aberto');
        let q = supabase.from('wms_pedidos')
          .select('id, conta, pedido_id, numero, numero_loja, data_pedido, situacao_nome, loja_nome, canal_geral, canal_detalhe, cliente_nome, itens, qtd_skus, qtd_pecas, multi_sku, lista_id, impresso_em')
          .eq('status_wms', status)
          .order('data_pedido', { ascending: true }).limit(2000);
        const conta = String(req.query?.conta || '');
        if (conta) q = q.eq('conta', conta);
        const loja = String(req.query?.loja || '');
        if (loja) q = q.eq('canal_geral', loja);
        const { data, error } = await q;
        if (error) throw error;
        return res.status(200).json({ ok: true, pedidos: data || [] });
      }

      return res.status(400).json({ error: 'acao inválida' });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const acao = String(body.acao || '');
      const ids = Array.isArray(body.pedido_ids) ? body.pedido_ids.filter(Number.isFinite) : [];
      if (!ids.length) return res.status(400).json({ error: 'pedido_ids vazio' });

      if (acao === 'imprimir') {
        const { data: lista, error: eL } = await supabase.from('wms_listas')
          .insert({ criado_por: String(body.criado_por || ''), filtros: body.filtros || {}, qtd_pedidos: ids.length })
          .select('id').single();
        if (eL) throw eL;
        const agora = new Date().toISOString();
        for (let i = 0; i < ids.length; i += 400) {
          const { error } = await supabase.from('wms_pedidos')
            .update({ status_wms: 'em_separacao', lista_id: lista.id, impresso_em: agora, atualizado_em: agora })
            .in('id', ids.slice(i, i + 400)).eq('status_wms', 'aberto');
          if (error) throw error;
        }
        return res.status(200).json({ ok: true, lista_id: lista.id, marcados: ids.length });
      }

      if (acao === 'voltar') {
        const { error } = await supabase.from('wms_pedidos')
          .update({ status_wms: 'aberto', lista_id: null, impresso_em: null, atualizado_em: new Date().toISOString() })
          .in('id', ids).eq('status_wms', 'em_separacao');
        if (error) throw error;
        return res.status(200).json({ ok: true });
      }

      if (acao === 'finalizar') {
        const agora = new Date().toISOString();
        const { error } = await supabase.from('wms_pedidos')
          .update({ status_wms: 'finalizado', finalizado_em: agora, atualizado_em: agora })
          .in('id', ids);
        if (error) throw error;
        return res.status(200).json({ ok: true });
      }

      return res.status(400).json({ error: 'acao inválida' });
    }

    return res.status(405).json({ error: 'método' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
