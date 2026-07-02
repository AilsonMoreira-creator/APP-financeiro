// ═══════════════════════════════════════════════════════════════════════════
// _lojas-whats-resgate.js — RESGATE DE SUGESTOES PARADAS (Ailson 01/07/2026)
// ═══════════════════════════════════════════════════════════════════════════
// Problema medido: quando o gate NAO classifica auto, a sugestao fica pendente
// pra Tamara e a latencia real de aprovacao e alta (mediana 29-88 min, p90 de
// 10 a 20 HORAS). Lead quente esfria esperando na fila.
//
// Regra (Ailson 01/07/2026):
//   - Sugestao de replica pendente ha MAIS DE 30 MIN sem ninguem aprovar
//   - Sofia reavalia a PROPRIA resposta com um classificador (Sonnet, temp 0)
//   - Se confianca >= 80 E o tema nao e delicado (desconto 10/15%, negociacao,
//     prazo prometido, reclamacao, pedido pago, pagamento em andamento),
//     ela envia SOZINHA como aprovada_por='sofia_resgate'
//   - LIMITE: maximo 2 resgates por conversa (depois disso, so humano —
//     evita conversa longa fora de controle)
//   - Resposta deve ser segura e direta; na duvida, fica pra Tamara
//
// Chamado pelo cron-responder (roda 1x/min; o SELECT aqui e barato e so
// chama o Claude quando existe candidata). Janela de envio: 8-20h BRT.
// Toggle: config sofia_resgate_ativa (default LIGADO).
//
// Auditoria: aprovada_por='sofia_resgate' em lojas_whats_sugestoes +
// contexto_ia.resgate com {avaliado_em, enviar, confianca, motivo} em TODAS
// as avaliadas (enviadas ou nao) — nunca reavalia a mesma sugestao 2x.
// ═══════════════════════════════════════════════════════════════════════════

import { supabase, log, logErro, getConfig } from './_lojas-whats-helpers.js';
import { chamarClaude } from './_lojas-helpers.js';
import { processarUma } from './lojas-whats-aprovar.js';

const MODELO_RESGATE = 'claude-sonnet-4-6';   // Haiku rejeitado pela API (ver _lojas-whats-handoff-ia.js)
const MIN_ESPERA_MIN = 30;                     // so resgata apos 30 min pendente
const MAX_IDADE_HORAS = 12;                    // pendente mais velha que isso: deixa pra humano
const MAX_RESGATES_POR_CONVERSA = 2;           // regra dura do Ailson
const MAX_POR_RUN = 4;                         // Claude sequencial, nao estoura o maxDuration
const CONFIANCA_MINIMA = 80;

// Etapas onde a Sofia ainda conduz a conversa. Fora disso (quente/atendida =
// vendedora no comando; aprovar = abertura HSM; vendeu/perdida = fechada)
// o resgate NAO se mete.
const ETAPAS_PERMITIDAS = ['conversando', 'esfriando', 'follow_up'];

function horaSP() {
  const p = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit',
    weekday: 'long', hour12: false,
  }).formatToParts(new Date());
  const get = t => p.find(x => x.type === t)?.value || '';
  return { hora: parseInt(get('hour'), 10), rotulo: `${get('weekday')}, ${get('hour')}:${get('minute')}` };
}

const SYSTEM_RESGATE = `Vc é auditor de qualidade do atendimento B2B da Amícia (atacado de moda feminina, foco em linho e alfaiataria). A Sofia (IA de atendimento) gerou uma resposta que está há mais de 30 minutos esperando aprovação humana, e a cliente segue sem retorno. Decida se é SEGURO enviar essa resposta agora, sem revisão humana.

Responda enviar=false se QUALQUER um for verdade:
- A resposta menciona desconto de 10% ou 15%, negocia preço ou abre condição especial
- A resposta promete prazo de entrega, reserva de peças ou compromisso logístico específico
- A conversa envolve reclamação, atrito, troca, devolução, pedido já pago ou pagamento em andamento
- A cliente mandou algo que a resposta NÃO responde (resposta desatualizada ou fora de contexto)
- A resposta cumprimenta com período errado do dia pra hora atual
- A resposta é longa demais, entra em assunto delicado ou assume algo que não está na conversa

Caso contrário, se a resposta é uma continuação simples, segura e direta (tira dúvida básica, oferece/envia catálogo, confirma informação padrão, mantém o bom atendimento), enviar=true.

Responda APENAS com JSON, sem markdown: {"enviar": true|false, "confianca": 0-100, "motivo": "curto"}`;

async function avaliarSugestao(sug, msgs) {
  const { rotulo } = horaSP();
  const historico = (msgs || [])
    .slice(0, 12)
    .reverse()
    .map(m => `${m.direcao === 'entrada' ? 'CLIENTE' : 'SOFIA'}: ${(m.audio_transcricao || m.texto || `[${m.tipo_midia || 'midia'}]`).slice(0, 300)}`)
    .join('\n');

  const cl = await chamarClaude({
    modelo: MODELO_RESGATE,
    systemBlocks: [{ type: 'text', text: SYSTEM_RESGATE }],
    messages: [{
      role: 'user',
      content: `Agora em São Paulo: ${rotulo}\n\nCONVERSA (mais antiga -> mais recente):\n${historico}\n\nRESPOSTA PENDENTE DA SOFIA (avalie esta):\n${sug.texto_proposto}`,
    }],
    max_tokens: 200,
    temperature: 0,
    timeoutMs: 25000,
  });
  if (!cl.ok) return { erro: cl.erro };

  try {
    const limpo = cl.texto.replace(/```json|```/g, '').trim();
    const j = JSON.parse(limpo);
    return {
      enviar: j.enviar === true,
      confianca: Number(j.confianca) || 0,
      motivo: String(j.motivo || '').slice(0, 200),
    };
  } catch {
    return { erro: `json_invalido: ${cl.texto.slice(0, 120)}` };
  }
}

async function marcarAvaliada(sug, resultado) {
  const contexto = { ...(sug.contexto_ia || {}), resgate: { avaliado_em: new Date().toISOString(), ...resultado } };
  const { error } = await supabase.from('lojas_whats_sugestoes')
    .update({ contexto_ia: contexto, atualizada_em: new Date().toISOString() })
    .eq('id', sug.id);
  if (error) logErro('resgate/marcar', error);
}

export async function rodarResgates() {
  const ativo = await getConfig('sofia_resgate_ativa', true);
  if (ativo === false) return { ativo: false };

  const { hora } = horaSP();
  if (hora < 8 || hora >= 20) return { ativo: true, fora_janela: true };

  const agora = Date.now();
  const limiteNovo = new Date(agora - MIN_ESPERA_MIN * 60 * 1000).toISOString();
  const limiteVelho = new Date(agora - MAX_IDADE_HORAS * 3600 * 1000).toISOString();

  // Candidatas: replica pendente, parada 30min-12h, nunca avaliada pelo resgate
  const { data: cands, error } = await supabase
    .from('lojas_whats_sugestoes')
    .select(`id, conversa_id, texto_proposto, criada_em, contexto_ia,
      conversa:lojas_whats_conversas (id, etapa, ultima_msg_direcao, sugestao_quente_pendente_em, auto_resposta_bloqueada)`)
    .eq('status', 'pendente')
    .eq('tipo', 'replica')
    .lte('criada_em', limiteNovo)
    .gte('criada_em', limiteVelho)
    .is('contexto_ia->resgate', null)
    .order('criada_em', { ascending: true })
    .limit(MAX_POR_RUN);
  if (error) { logErro('resgate/select', error); return { erro: error.message }; }
  if (!cands?.length) return { ativo: true, candidatas: 0 };

  let enviadas = 0, seguradas = 0, puladas = 0;
  const detalhe = [];

  for (const sug of cands) {
    const conv = sug.conversa;

    // Guards de conversa: fora do escopo da Sofia = nem avalia (marca pra nao voltar)
    if (!conv
        || !ETAPAS_PERMITIDAS.includes(conv.etapa)
        || conv.ultima_msg_direcao !== 'entrada'
        || conv.sugestao_quente_pendente_em      // decisao delicada pendente da Tamara
        || conv.auto_resposta_bloqueada) {       // recontato de pesquisa: sempre humano
      await marcarAvaliada(sug, { enviar: false, confianca: 0, motivo: 'fora_de_escopo_conversa' });
      puladas++;
      continue;
    }

    // Limite duro: 2 resgates por conversa
    const { count } = await supabase.from('lojas_whats_sugestoes')
      .select('id', { count: 'exact', head: true })
      .eq('conversa_id', sug.conversa_id)
      .eq('aprovada_por', 'sofia_resgate');
    if ((count || 0) >= MAX_RESGATES_POR_CONVERSA) {
      await marcarAvaliada(sug, { enviar: false, confianca: 0, motivo: 'limite_2_resgates_atingido' });
      puladas++;
      continue;
    }

    // Historico recente pra avaliacao
    const { data: msgs } = await supabase
      .from('lojas_whats_mensagens')
      .select('direcao, texto, audio_transcricao, tipo_midia, enviada_em')
      .eq('conversa_id', sug.conversa_id)
      .order('enviada_em', { ascending: false })
      .limit(12);

    const av = await avaliarSugestao(sug, msgs);
    if (av.erro) {
      // Falha do classificador: NAO envia (fail-closed) e marca pra nao martelar
      await marcarAvaliada(sug, { enviar: false, confianca: 0, motivo: `erro_avaliacao: ${av.erro}`.slice(0, 200) });
      logErro('resgate/avaliar', new Error(av.erro));
      puladas++;
      continue;
    }

    await marcarAvaliada(sug, av);

    if (av.enviar && av.confianca >= CONFIANCA_MINIMA) {
      try {
        await processarUma(sug.id, 'aprovar', null, 'sofia_resgate');
        enviadas++;
        detalhe.push({ sugestao: sug.id, acao: 'enviada', confianca: av.confianca });
        log('resgate', `sugestao=${sug.id} conversa=${sug.conversa_id} ENVIADA (confianca=${av.confianca})`);
      } catch (e) {
        // Corrida com aprovacao humana (status mudou) ou falha de envio: registra e segue
        logErro('resgate/enviar', e);
        detalhe.push({ sugestao: sug.id, acao: 'falha_envio', erro: e.message });
      }
    } else {
      seguradas++;
      detalhe.push({ sugestao: sug.id, acao: 'segurada', confianca: av.confianca, motivo: av.motivo });
      log('resgate', `sugestao=${sug.id} SEGURADA pra Tamara (enviar=${av.enviar} confianca=${av.confianca} motivo="${av.motivo}")`);
    }
  }

  return { ativo: true, candidatas: cands.length, enviadas, seguradas, puladas, detalhe };
}
