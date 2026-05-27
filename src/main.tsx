import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Service Worker registration + auto-update detector
// Ailson 08/05/2026: vendedoras estavam vendo versao stale.
// Quando SW novo eh ativado, avisa ('SW_UPDATED') e a pagina se
// recarrega automaticamente pra pegar codigo fresco.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((reg) => {
        // Verifica updates a cada 30s enquanto app aberto
        setInterval(() => reg.update().catch(() => {}), 30000);
      })
      .catch(() => {});
  });

  // Quando SW novo toma controle, recarrega a pagina automaticamente
  // (so 1x por sessao pra evitar loop)
  let recarregouUmaVez = false;
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'SW_UPDATED' && !recarregouUmaVez) {
      recarregouUmaVez = true;
      console.log('[App] SW atualizado, recarregando…', event.data.version);
      window.location.reload();
    }
    // Push notification clicada: SW envia a URL pra App.tsx navegar internamente
    if (event.data?.type === 'NAVEGAR_PARA' && event.data?.url) {
      window.dispatchEvent(new CustomEvent('amicia-navegar', { detail: { url: event.data.url } }));
    }
  });

  // Tambem recarrega quando o controller muda (SW novo ativa)
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (recarregouUmaVez) return;
    recarregouUmaVez = true;
    console.log('[App] controllerchange, recarregando…');
    window.location.reload();
  });
}
