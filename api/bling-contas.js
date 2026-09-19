/**
 * bling-contas.js — STATUS das contas do Bling pra TELA, sem expor token.
 * Ailson 19/09/2026 (auditoria de dados sensíveis).
 *
 * POR QUE: a tela do módulo Bling lia `bling_tokens` direto do navegador, com a
 * chave anônima — a mesma que vai no bundle do app. Como a policy da tabela era
 * ALL/true, quem tivesse essa chave lia o access_token e o refresh_token das 3
 * contas e podia usar a API do Bling em nome delas (emitir nota, mexer em
 * estoque). Aqui o servidor responde só o que a tela precisa mostrar.
 *
 *   GET  ?acao=status                  -> { contas: { exitus: {conectada, expira_em, expirado}, ... } }
 *   POST { acao:'salvar_token', conta, access_token, refresh_token, expires_at }
 *        -> grava (usado pelo callback da autorizacao)
 *   POST { acao:'renovar', conta }     -> renova pelo refresh_token guardado
 *
 * O token NUNCA sai daqui. As credenciais (client id/secret) ficam no servidor
 * pra renovacao; a tela segue podendo cadastra-las.
 */
import { supabase } from './_bling-helpers.js';
export const config = { maxDuration: 20 };

const CONTAS = ['exitus', 'lumia', 'muniam'];

async function credsDe(conta) {
  // 19/09: tabela fechada bling_credenciais; payload bling-creds so como fallback na transicao
  const { data: row } = await supabase.from('bling_credenciais').select('client_id, client_secret').eq('conta', conta).maybeSingle();
  if (row?.client_id && row?.client_secret) return { id: row.client_id, secret: row.client_secret };
  const { data } = await supabase.from('amicia_data').select('payload').eq('user_id', 'bling-creds').maybeSingle();
  const c = data?.payload?.[conta];
  return (c && c.id && c.secret) ? c : null;
}
const mascara = (v) => { const s = String(v || ''); return s.length > 8 ? s.slice(0, 4) + '…' + s.slice(-4) : (s ? '•••' : ''); };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-User');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // ── STATUS (o que a tela mostra) ──
    if (req.method === 'GET') {
      const { data } = await supabase.from('bling_tokens').select('conta, expires_at, atualizado_em');
      const agora = Date.now();
      const contas = {};
      for (const c of CONTAS) {
        const t = (data || []).find(x => x.conta === c);
        const exp = t?.expires_at ? new Date(t.expires_at).getTime() : 0;
        contas[c] = {
          conectada: !!t,
          expirado: !!t && exp <= agora,
          expira_em: t?.expires_at || null,
          minutos_restantes: t ? Math.round((exp - agora) / 60000) : null,
          atualizado_em: t?.atualizado_em || null,
          tem_credencial: !!(await credsDe(c)),
          client_id_mascarado: mascara((await credsDe(c))?.id),   // a tela mostra so isto; secret nunca sai
        };
      }
      return res.status(200).json({ ok: true, contas });
    }

    if (req.method !== 'POST') return res.status(405).json({ ok: false, erro: 'GET ou POST' });
    const body = req.body || {};
    const conta = String(body.conta || '').toLowerCase();
    if (!CONTAS.includes(conta)) return res.status(400).json({ ok: false, erro: 'conta inválida' });

    // ── credenciais (cadastro pela tela; o secret entra e nunca mais sai) ──
    if (body.acao === 'salvar_credencial') {
      const client_id = String(body.client_id || '').trim();
      const client_secret = String(body.client_secret || '').trim();
      if (!client_id) return res.status(400).json({ ok: false, erro: 'client_id vazio' });
      const atual = await credsDe(conta);
      const secretFinal = client_secret || atual?.secret;
      if (!secretFinal) return res.status(400).json({ ok: false, erro: 'informe o client_secret' });
      await supabase.from('bling_credenciais').upsert({ conta, client_id, client_secret: secretFinal, atualizado_em: new Date().toISOString(), atualizado_por: String(req.headers['x-user'] || '') }, { onConflict: 'conta' });
      return res.status(200).json({ ok: true, conta, client_id_mascarado: mascara(client_id) });
    }

    // ── URL de autorizacao (montada aqui: o client_id nao precisa estar no navegador) ──
    if (body.acao === 'url_autorizacao') {
      const c = await credsDe(conta);
      if (!c) return res.status(400).json({ ok: false, erro: 'credenciais da conta não cadastradas' });
      const origem = String(body.origem || '').replace(/\/$/, '');
      if (!/^https:\/\/[a-z0-9.-]+\.vercel\.app$|^https:\/\/app\.amicia/i.test(origem) && !/^http:\/\/localhost/.test(origem)) return res.status(400).json({ ok: false, erro: 'origem inválida' });
      const redirect = encodeURIComponent(origem + '/bling-callback.html');
      return res.status(200).json({ ok: true, url: `https://www.bling.com.br/Api/v3/oauth/authorize?response_type=code&client_id=${encodeURIComponent(c.id)}&redirect_uri=${redirect}&state=${conta}` });
    }

    // ── troca do codigo por token (callback manda so o code; o secret fica aqui) ──
    if (body.acao === 'trocar_codigo') {
      const c = await credsDe(conta);
      if (!c) return res.status(400).json({ ok: false, erro: 'credenciais da conta não cadastradas' });
      const code = String(body.code || '');
      const redirect_uri = String(body.redirect_uri || '');
      if (!code || !redirect_uri) return res.status(400).json({ ok: false, erro: 'faltam code/redirect_uri' });
      const r = await fetch('https://www.bling.com.br/Api/v3/oauth/token', {
        method: 'POST',
        headers: { Authorization: 'Basic ' + Buffer.from(`${c.id}:${c.secret}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: `grant_type=authorization_code&code=${encodeURIComponent(code)}&redirect_uri=${encodeURIComponent(redirect_uri)}`,
      });
      const d = await r.json().catch(() => ({}));
      if (!d.access_token) return res.status(400).json({ ok: false, erro: 'Bling não devolveu token', detalhe: String(d?.error_description || d?.error || JSON.stringify(d)).slice(0, 200) });
      const expires_at = new Date(Date.now() + (d.expires_in || 21600) * 1000).toISOString();
      await supabase.from('bling_tokens').upsert({ conta, access_token: d.access_token, refresh_token: d.refresh_token || null, expires_at, atualizado_em: new Date().toISOString() }, { onConflict: 'conta' });
      return res.status(200).json({ ok: true, conta, expira_em: expires_at });
    }

    // ── gravar token (callback da autorizacao) ──
    if (body.acao === 'salvar_token') {
      if (!body.access_token) return res.status(400).json({ ok: false, erro: 'sem access_token' });
      await supabase.from('bling_tokens').upsert({
        conta, access_token: body.access_token, refresh_token: body.refresh_token || null,
        expires_at: body.expires_at || new Date(Date.now() + 21600000).toISOString(),
        atualizado_em: new Date().toISOString(),
      }, { onConflict: 'conta' });
      return res.status(200).json({ ok: true, conta });
    }

    // ── renovar pelo refresh guardado (a tela nao ve nem o token nem o secret) ──
    if (body.acao === 'renovar') {
      const { data: t } = await supabase.from('bling_tokens').select('refresh_token').eq('conta', conta).maybeSingle();
      if (!t?.refresh_token) return res.status(400).json({ ok: false, erro: 'conta sem refresh_token — reconecte' });
      const c = await credsDe(conta);
      if (!c) return res.status(400).json({ ok: false, erro: 'credenciais da conta não cadastradas' });
      const r = await fetch('https://www.bling.com.br/Api/v3/oauth/token', {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + Buffer.from(`${c.id}:${c.secret}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(t.refresh_token)}`,
      });
      const d = await r.json().catch(() => ({}));
      if (!d.access_token) return res.status(400).json({ ok: false, erro: 'Bling não devolveu token', detalhe: String(d?.error || d?.error_description || '').slice(0, 120) });
      const expires_at = new Date(Date.now() + (d.expires_in || 21600) * 1000).toISOString();
      await supabase.from('bling_tokens').upsert({
        conta, access_token: d.access_token, refresh_token: d.refresh_token || t.refresh_token,
        expires_at, atualizado_em: new Date().toISOString(),
      }, { onConflict: 'conta' });
      return res.status(200).json({ ok: true, conta, expira_em: expires_at });
    }

    return res.status(400).json({ ok: false, erro: 'ação desconhecida' });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: String(e?.message || e) });
  }
}
