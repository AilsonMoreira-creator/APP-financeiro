// ═══════════════════════════════════════════════════════════════════════════
// /api/lojas-whats-cron-disparo2 — 2º disparo automático de campanha (Sofia)
// ═══════════════════════════════════════════════════════════════════════════
// Espelha o padrão do carrinho da Meluni (meluni-carrinho-funil-cron):
// clientes que receberam o 1º disparo (aba Follow-up) e NÃO responderam em 24h
// recebem um 2º disparo automático, com abordagem diferente (conteúdo de
// interesse — as cores tendência do Verão 27) que termina tentando o catálogo.
//
// Gatilho por conversa: disparo1_em < now()-24h, disparo2_em IS NULL,
//   disparo_respondeu_em IS NULL (quem respondeu saiu do fluxo).
// Janela: usa dentroDaJanela() — DOMINGO já é bloqueado por padrão (dom:null),
//   então o cron pode rodar domingo mas não envia; "pula pra segunda" sozinho.
// Template do 2º disparo: config sofia_disparo2_template (default abaixo).
// Best-effort por item. Ailson 15/07/2026.
// ═══════════════════════════════════════════════════════════════════════════

import { supabase, setCors, log, logErro, primeiroNome, getConfig, dentroDaJanela } from './_lojas-whats-helpers.js';
import { enviarTemplate } from './_lojas-whats-meta-client.js';

const LOTE = 40;
const TEMPLATE_DEFAULT = 'tendencias_verao27_v1';

function saudacaoBRT() {
  const h = (new Date().getUTCHours() + 21) % 24;
  if (h >= 5 && h < 12) return 'Bom dia';
  if (h >= 12 && h < 18) return 'Boa tarde';
  return 'Boa noite';
}

function renderBody(bodyText, nome, saud) {
  return String(bodyText || '')
    .replace(/\{\{\s*1\s*\}\}/g, nome)
    .replace(/\{\{\s*2\s*\}\}/g, saud);
}

async function resolverCriativoHeader(tpl) {
  if (tpl.header?.format !== 'IMAGE') return null;
  const refRaw = tpl.header?.sample_ref;
  if (!refRaw) return null;
  const refNorm = String(refRaw).replace(/^0+/, '') || '0';
  const variantes = [...new Set([refNorm, refNorm.padStart(4, '0'), refNorm.padStart(5, '0'), String(refRaw)])];
  const { data: midia } = await supabase
    .from('lojas_whats_midias')
    .select('storage_path')
    .eq('tipo', 'foto').eq('ativa', true)
    .in('ref', variantes)
    .limit(1).maybeSingle();
  if (!midia?.storage_path) return null;
  const { data: pub } = supabase.storage.from('sofia-midias').getPublicUrl(midia.storage_path);
  return pub?.publicUrl || null;
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  const ua = req.headers?.['user-agent'] || '';
  const ehCron = ua.includes('vercel-cron') || !!req.headers?.['x-vercel-cron'];
  if (!ehCron && req.query?.force !== '1') {
    return res.status(403).json({ error: 'Cron only. Use ?force=1 pra testar.' });
  }

  let enviados = 0, pulados = 0, falhas = 0;
  const detalhe = [];

  try {
    // Liga/desliga geral do 2º disparo (default ligado).
    const ativo = (await getConfig('sofia_disparo2_ativo', true)) !== false;
    if (!ativo) return res.status(200).json({ ok: true, motivo: 'disparo2_desligado' });

    // Janela: domingo (dom:null) e fora de horário seguram até a próxima janela.
    const janelaOk = await dentroDaJanela();
    if (!janelaOk) {
      return res.status(200).json({ ok: true, motivo: 'fora_da_janela', dica: 'domingo/horário — segura pra próxima janela' });
    }

    const template = (await getConfig('sofia_disparo2_template', TEMPLATE_DEFAULT)) || TEMPLATE_DEFAULT;

    // Template precisa estar aprovado e ativo.
    const { data: tpl } = await supabase
      .from('lojas_whats_templates')
      .select('name, language, status, ativo, body_text, header')
      .eq('name', template).maybeSingle();
    if (!tpl) return res.status(200).json({ ok: false, motivo: 'template_nao_encontrado', template });
    if (tpl.status !== 'aprovado' || !tpl.ativo) {
      return res.status(200).json({ ok: false, motivo: 'template_nao_aprovado_ou_inativo', status: tpl.status, ativo: tpl.ativo });
    }

    const headerImage = await resolverCriativoHeader(tpl);
    if (tpl.header?.format === 'IMAGE' && !headerImage) {
      return res.status(200).json({ ok: false, motivo: 'criativo_header_nao_encontrado', ref: tpl.header?.sample_ref });
    }

    // Alvos: receberam o 1º disparo há >24h, não responderam e sem 2º disparo.
    const corte = new Date(Date.now() - 24 * 3600e3).toISOString();
    const { data: alvos } = await supabase
      .from('lojas_whats_conversas')
      .select('id, telefone, nome_cliente')
      .not('disparo1_em', 'is', null)
      .lt('disparo1_em', corte)
      .is('disparo2_em', null)
      .is('disparo_respondeu_em', null)
      .order('disparo1_em', { ascending: true })
      .limit(LOTE);

    const saud = saudacaoBRT();
    for (const conv of (alvos || [])) {
      if (!conv.telefone) { pulados++; detalhe.push({ id: conv.id, motivo: 'sem_telefone' }); continue; }
      const nome = primeiroNome(conv.nome_cliente);
      if (!nome) { pulados++; detalhe.push({ id: conv.id, motivo: 'sem_nome' }); continue; }

      try {
        const opts = headerImage ? { headerImage } : {};
        const r = await enviarTemplate(conv.telefone, template, [nome, saud], tpl.language || 'pt_BR', opts);
        const metaMsgId = r?.messages?.[0]?.id || null;
        if (!metaMsgId) throw new Error('meta_sem_message_id');

        const agora = new Date().toISOString();
        await supabase.from('lojas_whats_mensagens').insert({
          conversa_id: conv.id, direcao: 'saida', autor: 'assistente',
          tipo_midia: headerImage ? 'image' : 'template',
          template_name: template,
          texto: renderBody(tpl.body_text, nome, saud),
          midia_url: headerImage || null,
          template_vars: { '1': nome, '2': saud },
          meta_message_id: metaMsgId, status: 'enviando', enviada_em: agora,
        });
        await supabase.from('lojas_whats_conversas').update({
          disparo2_em: agora, disparo2_template: template,
          ultima_msg_direcao: 'saida', ultima_atividade_em: agora, responder_em: null,
        }).eq('id', conv.id);

        enviados++;
        detalhe.push({ id: conv.id, enviado: true });
      } catch (e) {
        falhas++;
        detalhe.push({ id: conv.id, erro: String(e?.message || e) });
        logErro('cron-disparo2', e);
      }
      await new Promise(r => setTimeout(r, 150));
    }

    log('cron-disparo2', `tpl=${template} enviados=${enviados} pulados=${pulados} falhas=${falhas}`);
    return res.status(200).json({ ok: true, template, enviados, pulados, falhas, detalhe });
  } catch (e) {
    logErro('cron-disparo2', e);
    return res.status(500).json({ ok: false, erro: String(e?.message || e), enviados, pulados, falhas });
  }
}
