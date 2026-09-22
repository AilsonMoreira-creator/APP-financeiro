/**
 * sessaoToken.ts — token de sessao do app (PASSO 4 do login, fase 1). Ailson, 20/09/2026.
 *
 * O login (/api/app-login) devolve um token assinado (12h). Aqui a gente:
 *   · guarda em localStorage (amica_token)
 *   · injeta `Authorization: Bearer …` em TODA chamada fetch pra /api/ do proprio app
 *     (um so lugar, sem mexer nas ~200 chamadas espalhadas)
 *   · renova em silencio depois de 6h, pelo /api/app-login {renovar:true}
 * Nenhum endpoint EXIGE o token ainda (fase 1 = sombra). Nada quebra se faltar.
 */
const CHAVE = 'amica_token';
const RENOVAR_APOS_MS = 6 * 3600 * 1000;

export function guardarToken(t: string | null) {
  try { if (t) localStorage.setItem(CHAVE, t); else localStorage.removeItem(CHAVE); } catch {}
}
export function lerToken(): string | null { try { return localStorage.getItem(CHAVE); } catch { return null; } }
export function limparToken() { guardarToken(null); }

function claims(t: string | null): any {
  try { if (!t) return null; const p = t.split('.')[1]; return JSON.parse(atob(p.replace(/-/g, '+').replace(/_/g, '/'))); } catch { return null; }
}

let _instalado = false;
export function instalarInterceptador() {
  if (_instalado || typeof window === 'undefined' || typeof window.fetch !== 'function') return;
  _instalado = true;
  const original = window.fetch.bind(window);
  window.fetch = (input: any, init?: any) => {
    try {
      const url = typeof input === 'string' ? input : (input?.url || '');
      const mesmaOrigem = url.startsWith('/api/') || url.startsWith(`${location.origin}/api/`);
      let t = mesmaOrigem ? lerToken() : null;
      if (t && url.indexOf('/api/app-login') < 0) { const c = claims(t); if (c?.exp && c.exp * 1000 < Date.now()) t = null; }   // vencido: nao manda (a renovacao ja troca)
      if (t) {
        init = init ? { ...init } : {};
        const h = new Headers(init.headers || (typeof input !== 'string' ? input.headers : undefined) || {});
        if (!h.has('Authorization')) h.set('Authorization', `Bearer ${t}`);
        init.headers = h;
      }
    } catch { /* nunca atrapalha a chamada */ }
    return original(input, init);
  };
}

let _renovando = false;
export async function renovarSePreciso() {
  const t = lerToken(); const c = claims(t);
  if (!t || !c?.iat || _renovando) return;
  const idade = Date.now() - c.iat * 1000;
  // vencido ha mais de 7 dias: nem tenta (o servidor recusaria) — fica pro proximo login
  const vencido = c.exp && c.exp * 1000 < Date.now();
  if (idade < RENOVAR_APOS_MS && !vencido) return;
  _renovando = true;
  try {
    const r = await fetch('/api/app-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ renovar: true }) });
    const j = await r.json();
    if (j?.ok && j.token) guardarToken(j.token);
    // se nao renovou (sessao encerrada no servidor), o token vencido fica; fase 2 vai pedir login
  } catch {} finally { _renovando = false; }
}

/** chamado no boot: instala o interceptador e agenda a renovacao */
export function iniciarSessaoToken() {
  instalarInterceptador();
  setTimeout(renovarSePreciso, 0);   // 22/09: renova ja na abertura (antes era 3 s)
  setInterval(renovarSePreciso, 15 * 60 * 1000);
}
