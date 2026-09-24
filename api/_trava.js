/**
 * _trava.js — trava dos endpoints de ACAO (Fase 1 da fase de protecao). Ailson 23/09/2026.
 *
 * So passa quem tem TOKEN DE SESSAO valido com o modulo (ou admin), usuario ativo e mesma
 * versao — ou cron provado pelo CRON_SECRET (o Vercel manda `Authorization: Bearer <CRON_SECRET>`).
 * O "quem fez" (body.usuario) passa a ser o usuario do TOKEN, nao o que o navegador diz.
 *
 * Modo por trava, em saude_config (cache 60 s):
 *   'ativo' -> bloqueia (401/403 com mensagem clara: a acao NAO foi feita)
 *   'aviso' -> so registra quem seria bloqueado e deixa passar
 * CHAVE DE VOLTA sem deploy (SQL Editor):
 *   update saude_config set valor='aviso' where chave='trava_estoque';
 * Toda recusa (ou "seria recusa" no aviso) vai pra app_erros, modulo 'seguranca'.
 */
import { sessaoDe } from './_sessao.js';
import { supabase } from './_ml-helpers.js';

const _modo = new Map();
async function modoDe(chave) {
  const c = _modo.get(chave);
  if (c && Date.now() - c.em < 60000) return c.v;
  let v = 'aviso';
  try {
    const { data } = await supabase.from('saude_config').select('valor').eq('chave', chave).maybeSingle();
    if (data?.valor === 'ativo' || data?.valor === 'aviso') v = data.valor;
  } catch { /* sem banco: mantem o ultimo conhecido ou 'aviso' */ if (c) v = c.v; }
  _modo.set(chave, { v, em: Date.now() });
  return v;
}

function registrar(req, msg, usuario) {
  try {
    supabase.from('app_erros').insert({
      modulo: 'seguranca', usuario: usuario || null, mensagem: String(msg).slice(0, 300),
      url: String(req.url || '').slice(0, 300), aparelho: String(req.headers['user-agent'] || '').slice(0, 200),
      assinatura: 'trava:' + String(req.headers['x-forwarded-for'] || '').split(',')[0].trim(),
    }).then(() => {}, () => {});
  } catch { /* nunca derruba */ }
}

const MSG_401 = 'Sua sessão expirou. Saia e entre de novo no app. A alteração NÃO foi feita.';
const MSG_403 = 'Seu usuário não tem acesso a este módulo. A alteração NÃO foi feita.';

/**
 * @returns {Promise<{usuario:string|null, cron?:boolean, aviso?:boolean}|null>} null = ja respondeu 401/403
 */
export async function travaAcao(req, res, { modulo, chave, contexto }) {
  const auth = String(req.headers.authorization || '');
  if (process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`) return { usuario: null, cron: true };

  const s = await sessaoDe(req);
  let motivo = null, status = 401, sub = s.claims?.sub || null;
  if (!s.ok) motivo = s.tinhaToken ? `token ${s.motivo}` : 'sem token';
  else if (!(s.claims.adm || (s.claims.mod || []).includes(modulo))) { motivo = `sem o modulo ${modulo}`; status = 403; }
  else {
    try {
      const { data: u } = await supabase.from('app_usuarios').select('ativo, versao').eq('usuario', sub).maybeSingle();
      if (!u || !u.ativo || Number(u.versao || 1) !== Number(s.claims.ver || 1)) motivo = 'usuario inativo ou senha trocada';
    } catch { /* banco fora: token valido basta */ }
  }

  if (!motivo) {
    if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) req.body.usuario = sub;   // "quem fez" = token
    return { usuario: sub };
  }
  const modo = await modoDe(chave);
  const quem = sub || String(req.headers['x-user'] || (req.body && req.body.usuario) || '') || null;
  if (modo !== 'ativo') { registrar(req, `${contexto}: SERIA recusado (${motivo}) [aviso]`, quem); return { usuario: quem, aviso: true }; }
  registrar(req, `${contexto}: recusado (${motivo})`, quem);
  res.status(status).json({ ok: false, error: status === 403 ? MSG_403 : MSG_401, erro: status === 403 ? MSG_403 : MSG_401, trava: true });
  return null;
}
