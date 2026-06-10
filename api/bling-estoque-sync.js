/**
 * bling-estoque-sync.js — Lê saldos do Bling (por SKU) e popula public.bling_estoque
 *
 * Fluxo (Ailson 10/06/2026):
 *  1. token da conta (refreshBlingToken)
 *  2. detecta o DEPÓSITO GERAL (GET /depositos) — override via ?deposito=ID
 *  3. pagina /produtos -> {sku(codigo), ref, cor, tam, idProduto} (parseDescricao)
 *  4. GET /estoques/saldos?idsProdutos[]=... em lotes -> saldoFisico do depósito geral
 *  5. UPSERT em bling_estoque (ref+cor_norm+tam) com qtd, bling_sku, bling_produto_id
 *
 * Uso:
 *  GET /api/bling-estoque-sync                 -> sync exitus, depósito geral auto
 *  GET /api/bling-estoque-sync?conta=lumia
 *  GET /api/bling-estoque-sync?deposito=123    -> força um depósito
 *  GET /api/bling-estoque-sync?dryRun=1        -> não grava; mostra amostra + 1 saldo cru
 *
 * Bling v3: o saldo é por depósito; balanço (na escrita) seta o saldo absoluto.
 */
import { refreshBlingToken, blingFetch, parseDescricao, supabase } from './_bling-helpers.js';

export const config = { maxDuration: 300 };

const API = 'https://api.bling.com.br/Api/v3';
const PAGE_SIZE = 100;
const MAX_PAGES = 200;
const SALDO_LOTE = 40;            // ids por chamada de saldos
const SAFETY_MS = 270000;

const normRef = (r) => String(r || '').replace(/\D/g, '').replace(/^0+/, '') || '';
const normCor = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export default async function handler(req, res) {
  const t0 = Date.now();
  const conta = (req.query.conta || 'exitus').toLowerCase();
  const depositoOverride = req.query.deposito ? String(req.query.deposito) : null;
  const dryRun = req.query.dryRun === '1' || req.query.dryRun === 'true';

  const resumo = {
    conta, dryRun, deposito: null, deposito_nome: null,
    paginas: 0, produtos_lidos: 0, sem_sku: 0, sem_ref: 0,
    com_saldo: 0, linhas: 0, upserted: 0, amostra: [], saldo_cru: null, erros: [],
  };

  try {
    const token = await refreshBlingToken(conta);
    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };

    // ── 1. Depósito geral ────────────────────────────────────────────────
    let depositoId = depositoOverride;
    let depositoNome = depositoOverride ? `(override ${depositoOverride})` : null;
    if (!depositoId) {
      const rd = await blingFetch(`${API}/depositos?pagina=1&limite=100`, headers);
      const jd = await rd.json().catch(() => ({}));
      if (!rd.ok) { resumo.erros.push(`depositos HTTP ${rd.status}: ${JSON.stringify(jd).slice(0, 200)}`); return res.status(502).json(resumo); }
      const deps = jd.data || [];
      // prioridade: padrão > nome ~ "geral" > primeiro ativo
      const ativo = (d) => d.situacao === undefined || d.situacao === 1 || d.situacao === true || d.situacao === 'A';
      const pick = deps.find(d => d.padrao === true) ||
                   deps.find(d => /geral/i.test(d.descricao || '')) ||
                   deps.find(ativo) || deps[0];
      if (!pick) { resumo.erros.push('nenhum depósito encontrado'); return res.status(502).json(resumo); }
      depositoId = String(pick.id);
      depositoNome = pick.descricao || '';
    }
    resumo.deposito = depositoId;
    resumo.deposito_nome = depositoNome;

    // ── 2. Paginar /produtos → skuMap ────────────────────────────────────
    const skuMap = new Map(); // sku -> { ref, cor, tam, idProduto }
    for (let pagina = 1; pagina <= MAX_PAGES; pagina++) {
      if (Date.now() - t0 > SAFETY_MS) { resumo.erros.push(`safety timeout pag ${pagina}`); break; }
      const r = await blingFetch(`${API}/produtos?pagina=${pagina}&limite=${PAGE_SIZE}`, headers);
      if (!r.ok) {
        const eb = await r.text().catch(() => '');
        resumo.erros.push(`produtos pag ${pagina} HTTP ${r.status}: ${eb.slice(0, 160)}`);
        if (r.status === 401 || r.status === 403) break;
        continue;
      }
      const j = await r.json().catch(() => ({}));
      const produtos = j.data || [];
      resumo.paginas++;
      if (!produtos.length) break;
      for (const p of produtos) {
        resumo.produtos_lidos++;
        const sku = (p.codigo || '').trim();
        if (!sku) { resumo.sem_sku++; continue; }
        const parsed = parseDescricao(p.nome || '');
        const ref = normRef(parsed.ref);
        if (!ref) { resumo.sem_ref++; continue; }
        skuMap.set(sku, { ref, cor: parsed.cor || '', tam: (parsed.tamanho || '').toUpperCase(), idProduto: p.id || null });
      }
      if (produtos.length < PAGE_SIZE) break;
      await sleep(120);
    }

    // ── 3. Saldos por lote → mapeia pra ref|cor|tam ──────────────────────
    const idsArr = [...skuMap.values()].map(v => v.idProduto).filter(Boolean);
    const idToInfo = new Map(); // idProduto -> {sku, ...info}
    for (const [sku, info] of skuMap.entries()) if (info.idProduto) idToInfo.set(String(info.idProduto), { sku, ...info });

    const linhas = new Map(); // "ref|cor_norm|tam" -> { ref, cor_norm, tam, cor_label, qtd, bling_sku, bling_produto_id }
    for (let i = 0; i < idsArr.length; i += SALDO_LOTE) {
      if (Date.now() - t0 > SAFETY_MS) { resumo.erros.push('safety timeout saldos'); break; }
      const lote = idsArr.slice(i, i + SALDO_LOTE);
      const qs = lote.map(id => `idsProdutos[]=${id}`).join('&');
      const r = await blingFetch(`${API}/estoques/saldos?${qs}`, headers);
      if (!r.ok) {
        const eb = await r.text().catch(() => '');
        resumo.erros.push(`saldos lote ${i} HTTP ${r.status}: ${eb.slice(0, 160)}`);
        if (r.status === 401 || r.status === 403) break;
        continue;
      }
      const j = await r.json().catch(() => ({}));
      const saldos = j.data || [];
      if (dryRun && !resumo.saldo_cru && saldos.length) resumo.saldo_cru = saldos[0];
      for (const s of saldos) {
        const pid = String(s.produto?.id ?? s.id ?? '');
        const info = idToInfo.get(pid);
        if (!info) continue;
        // saldo do depósito geral (senão, total físico)
        let saldo = null;
        const deps = s.depositos || [];
        const dep = deps.find(d => String(d.id ?? d.deposito?.id) === String(depositoId));
        if (dep) saldo = dep.saldoFisico ?? dep.saldo ?? dep.deposito?.saldoFisico ?? null;
        if (saldo == null) saldo = s.saldoFisicoTotal ?? s.estoqueAtual ?? null;
        if (saldo == null) continue;
        const qtd = Math.max(0, Math.round(Number(saldo) || 0));
        resumo.com_saldo++;
        const cor_norm = normCor(info.cor);
        const key = `${info.ref}|${cor_norm}|${info.tam}`;
        const ex = linhas.get(key);
        if (ex) { ex.qtd += qtd; }
        else linhas.set(key, { ref: info.ref, cor_norm, tam: info.tam, cor_label: info.cor || null, qtd, bling_sku: info.sku, bling_produto_id: info.idProduto });
      }
      await sleep(180);
    }

    resumo.linhas = linhas.size;
    resumo.amostra = [...linhas.values()].slice(0, 12);

    // ── 4. UPSERT ────────────────────────────────────────────────────────
    if (!dryRun && linhas.size) {
      const rows = [...linhas.values()].map(l => ({ ...l, atualizado_em: new Date().toISOString(), atualizado_por: 'bling_sync' }));
      for (let j = 0; j < rows.length; j += 500) {
        const { error } = await supabase.from('bling_estoque').upsert(rows.slice(j, j + 500), { onConflict: 'ref,cor_norm,tam' });
        if (error) resumo.erros.push(`upsert ${j}: ${error.message}`);
        else resumo.upserted += Math.min(500, rows.length - j);
      }
    }

    resumo.ms = Date.now() - t0;
    return res.status(200).json(resumo);
  } catch (e) {
    resumo.erros.push(e.message || String(e));
    resumo.ms = Date.now() - t0;
    return res.status(500).json(resumo);
  }
}
