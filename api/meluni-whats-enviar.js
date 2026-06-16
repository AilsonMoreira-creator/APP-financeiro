// ============================================================================
// MELUNI — envio manual (atendente digita) pela Lara. POST.
// body: { conversa_id | telefone, texto, operador? }
// Envia pela Lara, grava a saída, descarta sugestão pendente e fecha o debounce.
// Só funciona dentro da janela de 24h (texto livre da Cloud API). Ailson 16/06.
// ============================================================================
import { supabase } from './_meluni-whats-helpers.js';
import { enviarTextoLara } from './_meluni-whats-meta.js';

const normTel = (s) => String(s || '').replace(/\D/g, '');

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, erro: 'use POST' });

  const b = req.body || {};
  const operador = (b.operador || 'atendente').toString().slice(0, 60);
  const texto = (b.texto || '').toString().trim();
  if (!texto) return res.status(400).json({ ok: false, erro: 'texto obrigatorio' });

  try {
    let conversa = null;
    if (b.conversa_id) {
      const { data } = await supabase.from('meluni_conversas').select('*').eq('id', b.conversa_id).maybeSingle();
      conversa = data || null;
    } else if (b.telefone) {
      const tel = normTel(b.telefone);
      const { data } = await supabase.from('meluni_conversas')
        .select('*').eq('canal', 'whatsapp').eq('telefone', tel)
        .order('ultima_msg_em', { ascending: false }).limit(1).maybeSingle();
      conversa = data || null;
    }
    if (!conversa?.telefone) return res.status(400).json({ ok: false, erro: 'conversa nao encontrada (cliente precisa ter escrito antes)' });

    let metaMsgId = null;
    try {
      const resp = await enviarTextoLara(conversa.telefone, texto);
      metaMsgId = resp?.messages?.[0]?.id || null;
    } catch (e) {
      return res.status(400).json({ ok: false, erro: `envio_falhou: ${e?.message || e}` });
    }

    const agora = new Date().toISOString();
    await supabase.from('meluni_mensagens').insert({
      conversa_id: conversa.id, direcao: 'saida', autor: operador,
      tipo_midia: 'text', texto, meta_message_id: metaMsgId, enviada_em: agora,
    });
    // envio manual descarta sugestão pendente (atendente assumiu)
    await supabase.from('meluni_sugestoes').update({
      status: 'descartada', decidido_em: agora, decidido_por: operador,
    }).eq('conversa_id', conversa.id).eq('status', 'pendente');
    await supabase.from('meluni_conversas').update({
      ultima_msg_direcao: 'saida', ultima_msg_em: agora, responder_em: null,
      ...(conversa.atendida_desde ? {} : { atendida_desde: agora, atendida_por: operador }),
    }).eq('id', conversa.id);

    return res.json({ ok: true, meta_message_id: metaMsgId });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: e?.message || String(e) });
  }
}
