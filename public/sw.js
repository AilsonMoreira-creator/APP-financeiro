// ═══════════════════════════════════════════════════════════════════════════
// Service Worker — App Financeiro Amícia
// ═══════════════════════════════════════════════════════════════════════════
// Funcoes:
//   1. Cache fetch fallback (offline)
//   2. Push notifications (modulo Lojas — lembretes vendedoras)
// ═══════════════════════════════════════════════════════════════════════════

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => self.clients.claim());

self.addEventListener('fetch', (e) => {
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});

// ─── PUSH ──────────────────────────────────────────────────────────────────
// Servidor envia payload JSON com {title, body, url, tag}.
// Notificacao aparece com som padrao do sistema, vibracao curta.
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'Amícia', body: event.data.text() };
  }

  const title = payload.title || 'Amícia';
  const options = {
    body: payload.body || '',
    icon: '/pwa192.png',
    badge: '/pwa192.png',
    tag: payload.tag || 'amicia-default',  // mesma tag substitui anterior (evita pilha)
    requireInteraction: false,
    data: {
      url: payload.url || '/',
    },
    vibrate: [100, 50, 100],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Click na notificacao → abre o app na URL especificada (ou raiz).
// Se ja tem aba aberta do app, foca nela em vez de abrir nova.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Procura aba ja aberta do app
      for (const client of clientList) {
        const url = new URL(client.url);
        if (url.origin === self.location.origin && 'focus' in client) {
          // Navega pra URL alvo e foca
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      // Nenhuma aba aberta → abre nova
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});

// Subscription expirada / chave rotacionada → re-registra automaticamente.
// Cliente vai detectar no proximo refresh e enviar a nova subscription.
self.addEventListener('pushsubscriptionchange', (event) => {
  console.log('[SW] pushsubscriptionchange — vendedora precisa reativar');
});
