// ============================================================================
// MELUNI — disparo manual da NEWSLETTER (Ailson 03/08/2026).
//
// POST { ids: [...] } — cards origem='newsletter' status='processando'.
// Template HSM proprio, configuravel em meluni_config:
//   lara_template_newsletter = { "template": "nome_na_meta", "com_nome": true }
// Sem template configurado -> 422 (o botao do front avisa).
// com_nome=true manda [primeiro nome || 'cliente'] como body param {{1}}.
//
// Fluxo pos-envio (mesmo funil do carrinho):
//   status='enviada' + enviado_em -> respostas caem em Conversando (conversa
//   criada aqui) -> compra em ate 7 dias vira Conversao (funil-cron existente).
//
// Protecoes: telefones congelados (tags Atencao), conversa fechada, limite 30
// por chamada, ja_enviado.
// ============================================================================
import { supabase } from './_meluni-whats-helpers.js';
import { enviarTemplateLara } from './_meluni-whats-meta.js';
import { resolverPrimeiroNome } from './_meluni-carrinho-resumo.js';
import { acharConversaWhats } from './_meluni-tel.js';
import { telefonesCongelados } from './_meluni-tags-core.js';

const ETAPAS_FECHADAS = ['vendeu', 'perdida', 'resolvido'];
const MAX_POR_CHAMADA = 30;

async function cfgTemplateNewsletter() {
  const { data } = await supabase.from('meluni_config').select('valor').eq('chave', 'lara_template_newsletter').maybeSingle();
  const v = data?.valor;
  if (!v) return null;
  try {
    const obj = typeof v === 'string' ? JSON.parse(v) : v;
    if (obj && obj.template) return { template: String(obj.template), com_nome: obj.com_nome !== false };
  } catch {
    // aceita tambem string simples com o nome do template
    if (typeof v === 'string' && v.trim()) return { template: v.trim(), com_nome: true };
  }
  return null;
}

async function acharOuCriarConversa(telefone, nome) {
  const ex = await acharConversaWhats(supabase, telefone);
  if (ex?.id) return ex;
  const { data: nova, error: eNova } = await supabase.from('meluni_conversas').insert({
    canal: 'whatsapp', telefone, externo_id: telefone, nome_cliente: nome || null,
    origem: 'newsletter', etapa: 'conversando',
    ultima_msg_direcao: 'saida', ultima_msg_em: new Date().toISOString(),
  }).select('id, etapa').single();
  if (eNova) console.error('[meluni-newsletter] criar conversa falhou:', eNova.message, telefone);
  return nova || null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, erro: 'Use POST' });

  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.slice(0, MAX_POR_CHAMADA) : [];
    if (!ids.length) return res.status(400).json({ ok: false, erro: 'ids obrigatório' });

    const cfg = await cfgTemplateNewsletter();
    if (!cfg) {
      return res.status(422).json({ ok: false, erro: 'Template da newsletter ainda não configurado (meluni_config: lara_template_newsletter)' });
    }

    const { data: cards, error } = await supabase
      .from('meluni_carrinhos')
      .select('id, nome, telefone, dados_extra, status, enviado_em')
      .in('id', ids)
      .eq('origem', 'newsletter')
      .eq('status', 'processando')
      .not('telefone', 'is', null);
    if (error) throw new Error(error.message);

    const congelados = await telefonesCongelados(supabase).catch(() => new Set());

    let enviados = 0, pulados = 0, erros = 0;
    const puladosAtencao = [];
    const nowIso = () => new Date().toISOString();

    for (const c of (cards || [])) {
      try {
        if (c.enviado_em) { pulados++; continue; }
        if (congelados && congelados.has && congelados.has(c.telefone)) { pulados++; puladosAtencao.push(c.telefone); continue; }

        const conv = await acharOuCriarConversa(c.telefone, c.nome);
        if (conv && ETAPAS_FECHADAS.includes(conv.etapa)) { pulados++; continue; }

        let bodyParams = [];
        if (cfg.com_nome) {
          const nome = await resolverPrimeiroNome(c.telefone, c.nome).catch(() => null);
          bodyParams = [nome || 'cliente'];
        }

        const r = await enviarTemplateLara(c.telefone, cfg.template, bodyParams);
        const metaId = r?.messages?.[0]?.id || null;
        if (!metaId) { erros++; continue; }

        await supabase.from('meluni_carrinhos').update({
          status: 'enviada', enviado_em: nowIso(), enviado_template: cfg.template,
          dados_extra: { ...(c.dados_extra || {}), lara_template_enviado_em: nowIso(), lara_template_name: cfg.template, fonte: 'newsletter' },
        }).eq('id', c.id);
        enviados++;
      } catch (e) {
        console.error('[meluni-newsletter] erro card', c.id, e.message);
        erros++;
      }
    }

    return res.status(200).json({ ok: true, enviados, pulados, erros, pulados_atencao: puladosAtencao });
  } catch (e) {
    console.error('[meluni-newsletter-disparo]', e);
    return res.status(500).json({ ok: false, erro: e.message });
  }
}
