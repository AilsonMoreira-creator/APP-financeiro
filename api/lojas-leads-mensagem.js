/**
 * lojas-leads-mensagem.js — Mensagem WhatsApp pra leads de carrinho
 *
 * 2 actions:
 *
 * 1) POST { action: 'gerar', lead_id }
 *    → Gera sugestão de mensagem via Claude Sonnet, tom B2B atacado,
 *      mencionando peças específicas do carrinho.
 *    → Retorna { mensagem }
 *
 * 2) POST { action: 'marcar_enviada', lead_id, texto, telefone_wa }
 *    → Marca lead como mensagem_enviada
 *    → Insere em lojas_lead_mensagens (histórico)
 *    → Valida limite diário (1 PJ + 2 PF por vendedora)
 *    → Retorna ok + url do wa.me pronta pra abrir
 *
 * Sessão Ailson 12/05/2026 — Onda 3 (IA + envio).
 */
import { supabase, validarUsuario, setCors } from './_lojas-helpers.js';

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL = 'claude-sonnet-4-5-20250929';

const LIMITE_PJ_DIA = 1;
const LIMITE_PF_DIA = 1;

// ═══════════════════════════════════════════════════════════════════
// PROMPT — Mensagem pra LEAD de carrinho abandonado (B2B atacado)
// Refinado Ailson 13/05/2026 — herda regras do prompt cliente
// ═══════════════════════════════════════════════════════════════════
const SYSTEM_PROMPT_LEAD_CARRINHO = `Você é uma assistente de vendas da Amícia — confecção de moda feminina ATACADO em São Paulo (Brás + Bom Retiro).

Sua tarefa: gerar UMA mensagem curta de WhatsApp pra contatar uma LEAD que abandonou carrinho no site amicialoja.com.br.

# CONTEXTO IMPORTANTE
- O CLIENTE É DONO(A) DE LOJA que compra pra REVENDER (NUNCA usa a peça).
- A Amícia vende ATACADO. Pedido mínimo 12 peças.
- O cliente VIU as peças NO SITE AMICIALOJA.COM.BR e SAIU sem finalizar.
- Vendedora vai mandar essa mensagem pessoalmente via WhatsApp.

# 🌐 SEMPRE DEIXAR CLARO QUE FOI NO SITE — REGRA CRÍTICA
A lead pode não lembrar onde montou o carrinho (Whats? Loja? Insta?).
SEMPRE no INÍCIO da mensagem deixe claro que foi no SITE DA AMÍCIA.

Frases tipo:
- "vi q vc tava montando um pedido no nosso site..."
- "vi seu carrinho lá no site da Amícia..."
- "vc deu uma olhada no nosso site (amicialoja) e..."
- "passei aqui pq vi vc no site da Amícia escolhendo..."

NUNCA começar com:
- "vi q vc tava montando um pedido aqui..." (aqui = onde? confunde)
- "seu carrinho ficou parado..." (sem dizer onde)
- "vi q vc separou umas pecinhas..." (onde?)

# ✅ SAUDAÇÕES PERMITIDAS (variar entre mensagens — não usar sempre a mesma)
- "Oie [nome]"
- "Oii [nome]"
- "E aí [nome]"
- "Oi [nome], td bem?"
- "Bom dia [nome]" / "Boa tarde [nome]" (se fizer sentido pelo horário)

# ❌ SAUDAÇÕES PROIBIDAS
- "Olá [nome]" (formal demais)
- "Prezada cliente"
- "Tudo bem por aí?" como abertura solta
- "Acabei de ver" (não tem como confirmar isso)

Use só o PRIMEIRO NOME. NUNCA o nome completo nem a razão social inteira.

# ✍️ PONTUAÇÃO VARIADA — REGRA CRÍTICA
Vendedora real NÃO escreve com ponto final em toda frase. Distribuição alvo:
- **40% sem nada** (frase corta no fim): "Chegou aqui um body lindo"
- **30% com "..."** (sugere pausa de fala): "Tá saindo muito essa semana..."
- **30% com ponto final**: "Tem na cor preta também."

NUNCA terminar TODAS as frases da mensagem com ponto. Mistura a cada mensagem. Pode usar "!!" pontualmente, sem exagero.

# 📝 ABREVIAÇÕES OBRIGATÓRIAS (tom de WhatsApp natural)
  ❌ "tudo bem"     → ✅ "td bem"
  ❌ "tudo bom"     → ✅ "td bem"
  ❌ "você"         → ✅ "vc"
  ❌ "também"       → ✅ "tb"
  ❌ "porque"       → ✅ "pq"
  ❌ "para"         → ✅ "pra"
  ❌ "está"         → ✅ "tá"
  ❌ "estão"        → ✅ "tão"

# REGRAS DE TOM
- SEMPRE "vc" — NUNCA "você" ou "tu"
- PT-BR informal, direto
- 1 emoji no MÁXIMO (pode não usar nenhum)
- 2-4 linhas no total
- Mencionar peça(s) específica(s) do carrinho com cor: "vi q vc tava de olho no vestido couro caramelo..."
- Reconhecer interesse sem inventar: "achei q valia te chamar..."
- Linguagem de revendedor: "peça que sai bem", "modelo que vende muito", "venda fácil"
- NUNCA: "linda", "fica perfeita em você", "te valoriza" — cliente é lojista, NÃO usa a peça
- NUNCA inventar % ou estatísticas. Pode dizer "a maioria das lojistas" se relevante

# CTA (chamada pra ação) — varia
- Oferecer ajuda pra finalizar pedido pelo Whats
- Tirar dúvida sobre frete/prazo
- Ajudar a completar 12 peças (mínimo atacado)
- Pergunta aberta no fim, MAS NEM TODA mensagem precisa terminar em pergunta — pode fechar em afirmação relaxada

# 🌟 CLIENTE JÁ CADASTRADA (eh_cliente_existente === true)
Tom MAIS ÍNTIMO — ela já comprou antes, vc conhece. Pode:
- Tratar como conhecida ("oi sumida", "que saudade")
- Mencionar peças do carrinho normalmente
- Oferecer DUAS opções pra fechar:
  1. Finalizar pelo Whats com a vendedora direto
  2. **Conseguir um CUPOM DE DESCONTO** pra ela voltar e fechar no site

Exemplo de CTA pra cliente cadastrada:
- "se quiser eu fecho aqui pelo zap, ou consigo um cupom de desconto pra vc fechar lá no site mesmo"
- "te dou duas opções: termina aqui comigo ou eu solto um cupom pra vc no site"

Cliente cadastrada NÃO precisa de explicação sobre mínimo de 12 peças — ela já sabe.

# EVITAR
- "Olá querida" (não é cliente final)
- "Acabei de ver" (não dá pra confirmar)
- "Posso te ajudar a escolher" (lojista escolhe o que vende, não o que serve)
- "X% das clientes" (nunca inventar números)
- Mais de 1 emoji
- Mais de 4 linhas
- Todas as frases terminando em ponto

# OUTPUT
APENAS a mensagem final, sem aspas, sem prefixos tipo "Olha aí:" nem explicações. SÓ a mensagem pronta pra enviar.`;

// ═══════════════════════════════════════════════════════════════════
// HELPER: chama Claude
// ═══════════════════════════════════════════════════════════════════
async function chamarClaude(systemPrompt, userPayload) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY não configurada');

  const r = await fetch(CLAUDE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 400,
      system: systemPrompt,
      messages: [{ role: 'user', content: JSON.stringify(userPayload) }],
    }),
  });

  const data = await r.json();
  if (!r.ok) throw new Error(data.error?.message || `Claude HTTP ${r.status}`);
  return data.content?.[0]?.text?.trim() || '';
}

// ═══════════════════════════════════════════════════════════════════
// HANDLER
// ═══════════════════════════════════════════════════════════════════
export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });

  const auth = await validarUsuario(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const { action, lead_id } = req.body || {};
  if (!action || !lead_id) return res.status(400).json({ error: 'action e lead_id obrigatórios' });

  try {
    // ─── Carrega lead completo com último evento ────────────────
    const { data: lead, error: errLead } = await supabase
      .from('lojas_leads_carrinho')
      .select(`
        id, convertr_customer_id, nome_completo, first_name, last_name,
        telefone_raw, telefone_norm, taxvat_norm, tipo_pessoa, razao_social,
        uf_inferida, status, qtd_pecas_ultimo_carrinho, valor_ultimo_carrinho,
        observacoes_ia, ja_e_cliente_lojas_id, vendedora_atribuida_id
      `)
      .eq('id', lead_id)
      .maybeSingle();

    if (errLead || !lead) return res.status(404).json({ error: 'Lead não encontrado' });

    // ═══════════════════════════════════════════════════════════════════
    // ACTION 1: gerar
    // ═══════════════════════════════════════════════════════════════════
    if (action === 'gerar') {
      // Carrega último evento (peças do carrinho)
      const { data: evento } = await supabase
        .from('lojas_lead_carrinho_eventos')
        .select('items_parsed, items_count, total, created_at_convertr')
        .eq('lead_id', lead_id)
        .gt('total', 0)
        .order('created_at_convertr', { ascending: false })
        .limit(1)
        .maybeSingle();

      const items = evento?.items_parsed || [];

      // Monta lista resumida de peças (descricao da REF inferida + cor)
      const pecas = items.map(it => ({
        descricao: it.ref_descricao || it.tipo_inferido || 'peça',
        cor: it.cor_inferida || null,
        ref: it.ref || null,
      }));

      // Nome amigável: 1º nome (PF) ou razão social (PJ)
      let nomeAmigavel = '';
      if (lead.tipo_pessoa === 'PJ' && lead.razao_social) {
        nomeAmigavel = lead.razao_social.split(' ').slice(0, 2).join(' ');
      } else if (lead.first_name) {
        nomeAmigavel = lead.first_name.split(' ')[0];
      }

      const userPayload = {
        nome: nomeAmigavel || null,
        tipo: lead.tipo_pessoa,
        razao_social: lead.razao_social || null,
        uf: lead.uf_inferida || null,
        peças_no_carrinho: pecas,
        qtd_peças: lead.qtd_pecas_ultimo_carrinho,
        valor_carrinho: lead.valor_ultimo_carrinho,
        eh_cliente_existente: !!lead.ja_e_cliente_lojas_id,
      };

      const mensagem = await chamarClaude(SYSTEM_PROMPT_LEAD_CARRINHO, userPayload);

      return res.json({
        ok: true,
        mensagem,
        contexto: userPayload,
      });
    }

    // ═══════════════════════════════════════════════════════════════════
    // ACTION 2: marcar_enviada
    // ═══════════════════════════════════════════════════════════════════
    if (action === 'marcar_enviada') {
      const { texto } = req.body || {};
      if (!texto || !texto.trim()) {
        return res.status(400).json({ error: 'Texto da mensagem obrigatório' });
      }
      if (!auth.vendedoraId) {
        return res.status(403).json({ error: 'Apenas vendedoras podem enviar (admin não envia em nome de ninguém)' });
      }

      // ─── Valida limite diário pelo tipo do lead ────────────────
      const { data: envios } = await supabase
        .rpc('envios_hoje_da_vendedora', { p_vendedora_id: auth.vendedoraId })
        .maybeSingle();
      const enviosPj = envios?.qtd_pj_hoje || 0;
      const enviosPf = envios?.qtd_pf_hoje || 0;

      if (lead.tipo_pessoa === 'PJ' && enviosPj >= LIMITE_PJ_DIA) {
        return res.status(429).json({
          error: `Você já enviou ${enviosPj} CNPJ hoje (limite ${LIMITE_PJ_DIA}/dia). Tenta amanhã!`,
          limite_atingido: 'PJ',
        });
      }
      if (lead.tipo_pessoa === 'PF' && enviosPf >= LIMITE_PF_DIA) {
        return res.status(429).json({
          error: `Você já enviou ${enviosPf} CPF hoje (limite ${LIMITE_PF_DIA}/dia). Tenta amanhã!`,
          limite_atingido: 'PF',
        });
      }

      const agora = new Date().toISOString();

      // ─── Registra mensagem no histórico ─────────────────────────
      const { error: errMsg } = await supabase
        .from('lojas_lead_mensagens')
        .insert({
          lead_id,
          vendedora_id: auth.vendedoraId,
          texto: texto.trim(),
          modo: 'whatsapp',
        });
      if (errMsg) {
        console.error('[lojas-leads-mensagem] erro insert msg:', errMsg);
        return res.status(500).json({ error: 'Erro ao registrar mensagem' });
      }

      // ─── Atualiza lead ──────────────────────────────────────────
      // Libera lock também (vendedora terminou o atendimento — outras
      // vendedoras podem ver/seguir o follow-up sem lock travando).
      const { error: errUpd } = await supabase
        .from('lojas_leads_carrinho')
        .update({
          status: 'mensagem_enviada',
          ultima_msg_enviada_em: agora,
          ultima_msg_vendedora_id: auth.vendedoraId,
          vendedora_atendendo_id: null,
          lock_expira_em: null,
          atualizado_em: agora,
        })
        .eq('id', lead_id);
      if (errUpd) {
        console.error('[lojas-leads-mensagem] erro update lead:', errUpd);
        return res.status(500).json({ error: 'Erro ao atualizar lead' });
      }

      // ─── Monta URL wa.me ────────────────────────────────────────
      const telNorm = (lead.telefone_norm || lead.telefone_raw || '').replace(/\D/g, '');
      let telWa = null;
      if (telNorm.length === 10 || telNorm.length === 11) telWa = '55' + telNorm;
      else if ((telNorm.length === 12 || telNorm.length === 13) && telNorm.startsWith('55')) telWa = telNorm;

      const waMeUrl = telWa
        ? `https://wa.me/${telWa}?text=${encodeURIComponent(texto.trim())}`
        : null;

      return res.json({
        ok: true,
        mensagem: 'Mensagem registrada como enviada',
        wa_me_url: waMeUrl,
        envios_atualizados: {
          qtd_pj_hoje: lead.tipo_pessoa === 'PJ' ? enviosPj + 1 : enviosPj,
          qtd_pf_hoje: lead.tipo_pessoa === 'PF' ? enviosPf + 1 : enviosPf,
        },
      });
    }

    return res.status(400).json({ error: `Action desconhecida: ${action}` });
  } catch (e) {
    console.error('[lojas-leads-mensagem] exception:', e);
    return res.status(500).json({ error: e.message || 'Erro interno' });
  }
}
