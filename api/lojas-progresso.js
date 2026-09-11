// lojas-progresso.js — "Sua carteira em movimento" + sequência + reencontros
// (Ailson 08/09/2026 — pacote pra animar as vendedoras)
//
//   GET /api/lojas-progresso?vendedora_id=<id>   (X-User obrigatório)
//
//   carteira: quantas clientes com WhatsApp a vendedora JÁ conversou pelo app
//             (sugestão executada, qualquer época), quantas NOVAS nesta semana
//             (primeira execução da vida da cliente caiu nesta semana), quantas
//             faltam. É o mapa que ela vai preenchendo.
//   streak:   dias úteis SEGUIDOS com todas as sugestões do dia feitas.
//             Regra dele: elas trabalham seg-sex e não trabalham feriado —
//             sábado, domingo, feriado nacional e dia SEM sugestões geradas
//             não contam nem quebram; dia com sugestões e alguma pendente
//             quebra. Hoje só conta se já estiver completo.
//   reencontros: clientes que receberam mensagem e voltaram a comprar
//             (lojas_conversoes) nos últimos 7 dias — o feedback que fecha o
//             ciclo ("a Marilene comprou depois da sua mensagem").
//
//   Admin ou a própria vendedora (ou quem opera a carteira — podeOperarVendedora).

import { supabase, validarUsuario, setCors, podeOperarVendedora } from './_lojas-helpers.js';

export const config = { maxDuration: 20 };   // 11/09: rota de tela — nao segura conexao por 5 min

const FERIADOS_BR = new Set([
  '2026-01-01', '2026-02-16', '2026-02-17', '2026-04-03', '2026-04-21', '2026-05-01', '2026-06-04',
  '2026-09-07', '2026-10-12', '2026-11-02', '2026-11-15', '2026-11-20', '2026-12-25',
  '2027-01-01', '2027-02-08', '2027-02-09', '2027-03-26', '2027-04-21', '2027-05-01', '2027-05-27',
  '2027-09-07', '2027-10-12', '2027-11-02', '2027-11-15', '2027-11-20', '2027-12-25',
]);
const diaBRT = (d) => new Date(d.getTime() - 3 * 3600000).toISOString().slice(0, 10);
const ehDiaUtil = (iso) => { const dow = new Date(iso + 'T12:00:00Z').getUTCDay(); return dow >= 1 && dow <= 5 && !FERIADOS_BR.has(iso); };

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  const auth = await validarUsuario(req);
  if (!auth.ok) return res.status(auth.status || 403).json({ error: auth.error });
  const vendedoraId = String(req.query?.vendedora_id || auth.vendedoraId || '');
  if (!vendedoraId) return res.status(400).json({ error: 'vendedora_id' });
  if (!auth.isAdmin && !(await podeOperarVendedora(auth, vendedoraId))) return res.status(403).json({ error: 'Sem permissão' });

  const hoje = diaBRT(new Date());
  const out = { ok: true, vendedora_id: vendedoraId, hoje };

  // ── carteira em movimento ──
  try {
    const { data: cli } = await supabase.from('lojas_clientes').select('id, telefone_principal_valido')
      .eq('vendedora_id', vendedoraId).is('arquivado_em', null);
    const comWhats = new Set((cli || []).filter(c => c.telefone_principal_valido === true).map(c => c.id));
    const { data: exec } = await supabase.from('lojas_sugestoes_diarias').select('cliente_id, executada_em')
      .eq('vendedora_id', vendedoraId).not('executada_em', 'is', null).not('cliente_id', 'is', null);
    const primeiraExec = {};
    for (const e of (exec || [])) {
      const d = String(e.executada_em).slice(0, 10);
      if (!primeiraExec[e.cliente_id] || d < primeiraExec[e.cliente_id]) primeiraExec[e.cliente_id] = d;
    }
    // segunda-feira desta semana (BRT)
    const h = new Date(hoje + 'T12:00:00Z'); const dow = h.getUTCDay() || 7;
    const segunda = new Date(h.getTime() - (dow - 1) * 86400000).toISOString().slice(0, 10);
    const conversadas = [...comWhats].filter(id => primeiraExec[id]);
    const novasSemana = conversadas.filter(id => primeiraExec[id] >= segunda);
    const totalConversadas = Object.keys(primeiraExec).length;   // inclui sem whats (histórico)
    out.carteira = {
      total_com_whats: comWhats.size,
      conversadas: conversadas.length,
      novas_esta_semana: novasSemana.length,
      faltam: Math.max(0, comWhats.size - conversadas.length),
      pct: comWhats.size ? Math.round(100 * conversadas.length / comWhats.size) : 0,
      conversadas_total_historico: totalConversadas,
    };
  } catch (e) { out.carteira = { erro: String(e?.message || e) }; }

  // ── sequência (streak) ──
  try {
    const desde = new Date(Date.now() - 45 * 86400000).toISOString().slice(0, 10);
    const { data: sug } = await supabase.from('lojas_sugestoes_diarias').select('data_geracao, status')
      .eq('vendedora_id', vendedoraId).gte('data_geracao', desde);
    const porDia = {};
    for (const s of (sug || [])) {
      const d = String(s.data_geracao).slice(0, 10);
      porDia[d] = porDia[d] || { total: 0, feitas: 0 };
      porDia[d].total++;
      if (s.status === 'executada' || s.status === 'dispensada') porDia[d].feitas++;
    }
    // caminha pra trás a partir de hoje: dia útil com sugestões e tudo feito conta;
    // dia útil com pendência quebra; fim de semana/feriado/sem sugestões pula.
    let streak = 0; let cursor = new Date(hoje + 'T12:00:00Z'); let hojeCompleto = null;
    for (let i = 0; i < 60; i++) {
      const iso = cursor.toISOString().slice(0, 10);
      const info = porDia[iso];
      if (ehDiaUtil(iso) && info && info.total > 0) {
        const completo = info.feitas >= info.total;
        if (iso === hoje) { hojeCompleto = completo; if (!completo) { cursor = new Date(cursor.getTime() - 86400000); continue; } }
        if (completo) streak++; else break;
      }
      cursor = new Date(cursor.getTime() - 86400000);
    }
    out.streak = { dias: streak, hoje_completo: hojeCompleto, hoje_pendentes: porDia[hoje] ? Math.max(0, porDia[hoje].total - porDia[hoje].feitas) : null };
  } catch (e) { out.streak = { erro: String(e?.message || e) }; }

  // ── reencontros (últimos 7 dias) ──
  try {
    const d7 = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const { data: conv } = await supabase.from('lojas_conversoes')
      .select('cliente_id, data_mensagem, data_venda, dias_ate_compra, valor_venda')
      .eq('vendedora_id', vendedoraId).gte('data_venda', d7).order('data_venda', { ascending: false }).limit(5);
    const ids = [...new Set((conv || []).map(c => c.cliente_id).filter(Boolean))];
    const nomes = {};
    if (ids.length) {
      const { data: cl } = await supabase.from('lojas_clientes').select('id, apelido, comprador_nome, razao_social').in('id', ids);
      for (const c of (cl || [])) nomes[c.id] = c.apelido || c.comprador_nome || (c.razao_social || '').split(' ').slice(0, 2).join(' ');
    }
    out.reencontros = (conv || []).map(c => ({
      cliente: nomes[c.cliente_id] || 'cliente', data_mensagem: c.data_mensagem, data_venda: c.data_venda,
      dias: c.dias_ate_compra, valor: Number(c.valor_venda) || 0,
    }));
    // total dos últimos 30 dias (pra frase "esse mês suas mensagens viraram R$ X")
    const d30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const { data: c30 } = await supabase.from('lojas_conversoes').select('valor_venda').eq('vendedora_id', vendedoraId).gte('data_venda', d30);
    out.reencontros_30d = { qtd: (c30 || []).length, valor: (c30 || []).reduce((t, x) => t + (Number(x.valor_venda) || 0), 0) };
  } catch (e) { out.reencontros = []; }

  return res.status(200).json(out);
}
