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

    // 30/08 (regra dele): grupo virou codigo DIA-A-DIA — numero sequencial do
    // dia + letra do dia da semana (seg=A ter=B qua=C qui=D sex=E sab=F dom=H,
    // SEM G pra nao confundir com o tamanho G). Ex.: 2a ordem de terca = 2B.
    // Continua editavel: se vier no body, vale o que veio; vazio = automatico.
    let grupoFinal = null;
    if (body.grupo !== undefined && body.grupo !== null && String(body.grupo).trim() !== '') {
      grupoFinal = String(body.grupo).trim().toUpperCase();
      if (!/^[0-9A-Z]{1,4}$/.test(grupoFinal)) {
        return res.status(400).json({ error: 'grupo deve ter 1 a 4 letras/numeros (ex.: 1A)' });
      }
    } else {
      grupoFinal = await gerarGrupoDoDia();
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
      grupo: grupoFinal,
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

// Proximo grupo do dia: letra pelo dia da semana BRT e numero = maior
// sequencial ja usado hoje com essa letra + 1. Falha de leitura nao trava a
// criacao: sem resposta do banco, sai "1<letra>".
const LETRA_DIA = ['H', 'A', 'B', 'C', 'D', 'E', 'F']; // dom, seg, ..., sab (G pulado)
async function gerarGrupoDoDia() {
  const agoraBrt = new Date(Date.now() - 3 * 3600000);
  const letra = LETRA_DIA[agoraBrt.getUTCDay()];
  const hojeIni = agoraBrt.toISOString().slice(0, 10) + 'T00:00:00-03:00';
  try {
    const { data } = await supabase.from('ordens_corte')
      .select('grupo').gte('created_at', hojeIni).not('grupo', 'is', null);
    let maior = 0;
    for (const r of (data || [])) {
      const m = String(r.grupo || '').toUpperCase().match(new RegExp('^(\\d{1,3})' + letra + '$'));
      if (m) maior = Math.max(maior, parseInt(m[1]));
    }
    return `${maior + 1}${letra}`;
  } catch {
    return `1${letra}`;
  }
}
