// ═══════════════════════════════════════════════════════════════════════════
// _lojas-whats-ciclo24.js — RELÓGIO DA JANELA 24H + GANCHO DA SOFIA
// ═══════════════════════════════════════════════════════════════════════════
// Ailson 02/07/2026. A janela de resposta do WhatsApp (Meta) dura 24h a partir
// da ÚLTIMA mensagem da cliente. Se fechar sem contato, só template pago.
//
// FASE A — RELÓGIO (1x por conversa, NUNCA reacende):
//   Conversa em 'conversando', cliente engajada (2+ mensagens enviadas, não só
//   a resposta única à abertura), faltando <= 4h pra janela fechar (último
//   inbound + 20h) → seta ciclo24_vence_em = último inbound + 24h.
//   O card ganha relógio vermelho com countdown e sobe na lista (abaixo só
//   das prioridades ⭐). Se a cliente responder depois, o relógio some
//   (atividade posterior ao acender esconde no front) e NÃO volta.
//
// FASE B — GANCHO (1x por conversa):
//   Com o relógio aceso e a janela ainda aberta, a Sofia gera UMA mensagem
//   leve de gancho (contexto da conversa, sem saudação formal) — mesmo que a
//   última mensagem seja da cliente (ex: "obrigado", que normalmente não
//   respondemos) ou nossa.
//   Janela BRT:  seg-sex 8:00–16:30  → sugestão pendente pra assistente
//                seg-sex 16:31–20:00 → gera e ENVIA sozinha
//                sáb     9:00–13:00  → sugestão pendente
//                fora disso          → segura pra próxima janela (se a de 24h
//                                      ainda estiver aberta quando chegar lá)
//   Travas: se houve QUALQUER atividade depois do relógio acender (cliente
//   respondeu ou já mandamos algo) o gancho é consumido sem enviar; se a
//   última mensagem NOSSA saiu há menos de 6h, segura (muito perto pra cutucar).
//   Gancho pendente >30min cai no resgate normal (envia sozinho, já existe).
//
// Chamado pelo cron-responder (1x/min). SELECTs baratos; Claude só quando
// existe candidata dentro da janela.
// ═══════════════════════════════════════════════════════════════════════════

import { supabase, log, logErro, limparEstiloSofia, primeiroNome } from './_lojas-whats-helpers.js';
import { chamarClaude } from './_lojas-helpers.js';
import { processarUma } from './lojas-whats-aprovar.js';

const MODELO_GANCHO = 'claude-sonnet-4-6';
const H = 3600 * 1000;
const RELOGIO_ANTES_MS = 4 * H;    // relógio acende faltando 4h pro fim da janela
const JANELA_META_MS = 24 * H;     // janela de resposta da Meta
const TRAVA_SAIDA_MS = 6 * H;      // não cutuca se já mandamos algo há < 6h
const MAX_RELOGIOS_POR_RUN = 40;
const MAX_GANCHOS_POR_RUN = 4;     // Claude sequencial, não estoura maxDuration

// ── Janela BRT do gancho: 'aprovacao' | 'auto' | null ──
export function janelaGancho(d = new Date()) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit',
    hour12: false, weekday: 'short',
  }).formatToParts(d);
  const get = t => p.find(x => x.type === t)?.value || '';
  const dia = get('weekday');                       // Mon..Sun
  const m = parseInt(get('hour'), 10) * 60 + parseInt(get('minute'), 10);
  if (dia === 'Sun') return null;
  if (dia === 'Sat') return (m >= 540 && m <= 780) ? 'aprovacao' : null;   // 9:00–13:00
  if (m >= 480 && m <= 990) return 'aprovacao';                            // 8:00–16:30
  if (m >= 991 && m <= 1200) return 'auto';                                // 16:31–20:00
  return null;
}

// ── FASE A: acender relógios ──
async function acenderRelogios(out) {
  const agora = Date.now();
  // Filtro barato: atividade nas últimas 30h (relógio só faz sentido entre
  // 20h e 24h do último inbound; folga cobre conversa com saída nossa depois).
  const { data: cands, error } = await supabase
    .from('lojas_whats_conversas')
    .select('id, ultima_atividade_em')
    .eq('etapa', 'conversando')
    .is('ciclo24_vence_em', null)
    .gte('ultima_atividade_em', new Date(agora - 30 * H).toISOString())
    .limit(MAX_RELOGIOS_POR_RUN);
  if (error) throw error;

  for (const c of (cands || [])) {
    try {
      // 2+ mensagens da cliente = engajou de verdade (não só respondeu a abertura 1x)
      const { data: inb } = await supabase
        .from('lojas_whats_mensagens')
        .select('enviada_em')
        .eq('conversa_id', c.id)
        .eq('direcao', 'entrada')
        .order('enviada_em', { ascending: false })
        .limit(2);
      if (!inb || inb.length < 2) continue;

      const ultimoInbound = new Date(inb[0].enviada_em).getTime();
      if (agora < ultimoInbound + (JANELA_META_MS - RELOGIO_ANTES_MS)) continue; // ainda não chegou nas 20h

      // Acende (mesmo se já venceu — marca pra nunca reescanear; front esconde vencido)
      const { error: eUp } = await supabase
        .from('lojas_whats_conversas')
        .update({ ciclo24_vence_em: new Date(ultimoInbound + JANELA_META_MS).toISOString() })
        .eq('id', c.id)
        .is('ciclo24_vence_em', null);   // idempotência entre runs sobrepostos
      if (eUp) throw eUp;
      out.relogios++;
    } catch (e) {
      out.erros++;
      logErro('ciclo24/relogio', e);
    }
  }
}

// ── Prompt do gancho ──
function montarPromptGancho(conv, historico) {
  const nome = primeiroNome(conv.nome_cliente) || '';
  const historicoFmt = (historico || []).length === 0
    ? '(sem histórico)'
    : historico.map(m => {
        const quem = m.direcao === 'entrada' ? (nome || 'CLIENTE') : (m.autor === 'sofia_ia' ? 'SOFIA' : 'NOS');
        const conteudo = m.tipo_midia && m.tipo_midia !== 'text'
          ? `[${m.tipo_midia.toUpperCase()}]${m.texto ? ' ' + m.texto : ''}`
          : (m.texto || '');
        return `${quem}: ${conteudo}`;
      }).join('\n');

  const temCarrinho = Number(conv.valor_carrinho) > 0 || Number(conv.qtd_pecas) > 0;
  const carrinhoInfo = temCarrinho
    ? `Cliente TEM carrinho abandonado (${conv.qtd_pecas || '?'} peças, R$${Number(conv.valor_carrinho || 0).toFixed(2)}) — ou seja, com certeza é lojista.`
    : 'Cliente NÃO tem carrinho no site.';
  const catalogoInfo = conv.catalogo_enviado_em
    ? 'Ela JÁ recebeu nosso catálogo nesta conversa.'
    : 'Ela ainda NÃO recebeu catálogo nesta conversa.';
  const obs = conv.observacao_para_sofia
    ? `Observação interna: "${String(conv.observacao_para_sofia).slice(0, 200)}"`
    : '';

  const system = `Você é Sofia, vendedora da Amícia (moda feminina atacado SP — Bom Retiro + Brás, foco em linho e alfaiataria diferenciada).

A janela de resposta do WhatsApp desta cliente está pra FECHAR e a conversa parou. TAREFA: gerar UMA mensagem curta de GANCHO (1-2 linhas, máx 200 caracteres), só pra manter o contato vivo. Leve, natural, sem parecer cobrança nem pressão de venda.

ESCOLHA O GANCHO PELO CONTEXTO (o que encaixar melhor na conversa):
- Se a CIDADE dela NÃO apareceu na conversa: pergunte de qual cidade ela é, dizendo que vai ver quanto fica o frete em média. Ex: "Oi ${nome || 'Fulana'}, de qual cidade vc é? Vou ver aqui qto fica o frete em média"
- Se ela recebeu catálogo de PROMOÇÃO/desconto: comente que o desconto tá uma super oportunidade (aqui pode 1 emoji simples)
- Se ela NÃO tem carrinho: pergunte de um jeito natural se ela tem loja física ou vende online (ajuda a indicar o que mais gira)
- Senão: um gancho leve amarrado a algo CONCRETO que ela mencionou

REGRAS DE OURO:
- NUNCA comece com "bom dia", "boa tarde", "tudo bem". Pode ser "Oi ${nome || 'Fulana'}," ou direto no assunto
- Use "vc" (jamais "você", "senhora", "amiga")
- NÃO use "incrível", "imperdível", "sensacional"
- NÃO use emoji 💛 nem travessão (—)
- Máximo 1 emoji simples, e só no caso do desconto/promoção
- NÃO ofereça desconto novo, NÃO prometa prazo, NÃO invente informação
- Não repita gancho que já foi usado na conversa (se já perguntamos a cidade, não pergunta de novo)

CONTEXTO:
${carrinhoInfo}
${catalogoInfo}
${obs}

HISTÓRICO DA CONVERSA (do mais antigo pro mais recente):
${historicoFmt}

Responda APENAS com o texto da mensagem. Nada antes, nada depois.`;
  return system;
}

// ── FASE B: gerar/enviar ganchos ──
async function gerarGanchos(out) {
  const janela = janelaGancho();
  out.janela = janela || 'fora';
  if (!janela) return;   // fora da janela: relógios seguem acesos, gancho segura

  const agoraIso = new Date().toISOString();
  const { data: cands, error } = await supabase
    .from('lojas_whats_conversas')
    .select('id, telefone, nome_cliente, valor_carrinho, qtd_pecas, catalogo_enviado_em, observacao_para_sofia, ciclo24_vence_em, ultima_atividade_em')
    .eq('etapa', 'conversando')
    .is('ciclo24_gancho_em', null)
    .not('ciclo24_vence_em', 'is', null)
    .gt('ciclo24_vence_em', agoraIso)         // janela de 24h ainda aberta
    .order('ciclo24_vence_em', { ascending: true })
    .limit(MAX_GANCHOS_POR_RUN);
  if (error) throw error;

  for (const c of (cands || [])) {
    try {
      const venceMs = new Date(c.ciclo24_vence_em).getTime();
      const acendeuMs = venceMs - RELOGIO_ANTES_MS;

      // Atividade DEPOIS do relógio acender (cliente respondeu ou já mandamos
      // algo) = contato feito / fluxo normal assumiu → consome sem enviar.
      if (new Date(c.ultima_atividade_em).getTime() > acendeuMs) {
        await supabase.from('lojas_whats_conversas')
          .update({ ciclo24_gancho_em: new Date().toISOString() })
          .eq('id', c.id).is('ciclo24_gancho_em', null);
        out.consumidos++;
        continue;
      }

      // Sugestão pendente? Resgate cuida dela — segura o gancho.
      const { count: pend } = await supabase
        .from('lojas_whats_sugestoes')
        .select('*', { count: 'exact', head: true })
        .eq('conversa_id', c.id).eq('status', 'pendente');
      if (pend > 0) { out.segurados++; continue; }

      // Trava 6h: última mensagem NOSSA (qualquer autor) há menos de 6h → segura.
      const { data: ultSaida } = await supabase
        .from('lojas_whats_mensagens')
        .select('enviada_em')
        .eq('conversa_id', c.id).eq('direcao', 'saida')
        .order('enviada_em', { ascending: false })
        .limit(1);
      if (ultSaida?.[0] && Date.now() - new Date(ultSaida[0].enviada_em).getTime() < TRAVA_SAIDA_MS) {
        out.segurados++;
        continue;
      }

      // Histórico pro prompt
      const { data: hist } = await supabase
        .from('lojas_whats_mensagens')
        .select('direcao, autor, texto, tipo_midia, audio_transcricao, enviada_em')
        .eq('conversa_id', c.id)
        .order('enviada_em', { ascending: false })
        .limit(15);
      const historico = (hist || []).reverse()
        .map(m => ({ ...m, texto: m.audio_transcricao || m.texto }));

      const cl = await chamarClaude({
        modelo: MODELO_GANCHO,
        systemBlocks: [{ type: 'text', text: montarPromptGancho(c, historico) }],
        messages: [{ role: 'user', content: 'gere a mensagem de gancho agora' }],
        max_tokens: 200,
        temperature: 0.7,
        timeoutMs: 25000,
      });
      if (!cl.ok) { out.erros++; logErro('ciclo24/claude', cl.erro); continue; }
      const texto = limparEstiloSofia((cl.texto || '').trim());
      if (!texto) { out.erros++; continue; }

      const { data: sugIns, error: eIns } = await supabase
        .from('lojas_whats_sugestoes')
        .insert({
          conversa_id: c.id,
          tipo: 'gancho_ciclo24',
          texto_proposto: texto,
          status: 'pendente',
          contexto_ia: { janela, ciclo24_vence_em: c.ciclo24_vence_em },
        })
        .select('id')
        .single();
      if (eIns) { out.erros++; logErro('ciclo24/insert-sugestao', eIns); continue; }

      // Marca o gancho como usado (1x por conversa) ANTES de tentar enviar —
      // se o envio falhar, a sugestão fica pendente e o resgate/assistente resolve.
      await supabase.from('lojas_whats_conversas')
        .update({ ciclo24_gancho_em: new Date().toISOString() })
        .eq('id', c.id);

      if (janela === 'auto') {
        try {
          await processarUma(sugIns.id, 'aprovar', null, 'sofia_gancho_auto');
          out.auto_enviados++;
        } catch (eAuto) {
          out.erros++;
          logErro('ciclo24/auto-envio', eAuto);
          // sugestão segue pendente → resgate ou assistente pega
        }
      } else {
        out.pendentes++;
      }
    } catch (e) {
      out.erros++;
      logErro('ciclo24/gancho', e);
    }
  }
}

export async function rodarCiclo24() {
  const out = { relogios: 0, pendentes: 0, auto_enviados: 0, consumidos: 0, segurados: 0, erros: 0, janela: null };
  await acenderRelogios(out);
  await gerarGanchos(out);
  if (out.relogios || out.pendentes || out.auto_enviados || out.consumidos || out.erros) {
    log('ciclo24', `relogios=${out.relogios} pendentes=${out.pendentes} auto=${out.auto_enviados} consumidos=${out.consumidos} segurados=${out.segurados} erros=${out.erros} janela=${out.janela}`);
  }
  return out;
}
