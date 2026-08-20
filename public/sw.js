// ═══════════════════════════════════════════════════════════════════════════
// Service Worker — App Financeiro Amícia
// ═══════════════════════════════════════════════════════════════════════════
// Funcoes:
//   1. Push notifications (modulo Lojas — lembretes vendedoras)
//   2. Network-first NO cache pra HTML/JS/CSS (Ailson 08/05/2026)
//
// IMPORTANTE: Removido cache de assets — toda requisicao vai pra rede.
// Razao: vendedoras estavam vendo versao desatualizada do app porque
// SW retornava cache mesmo quando rede estava OK. Sem cache, sempre
// fresh. Trade-off: requer conexao de rede (offline nao funciona).
// Pra Lojas (uso 100% online), eh aceitavel.
// ═══════════════════════════════════════════════════════════════════════════

const SW_VERSION = '2026-08-20-v110';

self.addEventListener('install', (event) => {
  console.log('[SW] install', SW_VERSION);
  // Pula direto pra ativacao (nao espera fechar todas as abas)
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('[SW] activate', SW_VERSION);
  event.waitUntil(
    (async () => {
      // Limpa TODOS os caches antigos
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      console.log('[SW] caches limpos:', keys);
      // Toma controle imediato de todas as abas abertas
      await self.clients.claim();
      // Avisa abas pra recarregarem (pega o codigo novo)
      const clientList = await self.clients.matchAll({ type: 'window' });
      for (const client of clientList) {
        client.postMessage({ type: 'SW_UPDATED', version: SW_VERSION });
      }
    })()
  );
});

// Sem fetch handler = browser comportamento padrao = sempre rede.
// Isso elimina o problema de cache stale. Push abaixo continua funcionando.

// ─── PUSH ──────────────────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'Amícia', body: event.data.text() };
  }

  const handle = async () => {
    // Se quem mandou pediu silentIfOpen, checa se tem alguma aba do app
    // aberta (qualquer estado: focada, background, minimizada).
    // App "fechado" = clients.matchAll retorna array vazio → notifica normal.
    if (payload.silentIfOpen) {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      if (clients.length > 0) {
        // App aberto em algum lugar → silencia (usuario vai ver na propria UI)
        return;
      }
    }

    const title = payload.title || 'Amícia';
    const options = {
      body: payload.body || '',
      icon: '/pwa192.png',
      badge: '/pwa192.png',
      tag: payload.tag || 'amicia-default',
      requireInteraction: false,
      data: { url: payload.url || '/' },
      vibrate: [100, 50, 100],
    };
    await self.registration.showNotification(title, options);
  };

  event.waitUntil(handle());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        const url = new URL(client.url);
        if (url.origin === self.location.origin && 'focus' in client) {
          // Aba ja aberta: posta mensagem pra atualizar estado React
          // (client.navigate so muda URL, nao re-roda useState init no React)
          client.postMessage({ type: 'NAVEGAR_PARA', url: targetUrl });
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        // Aba fechada: abre nova com query param que useState init le
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});

self.addEventListener('pushsubscriptionchange', (event) => {
  console.log('[SW] pushsubscriptionchange — vendedora precisa reativar');
});
