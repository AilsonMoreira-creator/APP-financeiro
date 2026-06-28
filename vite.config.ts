import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Build time injetado em tempo de build (Ailson 08/05/2026)
// Acessivel no app via __APP_BUILD__ — usado pra mostrar versao na UI
// e ajudar diagnostico de cache.
const buildTime = new Date().toISOString();

// Emite dist/version.json com o MESMO carimbo do build. O app busca esse arquivo
// (no-store) ao abrir/focar e recarrega sozinho se estiver rodando um build
// antigo. Resolve o cache preso no iPhone standalone (JS congela em background,
// entao o reg.update do SW nao roda — a checagem no foco fura esse ponto cego).
// Ailson 28/06/2026.
function versionJsonPlugin() {
  return {
    name: 'amicia-version-json',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ build: buildTime }),
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), versionJsonPlugin()],
  define: {
    __APP_BUILD__: JSON.stringify(buildTime),
  },
})
