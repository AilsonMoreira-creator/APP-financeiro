// ============================================================================
// /api/meluni-email-teste — envio de TESTE do template padrao, acionavel por GET.
//   GET ?k=meluni-teste&to=email  -> envia pelo Resend E grava meluni_email_envios
//   (com resend_id) pra o webhook de clique conseguir casar e aparecer na aba
//   Cliques. Uso pontual de validacao do funil envio -> clique -> webhook.
//   Guard simples via ?k= pra nao ficar aberto pra qualquer um.
//   Ailson 04/07/2026.
// ============================================================================
import { renderEmailHtml, primeiroNome, aplicarTokens } from './_meluni-email-mkt-template.js';
import { supabase } from './_bling-helpers.js';

const FROM = 'Meluni <marketing@news.meluniloja.com.br>';
const REPLY = 'contato@meluniloja.com.br';
const GUARD = 'meluni-teste';
const TO_PADRAO = 'ailson.moreira@icloud.com';

const CARRINHO_AMOSTRA = { nome: 'Ailson', valor: 289.9, resumo: 'Vestido de Linho e mais 1 peca', itens: [{ qtd: 1 }, { qtd: 1 }] };

export default async function handler(req, res) {
  try {
    if ((req.query?.k || '') !== GUARD) return res.status(403).json({ ok: false, erro: 'guard' });
    if (!process.env.RESEND_API_KEY) return res.status(400).json({ ok: false, erro: 'Falta RESEND_API_KEY.' });

    const dest = String(req.query?.to || TO_PADRAO).toLowerCase().trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(dest)) return res.status(400).json({ ok: false, erro: 'E-mail invalido.' });

    const cart = CARRINHO_AMOSTRA;
    const nome = primeiroNome(cart.nome);

    // ?real=1 -> usa a campanha do disparo automático (mesma montagem do auto-cron),
    // pra ver EXATAMENTE o que o cliente recebe. Sem real=1 fica o template padrão.
    let campanha = {};
    if (String(req.query?.real || '') === '1') {
      let { data: tpl, error: errTpl } = await supabase.from('meluni_email_campanhas')
        .select('*').eq('auto_disparo', true).limit(1).maybeSingle();
      if (errTpl) throw errTpl;
      if (!tpl) {
        // fallback: sem automático ativo, usa a campanha mais recente
        const r2 = await supabase.from('meluni_email_campanhas')
          .select('*').order('criado_em', { ascending: false }).limit(1).maybeSingle();
        if (r2.error) throw r2.error;
        tpl = r2.data;
      }
      if (!tpl) return res.status(400).json({ ok: false, erro: 'Nenhuma campanha cadastrada.' });
      campanha = {
        assunto: tpl.assunto, titulo: tpl.titulo, corpo: tpl.corpo_html,
        criativo_url: tpl.criativo_url, cta_label: tpl.cta_label, cta_url: tpl.cta_url,
        utm: tpl.utm, cupom: tpl.cupom, cupom_validade: tpl.cupom_validade,
        desconto: tpl.desconto, assinatura: tpl.assinatura,
      };
    }

    const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0];
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const base = `${proto}://${host}`;
    const unsubscribeUrl = `${base}/api/meluni-email-mkt-descadastro?e=${encodeURIComponent(dest)}`;

    const html = renderEmailHtml({ campanha, carrinho: cart, unsubscribeUrl });
    const assunto = aplicarTokens(campanha.assunto || '', nome) || 'Suas pecas continuam aqui';

    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM,
        to: [dest],
        reply_to: REPLY,
        subject: assunto,
        html,
        headers: {
          'List-Unsubscribe': `<mailto:${REPLY}?subject=unsubscribe>, <${unsubscribeUrl}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(502).json({ ok: false, erro: j?.message || j?.error?.message || `Resend ${r.status}.` });

    const resendId = j?.id || null;
    let envioErr = null;
    if (resendId) {
      const { error } = await supabase.from('meluni_email_envios').insert({
        email: dest, nome: cart.nome, valor: cart.valor,
        resend_id: resendId, status: 'enviado', origem: 'teste',
      });
      if (error) envioErr = String(error.message || error);
    }
    return res.status(200).json({ ok: true, resend_id: resendId, envio_gravado: !envioErr, envio_erro: envioErr, to: dest });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: String(e?.message || e) });
  }
}
