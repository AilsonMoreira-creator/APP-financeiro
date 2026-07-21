// ============================================================================
// bling-produtos-novos — busca DIRECIONADA de produtos novos no Bling Exitus.
//
// Problema: o bling-estoque-sync pagina o catalogo inteiro (200 pags / 270s de
// safety) e produtos recem-cadastrados no fim da paginacao nunca entravam.
// Aqui a busca e por ref: pega as refs da CALCULADORA que ainda nao tem linha
// em bling_estoque e procura cada uma via GET /produtos?nome= (com e sem zero
// a esquerda). Rapido (poucos requests) e mantem a exigencia da calculadora.
//
// Tambem sobe a foto do card: detalhe da 1a variacao com midia -> bucket
// `produtos/{refNorm}.jpg` (SO se ainda nao existir — nao sobrescreve foto
// curada). A foto por SKU do carrinho Meluni segue com o cron bling-fotos-sync.
//
// Uso:
//   GET /api/bling-produtos-novos?run=1          -> executa
//   GET /api/bling-produtos-novos?dry=1          -> simula (nao grava)
//   GET /api/bling-produtos-novos?run=1&refs=3247,3248 -> forca refs especificas
//
// Ailson 21/07/2026.
// ============================================================================
import { refreshBlingToken, blingFetch, parseDescricao, supabase } from './_bling-helpers.js';

export const config = { maxDuration: 120 };

const API = 'https://api.bling.com.br/Api/v3';
const SALDO_LOTE = 40;
const MAX_REFS = 15;

const normRef = (r) => String(r || '').replace(/\D/g, '').replace(/^0+/, '') || '';
const normCor = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const linkDoDetalhe = (det) =>
  det?.midia?.imagens?.internas?.[0]?.link
  || det?.midia?.imagens?.externas?.[0]?.link
  || null;

async function depositoGeral(headers) {
  // 1) config salvo pelo bling-estoque-sync (exitus)
  const { data } = await supabase.from('amicia_data').select('payload').eq('user_id', 'bling-estoque-config').maybeSingle();
  if (data?.payload?.deposito_geral) return String(data.payload.deposito_geral);
  // 2) fallback: detecta igual ao sync
  const rd = await blingFetch(`${API}/depositos?pagina=1&limite=100`, headers);
  const jd = await rd.json().catch(() => ({}));
  const deps = jd.data || [];
  const ativo = (d) => d.situacao === undefined || d.situacao === 1 || d.situacao === true || d.situacao === 'A';
  const pick = deps.find(d => d.padrao === true) || deps.find(d => /geral/i.test(d.descricao || '')) || deps.find(ativo) || deps[0];
  return pick ? String(pick.id) : null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  const q = req.query || {};
  const dry = q.dry === '1';
  if (q.run !== '1' && !dry) return res.status(403).json({ erro: 'use ?run=1 (ou ?dry=1)' });

  const out = {
    ok: false, dry, candidatas: [], encontradas: [], nao_encontradas: [],
    linhas: 0, upserted: 0, fotos_subidas: [], fotos_ja_existiam: [], skus: [], erros: [],
  };

  try {
    // ── 1. Candidatas: refs da calculadora sem linha em bling_estoque ────
    let candidatas = [];
    if (q.refs) {
      candidatas = String(q.refs).split(',').map(normRef).filter(Boolean);
    } else {
      const { data: cm } = await supabase.from('amicia_data').select('payload').eq('user_id', 'calc-meluni').maybeSingle();
      const calcRefs = new Set();
      for (const p of (cm?.payload?.prods || [])) { const r = normRef(p.ref); if (r) calcRefs.add(r); }
      const jaTem = new Set();
      for (let off = 0; off < 60000; off += 1000) {
        const { data: be } = await supabase.from('bling_estoque').select('ref').range(off, off + 999);
        if (!be || !be.length) break;
        for (const b of be) jaTem.add(normRef(b.ref));
        if (be.length < 1000) break;
      }
      candidatas = [...calcRefs].filter(r => !jaTem.has(r));
    }
    candidatas = candidatas.slice(0, MAX_REFS);
    out.candidatas = candidatas;
    if (!candidatas.length) { out.ok = true; out.msg = 'nenhuma ref nova na calculadora'; return res.status(200).json(out); }

    const token = await refreshBlingToken('exitus');
    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };

    // ── 2. Busca por nome (ref com zero a esquerda e sem) ────────────────
    // Padrao do catalogo: "Vestido ... (ref 03247) (B) Cor:X;Tamanho:M".
    const porRef = new Map(); // refNorm -> [{sku, cor, tam, idProduto, gtin, titulo, imagemURL}]
    for (const ref of candidatas) {
      const termos = [...new Set([ref.padStart(5, '0'), ref.padStart(4, '0'), ref])];
      const vistos = new Set();
      for (const termo of termos) {
        await sleep(350);
        const r = await blingFetch(`${API}/produtos?pagina=1&limite=100&nome=${encodeURIComponent(termo)}`, headers);
        if (!r.ok) { out.erros.push(`busca ${termo} HTTP ${r.status}`); continue; }
        const j = await r.json().catch(() => ({}));
        if (q.debug === '1') {
          if (!out.debug_busca) out.debug_busca = [];
          out.debug_busca.push({ termo, total: (j.data || []).length, amostra: (j.data || []).slice(0, 5).map(p => ({ id: p.id, codigo: p.codigo, nome: (p.nome || '').slice(0, 90), formato: p.formato, tipo: p.tipo })) });
        }
        for (const p of (j.data || [])) {
          const sku = (p.codigo || '').trim();
          if (!sku || vistos.has(sku)) continue;
          const parsed = parseDescricao(p.nome || '');
          // aceita se a ref parseada bate, ou se o nome contem a ref como token
          const bate = normRef(parsed.ref) === ref
            || new RegExp(`(^|\\D)0*${ref}(\\D|$)`).test(p.nome || '');
          if (!bate) continue;
          vistos.add(sku);
          if (!porRef.has(ref)) porRef.set(ref, []);
          porRef.get(ref).push({
            sku, cor: parsed.cor || '', tam: (parsed.tamanho || '').toUpperCase(),
            idProduto: p.id || null, gtin: (p.gtin || '').trim(), titulo: p.nome || '',
            imagemURL: p.imagemURL || null,
          });
        }
        if (vistos.size) break; // achou nesse formato, nao precisa dos outros
      }
      if (!porRef.has(ref)) out.nao_encontradas.push(ref);
    }
    out.encontradas = [...porRef.keys()];
    if (!porRef.size) { out.ok = true; return res.status(200).json(out); }

    // ── 3. Saldos do deposito Geral ──────────────────────────────────────
    const depositoId = await depositoGeral(headers);
    out.deposito = depositoId;
    const idToVar = new Map();
    for (const [ref, vars] of porRef.entries()) for (const v of vars) if (v.idProduto) idToVar.set(String(v.idProduto), { ref, ...v });
    const ids = [...idToVar.keys()];
    const saldoPorId = new Map();
    for (let i = 0; i < ids.length; i += SALDO_LOTE) {
      await sleep(350);
      const lote = ids.slice(i, i + SALDO_LOTE);
      const qs = lote.map(id => `idsProdutos[]=${id}`).join('&');
      const r = await blingFetch(`${API}/estoques/saldos?${qs}`, headers);
      if (!r.ok) { out.erros.push(`saldos lote ${i} HTTP ${r.status}`); continue; }
      const j = await r.json().catch(() => ({}));
      for (const s of (j.data || [])) {
        const pid = String(s.produto?.id ?? s.id ?? '');
        let saldo = null;
        const dep = (s.depositos || []).find(d => String(d.id ?? d.deposito?.id) === String(depositoId));
        if (dep) saldo = dep.saldoFisico ?? dep.saldo ?? dep.deposito?.saldoFisico ?? null;
        if (saldo == null) saldo = s.saldoFisicoTotal ?? s.estoqueAtual ?? null;
        saldoPorId.set(pid, Math.max(0, Math.round(Number(saldo) || 0))); // exitus clampa em 0
      }
    }

    // ── 4. Upsert bling_estoque (mesmo shape do bling-estoque-sync) ──────
    const linhas = new Map();
    for (const [pid, v] of idToVar.entries()) {
      const qtd = saldoPorId.get(pid) ?? 0;
      const cor_norm = normCor(v.cor);
      const key = `${v.ref}|${cor_norm}|${v.tam}`;
      const ex = linhas.get(key);
      if (ex) { ex.qtd += qtd; }
      else linhas.set(key, {
        ref: v.ref, cor_norm, tam: v.tam, cor_label: v.cor || null, qtd,
        bling_sku: v.sku, bling_produto_id: v.idProduto, gtin: v.gtin || null, titulo: v.titulo || null,
      });
    }
    out.linhas = linhas.size;
    out.skus = [...idToVar.values()].map(v => v.sku);
    out.amostra = [...linhas.values()].slice(0, 10);
    if (!dry && linhas.size) {
      const rows = [...linhas.values()].map(l => ({ ...l, atualizado_em: new Date().toISOString(), atualizado_por: 'produtos_novos' }));
      const { error } = await supabase.from('bling_estoque').upsert(rows, { onConflict: 'ref,cor_norm,tam' });
      if (error) out.erros.push(`upsert: ${error.message}`);
      else out.upserted = rows.length;
    }

    // ── 5. Foto do card: bucket produtos/{refNorm}.jpg (so se nao existir) ─
    for (const [ref, vars] of porRef.entries()) {
      try {
        const { data: existentes } = await supabase.storage.from('produtos').list('', { search: `${ref}.` });
        const jaTemFoto = (existentes || []).some(f => new RegExp(`^0*${ref}\\.(jpg|jpeg|png|webp)$`, 'i').test(f.name));
        if (jaTemFoto) { out.fotos_ja_existiam.push(ref); continue; }
        // detalhe da 1a variacao com thumb (senao a 1a com id) — full-size, fallback pai
        const alvo = vars.find(v => v.imagemURL && v.idProduto) || vars.find(v => v.idProduto);
        if (!alvo) continue;
        await sleep(350);
        const rd = await blingFetch(`${API}/produtos/${alvo.idProduto}`, headers);
        const jd = await rd.json().catch(() => null);
        let link = linkDoDetalhe(jd?.data || {});
        const paiId = jd?.data?.variacao?.produtoPai?.id || null;
        if (!link && paiId) {
          await sleep(350);
          const rp = await blingFetch(`${API}/produtos/${paiId}`, headers);
          const jp = await rp.json().catch(() => null);
          link = linkDoDetalhe(jp?.data || {});
        }
        if (!link) continue;
        if (dry) { out.fotos_subidas.push(ref + ' (dry)'); continue; }
        const rimg = await fetch(link);
        if (!rimg.ok) { out.erros.push(`foto ${ref} download HTTP ${rimg.status}`); continue; }
        const buf = Buffer.from(await rimg.arrayBuffer());
        const up = await supabase.storage.from('produtos').upload(`${ref}.jpg`, buf, { contentType: 'image/jpeg', upsert: false });
        if (up.error) { out.erros.push(`foto ${ref} upload: ${up.error.message}`); continue; }
        out.fotos_subidas.push(ref);
      } catch (e) { out.erros.push(`foto ${ref}: ${e.message}`); }
    }

    out.ok = true;
    return res.status(200).json(out);
  } catch (e) {
    out.erros.push(e.message || String(e));
    return res.status(500).json(out);
  }
}
