/**
 * _admin.js — "so admin" de verdade (Ailson 23/09/2026, Fase 0 da fase de protecao).
 *
 * Antes: varios endpoints aceitavam como admin quem mandasse o cabecalho `X-User: ailson`
 * (qualquer um consegue mandar). Com isso dava pra trocar senha, se dar admin e mudar as
 * chaves do saude_config. Agora admin = TOKEN DE SESSAO valido com adm=true, usuario ativo
 * e na mesma versao (senha trocada / desativado derruba).
 *
 * Chave de volta SEM DEPLOY (se algo travar): no SQL Editor
 *   update saude_config set valor='on' where chave='admin_legado';
 * -> volta a aceitar o X-User ailson (registrando cada uso em app_erros, modulo 'seguranca').
 * Toda recusa tambem fica em app_erros (modulo 'seguranca'), pra conferir se alguem legitimo caiu.
 */
import { sessaoDe } from './_sessao.js';
import { supabase } from './_ml-helpers.js';

let _legado = null, _legadoEm = 0;
async function legadoLigado() {
  if (_legado !== null && Date.now() - _legadoEm < 60000) return _legado;
  try {
    const { data } = await supabase.from('saude_config').select('valor').eq('chave', 'admin_legado').maybeSingle();
    _legado = String(data?.valor || '') === 'on';
  } catch { _legado = false; }
  _legadoEm = Date.now();
  return _legado;
}

function registrar(req, mensagem, usuario) {
  try {
    supabase.from('app_erros').insert({
      modulo: 'seguranca', usuario: usuario || null, mensagem: String(mensagem).slice(0, 300),
      url: String(req.url || '').slice(0, 300),
      aparelho: String(req.headers['user-agent'] || '').slice(0, 200),
      assinatura: 'admin:' + String(req.headers['x-forwarded-for'] || '').split(',')[0].trim(),
    }).then(() => {}, () => {});
  } catch { /* nunca derruba */ }
}

/** Devolve { usuario } se for admin; senao responde 401/403 e devolve null. */
export async function exigirAdmin(req, res, contexto = '') {
  const s = await sessaoDe(req);
  if (s.ok && s.claims?.adm) {
    try {
      const { data: u } = await supabase.from('app_usuarios').select('ativo, versao, admin').eq('usuario', s.claims.sub).maybeSingle();
      if (u && u.ativo && u.admin !== false && Number(u.versao || 1) === Number(s.claims.ver || 1)) return { usuario: s.claims.sub };
      registrar(req, `${contexto}: recusado (usuario inativo/versao/admin mudou)`, s.claims.sub);
      res.status(401).json({ ok: false, erro: 'sessão encerrada — faça login de novo' });
      return null;
    } catch (e) {
      // banco fora: com token admin valido, deixa passar (nao trava o admin por instabilidade)
      return { usuario: s.claims.sub };
    }
  }
  const xu = String(req.headers['x-user'] || '').toLowerCase();
  if (xu === 'ailson' && await legadoLigado()) {
    registrar(req, `${contexto}: aceito pelo X-User (admin_legado=on)`, 'ailson');
    return { usuario: 'ailson', legado: true };
  }
  registrar(req, `${contexto}: recusado (${s.ok ? 'token sem admin' : s.motivo || 'sem token'})`, s.claims?.sub || xu || null);
  res.status(s.ok ? 403 : 401).json({ ok: false, error: 'Apenas admin', erro: s.ok ? 'só admin' : 'faça login de novo' });
  return null;
}
