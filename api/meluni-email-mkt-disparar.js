// ============================================================================
// /api/meluni-email-mkt-disparar — disparo em massa pros carrinhos SELECIONADOS.
//   POST { campanha, campanha_id?, carrinho_ids: [..] }  (carrinho_ids = um CHUNK)
//   -> { ok, campanha_id, resultados:[{carrinho_id, ok, resend_id?, erro?}] }
// O frontend manda em chunks (~8 ids) e vai acumulando o progresso.
// Resolve nome+resumo por carrinho, renderiza igual ao preview, envia via Resend,
// grava em meluni_email_envios (só no sucesso, pra falha continuar elegível).
// Ailson 20/06/2026.
// ============================================================================
import { supabase } from './_bling-helpers.js';
import { renderEmailHtml, primeiroNome, aplicarTokens, EMAIL_DEFAULTS } from './_meluni-email-mkt-template.js';
import { resolverItensDetalhados } from './_meluni-carrinho-resumo.js';

const FROM = 'Meluni <marketing@news.meluniloja.com.br>';
const REPLY = 'contato@meluniloja.com.br';
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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, erro: 'Use POST.' });

  try {
    let { campanha = {}, carrinho_ids = [] } = req.body || {};
    // modo padrão (disparo manual em massa): usa o template padrão EMAIL_DEFAULTS
    if (req.body?.padrao) campanha = { ...EMAIL_DEFAULTS, nome: 'E-mail padrão (disparo manual)', ...campanha };
    let campanha_id = req.body?.campanha_id || null;

    if (!process.env.RESEND_API_KEY) {
      return res.status(400).json({ ok: false, erro: 'Configure o RESEND_API_KEY na Vercel antes de disparar.' });
    }
    if (!Array.isArray(carrinho_ids) || !carrinho_ids.length) {
      return res.status(400).json({ ok: false, erro: 'Nenhum carrinho selecionado.' });
    }

    // garante a campanha (insere uma vez; chunks seguintes reusam o id)
    if (!campanha_id) {
      const { data: campIns, error: errCamp } = await supabase.from('meluni_email_campanhas').insert({
        nome: campanha.nome || campanha.titulo || campanha.assunto || 'Campanha',
        assunto: campanha.assunto || '', titulo: campanha.titulo || '', corpo_html: campanha.corpo || '',
        criativo_url: campanha.criativo_url || null, cta_label: campanha.cta_label || null,
        cta_url: campanha.cta_url || null, utm: campanha.utm || null, cupom: campanha.cupom || null,
        cupom_validade: campanha.cupom_validade || null, desconto: campanha.desconto || null, assinatura: campanha.assinatura || null,
        // 'disparo' = registro do envio, nao template (nao aparece na galeria)
        status: 'disparo', ativado_em: new Date().toISOString(), criado_por: campanha.criado_por || 'ailson',
      }).select('id').single();
      if (errCamp) return res.status(500).json({ ok: false, erro: 'Falha ao criar a campanha: ' + errCamp.message });
      campanha_id = campIns.id;
    }

    const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0];
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const base = `${proto}://${host}`;

    // carrega os carrinhos do chunk
    const { data: carts } = await supabase.from('meluni_carrinhos')
      .select('id, nome, email, valor, itens, email_mkt_bloqueado_em')
      .in('id', carrinho_ids);
    const byId = new Map((carts || []).map(c => [String(c.id), c]));

    const resultados = [];
    for (const id of carrinho_ids) {
      const c = byId.get(String(id));
      try {
        if (!c || !c.email) { resultados.push({ carrinho_id: id, ok: false, erro: 'sem e-mail' }); continue; }
        if (c.email_mkt_bloqueado_em) { resultados.push({ carrinho_id: id, ok: false, erro: 'bloqueado' }); continue; }
        const email = String(c.email).toLowerCase().trim();

        // descadastrado?
        const { data: desc } = await supabase.from('meluni_email_descadastro').select('email').eq('email', email).maybeSingle();
        if (desc) { resultados.push({ carrinho_id: id, ok: false, erro: 'descadastrado' }); continue; }

        // já enviado antes? (não reenvia)
        const { data: jaEnv } = await supabase.from('meluni_email_envios').select('id').eq('carrinho_id', c.id).limit(1);
        if (jaEnv && jaEnv.length) { resultados.push({ carrinho_id: id, ok: false, erro: 'ja enviado' }); continue; }

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
          carrinho_id: c.id, campanha_id, email, nome: c.nome || null, valor: c.valor,
          enviado_em: new Date().toISOString(), resend_id, status: 'enviado',
        });
        resultados.push({ carrinho_id: id, ok: true, resend_id });
        await sleep(150); // warm-up leve entre envios
      } catch (e) {
        resultados.push({ carrinho_id: id, ok: false, erro: String(e?.message || e) });
      }
    }

    return res.status(200).json({ ok: true, campanha_id, resultados });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: String(e?.message || e) });
  }
}
