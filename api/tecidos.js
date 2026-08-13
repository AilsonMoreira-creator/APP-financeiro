/**
 * tecidos.js — ESTOQUE DE TECIDO da Sala de Corte (Ailson 13/08/2026)
 *
 * Regras combinadas com ele:
 *  - card por tecido (metragem padrão do rolo, default 50m), cores linkadas às
 *    mesmas cores da ordem de corte (nome + hex)
 *  - qualquer funcionário ACRESCENTA rolos; só ADMIN tira, ajusta, arquiva
 *    ou exclui
 *  - todo movimento vira log: quem, quando, quantos rolos tinha e ficou
 *  - baixa acontece quando a ordem VAI PRA SALA (não na criação) e volta
 *    inteira se a ordem sair de lá (estorno) — ver _tecidos-estoque.js
 *  - saldo insuficiente AVISA, nunca trava o corte
 *  - conferência física: registra a contagem real e grava o ajuste
 *
 * GET  ?acao=listar[&incluir_arquivados=1] | ?acao=log[&tecido_id=&limite=]
 * POST { acao, ... } — criar_tecido | editar_tecido | arquivar | excluir
 *                      | add_cor | entrada | ajuste | conferencia
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

export const config = { maxDuration: 60 };
const n = (v) => Number(v) || 0;

async function ehAdmin(user) {
  if (!user) return false;
  const { data } = await supabase.from('amicia_data').select('payload').eq('user_id', 'usuarios').maybeSingle();
  const lista = data?.payload?.usuarios || data?.payload || [];
  const arr = Array.isArray(lista) ? lista : [];
  return arr.some(u => String(u.usuario || u.login || '').toLowerCase() === String(user).toLowerCase() && u.admin === true);
}

async function registrar(mov) {
  await supabase.from('tecido_movimentos').insert(mov);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-User');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const usuario = String(req.headers['x-user'] || req.query?.user || '').trim() || 'desconhecido';

  try {
    // ─────────── LEITURA ───────────
    if (req.method === 'GET') {
      const acao = String(req.query?.acao || 'listar');

      if (acao === 'log') {
        let q = supabase.from('tecido_movimentos').select('*')
          .order('criado_em', { ascending: false })
          .limit(Math.min(parseInt(req.query?.limite) || 100, 300));
        if (req.query?.tecido_id) q = q.eq('tecido_id', req.query.tecido_id);
        const { data } = await q;
        return res.status(200).json({ movimentos: data || [] });
      }

      // listar: tecidos + cores + reservado (ordens criadas ainda não baixadas)
      const { data: tecidos } = await supabase.from('tecidos').select('*')
        .eq('arquivado', req.query?.incluir_arquivados === '1' ? undefined : false)
        .order('nome');
      const lista = (tecidos || []).filter(t => req.query?.incluir_arquivados === '1' || !t.arquivado);
      const { data: cores } = await supabase.from('tecido_cores').select('*').order('nome');

      // reservado: ordens que ainda não foram pra sala (baixa não aconteceu)
      const { data: ordens } = await supabase.from('ordens_corte')
        .select('id, tecido, cores, status, tecido_baixado_em')
        .in('status', ['aguardando', 'separado'])
        .is('tecido_baixado_em', null);
      const reservado = {};
      for (const o of (ordens || [])) {
        for (const c of (o.cores || [])) {
          const k = `${String(o.tecido || '').trim().toLowerCase()}|${String(c.nome || '').trim().toLowerCase()}`;
          reservado[k] = (reservado[k] || 0) + n(c.rolos);
        }
      }

      const saida = lista.map(t => ({
        ...t,
        cores: (cores || []).filter(c => c.tecido_id === t.id).map(c => ({
          ...c,
          reservado: reservado[`${String(t.nome).trim().toLowerCase()}|${String(c.nome).trim().toLowerCase()}`] || 0,
        })),
      }));
      return res.status(200).json({ tecidos: saida });
    }

    // ─────────── ESCRITA ───────────
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const acao = String(body.acao || '');
    const admin = await ehAdmin(usuario);
    const soAdmin = ['excluir', 'arquivar', 'ajuste', 'editar_tecido', 'conferencia'];
    if (soAdmin.includes(acao) && !admin) {
      return res.status(403).json({ error: 'Só o admin pode fazer isso' });
    }

    if (acao === 'criar_tecido') {
      const nome = String(body.nome || '').trim();
      if (!nome) return res.status(400).json({ error: 'nome do tecido é obrigatório' });
      const { data, error } = await supabase.from('tecidos')
        .insert({ nome, metragem_rolo: n(body.metragem_rolo) || 50, criado_por: usuario })
        .select().maybeSingle();
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ tecido: data });
    }

    if (acao === 'editar_tecido') {
      const upd = {};
      if (body.nome) upd.nome = String(body.nome).trim();
      if (body.metragem_rolo !== undefined) upd.metragem_rolo = n(body.metragem_rolo) || 50;
      const { data, error } = await supabase.from('tecidos').update(upd).eq('id', body.tecido_id).select().maybeSingle();
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ tecido: data });
    }

    if (acao === 'arquivar') {
      const { error } = await supabase.from('tecidos')
        .update({ arquivado: body.arquivar !== false }).eq('id', body.tecido_id);
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    if (acao === 'excluir') {
      const { error } = await supabase.from('tecidos').delete().eq('id', body.tecido_id);
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    if (acao === 'add_cor') {
      const nome = String(body.nome || '').trim();
      if (!body.tecido_id || !nome) return res.status(400).json({ error: 'tecido_id e nome são obrigatórios' });
      const { data, error } = await supabase.from('tecido_cores')
        .insert({ tecido_id: body.tecido_id, nome, hex: body.hex || null, rolos: 0 })
        .select().maybeSingle();
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ cor: data });
    }

    // entrada de rolos (qualquer funcionário) · ajuste e conferência (admin)
    if (['entrada', 'ajuste', 'conferencia'].includes(acao)) {
      const { data: cor } = await supabase.from('tecido_cores').select('*').eq('id', body.cor_id).maybeSingle();
      if (!cor) return res.status(404).json({ error: 'cor não encontrada' });
      const { data: tecido } = await supabase.from('tecidos').select('*').eq('id', cor.tecido_id).maybeSingle();

      const antes = n(cor.rolos);
      let depois, delta, motivo = String(body.motivo || '').trim();

      if (acao === 'entrada') {
        delta = Math.abs(n(body.rolos));
        if (!delta) return res.status(400).json({ error: 'quantidade de rolos é obrigatória' });
        depois = antes + delta;
      } else if (acao === 'ajuste') {
        delta = n(body.rolos); // pode ser negativo (só admin chega aqui)
        if (!delta) return res.status(400).json({ error: 'informe a quantidade' });
        depois = Math.max(0, antes + delta);
      } else { // conferencia: contagem física vira o novo saldo
        const contado = n(body.contado);
        if (body.contado === undefined || contado < 0) return res.status(400).json({ error: 'informe a contagem física' });
        depois = contado;
        delta = contado - antes;
        motivo = motivo || (delta === 0 ? 'conferência: bateu certinho' : `conferência: ${delta > 0 ? 'sobra' : 'falta'} de ${Math.abs(delta)} rolo(s)`);
      }

      await supabase.from('tecido_cores').update({ rolos: depois }).eq('id', cor.id);
      await registrar({
        tecido_id: cor.tecido_id, cor_id: cor.id, tecido_nome: tecido?.nome, cor_nome: cor.nome,
        tipo: acao === 'entrada' ? 'entrada' : acao, rolos: delta, rolos_antes: antes, rolos_depois: depois,
        metragem_rolo: tecido?.metragem_rolo || 50, motivo: motivo || null, usuario,
      });
      return res.status(200).json({ ok: true, antes, depois, delta });
    }

    return res.status(400).json({ error: 'ação desconhecida' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
