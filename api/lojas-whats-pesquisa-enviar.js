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

const LIMITE_PADRAO = 30;

// A/B da pesquisa de motivo. Botoes IGUAIS nas duas variantes (comparacao
// valida; a coluna pesquisa_template grava qual variante a conversa recebeu,
// entao o tracking A/B sai de graca: group by pesquisa_template). O corpo aqui
// espelha EXATAMENTE o template aprovado na Meta — serve pra registrar na thread
// o que a cliente recebeu (enviarTemplate manda o HSM mas nao loga nada em
// lojas_whats_mensagens). Se mudar na Meta, atualize aqui tambem.
// A: v1 (post-mortem). B: v2 (forward-looking). Ailson 28/06/2026.
const PESQUISA_BOTOES = ['Mínimo 12 peças', 'Preço', 'Variedade', 'Outros motivos'];
const PESQUISA_VARIANTES = {
  sofia_pesquisa_motivo_v1: (nome) =>
    `Oi ${nome}, tudo bem? Posso te fazer uma pergunta rápida: o que fez vc não seguir com a negociação?`,
  sofia_pesquisa_motivo_v2: (nome) =>
    `Oi ${nome}! 😊\n\nO que faria vc fechar com a gente hoje?`,
};

// Variantes aprovadas+ativas na Meta. Enquanto a v2 estiver em rascunho/pendente,
// so a v1 entra no sorteio (nada quebra). Quando a Meta aprovar a v2, o split
// 50/50 liga sozinho.
async function variantesAtivas() {
  const { data } = await supabase
    .from('lojas_whats_templates')
    .select('name, status, ativo')
    .in('name', Object.keys(PESQUISA_VARIANTES));
  return (data || [])
    .filter(t => t.status === 'aprovado' && t.ativo !== false)
    .map(t => t.name);
}
function escolherVariante(ativas) {
  if (!ativas.length) return null;
  return ativas[Math.floor(Math.random() * ativas.length)];
}

// Envia a pesquisa pra UMA conversa (ja elegivel). Claim-first.
export async function enviarPesquisaConversa(conv, variante = 'sofia_pesquisa_motivo_v1') {
  const agora = new Date().toISOString();

  // CLAIM: so segue se pesquisa_enviada_em ainda era null
  const { data: claim } = await supabase
    .from('lojas_whats_conversas')
    .update({ pesquisa_enviada_em: agora, pesquisa_template: variante, atualizado_em: agora })
    .eq('id', conv.id)
    .is('pesquisa_enviada_em', null)
    .select('id')
    .maybeSingle();
  if (!claim) return { ok: false, erro: 'ja_enviada' };

  const nome = primeiroNome(conv.nome_cliente) || 'tudo bem';
  let metaId = null;
  try {
    const r = await enviarTemplate(conv.telefone, variante, [nome], 'pt_BR');
    metaId = r?.messages?.[0]?.id || null;
  } catch (e) {
    logErro('pesquisa-enviar', e);
    // reverte o claim pra poder tentar de novo num proximo run
    await supabase
      .from('lojas_whats_conversas')
      .update({ pesquisa_enviada_em: null, pesquisa_template: null })
      .eq('id', conv.id);
    return { ok: false, erro: e.message };
  }

  // Registra o template na thread pra a assistente ver exatamente o que a
  // cliente recebeu no WhatsApp (corpo + botoes). Falha aqui NAO reverte o
  // envio (a pesquisa ja foi). Ailson 22/06/2026.
  try {
    const corpo = (PESQUISA_VARIANTES[variante] || PESQUISA_VARIANTES.sofia_pesquisa_motivo_v1)(nome);
    const textoThread = `${corpo}\n\n${PESQUISA_BOTOES.map(b => `[ ${b} ]`).join('  ')}`;
    await supabase.from('lojas_whats_mensagens').insert({
      conversa_id: conv.id, direcao: 'saida', autor: 'sofia_ia', tipo_midia: 'text',
      texto: textoThread, meta_message_id: metaId, status: 'enviando',
      enviada_em: agora,
    });
  } catch (e) {
    logErro('pesquisa-enviar-log', e);
  }

  return { ok: true };
}

// Dispara pra elegiveis (cron) ou pra ids especificos (manual).
export async function dispararPesquisa({ limite = LIMITE_PADRAO, ids = null } = {}) {
  const ativas = await variantesAtivas();
  if (!ativas.length) {
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
    const r = await enviarPesquisaConversa(conv, escolherVariante(ativas));
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
    const ativas = await variantesAtivas();
    return res.status(200).json({
      template_aprovado: ativas.length > 0,
      variantes_ativas: ativas,
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
