import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Build time injetado em tempo de build (Ailson 08/05/2026)
// Acessivel no app via __APP_BUILD__ — usado pra mostrar versao na UI
// e ajudar diagnostico de cache.
// 15/09 (Ailson): o carimbo passou a ser o SW_VERSION do public/sw.js — a regra
// da casa ja e "bumpar o SW sempre que mexer no front". Antes era a hora do build,
// e TODO deploy (ate so de API) recarregava o app de quem estava trabalhando.
import { readFileSync } from 'node:fs'
const buildTime = (() => {
  try { const m = readFileSync('public/sw.js', 'utf8').match(/SW_VERSION\s*=\s*['"]([^'"]+)['"]/); if (m) return m[1]; } catch { /* nada */ }
  return new Date().toISOString();
})();

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
