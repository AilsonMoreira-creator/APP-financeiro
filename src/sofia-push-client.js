// ═══════════════════════════════════════════════════════════════════════════
// sofia-push-client.js — Web Push pra notificacoes Sofia (WhatsApp B2B)
// ═══════════════════════════════════════════════════════════════════════════
// Reaproveita o service worker /sw.js. VAPID public key vem de
// import.meta.env.VITE_VAPID_PUBLIC_KEY (mesma do Lojas/SAC).
// Backend manda payload com silentIfOpen:true → SW silencia se app aberto.
// ═══════════════════════════════════════════════════════════════════════════

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY || '';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

export async function statusSubscriptionSofia() {
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

export async function ativarPushSofia(userId) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { ok: false, motivo: 'Browser nao suporta Web Push' };
  }
  if (!VAPID_PUBLIC_KEY) {
    return { ok: false, motivo: 'VAPID public key nao configurada (VITE_VAPID_PUBLIC_KEY)' };
  }

  let perm = Notification.permission;
  if (perm === 'default') perm = await Notification.requestPermission();
  if (perm !== 'granted') return { ok: false, motivo: 'Permissao negada' };

  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }
    const r = await fetch('/api/sofia-push-register', {
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

export async function desativarPushSofia() {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return { ok: true };
    const endpoint = sub.endpoint;
    await sub.unsubscribe();
    await fetch('/api/sofia-push-register', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint }),
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, motivo: e.message };
  }
}
