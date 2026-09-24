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
import { exigirAdmin } from './_admin.js';

export const config = { maxDuration: 20 };   // 11/09: rota de tela — nao segura conexao por 5 min

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


// ── 23/09/2026 APARELHOS CONHECIDOS — fase SOMBRA (aprovado por Ailson) ──────────
// Regra: aparelho conhecido entra de qualquer IP; novo DENTRO da empresa (IP onde 3+ usuarios
// usam na semana) entra e vira aprovado; novo FORA da empresa ficaria PENDENTE (liberacao so por
// ailson/admin). Em 'sombra' (saude_config.aparelhos_modo) NADA e bloqueado: so registra em
// app_aparelhos_sombra o que aconteceria. Nunca derruba a chamada (tudo em try/catch).
let _ipsEmp = null, _ipsEmpEm = 0;
async function ipsEmpresa() {
  if (_ipsEmp && Date.now() - _ipsEmpEm < 10 * 60000) return _ipsEmp;
  const { data } = await supabase.rpc('app_ips_empresa', { p_dias: 7, p_min: 3 });
  _ipsEmp = new Set((data || []).map(r => r.ip)); _ipsEmpEm = Date.now();
  return _ipsEmp;
}
const _vistoAparelho = new Map();   // device|usuario -> ms (processa no maximo a cada 20 min por instancia)
async function avaliarAparelho({ usuario, device_id, ip, evento, aparelho }) {
  try {
    const k = device_id + '|' + usuario;
    if (evento !== 'login' && Date.now() - (_vistoAparelho.get(k) || 0) < 20 * 60000) return null;
    _vistoAparelho.set(k, Date.now());
    let decisao;
    if (!device_id || device_id === 'sem-storage') decisao = 'sem_device';
    else {
      const { data: ap } = await supabase.from('app_aparelhos').select('status, usuarios').eq('device_id', device_id).maybeSingle();
      const agora = new Date().toISOString();
      if (ap) {
        decisao = ap.status === 'aprovado' ? 'conhecido' : ap.status;   // pendente | recusado
        const us = Array.from(new Set([...(ap.usuarios || []), usuario]));
        await supabase.from('app_aparelhos').update({ ultimo_usuario: usuario, usuarios: us, ultimo_ip: ip, ultimo_em: agora, aparelho }).eq('device_id', device_id);
      } else {
        const naEmpresa = ip && (await ipsEmpresa()).has(ip);
        decisao = naEmpresa ? 'novo_empresa' : 'pendente';
        await supabase.from('app_aparelhos').insert({
          device_id, status: naEmpresa ? 'aprovado' : 'pendente', origem: naEmpresa ? 'ip_empresa' : 'fora_empresa',
          aparelho, primeiro_usuario: usuario, ultimo_usuario: usuario, usuarios: [usuario],
          primeiro_ip: ip, ultimo_ip: ip, ultimo_em: agora, decidido_em: naEmpresa ? agora : null, decidido_por: naEmpresa ? 'auto:ip_empresa' : null,
        });
      }
    }
    await supabase.rpc('app_aparelho_sombra_registrar', { p_device: device_id || '', p_usuario: usuario, p_decisao: decisao, p_ip: ip, p_evento: evento || null, p_aparelho: aparelho });
    return decisao;
  } catch (e) { console.error('[app-sessao] aparelho (sombra):', e?.message || e); return null; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET' && req.query?.listar) {
      if (!(await exigirAdmin(req, res, 'app-sessao listar'))) return;   // 23/09 Fase 0 (lista IPs/aparelhos de todos)
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

    // 13/09 (pedido dele): usuarios ATIVOS = interagiram nos ultimos 15 min
    // (clique, tecla, mudanca de aba) — nao basta ter logado. GET ?ativos=1
    if (req.method === 'GET' && req.query?.ativos === '1') {
      const desde = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      const { data } = await supabase.from('app_sessoes')
        .select('usuario, modulo, aparelho, ultima_atividade_em')
        .gte('ultima_atividade_em', desde).is('encerrado_em', null).is('revogado_em', null)
        .order('ultima_atividade_em', { ascending: false });
      const vistos = new Set(); const ativos = [];
      for (const r of (data || [])) { const k = r.usuario + '|' + r.aparelho; if (vistos.has(k)) continue; vistos.add(k); ativos.push(r); }
      return res.status(200).json({ ok: true, ativos, desde });
    }
    if (b.revogar || b.liberar) {
      if (!(await exigirAdmin(req, res, 'app-sessao revogar/liberar'))) return;   // 23/09 Fase 0
      const id = Number(b.revogar || b.liberar);
      const { error } = await supabase.from('app_sessoes')
        .update({ revogado_em: b.revogar ? new Date().toISOString() : null }).eq('id', id);
      if (error) return res.status(500).json({ ok: false, erro: error.message });
      return res.status(200).json({ ok: true });
    }

    const usuario = String(b.usuario || '').trim().toLowerCase();
    let device_id = String(b.device_id || '').trim();
    if (!usuario || !device_id) return res.status(400).json({ ok: false, erro: 'usuario e device_id obrigatorios' });
    // 24/09: 2a copia do id do aparelho num cookie HttpOnly do servidor (sobrevive ao localStorage
    // limpo). Se o navegador chegou com um id NOVO mas o cookie traz um id JA CONHECIDO, adota o do
    // cookie e devolve pra tela (a tela grava de volta). Nunca derruba a chamada.
    try {
      const ck = String(req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('amica_dev='));
      const doCookie = ck ? decodeURIComponent(ck.slice('amica_dev='.length)) : '';
      if (doCookie && doCookie !== device_id && doCookie !== 'sem-storage') {
        const { data: ids } = await supabase.from('app_aparelhos').select('device_id').in('device_id', [doCookie, device_id]);
        const conhecidos = new Set((ids || []).map(r => r.device_id));
        if (conhecidos.has(doCookie) && !conhecidos.has(device_id)) device_id = doCookie;
      }
      if (device_id !== 'sem-storage') {
        res.setHeader('Set-Cookie', `amica_dev=${encodeURIComponent(device_id)}; Path=/; Max-Age=34560000; HttpOnly; Secure; SameSite=Lax`);
      }
    } catch { /* segue com o id do navegador */ }
    { const _json = res.json.bind(res); res.json = (o) => _json(o && typeof o === 'object' && !Array.isArray(o) ? { ...o, device_id } : o); }

    const ip = String(req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || '').split(',')[0].trim() || null;
    const ua = String(b.ua || req.headers['user-agent'] || '').slice(0, 400);
    // 23/09: aparelhos conhecidos (SOMBRA — so registra; nao muda a resposta)
    if (b.evento !== 'logout') await avaliarAparelho({ usuario, device_id, ip, evento: b.evento || 'ping', aparelho: resumoAparelho(ua) });

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
        // 13/09: 'atividade' carimba interacao real + modulo em que estava
        ...(b.evento === 'atividade' || b.evento === 'login' ? { ultima_atividade_em: new Date().toISOString(), modulo: String(b.modulo || '').slice(0, 40) || null } : {}),
        // re-login no mesmo aparelho reativa a sessao; revogado continua ate o admin liberar
        ...(b.evento === 'login' ? { encerrado_em: null, encerrado_motivo: null } : {}),
      }).eq('id', ex.id);
      return res.status(200).json({ ok: true, revogado: !!ex.revogado_em, encerrado: false });
    }
    const { error } = await supabase.from('app_sessoes').insert({
      usuario, device_id, aparelho: resumoAparelho(ua), user_agent: ua, tela: b.tela || null, ip,
      ultima_atividade_em: new Date().toISOString(), modulo: String(b.modulo || '').slice(0, 40) || null,
    });
    if (error) return res.status(500).json({ ok: false, erro: error.message });
    return res.status(200).json({ ok: true, revogado: false, novo: true });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: String(e?.message || e) });
  }
}
