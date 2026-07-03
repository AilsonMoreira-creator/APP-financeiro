/**
 * bling-gtin-scan-lumia.js — Varre o catálogo do Bling (default: LUMIA) e acha
 * quais produtos JÁ têm gtin (código de barras antigo), agrupando por REF e
 * guardando um BACKUP item-a-item (sku -> gtin antigo) pra permitir reverter.
 *
 * A listagem /produtos NÃO traz gtin, então busca o DETALHE de cada produto.
 * Retomável: grava progresso em meluni_config a cada página.
 *
 * SÓ LEITURA no Bling. Uso (rodar em rodadas até done=true):
 *   GET /api/bling-gtin-scan-lumia?reset=1   -> zera e começa
 *   GET /api/bling-gtin-scan-lumia           -> continua
 *   &conta=lumia|exitus|muniam (default lumia)
 *
 * Resultado em meluni_config.chave='gtin_scan_lumia'
 * (valor.refs = agregado por ref; valor.itens = backup [{s:sku,r:ref,g:gtin}]).
 */
import { refreshBlingToken, blingFetch, supabase } from './_bling-helpers.js';

export const config = { maxDuration: 300 };
const API = 'https://api.bling.com.br/Api/v3';
const CHAVE = 'gtin_scan_lumia';
const PAGE = 100;
const PACE = 355;

// aceita "ref 02136", "ref. 02413", "ref: 2534", "ref-0395", "ref nº 2601"
function extraiRef(nome) {
  const m = String(nome || '').match(/ref[\s.:#nºN°-]*0*(\d{3,6})/i);
  return m ? m[1] : null;
}
function resumo(e) {
  const refs = Object.entries(e.refs || {})
    .map(([ref, v]) => ({ ref, ...v }))
    .sort((a, b) => (Number(a.ref) || 1e9) - (Number(b.ref) || 1e9));
  return { done: !!e.done, conta: e.conta, pagina_atual: e.pagina,
    produtos_lidos: e.total_lidos, com_gtin: e.com_gtin,
    qtd_refs: refs.length, itens_backup: (e.itens || []).length, refs };
}
async function salvar(estado) {
  await supabase.from('meluni_config').upsert(
    { chave: CHAVE, valor: estado, atualizado_em: new Date().toISOString() },
    { onConflict: 'chave' });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  const conta = (req.query.conta || 'lumia').toLowerCase();
  const reset = req.query.reset === '1';
  const tetoMs = Math.min(285000, Math.max(30000, parseInt(req.query.max_ms || '250000', 10)));

  try {
    let estado = null;
    if (!reset) {
      const { data } = await supabase.from('meluni_config').select('valor').eq('chave', CHAVE).maybeSingle();
      estado = data?.valor || null;
    }
    if (!estado || estado.conta !== conta) {
      estado = { conta, pagina: 1, total_lidos: 0, com_gtin: 0, refs: {}, itens: [], done: false, iniciado_em: new Date().toISOString() };
    }
    if (!estado.itens) estado.itens = [];
    if (estado.done) return res.status(200).json({ ok: true, ja_concluido: true, ...resumo(estado) });

    const token = await refreshBlingToken(conta);
    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
    const t0 = Date.now();
    let last = 0;
    const pace = async () => { const w = PACE - (Date.now() - last); if (w > 0) await new Promise(s => setTimeout(s, w)); last = Date.now(); };

    while (true) {
      if (Date.now() - t0 > tetoMs - 42000) break;
      await pace();
      const rl = await blingFetch(`${API}/produtos?pagina=${estado.pagina}&limite=${PAGE}`, headers);
      if (!rl.ok) break;
      const jl = await rl.json().catch(() => ({}));
      const prods = jl.data || [];
      if (!prods.length) { estado.done = true; break; }

      for (const p of prods) {
        if (String(p.formato || '').toUpperCase() === 'V') continue;
        await pace();
        let det = null;
        try { const rd = await blingFetch(`${API}/produtos/${p.id}`, headers); const jd = await rd.json().catch(() => ({})); det = jd.data || null; } catch { /* */ }
        estado.total_lidos++;
        const g = String(det?.gtin || '').trim();
        if (g) {
          estado.com_gtin++;
          const nome = String(det?.nome || p.nome || '');
          const ref = extraiRef(nome) || '?';
          const sku = det?.codigo || p.codigo || null;
          estado.itens.push({ s: sku, r: ref, g, n: nome.slice(0, 70) });
          if (!estado.refs[ref]) estado.refs[ref] = { qtd: 0, ex_gtin: g, ex_nome: nome.slice(0, 70), gtins: [] };
          estado.refs[ref].qtd++;
          if (estado.refs[ref].gtins.length < 4 && !estado.refs[ref].gtins.includes(g)) estado.refs[ref].gtins.push(g);
        }
      }
      estado.pagina++;
      await salvar(estado);
    }
    await salvar(estado);
    return res.status(200).json({ ok: true, ...resumo(estado), _ms: Date.now() - t0 });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
}
