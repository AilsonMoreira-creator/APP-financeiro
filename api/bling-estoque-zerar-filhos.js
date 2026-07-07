/**
 * bling-estoque-zerar-filhos.js — Zera o depósito GERAL do Bling Lumia e Muniam
 * pra UM SKU (balanço 0). Usado antes da recontagem física.
 *
 * Contexto (regra de estoque marketplaces): Exitus é o principal (Geral =
 * verdade física, Multiempresas = espelho compartilhado que Lumia/Muniam
 * consomem). Vendas nos canais Lumia/Muniam abatem do Geral da PRÓPRIA conta
 * (que vive em 0), acumulando negativos. Esses negativos abatem do saldo que
 * os canais enxergam — então antes de gravar o valor contado no Geral do
 * Exitus, é obrigatório zerar o Geral dos filhos.
 *
 * POST body: { ref, cor_norm, tam, usuario? }
 * Fluxo por conta (lumia, muniam):
 *   1. token da conta (bling_tokens)
 *   2. produto: GET /produtos?codigo={sku}  ← o bling_produto_id do espelho é
 *      do EXITUS; em cada conta filha o mesmo SKU tem OUTRO id
 *   3. depósito Geral da conta: cache em amicia_data 'bling-estoque-config'
 *      (chave deposito_geral_{conta}); senão GET /depositos (padrao ou /geral/i)
 *   4. saldo atual (antes): GET /estoques/saldos?idsProdutos[]={id}
 *   5. antes !== 0 → POST /estoques operacao 'B' quantidade 0
 * Depois: relê o saldo do Geral do EXITUS e espelha em bling_estoque.qtd
 * (é o valor que o modal/card mostram). Log em bling_estoque_logs.
 *
 * OBS: escopo de escrita de estoque nas contas lumia/muniam pode não estar
 * liberado ainda — nesse caso o Bling devolve 401/403 e o resultado da conta
 * vem com erro legível, sem travar a outra.
 */
import { refreshBlingToken, blingFetch, supabase } from './_bling-helpers.js';

export const config = { maxDuration: 60 };
const API = 'https://api.bling.com.br/Api/v3';
const CONTAS_FILHAS = ['lumia', 'muniam'];

async function saldoDeposito(headers, produtoId, depositoId) {
  const r = await blingFetch(`${API}/estoques/saldos?idsProdutos[]=${produtoId}`, headers);
  const j = await r.json().catch(() => ({}));
  const s = (j.data || []).find(x => String(x.produto?.id ?? x.id ?? '') === String(produtoId)) || (j.data || [])[0];
  if (!s) return null;
  const dep = (s.depositos || []).find(d => String(d.id ?? d.deposito?.id) === String(depositoId));
  if (dep) return dep.saldoFisico ?? dep.saldo ?? dep.deposito?.saldoFisico ?? null;
  return null;
}

export default async function handler(req, res) {
  // GET ?ref=&cor_norm=&tam= = DRY-RUN de diagnóstico (Ailson 07/07/2026):
  // roda o mesmo caminho (token, produto, depósito, saldo) sem gravar balanço.
  const dryRun = req.method === 'GET';
  if (req.method !== 'POST' && !dryRun) return res.status(405).json({ error: 'use POST (ou GET pra dry-run)' });
  let body = dryRun ? (req.query || {}) : req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const ref = String(body.ref || '').replace(/\D/g, '').replace(/^0+/, '');
  const cor_norm = String(body.cor_norm || '');
  const tam = String(body.tam || '').toUpperCase().trim();
  if (!ref || !cor_norm || !tam) return res.status(400).json({ error: 'ref, cor_norm, tam obrigatórios' });

  try {
    // ── sku da variação (chave nas 3 contas é o mesmo codigo) ──
    const { data: lin } = await supabase.from('bling_estoque')
      .select('bling_sku, bling_produto_id, qtd, cor_label').eq('ref', ref).eq('cor_norm', cor_norm).eq('tam', tam).maybeSingle();
    const sku = lin?.bling_sku || null;
    if (!sku) return res.status(404).json({ error: 'SKU não mapeado em bling_estoque (rode a leitura primeiro)' });

    // ── cache de depósitos dos filhos ──
    const { data: cfgRow } = await supabase.from('amicia_data').select('payload').eq('user_id', 'bling-estoque-config').maybeSingle();
    const cfg = cfgRow?.payload || {};
    let cfgMudou = false;

    const resultados = [];
    for (const conta of CONTAS_FILHAS) {
      const resultado = { conta, sku, antes: null, depois: null, ok: false, erro: null };
      try {
        const token = await refreshBlingToken(conta);
        const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' };

        // produto NESSA conta (id difere do Exitus)
        const rp = await blingFetch(`${API}/produtos?codigo=${encodeURIComponent(sku)}`, headers);
        const jp = await rp.json().catch(() => ({}));
        if (!rp.ok) throw new Error(`produtos HTTP ${rp.status}${rp.status === 401 || rp.status === 403 ? ' (escopo não liberado nessa conta?)' : ''}`);
        const produtoId = jp.data?.[0]?.id || null;
        if (!produtoId) { resultado.erro = 'SKU não existe nessa conta'; resultados.push(resultado); continue; }
        resultado.produtoId = produtoId;

        // depósito Geral DESSA conta (cache -> detecta)
        let depId = cfg[`deposito_geral_${conta}`] || null;
        if (!depId) {
          const rd = await blingFetch(`${API}/depositos?pagina=1&limite=100`, headers);
          const jd = await rd.json().catch(() => ({}));
          if (!rd.ok) throw new Error(rd.status === 401 || rd.status === 403 ? 'sem permissão de estoque nessa conta — reautorizar a conta no módulo Bling' : `depositos HTTP ${rd.status}`);
          const deps = jd.data || [];
          const pick = deps.find(d => /geral/i.test(d.descricao || '')) || deps.find(d => d.padrao === true);
          depId = pick ? String(pick.id) : null;
          if (depId) { cfg[`deposito_geral_${conta}`] = depId; cfgMudou = true; }
        }
        if (!depId) { resultado.erro = 'depósito Geral não encontrado nessa conta'; resultados.push(resultado); continue; }
        resultado.depositoId = depId;

        // saldo atual
        const antes = await saldoDeposito(headers, produtoId, depId);
        resultado.antes = antes;

        if (antes === 0) { resultado.depois = 0; resultado.ok = true; resultados.push(resultado); continue; }

        if (dryRun) { resultado.dry_run = true; resultado.ok = true; resultados.push(resultado); continue; }

        // balanço 0
        const rz = await fetch(`${API}/estoques`, {
          method: 'POST', headers,
          body: JSON.stringify({ produto: { id: Number(produtoId) }, deposito: { id: Number(depId) }, operacao: 'B', quantidade: 0 }),
        });
        if (!rz.ok) {
          const tz = await rz.text();
          throw new Error(`balanço HTTP ${rz.status}${rz.status === 401 || rz.status === 403 ? ' (escopo de escrita não liberado nessa conta?)' : ''}: ${tz.slice(0, 140)}`);
        }
        resultado.depois = 0;
        resultado.ok = true;
      } catch (e) {
        resultado.erro = e.message || String(e);
      }
      resultados.push(resultado);
    }

    if (cfgMudou) {
      await supabase.from('amicia_data').upsert(
        { user_id: 'bling-estoque-config', payload: cfg, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      );
    }

    // ── relê o saldo do Geral do EXITUS e espelha (é o que o card mostra) ──
    // Arquitetura (Ailson 07/07/2026): o Multiempresas é COMPARTILHADO entre os
    // 3 CNPJs e o Geral da Exitus espelha ele. Zerar o negativo do filho devolve
    // saldo ao Multiempresas -> o Geral da Exitus SOBE. A propagação entre
    // contas leva alguns segundos, então espera antes de reler.
    let novo_saldo_exitus = null;
    const zerouAlgum = resultados.some(r => r.ok && r.antes !== 0 && !r.dry_run);
    if (zerouAlgum) await new Promise(r2 => setTimeout(r2, 3000));
    try {
      const tokenEx = await refreshBlingToken('exitus');
      const headersEx = { Authorization: `Bearer ${tokenEx}`, Accept: 'application/json', 'Content-Type': 'application/json' };
      let produtoIdEx = lin?.bling_produto_id || null;
      if (!produtoIdEx) {
        const rpe = await blingFetch(`${API}/produtos?codigo=${encodeURIComponent(sku)}`, headersEx);
        const jpe = await rpe.json().catch(() => ({}));
        produtoIdEx = jpe.data?.[0]?.id || null;
      }
      const depEx = cfg.deposito_geral || null;
      if (produtoIdEx && depEx) {
        const s = await saldoDeposito(headersEx, produtoIdEx, depEx);
        if (s != null) {
          novo_saldo_exitus = Math.max(0, Math.round(Number(s) || 0));
          if (novo_saldo_exitus !== lin?.qtd) {
            await supabase.from('bling_estoque')
              .update({ qtd: novo_saldo_exitus, atualizado_em: new Date().toISOString(), atualizado_por: body.usuario || null })
              .eq('ref', ref).eq('cor_norm', cor_norm).eq('tam', tam);
          }
        }
      }
    } catch { /* leitura do exitus falhou: card segue com o valor do espelho */ }

    // log (auditoria — 1 linha resumindo a limpeza)
    const zerados = resultados.filter(r => r.ok && r.antes !== 0);
    if (zerados.length && !dryRun) {
      await supabase.from('bling_estoque_logs').insert({
        ref, cor_norm, tam,
        cor_label: lin?.cor_label || null,
        qtd_anterior: lin?.qtd ?? null,
        qtd_nova: novo_saldo_exitus ?? lin?.qtd ?? null,
        delta: null,
        motivo: 'zerar Geral filhos: ' + zerados.map(r => `${r.conta} ${r.antes}→0`).join(', '),
        usuario: body.usuario || null,
        origem: 'zerar_filhos',
      });
    }

    return res.status(200).json({ ok: resultados.every(r => r.ok), dry_run: dryRun || undefined, resultados, novo_saldo_exitus });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
}
