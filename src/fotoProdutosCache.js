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

// ── 23/09: LISTA do bucket (o que existe de verdade). Com ela, a cadeia de tentativas vira
// uma escolha certa: so entra na lista de candidatos o arquivo que existe, e REF sem nenhum
// arquivo ja nasce "sem foto" — zero requisicoes erradas ao Storage (eram 2.269 400s/dia).
const KEY_LISTA = 'foto_produtos_lista_v2';
const TTL_LISTA = 10 * 60 * 1000;   // 23/09: 10 min (antes: o dia inteiro — foto nova ficava invisivel ate o dia seguinte)
let lista = null, listaEm = 0, buscando = null;
try { const j = JSON.parse(localStorage.getItem(KEY_LISTA) || 'null'); if (j && Array.isArray(j.arquivos) && Date.now() - (j.em || 0) < 6 * 3600e3) { lista = new Set(j.arquivos); listaEm = j.em || 0; } } catch { /* ok */ }
export function atualizarListaFotos(forcar) {
  if (typeof window === 'undefined') return Promise.resolve();
  if (buscando) return buscando;
  if (!forcar && lista && Date.now() - listaEm < TTL_LISTA) return Promise.resolve();
  buscando = fetch('/api/produtos-fotos' + (forcar ? '?t=' + Date.now() : '')).then(r => r.json()).then(j => {
    if (j?.ok && Array.isArray(j.arquivos) && j.arquivos.length) {
      lista = new Set(j.arquivos); listaEm = Date.now();
      try { localStorage.setItem(KEY_LISTA, JSON.stringify({ em: listaEm, arquivos: j.arquivos })); } catch { /* ok */ }
      try { window.dispatchEvent(new Event('fotos-produtos-lista')); } catch { /* ok */ }
    }
  }).catch(() => { /* sem lista: segue o modo antigo */ }).finally(() => { buscando = null; });
  return buscando;
}
atualizarListaFotos(false);
if (typeof window !== 'undefined') setInterval(() => atualizarListaFotos(false), TTL_LISTA);
// chamado depois de subir/apagar foto (Ficha Tecnica/Calculadora): esquece a REF e rele a lista na hora
export function fotoInvalidar(ref) {
  const m = carregar(); const norm = String(ref || '').trim().toUpperCase().replace(/^0+/, '');
  for (const k of [norm, String(ref || '').trim().toUpperCase()]) { delete m.ok[k]; delete m.sem[k]; }
  salvar(); return atualizarListaFotos(true);
}
function filtrarPelaLista(urls) { return lista ? urls.filter(u => lista.has(u)) : urls; }
export function filtrarFotosExistentes(urls) { return filtrarPelaLista([...new Set(urls)]); }
export function listaFotosPronta() { return !!lista; }

export function fotoUrlConhecida(ref) {
  const m = carregar(); const u = m.ok[ref]; if (!u) return null;
  if (lista) { const arq = String(u).split('/produtos/')[1]?.split('?')[0]; if (arq && !lista.has(arq)) { delete m.ok[ref]; salvar(); return null; } }   // arquivo trocado/apagado
  return u;
}
export function fotoSemFoto(ref) {
  const m = carregar();
  // 23/09: com a lista, ela manda (vale mais que o "sem foto do dia" antigo — foto nova aparece)
  if (lista) return !candidatosFoto(ref, true).length;
  return m.sem[ref] === true;
}
export function marcarFotoOk(ref, url) { const m = carregar(); m.ok[ref] = url; delete m.sem[ref]; salvar(); }
export function marcarSemFoto(ref) { const m = carregar(); m.sem[ref] = true; salvar(); }

// cadeia de candidatos (a mesma de sempre), mas so e percorrida uma vez por dia por REF
export function candidatosFoto(refProd, completa = true) {
  const orig = String(refProd || '').trim().toUpperCase();
  const norm = orig.replace(/^0+/, '');
  if (!norm) return [];
  const urls = [norm + '.jpg', norm + '.png', norm + '.webp'];
  if (!completa) { if (orig !== norm) urls.push(orig + '.jpg'); const p4 = norm.padStart(4, '0'); if (p4 !== norm && p4 !== orig) urls.push(p4 + '.jpg'); return filtrarPelaLista(urls); }
  if (orig !== norm) urls.push(orig + '.jpg', orig + '.png', orig + '.webp');
  const pad4 = norm.padStart(4, '0'); const pad5 = norm.padStart(5, '0');
  if (pad4 !== norm && pad4 !== orig) urls.push(pad4 + '.jpg', pad4 + '.png', pad4 + '.webp');
  if (pad5 !== norm && pad5 !== orig && pad5 !== pad4) urls.push(pad5 + '.jpg', pad5 + '.png', pad5 + '.webp');
  return filtrarPelaLista(urls);
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
