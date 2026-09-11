// fotoProdutosCache.js — memoria compartilhada das fotos do bucket "produtos"
// (Ailson 11/09/2026 — incidente: um PC com a tela do Bling Estoque fez ~7.000
// requisicoes/5min ao Storage porque cada REF sem foto tentava 12 URLs a cada
// abertura, sem lembrar de nada; o Supabase saturou (58/60 conexoes) e o app
// inteiro ficou em branco).
//
// Regras: (1) REF que resolveu → lembra a URL boa (nao tenta as outras);
// (2) REF que esgotou a cadeia → "sem foto" por 1 dia; (3) enquanto uma REF
// esta sendo resolvida, os outros <img> da mesma REF esperam o resultado.
const KEY = 'foto_produtos_cache_v1';
const DIA = new Date().toISOString().slice(0, 10);
let mem = null;
function carregar() {
  if (mem) return mem;
  try { const j = JSON.parse(localStorage.getItem(KEY) || '{}'); mem = j.dia === DIA ? j : { dia: DIA, ok: {}, sem: {} }; }
  catch { mem = { dia: DIA, ok: {}, sem: {} }; }
  if (!mem.ok) mem.ok = {}; if (!mem.sem) mem.sem = {};
  return mem;
}
let salvarT = null;
function salvar() { clearTimeout(salvarT); salvarT = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch { /* ok */ } }, 400); }

export function fotoUrlConhecida(ref) { const m = carregar(); return m.ok[ref] || null; }
export function fotoSemFoto(ref) { const m = carregar(); return m.sem[ref] === true; }
export function marcarFotoOk(ref, url) { const m = carregar(); m.ok[ref] = url; delete m.sem[ref]; salvar(); }
export function marcarSemFoto(ref) { const m = carregar(); m.sem[ref] = true; salvar(); }

// cadeia de candidatos (a mesma de sempre), mas so e percorrida uma vez por dia por REF
export function candidatosFoto(refProd, completa = true) {
  const orig = String(refProd || '').trim().toUpperCase();
  const norm = orig.replace(/^0+/, '');
  if (!norm) return [];
  const urls = [norm + '.jpg', norm + '.png', norm + '.webp'];
  if (!completa) { if (orig !== norm) urls.push(orig + '.jpg'); const p4 = norm.padStart(4, '0'); if (p4 !== norm && p4 !== orig) urls.push(p4 + '.jpg'); return urls; }
  if (orig !== norm) urls.push(orig + '.jpg', orig + '.png', orig + '.webp');
  const pad4 = norm.padStart(4, '0'); const pad5 = norm.padStart(5, '0');
  if (pad4 !== norm && pad4 !== orig) urls.push(pad4 + '.jpg', pad4 + '.png', pad4 + '.webp');
  if (pad5 !== norm && pad5 !== orig && pad5 !== pad4) urls.push(pad5 + '.jpg', pad5 + '.png', pad5 + '.webp');
  return urls;
}

// handler de onError compartilhado: avanca na cadeia; no fim marca sem foto e
// esconde a imagem. `base` e a URL do bucket; `cb` e o cache-buster (ou '').
export function onErroFoto(e, ref, urls, base, cb, aoEsgotar) {
  const cur = e.target.src || '';
  const idx = urls.findIndex(u => cur.includes(base + u));
  if (idx >= 0 && idx < urls.length - 1) { e.target.src = base + urls[idx + 1] + cb; return; }
  marcarSemFoto(ref);
  e.target.style.display = 'none';
  if (aoEsgotar) aoEsgotar(e);
}
export function onFotoCarregou(e, ref) { marcarFotoOk(ref, e.target.src); }
