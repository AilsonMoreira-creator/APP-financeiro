/**
 * _sessao.js — token de sessao do app (PASSO 4 do login). Ailson, 20/09/2026.
 *
 * Token = JWT HS256 assinado com segredo que so o servidor conhece (tabela fechada
 * app_segredos; duas chaves pra rotacao). Dentro: usuario, modulos, admin, versao
 * do usuario e validade (12h). Verificar e so matematica, sem banco.
 *
 * FASE 1 (agora): app-login emite, o app manda em toda chamada /api, NINGUEM exige.
 *   sombraSessao(req, caminho) so conta com/sem/invalido em app_sessao_sombra.
 * FASE 2: exigirSessao(req, res, modulo) nos endpoints, modulo por modulo, com flag.
 */
import crypto from 'node:crypto';
import { supabase } from './_ml-helpers.js';

export const VALIDADE_S = 12 * 3600;      // 12 horas
export const RENOVAR_APOS_S = 6 * 3600;   // o app renova em silencio depois de 6h

let _segredos = null; let _lidoEm = 0;
async function segredos() {
  if (_segredos && Date.now() - _lidoEm < 300000) return _segredos;
  const { data } = await supabase.from('app_segredos').select('chave, valor').in('chave', ['sessao_atual', 'sessao_anterior']);
  const m = Object.fromEntries((data || []).map(x => [x.chave, x.valor]));
  if (!m.sessao_atual) throw new Error('app_segredos.sessao_atual ausente');
  _segredos = m; _lidoEm = Date.now();
  return m;
}

const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const deB64u = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const assinar = (dados, segredo) => b64u(crypto.createHmac('sha256', segredo).update(dados).digest());

export async function emitirToken({ usuario, modulos, admin, versao }) {
  const { sessao_atual } = await segredos();
  const agora = Math.floor(Date.now() / 1000);
  const cab = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const corpo = b64u(JSON.stringify({ sub: String(usuario).toLowerCase(), mod: Array.isArray(modulos) ? modulos : [], adm: !!admin, ver: Number(versao) || 1, iat: agora, exp: agora + VALIDADE_S }));
  return `${cab}.${corpo}.${assinar(`${cab}.${corpo}`, sessao_atual)}`;
}

/** Devolve as claims se o token for valido (assinatura + validade); senao null com motivo. */
export async function verificarToken(token) {
  try {
    const partes = String(token || '').split('.');
    if (partes.length !== 3) return { ok: false, motivo: 'formato' };
    const seg = await segredos();
    const ass = `${partes[0]}.${partes[1]}`;
    const bate = [seg.sessao_atual, seg.sessao_anterior].filter(Boolean).some(s => {
      const esperado = assinar(ass, s);
      return esperado.length === partes[2].length && crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(partes[2]));
    });
    if (!bate) return { ok: false, motivo: 'assinatura' };
    const claims = JSON.parse(deB64u(partes[1]).toString('utf8'));
    if (!claims.exp || claims.exp < Math.floor(Date.now() / 1000)) return { ok: false, motivo: 'vencido', claims };
    return { ok: true, claims };
  } catch (e) { return { ok: false, motivo: 'erro: ' + String(e?.message || e).slice(0, 80) }; }
}

export function tokenDoRequest(req) {
  const a = String(req.headers?.authorization || req.headers?.Authorization || '');
  return a.startsWith('Bearer ') ? a.slice(7).trim() : null;
}

/** Sessao do request: { ok, claims, motivo, tinhaToken }. Nao bloqueia nada. */
export async function sessaoDe(req) {
  const t = tokenDoRequest(req);
  if (!t) return { ok: false, tinhaToken: false, motivo: 'sem token' };
  const v = await verificarToken(t);
  return { ...v, tinhaToken: true };
}

/** FASE 1: so contabiliza. Nunca lanca. Fire-and-forget. */
export function sombraSessao(req, caminho) {
  (async () => {
    try {
      const s = await sessaoDe(req);
      const tipo = !s.tinhaToken ? 'sem' : (s.ok ? 'com' : 'invalido');
      await supabase.rpc('app_sessao_contar', { p_caminho: caminho, p_tipo: tipo });
    } catch { /* silencio */ }
  })();
}

/**
 * FASE 2 (ainda nao usado): exige sessao valida (e, se informado, o modulo ou admin).
 * Confere tambem a versao do usuario no banco (senha trocada/desativado -> token morre).
 * Devolve as claims ou responde 401/403 e devolve null.
 */
export async function exigirSessao(req, res, { modulo = null, admin = false } = {}) {
  const s = await sessaoDe(req);
  if (!s.ok) { res.status(401).json({ ok: false, erro: s.tinhaToken ? 'sessão inválida ou vencida' : 'faça login' }); return null; }
  const c = s.claims;
  const { data: u } = await supabase.from('app_usuarios').select('ativo, versao').eq('usuario', c.sub).maybeSingle();
  if (!u || !u.ativo || Number(u.versao || 1) !== Number(c.ver || 1)) { res.status(401).json({ ok: false, erro: 'sessão encerrada — faça login de novo' }); return null; }
  if (admin && !c.adm) { res.status(403).json({ ok: false, erro: 'só admin' }); return null; }
  if (modulo && !c.adm && !(c.mod || []).includes(modulo)) { res.status(403).json({ ok: false, erro: `sem acesso ao módulo ${modulo}` }); return null; }
  return c;
}
