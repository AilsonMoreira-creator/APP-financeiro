/**
 * middleware.js — PORTEIRO das APIs (/api/*). Ailson, 22/09/2026. Passo 4 do login, fase 1b.
 *
 * MODO SOMBRA: NAO bloqueia nada e NAO atrasa nada. Libera a chamada na hora e, em segundo
 * plano (waitUntil), classifica quem chamou:
 *   cron      -> User-Agent vercel-cron (crons do Vercel / despachante / esteira)
 *   webhook   -> Bling, Mercado Livre, Meta/WhatsApp, Shopee, TikTok, callbacks OAuth
 *   publico   -> login, versao, saude de fora
 *   com       -> token de sessao valido E o modulo do endpoint esta no token (ou admin)
 *   sem_modulo-> token valido mas o usuario NAO tem esse modulo  (seria 403 na fase 2)
 *   sem       -> sem token                                         (seria 401 na fase 2)
 *   invalido  -> token com assinatura ruim ou vencido               (seria 401 na fase 2)
 * Conta em memoria e grava em lote (app_porteiro_contar) a cada ~30 s.
 * Qualquer erro aqui e engolido: o porteiro nunca pode derrubar uma API.
 */
export const config = { matcher: '/api/:path*' };

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_KEY;

// ── endpoint -> modulo (pelo prefixo do nome). Modulos = ids da tela Usuarios. ──
const MODULOS = [
  [/^lojas-whats|^sofia-|^clientes-sofia/, 'sofia', ['sofia']],
  [/^lojas-/, 'lojas', ['lojas']],
  [/^meluni-|^lara-|^calc-meluni/, 'meluni', ['meluni', 'calculadora']],
  [/^wms-/, 'wms', ['wms']],
  [/^ml-sale|^ml-full|^full-|^ml-estoque|^bling-|^mapeamento|^gtin|^etiqueta/, 'bling', ['bling']],
  [/^ml-|^sac-|^reviews/, 'sac', ['sac']],
  [/^oficina|^caseado|^passadoria|^cortes?-|^corte-/, 'oficinas', ['oficinas']],
  [/^sala|^salas-/, 'salascorte', ['salascorte', 'oficinas']],
  [/^ficha/, 'fichatecnica', ['fichatecnica']],
  [/^os-|^ia-|^raiox/, 'osamicia', ['osamicia']],
  [/^financeiro|^boleto|^despesa|^receita|^fluxo|^dre/, 'financeiro', ['dashboard', 'lancamentos', 'boletos', 'relatorio']],
  [/^calc/, 'calculadora', ['calculadora']],
];const WEBHOOK = /webhook|callback|oauth|notifica|^bling-callback|^ga4-oauth|^meta-verify|^whats-in/;
const PUBLICO = /^app-login$|^app-sessao$|^version$|^saude-|^health|^cron-despachante$/;

function moduloDe(nome) { for (const [re, m, ids] of MODULOS) if (re.test(nome)) return { m, ids }; return { m: 'outros', ids: [] }; }

// ── segredo do token (tabela fechada app_segredos), cache por instancia ──
let _seg = null, _segEm = 0;
async function segredos() {
  if (_seg && Date.now() - _segEm < 300000) return _seg;
  const r = await fetch(`${SB_URL}/rest/v1/app_segredos?select=chave,valor&chave=in.(sessao_atual,sessao_anterior)`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } });
  const rows = await r.json();
  _seg = (Array.isArray(rows) ? rows : []).map(x => x.valor).filter(Boolean); _segEm = Date.now();
  return _seg;
}
const b64uBytes = (s) => { const b = atob(String(s).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(s).length + 3) % 4)); return Uint8Array.from(b, c => c.charCodeAt(0)); };
async function verificar(token) {
  const p = String(token || '').split('.'); if (p.length !== 3) return { ok: false };
  const enc = new TextEncoder();
  for (const s of await segredos()) {
    const key = await crypto.subtle.importKey('raw', enc.encode(s), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    if (await crypto.subtle.verify('HMAC', key, b64uBytes(p[2]), enc.encode(`${p[0]}.${p[1]}`))) {
      const c = JSON.parse(new TextDecoder().decode(b64uBytes(p[1])));
      return { ok: !!c.exp && c.exp * 1000 > Date.now(), claims: c };
    }
  }
  return { ok: false };
}

// ── contagem em memoria + gravacao em lote ──
const buf = new Map(); let ultimoFlush = Date.now();
function contar(m, c, t, u) {
  const k = `${m}|${c}|${t}`; const e = buf.get(k) || { m, c, t, n: 0, u: new Set() };
  e.n++; if (u && e.u.size < 20) e.u.add(u); buf.set(k, e);
}
async function flush(forcar) {
  if (!buf.size || (!forcar && Date.now() - ultimoFlush < 30000)) return;
  const lote = [...buf.values()].map(e => ({ m: e.m, c: e.c, t: e.t, n: e.n, u: [...e.u] }));
  buf.clear(); ultimoFlush = Date.now();
  await fetch(`${SB_URL}/rest/v1/rpc/app_porteiro_contar`, { method: 'POST', headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ p: lote }) });
}

async function classificar(req) {
  const url = new URL(req.url);
  const nome = url.pathname.replace(/^\/api\//, '').replace(/\/.*$/, '').replace(/\.js$/, '');
  const ua = req.headers.get('user-agent') || '';
  const { m: modulo, ids } = moduloDe(nome);
  if (/vercel-cron/i.test(ua) || req.headers.get('x-cron-despachante')) return contar(modulo, nome, 'cron');
  if (WEBHOOK.test(nome)) return contar(modulo, nome, 'webhook');
  if (PUBLICO.test(nome)) return contar(modulo, nome, 'publico');
  const a = req.headers.get('authorization') || '';
  if (!a.startsWith('Bearer ')) return contar(modulo, nome, 'sem', req.headers.get('x-user') || null);
  const v = await verificar(a.slice(7).trim());
  if (!v.claims) return contar(modulo, nome, 'invalido', req.headers.get('x-user') || null);
  const u = v.claims.sub;
  if (!v.ok) return contar(modulo, nome, 'invalido', u);
  const temModulo = v.claims.adm || modulo === 'outros' || ids.some(i => (v.claims.mod || []).includes(i));
  return contar(modulo, nome, temModulo ? 'com' : 'sem_modulo', u);
}

export default function middleware(request, context) {
  try {
    if (SB_URL && SB_KEY && context?.waitUntil) {
      context.waitUntil((async () => { try { await classificar(request); await flush(false); } catch { /* silencio */ } })());
    }
  } catch { /* nunca atrapalha */ }
  // sem retorno = segue pra API normalmente
}
