// ═══════════════════════════════════════════════════════════════════════════
// /api/lojas-whats-template-disparo — disparo MANUAL de template aprovado
// ═══════════════════════════════════════════════════════════════════════════
// Botao "retomar pedido" no chat (etapa conversando): a assistente dispara um
// HSM aprovado pra reabrir contato quando a janela de 24h fechou (ou a
// qualquer momento). Whitelist de templates: cada um sabe renderizar o corpo
// exatamente como a cliente ve (regra: TUDO que sai gravado no historico).
// {{2}} = saudacao calculada NO ENVIO (BRT), nunca fixa. Ailson 06/07/2026.
//
// POST { conversa_id, template? }  (template default: continuar_pedido_v1)
// ═══════════════════════════════════════════════════════════════════════════

import { supabase, setCors, primeiroNome } from './_lojas-whats-helpers.js';
import { enviarTemplate } from './_lojas-whats-meta-client.js';

function saudacaoBRT() {
  const h = (new Date().getUTCHours() + 21) % 24;
  if (h >= 5 && h < 12) return 'Bom dia';
  if (h >= 12 && h < 18) return 'Boa tarde';
  return 'Boa noite';
}

// Whitelist: nome do template -> como montar params e renderizar o corpo real
const TEMPLATES = {
  continuar_pedido_v1: {
    params: (nome, saud) => [nome, saud],
    render: (nome, saud) => `Oi ${nome}!! ${saud}!!\nVamos continuar o pedido`,
  },
};

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST esperado' });

  try {
    const { conversa_id, template = 'continuar_pedido_v1' } = req.body || {};
    if (!conversa_id) return res.status(400).json({ error: 'conversa_id obrigatorio' });
    const tpl = TEMPLATES[template];
    if (!tpl) return res.status(400).json({ error: 'template_nao_permitido', template });

    const { data: conv, error: errConv } = await supabase
      .from('lojas_whats_conversas')
      .select('id, telefone, nome_cliente')
      .eq('id', conversa_id).maybeSingle();
    if (errConv || !conv) return res.status(404).json({ error: 'conversa nao encontrada' });
    if (!conv.telefone) return res.status(400).json({ error: 'conversa sem telefone' });

    const nome = primeiroNome(conv.nome_cliente);
    if (!nome) {
      // Template exige {{1}}; sem nome sairia "Oi !!" quebrado. Assistente
      // ajusta o nome no lapis do chat e tenta de novo.
      return res.status(400).json({ error: 'conversa_sem_nome', dica: 'edite o nome da cliente no chat antes de disparar' });
    }

    const saud = saudacaoBRT();
    const r = await enviarTemplate(conv.telefone, template, tpl.params(nome, saud));
    const metaMsgId = r?.messages?.[0]?.id || null;
    if (!metaMsgId) throw new Error('meta_sem_message_id');

    const agora = new Date().toISOString();
    // Grava no historico exatamente como a cliente ve (corpo renderizado)
    await supabase.from('lojas_whats_mensagens').insert({
      conversa_id: conv.id, direcao: 'saida', autor: 'assistente',
      tipo_midia: 'text', template_name: template,
      texto: tpl.render(nome, saud),
      meta_message_id: metaMsgId, status: 'enviando', enviada_em: agora,
    });
    await supabase.from('lojas_whats_conversas').update({
      ultima_msg_direcao: 'saida', ultima_atividade_em: agora, responder_em: null,
    }).eq('id', conv.id);

    return res.status(200).json({ ok: true, meta_message_id: metaMsgId, texto: tpl.render(nome, saud) });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
