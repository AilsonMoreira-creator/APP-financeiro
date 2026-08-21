// /api/calc-meli-precos — confere o preço "Mercado Livre" dos cards da
// CALCULADORA contra o MENOR PREÇO DE TABELA dos anúncios ativos do ML
// EXITUS (a conta base). Regra do Ailson (21/08):
//   - promoção NÃO conta: tabela = original_price (quando em promo) ?? price
//   - menor tabela entre os anúncios ativos da ref
//   - diferença <= 1% não corrige
// Modos: ?debug=1 (amostra pra validar o casamento por ref) ·
//        GET (prévia) · ?executar=1 (aplica no payload calc-meluni).
import { getValidToken, supabase } from './_ml-helpers.js';
import { refreshBlingToken, blingFetch } from './_bling-helpers.js';

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

    // ── casamento REF → anúncios MLB via BLING (caminho validado na
    // auditoria de SKUs): produto PAI tem "(ref.X)" no nome; o vínculo
    // produto-loja do canal ML traz o codigo MLB do anúncio ──
    const tokenB = await refreshBlingToken('exitus');
    const hb = { Authorization: `Bearer ${tokenB}`, Accept: 'application/json' };

    // canal Mercado Livre Exitus (FULL fica de fora — frente separada)
    const rc = await blingFetch('https://api.bling.com.br/Api/v3/canais-venda?limite=100', hb);
    const canais = (await rc.json().catch(() => ({})))?.data || [];
    const canalMl = canais.find(c => /mercado\s*livre/i.test(c.descricao || '') && !/full/i.test(c.descricao || ''));
    if (!canalMl) return res.status(500).json({ erro: 'canal mercado livre exitus nao encontrado', canais: canais.map(c => c.descricao) });

    // produtos PAI (nome traz "(ref.X)") → mapa idPai → ref
    const refPorPai = {};
    for (let pg = 1; pg <= 40; pg++) {
      const r = await blingFetch(`https://api.bling.com.br/Api/v3/produtos?tipo=P&formato=V&limite=100&pagina=${pg}`, hb);
      const lista = (await r.json().catch(() => ({})))?.data || [];
      for (const p of lista) {
        const m = String(p.nome || '').match(/ref[.\s]*0*(\d{3,5})/i);
        if (m) refPorPai[String(p.id)] = m[1];
      }
      if (lista.length < 100) break;
      await espera(360);
    }

    // vínculos do canal ML → codigo MLB dos PAIS
    const mlbPorRef = {};
    const mlbSet = new Set();
    for (let pg = 1; pg <= 80; pg++) {
      const r = await blingFetch(`https://api.bling.com.br/Api/v3/produtos/lojas?idLoja=${canalMl.id}&limite=100&pagina=${pg}`, hb);
      const lista = (await r.json().catch(() => ({})))?.data || [];
      for (const v of lista) {
        const cod = String(v.codigo || '');
        if (!/^MLB/i.test(cod)) continue;
        const ref = refPorPai[String(v.produto?.id)];
        if (!ref) continue;
        (mlbPorRef[ref] = mlbPorRef[ref] || []).push(cod);
        mlbSet.add(cod);
      }
      if (lista.length < 100) break;
      await espera(360);
    }

    // preço REAL dos anúncios na API do ML (multiget)
    const itemDe = {};
    const mlbs = [...mlbSet];
    for (let i = 0; i < mlbs.length; i += 20) {
      const lote = mlbs.slice(i, i + 20);
      const j = await (await fetch(`https://api.mercadolibre.com/items?ids=${lote.join(',')}&attributes=id,title,price,original_price,status`, { headers: h })).json();
      (Array.isArray(j) ? j : []).forEach(x => { if (x?.code === 200 && x.body) itemDe[x.body.id] = x.body; });
      await espera(120);
    }

    if (q.debug === '1') {
      const amostraRefs = Object.entries(mlbPorRef).slice(0, 8).map(([r2, ids2]) => ({
        ref: r2, anuncios: ids2.map(id2 => ({ id: id2, status: itemDe[id2]?.status, price: itemDe[id2]?.price, original_price: itemDe[id2]?.original_price })),
      }));
      return res.status(200).json({
        canal_ml: canalMl.descricao, pais_com_ref: Object.keys(refPorPai).length,
        refs_com_anuncio: Object.keys(mlbPorRef).length, mlbs: mlbs.length, amostra: amostraRefs,
      });
    }
    // ── menor TABELA por ref ──
    const menorPorRef = {};
    const anunciosPorRef = {};
    for (const [r, ids2] of Object.entries(mlbPorRef)) {
      const rn2 = normRef(r);
      for (const id2 of ids2) {
        const it = itemDe[id2];
        if (!it || it.status !== 'active') continue;
        const tabela = Number(it.original_price ?? it.price);
        if (!Number.isFinite(tabela) || tabela <= 0) continue;
        (anunciosPorRef[rn2] = anunciosPorRef[rn2] || []).push({ id: id2, tabela, price: it.price });
        if (!(rn2 in menorPorRef) || tabela < menorPorRef[rn2]) menorPorRef[rn2] = tabela;
      }
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
