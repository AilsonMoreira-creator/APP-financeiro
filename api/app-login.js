// app-login.js — validacao de login NO SERVIDOR (Ailson 12/09/2026, passo 1)
//
// Hoje o login e local: a lista de usuarios (com senha) vive no payload do app
// e a comparacao acontece no navegador. Rate limit ali nao protege nada. O
// caminho e trazer a validacao pro servidor com senha em HASH (bcrypt).
//
// PASSO 1 (este arquivo, modo "sombra"): o app CONTINUA logando pelo jeito
// local e apenas informa o servidor, que compara com app_usuarios e registra
// se concordou. Nao decide nada. Depois de uma semana batendo, vira o passo 2.
//
//   POST { usuario, senha, local_ok, device_id }
//     -> { ok, modo, concorda }   (modo 'sombra': ok = resultado do servidor, so pra registro)
//   POST { sincronizar: [{usuario, senha}] }  (admin) -> grava/atualiza hashes
//     -> usado uma vez pra popular app_usuarios a partir da lista atual do app
//
// Sem senha em texto no banco: so o hash. Sem senha no log: so usuario/ip/ok.

import bcrypt from 'bcryptjs';
import { emitirToken, sessaoDe, sombraSessao } from './_sessao.js';   // 20/09: PASSO 4 fase 1 (token de sessao, ainda sem exigir)
import { supabase, setCors } from './_lojas-helpers.js';

export const config = { maxDuration: 15 };

const ipDe = (req) => String(req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || '').split(',')[0].trim() || null;

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST' });
  const body = req.body || {};

  // ── sincronizar hashes (admin, pelo header X-User = ailson) ──
  if (Array.isArray(body.sincronizar)) {
    if (String(req.headers['x-user'] || '') !== 'ailson') return res.status(403).json({ error: 'Apenas admin' });
    let n = 0;
    for (const u of body.sincronizar) {
      const usuario = String(u.usuario || '').trim().toLowerCase();
      const senha = String(u.senha || '');
      if (!usuario) continue;
      const { data: atual } = await supabase.from('app_usuarios').select('usuario, ativo, versao').eq('usuario', usuario).maybeSingle();
      const linha = { usuario, ativo: u.ativo !== false, atualizado_em: new Date().toISOString() };
      if (Array.isArray(u.modulos)) linha.modulos = u.modulos;      // 20/09: modulos/admin vivem no servidor (viram claims do token)
      if (typeof u.admin === 'boolean') linha.admin = u.admin;
      // versao sobe quando a senha muda ou o usuario e desativado -> tokens antigos deixam de valer
      let sobe = false;
      if (senha) { linha.senha_hash = await bcrypt.hash(senha, 10); sobe = true; }
      if (atual && atual.ativo && u.ativo === false) sobe = true;
      if (!atual && !senha) continue;                                 // usuario novo sem senha nao entra
      if (sobe) linha.versao = Number(atual?.versao || 1) + 1;
      await supabase.from('app_usuarios').upsert(linha, { onConflict: 'usuario' });
      n++;
    }
    return res.status(200).json({ ok: true, sincronizados: n });
  }

  // ── renovar token (app faz em silencio depois de 6h) ──
  if (body.renovar === true) {
    const s = await sessaoDe(req);
    if (!s.ok) return res.status(200).json({ ok: false, motivo: s.motivo });
    const { data: u } = await supabase.from('app_usuarios').select('usuario, ativo, versao, modulos, admin').eq('usuario', s.claims.sub).maybeSingle();
    if (!u || !u.ativo || Number(u.versao || 1) !== Number(s.claims.ver || 1)) return res.status(200).json({ ok: false, motivo: 'sessao encerrada' });
    const token = await emitirToken({ usuario: u.usuario, modulos: u.modulos || s.claims.mod, admin: u.admin ?? s.claims.adm, versao: u.versao });
    return res.status(200).json({ ok: true, token });
  }

  // ── validar ──
  // 19/09: desbloqueio manual — grava um "ok" sintetico que zera a sequencia de erros
  if (body.desbloquear && String(req.headers['x-user'] || '').toLowerCase() === 'ailson') {
    const alvo = String(body.desbloquear).replace(/\s/g, '').toLowerCase();
    await supabase.from('app_login_tentativas').insert({ usuario: alvo, ip: 'desbloqueio-manual', ok: true, modo: 'desbloqueio', concorda_com_local: null });
    return res.status(200).json({ ok: true, desbloqueado: alvo });
  }
  const usuario = String(body.usuario || '').replace(/\s/g, '').toLowerCase();
  const senha = String(body.senha || '').replace(/\s/g, '');
  const { data: cfg } = await supabase.from('saude_config').select('valor').eq('chave', 'login_modo').maybeSingle();
  const modo = cfg?.valor || 'sombra';
  const ip = ipDe(req);
  if (!usuario || !senha) return res.status(200).json({ ok: false, modo, motivo: 'vazio' });

  // ── PASSO 3 (19/09, aprovado por ele): RATE LIMIT de verdade ─────────────────
  // So faz sentido agora que TODA tentativa passa por aqui (passo 2). Regra:
  //   5 erros seguidos (por usuario OU por IP) nos ultimos 10 min -> espera 1 min
  //  10 erros seguidos                                          -> espera 15 min
  // "Seguidos" = desde o ultimo login ok. Admin nunca fica mais de 15 min preso.
  // Desbloqueio manual: ?desbloquear=USUARIO (X-User ailson) zera o contador.
  // Falha ao consultar o contador NUNCA bloqueia (fail-open) — pior caso vira
  // "como hoje", nao "ninguem entra".
  let bloqueadoAte = null;
  try {
    const desde10 = new Date(Date.now() - 10 * 60000).toISOString();
    const [{ data: porUsr }, { data: porIp }] = await Promise.all([
      supabase.from('app_login_tentativas').select('ok, criado_em, modo').eq('usuario', usuario).gte('criado_em', desde10).order('criado_em', { ascending: false }).limit(20),
      supabase.from('app_login_tentativas').select('ok, criado_em').eq('ip', ip).gte('criado_em', desde10).order('criado_em', { ascending: false }).limit(20),
    ]);
    const seguidos = (lista) => { let n = 0; for (const t of (lista || [])) { if (t.ok) break; n++; } return n; };
    // desbloqueio manual recente pro usuario vale pros dois contadores
    const desbloqueado = (porUsr || []).some(t => t.ok && t.modo === 'desbloqueio');
    const erros = desbloqueado ? 0 : Math.max(seguidos(porUsr), seguidos(porIp));
    const ultimoErro = [...(porUsr || []), ...(porIp || [])].filter(t => !t.ok).map(t => new Date(t.criado_em).getTime()).sort((a, b) => b - a)[0] || 0;
    const esperaMin = erros >= 10 ? 15 : erros >= 5 ? 1 : 0;
    if (esperaMin && ultimoErro + esperaMin * 60000 > Date.now()) bloqueadoAte = new Date(ultimoErro + esperaMin * 60000).toISOString();
  } catch (e) { bloqueadoAte = null; console.error('[app-login] rate limit indisponivel (fail-open):', e?.message || e); }
  if (bloqueadoAte) {
    const segundos = Math.max(1, Math.round((new Date(bloqueadoAte).getTime() - Date.now()) / 1000));
    await supabase.from('app_login_tentativas').insert({ usuario, ip, ok: false, modo, concorda_com_local: null }).then?.(() => {}, () => {});
    return res.status(200).json({ ok: false, modo, bloqueado: true, segundos, ate: bloqueadoAte,
      erro: `Muitas tentativas. Aguarde ${segundos >= 60 ? Math.ceil(segundos / 60) + ' min' : segundos + ' s'} e tente de novo.` });
  }

  const { data: u } = await supabase.from('app_usuarios').select('usuario, senha_hash, ativo, modulos, admin, versao').eq('usuario', usuario).maybeSingle();
  let ok = false;
  if (u && u.ativo) { try { ok = await bcrypt.compare(senha, u.senha_hash); } catch { ok = false; } }
  // 20/09 — PASSO 4 fase 1: login aprovado devolve o token de sessao (12h). Os modulos/admin
  // vem do que a tela Usuarios sincronizou; se ainda nao tiver, o app manda os dele no login
  // (body.modulos/admin) so pra preencher — o servidor grava e passa a ser a fonte.
  let token = null;
  if (ok) {
    let modulos = Array.isArray(u.modulos) ? u.modulos : null, admin = u.admin;
    if (!modulos && Array.isArray(body.modulos)) { modulos = body.modulos; admin = !!body.admin; try { await supabase.from('app_usuarios').update({ modulos, admin }).eq('usuario', usuario); } catch {} }
    try { token = await emitirToken({ usuario, modulos: modulos || [], admin: !!admin, versao: u.versao }); } catch (e) { token = null; }
  }
  const concorda = typeof body.local_ok === 'boolean' ? (body.local_ok === ok) : null;
  await supabase.from('app_login_tentativas').insert({ usuario, ip, ok, modo, concorda_com_local: concorda });
  // 18/09 — PASSO 2: no modo 'servidor' a resposta DECIDE o login. Duas saidas
  // de seguranca, pra ninguem ficar de fora por causa de cadastro:
  //   · usuario sem hash em app_usuarios -> o servidor nao nega, devolve
  //     `sem_cadastro` e o app cai no local (e sincroniza o hash depois).
  //   · o app tambem cai no local se a chamada falhar ou demorar (lado do front).
  return res.status(200).json({ ok, modo, concorda, cadastrado: !!u, sem_cadastro: !u, token });
}
