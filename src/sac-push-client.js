// ═══════════════════════════════════════════════════════════════════════════
// sac-push-client.js — Web Push pra notificacoes SAC pos-venda
// ═══════════════════════════════════════════════════════════════════════════
// Reaproveita o service worker /sw.js (mesmo do Lojas). VAPID public key
// vem de import.meta.env.VITE_VAPID_PUBLIC_KEY.
// ═══════════════════════════════════════════════════════════════════════════

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY || '';

// Util: VAPID key (base64url) → Uint8Array (formato applicationServerKey)
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

/**
 * Estado atual de subscription do device. Não cria, só lê.
 * Retorna: 'desabilitado' (no SW/permission), 'inscrito', 'naoinscrito'
 */
export async function statusSubscriptionSAC() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'desabilitado';
  if (Notification.permission === 'denied') return 'desabilitado';
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return sub ? 'inscrito' : 'naoinscrito';
  } catch {
    return 'desabilitado';
  }
}

/**
 * Ativa notif desktop pro user. Pede permission se necessario, cria
 * subscription e salva no backend. Retorna { ok, motivo? }.
 */
export async function ativarPushSAC(userId) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { ok: false, motivo: 'Browser nao suporta Web Push' };
  }
  if (!VAPID_PUBLIC_KEY) {
    return { ok: false, motivo: 'VAPID public key nao configurada (VITE_VAPID_PUBLIC_KEY)' };
  }

  // 1. Permission
  let perm = Notification.permission;
  if (perm === 'default') perm = await Notification.requestPermission();
  if (perm !== 'granted') return { ok: false, motivo: 'Permissao negada' };

  // 2. Subscription
  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }
    // 3. Salva no backend
    const r = await fetch('/api/sac-push-register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, subscription: sub.toJSON() }),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      return { ok: false, motivo: d.error || `HTTP ${r.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, motivo: e.message };
  }
}

/**
 * Desativa notif: remove subscription do browser + backend.
 */
export async function desativarPushSAC() {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return { ok: true };
    const endpoint = sub.endpoint;
    await sub.unsubscribe();
    await fetch('/api/sac-push-register', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint }),
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, motivo: e.message };
  }
}
