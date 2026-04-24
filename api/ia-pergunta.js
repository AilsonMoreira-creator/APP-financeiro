/**
 * ia-pergunta.js — Endpoint principal do módulo "Perguntar à IA" (Sprint 8)
 * ════════════════════════════════════════════════════════════════════════
 *
 * POST /api/ia-pergunta
 *
 * Body:
 *   {
 *     pergunta: string,      // texto livre do user
 *     user_id: number,       // id numérico (Date.now do cadastro)
 *     user_name?: string     // nome (opcional, pra log; busca na tabela se ausente)
 *   }
 *
 * Resposta (200):
 *   {
 *     ok: true,
 *     resposta_texto: string,
 *     categoria: 'estoque'|'producao'|'produto'|'ficha'|'outros',
 *     ref_detectada: string|null,
 *     matriz_render: object|null,   // presente quando há matriz de corte
 *     r_bloqueado: boolean,         // true se filtrou R$
 *     tempo_ms: number,
 *     tokens: { in, out }
 *   }
 *
 * Resposta (429 — limite estourado):
 *   { ok: false, limite_estourado: true, usado: 15, limite: 15 }
 *
 * Resposta (403 — orçamento esgotado):
 *   { ok: false, orcamento_esgotado: true, gasto_brl: 76, limite_brl: 80 }
 *
 * Fluxo:
 *   1. Resolve user por user_id → descobre se é admin
 *   2. Rate limit (só não-admin entra no pool de 15/dia)
 *   3. Hard-stop de orçamento Anthropic (se gasto_mes >= 95% do teto)
 *   4. Classificador de intenção (keywords)
 *   5. Carrega contexto do domínio (estoque/producao/produto/ficha)
 *   6. Se não-admin: filtra campos R$ antes de mandar pra IA
 *   7. Chama Sonnet 4.6 pedindo JSON estruturado
 *   8. Parse da resposta + salva histórico
 *   9. Retorna pro frontend
 * ════════════════════════════════════════════════════════════════════════
 */

import { setCors, calcularCustoBRL, gastoMesAtual, getConfig, supabase } from './_ia-helpers.js';
import {
  resolverUsuario,
  checarRateLimit,
  classificarIntencao,
  contextoEstoque,
  contextoProducao,
  contextoProduto,
  contextoFichaTecnica,
  montarPromptSistema,
  salvarHistorico,
  filtrarMonetarios,
  primeiraPerguntaDoDia,
  saudacaoBRT,
  nomeExibicao,
} from './_ia-pergunta-helpers.js';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODELO = 'claude-sonnet-4-6';
const MAX_TOKENS = 800;
const TEMPERATURA = 0.3;


export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });

  const t0 = Date.now();
  const { pergunta, user_id } = req.body || {};

  if (!pergunta || !String(pergunta).trim()) {
    return res.status(400).json({ ok: false, error: 'Pergunta vazia' });
  }
  if (!user_id) {
    return res.status(400).json({ ok: false, error: 'user_id ausente' });
  }

  // 1 — Resolver usuário
  const u = await resolverUsuario(user_id);
  if (!u.ok) return res.status(u.status).json({ ok: false, error: u.error });
  const { user } = u;

  // 2 — Rate limit (só pra não-admin)
  const rl = await checarRateLimit(user.admin);
  if (!rl.ok) {
    return res.status(429).json({
      ok: false,
      limite_estourado: true,
      usado: rl.usado,
      limite: rl.limite,
    });
  }

  // 3 — Hard-stop de orçamento
  const gastoMes = await gastoMesAtual();
  const orcamento = Number(await getConfig('orcamento_brl_mensal', 80));
  const hardStopPct = Number(await getConfig('ia_pergunta_hardstop_pct', 95));
  if (gastoMes >= orcamento * (hardStopPct / 100)) {
    return res.status(403).json({
      ok: false,
      orcamento_esgotado: true,
      gasto_brl: gastoMes.toFixed(2),
      limite_brl: orcamento,
      hard_stop_pct: hardStopPct,
    });
  }

  // 4 — Classifica intenção
  const intent = classificarIntencao(pergunta);
  const refFoco = intent.refs[0] || null; // primeira REF mencionada (se alguma)

  // 5 — Carrega contexto do(s) domínio(s)
  let contexto = {};
  let rBloqueado = false;

  try {
    if (intent.categoria === 'estoque') {
      contexto = { estoque: await contextoEstoque(refFoco) };
    } else if (intent.categoria === 'producao') {
      contexto = { producao: await contextoProducao(refFoco) };
    } else if (intent.categoria === 'produto') {
      const ctx = await contextoProduto(refFoco, user.admin);
      contexto = { produto: ctx };
      // marca que filtrou se user não é admin (pro log)
      if (!user.admin) rBloqueado = true;
    } else if (intent.categoria === 'ficha') {
      // Ficha técnica: TODOS veem custo + valores (regra especial)
      const termo = refFoco || extrairTermoBusca(pergunta);
      contexto = { ficha: await contextoFichaTecnica(termo) };
    } else {
      // 'outros' — ambiguidade. Puxa resumão leve dos 3 domínios operacionais
      const [est, prod, pv] = await Promise.all([
        contextoEstoque(refFoco),
        contextoProducao(refFoco),
        contextoProduto(refFoco, user.admin),
      ]);
      contexto = { estoque: est, producao: prod, produto: pv };
      if (!user.admin) rBloqueado = true;
    }
  } catch (e) {
    console.error('[ia-pergunta] erro carregando contexto:', e);
    return finalizarComErro(res, {
      user, pergunta, intent, refFoco, t0, erro: `Carregando contexto: ${e.message}`,
    });
  }

  // 6 — Monta prompt e chama Sonnet 4.6
  // Verifica se é primeira pergunta do dia desse user (pra incluir saudação)
  const primeiraDoDia = await primeiraPerguntaDoDia(user.id);
  const nomeUser = nomeExibicao(user.usuario);
  const saudacao = saudacaoBRT();

  const promptSistema = await buscarPromptSistema(user.admin, intent.categoria, {
    nomeUser, saudacao, primeiraDoDia,
  });

  let respostaIA = null;
  let tokensIn = 0, tokensOut = 0;

  try {
    const payload = {
      model: MODELO,
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURA,
      system: promptSistema,
      messages: [
        {
          role: 'user',
          content: `Pergunta do usuário: "${pergunta}"

Contexto (use APENAS isso pra responder):
${JSON.stringify(contexto, null, 2)}

RESPONDA APENAS COM UM OBJETO JSON VÁLIDO, sem texto antes nem depois, sem markdown, sem \`\`\`json.
Estrutura obrigatória (só um campo):
{
  "resposta_texto": "sua resposta em linguagem natural seguindo a ESTRUTURA VISUAL DO TEXTO (1 frase + bullets)"
}`,
        },
      ],
    };

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!r.ok) {
      const errText = await r.text();
      throw new Error(`Anthropic ${r.status}: ${errText.slice(0, 200)}`);
    }

    const data = await r.json();
    tokensIn = data.usage?.input_tokens || 0;
    tokensOut = data.usage?.output_tokens || 0;

    const bruto = (data.content?.[0]?.text || '').trim();
    // Sonnet 4.6 pode retornar JSON puro ou com ```json wrapper — extrairJSON lida com ambos
    respostaIA = extrairJSON(bruto);
  } catch (e) {
    console.error('[ia-pergunta] erro Sonnet:', e);
    return finalizarComErro(res, {
      user, pergunta, intent, refFoco, t0,
      erro: `Chamada IA: ${e.message}`,
      tokensIn, tokensOut,
    });
  }

  if (!respostaIA || !respostaIA.resposta_texto) {
    return finalizarComErro(res, {
      user, pergunta, intent, refFoco, t0,
      erro: 'Resposta da IA vazia ou inválida',
      tokensIn, tokensOut,
    });
  }

  // 7 — Custo e salvamento
  const { custo_brl } = await calcularCustoBRL({
    modelo: MODELO,
    input_tokens: tokensIn,
    output_tokens: tokensOut,
  });

  const tempoMs = Date.now() - t0;

  // Se a pergunta é sobre produção com REF específica e temos matriz pronta
  // no contexto, injeta no response (backend já pré-calculou células via folhas × grade,
  // não depende do Sonnet pra não errar valores)
  let matrizRender = null;
  if (intent.categoria === 'producao' && refFoco && contexto.producao?.cortes_reais?.length > 0) {
    const primeiroCorte = contexto.producao.cortes_reais[0];
    matrizRender = primeiroCorte.matriz_render || null;
  }

  // foto_url do produto (extrai do contexto que ja foi populado pelos helpers)
  const fotoUrl =
    contexto.estoque?.ref_cadastrada?.foto_url ||
    contexto.estoque?.foto_url ||
    contexto.produto?.foto_url ||
    contexto.producao?.ref_cadastrada?.foto_url ||
    contexto.ficha_tecnica?.foto_url ||
    '';

  await salvarHistorico({
    user_id: user.id,
    user_name: user.usuario,
    user_is_admin: user.admin,
    pergunta,
    resposta: respostaIA.resposta_texto,
    categoria: intent.categoria,
    ref_detectada: refFoco,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    custo_brl,
    tempo_ms: tempoMs,
    r_bloqueado: rBloqueado,
  });

  return res.status(200).json({
    ok: true,
    resposta_texto: respostaIA.resposta_texto,
    matriz_render: matrizRender,
    foto_url: refFoco ? fotoUrl : '',
    categoria: intent.categoria,
    ref_detectada: refFoco,
    r_bloqueado: rBloqueado,
    tempo_ms: tempoMs,
    tokens: { in: tokensIn, out: tokensOut },
  });
}


// ═══════════════════════════════════════════════════════════════════════
// Helpers locais
// ═══════════════════════════════════════════════════════════════════════

/**
 * Busca o prompt de sistema. Se admin customizou glossário no painel,
 * usa o custom; senão usa o default.
 */
async function buscarPromptSistema(isAdmin, categoria, extras = {}) {
  const { data } = await supabase
    .from('amicia_data')
    .select('payload')
    .eq('user_id', 'ia-pergunta-config')
    .maybeSingle();

  const glossario = data?.payload?.config?.glossario_custom || null;
  return montarPromptSistema({
    isAdmin,
    categoria,
    glossarioCustom: glossario,
    nomeUser: extras.nomeUser || '',
    saudacao: extras.saudacao || '',
    primeiraDoDia: extras.primeiraDoDia || false,
  });
}


/**
 * Extrai um termo de busca livre da pergunta (descarta stopwords + números).
 * Usado quando o user pergunta ficha por descrição ("saia linho midi").
 */
function extrairTermoBusca(pergunta) {
  const STOP = new Set([
    'qual', 'quanto', 'valor', 'preço', 'preco', 'custo', 'da', 'do', 'de',
    'a', 'o', 'é', 'tem', 'na', 'no', 'pra', 'para', 'que', 'quer', 'seria',
  ]);
  return String(pergunta || '')
    .toLowerCase()
    .replace(/[?!.,;]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w))
    .join(' ')
    .trim();
}


/**
 * Tenta parsear JSON da resposta do Sonnet. Lida com 3 formatos comuns:
 *   1. JSON puro: {"resposta":...}
 *   2. Markdown block: ```json\n{...}\n```
 *   3. Texto antes/depois: "Aqui está: {...} espero ter ajudado"
 */
function extrairJSON(str) {
  if (!str) return null;

  // Tenta parse direto primeiro
  try { return JSON.parse(str); } catch {}

  // Remove wrapper markdown ```json ... ``` ou ``` ... ```
  let cleaned = str
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
  try { return JSON.parse(cleaned); } catch {}

  // Fallback: extrai do primeiro { até o último } balanceado
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;

  const candidate = cleaned.slice(start, end + 1);
  try { return JSON.parse(candidate); } catch {}
  return null;
}


/**
 * Finaliza com erro — ainda salva no histórico pra ter audit trail.
 */
async function finalizarComErro(res, { user, pergunta, intent, refFoco, t0, erro, tokensIn = 0, tokensOut = 0 }) {
  const tempoMs = Date.now() - t0;
  await salvarHistorico({
    user_id: user.id,
    user_name: user.usuario,
    user_is_admin: user.admin,
    pergunta,
    resposta: null,
    categoria: intent?.categoria || 'outros',
    ref_detectada: refFoco,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    tempo_ms: tempoMs,
    erro,
  });

  return res.status(500).json({ ok: false, error: erro });
}
