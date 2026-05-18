/**
 * lojas-feedback-registrar.js — Registra resposta do modal de fechamento
 *
 * POST body: {
 *   feedback_id: uuid,
 *   q1?: 'respondeu'|'sem_resposta'|'ignorou'|'vou_insistir',
 *   q2?: 'com_certeza'|'talvez'|'dificil'|'ja_era',
 *   q3?: 'mandar_outra'|'esperar'|'outro_canal'|'deixar_quieta',
 *   motivo_encerramento?: 'completo'|'2_negativas'|'abandonou'
 * }
 *
 * Suporta updates incrementais: vendedora responde Q1 → POST com q1.
 * Responde Q2 → POST com q2. Se Q1+Q2 negativas, frontend manda
 * motivo_encerramento='2_negativas' sem Q3. Quando completa Q3, manda
 * motivo='completo'. Em qualquer abandono parcial, manda 'abandonou'.
 *
 * Backend só valida que feedback_id pertence à vendedora autenticada.
 *
 * Sessão Ailson 18/05/2026 — Sprint A "Modal Fechamento".
 */
import { supabase, validarUsuario, setCors } from './_lojas-helpers.js';

const VALORES_Q1 = new Set(['respondeu','sem_resposta','ignorou','vou_insistir']);
const VALORES_Q2 = new Set(['com_certeza','talvez','dificil','ja_era']);
const VALORES_Q3 = new Set(['mandar_outra','esperar','outro_canal','deixar_quieta']);
const MOTIVOS    = new Set(['completo','2_negativas','abandonou']);

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Use POST' });

  const auth = await validarUsuario(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
  if (auth.isAdmin || !auth.vendedoraId) {
    return res.status(403).json({ error: 'Endpoint apenas para vendedoras' });
  }

  const { feedback_id, q1, q2, q3, motivo_encerramento } = req.body || {};
  if (!feedback_id) return res.status(400).json({ error: 'feedback_id obrigatório' });

  // Validação dos enums (rejeita valores estranhos pra evitar lixo na tabela)
  if (q1 && !VALORES_Q1.has(q1))                          return res.status(400).json({ error: 'q1 inválido' });
  if (q2 && !VALORES_Q2.has(q2))                          return res.status(400).json({ error: 'q2 inválido' });
  if (q3 && !VALORES_Q3.has(q3))                          return res.status(400).json({ error: 'q3 inválido' });
  if (motivo_encerramento && !MOTIVOS.has(motivo_encerramento)) {
    return res.status(400).json({ error: 'motivo_encerramento inválido' });
  }

  try {
    // Verifica posse antes de update (vendedora só pode atualizar SEU feedback)
    const { data: fb, error: errLoad } = await supabase
      .from('lojas_feedback_diario')
      .select('id, vendedora_id, motivo_encerramento')
      .eq('id', feedback_id)
      .maybeSingle();

    if (errLoad) return res.status(500).json({ error: errLoad.message });
    if (!fb)     return res.status(404).json({ error: 'Feedback não encontrado' });
    if (fb.vendedora_id !== auth.vendedoraId) {
      return res.status(403).json({ error: 'Feedback não é desta vendedora' });
    }
    if (fb.motivo_encerramento) {
      // Já finalizado, idempotente
      return res.json({ ok: true, ja_finalizado: true });
    }

    // Monta UPDATE só com campos enviados
    const update = {};
    if (q1 !== undefined) update.resposta_q1 = q1;
    if (q2 !== undefined) update.resposta_q2 = q2;
    if (q3 !== undefined) update.resposta_q3 = q3;
    if (motivo_encerramento) {
      update.motivo_encerramento = motivo_encerramento;
      update.finalizado_em       = new Date().toISOString();
    }

    if (Object.keys(update).length === 0) {
      return res.status(400).json({ error: 'Nenhum campo enviado' });
    }

    const { error: errUpd } = await supabase
      .from('lojas_feedback_diario')
      .update(update)
      .eq('id', feedback_id);

    if (errUpd) return res.status(500).json({ error: errUpd.message });

    return res.json({ ok: true, atualizou: Object.keys(update) });
  } catch (e) {
    console.error('[lojas-feedback-registrar] erro:', e);
    return res.status(500).json({ error: e.message || 'Erro interno' });
  }
}
