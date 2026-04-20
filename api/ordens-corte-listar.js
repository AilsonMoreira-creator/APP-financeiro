// api/ordens-corte-listar.js — Lista ordens de corte com filtros
// GET /api/ordens-corte-listar?status=&ref=&origem=&pagina=&perfil=
//
// Query params:
//   - status: aguardando | separado | na_sala | concluido | cancelado (opcional)
//   - ref: busca por ref que começa com o valor (opcional)
//   - origem: manual | os_amicia (opcional)
//   - pagina: número (default 1)
//   - perfil: admin | funcionario (default admin)
//             funcionario só vê aguardando + separado (pra Fila mobile)
//
// Retorna: { ordens: [...], total, pagina, totalPaginas }

import { supabase, setCors } from './_ordens-corte-helpers.js';

const POR_PAGINA = 50;

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  try {
    const { status, ref, origem, perfil } = req.query;
    const pagina = Math.max(1, parseInt(req.query.pagina) || 1);

    let query = supabase
      .from('ordens_corte')
      .select('*', { count: 'exact' });

    // Filtro de perfil: funcionário só vê o que importa pra Fila
    if (perfil === 'funcionario') {
      query = query.in('status', ['aguardando', 'separado']);
    } else if (status) {
      query = query.eq('status', status);
    }

    if (ref) query = query.ilike('ref', `${ref}%`);
    if (origem) query = query.eq('origem', origem);

    // Ordenação: cancelados/concluídos no fim, depois por created_at desc
    // Postgres não tem CASE em order via sb-js, então fazemos via order composto
    query = query
      .order('status', { ascending: true }) // aguardando vem primeiro alfabeticamente
      .order('created_at', { ascending: false });

    const from = (pagina - 1) * POR_PAGINA;
    const to = from + POR_PAGINA - 1;
    query = query.range(from, to);

    const { data, error, count } = await query;
    if (error) {
      console.error('listar erro:', error);
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({
      ordens: data || [],
      total: count || 0,
      pagina,
      totalPaginas: Math.ceil((count || 0) / POR_PAGINA),
    });
  } catch (e) {
    console.error('listar catch:', e);
    return res.status(500).json({ error: e?.message || 'erro interno' });
  }
}
