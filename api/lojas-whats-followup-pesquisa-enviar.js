// ═══════════════════════════════════════════════════════════════════════════
// lojas-whats-followup-pesquisa-enviar.js — Pesquisa de motivo (HSM) pros leads
// travados em FOLLOW-UP (montaram pedido com prints e sumiram). E reativacao,
// nao pesquisa fria: a RESPOSTA da cliente volta a conversa pra 'conversando'
// (fluxo normal do webhook) e corta o follow-up de catalogo. Ailson 28/06/2026.
// ═══════════════════════════════════════════════════════════════════════════
// Elegibilidade pra PESQUISA (view vw_lojas_followup_pesquisa_elegiveis):
//   etapa='follow_up' + ultima_atividade_em 7+ dias + >=1 imagem do cliente
//   + >=3 msgs do cliente + sem followup_pesq_enviada_em + com nome.
// Quem esta 7+ dias em follow_up mas NAO satisfaz (sem print/poucas msgs) ->
//   promovido a 'perdida' (view vw_lojas_followup_perdida_elegiveis).
//
// GET  ?                    → preview (elegiveis pesquisa + candidatos perdida)
// GET  ?disparar=1&limite=N → dispara pesquisa + promove perdidas (teste manual)
// POST { ids:[...] }        → dispara pesquisa pros ids
//
// CLAIM-first em followup_pesq_enviada_em (anti duplo-envio). So dispara com o
// template aprovado na Meta.
// ═══════════════════════════════════════════════════════════════════════════

import { supabase, setCors, log, logErro, primeiroNome } from './_lojas-whats-helpers.js';
import { enviarTemplate } from './_lojas-whats-meta-client.js';

const LIMITE_PADRAO = 30;
const TEMPLATE = 'sofia_followup_motivo_v1';
const BOTOES = ['Confirmar grade', 'Preço/condição', 'Outro motivo'];

// Espelha EXATAMENTE o corpo aprovado na Meta (enviarTemplate manda o HSM mas
// nao loga nada na thread; isto registra na thread o que a cliente recebeu).
// Se mudar o body na Meta, atualize aqui tambem.
const CORPO = (nome) =>
  `Oi ${nome}! 😊\nVc chegou a começar seu pedido mas não seguiu. O que faltou pra fechar?\nMe conta que eu resolvo\nposso ver uma condição melhor pra vc`;

async function templateAprovado() {
  const { data } = await supabase
    .from('lojas_whats_templates')
    .select('status, ativo')
    .eq('name', TEMPLATE)
    .maybeSingle();
  return !!data && data.status === 'aprovado' && data.ativo !== false;
}

// Envia a pesquisa de follow-up pra UMA conversa (ja elegivel). Claim-first.
export async function enviarFollowupConversa(conv) {
  const agora = new Date().toISOString();

  // CLAIM: so segue se followup_pesq_enviada_em ainda era null (anti duplo-envio)
  const { data: claim } = await supabase
    .from('lojas_whats_conversas')
    .update({ followup_pesq_enviada_em: agora, followup_pesq_template: TEMPLATE, atualizado_em: agora })
    .eq('id', conv.id)
    .is('followup_pesq_enviada_em', null)
    .select('id')
    .maybeSingle();
  if (!claim) return { ok: false, erro: 'ja_enviada' };

  const nome = primeiroNome(conv.nome_cliente) || 'tudo bem';
  let metaId = null;
  try {
    const r = await enviarTemplate(conv.telefone, TEMPLATE, [nome], 'pt_BR');
    metaId = r?.messages?.[0]?.id || null;
  } catch (e) {
    logErro('followup-pesquisa-enviar', e);
    // reverte o claim pra tentar de novo num proximo run
    await supabase
      .from('lojas_whats_conversas')
      .update({ followup_pesq_enviada_em: null, followup_pesq_template: null })
      .eq('id', conv.id);
    return { ok: false, erro: e.message };
  }

  // Registra o template na thread (corpo + botoes) pra a assistente ver o que a
  // cliente recebeu. Falha aqui NAO reverte o envio (a pesquisa ja foi).
  try {
    const textoThread = `${CORPO(nome)}\n\n${BOTOES.map(b => `[ ${b} ]`).join('  ')}`;
    await supabase.from('lojas_whats_mensagens').insert({
      conversa_id: conv.id, direcao: 'saida', autor: 'sofia_ia', tipo_midia: 'text',
      texto: textoThread, meta_message_id: metaId, status: 'enviando', enviada_em: agora,
    });
  } catch (e) {
    logErro('followup-pesquisa-enviar-log', e);
  }

  return { ok: true };
}

// Promove a 'perdida' quem esta 7+ dias em follow_up e NAO satisfaz o criterio
// de pesquisa (sem print ou poucas msgs). Le a view e da update em lote.
export async function promoverFollowupPerdidas() {
  const { data, error } = await supabase
    .from('vw_lojas_followup_perdida_elegiveis')
    .select('id')
    .limit(200);
  if (error) { logErro('followup-promover', error); return { ok: false, erro: error.message }; }
  const ids = (data || []).map(r => r.id);
  if (!ids.length) return { ok: true, promovidas: 0 };

  const agora = new Date().toISOString();
  const { error: errUpd } = await supabase
    .from('lojas_whats_conversas')
    .update({ etapa: 'perdida', motivo_perdida: 'followup_expirado', perdida_em: agora, atualizado_em: agora })
    .in('id', ids)
    .eq('etapa', 'follow_up');   // guarda: so move quem ainda esta em follow_up
  if (errUpd) { logErro('followup-promover-upd', errUpd); return { ok: false, erro: errUpd.message }; }
  return { ok: true, promovidas: ids.length };
}

// Dispara pesquisa pros elegiveis (cron) ou pra ids especificos (manual).
export async function dispararFollowupPesquisa({ limite = LIMITE_PADRAO, ids = null } = {}) {
  if (!(await templateAprovado())) {
    return { ok: false, motivo: 'template_nao_aprovado' };
  }

  let query = supabase
    .from('vw_lojas_followup_pesquisa_elegiveis')
    .select('id, telefone, nome_cliente');
  if (Array.isArray(ids) && ids.length) {
    query = query.in('id', ids).limit(Math.min(ids.length, 60));
  } else {
    query = query.order('ultima_atividade_em', { ascending: true }).limit(Math.min(limite, LIMITE_PADRAO));
  }

  const { data: elegiveis, error } = await query;
  if (error) { logErro('followup-pesquisa-disparar', error); return { ok: false, erro: error.message }; }

  let enviadas = 0, falhas = 0;
  for (const conv of (elegiveis || [])) {
    const r = await enviarFollowupConversa(conv);
    if (r.ok) enviadas++; else falhas++;
    await new Promise(res => setTimeout(res, 400)); // rate-limit suave
  }
  log('followup-pesquisa-disparar', `total=${elegiveis?.length || 0} enviadas=${enviadas} falhas=${falhas}`);
  return { ok: true, total: elegiveis?.length || 0, enviadas, falhas };
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method === 'GET') {
    // Disparo manual de teste via Safari: ?disparar=1&limite=N
    if (req.query.disparar === '1') {
      const limite = parseInt(req.query.limite || String(LIMITE_PADRAO), 10) || LIMITE_PADRAO;
      const envio = await dispararFollowupPesquisa({ limite });
      const perdidas = await promoverFollowupPerdidas();
      return res.status(200).json({ ok: true, envio, perdidas });
    }
    // Preview: elegiveis pra pesquisa + candidatos a perdida
    const [{ data: pesq }, { data: perd }] = await Promise.all([
      supabase.from('vw_lojas_followup_pesquisa_elegiveis')
        .select('id, telefone, nome_cliente, ultima_atividade_em, msgs_cliente, imgs_cliente')
        .order('ultima_atividade_em', { ascending: true }).limit(300),
      supabase.from('vw_lojas_followup_perdida_elegiveis')
        .select('id, nome_cliente, ultima_atividade_em, msgs_cliente, imgs_cliente')
        .order('ultima_atividade_em', { ascending: true }).limit(300),
    ]);
    return res.status(200).json({
      template_aprovado: await templateAprovado(),
      pesquisa_elegiveis: pesq || [],
      perdida_elegiveis: perd || [],
    });
  }

  if (req.method === 'POST') {
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids_required' });
    const r = await dispararFollowupPesquisa({ ids });
    return res.status(200).json(r);
  }

  return res.status(405).json({ error: 'method_not_allowed' });
}
