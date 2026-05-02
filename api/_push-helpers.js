// ═══════════════════════════════════════════════════════════════════════════
// _push-helpers.js — utilitarios compartilhados de envio de push
// ═══════════════════════════════════════════════════════════════════════════
// Usado pelos crons e qualquer endpoint que dispare push.
// ═══════════════════════════════════════════════════════════════════════════

import webpush from 'web-push';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// VAPID — gerar 1x com: npx web-push generate-vapid-keys
// Salvar publica em VITE_VAPID_PUBLIC_KEY (build time, exposta ao client)
// Salvar privada em VAPID_PRIVATE_KEY (runtime apenas, nunca exposta)
// Salvar contato em VAPID_CONTACT (mailto:...)
const VAPID_PUBLIC_KEY  = process.env.VITE_VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_CONTACT     = process.env.VAPID_CONTACT || 'mailto:exclusivo@amicialoja.com.br';

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_CONTACT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

// 5 variacoes de mensagem matinal (Ailson 02/05)
const MENSAGENS_LEMBRETE = [
  (nome) => `Bom dia ${nome}! ☀️ Bora abrir o app pra vender muito! 💰`,
  (nome) => `Oiii ${nome}! 👋 As clientes tão te esperando — abre o app e dá uma olhada 💕`,
  (nome) => `E aí ${nome}! 🌟 Tem fila pra atender, abre o app pra ver as sugestões! 🛍️`,
  (nome) => `${nome}, bom dia! ☕ Pega um cafezinho e abre o app, tem novidade 💌`,
  (nome) => `Bom dia, ${nome}! 🌞 Suas clientes top tão querendo novidade — abre o app ✨`,
];

export function escolherMensagem(nome) {
  const fn = MENSAGENS_LEMBRETE[Math.floor(Math.random() * MENSAGENS_LEMBRETE.length)];
  // Pega so primeiro nome (limpa razao social longa)
  const nomeBonito = String(nome || '').trim().split(/\s+/)[0] || 'vendedora';
  return fn(nomeBonito);
}

/**
 * Envia push pra uma vendedora.
 * Loga sucesso/erro em lojas_push_log.
 * Se subscription expirou (410/404), limpa do banco automaticamente.
 *
 * Returns: { ok: boolean, motivo?: string, status?: int }
 */
export async function enviarPush({ vendedora, tipo, titulo, mensagem, url }) {
  if (!vendedora?.push_subscription) {
    await registrarLog({ vendedora_id: vendedora.id, tipo, mensagem, sucesso: false, erro: 'sem_subscription' });
    return { ok: false, motivo: 'sem_subscription' };
  }
  if (!VAPID_PRIVATE_KEY) {
    return { ok: false, motivo: 'VAPID nao configurado' };
  }

  const payload = JSON.stringify({
    title: titulo || 'Amícia',
    body: mensagem,
    url: url || '/',
    tag: tipo,  // mesma tag substitui notificacao anterior do mesmo tipo
  });

  try {
    const result = await webpush.sendNotification(vendedora.push_subscription, payload);
    await registrarLog({
      vendedora_id: vendedora.id,
      tipo,
      mensagem,
      sucesso: true,
      status_http: result.statusCode,
    });
    return { ok: true, status: result.statusCode };
  } catch (err) {
    const status = err.statusCode || 0;

    // 410 (Gone) ou 404 (Not Found) = subscription expirada/invalida.
    // Limpa do banco pra nao tentar de novo.
    if (status === 410 || status === 404) {
      await supabase
        .from('lojas_vendedoras')
        .update({ push_subscription: null })
        .eq('id', vendedora.id);
    }

    await registrarLog({
      vendedora_id: vendedora.id,
      tipo,
      mensagem,
      sucesso: false,
      erro: err.message || String(err),
      status_http: status,
    });
    return { ok: false, motivo: err.message, status };
  }
}

async function registrarLog(row) {
  try {
    await supabase.from('lojas_push_log').insert(row);
  } catch (e) {
    console.warn('[push-log] falhou:', e?.message);
  }
}

/**
 * Verifica auth do cron (vercel-cron user-agent ou ?user= autorizado).
 */
export function checarAuthCron(req) {
  const ua = String(req.headers?.['user-agent'] || '');
  if (ua.startsWith('vercel-cron')) return true;
  const user = String(req.query?.user || '');
  return ['ailson', 'amicia-admin'].includes(user);
}
