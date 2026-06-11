// ─────────────────────────────────────────────────────────────────────────────
// Fotos anexadas às sugestões diárias do módulo Lojas (Ailson 11/06/2026)
//
// Cada sugestão pode citar até 3 REFs (metadados_ia.refs_fotos, preenchido pela
// IA) além do produto_ref principal. Este helper resolve as fotos dessas REFs em
// DUAS fontes, nesta ordem de prioridade:
//   1. Sofia mídias (lojas_whats_midias, tipo='foto', ativa) — fotos mais
//      recentes, bucket 'sofia-midias'
//   2. Ficha técnica — bucket 'produtos', arquivo nomeado pela ref
//      ({ref}.jpg/png/webp, com e sem zero à esquerda)
//
// Regra: mínimo 2 / máximo 5 fotos por sugestão. Se a REF principal só tem 1
// foto, complementa com a outra fonte da MESMA ref e depois com as refs
// secundárias. Se no fim só existir 1 foto, anexa 1 (melhor que nada). Se
// nenhuma, fotos = null (card não mostra a seção).
//
// Saída gravada em lojas_sugestoes_diarias.fotos:
//   [{ url, ref, origem: 'sofia' | 'ficha' }]
// ─────────────────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;

const normRef = (s) => String(s || '').replace(/\D/g, '').replace(/^0+/, '') || '';

/**
 * Enriquece in-place cada linha de sugestão com o campo `fotos`.
 * Nunca lança: falha em qualquer fonte apenas reduz as fotos disponíveis.
 * @param {object} supabase client service-role
 * @param {Array} linhas linhas prontas pro insert (mutadas in-place)
 */
export async function resolverFotosSugestoes(supabase, linhas) {
  if (!Array.isArray(linhas) || linhas.length === 0 || !SUPABASE_URL) return;

  // 1) Universo de refs citadas em todas as sugestões
  const refsPorLinha = linhas.map((l) => {
    const set = [];
    const push = (r) => { const n = normRef(r); if (n && !set.includes(n)) set.push(n); };
    push(l.produto_ref);
    const extras = l.metadados_ia?.refs_fotos;
    if (Array.isArray(extras)) extras.slice(0, 3).forEach(push);
    return set;
  });
  const todasRefs = [...new Set(refsPorLinha.flat())];
  if (todasRefs.length === 0) return;

  // 2) Fonte Sofia mídias (prioritária — fotos mais recentes)
  const sofiaPorRef = {};
  try {
    const { data } = await supabase
      .from('lojas_whats_midias')
      .select('ref, storage_path, criada_em')
      .eq('tipo', 'foto').eq('ativa', true)
      .not('ref', 'is', null);
    (data || []).forEach((m) => {
      const rn = normRef(m.ref);
      if (!rn || !todasRefs.includes(rn) || !m.storage_path) return;
      if (!sofiaPorRef[rn]) sofiaPorRef[rn] = [];
      sofiaPorRef[rn].push({
        url: `${SUPABASE_URL}/storage/v1/object/public/sofia-midias/${m.storage_path}`,
        ref: rn,
        origem: 'sofia',
        _ts: m.criada_em || '',
      });
    });
    // mais recente primeiro dentro de cada ref
    Object.values(sofiaPorRef).forEach((arr) => arr.sort((a, b) => (b._ts > a._ts ? 1 : -1)));
  } catch (e) {
    console.warn('[lojas-fotos] sofia-midias indisponivel:', e?.message);
  }

  // 3) Fonte ficha técnica (bucket 'produtos', arquivo = ref + extensão)
  const fichaPorRef = {};
  try {
    const { data: objetos } = await supabase.storage.from('produtos').list('', { limit: 1000 });
    (objetos || []).forEach((o) => {
      const m = /^(\d+)\.(jpg|jpeg|png|webp)$/i.exec(o.name || '');
      if (!m) return;
      const rn = normRef(m[1]);
      if (!rn || !todasRefs.includes(rn) || fichaPorRef[rn]) return; // 1 por ref
      fichaPorRef[rn] = {
        url: `${SUPABASE_URL}/storage/v1/object/public/produtos/${o.name}`,
        ref: rn,
        origem: 'ficha',
      };
    });
  } catch (e) {
    console.warn('[lojas-fotos] bucket produtos indisponivel:', e?.message);
  }

  // 4) Composição por sugestão: 1 FOTO POR REF (refs distintas — Ailson 11/06:
  //    "mínimo 2 fotos" significa refs DIFERENTES, nunca 2 fotos da mesma ref).
  //    Por ref: foto da Sofia mídias (mais recente) > ficha técnica. Cap 5.
  //    Se a sugestão só cita 1 ref, vai 1 foto mesmo (não duplica).
  linhas.forEach((l, i) => {
    const refs = refsPorLinha[i];
    if (!refs.length) { l.fotos = null; return; }
    const fotos = [];
    for (const rn of refs) {
      if (fotos.length >= 5) break;
      const f = (sofiaPorRef[rn] || [])[0] || fichaPorRef[rn];
      if (!f) continue;
      if (fotos.some((x) => x.url === f.url)) continue;
      fotos.push({ url: f.url, ref: f.ref, origem: f.origem });
    }
    l.fotos = fotos.length ? fotos : null;
  });
}
