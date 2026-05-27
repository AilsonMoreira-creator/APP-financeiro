// ═══════════════════════════════════════════════════════════════════════════
// /api/lojas-whats-cron-catalogo
// ═══════════════════════════════════════════════════════════════════════════
// Roda 1x por hora. Dois estagios:
//
// FASE 1 — 6h apos catalogo enviado, cliente nao respondeu:
//   - Sofia gera msg automatica ("ficou alguma duvida? conseguiu olhar?")
//   - Envia DIRETO via Meta (sem passar por Tamara — Ailson 27/05/2026)
//   - Marca catalogo_followup_6h_em=NOW
//
// FASE 2 — 24h apos a msg de 6h, cliente ainda nao respondeu:
//   - Move conversa pra etapa='follow_up' com tag '1d'
//   - cron-followup ja existente pega normal pra gerar msg de retomada
//
// Webhook reseta catalogo_enviado_em e catalogo_followup_6h_em quando
// cliente manda QUALQUER msg — entao cron so pega conversas silentes.
//
// Ailson 27/05/2026
// ═══════════════════════════════════════════════════════════════════════════

import { supabase, log, logErro } from './_lojas-whats-helpers.js';
import { enviarTexto } from './_lojas-whats-meta-client.js';

const VARIACOES_MSG_6H = [
  'Oi! Conseguiu dar uma olhadinha no catálogo? Ficou alguma dúvida em algum modelo? 🤗',
  'Oi, tudo bem? Deu pra ver o catálogo? Posso te ajudar com alguma peça em específico?',
  'Oi! Passando aqui pra saber se vc viu o catálogo… alguma dúvida? Posso te mandar mais info de algum modelo?',
  'Olá! Conseguiu olhar o catálogo? Se ficou na dúvida em algo, me chama que te ajudo 🙌',
];

function escolherMsg6h(conversaId) {
  // Pseudo-aleatorio determinista baseado no id da conversa pra ela receber
  // sempre a mesma variacao (idempotencia se cron rodar 2x)
  const idStr = String(conversaId);
  let h = 0;
  for (let i = 0; i < idStr.length; i++) h = (h * 31 + idStr.charCodeAt(i)) | 0;
  return VARIACOES_MSG_6H[Math.abs(h) % VARIACOES_MSG_6H.length];
}

export default async function handler(req, res) {
  const ua = req.headers?.['user-agent'] || '';
  const ehCron = ua.startsWith('vercel-cron') || !!req.headers?.['x-vercel-cron'];
  if (!ehCron && req.query?.force !== '1') {
    return res.status(403).json({ error: 'Cron only. Use ?force=1 pra teste.' });
  }

  try {
    const agora = new Date();
    const cutoff6h  = new Date(Date.now() - 6  * 60 * 60 * 1000).toISOString();
    const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // ─── FASE 1 — 6h, dispara msg automatica ──────────────────────────────
    const { data: f1, error: errF1 } = await supabase
      .from('lojas_whats_conversas')
      .select('id, telefone, nome_cliente, etapa')
      .not('catalogo_enviado_em', 'is', null)
      .lt('catalogo_enviado_em', cutoff6h)
      .is('catalogo_followup_6h_em', null)
      .in('etapa', ['conversando', 'quente']);
    if (errF1) throw errF1;

    const f1Resultados = [];
    for (const conv of f1 || []) {
      try {
        const texto = escolherMsg6h(conv.id);
        const r = await enviarTexto(conv.telefone, texto);
        const metaMsgId = r?.messages?.[0]?.id || null;
        if (!metaMsgId) throw new Error('meta_sem_message_id');

        // Persiste msg enviada
        await supabase.from('lojas_whats_mensagens').insert({
          conversa_id: conv.id,
          direcao: 'saida',
          autor: 'assistente',
          tipo_midia: 'text',
          texto,
          meta_message_id: metaMsgId,
          status: 'enviando',
          enviada_em: agora.toISOString(),
        });

        // Marca o follow-up 6h ja disparado + ja considera 24h pendente
        await supabase.from('lojas_whats_conversas').update({
          catalogo_followup_6h_em: agora.toISOString(),
          ultima_atividade_em: agora.toISOString(),
          atualizado_em: agora.toISOString(),
        }).eq('id', conv.id);

        f1Resultados.push({ id: conv.id, tel: conv.telefone, ok: true });
        log('cron-catalogo/6h', `conv=${conv.id} msg auto enviada`);
      } catch (e) {
        f1Resultados.push({ id: conv.id, tel: conv.telefone, erro: e.message });
        logErro('cron-catalogo/6h', e);
      }
    }

    // ─── FASE 2 — 24h apos msg de 6h, vira follow_up tag '1d' ─────────────
    const { data: f2, error: errF2 } = await supabase
      .from('lojas_whats_conversas')
      .select('id, telefone, etapa')
      .not('catalogo_followup_6h_em', 'is', null)
      .lt('catalogo_followup_6h_em', cutoff24h)
      .in('etapa', ['conversando', 'quente']);
    if (errF2) throw errF2;

    const venceEm1d = new Date(Date.now() + 86400000).toISOString();
    const f2Resultados = [];
    for (const conv of f2 || []) {
      try {
        await supabase.from('lojas_whats_conversas').update({
          etapa: 'follow_up',
          follow_up_tag: '1d',
          follow_up_vence_em: venceEm1d,
          follow_up_entrou_em: agora.toISOString(),
          follow_up_origem: 'cron_catalogo_24h',
          follow_up_motivo: 'cliente nao respondeu apos catalogo + msg 6h',
          // Limpa os timers de catalogo (ja cumpriu papel)
          catalogo_enviado_em: null,
          catalogo_followup_6h_em: null,
          ultima_atividade_em: agora.toISOString(),
          atualizado_em: agora.toISOString(),
        }).eq('id', conv.id);
        f2Resultados.push({ id: conv.id, ok: true });
        log('cron-catalogo/24h', `conv=${conv.id} → follow_up tag=1d`);
      } catch (e) {
        f2Resultados.push({ id: conv.id, erro: e.message });
        logErro('cron-catalogo/24h', e);
      }
    }

    return res.status(200).json({
      ok: true,
      fase_1_6h: { processadas: (f1 || []).length, resultados: f1Resultados },
      fase_2_24h: { processadas: (f2 || []).length, resultados: f2Resultados },
    });
  } catch (e) {
    logErro('cron-catalogo', e);
    return res.status(500).json({ error: e.message });
  }
}
