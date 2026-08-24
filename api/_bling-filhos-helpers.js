/**
 * _bling-filhos-helpers.js — zera o depósito Geral de Lumia/Muniam pra um SKU.
 *
 * Arquitetura (Ailson 07-08/07/2026): Multiempresa = SOMA dos 3 Gerais
 * (Exitus + Lumia + Muniam). O site da Meluni (Convertr) lê o Geral da EXITUS,
 * então toda escrita de estoque precisa CONSOLIDAR: zerar os filhos e gravar o
 * vendável no Geral Exitus. Usado por: bling-estoque-acrescentar-corte (botão
 * inserir corte) e bling-estoque-consolidar-cron (5h BRT). O endpoint
 * bling-estoque-zerar-filhos (botão do modal) tem a própria cópia dessa lógica.
 *
 * zerarFilhosSku(sku, cfg) → { resultados:[{conta,antes,ok,erro}], cfgMudou }
 * - cfg é o payload de amicia_data user_id='bling-estoque-config' (cache dos
 *   ids de depósito Geral por conta). Se cfgMudou, o CALLER salva o cfg.
 * - Filho com saldo 0 não gera balanço (economiza chamada).
 * - Tokens dos filhos são cacheados no módulo entre chamadas do mesmo run.
 */
import { refreshBlingToken, blingFetch } from './_bling-helpers.js';

const API = 'https://api.bling.com.br/Api/v3';
const CONTAS_FILHAS = ['lumia', 'muniam'];
const tokenCache = {}; // conta -> token (vive só durante a invocação)

async function tokenConta(conta) {
  if (!tokenCache[conta]) tokenCache[conta] = await refreshBlingToken(conta);
  return tokenCache[conta];
}

export async function saldoDeposito(headers, produtoId, depositoId) {
  const r = await blingFetch(`${API}/estoques/saldos?idsProdutos[]=${produtoId}`, headers);
  const j = await r.json().catch(() => ({}));
  const s = (j.data || []).find(x => String(x.produto?.id ?? x.id ?? '') === String(produtoId)) || (j.data || [])[0];
  if (!s) return null;
  const dep = (s.depositos || []).find(d => String(d.id ?? d.deposito?.id) === String(depositoId));
  if (dep) return dep.saldoFisico ?? dep.saldo ?? dep.deposito?.saldoFisico ?? null;
  return null;
}

export async function zerarFilhosSku(sku, cfg) {
  const resultados = [];
  let cfgMudou = false;
  for (const conta of CONTAS_FILHAS) {
    const resultado = { conta, antes: null, ok: false, erro: null };
    try {
      const token = await tokenConta(conta);
      const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' };

      const rp = await blingFetch(`${API}/produtos?codigo=${encodeURIComponent(sku)}`, headers);
      const jp = await rp.json().catch(() => ({}));
      if (!rp.ok) throw new Error(`produtos HTTP ${rp.status}`);
      const produtoId = jp.data?.[0]?.id || null;
      if (!produtoId) { resultado.erro = 'SKU não existe nessa conta'; resultados.push(resultado); continue; }

      let depId = cfg[`deposito_geral_${conta}`] || null;
      if (!depId) {
        const rd = await blingFetch(`${API}/depositos?pagina=1&limite=100`, headers);
        const jd = await rd.json().catch(() => ({}));
        if (!rd.ok) throw new Error(`depositos HTTP ${rd.status}`);
        const deps = jd.data || [];
        const pick = deps.find(d => /geral/i.test(d.descricao || '')) || deps.find(d => d.padrao === true);
        depId = pick ? String(pick.id) : null;
        if (depId) { cfg[`deposito_geral_${conta}`] = depId; cfgMudou = true; }
      }
      if (!depId) { resultado.erro = 'depósito Geral não encontrado'; resultados.push(resultado); continue; }

      const antes = await saldoDeposito(headers, produtoId, depId);
      resultado.antes = antes;
      if (antes === 0 || antes == null) { resultado.ok = true; resultados.push(resultado); continue; }

      // 24/08 (caso Cris/corte 9877): 429 no meio do lote derrubava a variação
      // em silêncio — agora o balanço re-tenta com espera (1s/2s/4s)
      let rz = null;
      for (let tent = 0; tent < 4; tent++) {
        rz = await fetch(`${API}/estoques`, {
          method: 'POST', headers,
          body: JSON.stringify({ produto: { id: Number(produtoId) }, deposito: { id: Number(depId) }, operacao: 'B', quantidade: 0 }),
        });
        if (rz.status !== 429) break;
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, tent)));
      }
      if (!rz.ok) throw new Error(`balanço HTTP ${rz.status}`);
      resultado.ok = true;
    } catch (e) {
      resultado.erro = e.message || String(e);
    }
    resultados.push(resultado);
  }
  return { resultados, cfgMudou };
}
