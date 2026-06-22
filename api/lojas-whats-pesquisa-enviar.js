// ═══════════════════════════════════════════════════════════════════════════
// lojas-whats-pesquisa-enviar.js — Dispara a pesquisa de motivo (HSM) pros
// leads perdidos elegiveis. Usado pelo envio MANUAL (Perdidas) e pelo cron 14h.
// ═══════════════════════════════════════════════════════════════════════════
// Elegibilidade vem da view vw_lojas_pesquisa_elegiveis:
//   etapa='perdida' + recebeu catalogo (catalogo_formato) + >=2 msgs do cliente
//   + ainda sem pesquisa enviada + com nome.
//
// GET  /api/lojas-whats-pesquisa-enviar            → lista elegiveis (preview)
// GET  /api/lojas-whats-pesquisa-enviar?disparar=1&limite=N → dispara (teste manual)
// POST /api/lojas-whats-pesquisa-enviar  body { ids:[...] }  → dispara pros selecionados
//
// CLAIM antes de enviar: marca pesquisa_enviada_em ANTES do template (so se null),
// evitando duplo envio em corrida. Se o envio falhar, reverte o claim.
// So dispara se o template estiver APROVADO na Meta.
// ═══════════════════════════════════════════════════════════════════════════

import { supabase, setCors, log, logErro, primeiroNome } from './_lojas-whats-helpers.js';
import { enviarTemplate } from './_lojas-whats-meta-client.js';

const TEMPLATE_PESQUISA = 'sofia_pesquisa_motivo_v1';
const LIMITE_PADRAO = 30;

async function templateAprovado() {
  const { data } = await supabase
    .from('lojas_whats_templates')
    .select('status')
    .eq('name', TEMPLATE_PESQUISA)
    .maybeSingle();
  return data?.status === 'aprovado';
}

// Envia a pesquisa pra UMA conversa (ja elegivel). Claim-first.
export async function enviarPesquisaConversa(conv) {
  const agora = new Date().toISOString();

  // CLAIM: so segue se pesquisa_enviada_em ainda era null
  const { data: claim } = await supabase
    .from('lojas_whats_conversas')
    .update({ pesquisa_enviada_em: agora, pesquisa_template: TEMPLATE_PESQUISA, atualizado_em: agora })
    .eq('id', conv.id)
    .is('pesquisa_enviada_em', null)
    .select('id')
    .maybeSingle();
  if (!claim) return { ok: false, erro: 'ja_enviada' };

  const nome = primeiroNome(conv.nome_cliente) || 'tudo bem';
  try {
    await enviarTemplate(conv.telefone, TEMPLATE_PESQUISA, [nome], 'pt_BR');
  } catch (e) {
    logErro('pesquisa-enviar', e);
    // reverte o claim pra poder tentar de novo num proximo run
    await supabase
      .from('lojas_whats_conversas')
      .update({ pesquisa_enviada_em: null, pesquisa_template: null })
      .eq('id', conv.id);
    return { ok: false, erro: e.message };
  }
  return { ok: true };
}

// Dispara pra elegiveis (cron) ou pra ids especificos (manual).
export async function dispararPesquisa({ limite = LIMITE_PADRAO, ids = null } = {}) {
  if (!(await templateAprovado())) {
    return { ok: false, motivo: 'template_nao_aprovado' };
  }

  let query = supabase
    .from('vw_lojas_pesquisa_elegiveis')
    .select('id, telefone, nome_cliente');
  if (Array.isArray(ids) && ids.length) {
    query = query.in('id', ids).limit(Math.min(ids.length, 60));
  } else {
    query = query.order('perdida_em', { ascending: true }).limit(Math.min(limite, LIMITE_PADRAO));
  }

  const { data: elegiveis, error } = await query;
  if (error) {
    logErro('pesquisa-disparar', error);
    return { ok: false, erro: error.message };
  }

  let enviadas = 0;
  let falhas = 0;
  for (const conv of (elegiveis || [])) {
    const r = await enviarPesquisaConversa(conv);
    if (r.ok) enviadas++; else falhas++;
    await new Promise(res => setTimeout(res, 400)); // rate-limit suave
  }

  log('pesquisa-disparar', `total=${elegiveis?.length || 0} enviadas=${enviadas} falhas=${falhas}`);
  return { ok: true, total: elegiveis?.length || 0, enviadas, falhas };
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method === 'GET') {
    // Disparo manual de teste via Safari: ?disparar=1&limite=N
    if (req.query.disparar === '1') {
      const limite = parseInt(req.query.limite || String(LIMITE_PADRAO), 10) || LIMITE_PADRAO;
      const r = await dispararPesquisa({ limite });
      return res.status(200).json(r);
    }
    // Preview: lista elegiveis
    const { data, error } = await supabase
      .from('vw_lojas_pesquisa_elegiveis')
      .select('id, telefone, nome_cliente, perdida_em, motivo_perdida, msgs_cliente')
      .order('perdida_em', { ascending: true })
      .limit(300);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({
      template_aprovado: await templateAprovado(),
      total: data?.length || 0,
      elegiveis: data || [],
    });
  }

  if (req.method === 'POST') {
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || !ids.length) {
      return res.status(400).json({ error: 'ids_required' });
    }
    const r = await dispararPesquisa({ ids });
    return res.status(200).json(r);
  }

  return res.status(405).json({ error: 'method_not_allowed' });
}
