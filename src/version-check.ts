// ═══════════════════════════════════════════════════════════════════════════
// version-check.ts — Auto-atualização (mata o cache preso no iPhone)
// ═══════════════════════════════════════════════════════════════════════════
// __APP_BUILD__ = carimbo do build embutido NESTE bundle (injetado pelo Vite).
// /version.json = carimbo do build que está NO SERVIDOR agora (no-store).
// Se forem diferentes, o app está rodando código velho -> recarrega.
//
// Roda ao abrir, no FOCO e no visibilitychange -> visível. Esse é o ponto cego
// do iOS standalone: o JS congela em segundo plano (o reg.update do SW não roda),
// mas quando o Ailson reabre/foca o app o foco dispara, o JS volta, compara e
// recarrega buscando o HTML fresco (no-store). Ailson 28/06/2026.
// ═══════════════════════════════════════════════════════════════════════════

declare const __APP_BUILD__: string;
const LOCAL = (typeof __APP_BUILD__ !== 'undefined' ? __APP_BUILD__ : '');

let ultimaChecagem = 0;

function jaRecarregouRecente(): boolean {
  // Trava anti-loop: no máximo 1 reload por minuto (cobre a janela curta em que
  // o version.json novo já propagou mas o bundle ainda não — evita loop).
  try {
    const t = Number(sessionStorage.getItem('amica_last_reload') || '0');
    return Date.now() - t < 60000;
  } catch { return false; }
}

async function checar(): Promise<void> {
  if (!LOCAL) return;                       // sem carimbo (dev) -> não faz nada
  const agora = Date.now();
  if (agora - ultimaChecagem < 15000) return; // throttle de 15s
  ultimaChecagem = agora;
  try {
    const r = await fetch('/version.json?t=' + agora, { cache: 'no-store' });
    if (!r.ok) return;
    const j = await r.json();
    if (j && j.build && j.build !== LOCAL) {
      if (jaRecarregouRecente()) return;     // evita loop em propagação lenta
      try { sessionStorage.setItem('amica_last_reload', String(Date.now())); } catch {}
      window.location.reload();
    }
  } catch { /* offline / falha de rede -> ignora, tenta de novo depois */ }
}

export function iniciarChecagemVersao(): void {
  checar();
  window.addEventListener('focus', checar);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checar();
  });
  setInterval(checar, 60000); // enquanto aberto, de tempos em tempos
}
