// ═══════════════════════════════════════════════════════════════════════════
// /api/lojas-whats-followup-disparo-massa — disparo MANUAL de HSM em massa
// ═══════════════════════════════════════════════════════════════════════════
// Da aba Follow-up: a assistente seleciona cards (conversas) e dispara um
// template HSM aprovado pra todos de uma vez (fura a janela de 24h). Usado no
// lançamento do Verão 27: clientes com a tag "catalogo de verao" que pediram o
// catálogo e passaram das 24h.
//
// POST { conversa_ids: [...], template: 'preview_verao27_v1' }
//   → pra cada conversa: valida nome, calcula saudação BRT, envia o HSM (com
//     header de imagem se o template tiver criativo), grava no histórico como a
//     cliente vê, atualiza a conversa. Best-effort por item: um erro numa
//     conversa não derruba as outras.
//   → { ok, total, enviados, pulados: [{conversa_id, motivo}], falhas: [...] }
//
// O corpo é renderizado a partir do body_text do template (substitui {{1}},
// {{2}}), então NÃO precisa de whitelist hardcoded: qualquer template aprovado
// e ativo com no máx. as variáveis {{1}}=nome e {{2}}=saudação funciona.
// ═══════════════════════════════════════════════════════════════════════════

import { supabase, setCors, log, logErro, primeiroNome } from './_lojas-whats-helpers.js';
import { enviarTemplate } from './_lojas-whats-meta-client.js';

const LIMITE = 300;

function saudacaoBRT() {
  const h = (new Date().getUTCHours() + 21) % 24; // UTC-3
  if (h >= 5 && h < 12) return 'Bom dia';
  if (h >= 12 && h < 18) return 'Boa tarde';
  return 'Boa noite';
}

// Renderiza o corpo real do template como a cliente vê, trocando {{1}}/{{2}}.
function renderBody(bodyText, nome, saud) {
  return String(bodyText || '')
    .replace(/\{\{\s*1\s*\}\}/g, nome)
    .replace(/\{\{\s*2\s*\}\}/g, saud);
}

// Resolve o link público do criativo do header (se o template for _img).
// header.sample_ref aponta uma foto ativa na biblioteca de mídias (sofia-midias).
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
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST esperado' });

  try {
    const { conversa_ids, template } = req.body || {};
    if (!Array.isArray(conversa_ids) || conversa_ids.length === 0) {
      return res.status(400).json({ error: 'conversa_ids_obrigatorio' });
    }
    if (!template) return res.status(400).json({ error: 'template_obrigatorio' });
    if (conversa_ids.length > LIMITE) {
      return res.status(400).json({ error: `limite_${LIMITE}_excedido`, total: conversa_ids.length });
    }

    // 1. Template precisa existir, estar aprovado e ativo.
    const { data: tpl } = await supabase
      .from('lojas_whats_templates')
      .select('name, language, status, ativo, body_text, header')
      .eq('name', template).maybeSingle();
    if (!tpl) return res.status(404).json({ error: 'template_nao_encontrado', template });
    if (tpl.status !== 'aprovado' || !tpl.ativo) {
      return res.status(400).json({ error: 'template_nao_aprovado_ou_inativo', status: tpl.status, ativo: tpl.ativo });
    }

    // 2. Criativo do header (uma vez só — mesmo pra todos).
    const headerImage = await resolverCriativoHeader(tpl);
    if (tpl.header?.format === 'IMAGE' && !headerImage) {
      return res.status(400).json({ error: 'criativo_header_nao_encontrado', dica: `suba a foto ref ${tpl.header?.sample_ref} na biblioteca de mídias` });
    }

    // 3. Carrega as conversas (nome + telefone) em blocos.
    const conversas = [];
    for (let i = 0; i < conversa_ids.length; i += 300) {
      const bloco = conversa_ids.slice(i, i + 300);
      const { data } = await supabase
        .from('lojas_whats_conversas')
        .select('id, telefone, nome_cliente')
        .in('id', bloco);
      if (data) conversas.push(...data);
    }
    const porId = new Map(conversas.map(c => [c.id, c]));

    const saud = saudacaoBRT();
    const enviados = [];
    const pulados = [];
    const falhas = [];

    // 4. Dispara um a um (best-effort). Pequeno intervalo pra não estourar rate.
    for (const cid of conversa_ids) {
      const conv = porId.get(cid);
      if (!conv) { pulados.push({ conversa_id: cid, motivo: 'conversa_nao_encontrada' }); continue; }
      if (!conv.telefone) { pulados.push({ conversa_id: cid, motivo: 'sem_telefone' }); continue; }
      const nome = primeiroNome(conv.nome_cliente);
      if (!nome) { pulados.push({ conversa_id: cid, motivo: 'sem_nome' }); continue; }

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
          ultima_msg_direcao: 'saida', ultima_atividade_em: agora, responder_em: null,
        }).eq('id', conv.id);

        enviados.push(conv.id);
      } catch (e) {
        falhas.push({ conversa_id: cid, erro: String(e?.message || e) });
        logErro('followup-disparo-massa', e);
      }
      await new Promise(r => setTimeout(r, 120));
    }

    log('followup-disparo-massa', `tpl=${template} enviados=${enviados.length} pulados=${pulados.length} falhas=${falhas.length}`);
    return res.status(200).json({
      ok: true,
      total: conversa_ids.length,
      enviados: enviados.length,
      pulados,
      falhas,
    });
  } catch (e) {
    logErro('followup-disparo-massa', e);
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
