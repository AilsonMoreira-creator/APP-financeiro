// ═══════════════════════════════════════════════════════════════════════════
// cortes-cores-manuais.js — Cores manuais (fora do ranking Bling) salvas e
// COMPARTILHADAS entre Oficina/Cortes (Detalhes do corte) e Sala de Cortes
// (Nova ordem). Ailson 04/06/2026.
// ═══════════════════════════════════════════════════════════════════════════
//
// Guarda em amicia_data user_id='cortes-cores-manuais' → payload.cores = [{nome,hex}]
//
//   GET                       → { cores: [{nome,hex}] }
//   POST   { nome, hex }       → adiciona (dedup por nome) → { cores }
//   DELETE { nome }            → remove → { cores }
// ═══════════════════════════════════════════════════════════════════════════

import { supabase, setCors, parseBody } from './_ordens-corte-helpers.js';

const UID = 'cortes-cores-manuais';

async function ler() {
  const { data } = await supabase
    .from('amicia_data').select('payload').eq('user_id', UID).maybeSingle();
  const cores = data?.payload?.cores;
  return Array.isArray(cores) ? cores : [];
}

async function salvar(cores) {
  const { error } = await supabase
    .from('amicia_data')
    .upsert({ user_id: UID, payload: { cores } }, { onConflict: 'user_id' });
  if (error) throw new Error(error.message);
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      return res.json({ cores: await ler() });
    }

    const body = parseBody(req);

    if (req.method === 'POST') {
      const nome = (body?.nome || '').trim();
      if (!nome) return res.status(400).json({ error: 'nome obrigatorio' });
      const hex = (body?.hex || '#888888').trim();
      const cores = await ler();
      if (cores.some(c => (c.nome || '').toLowerCase() === nome.toLowerCase())) {
        return res.json({ cores });  // ja existe — no-op idempotente
      }
      const novas = [...cores, { nome, hex }];
      await salvar(novas);
      return res.json({ cores: novas });
    }

    if (req.method === 'DELETE') {
      const nome = (req.query?.nome || body?.nome || '').trim();
      if (!nome) return res.status(400).json({ error: 'nome obrigatorio' });
      const cores = await ler();
      const novas = cores.filter(c => (c.nome || '').toLowerCase() !== nome.toLowerCase());
      await salvar(novas);
      return res.json({ cores: novas });
    }

    return res.status(405).json({ error: 'metodo nao suportado' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
