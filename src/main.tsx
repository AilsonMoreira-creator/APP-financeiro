import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { iniciarChecagemVersao } from './version-check.ts'
import { estaOcupado, registrarEvento } from './ocupado.ts'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Auto-atualização por versão (resolve o cache preso no iPhone standalone).
// Independe do SW: compara o build embutido com /version.json no foco. Ailson 28/06/2026.
iniciarChecagemVersao();

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

  // Quando SW novo toma controle, recarrega — mas NUNCA na cara do usuario
  // (Ailson 06/07/2026): com deploy varias vezes ao dia, o reload imediato
  // derrubava quem estava trabalhando. Agora: se a aba esta oculta, recarrega
  // na hora; se esta em uso, adia pro proximo momento em que ficar oculta.
  // (so 1x por sessao pra evitar loop)
  let recarregouUmaVez = false;
  let reloadPendente = false;
  const reloadSeguro = () => {
    if (recarregouUmaVez) return;
    if (document.hidden && !estaOcupado()) {   // 15/09: nunca com trabalho em andamento
      recarregouUmaVez = true;
      console.log('[App] SW atualizado, recarregando (aba oculta)…');
      registrarEvento('service worker novo', 'oculta=true');
      setTimeout(() => window.location.reload(), 150);
    } else {
      reloadPendente = true;
      console.log('[App] SW atualizado, reload adiado pra quando a aba ficar oculta');
    }
  };
  const tentarPendente = (ev?: Event) => {
    const momentoSeguro = ev?.type === 'amicia-momento-seguro';   // 15/09: troca de modulo
    if (reloadPendente && (document.hidden || momentoSeguro) && !recarregouUmaVez && !estaOcupado()) {
      recarregouUmaVez = true;
      registrarEvento('service worker novo (pendente)', 'oculta=true');
      setTimeout(() => window.location.reload(), 150);
    }
  };
  document.addEventListener('visibilitychange', tentarPendente);
  window.addEventListener('amicia-momento-seguro', tentarPendente);
  setInterval(tentarPendente, 30000);   // 15/09: aba oculta e trabalho acabou → agora pode
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'SW_UPDATED') {
      reloadSeguro();
    }
    // Push notification clicada: SW envia a URL pra App.tsx navegar internamente
    if (event.data?.type === 'NAVEGAR_PARA' && event.data?.url) {
      window.dispatchEvent(new CustomEvent('amicia-navegar', { detail: { url: event.data.url } }));
    }
  });

  // Tambem recarrega quando o controller muda (SW novo ativa)
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    reloadSeguro();
  });
}
