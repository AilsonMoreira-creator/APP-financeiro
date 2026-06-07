// ═══════════════════════════════════════════════════════════════════════════
// /api/lojas-whats-clientes-massa — ENFILEIRA disparo em massa (módulo Clientes)
// ═══════════════════════════════════════════════════════════════════════════
// POST { cliente_ids: [...], etapa: 'feedback'|'inativo' }
//
// FEEDBACK: template escolhido POR CLIENTE pela view vw_lojas_clientes_feedback:
//   - perfil 'distancia' (canal Vesti OU pagamento a distância) → feedback_v1 (cita entrega)
//   - resto (presencial/desconhecido/multiplo)                  → feedback_loja_v1 (neutro)
//   - falso_novo (mesmo telefone OU grupo já existe em cadastro com 1ª compra anterior) → PULADO
// INATIVO: template único (inativos_v1).
//
// Insere os clientes na fila (clientes_sofia_fila) com o template_name já resolvido
// por linha e processa um primeiro lote inline. O resto é drenado pelo cron.
//
// Retorna { lote_id, total, enfileirados, pulados_ja_cliente, pulados_template_inativo, ... }.
// ═══════════════════════════════════════════════════════════════════════════

import { randomUUID } from 'crypto';
import { supabase } from './_lojas-whats-helpers.js';
import { processarFila } from './_lojas-whats-clientes-fila.js';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

const TPL_FEEDBACK_DISTANCIA = 'feedback_v1';
const TPL_FEEDBACK_PRESENCIAL = 'feedback_loja_v1';
const TPL_INATIVO = 'inativos_v1';

const LIMITE = 1000;
const PRIMEIRO_LOTE = 25; // processa inline pra dar feedback imediato

// retorna Set com os nomes que estão ativos entre os pedidos
async function nomesAtivos(nomes) {
  const uniq = [...new Set(nomes)];
  if (uniq.length === 0) return new Set();
  const { data } = await supabase
    .from('lojas_whats_templates')
    .select('name')
    .in('name', uniq)
    .eq('ativo', true);
  return new Set((data || []).map(t => t.name));
}

// lê a view de feedback em blocos → Map cliente_id → { perfil_entrega, falso_novo }
async function lerPerfis(ids) {
  const mapa = new Map();
  for (let i = 0; i < ids.length; i += 500) {
    const bloco = ids.slice(i, i + 500);
    const { data, error } = await supabase
      .from('vw_lojas_clientes_feedback')
      .select('cliente_id, perfil_entrega, falso_novo')
      .in('cliente_id', bloco);
    if (error) throw error;
    for (const r of (data || [])) mapa.set(r.cliente_id, r);
  }
  return mapa;
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  try {
    const { cliente_ids, etapa } = req.body || {};
    if (!Array.isArray(cliente_ids) || cliente_ids.length === 0) {
      return res.status(400).json({ error: 'cliente_ids_obrigatorio' });
    }
    if (cliente_ids.length > LIMITE) return res.status(400).json({ error: `limite_${LIMITE}_excedido` });

    const etapaFinal = (etapa === 'inativo') ? 'inativo' : 'feedback';

    // 1. resolve { cliente_id, template_name } por cliente
    let assignments = [];
    let puladosJaCliente = 0;

    if (etapaFinal === 'inativo') {
      assignments = cliente_ids.map(cid => ({ cliente_id: cid, template_name: TPL_INATIVO }));
    } else {
      const perfis = await lerPerfis(cliente_ids);
      for (const cid of cliente_ids) {
        const p = perfis.get(cid);
        if (p && p.falso_novo) { puladosJaCliente++; continue; } // já era cliente: não manda "primeira compra"
        const distancia = p && p.perfil_entrega === 'distancia';
        assignments.push({
          cliente_id: cid,
          template_name: distancia ? TPL_FEEDBACK_DISTANCIA : TPL_FEEDBACK_PRESENCIAL,
        });
      }
    }

    // 2. checa templates ativos; descarta quem usaria template inativo
    const ativos = await nomesAtivos(assignments.map(a => a.template_name));
    if (ativos.size === 0) {
      const nomes = [...new Set(assignments.map(a => a.template_name))].join(', ');
      return res.status(400).json({ error: 'template_inexistente_ou_inativo', templates: nomes });
    }
    let puladosTplInativo = 0;
    const validos = [];
    for (const a of assignments) {
      if (ativos.has(a.template_name)) validos.push(a);
      else puladosTplInativo++;
    }
    if (validos.length === 0) {
      return res.status(400).json({ error: 'nenhum_template_ativo', pulados_template_inativo: puladosTplInativo });
    }

    // 3. enfileira (template_name já resolvido por linha)
    const lote_id = randomUUID();
    const linhas = validos.map(a => ({
      lote_id, cliente_id: a.cliente_id, etapa: etapaFinal, template_name: a.template_name, status: 'pendente',
    }));
    for (let i = 0; i < linhas.length; i += 500) {
      const { error } = await supabase.from('clientes_sofia_fila').insert(linhas.slice(i, i + 500));
      if (error) throw error;
    }

    // 4. processa um primeiro lote inline (resto vai no cron)
    const r = await processarFila(PRIMEIRO_LOTE);

    return res.status(200).json({
      ok: true, lote_id,
      total: cliente_ids.length,
      enfileirados: validos.length,
      pulados_ja_cliente: puladosJaCliente,
      pulados_template_inativo: puladosTplInativo,
      enviados: r.enviados, erros: r.erros, restantes: r.restantes,
    });
  } catch (e) {
    console.error('[lojas-whats-clientes-massa]', e.message);
    return res.status(500).json({ error: e.message });
  }
}
