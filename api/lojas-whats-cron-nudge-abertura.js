// ═══════════════════════════════════════════════════════════════════════════
// lojas-whats-cron-nudge-abertura.js — Nudge pra lead que ignorou a abertura
// ═══════════════════════════════════════════════════════════════════════════
// Regra (Ailson 04/07/2026). Lead entrou em 'conversando', recebeu a ABERTURA
// (vídeo Tamara / fotos, apresentacao_enviada_em) e NÃO interagiu mais nada:
//   N horas sem resposta (config nudge_abertura_horas, default 6) →
//   manda 1 pergunta oferecendo o catálogo.
//
// Restrições do envio:
//   - dentro da janela de 24h da Meta (última msg do cliente + 24h)
//   - horário 09:00-20:00 SP (config nudge_abertura_inicio/fim)
//   - se a janela 24h fechar antes de dar pra enviar → NÃO manda e NÃO marca
//     perdida (lead fica em conversando; o fluxo de Inativos alcança depois)
//
// Resposta POSITIVA ao nudge → o WEBHOOK dispara o catálogo na hora
// (lojas-whats-webhook, decididaPor 'nudge_abertura'). O midia-sender carimba
// catalogo_enviado_em → o follow-up do CATÁLOGO assume dali em diante.
// Resposta que não é "sim" → Sofia responde normal e os fluxos existentes
// assumem (interação real → fluxo quente; catálogo enviado → fluxo catálogo).
//
// Nudge enviado + 3 dias sem NENHUMA resposta → perdida
// (motivo 'nudge_abertura_sem_retorno').
//
// GET ?executar=1 (ou header vercel-cron) executa | GET sem param = preview.
// ═══════════════════════════════════════════════════════════════════════════

import { supabase, setCors, log, logErro, getConfig, tagsCongelamEnvio, primeiroNome } from './_lojas-whats-helpers.js';
import { enviarTexto } from './_lojas-whats-meta-client.js';

export const config = { maxDuration: 60 };
const H = 3600 * 1000;
const D3 = 3 * 86400 * 1000;
const MAX_ENVIOS = 50;

// Nudge (Ailson 09/07/2026): oferece o catálogo de atacado e planta o gancho dos
// 30% off como oportunidade (número concreto + escassez leve, sem superlativo).
// Array pra permitir rotação futura; hoje 1 variação. CATÁLOGO ÚNICO (14/07/2026):
// existe um só catálogo (inverno) com modelos a preço normal E modelos com 30% off
// dentro dele — tanto um "sim" quanto uma pergunta sobre os 30% levam ao MESMO
// catálogo. Não existe mais catálogo de promoção separado.
const NUDGE_VARIACOES = [
  'Oi {nome}! Tem uma parte da coleção de inverno com 30% off rolando essa semana. Quer que eu te mande o catálogo de atacado com os modelos e valores?',
];

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  const ehCron = req.headers['user-agent']?.includes('vercel-cron');
  const executar = req.query.executar === '1' || ehCron;
  try {
    const resultado = await rodar({ dryRun: !executar });
    return res.status(200).json({ ok: true, dry_run: !executar, ...resultado });
  } catch (e) {
    logErro('cron-nudge-abertura', e);
    return res.status(500).json({ error: e.message });
  }
}

function horaSP(d = new Date()) {
  const p = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false }).format(d);
  return parseInt(p, 10);
}

async function ultimaEntradaMs(conversaId) {
  const { data } = await supabase.from('lojas_whats_mensagens')
    .select('enviada_em').eq('conversa_id', conversaId).eq('direcao', 'entrada')
    .order('enviada_em', { ascending: false }).limit(1).maybeSingle();
  return data?.enviada_em ? Date.parse(data.enviada_em) : 0;
}

async function rodar({ dryRun }) {
  const NOW = Date.now();
  const r = { candidatos: 0, enviados: 0, fora_horario: 0, janela_fechada: 0, perdidos_3d: 0, erros: [] };

  const nudgeH = Number(await getConfig('nudge_abertura_horas', 6)) || 6;
  const hIni = Number(await getConfig('nudge_abertura_inicio', 9)) || 9;
  const hFim = Number(await getConfig('nudge_abertura_fim', 20)) || 20;
  // Override opcional via config; vazio = rotaciona NUDGE_VARIACOES (default).
  const textoCfg = await getConfig('nudge_abertura_texto', '');

  const { data: convs, error } = await supabase
    .from('lojas_whats_conversas')
    .select('id, telefone, nome_cliente, etapa, ultima_msg_direcao, apresentacao_enviada_em, nudge_abertura_enviado_em, catalogo_enviado_em, catalogo_followup_pausado, tags')
    .eq('etapa', 'conversando')
    .eq('ultima_msg_direcao', 'saida')
    .not('apresentacao_enviada_em', 'is', null)
    .is('catalogo_enviado_em', null)
    .limit(600);
  if (error) throw error;

  const dentroHorario = horaSP() >= hIni && horaSP() < hFim;

  for (const c of (convs || [])) {
    try {
      if (c.catalogo_followup_pausado === true) continue;
      // Tag congelante (Ailson 07/07/2026): sem nudge automático
      if (await tagsCongelamEnvio(c.tags)) continue;

      // ── Perdida: nudge enviado + 3 dias sem resposta ──────────────────────
      if (c.nudge_abertura_enviado_em) {
        const tNudge = Date.parse(c.nudge_abertura_enviado_em);
        if (NOW - tNudge >= D3) {
          const ultEnt = await ultimaEntradaMs(c.id);
          if (ultEnt < tNudge) { // nenhuma resposta depois do nudge
            r.perdidos_3d++;
            if (!dryRun) {
              await supabase.from('lojas_whats_conversas').update({
                etapa: 'perdida', motivo_perdida: 'nudge_abertura_sem_retorno',
                perdida_em: new Date().toISOString(), atualizado_em: new Date().toISOString(),
              }).eq('id', c.id);
              log('cron-nudge-abertura', `conv=${c.id} perdida (3d sem retorno do nudge)`);
            }
          }
        }
        continue; // nudge já saiu: só o branch de perdida acima interessa
      }

      // ── Envio do nudge ────────────────────────────────────────────────────
      const tApres = Date.parse(c.apresentacao_enviada_em);
      if (NOW - tApres < nudgeH * H) continue;

      const ultEnt = await ultimaEntradaMs(c.id);
      if (ultEnt > tApres) continue;      // cliente interagiu depois da abertura: fluxo normal cuida
      if (!ultEnt) continue;              // sem entrada nenhuma (não deveria existir)

      r.candidatos++;
      if (NOW > ultEnt + 24 * H) { r.janela_fechada++; continue; } // janela Meta fechou: não manda, não perde
      if (!dentroHorario) { r.fora_horario++; continue; }          // tenta no próximo tick
      if (r.enviados >= MAX_ENVIOS) continue;

      const nome = primeiroNome(c.nome_cliente);
      const tpl = (textoCfg && textoCfg.trim())
        ? textoCfg
        : NUDGE_VARIACOES[Math.floor(Math.random() * NUDGE_VARIACOES.length)];
      const texto = tpl.replace('{nome}', nome || '').replace(/\s{2,}/g, ' ').replace('Oi !', 'Oi!');

      if (!dryRun) {
        const resp = await enviarTexto(c.telefone, texto);
        const metaMsgId = resp?.messages?.[0]?.id || null;
        const agora = new Date().toISOString();
        await supabase.from('lojas_whats_mensagens').insert({
          conversa_id: c.id, direcao: 'saida', autor: 'sofia_ia', tipo_midia: 'text',
          texto, meta_message_id: metaMsgId, status: 'enviando', enviada_em: agora,
        });
        await supabase.from('lojas_whats_conversas').update({
          nudge_abertura_enviado_em: agora, ultima_atividade_em: agora,
          ultima_msg_direcao: 'saida', atualizado_em: agora,
        }).eq('id', c.id);
        log('cron-nudge-abertura', `conv=${c.id} nudge enviado`);
      }
      r.enviados++;
    } catch (e) {
      r.erros.push({ id: c.id, motivo: e.message });
    }
  }
  return r;
}
