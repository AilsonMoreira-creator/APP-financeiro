// app-sessao.js — registro de APARELHOS por login (Ailson 01/09/2026)
//
// Pergunta dele: "como saber se o Pedro passou o login (e o link) pra outros
// funcionarios?". O login e local (usuario+senha no navegador), entao sozinho
// nao diz DE ONDE veio. Aqui cada navegador ganha um device_id (uuid guardado
// no localStorage) e o app registra: no login e a cada ~30 min de uso.
//
//   POST { usuario, device_id, ua, tela, evento:'login'|'ping' }
//     -> upsert (usuario, device_id), ip do header, ultimo_em=now
//     -> devolve { ok, revogado } — revogado=true faz o app derrubar a sessao
//   GET  ?listar=1   -> aparelhos por usuario (tela Usuarios, admin)
//   POST { revogar: id }  -> carimba revogado_em (desconecta aquele aparelho)
//   POST { liberar: id }  -> limpa revogado_em
//
// RLS ligado em app_sessoes: so a service key (esta API) le/escreve.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY);

function resumoAparelho(ua) {
  const s = String(ua || '');
  let so = 'Outro';
  if (/iPhone/i.test(s)) so = 'iPhone';
  else if (/iPad/i.test(s)) so = 'iPad';
  else if (/Android/i.test(s)) so = 'Android';
  else if (/Windows/i.test(s)) so = 'Windows';
  else if (/Macintosh|Mac OS/i.test(s)) so = 'Mac';
  else if (/Linux/i.test(s)) so = 'Linux';
  let nav = 'navegador';
  if (/Edg\//i.test(s)) nav = 'Edge';
  else if (/OPR\//i.test(s)) nav = 'Opera';
  else if (/Chrome\//i.test(s) && !/Edg\//i.test(s)) nav = 'Chrome';
  else if (/Safari\//i.test(s) && !/Chrome\//i.test(s)) nav = 'Safari';
  else if (/Firefox\//i.test(s)) nav = 'Firefox';
  const pwa = /wv\)|; wv/i.test(s) ? ' · app' : '';
  return `${so} · ${nav}${pwa}`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET' && req.query?.listar) {
      const { data, error } = await supabase.from('app_sessoes')
        .select('id, usuario, device_id, aparelho, tela, ip, primeiro_em, ultimo_em, pings, revogado_em, encerrado_em, encerrado_motivo')
        .order('ultimo_em', { ascending: false }).limit(500);
      if (error) return res.status(500).json({ ok: false, erro: error.message });
      const porUsuario = {};
      for (const r of data || []) (porUsuario[r.usuario] = porUsuario[r.usuario] || []).push(r);
      return res.status(200).json({ ok: true, por_usuario: porUsuario });
    }

    if (req.method !== 'POST') return res.status(405).json({ ok: false });
    const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

    if (b.revogar || b.liberar) {
      const id = Number(b.revogar || b.liberar);
      const { error } = await supabase.from('app_sessoes')
        .update({ revogado_em: b.revogar ? new Date().toISOString() : null }).eq('id', id);
      if (error) return res.status(500).json({ ok: false, erro: error.message });
      return res.status(200).json({ ok: true });
    }

    const usuario = String(b.usuario || '').trim().toLowerCase();
    const device_id = String(b.device_id || '').trim();
    if (!usuario || !device_id) return res.status(400).json({ ok: false, erro: 'usuario e device_id obrigatorios' });

    const ip = String(req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || '').split(',')[0].trim() || null;
    const ua = String(b.ua || req.headers['user-agent'] || '').slice(0, 400);

    // 01/09 (pedido dele): SESSAO UNICA — pedro (fixo) ou usuario com
    // sessaoUnica marcado na tela Usuarios. "Ativo" = deu sinal nos ultimos
    // 45 min (o ping roda a cada 30 min de uso). Outro aparelho ativo =>
    // este login e RECUSADO com alerta. Se o outro esta parado, entra aqui
    // e o antigo e encerrado (cai pro login no proximo sinal dele).
    const sessaoUnica = usuario === 'pedro' || b.sessao_unica === true;
    if (b.evento === 'logout') {
      await supabase.from('app_sessoes').update({ encerrado_em: new Date().toISOString(), encerrado_motivo: 'logout' })
        .eq('usuario', usuario).eq('device_id', device_id);
      return res.status(200).json({ ok: true });
    }
    if (b.evento === 'login' && sessaoUnica) {
      const limite = new Date(Date.now() - 45 * 60 * 1000).toISOString();
      const { data: outras } = await supabase.from('app_sessoes')
        .select('id, aparelho, ultimo_em').eq('usuario', usuario).neq('device_id', device_id)
        .is('encerrado_em', null).is('revogado_em', null).gt('ultimo_em', limite)
        .order('ultimo_em', { ascending: false }).limit(1);
      if (outras && outras.length) {
        return res.status(200).json({ ok: false, bloqueado: true, aparelho: outras[0].aparelho, ultimo_em: outras[0].ultimo_em });
      }
      await supabase.from('app_sessoes').update({ encerrado_em: new Date().toISOString(), encerrado_motivo: 'entrou em outro aparelho' })
        .eq('usuario', usuario).neq('device_id', device_id).is('encerrado_em', null);
    }

    const { data: ex } = await supabase.from('app_sessoes')
      .select('id, pings, revogado_em, encerrado_em').eq('usuario', usuario).eq('device_id', device_id).maybeSingle();

    if (ex) {
      // ping numa sessao encerrada (substituida/logout) => o app derruba pro login
      if (b.evento === 'ping' && ex.encerrado_em) {
        return res.status(200).json({ ok: true, revogado: !!ex.revogado_em, encerrado: true });
      }
      await supabase.from('app_sessoes').update({
        ultimo_em: new Date().toISOString(), ip, user_agent: ua, aparelho: resumoAparelho(ua),
        tela: b.tela || null, pings: (ex.pings || 0) + 1,
        // re-login no mesmo aparelho reativa a sessao; revogado continua ate o admin liberar
        ...(b.evento === 'login' ? { encerrado_em: null, encerrado_motivo: null } : {}),
      }).eq('id', ex.id);
      return res.status(200).json({ ok: true, revogado: !!ex.revogado_em, encerrado: false });
    }
    const { error } = await supabase.from('app_sessoes').insert({
      usuario, device_id, aparelho: resumoAparelho(ua), user_agent: ua, tela: b.tela || null, ip,
    });
    if (error) return res.status(500).json({ ok: false, erro: error.message });
    return res.status(200).json({ ok: true, revogado: false, novo: true });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: String(e?.message || e) });
  }
}
