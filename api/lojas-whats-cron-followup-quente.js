// ═══════════════════════════════════════════════════════════════════════════
// lojas-whats-cron-followup-quente.js — Follow-up automático de card quente
// ═══════════════════════════════════════════════════════════════════════════
// Regra (Ailson 07/06/2026). Vale só pra card que estava "prestes a ir pra
// vendedora": a conversa teve PELO MENOS uma FOTO DE PRODUTO (cliente mandou
// print/foto OU a Sofia mandou foto/vídeo). Catálogo (PDF/document) NÃO conta.
//
// Relógio "sem resposta" conta da última mensagem NOSSA (bola com o cliente,
// ultima_msg_direcao='saida'):
//   6h  sem resposta  → liga o ícone de relógio (fup_relogio_em). Fica em conversando.
//   12h sem resposta  → vai pra aba follow_up (relógio segue) e agenda o disparo.
//
// Disparo automático (1 só, sem aprovação): tenta 19:00 (SP); se as 19:00
// estouram a janela de 24h da Meta, manda no marco de 12h (se couber na janela
// 24h E no horário comercial). Se não couber em nada → perde (vai pra perdida).
//
// Depois do disparo:
//   - cliente respondeu       → volta pra conversando, NÃO reentra (só manual).
//   - 3 dias sem resposta     → perdida.
//
// Botão de bloquear = catalogo_followup_pausado. Se ligado, PARA TODO o fluxo
// (nem liga relógio, nem move, nem dispara).
//
// NÃO mexe nos outros fluxos de follow_up (atendida→followup, sugestão antiga):
// só atua em cards com os campos fup_* / origem 'conversando_quente_esfriou'.
//
// GET ?executar=1 (ou header vercel-cron) executa | GET sem param = preview.
// ═══════════════════════════════════════════════════════════════════════════

import { supabase, setCors, log, logErro, getConfig, dentroDaJanela, limparEstiloSofia, primeiroNome as fmtPrimeiroNome } from './_lojas-whats-helpers.js';
import { chamarClaude } from './_lojas-helpers.js';
import { enviarTextoFracionado } from './_lojas-whats-meta-client.js';

const MODELO_DEFAULT = 'claude-sonnet-4-6';
const H = 3600 * 1000;
const D3 = 3 * 86400 * 1000;
const ORIGEM = 'conversando_quente_esfriou';
const MAX_CONVS = 800;

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const ehCron = req.headers['user-agent']?.includes('vercel-cron');
  if (req.method === 'GET' && req.query.executar !== '1' && !ehCron) {
    return preview(req, res);
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  try {
    const resultado = await executar();
    return res.status(200).json({ ok: true, ...resultado });
  } catch (e) {
    logErro('cron-fup-quente', e);
    return res.status(500).json({ error: e.message });
  }
}

// ─── PREVIEW ───────────────────────────────────────────────────────────────
async function preview(req, res) {
  const { count: noFluxo } = await supabase
    .from('lojas_whats_conversas')
    .select('*', { count: 'exact', head: true })
    .not('fup_relogio_em', 'is', null);
  const { count: aguardandoDisparo } = await supabase
    .from('lojas_whats_conversas')
    .select('*', { count: 'exact', head: true })
    .eq('etapa', 'follow_up')
    .not('fup_agendado_para', 'is', null)
    .is('fup_disparado_em', null);
  return res.status(200).json({ preview: true, com_relogio: noFluxo || 0, aguardando_disparo: aguardandoDisparo || 0 });
}

// ─── EXECUTAR ────────────────────────────────────────────────────────────────
async function executar() {
  const NOW = Date.now();
  const agora = new Date(NOW).toISOString();
  const r = {
    relogio_ligado: 0, movidos_followup: 0, disparados: 0,
    voltaram_conversando: 0, perdidos_janela: 0, perdidos_3d: 0,
    erros: [],
  };

  const { data: convs, error } = await supabase
    .from('lojas_whats_conversas')
    .select('id, telefone, nome_cliente, etapa, ultima_msg_direcao, ultima_atividade_em, catalogo_followup_pausado, follow_up_origem, fup_relogio_em, fup_agendado_para, fup_disparado_em, fup_ja_rodou')
    .in('etapa', ['conversando', 'follow_up'])
    .not('ultima_atividade_em', 'is', null)
    .limit(MAX_CONVS);
  if (error) throw error;
  if (!convs?.length) return { ...r, total: 0 };

  const comFoto = await idsComFotoProduto(convs.map(c => c.id));
  const modelo = await getConfig('modelo_ia', MODELO_DEFAULT);

  for (const c of convs) {
    try {
      const pausado = c.catalogo_followup_pausado === true;
      const clienteRespondeu = c.ultima_msg_direcao === 'entrada';
      const bolaComCliente = c.ultima_msg_direcao === 'saida';
      const meuFluxo = !!c.fup_relogio_em || !!c.fup_agendado_para || !!c.fup_disparado_em || c.follow_up_origem === ORIGEM;
      const horasSem = (NOW - Date.parse(c.ultima_atividade_em)) / H;

      // ── A. Cliente respondeu enquanto estava no nosso fluxo ──────────────
      if (clienteRespondeu && meuFluxo) {
        const upd = { fup_relogio_em: null, fup_agendado_para: null, atualizado_em: agora };
        if (c.etapa === 'follow_up') upd.etapa = 'conversando';
        if (c.fup_disparado_em) upd.fup_ja_rodou = true; // já disparou: não reentra automático
        const { error: eUpd } = await supabase.from('lojas_whats_conversas').update(upd).eq('id', c.id);
        if (eUpd) throw eUpd;
        if (c.etapa === 'follow_up') r.voltaram_conversando++;
        continue;
      }

      // Bloqueado (botão de bloquear) → para tudo
      if (pausado) continue;
      // Só seguimos quando a bola está com o cliente
      if (!bolaComCliente) continue;

      // ── E. follow_up já disparado + 3 dias sem resposta → perdida ────────
      if (c.etapa === 'follow_up' && c.fup_disparado_em && (NOW - Date.parse(c.fup_disparado_em)) >= D3) {
        const { error: eUpd } = await supabase.from('lojas_whats_conversas').update({
          etapa: 'perdida', motivo_perdida: 'fup_quente_sem_retorno', perdida_em: agora,
          fup_relogio_em: null, fup_ja_rodou: true, atualizado_em: agora,
        }).eq('id', c.id);
        if (eUpd) throw eUpd;
        r.perdidos_3d++;
        continue;
      }

      // ── D. follow_up agendado e na hora → dispara ────────────────────────
      if (c.etapa === 'follow_up' && c.fup_agendado_para && !c.fup_disparado_em && NOW >= Date.parse(c.fup_agendado_para)) {
        const ultEnt = await ultimaEntradaMs(c.id);
        const janelaFim = ultEnt ? ultEnt + 24 * H : 0;
        if (!janelaFim || NOW > janelaFim) {
          const { error: eUpd } = await supabase.from('lojas_whats_conversas').update({
            etapa: 'perdida', motivo_perdida: 'fup_fora_janela', perdida_em: agora,
            fup_relogio_em: null, fup_ja_rodou: true, atualizado_em: agora,
          }).eq('id', c.id);
        if (eUpd) throw eUpd;
          r.perdidos_janela++;
          continue;
        }
        if (!(await dentroDaJanela(new Date(NOW)))) continue; // fora do horário comercial: tenta no próximo tick

        const historico = await carregarHistorico(c.id);
        const texto = await gerarMsgFollowupQuente({ modelo, conv: c, historico });
        if (!texto) { r.erros.push({ id: c.id, motivo: 'claude_vazio' }); continue; }

        let metaMsgId = null;
        let textoMsg1 = texto;
        try {
          // Ailson 12/06/2026: fracionado como humano (3+ linhas vira 2 mensagens)
          const frac = await enviarTextoFracionado({ telefone: c.telefone, texto, conversaId: c.id, supabase });
          metaMsgId = frac.metaResp?.messages?.[0]?.id || null;
          textoMsg1 = frac.textoPrimeiraParte;
        } catch (e) {
          r.erros.push({ id: c.id, motivo: 'envio', detalhe: e.message });
          continue;
        }
        await supabase.from('lojas_whats_mensagens').insert({
          conversa_id: c.id, direcao: 'saida', autor: 'sofia_ia', tipo_midia: 'text',
          texto: textoMsg1, meta_message_id: metaMsgId, status: 'enviando', enviada_em: agora,
        });
        const { error: eUpd } = await supabase.from('lojas_whats_conversas').update({
          fup_disparado_em: agora, fup_ja_rodou: true,
          ultima_atividade_em: agora, ultima_msg_direcao: 'saida', atualizado_em: agora,
        }).eq('id', c.id);
        if (eUpd) throw eUpd;
        r.disparados++;
        log('cron-fup-quente', `conv=${c.id} disparou follow-up quente`);
        continue;
      }

      // ── Entrada no fluxo: só conversando, com foto de produto, sem ter rodado ──
      if (c.etapa !== 'conversando' || c.fup_ja_rodou || !comFoto.has(c.id)) continue;

      // ── B. 12h → move pra follow_up + agenda disparo ─────────────────────
      if (horasSem >= 12) {
        const ultEnt = await ultimaEntradaMs(c.id);
        const janelaFim = ultEnt ? ultEnt + 24 * H : 0;
        let sendAt = null;
        if (janelaFim) {
          const n19 = proximo19hSP(NOW);
          if (n19 <= janelaFim) sendAt = n19;        // manda às 19:00
          else if (NOW <= janelaFim) sendAt = NOW;   // 19h estoura a janela → marco de 12h
        }
        if (!sendAt) {
          const { error: eUpd } = await supabase.from('lojas_whats_conversas').update({
            etapa: 'perdida', motivo_perdida: 'fup_fora_janela', perdida_em: agora,
            fup_relogio_em: null, fup_ja_rodou: true, atualizado_em: agora,
          }).eq('id', c.id);
        if (eUpd) throw eUpd;
          r.perdidos_janela++;
          continue;
        }
        const { error: eUpd } = await supabase.from('lojas_whats_conversas').update({
          etapa: 'follow_up',
          follow_up_origem: ORIGEM,
          follow_up_motivo: 'esfriou_apos_foto_produto',
          follow_up_entrou_em: agora,
          fup_relogio_em: c.fup_relogio_em || agora,
          fup_agendado_para: new Date(sendAt).toISOString(),
          atualizado_em: agora,
        }).eq('id', c.id);
        if (eUpd) throw eUpd;
        r.movidos_followup++;
        continue;
      }

      // ── 6h → liga o relógio ──────────────────────────────────────────────
      if (horasSem >= 6 && !c.fup_relogio_em) {
        const { error: eUpd } = await supabase.from('lojas_whats_conversas').update({
          fup_relogio_em: agora, atualizado_em: agora,
        }).eq('id', c.id);
        if (eUpd) throw eUpd;
        r.relogio_ligado++;
        continue;
      }
    } catch (e) {
      logErro('cron-fup-quente/conv', e);
      r.erros.push({ id: c.id, motivo: 'excecao', detalhe: e.message });
    }
  }

  r.total = convs.length;
  log('cron-fup-quente', JSON.stringify({ relogio: r.relogio_ligado, mov: r.movidos_followup, disp: r.disparados, volta: r.voltaram_conversando, perdJanela: r.perdidos_janela, perd3d: r.perdidos_3d }));
  return r;
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

// Conversas que tiveram foto de produto (image/video, em qualquer direção).
// Catálogo é 'document' → fica de fora. Retorna Set de conversa_id.
async function idsComFotoProduto(ids) {
  const set = new Set();
  for (let i = 0; i < ids.length; i += 300) {
    const bloco = ids.slice(i, i + 300);
    const { data, error } = await supabase
      .from('lojas_whats_mensagens')
      .select('conversa_id')
      .in('conversa_id', bloco)
      .in('tipo_midia', ['image', 'video']);
    if (error) throw error;
    for (const m of (data || [])) set.add(m.conversa_id);
  }
  return set;
}

// Timestamp (ms) da última mensagem de ENTRADA (cliente) — base da janela 24h.
async function ultimaEntradaMs(conversaId) {
  const { data } = await supabase
    .from('lojas_whats_mensagens')
    .select('enviada_em')
    .eq('conversa_id', conversaId)
    .eq('direcao', 'entrada')
    .order('enviada_em', { ascending: false })
    .limit(1);
  const t = data?.[0]?.enviada_em;
  return t ? Date.parse(t) : null;
}

async function carregarHistorico(conversaId) {
  const { data } = await supabase
    .from('lojas_whats_mensagens')
    .select('direcao, autor, texto, tipo_midia, enviada_em')
    .eq('conversa_id', conversaId)
    .order('enviada_em', { ascending: false })
    .limit(12);
  return (data || []).reverse();
}

// Próximo horário 19:00 de SP (UTC-3, sem horário de verão), em ms, >= fromMs.
function proximo19hSP(fromMs) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(fromMs));
  const y = parts.find(p => p.type === 'year').value;
  const mo = parts.find(p => p.type === 'month').value;
  const da = parts.find(p => p.type === 'day').value;
  let target = Date.parse(`${y}-${mo}-${da}T19:00:00-03:00`);
  if (fromMs >= target) target += 24 * H; // amanhã 19:00 SP (offset fixo, sem DST)
  return target;
}

// ─── MENSAGEM DE FOLLOW-UP (Claude) ──────────────────────────────────────────
async function gerarMsgFollowupQuente({ modelo, conv, historico }) {
  const primeiroNome = fmtPrimeiroNome(conv.nome_cliente); // sanitizado: emoji vira '' (Ailson 02/07/2026)
  const hist = historico.length === 0
    ? '(sem histórico)'
    : historico.map(m => {
        const quem = m.direcao === 'entrada' ? (primeiroNome || 'CLIENTE') : (m.autor === 'sofia_ia' ? 'SOFIA' : 'NOS');
        const conteudo = m.tipo_midia && m.tipo_midia !== 'text'
          ? `[${m.tipo_midia.toUpperCase()}]${m.texto ? ' ' + m.texto : ''}`
          : (m.texto || '');
        return `${quem}: ${conteudo}`;
      }).join('\n');

  const systemPrompt = `Você é Sofia, vendedora da Amícia (moda feminina atacado SP).

A cliente${primeiroNome ? ` (${primeiroNome})` : ''} estava conversando, chegou a ver/perguntar de peça(s), e parou de responder. Você vai mandar UMA mensagem leve só pra reabrir, sabendo que lojista é gente ocupada.

TAREFA: gerar UMA mensagem curta de retomada (1 a 2 linhas, no máximo ~200 caracteres).

REGRAS:
- Use "vc" (jamais "você", "senhora", "amiga", "querida")
- SEM pressão, SEM urgência, SEM "última chance", SEM cobrar resposta
- Demonstre que entende que ela é ocupada (ex: "sei que a correria é grande")
- Pode citar de leve o ASSUNTO que ela viu (a peça/modelo), mas SEM detalhe arriscado: NÃO invente preço, estoque, cor exata, prazo, medida
- Mensagem rasa de propósito: melhor genérica e certa do que específica e errada
- Pergunta aberta e leve no fim (ex: "quer que eu te ajude a fechar quando der?")
- NÃO comece com "Oi, tudo bem?" repetido nem "passando aqui"/"tô voltando aqui"
- NÃO use "incrível", "imperdível", "sensacional"; NÃO use travessão (— ou –); NÃO use emoji 💛
- No máximo 1 emoji simples (😊), e nem sempre

HISTÓRICO (mais antigo → mais recente):
${hist}

Responda APENAS com o texto da mensagem. Nada antes, nada depois.`;

  const cl = await chamarClaude({
    modelo,
    systemBlocks: [{ type: 'text', text: systemPrompt }],
    messages: [{ role: 'user', content: 'gere a mensagem de follow-up agora' }],
    max_tokens: 220,
    temperature: 0.7,
  });
  if (!cl.ok) { logErro('cron-fup-quente/claude', cl.erro); return null; }
  return limparEstiloSofia((cl.texto || '').trim());
}
