/**
 * lojas-cliente-observacoes.js — Observações da vendedora sobre cliente
 *
 * GET ?cliente_id=<uuid>      — busca observação atual
 * POST { cliente_id, payload } — salva/atualiza observação
 *
 * Estrutura do payload:
 *   {
 *     personalidade: 'doce' | 'briguenta' | 'indecisa' | 'divertida' |
 *                    'discreta' | 'apressada' | 'detalhista' | 'outro' | null,
 *     evento_recente: 'gravidez' | 'viagem' | 'festa' | 'mudanca_loja' |
 *                     'dificuldade_financeira' | 'momento_bom' | 'outro' | null,
 *     perfil_compra: ['gosta_promocao', 'gosta_novidades'] — array de tags
 *                    (multi-select, Ailson 10/05/2026)
 *     preferencias: 'string livre, ex: só linho, odeia preto',
 *     observacao_livre: 'string longa adicional'
 *   }
 *
 * Auth: vendedora dona do cliente OU admin.
 *
 * Sessao Ailson 07/05/2026 (etapa B), expandido 10/05/2026 (perfil_compra).
 */
import { supabase, validarUsuario, setCors } from './_lojas-helpers.js';

const VALORES_PERSONALIDADE = [
  'doce', 'briguenta', 'indecisa', 'divertida',
  'discreta', 'apressada', 'detalhista', 'outro',
];
const VALORES_EVENTO = [
  'gravidez', 'viagem', 'festa', 'mudanca_loja',
  'dificuldade_financeira', 'momento_bom', 'outro',
];
// Perfil de compra — multi-select (Ailson 10/05/2026)
// IA usa como GATILHO de prioridade: gosta_promocao -> mensagens com promo
// quando houver; gosta_novidades -> priorizar novidade_oficina sobre
// reposicao/best_seller na hierarquia de ganchos.
const VALORES_PERFIL_COMPRA = [
  'gosta_promocao', 'gosta_novidades',
];

// ─── ONDA 3 (Ailson 10/05/2026): listas estruturadas ─────────────────────
// Cada item tem { id, tipo, detalhe, data_registro, contexto, resolvido? }.
// Backend valida tipo (whitelist), trunca detalhe, mantem contexto livre.
const VALORES_RECLAMACOES = [
  'defeito_costura', 'linho_encolheu', 'viscolinho_encolheu', 'tecido_qualidade',
  'concorrente_cidade', 'preco_alto', 'atendimento_ruim',
  'modelagem_ruim', 'outros',
];
const VALORES_ELOGIOS = [
  'atendimento', 'colecao', 'modelagem', 'qualidade_tecido',
  'precos', 'variedade', 'outros',
];
const VALORES_EVENTOS_TIMELINE = [
  'gravidez', 'mudanca_loja', 'viagem_longa', 'casamento',
  'reforma_loja', 'parceria_nova', 'outros',
];

// Sanitiza array de itens (reclamacoes/elogios/eventos_timeline)
function sanitizarListaItens(arr, valoresValidos, permitirResolvido = false) {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter(it => it && typeof it === 'object' && valoresValidos.includes(it.tipo))
    .slice(0, 30) // hard cap 30 itens por lista — protecao contra payload abusivo
    .map(it => ({
      id: typeof it.id === 'string' ? it.id.slice(0, 50) : `gen_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      tipo: it.tipo,
      detalhe: typeof it.detalhe === 'string' ? it.detalhe.slice(0, 300).trim() : '',
      data_registro: typeof it.data_registro === 'string' ? it.data_registro : new Date().toISOString(),
      contexto: it.contexto && typeof it.contexto === 'object' ? it.contexto : {},
      ...(permitirResolvido ? { resolvido: !!it.resolvido } : {}),
    }));
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const auth = await validarUsuario(req);
  if (!auth.ok) return res.status(auth.status || 403).json({ error: auth.error });

  if (req.method === 'GET') {
    return await handleGet(req, res, auth);
  } else if (req.method === 'POST') {
    return await handlePost(req, res, auth);
  } else {
    return res.status(405).json({ error: 'Use GET ou POST' });
  }
}

async function handleGet(req, res, auth) {
  const { cliente_id } = req.query || {};
  if (!cliente_id) return res.status(400).json({ error: 'cliente_id obrigatorio' });

  const { data: cli, error } = await supabase
    .from('lojas_clientes')
    .select('id, vendedora_id, observacoes_ia')
    .eq('id', cliente_id)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!cli) return res.status(404).json({ error: 'Cliente nao encontrado' });

  // Auth: admin OU vendedora dona
  if (!auth.isAdmin && cli.vendedora_id !== auth.vendedoraId) {
    return res.status(403).json({ error: 'Sem permissao pra esse cliente' });
  }

  return res.json({ observacoes: cli.observacoes_ia || null });
}

async function handlePost(req, res, auth) {
  const { cliente_id, payload } = req.body || {};
  if (!cliente_id) return res.status(400).json({ error: 'cliente_id obrigatorio' });
  if (!payload || typeof payload !== 'object') {
    return res.status(400).json({ error: 'payload obrigatorio' });
  }

  // Valida cliente + auth
  const { data: cli, error: cliErr } = await supabase
    .from('lojas_clientes')
    .select('id, vendedora_id')
    .eq('id', cliente_id)
    .maybeSingle();
  if (cliErr) return res.status(500).json({ error: cliErr.message });
  if (!cli) return res.status(404).json({ error: 'Cliente nao encontrado' });
  if (!auth.isAdmin && cli.vendedora_id !== auth.vendedoraId) {
    return res.status(403).json({ error: 'Sem permissao pra esse cliente' });
  }

  // Sanitiza payload
  const perfilCompraValido = Array.isArray(payload.perfil_compra)
    ? payload.perfil_compra.filter(v => VALORES_PERFIL_COMPRA.includes(v))
    : [];
  const sanitizado = {
    personalidade: VALORES_PERSONALIDADE.includes(payload.personalidade) ? payload.personalidade : null,
    evento_recente: VALORES_EVENTO.includes(payload.evento_recente) ? payload.evento_recente : null,
    perfil_compra: perfilCompraValido,
    preferencias: typeof payload.preferencias === 'string' ? payload.preferencias.slice(0, 500).trim() : '',
    observacao_livre: typeof payload.observacao_livre === 'string' ? payload.observacao_livre.slice(0, 1000).trim() : '',
    // Onda 3 — Ailson 10/05/2026
    reclamacoes: sanitizarListaItens(payload.reclamacoes, VALORES_RECLAMACOES, true),
    elogios: sanitizarListaItens(payload.elogios, VALORES_ELOGIOS, false),
    eventos_timeline: sanitizarListaItens(payload.eventos_timeline, VALORES_EVENTOS_TIMELINE, false),
    atualizado_em: new Date().toISOString(),
    atualizado_por: auth.userId || auth.vendedoraId || 'desconhecido',
  };

  // Se TUDO eh vazio, remove a observacao (LIMPAR)
  const ehVazio = !sanitizado.personalidade && !sanitizado.evento_recente
    && sanitizado.perfil_compra.length === 0
    && !sanitizado.preferencias && !sanitizado.observacao_livre
    && sanitizado.reclamacoes.length === 0
    && sanitizado.elogios.length === 0
    && sanitizado.eventos_timeline.length === 0;

  const { error: updErr } = await supabase
    .from('lojas_clientes')
    .update({ observacoes_ia: ehVazio ? null : sanitizado })
    .eq('id', cliente_id);
  if (updErr) return res.status(500).json({ error: updErr.message });

  return res.json({ ok: true, observacoes: ehVazio ? null : sanitizado });
}
