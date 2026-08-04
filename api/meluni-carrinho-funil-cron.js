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
import { supabase, cfgMeluni, dentroJanelaEnvio } from './_meluni-whats-helpers.js';
import { enviarTemplateLara } from './_meluni-whats-meta.js';
import { resolverPrimeiroNome } from './_meluni-carrinho-resumo.js';
import { acharConversaWhats, chaveTel } from './_meluni-tel.js';
import { telefonesCongelados } from './_meluni-tags-core.js';

function renderTpl(body, params) {
  let t = String(body || '');
  (params || []).forEach((p, i) => { t = t.split(`{{${i + 1}}}`).join(p == null ? '' : String(p)); });
  return t.trim();
}

async function acharOuCriarConversa(telefone, nome) {
  const ex = await acharConversaWhats(supabase, telefone);
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

  let conversoes = 0, conversoesClientes = 0, segundo = 0, segundoPulado = 0, perdidas = 0, erros = 0;
  const detalhe = [];

  try {
    // 1) conversões (sempre)
    const { data: cv } = await supabase.rpc('fn_meluni_carrinho_conversoes');
    conversoes = Number(cv) || 0;

    // 1b) conversões de CLIENTES da Lara (recebeu disparo e comprou em até 7 dias).
    //     Sempre roda, não manda mensagem. Marca meluni_conversas.etapa='conversao'.
    //     Ailson 29/06/2026.
    try {
      const { data: cvc } = await supabase.rpc('fn_meluni_clientes_conversoes');
      conversoesClientes = Number(cvc) || 0;
    } catch (e) { /* não derruba o cron do carrinho */ }

    const funilAtivo = (await cfgMeluni('lara_funil_ativo', false)) === true;

    // 2º envio e perdidas só rodam na janela de envio (seg–sáb 09–20); fora dela
    // segura pra próxima janela. Conversões (acima) rodam sempre — não mandam msg.
    const janelaOk = dentroJanelaEnvio();
    if (funilAtivo && janelaOk) {
      // 2) 2º envio: enviada >24h, sem conversão, com nome
      const lote = Number(await cfgMeluni('lara_segundo_envio_lote', 30)) || 30;
      const tplsCfg = (((await cfgMeluni('lara_templates_carrinho', {})) || {}).templates) || {};
      const descontoBody = tplsCfg?.desconto?.body || '';
      const descontoSemNomeBody = tplsCfg?.desconto_sem_nome?.body || '';
      const corte = new Date(Date.now() - 24 * 3600e3).toISOString();
      const { data: carts } = await supabase.from('meluni_carrinhos')
        .select('id, nome, telefone, enviado_em, dados_extra')
        .eq('status', 'enviada').eq('origem', 'carrinho').is('convertido_em', null)
        .lt('enviado_em', corte)
        .order('enviado_em', { ascending: true }).limit(lote);

      const congelados = await telefonesCongelados(supabase); // Atencao congela
      for (const c of (carts || [])) {
        if (c.telefone && congelados.has(chaveTel(c.telefone))) { segundoPulado++; continue; }
        const nome = await resolverPrimeiroNome(c.telefone, c.nome);
        if (nome && !c.nome) { try { await supabase.from('meluni_carrinhos').update({ nome }).eq('id', c.id); } catch {} }
        // tem nome -> template com nome; sem nome -> versão sem nome (fallback, igual o 1º envio)
        const tplDesc = nome ? 'meluni_carrinho_desconto' : 'meluni_carrinho_desconto_sem_nome';
        const vDesc = nome ? 'desconto' : 'desconto_sem_nome';
        const tplBotao = tplsCfg?.[vDesc]?.botao?.url ? { text: tplsCfg[vDesc].botao.text || 'Abrir', url: tplsCfg[vDesc].botao.url } : null;
        const bodyParams = nome ? [nome] : [];
        const textoMsg = (nome ? renderTpl(descontoBody, [nome]) : descontoSemNomeBody) || (nome || 'desconto carrinho');
        try {
          const r = await enviarTemplateLara(c.telefone, tplDesc, bodyParams);
          const metaMsgId = r?.messages?.[0]?.id || null;
          const nowIso = new Date().toISOString();
          const convId = await acharOuCriarConversa(c.telefone, nome);
          if (convId) {
            await supabase.from('meluni_mensagens').insert({
              conversa_id: convId, direcao: 'saida', autor: 'lara_carrinho_2',
              tipo_midia: 'template', template_usado: tplDesc,
              texto: textoMsg,
              botao: tplBotao || null, // botao do template de desconto (Ailson 04/08)
              meta_message_id: metaMsgId, enviada_em: nowIso,
            });
            await supabase.from('meluni_conversas').update({ ultima_msg_direcao: 'saida', ultima_msg_em: nowIso, responder_em: null }).eq('id', convId);
          }
          await supabase.from('meluni_carrinhos').update({
            status: 'segundo_envio', segundo_envio_em: nowIso, segundo_template: tplDesc,
          }).eq('id', c.id);
          segundo++;
          detalhe.push({ id: c.id, segundo: true, semNome: !nome });
        } catch (e) { erros++; detalhe.push({ id: c.id, erro: String(e?.message || e) }); }
      }

      // 3) perdidas por tempo
      const { data: pd } = await supabase.rpc('fn_meluni_carrinho_perdidas');
      perdidas = Number(pd) || 0;
    }

    return res.status(200).json({ ok: true, funilAtivo: (await cfgMeluni('lara_funil_ativo', false)) === true, janela: janelaOk ? 'aberta' : 'fora (seg-sab 09-20)', conversoes, conversoesClientes, segundo, segundoPulado, perdidas, erros, detalhe });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: String(e?.message || e), conversoes, segundo, perdidas });
  }
}
