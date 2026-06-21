// ============================================================================
// MELUNI — Treinar Lara.
// Banco de conhecimento PRÓPRIO da Lara (meluni_lara_conhecimento), separado
// do SAC do Mercado Livre. Ações:
//  - list      : lista o que já foi treinado
//  - salvar    : insere/edita uma pergunta+resposta
//  - excluir   : remove
//  - responder : "eu pergunto" -> a Lara responde com o que sabe (p/ aprovar/editar)
//  - gerar_quiz: "Lara pergunta" -> varre a base + conversas reais e acha lacunas,
//                gerando perguntas com 3 alternativas + categoria.
// Ailson 21/06/2026.
// ============================================================================
import { chamarClaude } from './_lojas-helpers.js';
import { supabase, cfgMeluni } from './_meluni-whats-helpers.js';
import { BASE_CONHECIMENTO } from './meluni-whats-ia.js';

const CATEGORIAS = ['produto', 'tamanho/medidas', 'tecido/cuidados', 'pagamento', 'frete/entrega', 'troca/devolução', 'site/pedido', 'outros'];

function stripFences(s = '') {
  return String(s).replace(/```json|```/g, '').trim();
}

// monta o conhecimento atual da Lara (base + políticas + já treinado)
async function baseLara() {
  const [politicas, { data: treinadas }] = await Promise.all([
    cfgMeluni('lara_politicas_loja', ''),
    supabase.from('meluni_lara_conhecimento').select('pergunta, resposta').eq('ativo', true).order('criado_em', { ascending: false }).limit(120),
  ]);
  const tre = (treinadas || []).map(r => `P: ${r.pergunta}\nR: ${r.resposta}`).join('\n') || '(ainda vazia)';
  return `${BASE_CONHECIMENTO}\n\nPOLÍTICAS DA LOJA:\n${politicas || '(sem políticas)'}\n\nBASE JÁ TREINADA:\n${tre}`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const acao = req.method === 'GET' ? (req.query?.acao || 'list') : (req.body?.acao || '');

  try {
    // ── LISTAR ──────────────────────────────────────────────────────────────
    if (acao === 'list') {
      const { data, error } = await supabase
        .from('meluni_lara_conhecimento')
        .select('id, pergunta, resposta, categoria, origem, criado_por, criado_em, ativo')
        .order('criado_em', { ascending: false })
        .limit(500);
      if (error) throw error;
      return res.status(200).json({ ok: true, itens: data || [] });
    }

    // ── SALVAR (insert ou update) ───────────────────────────────────────────
    if (acao === 'salvar') {
      const { id, pergunta, resposta, categoria, origem, criado_por } = req.body || {};
      const p = String(pergunta || '').trim();
      const r = String(resposta || '').trim();
      if (!p || !r) return res.status(400).json({ ok: false, erro: 'pergunta e resposta são obrigatórias' });
      const row = {
        pergunta: p, resposta: r,
        categoria: categoria ? String(categoria).slice(0, 60) : null,
        atualizado_em: new Date().toISOString(),
      };
      if (id) {
        const { data, error } = await supabase.from('meluni_lara_conhecimento').update(row).eq('id', id).select().maybeSingle();
        if (error) throw error;
        return res.status(200).json({ ok: true, item: data });
      }
      row.origem = origem || 'manual';
      row.criado_por = criado_por || null;
      const { data, error } = await supabase.from('meluni_lara_conhecimento').insert(row).select().maybeSingle();
      if (error) throw error;
      return res.status(200).json({ ok: true, item: data });
    }

    // ── EXCLUIR ─────────────────────────────────────────────────────────────
    if (acao === 'excluir') {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ ok: false, erro: 'id obrigatório' });
      const { error } = await supabase.from('meluni_lara_conhecimento').delete().eq('id', id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    // ── EU PERGUNTO → a Lara responde ───────────────────────────────────────
    if (acao === 'responder') {
      const pergunta = String(req.body?.pergunta || '').trim();
      if (!pergunta) return res.status(400).json({ ok: false, erro: 'pergunta obrigatória' });
      const base = await baseLara();
      const sys = `Você é a Lara, consultora B2C da Meluni (moda feminina, linho e peças elegantes e atemporais), atendendo no WhatsApp. Responda à pergunta do time USANDO SÓ a base abaixo. Resposta curta e no tom da Lara (fala "vc", próxima, sem travessão, sem "incrível/imperdível/sensacional"). Se a base NÃO cobrir a pergunta, responda exatamente: "(ainda não sei isso)". Nunca invente.\n\n${base}`;
      const cl = await chamarClaude({
        systemBlocks: [{ type: 'text', text: sys, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: pergunta }],
        max_tokens: 400, temperature: 0.4,
      });
      if (!cl.ok) return res.status(502).json({ ok: false, erro: cl.erro });
      return res.status(200).json({ ok: true, resposta: (cl.texto || '').trim() });
    }

    // ── LARA PERGUNTA (quiz de lacunas) ─────────────────────────────────────
    if (acao === 'gerar_quiz') {
      const n = Math.min(Math.max(Number(req.body?.qtd) || 5, 1), 8);
      const base = await baseLara();
      // conversas reais: mensagens recebidas de clientes (dúvidas reais)
      const { data: msgs } = await supabase
        .from('meluni_mensagens')
        .select('texto, audio_transcricao, criado_em')
        .eq('direcao', 'in')
        .order('criado_em', { ascending: false })
        .limit(150);
      const duvidas = (msgs || [])
        .map(m => (m.texto || m.audio_transcricao || '').trim())
        .filter(t => t.length > 8 && t.length < 280)
        .slice(0, 80);
      const blocoConversas = duvidas.length
        ? `\n\nPERGUNTAS REAIS DE CLIENTES (recentes, no WhatsApp da Meluni — use pra achar o que aparece muito e você ainda não tem resposta sólida):\n- ${duvidas.join('\n- ')}`
        : '';

      const sys = `Você é a Lara, consultora B2C da Meluni. Sua tarefa agora NÃO é atender cliente: é se autoavaliar e achar LACUNAS no seu conhecimento, pra o time te treinar.

Analise sua base de conhecimento atual e as perguntas reais de clientes. Identifique até ${n} perguntas que clientes fazem (ou podem fazer) e que você HOJE não conseguiria responder com segurança — ou que estão vagas/incompletas na base. Priorize o que apareceu nas conversas reais e o que é específico da Meluni (modelos, política, fluxo de compra/WhatsApp), não o óbvio que já está coberto.

Para cada lacuna, escreva a pergunta do ponto de vista da CLIENTE e 3 alternativas de resposta plausíveis e CURTAS (o time vai escolher a certa ou escrever outra). Categoria deve ser uma de: ${CATEGORIAS.join(', ')}.

Responda SÓ com um array JSON, sem texto fora dele, no formato:
[{"pergunta":"...","alternativas":["...","...","..."],"categoria":"..."}]

BASE ATUAL:
${base}${blocoConversas}`;

      const cl = await chamarClaude({
        systemBlocks: [{ type: 'text', text: sys, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: `Gere até ${n} perguntas de treinamento em JSON.` }],
        max_tokens: 1500, temperature: 0.6,
      });
      if (!cl.ok) return res.status(502).json({ ok: false, erro: cl.erro });
      let itens = [];
      try {
        const parsed = JSON.parse(stripFences(cl.texto));
        if (Array.isArray(parsed)) {
          itens = parsed
            .filter(x => x && x.pergunta)
            .map(x => ({
              pergunta: String(x.pergunta).trim(),
              alternativas: Array.isArray(x.alternativas) ? x.alternativas.map(a => String(a).trim()).filter(Boolean).slice(0, 3) : [],
              categoria: CATEGORIAS.includes(x.categoria) ? x.categoria : 'outros',
            }));
        }
      } catch {
        return res.status(502).json({ ok: false, erro: 'resposta da Lara não veio em JSON', raw: (cl.texto || '').slice(0, 400) });
      }
      return res.status(200).json({ ok: true, itens });
    }

    return res.status(400).json({ ok: false, erro: 'ação inválida' });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: String(e?.message || e) });
  }
}
