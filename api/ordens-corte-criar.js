// api/ordens-corte-criar.js — Cria nova ordem de corte
// POST /api/ordens-corte-criar
//
// Body: {
//   ref: string,             // OBRIGATÓRIO - precisa existir no cadastro Oficinas
//   grade: object,           // OBRIGATÓRIO - { "P": 1, "G": 1, "GG": 2 }
//   cores: array,            // OBRIGATÓRIO - [{nome, rolos, hex?}]
//   grupo?: integer,         // 0-9 opcional
//   criada_por: string,      // OBRIGATÓRIO - usuário criando (ou via header X-User)
//
//   // Campos só usados se origem='os_amicia' (Fase B):
//   origem?: 'manual' | 'os_amicia',
//   insight_id?: uuid,
//   aprovada_por?: string,
//   aprovacao_tipo?: 'sim' | 'editar',
//   validade_ate?: ISO timestamp
// }
//
// Retorna 201 { ordem: {...} } ou 400 com erro detalhado

import {
  supabase, setCors, getUserFromReq, parseBody,
  validateGrade, validateCores, calcTotalRolos,
  buscarProdutoPorRef, insertHistorico
} from './_ordens-corte-helpers.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = parseBody(req);
    const usuario = getUserFromReq(req) || body.criada_por;

    // ── Validações ──
    if (!usuario) return res.status(400).json({ error: 'criada_por (ou header X-User) obrigatório' });

    const ref = (body.ref || '').toString().trim();
    if (!ref) return res.status(400).json({ error: 'ref obrigatória' });

    const errGrade = validateGrade(body.grade);
    if (errGrade) return res.status(400).json({ error: errGrade });

    const errCores = validateCores(body.cores);
    if (errCores) return res.status(400).json({ error: errCores });

    if (body.grupo !== undefined && body.grupo !== null) {
      if (!Number.isInteger(body.grupo) || body.grupo < 0 || body.grupo > 9) {
        return res.status(400).json({ error: 'grupo deve ser inteiro entre 0 e 9' });
      }
    }

    const origem = body.origem === 'os_amicia' ? 'os_amicia' : 'manual';

    // ── Validação cruzada com Oficinas: ref precisa existir e ter tecido ──
    const produto = await buscarProdutoPorRef(ref);
    if (!produto) {
      return res.status(400).json({
        error: 'Ref não cadastrada em Oficinas. Cadastre primeiro o produto.',
        codigo: 'REF_NAO_CADASTRADA'
      });
    }
    if (!produto.tecido || !produto.tecido.trim()) {
      return res.status(400).json({
        error: 'Produto sem tecido cadastrado. Complete o cadastro em Oficinas antes.',
        codigo: 'PRODUTO_SEM_TECIDO'
      });
    }

    // ── Monta o registro ──
    const total_rolos = calcTotalRolos(body.cores);
    const novaOrdem = {
      ref: produto.ref, // usa a ref normalizada do cadastro
      descricao: produto.descricao || null,
      tecido: produto.tecido,
      grupo: (body.grupo !== undefined && body.grupo !== null) ? body.grupo : null,
      grade: body.grade,
      cores: body.cores,
      total_rolos,
      status: 'aguardando',
      origem,
      insight_id: body.insight_id || null,
      criada_por: usuario,
      aprovada_por: origem === 'os_amicia' ? (body.aprovada_por || null) : null,
      aprovacao_tipo: origem === 'os_amicia' ? (body.aprovacao_tipo || null) : null,
      validade_ate: origem === 'os_amicia' ? (body.validade_ate || null) : null,
    };

    const { data, error } = await supabase
      .from('ordens_corte')
      .insert(novaOrdem)
      .select()
      .single();

    if (error) {
      console.error('criar erro:', error);
      return res.status(500).json({ error: error.message });
    }

    // ── Histórico ──
    await insertHistorico({
      ordem_id: data.id,
      acao: 'criada',
      payload_depois: data,
      user_id: usuario,
    });

    return res.status(201).json({ ordem: data });
  } catch (e) {
    console.error('criar catch:', e);
    return res.status(500).json({ error: e?.message || 'erro interno' });
  }
}
