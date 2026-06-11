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
  // Ampliação 11/06/2026 (Ailson) — mais variedade pro dia a dia
  (nome) => `${nome}! 🔥 A IA já separou as clientes do dia. Vem ver quem tá esperando vc!`,
  (nome) => `Bom dia ${nome}! 🍀 Dia bom pra resgatar aquela cliente sumida... as sugestões já tão prontas`,
  (nome) => `Oi ${nome}! 📲 7 sugestões fresquinhas te esperando — qual vc fecha primeiro?`,
  (nome) => `${nome}, bom dia! 🌷 Quem manda mensagem cedo pega a cliente de bom humor. Bora?`,
  (nome) => `Acorda pra vender, ${nome}! 😄 Suas sugestões do dia já chegaram quentinhas`,
  (nome) => `Bom dia ${nome}! ✨ Tem cliente na janela de compra hoje — não deixa ela esfriar!`,
  (nome) => `${nome}! 💼 Meta do dia: 7 de 7. A primeira mensagem é a mais difícil, bora!`,
  (nome) => `Oi ${nome}! 🙌 Cliente lembrada é cliente que volta. O app já sabe quem chamar hoje`,
  (nome) => `Bom dia, ${nome}! 🛍️ Chegou peça nova com a cara das suas clientes — vem conferir`,
  (nome) => `${nome}, partiu? 🚀 Hoje tem reposição que vende sozinha. Abre o app e confere`,
];

// Mensagens admin (Tamara) — tom de gestao, "ver o que ta rolando"
const MENSAGENS_ADMIN = [
  (nome) => `Bom dia ${nome}! 📊 Dá uma olhada no que tá chegando pras meninas hoje 👀`,
  (nome) => `${nome}, bom dia! 🌞 Hora de revisar o app e ver o movimento das vendedoras ☕`,
  (nome) => `Oi ${nome}! 👋 Abre o app e dá uma conferida nas sugestões do dia 📋`,
  (nome) => `Bom dia, ${nome}! ✨ Vamos ver como tão as carteiras hoje? Abre o app 💼`,
  (nome) => `${nome}! ☀️ Café passado? Abre o app pra ver o que tá pintando pras meninas 📲`,
  // Ampliação 11/06/2026 (Ailson)
  (nome) => `Bom dia ${nome}! 🔎 Vale espiar quem ainda não executou as sugestões de ontem`,
  (nome) => `${nome}, bom dia! 📈 As conversões da semana tão andando? Dá uma conferida`,
  (nome) => `Oi ${nome}! 🗂️ Sofia tem aprovações pendentes? Melhor olhar antes do movimento`,
  (nome) => `Bom dia ${nome}! 🙌 Começa pelo funil: leads novos primeiro, depois as meninas`,
  (nome) => `${nome}! ☕ Dia de acompanhar de perto — abre o app e vê quem precisa de um toque`,
];

export function escolherMensagem(nome) {
  // Detecta admin pelo nome (placeholder Tamara_admin ou qualquer "_admin")
  const nomeLower = String(nome || '').toLowerCase();
  const ehAdmin = nomeLower.includes('admin') || nomeLower.includes('tamara');
  const lista = ehAdmin ? MENSAGENS_ADMIN : MENSAGENS_LEMBRETE;
  const fn = lista[Math.floor(Math.random() * lista.length)];
  // Pega so primeiro nome (limpa "_admin" ou razao social longa)
  let nomeBonito = String(nome || '').trim().split(/[\s_]+/)[0] || 'vendedora';
  // Capitaliza
  nomeBonito = nomeBonito.charAt(0).toUpperCase() + nomeBonito.slice(1).toLowerCase();
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

// ═══════════════════════════════════════════════════════════════════════════
// SAC PUSH (Mercado Livre pos-venda)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Envia push notification pra TODOS os usuarios inscritos no SAC.
 * Chamado pelo webhook + sync quando uma mensagem nova de buyer entra.
 * Auto-limpa subscriptions invalidas (410/404).
 *
 * @param {object} opts
 * @param {string} opts.titulo - titulo da notificacao
 * @param {string} opts.mensagem - corpo
 * @param {string} opts.url - url pra abrir ao clicar (default '/' que cai na home)
 * @param {string} opts.tag - tag pra dedup (default 'sac-msg')
 * @returns { enviadas, falhadas, removidas }
 */
export async function enviarPushSAC({ titulo, mensagem, url = '/', tag = 'sac-msg', userId = null }) {
  if (!VAPID_PRIVATE_KEY) {
    return { enviadas: 0, falhadas: 0, removidas: 0, motivo: 'VAPID nao configurado' };
  }

  // userId opcional: filtra só as inscrições daquele usuário (usado pelo push
  // de teste). Sem userId, envia pra todos os inscritos (comportamento padrão
  // do webhook/cron). Ailson 02/06/2026.
  let query = supabase
    .from('sac_push_subscriptions')
    .select('id, endpoint, subscription, user_id');
  if (userId) query = query.eq('user_id', String(userId));
  const { data: subs, error } = await query;
  if (error || !subs?.length) {
    return { enviadas: 0, falhadas: 0, removidas: 0 };
  }

  const payload = JSON.stringify({
    title: titulo || 'Amícia SAC',
    body: mensagem,
    url,
    tag,
  });

  let enviadas = 0, falhadas = 0, removidas = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification(s.subscription, payload);
      enviadas++;
      // touch — atualiza ultimo_uso pra rastrear quem ainda recebe
      await supabase
        .from('sac_push_subscriptions')
        .update({ ultimo_uso_em: new Date().toISOString() })
        .eq('id', s.id);
    } catch (err) {
      const status = err?.statusCode || 0;
      if (status === 410 || status === 404) {
        // Subscription expirou/foi removida no browser — limpa
        await supabase.from('sac_push_subscriptions').delete().eq('id', s.id);
        removidas++;
      } else {
        falhadas++;
        console.warn('[push-sac] falha sub', s.id, err?.message);
      }
    }
  }
  return { enviadas, falhadas, removidas };
}

/**
 * Envia push pra TODOS os usuarios inscritos no Sofia (WhatsApp B2B).
 * Chamado pelo webhook lojas-whats quando cliente manda mensagem.
 * Inclui flag silentIfOpen:true no payload → SW silencia se app tiver aba aberta.
 * Auto-limpa subscriptions invalidas (410/404).
 *
 * @param {object} opts
 * @param {string} opts.titulo
 * @param {string} opts.mensagem
 * @param {string} opts.url - url pra abrir ao clicar (default '/?modulo=sofia')
 * @param {string} opts.tag - tag pra dedup
 * @returns { enviadas, falhadas, removidas }
 */
export async function enviarPushSofia({ titulo, mensagem, url = '/?modulo=sofia', tag = 'sofia-msg' }) {
  if (!VAPID_PRIVATE_KEY) {
    return { enviadas: 0, falhadas: 0, removidas: 0, motivo: 'VAPID nao configurado' };
  }

  const { data: subs, error } = await supabase
    .from('sofia_push_subscriptions')
    .select('id, endpoint, subscription, user_id');
  if (error || !subs?.length) {
    return { enviadas: 0, falhadas: 0, removidas: 0 };
  }

  const payload = JSON.stringify({
    title: titulo || 'Sofia',
    body: mensagem,
    url,
    tag,
    silentIfOpen: true,  // SW respeita: se tem aba aberta, nao mostra notif
  });

  let enviadas = 0, falhadas = 0, removidas = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification(s.subscription, payload);
      enviadas++;
      await supabase
        .from('sofia_push_subscriptions')
        .update({ ultimo_uso_em: new Date().toISOString() })
        .eq('id', s.id);
    } catch (err) {
      const status = err?.statusCode || 0;
      if (status === 410 || status === 404) {
        await supabase.from('sofia_push_subscriptions').delete().eq('id', s.id);
        removidas++;
      } else {
        falhadas++;
        console.warn('[push-sofia] falha sub', s.id, err?.message);
      }
    }
  }
  return { enviadas, falhadas, removidas };
}
