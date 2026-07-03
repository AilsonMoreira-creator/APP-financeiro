/**
 * bling-gtin-scan-lumia.js — Varre o catálogo do Bling (default: LUMIA) e acha
 * quais produtos JÁ têm gtin (código de barras antigo) preenchido, agrupando por
 * REF. A listagem /produtos NÃO traz gtin, então precisa buscar o DETALHE de
 * cada produto — por isso é retomável e grava progresso em meluni_config.
 *
 * SÓ LEITURA. Não escreve nada no Bling. Só grava o progresso no banco.
 *
 * Uso (rodar em rodadas até done=true):
 *   GET /api/bling-gtin-scan-lumia?reset=1   -> zera e começa do início
 *   GET /api/bling-gtin-scan-lumia           -> continua de onde parou
 *   &conta=lumia|exitus|muniam (default lumia)
 *
 * Progresso/resultado ficam em meluni_config.chave='gtin_scan_lumia'.
 * Sessão Ailson 03/07/2026 — registrar refs com código antigo antes de sobrescrever.
 */
import { refreshBlingToken, blingFetch, supabase } from './_bling-helpers.js';

export const config = { maxDuration: 300 };
const API = 'https://api.bling.com.br/Api/v3';
const CHAVE = 'gtin_scan_lumia';
const PAGE = 100;
const PACE = 360; // ms entre chamadas (limite Bling ~3 req/s)

function extraiRef(nome) {
  const m = String(nome || '').match(/\(ref\s*0*(\d+)\)/i);
  return m ? m[1] : null;
}
function resumo(e) {
  const refs = Object.entries(e.refs || {})
    .map(([ref, v]) => ({ ref, ...v }))
    .sort((a, b) => (Number(a.ref) || 0) - (Number(b.ref) || 0));
  return {
    done: !!e.done,
    conta: e.conta,
    pagina_atual: e.pagina,
    produtos_lidos: e.total_lidos,
    com_gtin: e.com_gtin,
    qtd_refs: refs.length,
    refs,
  };
}
async function salvar(estado) {
  await supabase.from('meluni_config').upsert(
    { chave: CHAVE, valor: estado, atualizado_em: new Date().toISOString() },
    { onConflict: 'chave' }
  );
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
      estado = { conta, pagina: 1, total_lidos: 0, com_gtin: 0, refs: {}, done: false, iniciado_em: new Date().toISOString() };
    }
    if (estado.done) return res.status(200).json({ ok: true, ja_concluido: true, ...resumo(estado) });

    const token = await refreshBlingToken(conta);
    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
    const t0 = Date.now();
    let last = 0;
    const pace = async () => { const w = PACE - (Date.now() - last); if (w > 0) await new Promise(s => setTimeout(s, w)); last = Date.now(); };

    while (true) {
      // margem: precisa caber ~1 página inteira (100 detalhes ~ 40s) antes de começar
      if (Date.now() - t0 > tetoMs - 42000) break;

      await pace();
      const rl = await blingFetch(`${API}/produtos?pagina=${estado.pagina}&limite=${PAGE}`, headers);
      if (!rl.ok) break;
      const jl = await rl.json().catch(() => ({}));
      const prods = jl.data || [];
      if (!prods.length) { estado.done = true; break; }

      for (const p of prods) {
        // pula o produto-mãe de variação (formato 'V'): gtin fica nas filhas/simples
        if (String(p.formato || '').toUpperCase() === 'V') continue;
        await pace();
        let det = null;
        try {
          const rd = await blingFetch(`${API}/produtos/${p.id}`, headers);
          const jd = await rd.json().catch(() => ({}));
          det = jd.data || null;
        } catch { /* conta como sem gtin */ }
        estado.total_lidos++;
        const g = String(det?.gtin || '').trim();
        if (g) {
          estado.com_gtin++;
          const ref = extraiRef(det?.nome || p.nome) || '?';
          if (!estado.refs[ref]) estado.refs[ref] = { qtd: 0, ex_gtin: g, ex_nome: String(det?.nome || p.nome || '').slice(0, 80), ex_sku: det?.codigo || p.codigo || null };
          estado.refs[ref].qtd++;
          // guarda até 4 exemplos de gtin distintos por ref (pra ver o formato)
          estado.refs[ref].gtins = estado.refs[ref].gtins || [];
          if (estado.refs[ref].gtins.length < 4 && !estado.refs[ref].gtins.includes(g)) estado.refs[ref].gtins.push(g);
        }
      }
      estado.pagina++;
      await salvar(estado); // checkpoint por página
    }

    await salvar(estado);
    return res.status(200).json({ ok: true, ...resumo(estado), _ms: Date.now() - t0 });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
}
