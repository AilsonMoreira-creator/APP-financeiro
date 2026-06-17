// ============================================================================
// /api/meluni-carrinho-funil-cron — faz o funil do carrinho andar sozinho.
// ----------------------------------------------------------------------------
// SEMPRE: fn_meluni_carrinho_conversoes() — casa venda (tel/email/nome/cliente_id)
//   e move pra 'conversao'.
// SE lara_funil_ativo=true:
//   - 2º envio: 'enviada' há >24h sem conversão e com nome -> dispara
//     meluni_carrinho_desconto e move pra 'segundo_envio'.
//   - fn_meluni_carrinho_perdidas() — enviada>48h, segundo_envio>48h, conversando>72h.
// Ordem: conversões -> 2º envio -> perdidas (pra não perder quem acabou de ser 2º-enviado).
// Ailson 17/06/2026.
// ============================================================================
import { supabase, cfgMeluni } from './_meluni-whats-helpers.js';
import { enviarTemplateLara } from './_meluni-whats-meta.js';
import { resolverPrimeiroNome } from './_meluni-carrinho-resumo.js';

async function acharOuCriarConversa(telefone, nome) {
  const { data: ex } = await supabase.from('meluni_conversas').select('id, etapa')
    .eq('canal', 'whatsapp').eq('telefone', telefone)
    .order('ultima_msg_em', { ascending: false }).limit(1).maybeSingle();
  if (ex?.id) return ex.id;
  const { data: nova } = await supabase.from('meluni_conversas').insert({
    canal: 'whatsapp', telefone, externo_id: telefone, nome_cliente: nome || null,
    origem: 'carrinho', etapa: 'conversando',
    ultima_msg_direcao: 'saida', ultima_msg_em: new Date().toISOString(),
  }).select('id').single();
  return nova?.id || null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const ua = req.headers?.['user-agent'] || '';
  const ehCron = ua.startsWith('vercel-cron') || !!req.headers?.['x-vercel-cron'];
  if (!ehCron && req.query?.force !== '1') return res.status(403).json({ erro: 'Cron only. Use ?force=1.' });

  let conversoes = 0, segundo = 0, segundoPulado = 0, perdidas = 0, erros = 0;
  const detalhe = [];

  try {
    // 1) conversões (sempre)
    const { data: cv } = await supabase.rpc('fn_meluni_carrinho_conversoes');
    conversoes = Number(cv) || 0;

    const funilAtivo = (await cfgMeluni('lara_funil_ativo', false)) === true;

    if (funilAtivo) {
      // 2) 2º envio: enviada >24h, sem conversão, com nome
      const lote = Number(await cfgMeluni('lara_segundo_envio_lote', 30)) || 30;
      const corte = new Date(Date.now() - 24 * 3600e3).toISOString();
      const { data: carts } = await supabase.from('meluni_carrinhos')
        .select('id, nome, telefone, enviado_em, dados_extra')
        .eq('status', 'enviada').is('convertido_em', null)
        .lt('enviado_em', corte)
        .order('enviado_em', { ascending: true }).limit(lote);

      for (const c of (carts || [])) {
        const nome = await resolverPrimeiroNome(c.telefone, c.nome);
        if (!nome) { segundoPulado++; continue; } // sem nome -> cai pra perdida no passo 3
        try {
          const r = await enviarTemplateLara(c.telefone, 'meluni_carrinho_desconto', [nome]);
          const metaMsgId = r?.messages?.[0]?.id || null;
          const nowIso = new Date().toISOString();
          const convId = await acharOuCriarConversa(c.telefone, nome);
          if (convId) {
            await supabase.from('meluni_mensagens').insert({
              conversa_id: convId, direcao: 'saida', autor: 'lara_carrinho_2',
              tipo_midia: 'template', template_usado: 'meluni_carrinho_desconto',
              texto: `[carrinho 2º envio] ${nome}`, meta_message_id: metaMsgId, enviada_em: nowIso,
            });
            await supabase.from('meluni_conversas').update({ ultima_msg_direcao: 'saida', ultima_msg_em: nowIso, responder_em: null }).eq('id', convId);
          }
          await supabase.from('meluni_carrinhos').update({
            status: 'segundo_envio', segundo_envio_em: nowIso, segundo_template: 'meluni_carrinho_desconto',
          }).eq('id', c.id);
          segundo++;
          detalhe.push({ id: c.id, segundo: true });
        } catch (e) { erros++; detalhe.push({ id: c.id, erro: String(e?.message || e) }); }
      }

      // 3) perdidas por tempo
      const { data: pd } = await supabase.rpc('fn_meluni_carrinho_perdidas');
      perdidas = Number(pd) || 0;
    }

    return res.status(200).json({ ok: true, funilAtivo: (await cfgMeluni('lara_funil_ativo', false)) === true, conversoes, segundo, segundoPulado, perdidas, erros, detalhe });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: String(e?.message || e), conversoes, segundo, perdidas });
  }
}
