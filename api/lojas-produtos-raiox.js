// ═══════════════════════════════════════════════════════════════════════════
// /api/lojas-produtos-raiox
// ═══════════════════════════════════════════════════════════════════════════
// GET: retorna os 4 paineis do raio-x de produtos (admin only).
//
// Query params:
//   loja = todas | BR | ST   (default: todas)
//
// Resposta:
//   {
//     top_vendidas: [{ ref, posicao, pecas, clientes_distintos, pedidos_distintos,
//                       descricao, categoria, qtd_estoque }],
//     primeira_compra: {
//       geral: [{ ref, clientes, pecas, descricao, categoria, qtd_estoque }],
//       vesti: [...]
//     },
//     recompra: [{ ref, ocorrencias, clientes_distintos, descricao, categoria, qtd_estoque }],
//     matches: { ref_top: [{ ref_match, coocorrencias, total_compras, pct,
//                              descricao, categoria }] },
//     ultima_atualizacao_matches: timestamptz,
//     loja: 'todas' | 'BR' | 'ST',
//   }
//
// Sprint Ailson 05/05/2026.
// ═══════════════════════════════════════════════════════════════════════════
import { supabase, validarUsuario, setCors } from './_lojas-helpers.js';

const LOJA_BR = 'Bom Retiro';
const LOJA_ST = 'Silva Teles';

function aplicarFiltroLoja(query, lojaFiltro) {
  if (lojaFiltro === 'BR') return query.eq('loja', LOJA_BR);
  if (lojaFiltro === 'ST') return query.eq('loja', LOJA_ST);
  return query; // todas
}

// Agrega linhas com (ref, loja) por ref, somando metricas
function agregarPorRef(rows, metricasNumericas) {
  const map = new Map();
  for (const r of rows) {
    const ref = r.ref;
    if (!map.has(ref)) {
      map.set(ref, { ref });
      for (const m of metricasNumericas) map.get(ref)[m] = 0;
    }
    const acc = map.get(ref);
    for (const m of metricasNumericas) {
      acc[m] = (acc[m] || 0) + Number(r[m] || 0);
    }
  }
  return [...map.values()];
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Use GET' });

  const auth = await validarUsuario(req);
  if (!auth.ok) return res.status(auth.status || 403).json({ error: auth.error });
  if (!auth.isAdmin) return res.status(403).json({ error: 'Apenas admin' });

  const lojaFiltro = ['todas', 'BR', 'ST'].includes(req.query.loja) ? req.query.loja : 'todas';

  try {
    // ─── 1. TOP VENDIDAS (45d) ─────────────────────────────────────────
    let qVend = supabase.from('vw_lojas_top_vendidas_45d')
      .select('ref, loja, pecas, clientes_distintos, pedidos_distintos');
    qVend = aplicarFiltroLoja(qVend, lojaFiltro);
    const { data: vendRows, error: errVend } = await qVend;
    if (errVend) return res.status(500).json({ error: errVend.message, where: 'top_vendidas' });

    const vendAgg = agregarPorRef(vendRows || [], ['pecas', 'clientes_distintos', 'pedidos_distintos'])
      .sort((a, b) => b.pecas - a.pecas)
      .slice(0, 30)
      .map((r, i) => ({ ...r, posicao: i + 1 }));

    // ─── 2. PRIMEIRA COMPRA (45d) ──────────────────────────────────────
    let qPrim = supabase.from('vw_lojas_primeira_compra_45d')
      .select('ref, canal_origem, loja, clientes, pecas');
    qPrim = aplicarFiltroLoja(qPrim, lojaFiltro);
    const { data: primRows, error: errPrim } = await qPrim;
    if (errPrim) return res.status(500).json({ error: errPrim.message, where: 'primeira_compra' });

    // Geral = todas linhas (todos canais)
    const primGeral = agregarPorRef(primRows || [], ['clientes', 'pecas'])
      .sort((a, b) => b.clientes - a.clientes)
      .slice(0, 15);

    // Vesti = só canal_origem='vesti'
    const primVesti = agregarPorRef(
      (primRows || []).filter(r => r.canal_origem === 'vesti'),
      ['clientes', 'pecas']
    )
      .sort((a, b) => b.clientes - a.clientes)
      .slice(0, 15);

    // ─── 3. RECOMPRA (90d) ─────────────────────────────────────────────
    let qRec = supabase.from('vw_lojas_recompra_90d')
      .select('ref, loja, ocorrencias, clientes_distintos');
    qRec = aplicarFiltroLoja(qRec, lojaFiltro);
    const { data: recRows, error: errRec } = await qRec;
    if (errRec) return res.status(500).json({ error: errRec.message, where: 'recompra' });

    const recAgg = agregarPorRef(recRows || [], ['ocorrencias', 'clientes_distintos'])
      .sort((a, b) => b.ocorrencias - a.ocorrencias)
      .slice(0, 15);

    // ─── 4. MATCHES (90d, sempre agregado) ─────────────────────────────
    const { data: matchRows, error: errM } = await supabase
      .from('mv_lojas_matches_90d')
      .select('ref_top, ref_match, coocorrencias, total_compras, pct')
      .order('ref_top')
      .order('pct', { ascending: false });
    if (errM) return res.status(500).json({ error: errM.message, where: 'matches' });

    // Agrupa { ref_top: [matches] }
    const matchesPorRef = {};
    for (const m of (matchRows || [])) {
      if (!matchesPorRef[m.ref_top]) matchesPorRef[m.ref_top] = [];
      matchesPorRef[m.ref_top].push(m);
    }

    // ─── HIDRATAR com lojas_produtos (descricao, categoria, qtd_estoque) ─
    const refsPraHidratar = new Set([
      ...vendAgg.map(r => r.ref),
      ...primGeral.map(r => r.ref),
      ...primVesti.map(r => r.ref),
      ...recAgg.map(r => r.ref),
      ...Object.keys(matchesPorRef),
      ...(matchRows || []).map(m => m.ref_match),
    ]);

    let prodMap = new Map();
    if (refsPraHidratar.size > 0) {
      const { data: prods } = await supabase
        .from('lojas_produtos')
        .select('ref, descricao, categoria, qtd_estoque')
        .in('ref', [...refsPraHidratar]);
      prodMap = new Map((prods || []).map(p => [p.ref, p]));
    }

    const hidratar = (r) => ({
      ...r,
      descricao: prodMap.get(r.ref)?.descricao || null,
      categoria: prodMap.get(r.ref)?.categoria || null,
      qtd_estoque: prodMap.get(r.ref)?.qtd_estoque || 0,
    });

    const hidratarMatch = (m) => ({
      ...m,
      descricao: prodMap.get(m.ref_match)?.descricao || null,
      categoria: prodMap.get(m.ref_match)?.categoria || null,
      qtd_estoque: prodMap.get(m.ref_match)?.qtd_estoque || 0,
    });

    const matchesHidratados = {};
    for (const [refTop, lista] of Object.entries(matchesPorRef)) {
      matchesHidratados[refTop] = lista.map(hidratarMatch);
    }

    // ─── ULTIMA ATUALIZACAO DA MATERIALIZED VIEW ─────────────────────
    // pg_stat_all_tables.last_analyze nao funciona pra matview. Buscar em
    // pg_class.relfrozenxid eh complexo. Simplificacao: backend assume que
    // refresh aconteceu. Frontend pode mostrar 'atualizado: hoje 03:00'.
    // Pra v1, vamos buscar do log do refresh quando o cron rodar.

    return res.json({
      loja: lojaFiltro,
      top_vendidas: vendAgg.map(hidratar),
      primeira_compra: {
        geral: primGeral.map(hidratar),
        vesti: primVesti.map(hidratar),
      },
      recompra: recAgg.map(hidratar),
      matches: matchesHidratados,
      ultima_atualizacao_matches: null, // preenchido pelo cron-refresh em iteracoes futuras
    });
  } catch (e) {
    console.error('[lojas-produtos-raiox] erro:', e?.message);
    return res.status(500).json({ error: e?.message || 'Erro' });
  }
}
