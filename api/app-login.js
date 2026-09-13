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
      if (!usuario || !senha) continue;
      const senha_hash = await bcrypt.hash(senha, 10);
      await supabase.from('app_usuarios').upsert({ usuario, senha_hash, ativo: u.ativo !== false, atualizado_em: new Date().toISOString() }, { onConflict: 'usuario' });
      n++;
    }
    return res.status(200).json({ ok: true, sincronizados: n });
  }

  // ── validar ──
  const usuario = String(body.usuario || '').replace(/\s/g, '').toLowerCase();
  const senha = String(body.senha || '').replace(/\s/g, '');
  const { data: cfg } = await supabase.from('saude_config').select('valor').eq('chave', 'login_modo').maybeSingle();
  const modo = cfg?.valor || 'sombra';
  const ip = ipDe(req);
  if (!usuario || !senha) return res.status(200).json({ ok: false, modo, motivo: 'vazio' });

  const { data: u } = await supabase.from('app_usuarios').select('usuario, senha_hash, ativo').eq('usuario', usuario).maybeSingle();
  let ok = false;
  if (u && u.ativo) { try { ok = await bcrypt.compare(senha, u.senha_hash); } catch { ok = false; } }
  const concorda = typeof body.local_ok === 'boolean' ? (body.local_ok === ok) : null;
  await supabase.from('app_login_tentativas').insert({ usuario, ip, ok, modo, concorda_com_local: concorda });
  return res.status(200).json({ ok, modo, concorda, cadastrado: !!u });
}
