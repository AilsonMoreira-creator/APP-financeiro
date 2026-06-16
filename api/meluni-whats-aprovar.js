// ============================================================================
// MELUNI — aprovar/descartar sugestão da Lara. POST.
// body: { id (sugestao), acao: 'aprovar'|'descartar', texto?, operador? }
//   - aprovar: envia o texto (ou o override) pela Lara, grava a saída em
//     meluni_mensagens, marca a sugestão 'enviada' e fecha o debounce.
//   - descartar: marca 'descartada' (não envia).
// Exporta aprovarSugestao() pro auto-envio do cron. Ailson 16/06/2026.
// ============================================================================
import { supabase } from './_meluni-whats-helpers.js';
import { enviarTextoLara } from './_meluni-whats-meta.js';

export async function aprovarSugestao(sugestaoId, operador = 'sistema', textoOverride = null) {
  const { data: sug } = await supabase.from('meluni_sugestoes').select('*').eq('id', sugestaoId).maybeSingle();
  if (!sug) return { ok: false, erro: 'sugestao_inexistente' };
  if (sug.status !== 'pendente') return { ok: false, erro: `sugestao_${sug.status}` };

  const { data: conv } = await supabase.from('meluni_conversas').select('*').eq('id', sug.conversa_id).maybeSingle();
  if (!conv?.telefone) return { ok: false, erro: 'conversa_sem_telefone' };

  const texto = (textoOverride || sug.texto || '').trim();
  if (!texto) return { ok: false, erro: 'texto_vazio' };

  // envia pela Lara
  let metaMsgId = null;
  try {
    const resp = await enviarTextoLara(conv.telefone, texto);
    metaMsgId = resp?.messages?.[0]?.id || null;
  } catch (e) {
    return { ok: false, erro: `envio_falhou: ${e?.message || e}` };
  }

  const agora = new Date().toISOString();
  // grava a saída
  await supabase.from('meluni_mensagens').insert({
    conversa_id: conv.id, direcao: 'saida', autor: operador,
    tipo_midia: 'text', texto, meta_message_id: metaMsgId, enviada_em: agora,
  });
  // marca a sugestão
  await supabase.from('meluni_sugestoes').update({
    status: 'enviada', texto, meta_message_id: metaMsgId,
    decidido_em: agora, decidido_por: operador,
  }).eq('id', sugestaoId);
  // atualiza a conversa e fecha o debounce
  await supabase.from('meluni_conversas').update({
    ultima_msg_direcao: 'saida', ultima_msg_em: agora, responder_em: null,
    ...(conv.atendida_desde ? {} : { atendida_desde: agora, atendida_por: operador }),
  }).eq('id', conv.id);

  return { ok: true, meta_message_id: metaMsgId };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, erro: 'use POST' });

  const b = req.body || {};
  const id = b.id;
  const acao = b.acao || 'aprovar';
  const operador = (b.operador || 'atendente').toString().slice(0, 60);
  if (!id) return res.status(400).json({ ok: false, erro: 'id obrigatorio' });

  try {
    if (acao === 'descartar') {
      await supabase.from('meluni_sugestoes').update({
        status: 'descartada', decidido_em: new Date().toISOString(), decidido_por: operador,
      }).eq('id', id).eq('status', 'pendente');
      return res.json({ ok: true, descartada: true });
    }
    if (acao === 'aprovar') {
      const r = await aprovarSugestao(id, operador, b.texto || null);
      return res.status(r.ok ? 200 : 400).json(r);
    }
    return res.status(400).json({ ok: false, erro: `acao desconhecida: ${acao}` });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: e?.message || String(e) });
  }
}
