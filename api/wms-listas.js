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

// Config do módulo (amicia_data user_id='wms-config')
export const WMS_CONFIG_DEFAULT = {
  situacoes_aberto: ['em aberto', 'em andamento'],
  situacoes_finalizado: ['atendido', 'verificado'],
  canais: [], // [{canal:'Mercado Livre', corte:'12:00', envio:'14:00', alerta_min:30}]
};
export async function lerWmsConfig() {
  try {
    const { data } = await supabase.from('amicia_data').select('payload').eq('user_id', 'wms-config').maybeSingle();
    const p = data?.payload || {};
    return {
      situacoes_aberto: Array.isArray(p.situacoes_aberto) && p.situacoes_aberto.length ? p.situacoes_aberto : WMS_CONFIG_DEFAULT.situacoes_aberto,
      situacoes_finalizado: Array.isArray(p.situacoes_finalizado) && p.situacoes_finalizado.length ? p.situacoes_finalizado : WMS_CONFIG_DEFAULT.situacoes_finalizado,
      canais: Array.isArray(p.canais) ? p.canais : [],
    };
  } catch { return { ...WMS_CONFIG_DEFAULT }; }
}

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
          .select('conta, status_wms, qtd_pecas, data_pedido, canal_geral, impresso_em, finalizado_em')
          .neq('status_wms', 'cancelado');
        if (error) throw error;
        const hoje = new Date().toISOString().slice(0, 10);
        const porConta = {};
        const porCanal = {};
        const tot = { abertos: 0, em_separacao: 0, finalizados_hoje: 0, pecas_abertas: 0 };
        for (const r of (rows || [])) {
          const c = porConta[r.conta] || (porConta[r.conta] = { abertos: 0, em_separacao: 0, finalizados_hoje: 0, pecas_abertas: 0 });
          const k = porCanal[r.canal_geral || 'Outros'] || (porCanal[r.canal_geral || 'Outros'] = { pendentes: 0, finalizados_hoje: 0 });
          if (r.status_wms === 'aberto') { c.abertos++; tot.abertos++; c.pecas_abertas += r.qtd_pecas || 0; tot.pecas_abertas += r.qtd_pecas || 0; k.pendentes++; }
          else if (r.status_wms === 'em_separacao') { c.em_separacao++; tot.em_separacao++; k.pendentes++; }
          else if (r.status_wms === 'finalizado' && String(r.finalizado_em || '').slice(0, 10) === hoje) { c.finalizados_hoje++; tot.finalizados_hoje++; k.finalizados_hoje++; }
        }
        const { data: ultSync } = await supabase.from('wms_pedidos')
          .select('visto_em').order('visto_em', { ascending: false }).limit(1);
        const config = await lerWmsConfig();
        return res.status(200).json({ ok: true, total: tot, por_conta: porConta, por_canal: porCanal, config, ultimo_sync: ultSync?.[0]?.visto_em || null });
      }

      if (acao === 'config') {
        const config = await lerWmsConfig();
        return res.status(200).json({ ok: true, config });
      }

      if (acao === 'produtividade') {
        // Métrica de separação (Ailson 05/08/2026):
        // cronômetro = 1ª impressão do dia + 10 min de margem → corte 12:00.
        // Desconta 25s por pedido que estava "em separação" no corte (mercadoria
        // já separada, faltando só bipar). Média por pedido e pedidos/hora.
        const MARGEM_MIN = 10, DESC_SEG_POR_PEDIDO = 25, HORA_CORTE = 12;
        const brt = (d) => new Date(d.getTime() - 3 * 3600000); // UTC → BRT
        const agora = new Date();
        const hojeBrt = brt(agora).toISOString().slice(0, 10);
        const corteEm = new Date(`${hojeBrt}T${String(HORA_CORTE).padStart(2, '0')}:00:00-03:00`);

        const calcularDia = async (dia) => {
          const corte = new Date(`${dia}T${String(HORA_CORTE).padStart(2, '0')}:00:00-03:00`);
          const { data: listas } = await supabase.from('wms_listas')
            .select('criado_em').gte('criado_em', `${dia}T00:00:00-03:00`).lt('criado_em', corte.toISOString())
            .order('criado_em', { ascending: true }).limit(1);
          let inicioBase = listas?.[0]?.criado_em || null;
          if (!inicioBase) {
            const { data: imp } = await supabase.from('wms_pedidos')
              .select('impresso_em').not('impresso_em', 'is', null)
              .gte('impresso_em', `${dia}T00:00:00-03:00`).lt('impresso_em', corte.toISOString())
              .order('impresso_em', { ascending: true }).limit(1);
            inicioBase = imp?.[0]?.impresso_em || null;
          }
          if (!inicioBase) return null;
          const inicio = new Date(new Date(inicioBase).getTime() + MARGEM_MIN * 60000);
          if (inicio >= corte) return null;

          const { data: fins } = await supabase.from('wms_pedidos')
            .select('id').not('finalizado_em', 'is', null)
            .gte('finalizado_em', inicio.toISOString()).lt('finalizado_em', corte.toISOString());
          const finalizados = (fins || []).length;

          // pedidos que estavam em separação no corte: impressos antes do corte
          // e não finalizados até lá
          const { data: emSep } = await supabase.from('wms_pedidos')
            .select('id, finalizado_em').not('impresso_em', 'is', null)
            .gte('impresso_em', `${dia}T00:00:00-03:00`).lt('impresso_em', corte.toISOString())
            .neq('status_wms', 'cancelado');
          const pendentesNoCorte = (emSep || []).filter(p => !p.finalizado_em || new Date(p.finalizado_em) >= corte).length;

          const brutos = Math.round((corte - inicio) / 1000);
          const desconto = pendentesNoCorte * DESC_SEG_POR_PEDIDO;
          const liquidos = Math.max(60, brutos - desconto);
          return {
            data: dia, inicio_em: inicio.toISOString(), corte_em: corte.toISOString(),
            segundos_brutos: brutos, pedidos_em_separacao: pendentesNoCorte,
            segundos_descontados: desconto, segundos_liquidos: liquidos,
            pedidos_finalizados: finalizados,
            media_seg_por_pedido: finalizados ? +(liquidos / finalizados).toFixed(2) : null,
            pedidos_por_hora: finalizados ? +(finalizados / (liquidos / 3600)).toFixed(2) : null,
          };
        };

        // histórico (dias já fechados)
        const { data: hist } = await supabase.from('wms_produtividade')
          .select('*').lt('data', hojeBrt).order('data', { ascending: false }).limit(30);
        const historico = (hist || []).reverse();
        const refBase = historico.filter(h => h.pedidos_por_hora > 0).slice(-14);
        const referencia = refBase.length
          ? +(refBase.reduce((s, h) => s + Number(h.pedidos_por_hora), 0) / refBase.length).toFixed(2) : null;

        // dia de hoje (ao vivo antes do corte, fechado depois)
        const hoje = await calcularDia(hojeBrt);
        let variacao = null;
        if (hoje?.pedidos_por_hora && referencia) {
          variacao = +(((hoje.pedidos_por_hora - referencia) / referencia) * 100).toFixed(1);
        }
        // persiste o fechamento uma vez por dia, após o corte
        // só grava dia com medição real (evita poluir a média de referência com
        // dia de teste/implantação, onde o cronômetro nem rodou direito)
        const diaValido = hoje && hoje.pedidos_finalizados > 0 && hoje.segundos_liquidos > 600;
        if (diaValido && agora >= corteEm) {
          const { data: ja } = await supabase.from('wms_produtividade').select('id').eq('data', hojeBrt).maybeSingle();
          if (!ja) {
            await supabase.from('wms_produtividade').insert({
              ...hoje, referencia_pedidos_hora: referencia, variacao_pct: variacao,
            });
          }
        }
        return res.status(200).json({
          ok: true, hoje: hoje ? { ...hoje, referencia_pedidos_hora: referencia, variacao_pct: variacao } : null,
          fechado: agora >= corteEm, referencia, historico, agora_iso: agora.toISOString(),
        });
      }

      if (acao === 'pedidos') {
        const status = String(req.query?.status || 'aberto');
        let q = supabase.from('wms_pedidos')
          .select('id, conta, pedido_id, numero, numero_loja, data_pedido, situacao_nome, loja_nome, canal_geral, canal_detalhe, cliente_nome, itens, qtd_skus, qtd_pecas, multi_sku, lista_id, impresso_em, finalizado_em')
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

      if (acao === 'config') {
        const c = body.config || {};
        const payload = {
          situacoes_aberto: (Array.isArray(c.situacoes_aberto) ? c.situacoes_aberto : []).map(x => String(x).trim()).filter(Boolean),
          situacoes_finalizado: (Array.isArray(c.situacoes_finalizado) ? c.situacoes_finalizado : []).map(x => String(x).trim()).filter(Boolean),
          canais: (Array.isArray(c.canais) ? c.canais : []).map(x => ({
            canal: String(x.canal || '').trim(),
            corte: String(x.corte || ''), envio: String(x.envio || ''),
            alerta_min: parseInt(x.alerta_min) || 0,
          })).filter(x => x.canal),
          _updated: new Date().toISOString(),
        };
        const { error } = await supabase.from('amicia_data')
          .upsert({ user_id: 'wms-config', payload }, { onConflict: 'user_id' });
        if (error) throw error;
        return res.status(200).json({ ok: true, config: payload });
      }

      if (acao === 'limpar_produtividade') {
        // Fase de testes (Ailson 05/08): zera o histórico pra média de
        // referência nascer limpa quando a operação engatar de verdade.
        const { error } = await supabase.from('wms_produtividade').delete().gte('data', '2000-01-01');
        if (error) throw error;
        return res.status(200).json({ ok: true });
      }

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

      if (acao === 'marcar_impresso') {
        // "Já vi na tela e já busquei no estoque" (Ailson 05/08): muda
        // aberto → em_separacao na hora, sem lista/PDF
        const agora = new Date().toISOString();
        const { error } = await supabase.from('wms_pedidos')
          .update({ status_wms: 'em_separacao', impresso_em: agora, atualizado_em: agora })
          .in('id', ids).eq('status_wms', 'aberto');
        if (error) throw error;
        return res.status(200).json({ ok: true });
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
