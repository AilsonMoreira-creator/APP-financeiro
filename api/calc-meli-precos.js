// /api/calc-meli-precos — confere o preço "Mercado Livre" dos cards da
// CALCULADORA contra o MENOR PREÇO DE TABELA dos anúncios ativos do ML
// EXITUS (a conta base). Regra do Ailson (21/08):
//   - promoção NÃO conta: tabela = original_price (quando em promo) ?? price
//   - menor tabela entre os anúncios ativos da ref
//   - diferença <= 1% não corrige
// Modos: ?debug=1 (amostra pra validar o casamento por ref) ·
//        GET (prévia) · ?executar=1 (aplica no payload calc-meluni).
import { getValidToken, supabase } from './_ml-helpers.js';

export const config = { maxDuration: 300 };
const espera = (ms) => new Promise(r => setTimeout(r, ms));
const normRef = (r) => String(r || '').trim().replace(/^0+/, '') || '0';

export default async function handler(req, res) {
  const q = req.query || {};
  try {
    const token = await getValidToken('Exitus');
    const h = { Authorization: `Bearer ${token}` };
    const me = await (await fetch('https://api.mercadolibre.com/users/me', { headers: h })).json();
    if (!me?.id) return res.status(500).json({ erro: 'token exitus sem users/me' });

    // ── todos os anúncios ativos da Exitus (scan) ──
    const ids = [];
    let scroll = null;
    for (let voltas = 0; voltas < 40; voltas++) {
      const u = `https://api.mercadolibre.com/users/${me.id}/items/search?status=active&search_type=scan&limit=100${scroll ? `&scroll_id=${encodeURIComponent(scroll)}` : ''}`;
      const j = await (await fetch(u, { headers: h })).json();
      (j?.results || []).forEach(i => ids.push(i));
      scroll = j?.scroll_id || null;
      if (!j?.results?.length) break;
      await espera(120);
    }

    // ── detalhes em multiget (título + preços) ──
    const itens = [];
    for (let i = 0; i < ids.length; i += 20) {
      const lote = ids.slice(i, i + 20);
      const j = await (await fetch(`https://api.mercadolibre.com/items?ids=${lote.join(',')}&attributes=id,title,price,original_price,status`, { headers: h })).json();
      (Array.isArray(j) ? j : []).forEach(x => { if (x?.code === 200 && x.body) itens.push(x.body); });
      await espera(120);
    }

    // casamento por REF no título: "(ref.2782)" ou "ref 2782" etc
    const refDoTitulo = (t) => {
      const m = String(t || '').match(/ref[.\s]*0*(\d{3,5})/i);
      return m ? m[1] : null;
    };

    if (q.debug === '1') {
      return res.status(200).json({
        total_ativos: ids.length,
        amostra: itens.slice(0, 12).map(i => ({ id: i.id, title: i.title, ref_casada: refDoTitulo(i.title), price: i.price, original_price: i.original_price })),
        sem_ref_no_titulo: itens.filter(i => !refDoTitulo(i.title)).length,
      });
    }

    // ── menor TABELA por ref ──
    const menorPorRef = {};
    const anunciosPorRef = {};
    for (const it of itens) {
      const r = refDoTitulo(it.title);
      if (!r || it.status !== 'active') continue;
      const tabela = Number(it.original_price ?? it.price);
      if (!Number.isFinite(tabela) || tabela <= 0) continue;
      (anunciosPorRef[r] = anunciosPorRef[r] || []).push({ id: it.id, tabela, price: it.price });
      if (!(r in menorPorRef) || tabela < menorPorRef[r]) menorPorRef[r] = tabela;
    }

    // ── cards da calculadora (prs "<ref>|mercadolivre") ──
    const { data: cfg } = await supabase.from('amicia_data').select('payload').eq('user_id', 'calc-meluni').maybeSingle();
    const prs = cfg?.payload?.prs || {};
    const cards = {};   // refNorm -> { chaves:[], valor }
    for (const [k, v] of Object.entries(prs)) {
      const m = k.match(/^(.+)\|mercadolivre$/);
      if (!m) continue;
      const rn = normRef(m[1]);
      cards[rn] = cards[rn] || { chaves: [], valor: null };
      cards[rn].chaves.push(k);
      const num = Number(v);
      if (Number.isFinite(num) && num > 0) cards[rn].valor = num;   // última ganha; duplicadas têm o mesmo valor na prática
    }

    const plano = [];
    for (const [rn, card] of Object.entries(cards)) {
      const menor = menorPorRef[rn] ?? null;
      if (menor == null) { plano.push({ ref: rn, card: card.valor, ml_menor_tabela: null, acao: 'sem_anuncio_ativo' }); continue; }
      if (card.valor == null) { plano.push({ ref: rn, card: null, ml_menor_tabela: menor, acao: 'preencher', novo: menor }); continue; }
      const diffPct = Math.abs(menor - card.valor) / card.valor * 100;
      plano.push({
        ref: rn, card: card.valor, ml_menor_tabela: menor,
        diff_pct: Math.round(diffPct * 100) / 100,
        anuncios: (anunciosPorRef[rn] || []).length,
        acao: diffPct > 1 ? 'corrigir' : 'ok',
        ...(diffPct > 1 ? { novo: menor } : {}),
      });
    }
    plano.sort((a, b) => (b.diff_pct || 0) - (a.diff_pct || 0));
    const corrigir = plano.filter(p => p.acao === 'corrigir' || p.acao === 'preencher');

    if (q.executar !== '1') {
      return res.status(200).json({
        previa: true, anuncios_ativos: ids.length, refs_no_card: Object.keys(cards).length,
        a_corrigir: corrigir.length, ok: plano.filter(p => p.acao === 'ok').length,
        sem_anuncio: plano.filter(p => p.acao === 'sem_anuncio_ativo').length, plano,
      });
    }

    // ── aplica no payload (todas as chaves da ref, com e sem zero) ──
    const novoPrs = { ...prs };
    for (const p of corrigir) {
      for (const k of cards[p.ref].chaves) novoPrs[k] = p.novo;
    }
    const payloadNovo = { ...(cfg?.payload || {}), prs: novoPrs };
    const { error } = await supabase.from('amicia_data').update({ payload: payloadNovo }).eq('user_id', 'calc-meluni');
    if (error) return res.status(500).json({ erro: 'falha ao gravar: ' + error.message, corrigir });

    return res.status(200).json({ ok: true, corrigidos: corrigir.length, detalhe: corrigir });
  } catch (e) {
    return res.status(500).json({ erro: String(e?.message || e) });
  }
}
