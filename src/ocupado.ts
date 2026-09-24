import { aparelhoId } from './aparelhoId';
// ocupado.ts — "trabalho em andamento" (Ailson 15/09/2026)
// Uma tela que esta no meio de algo que nao pode ser interrompido (lote de
// etiquetas do WMS) liga este sinal. Enquanto ligado, NENHUM reload automatico
// (versao nova, service worker novo) pode acontecer — ele fica pendente e sai
// quando a tela liberar. Tambem registra em app_erros (prefixo "reload:") todo
// reload automatico e todo descarregamento da pagina com trabalho em andamento,
// pra gente saber POR QUE a tela "fechou" em vez de adivinhar.
declare global { interface Window { __amiciaOcupado?: string; __amiciaModuloAtivo?: string; } }

export function marcarOcupado(motivo: string): void { try { window.__amiciaOcupado = motivo; } catch { /* nada */ } }
export function liberarOcupado(): void { try { window.__amiciaOcupado = ''; } catch { /* nada */ } }
export function estaOcupado(): boolean { try { return !!window.__amiciaOcupado; } catch { return false; } }

export function registrarEvento(mensagem: string, detalhe = ''): void {
  try {
    const sess = (() => { try { return JSON.parse(localStorage.getItem('amica_session') || 'null'); } catch { return null; } })();
    let sw = ''; try { sw = localStorage.getItem('amica_sw_version') || ''; } catch { /* nada */ }
    fetch('/api/app-erro', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
      body: JSON.stringify({
        mensagem: 'reload: ' + String(mensagem).slice(0, 280), stack: String(detalhe).slice(0, 1500),
        usuario: sess?.usuario || null, modulo: window.__amiciaModuloAtivo || null,
        device_id: (() => { try { return aparelhoId(); } catch { return null; } })(),   // 24/09: nome certo do id
        aparelho: navigator.userAgent, url: location.pathname + location.search, versao_sw: sw,
      }),
    }).catch(() => {});
  } catch { /* nada */ }
}

// pagina descarregada (fechou, F5, navegou) com trabalho em andamento
if (typeof window !== 'undefined' && !(window as any).__amiciaOcupadoLigado) {
  (window as any).__amiciaOcupadoLigado = true;
  window.addEventListener('beforeunload', () => {
    if (estaOcupado()) registrarEvento(`pagina descarregada com trabalho em andamento (${window.__amiciaOcupado})`, `visivel=${!document.hidden}`);
  });
}
