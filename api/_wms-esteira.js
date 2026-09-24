/**
 * _wms-esteira.js — encadeamento da esteira da madrugada (Ailson, 21/09/2026).
 *
 * Em vez de 4 crons disparando "quase juntos" (que ainda se sobrepoem quando uma
 * rodada demora), UM cron dispara a varredura com ?encadear=1 e cada passo chama o
 * proximo QUANDO TERMINA: sync -> nfe-auto -> classificar -> preparar-lote.
 * Assim nunca ha dois passos batendo no Bling ao mesmo tempo pela mesma conta.
 * O proximo e chamado sem esperar a resposta (1,5 s de timeout so pra garantir que
 * a chamada saiu; a funcao do Vercel continua rodando mesmo com a conexao fechada).
 */
const BASE = process.env.APP_BASE_URL || 'https://app-financeiro-brown.vercel.app';
const PROXIMO = {
  '/api/wms-sync':          '/api/wms-nfe-auto?contas=exitus,lumia,muniam&limite=120&encadear=1',
  '/api/wms-nfe-auto':      '/api/wms-classificar?encadear=1',
  '/api/wms-classificar':   '/api/wms-preparar-lote?limite=150&encadear=1',
  '/api/wms-preparar-lote': null,
};
export function encadeando(req) { return String(req.query?.encadear || '') === '1'; }
export async function encadearProximo(req, caminhoAtual) {
  if (!encadeando(req)) return null;
  const prox = PROXIMO[caminhoAtual];
  if (!prox) return null;
  try {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 1500);
    // 23/09 Fase 1: o proximo passo prova que e cron pelo CRON_SECRET (a trava da NF confere)
    const h = { 'User-Agent': 'vercel-cron/esteira', 'X-Cron-Despachante': '1' };
    if (process.env.CRON_SECRET) h.Authorization = `Bearer ${process.env.CRON_SECRET}`;
    await fetch(`${BASE}${prox}`, { headers: h, signal: ctrl.signal }).catch(() => {});
    clearTimeout(t);
  } catch { /* o cron da proxima rodada cobre */ }
  return prox;
}
