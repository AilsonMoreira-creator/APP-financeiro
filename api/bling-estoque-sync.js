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
import { refreshBlingToken, blingFetch, parseDescricao, supabase, canonizarCor } from './_bling-helpers.js';

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

    // Guarda o depósito geral pra escrita/webhook reusarem sem redetectar.
    // Só o Exitus manda nesse config: o ajuste (bling-estoque-set) escreve SEMPRE
    // no Exitus. Sem o guard, o sync das filhas (lumia/muniam) sobrescrevia o
    // deposito_geral do Exitus e quebrava o ajuste. Ailson 08/07/2026.
    if (!dryRun && conta === 'exitus') {
      await supabase.from('amicia_data').upsert({ user_id: 'bling-estoque-config', payload: { conta, deposito_geral: depositoId, deposito_nome: depositoNome, atualizado_em: new Date().toISOString() } }, { onConflict: 'user_id' });
    }

    // Fallback de ref: SKU -> ref via ml_sku_ref_map (cobre produtos cujo nome
    // do Bling nao traz "(ref XXXX)" e cairiam em sem_ref).
    const skuRefMap = new Map();
    for (let off = 0; off < 60000; off += 1000) {
      const { data: mp } = await supabase.from('ml_sku_ref_map').select('sku,ref').range(off, off + 999);
      if (!mp || !mp.length) break;
      for (const m of mp) if (m.sku && m.ref) skuRefMap.set(m.sku, String(m.ref));
      if (mp.length < 1000) break;
    }
    resumo.sku_ref_map = skuRefMap.size;

    // Whitelist: só sincroniza refs cadastradas na CALCULADORA (calc-meluni),
    // pra não importar refs antigas e criar card. ?todas=1 ignora o filtro.
    const calcRefs = new Set();
    {
      const { data: cm } = await supabase.from('amicia_data').select('payload').eq('user_id', 'calc-meluni').maybeSingle();
      for (const p of (cm?.payload?.prods || [])) { const r = normRef(p.ref); if (r) calcRefs.add(r); }
    }
    resumo.calc_refs = calcRefs.size;
    const filtrarCalc = req.query.todas !== '1' && calcRefs.size > 0;
    resumo.filtro_calculadora = filtrarCalc;

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
        let ref = normRef(parsed.ref);
        // Cadastros novos vem como "(02807)" sem a palavra "ref" (Ailson 21/07/2026)
        if (!ref) { const m = (p.nome || '').match(/\((\d{3,5})\)/); if (m) ref = normRef(m[1]); }
        if (!ref) ref = normRef(skuRefMap.get(sku) || '');
        if (!ref) { resumo.sem_ref++; continue; }
        if (filtrarCalc && !calcRefs.has(ref)) { resumo.fora_calc = (resumo.fora_calc || 0) + 1; continue; }
        skuMap.set(sku, { ref, cor: parsed.cor || '', tam: (parsed.tamanho || '').toUpperCase(), idProduto: p.id || null, gtin: (p.gtin || '').trim(), titulo: p.nome || '' });
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
        // Exitus (fisico) clampa em 0; filhos (Lumia/Muniam) podem ser NEGATIVOS
        // (vendas acumuladas no Geral deles) e o negativo abate o vendavel. Ailson 07/07/2026.
        const qtd = conta === 'exitus' ? Math.max(0, Math.round(Number(saldo) || 0)) : Math.round(Number(saldo) || 0);
        resumo.com_saldo++;
        const corCanon = canonizarCor(info.cor);   // azul bebe->Azul Claro, offwhite->Branco (21/07/2026)
        const cor_norm = normCor(corCanon);
        const key = `${info.ref}|${cor_norm}|${info.tam}`;
        const ex = linhas.get(key);
        if (ex) { ex.qtd += qtd; }
        else linhas.set(key, { ref: info.ref, cor_norm, tam: info.tam, cor_label: corCanon || null, qtd, bling_sku: info.sku, bling_produto_id: info.idProduto, gtin: info.gtin || null, titulo: info.titulo || null });
      }
      await sleep(180);
    }

    resumo.linhas = linhas.size;
    resumo.amostra = [...linhas.values()].slice(0, 12);

    // ── 4. GRAVAÇÃO ──────────────────────────────────────────────────────
    // Exitus: upsert completo (catalogo mestre). Lumia/Muniam: RPC que só
    // ATUALIZA qtd_lumia/qtd_muniam em linhas existentes — não cria linha nem
    // toca qtd/bling_produto_id do exitus. Ailson 07/07/2026.
    if (!dryRun && linhas.size) {
      if (conta === 'exitus') {
        const rows = [...linhas.values()].map(l => ({ ...l, atualizado_em: new Date().toISOString(), atualizado_por: 'bling_sync' }));
        for (let j = 0; j < rows.length; j += 500) {
          const { error } = await supabase.from('bling_estoque').upsert(rows.slice(j, j + 500), { onConflict: 'ref,cor_norm,tam' });
          if (error) resumo.erros.push(`upsert ${j}: ${error.message}`);
          else resumo.upserted += Math.min(500, rows.length - j);
        }
      } else {
        const rows = [...linhas.values()].map(l => ({ ref: l.ref, cor_norm: l.cor_norm, tam: l.tam, qtd: l.qtd }));
        const { data: n, error } = await supabase.rpc('fn_bling_set_qtd_filho', { p_conta: conta, p_rows: rows });
        if (error) resumo.erros.push(`rpc filho: ${error.message}`);
        else resumo.upserted = n || 0;
      }
    }

    // Limpeza opcional (?limpar=1): remove refs que NÃO estão na calculadora.
    if (!dryRun && filtrarCalc && req.query.limpar === '1') {
      const keep = [...calcRefs];
      const { error: delErr, count } = await supabase.from('bling_estoque')
        .delete({ count: 'exact' })
        .not('ref', 'in', `(${keep.join(',')})`);
      if (delErr) resumo.erros.push(`limpeza: ${delErr.message}`);
      else resumo.removidas_fora_calc = count || 0;
    }

    resumo.ms = Date.now() - t0;
    return res.status(200).json(resumo);
  } catch (e) {
    resumo.erros.push(e.message || String(e));
    resumo.ms = Date.now() - t0;
    return res.status(500).json(resumo);
  }
}
