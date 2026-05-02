// ═══════════════════════════════════════════════════════════════════════════
// Push notifications — helpers do client (frontend)
// ═══════════════════════════════════════════════════════════════════════════
// Usado no MinhaCarteiraScreen pelo icone 🔔/🔕.
// Tambem expoe trackingDeAcesso() pra registrar abertura >=1min.
// ═══════════════════════════════════════════════════════════════════════════

// VAPID public key vai ser injetada via env var pelo Vite.
// Configurar no Vercel: VITE_VAPID_PUBLIC_KEY
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY || '';

// Util: converte VAPID key (base64url) pro formato Uint8Array que o
// pushManager.subscribe espera.
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Verifica se navegador suporta push.
 */
export function pushSuportado() {
  return (
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/**
 * Estado atual da inscricao no navegador deste celular.
 * Retorna: 'nao_suportado' | 'sem_permissao' | 'permitido_sem_inscricao' | 'inscrito' | 'bloqueado'
 */
export async function statusPush() {
  if (!pushSuportado()) return 'nao_suportado';

  const permission = Notification.permission;
  if (permission === 'denied') return 'bloqueado';
  if (permission === 'default') return 'sem_permissao';

  // permission === 'granted' — checa se tem subscription ativa
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return sub ? 'inscrito' : 'permitido_sem_inscricao';
  } catch (e) {
    console.warn('[push] erro ao checar subscription:', e);
    return 'sem_permissao';
  }
}

/**
 * Pede permissao + cria subscription + envia pro backend pra associar
 * com vendedora_id. Chamado quando vendedora clica no icone 🔕.
 *
 * Args:
 *   vendedoraId — id da vendedora atual (carteira aberta)
 *   userId     — opcional, user logado. Se for "tamara", backend redireciona
 *                pro placeholder Tamara_admin (admin recebe push proprio)
 *
 * Retorna { ok: true } ou { ok: false, motivo: string }
 */
export async function ativarPush(vendedoraId, userId) {
  if (!pushSuportado()) {
    return { ok: false, motivo: 'Navegador nao suporta push' };
  }
  if (!VAPID_PUBLIC_KEY) {
    return { ok: false, motivo: 'VAPID public key nao configurada' };
  }
  // Se nao tem nem vendedoraId nem userId, nao tem alvo
  if (!vendedoraId && !userId) {
    return { ok: false, motivo: 'Sem alvo (vendedora ou user)' };
  }

  try {
    // Pede permissao se ainda nao concedida
    if (Notification.permission === 'default') {
      const result = await Notification.requestPermission();
      if (result !== 'granted') {
        return { ok: false, motivo: 'Permissao negada' };
      }
    }
    if (Notification.permission === 'denied') {
      return { ok: false, motivo: 'Permissao bloqueada — habilite nas configs do navegador' };
    }

    // Pega registration do SW (ja deve estar ativo)
    const reg = await navigator.serviceWorker.ready;

    // Verifica se ja tem subscription. Se sim, reusa.
    let subscription = await reg.pushManager.getSubscription();
    if (!subscription) {
      subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }

    // Envia pro backend associar com vendedora_id (ou redirecionar pra
    // Tamara_admin se userId='tamara')
    const res = await fetch('/api/lojas-push-register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vendedora_id: vendedoraId,
        user_id: userId,
        subscription: subscription.toJSON(),
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      return { ok: false, motivo: 'Erro backend: ' + err };
    }

    return { ok: true };
  } catch (e) {
    console.error('[push] erro ativar:', e);
    return { ok: false, motivo: e.message || String(e) };
  }
}

/**
 * Desativa push neste celular. Remove subscription do navegador E do backend.
 * userId opcional — quando 'tamara', backend remove de Tamara_admin.
 */
export async function desativarPush(vendedoraId, userId) {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await sub.unsubscribe();
    }
    if (vendedoraId || userId) {
      await fetch('/api/lojas-push-register', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vendedora_id: vendedoraId, user_id: userId }),
      });
    }
    return { ok: true };
  } catch (e) {
    console.error('[push] erro desativar:', e);
    return { ok: false, motivo: e.message || String(e) };
  }
}

/**
 * Tracking de acesso — registra "vendedora abriu o app por >=1 min hoje".
 *
 * Args:
 *   vendedoraId — id da vendedora atual
 *   userId      — opcional, user logado. Se "tamara", backend redireciona
 *                 pra placeholder Tamara_admin
 *
 * Retorna funcao de cleanup pra desinstalar listeners.
 */
export function instalarTrackingAcesso(vendedoraId, userId) {
  if (!vendedoraId && !userId) return () => {};

  let acumulado = 0;        // ms acumulados de foco
  let inicioFoco = null;    // timestamp do inicio do foco atual
  let jaRegistrou = false;  // flag pra parar apos atingir 60s
  const META_MS = 60 * 1000;

  function ehFocado() {
    return document.visibilityState === 'visible' && document.hasFocus();
  }

  function comecarFoco() {
    if (jaRegistrou) return;
    if (inicioFoco !== null) return;  // ja contando
    if (!ehFocado()) return;
    inicioFoco = Date.now();
  }

  function pararFoco() {
    if (jaRegistrou) return;
    if (inicioFoco === null) return;
    acumulado += Date.now() - inicioFoco;
    inicioFoco = null;
    if (acumulado >= META_MS) {
      registrar();
    }
  }

  async function registrar() {
    if (jaRegistrou) return;
    jaRegistrou = true;
    try {
      await fetch('/api/lojas-push-touch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vendedora_id: vendedoraId, user_id: userId }),
        keepalive: true,  // garante envio mesmo se aba fechar
      });
    } catch (e) {
      console.warn('[push-touch] falhou:', e);
      jaRegistrou = false;  // permite tentar de novo
    }
  }

  function onVisibility() {
    if (ehFocado()) comecarFoco();
    else pararFoco();
  }

  function onBeforeUnload() {
    pararFoco();  // se chegou aos 60s, envia antes de fechar
  }

  // Comeca tracking
  comecarFoco();

  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('focus', comecarFoco);
  window.addEventListener('blur', pararFoco);
  window.addEventListener('beforeunload', onBeforeUnload);

  // Timer de seguranca: a cada 30s checa se atingiu meta
  const intervalId = setInterval(() => {
    if (jaRegistrou) {
      clearInterval(intervalId);
      return;
    }
    if (inicioFoco !== null) {
      const total = acumulado + (Date.now() - inicioFoco);
      if (total >= META_MS) {
        pararFoco();  // forca o registro
      }
    }
  }, 30000);

  // Cleanup
  return () => {
    pararFoco();
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('focus', comecarFoco);
    window.removeEventListener('blur', pararFoco);
    window.removeEventListener('beforeunload', onBeforeUnload);
    clearInterval(intervalId);
  };
}
