/**
 * aparelhoId.ts — identificador do aparelho guardado em MAIS DE UM LUGAR (Ailson 24/09/2026).
 *
 * Por que: a regra de "aparelho conhecido" depende desse id. Se ele some (localStorage limpo,
 * Safari apagando dados de site parado), o aparelho vira "novo" e pediria aprovacao.
 * Lugares: 1) localStorage 'amica_device' (o de sempre)  2) IndexedDB 'amica'/'kv'
 *          3) cookie HttpOnly 'amica_dev' gravado pelo SERVIDOR (/api/app-sessao) — o servidor
 *             devolve o id conhecido e a tela adota (adotarAparelhoId).
 * Limite conhecido: no iPhone, APAGAR o atalho da tela inicial apaga tudo dele (inclusive o
 * cookie); ai o aparelho e novo mesmo. Dentro da empresa isso nao pede aprovacao (IP da empresa).
 */
const K = 'amica_device';
let _geradoAgora: string | null = null;

function novo(): string {
  try { if (crypto?.randomUUID) return crypto.randomUUID(); } catch { /* segue */ }
  return String(Date.now()) + '-' + Math.random().toString(36).slice(2);
}
function lsGet(): string | null { try { return localStorage.getItem(K); } catch { return null; } }
function lsSet(v: string) { try { localStorage.setItem(K, v); } catch { /* sem storage */ } }

function abrirIdb(): Promise<IDBDatabase | null> {
  return new Promise((res) => {
    try {
      const r = indexedDB.open('amica', 1);
      r.onupgradeneeded = () => { try { r.result.createObjectStore('kv'); } catch { /* ja existe */ } };
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
      setTimeout(() => res(null), 3000);
    } catch { res(null); }
  });
}
async function idbGet(): Promise<string | null> {
  const db = await abrirIdb(); if (!db) return null;
  return new Promise((res) => {
    try { const q = db.transaction('kv', 'readonly').objectStore('kv').get(K); q.onsuccess = () => res(q.result ? String(q.result) : null); q.onerror = () => res(null); }
    catch { res(null); }
  });
}
async function idbSet(v: string) {
  const db = await abrirIdb(); if (!db) return;
  try { db.transaction('kv', 'readwrite').objectStore('kv').put(v, K); } catch { /* sem idb */ }
}

/** Id do aparelho (sincrono). Se nao existir em lugar nenhum ainda, cria. */
export function aparelhoId(): string {
  let d = lsGet();
  if (!d) { d = novo(); lsSet(d); _geradoAgora = d; idbSet(d); }
  return d;
}

/** Troca pelo id que o servidor reconheceu (cookie) ou que estava no IndexedDB. */
export function adotarAparelhoId(id: string) {
  if (!id || id === 'sem-storage') return;
  if (lsGet() !== id) lsSet(id);
  idbSet(id);
  _geradoAgora = null;
}

/** Na abertura: se o localStorage perdeu o id mas o IndexedDB tem, recupera; senao copia pro IndexedDB. */
export async function sincronizarAparelhoId() {
  try {
    const salvo = await idbGet();
    const atual = lsGet();
    if (salvo && (!atual || atual === _geradoAgora)) { adotarAparelhoId(salvo); return; }
    if (atual && salvo !== atual) idbSet(atual);
  } catch { /* nunca derruba a abertura */ }
}
