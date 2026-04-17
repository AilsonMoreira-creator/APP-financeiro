// api/version.js — Retorna versão do app deployado (usado pro auto-update check)
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.json({ version: '6.8' });
}
