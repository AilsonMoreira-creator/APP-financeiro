import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Build time injetado em tempo de build (Ailson 08/05/2026)
// Acessivel no app via __APP_BUILD__ — usado pra mostrar versao na UI
// e ajudar diagnostico de cache.
const buildTime = new Date().toISOString();

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_BUILD__: JSON.stringify(buildTime),
  },
})
