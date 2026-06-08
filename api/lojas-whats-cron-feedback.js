// ═══════════════════════════════════════════════════════════════════════════
// /api/lojas-whats-cron-feedback — dispara feedback pós-1ª-compra no 15º dia
// ═══════════════════════════════════════════════════════════════════════════
// Roda 1x/dia. Relógio = PRIMEIRA compra do cliente (é cliente novo).
// Dia 15 após a 1ª compra: enfileira o feedback. Regra: se o dia 15 cair no
// DOMINGO, joga pra segunda (no domingo não dispara; na segunda recupera o
// represado). Brasil é UTC-3 fixo (sem horário de verão).
//
// modo (config 'feedback_auto'):
//   - 'manual' (default): enfileira como 'aguardando_aprovacao'. A lojista
//     aprova TODOS em 1 toque na aba Clientes (botão "lote do dia").
//   - 'auto': enfileira 'pendente' e processa na hora (envia sozinho).
//
// Reaproveita a MESMA segmentação/dedup do envio em massa:
//   - template por cliente via vw_lojas_clientes_feedback (distancia→feedback_v1,
//     resto→feedback_loja_v1); falso_novo (mesmo telefone/grupo/CNPJ) é pulado.
//   - pula bloqueado, quem já respondeu/dispensou, e quem já está na fila de feedback.
// ═══════════════════════════════════════════════════════════════════════════

import { randomUUID } from 'crypto';
import { supabase, getConfig, log, logErro, setCors } from './_lojas-whats-helpers.js';
import { processarFila } from './_lojas-whats-clientes-fila.js';

const DIAS = 15;
const TPL_DISTANCIA = 'feedback_v1';
const TPL_PRESENCIAL = 'feedback_loja_v1';

const isoDay = (d) => d.toISOString().slice(0, 10);

// Datas de 1ª compra que "vencem" hoje (em BRT). Domingo não dispara; na segunda
// recupera quem completou 15 dias no domingo.
function datasAlvo(agora = new Date()) {
  const brt = new Date(agora.getTime() - 3 * 3600 * 1000);
  const base = new Date(Date.UTC(brt.getUTCFullYear(), brt.getUTCMonth(), brt.getUTCDate()));
  const dow = base.getUTCDay(); // 0=domingo 1=segunda ... 6=sábado
  if (dow === 0) return [];      // domingo: não dispara (cai na segunda)
  const menos = (n) => { const d = new Date(base); d.setUTCDate(d.getUTCDate() - n); return isoDay(d); };
  const alvos = [menos(DIAS)];
  if (dow === 1) alvos.push(menos(DIAS + 1)); // segunda: pega o domingo represado
  return alvos;
}

async function emBatches(arr, fn, size = 500) {
  for (let i = 0; i < arr.length; i += size) await fn(arr.slice(i, i + size));
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  try {
    const alvos = datasAlvo();
    if (alvos.length === 0) {
      return res.status(200).json({ ok: true, pulou: 'domingo', enfileirados: 0 });
    }

    // 1) candidatos: 1ª compra exatamente nas datas-alvo, com compra real
    const { data: kpis, error: e1 } = await supabase
      .from('lojas_clientes_kpis')
      .select('cliente_id, primeira_compra, qtd_compras_fisicas, qtd_compras_vesti')
      .in('primeira_compra', alvos);
    if (e1) throw e1;
    let ids = (kpis || [])
      .filter(k => (Number(k.qtd_compras_fisicas || 0) + Number(k.qtd_compras_vesti || 0)) > 0)
      .map(k => k.cliente_id);
    if (ids.length === 0) {
      return res.status(200).json({ ok: true, alvos, candidatos: 0, enfileirados: 0 });
    }

    // 2) exclusões: bloqueado, já respondeu/dispensado, já na fila de feedback
    const bloqueados = new Set();
    const fechados = new Set();
    const jaFila = new Set();
    await emBatches(ids, async (b) => {
      const [bl, fb, fl] = await Promise.all([
        supabase.from('clientes_sofia_bloqueios').select('cliente_id').in('cliente_id', b),
        supabase.from('clientes_sofia_feedback').select('cliente_id, status').in('cliente_id', b),
        supabase.from('clientes_sofia_fila').select('cliente_id').eq('etapa', 'feedback').in('cliente_id', b),
      ]);
      (bl.data || []).forEach(r => bloqueados.add(r.cliente_id));
      (fb.data || []).forEach(r => { if (r.status === 'respondeu' || r.status === 'dispensado') fechados.add(r.cliente_id); });
      (fl.data || []).forEach(r => jaFila.add(r.cliente_id));
    });

    // 3) perfil + falso_novo (mesma view do massa.js) → escolhe template
    const perfis = new Map();
    await emBatches(ids, async (b) => {
      const { data, error } = await supabase
        .from('vw_lojas_clientes_feedback')
        .select('cliente_id, perfil_entrega, falso_novo')
        .in('cliente_id', b);
      if (error) throw error;
      (data || []).forEach(r => perfis.set(r.cliente_id, r));
    });

    const assignments = [];
    let puladoFalsoNovo = 0, puladoBloqueado = 0, puladoFechado = 0, puladoJaFila = 0;
    for (const cid of ids) {
      if (bloqueados.has(cid)) { puladoBloqueado++; continue; }
      if (fechados.has(cid)) { puladoFechado++; continue; }
      if (jaFila.has(cid)) { puladoJaFila++; continue; }
      const p = perfis.get(cid);
      if (p && p.falso_novo) { puladoFalsoNovo++; continue; }
      const distancia = p && p.perfil_entrega === 'distancia';
      assignments.push({ cliente_id: cid, template_name: distancia ? TPL_DISTANCIA : TPL_PRESENCIAL });
    }
    if (assignments.length === 0) {
      return res.status(200).json({ ok: true, alvos, candidatos: ids.length, enfileirados: 0, puladoFalsoNovo, puladoBloqueado, puladoFechado, puladoJaFila });
    }

    // 4) só templates ativos
    const nomes = [...new Set(assignments.map(a => a.template_name))];
    const { data: tpls } = await supabase
      .from('lojas_whats_templates').select('name').in('name', nomes).eq('ativo', true);
    const ativos = new Set((tpls || []).map(t => t.name));
    const validos = assignments.filter(a => ativos.has(a.template_name));
    if (validos.length === 0) {
      return res.status(200).json({ ok: true, alvos, enfileirados: 0, motivo: 'nenhum_template_ativo' });
    }

    // 5) modo: manual → aguardando_aprovacao | auto → pendente (+processa)
    const modo = (await getConfig('feedback_auto', 'manual')) === 'auto' ? 'auto' : 'manual';
    const statusFila = modo === 'auto' ? 'pendente' : 'aguardando_aprovacao';
    const lote_id = randomUUID();
    const linhas = validos.map(a => ({
      lote_id, cliente_id: a.cliente_id, etapa: 'feedback',
      template_name: a.template_name, status: statusFila,
    }));
    await emBatches(linhas, async (b) => {
      const { error } = await supabase.from('clientes_sofia_fila').insert(b);
      if (error) throw error;
    });

    let enviados = 0, erros = 0, restantes = 0;
    if (modo === 'auto') {
      const r = await processarFila(50);
      enviados = r.enviados; erros = r.erros; restantes = r.restantes;
    }

    log('cron-feedback', `modo=${modo} alvos=${alvos.join(',')} enfileirados=${validos.length} (falsoNovo=${puladoFalsoNovo} bloq=${puladoBloqueado} fechado=${puladoFechado} jaFila=${puladoJaFila})`);
    return res.status(200).json({
      ok: true, modo, alvos, lote_id,
      candidatos: ids.length, enfileirados: validos.length,
      puladoFalsoNovo, puladoBloqueado, puladoFechado, puladoJaFila,
      enviados, erros, restantes,
    });
  } catch (e) {
    logErro('cron-feedback', e);
    return res.status(500).json({ error: e.message });
  }
}
