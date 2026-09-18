// corTecido.js — cor LEVE de realce por tecido (Ailson 17/09/2026)
// Cada tecido sempre com a MESMA cor, pra ninguém confundir tecido na Ordem de
// Corte. A cor sai do cadastro de tecidos (campo `cor`); sem cadastro, cai numa
// cor estável derivada do nome. Arquivo próprio pra não criar import circular
// entre App.tsx e OrdemDeCorte.jsx.
const REALCES_TECIDO = ['#fdf0e3', '#e8f4ea', '#e9eff9', '#f7e9f2', '#fbf5da', '#e6f3f5', '#f1ece4', '#f3e7e7', '#eaf0e0', '#ece8f6'];

export function corTecido(nome, tecidosCAD = []) {
  const n = String(nome || '').trim();
  if (!n) return null;
  const cad = (tecidosCAD || []).find(t => String(t.descricao || '').trim().toLowerCase() === n.toLowerCase());
  if (cad && cad.cor) return cad.cor;
  let h = 0;
  for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0;
  return REALCES_TECIDO[h % REALCES_TECIDO.length];
}
