// api/lojas-whats-refs-buscar.js
// Busca visual de referencias pro modulo Sofia (Ailson 04/07/2026).
// Serve o picker do modal "Indicar referencias" e os chips de ref nas
// sugestoes: a assistente nao precisa decorar ref nem sair da tela.
//
//   GET ?refs=2723,3011   -> hidrata refs especificas (thumb, nome, preco)
//   GET ?q=conjunto       -> busca por nome/categoria/ref/preco (ate 12)
//
// Fontes combinadas:
//   - lojas_produtos (545 refs): descricao, categoria, preco_medio, estoque
//   - ficha tecnica MODELOS_POR_REF (62 refs): nome rico + preco de TABELA
//   - lojas_whats_midias tipo='foto' (69 refs): thumbnail do catalogo
// Refs SEM foto tambem aparecem (placeholder no front) — o universo de
// venda e maior que o universo fotografado.

import { supabase } from './_lojas-whats-helpers.js';
import { MODELOS_POR_REF } from './_lojas-modelos-data.js';

const normRef = (r) => String(r ?? '').trim().replace(/^0+/, '') || '0';

// Cache do universo (produtos + fotos + ficha) — barato e muda pouco.
const cacheBase = { data: null, expiresAt: 0 };
const CACHE_TTL = 60 * 1000;

async function montarBase() {
  if (cacheBase.data && cacheBase.expiresAt > Date.now()) return cacheBase.data;

  const [{ data: prods }, { data: fotos }] = await Promise.all([
    supabase.from('lojas_produtos').select('ref, descricao, categoria, preco_medio, qtd_estoque'),
    supabase.from('lojas_whats_midias')
      .select('ref, storage_path, criada_em')
      .eq('tipo', 'foto')
      .not('ativa', 'is', false)
      .not('storage_path', 'is', null)
      .order('criada_em', { ascending: false }),
  ]);

  const fotoPorRef = new Map();
  for (const f of fotos || []) {
    const rn = normRef(f.ref);
    if (!fotoPorRef.has(rn) && f.storage_path) {
      const { data: pub } = supabase.storage.from('sofia-midias').getPublicUrl(f.storage_path);
      if (pub?.publicUrl) fotoPorRef.set(rn, pub.publicUrl);
    }
  }

  const porRef = new Map();
  for (const p of prods || []) {
    const rn = normRef(p.ref);
    if (porRef.has(rn)) continue;
    const ficha = MODELOS_POR_REF[rn] || null;
    porRef.set(rn, {
      ref: rn,
      // nome da ficha tecnica e mais legivel que a descricao do Mire
      nome: (ficha?.nome || p.descricao || '').trim() || null,
      categoria: (p.categoria || ficha?.tipo || '').toUpperCase() || null,
      preco_tabela: ficha?.preco_atacado ? Number(ficha.preco_atacado) : null,
      preco_medio: p.preco_medio != null ? Number(p.preco_medio) : null,
      qtd_estoque: Number(p.qtd_estoque) || 0,
      foto_url: fotoPorRef.get(rn) || null,
    });
  }
  // Refs so na ficha (sem linha no Mire) tambem entram
  for (const rn of Object.keys(MODELOS_POR_REF)) {
    if (porRef.has(rn)) continue;
    const f = MODELOS_POR_REF[rn];
    porRef.set(rn, {
      ref: rn, nome: f.nome || null, categoria: (f.tipo || '').toUpperCase() || null,
      preco_tabela: f.preco_atacado ? Number(f.preco_atacado) : null,
      preco_medio: null, qtd_estoque: 0, foto_url: fotoPorRef.get(rn) || null,
    });
  }

  const base = [...porRef.values()];
  cacheBase.data = base;
  cacheBase.expiresAt = Date.now() + CACHE_TTL;
  return base;
}

const semAcento = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  try {
    const base = await montarBase();

    // ── Modo hidratar: ?refs=a,b,c ────────────────────────────────────────
    if (req.query.refs) {
      const pedidas = String(req.query.refs).split(',').map(normRef).filter(Boolean);
      const mapa = new Map(base.map(x => [x.ref, x]));
      const itens = pedidas.map(rn => mapa.get(rn) || { ref: rn, nome: null, categoria: null, preco_tabela: null, preco_medio: null, qtd_estoque: 0, foto_url: null, desconhecida: true });
      return res.status(200).json({ itens });
    }

    // ── Modo busca: ?q= ───────────────────────────────────────────────────
    const q = semAcento(String(req.query.q || '').trim());
    if (!q) return res.status(200).json({ itens: [] });

    const qNum = Number(q.replace(',', '.'));
    const ehNumero = Number.isFinite(qNum) && /^[\d.,]+$/.test(q);
    const palavras = q.split(/\s+/).filter(w => w.length >= 3);

    const pontuar = (x) => {
      let s = 0;
      // ref por prefixo (digitar "27" lista as 27xx)
      if (ehNumero && x.ref.startsWith(String(Math.trunc(qNum)))) s += x.ref === q ? 10 : 4;
      // preco: tabela exata (±3%) forte, media (±12%) fraca — so pra q >= 20
      // (abaixo disso e quase certeza que a pessoa ta digitando uma ref)
      if (ehNumero && qNum >= 20) {
        if (x.preco_tabela && Math.abs(x.preco_tabela - qNum) <= x.preco_tabela * 0.03) s += 6;
        else if (x.preco_medio && Math.abs(x.preco_medio - qNum) <= x.preco_medio * 0.12) s += 2;
      }
      if (palavras.length) {
        const alvo = semAcento(`${x.nome || ''} ${x.categoria || ''}`);
        for (const w of palavras) if (alvo.includes(w)) s += 3;
      }
      return s;
    };

    const itens = base
      .map(x => ({ x, s: pontuar(x) }))
      // Item sem nome E sem foto e irreconhecivel no picker (a assistente nao
      // tem como confirmar visualmente): so entra se a ref digitada for EXATA.
      // Evita refs mortas 169x poluindo a busca por preco "169". Ailson 05/07/2026.
      .filter(r => r.s > 0 && (r.x.nome || r.x.foto_url || r.x.ref === q))
      .sort((a, b) => (b.s - a.s)
        || ((b.x.foto_url ? 1 : 0) - (a.x.foto_url ? 1 : 0))
        || (b.x.qtd_estoque - a.x.qtd_estoque))
      .slice(0, 12)
      .map(r => r.x);

    return res.status(200).json({ itens });
  } catch (e) {
    console.error('[refs-buscar]', e);
    return res.status(500).json({ error: 'erro_interno' });
  }
}
