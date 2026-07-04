// ============================================================================
// /api/meluni-email-mkt-auto-cron — DISPARO AUTOMÁTICO de e-mail (Opção A).
// Pega o template marcado como auto_disparo=true e manda pros carrinhos
// abandonados ELEGÍVEIS que ainda NÃO receberam e-mail (igual a Lara faz no
// WhatsApp, mas por e-mail). Roda 1x/dia via cron.
//
// Elegível = tem e-mail + tem peça(s) + NÃO convertido + dentro da janela de
//   abandono (>= 2h e <= 30d) + não bloqueado + não descadastrado + ainda não
//   está em meluni_email_envios (dedup, mesma tabela do disparo manual).
//
// Segurança:
//   - só roda via cron (user-agent vercel-cron) OU ?force=1 OU ?dry=1
//   - ?dry=1  -> NÃO envia nada; devolve quantos/quem entraria (pra conferir)
//   - sem template ativo -> não faz nada
//   - lote limitado por execução
// Ailson 24/06/2026.
// ============================================================================
import { supabase } from './_bling-helpers.js';
import { renderEmailHtml, primeiroNome, aplicarTokens } from './_meluni-email-mkt-template.js';
import { resolverItensDetalhados } from './_meluni-carrinho-resumo.js';

const FROM = 'Meluni <marketing@news.meluniloja.com.br>';
const REPLY = 'contato@meluniloja.com.br';
const IDADE_MIN_H = 2;     // só carrinho abandonado há pelo menos 2h
const IDADE_MAX_D = 30;    // e no máximo 30 dias
const LOTE = 40;           // teto de envios por execução
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function enviarResend({ to, subject, html, unsubscribeUrl }) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM, to: [to], reply_to: REPLY, subject, html,
      headers: {
        'List-Unsubscribe': `<mailto:${REPLY}?subject=unsubscribe>, <${unsubscribeUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.message || j?.error?.message || `Resend ${r.status}`);
  return j?.id || null;
}

const temPeca = (c) => Array.isArray(c.itens) && c.itens.length > 0;

export default async function handler(req, res) {
  const ua = String(req.headers['user-agent'] || '');
  const ehCron = ua.startsWith('vercel-cron');
  const force = req.query?.force === '1';
  const dry = req.query?.dry === '1';
  if (!ehCron && !force && !dry) {
    return res.status(403).json({ ok: false, erro: 'Cron only. Use ?dry=1 pra simular ou ?force=1.' });
  }

  try {
    // 1) template ativo
    const { data: tpl, error: errTpl } = await supabase.from('meluni_email_campanhas')
      .select('*').eq('auto_disparo', true).limit(1).maybeSingle();
    if (errTpl) throw errTpl;
    if (!tpl) return res.status(200).json({ ok: true, motivo: 'nenhum template com disparo automatico ativo', enviados: 0 });

    if (!dry && !process.env.RESEND_API_KEY) {
      return res.status(400).json({ ok: false, erro: 'RESEND_API_KEY não configurada.' });
    }

    // 2) candidatos: carrinho com e-mail, não convertido, dentro da janela, não bloqueado
    const agora = Date.now();
    const teto = new Date(agora - IDADE_MIN_H * 3600e3).toISOString();
    const piso = new Date(agora - IDADE_MAX_D * 86400e3).toISOString();
    const { data: cand, error: errC } = await supabase.from('meluni_carrinhos')
      .select('id, nome, email, valor, itens, data_carrinho, status, convertido_em, email_mkt_bloqueado_em')
      .not('email', 'is', null).neq('email', '')
      .neq('status', 'conversao').is('convertido_em', null).is('email_mkt_bloqueado_em', null)
      .lte('data_carrinho', teto).gte('data_carrinho', piso)
      .order('data_carrinho', { ascending: false }).limit(LOTE * 6);
    if (errC) throw errC;

    let candidatos = (cand || []).filter(temPeca);

    // 3) tira já-enviados (dedup) e descadastrados, em massa
    const ids = candidatos.map(c => c.id);
    const emails = [...new Set(candidatos.map(c => String(c.email).toLowerCase().trim()))];
    const jaEnv = ids.length
      ? (await supabase.from('meluni_email_envios').select('carrinho_id').in('carrinho_id', ids)).data || []
      : [];
    const enviadoSet = new Set(jaEnv.map(e => String(e.carrinho_id)));
    const desc = emails.length
      ? (await supabase.from('meluni_email_descadastro').select('email').in('email', emails)).data || []
      : [];
    const descSet = new Set(desc.map(d => String(d.email).toLowerCase().trim()));

    const elegiveis = candidatos.filter(c =>
      !enviadoSet.has(String(c.id)) &&
      !descSet.has(String(c.email).toLowerCase().trim())
    ).slice(0, LOTE);

    // 4) DRY-RUN: não envia, só mostra
    if (dry) {
      return res.status(200).json({
        ok: true, dry: true,
        template: { id: tpl.id, assunto: tpl.assunto, titulo: tpl.titulo },
        janela: `abandonado entre ${IDADE_MIN_H}h e ${IDADE_MAX_D}d`,
        candidatos_brutos: candidatos.length,
        elegiveis: elegiveis.length,
        amostra: elegiveis.slice(0, 15).map(c => ({ id: c.id, nome: c.nome, email: c.email, status: c.status })),
      });
    }

    // 5) envia
    const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0];
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const base = `${proto}://${host}`;
    const campanha = {
      assunto: tpl.assunto, titulo: tpl.titulo, corpo: tpl.corpo_html,
      criativo_url: tpl.criativo_url, cta_label: tpl.cta_label, cta_url: tpl.cta_url,
      utm: tpl.utm, cupom: tpl.cupom, cupom_validade: tpl.cupom_validade,
      desconto: tpl.desconto, assinatura: tpl.assinatura,
    };

    let enviados = 0, erros = 0; const detalhe = [];
    for (const c of elegiveis) {
      const email = String(c.email).toLowerCase().trim();
      try {
        const det = await resolverItensDetalhados(c.itens);
        const carrinho = {
          nome: c.nome || null, valor: c.valor, resumo: det.resumo, itens: c.itens,
          itens_detalhados: det.lista, itens_restantes: det.restantes,
        };
        const nome = primeiroNome(c.nome);
        const unsubscribeUrl = `${base}/api/meluni-email-mkt-descadastro?e=${encodeURIComponent(email)}`;
        const html = renderEmailHtml({ campanha, carrinho, unsubscribeUrl });
        const subject = aplicarTokens(campanha.assunto, nome) || 'Suas peças continuam aqui';
        const resend_id = await enviarResend({ to: email, subject, html, unsubscribeUrl });
        await supabase.from('meluni_email_envios').insert({
          carrinho_id: c.id, campanha_id: tpl.id, email, nome: c.nome || null, valor: c.valor,
          enviado_em: new Date().toISOString(), resend_id, status: 'enviado', origem: 'auto',
        });
        enviados++;
        await sleep(150);
      } catch (e) {
        erros++;
        detalhe.push({ carrinho_id: c.id, erro: String(e?.message || e) });
      }
    }

    return res.status(200).json({ ok: true, template_id: tpl.id, elegiveis: elegiveis.length, enviados, erros, detalhe });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: String(e?.message || e) });
  }
}
