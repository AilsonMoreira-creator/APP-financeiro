// app-erro.js — relato de erro do proprio app (Ailson 13/09/2026)
//
// O front manda pra ca qualquer erro de tela: window.onerror, promessa
// rejeitada e o "Erro no modulo" (ErrorBoundary). O monitor de saude conta e
// a pagina Saude lista. Sem token nenhum: so grava. Protecoes contra abuso:
// mensagem/stack cortados, no maximo 1 registro por (aparelho, assinatura) a
// cada 10 min, e no maximo 30 por aparelho por hora.

import { supabase, setCors } from './_lojas-helpers.js';

export const config = { maxDuration: 10 };

const assinaturaDe = (msg, modulo) => {
  const base = String(modulo || '') + '|' + String(msg || '').replace(/\d+/g, '#').slice(0, 160);
  let h = 0; for (let i = 0; i < base.length; i++) h = (h * 31 + base.charCodeAt(i)) >>> 0;
  return h.toString(36);
};

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST' });
  try {
    const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const mensagem = String(b.mensagem || '').slice(0, 300);
    if (!mensagem) return res.status(200).json({ ok: false });
    const device_id = String(b.device_id || '').slice(0, 80) || null;
    const modulo = String(b.modulo || '').slice(0, 40) || null;
    const assinatura = assinaturaDe(mensagem, modulo);
    const dez = new Date(Date.now() - 10 * 60000).toISOString();
    const uma = new Date(Date.now() - 3600000).toISOString();
    if (device_id) {
      const { count: rep } = await supabase.from('app_erros').select('id', { count: 'exact', head: true }).eq('device_id', device_id).eq('assinatura', assinatura).gte('criado_em', dez);
      if ((rep || 0) > 0) return res.status(200).json({ ok: true, repetido: true });
      const { count: hora } = await supabase.from('app_erros').select('id', { count: 'exact', head: true }).eq('device_id', device_id).gte('criado_em', uma);
      if ((hora || 0) >= 30) return res.status(200).json({ ok: true, limitado: true });
    }
    await supabase.from('app_erros').insert({
      usuario: String(b.usuario || '').slice(0, 40) || null, modulo, device_id,
      aparelho: String(b.aparelho || req.headers['user-agent'] || '').slice(0, 160) || null,
      mensagem, stack: String(b.stack || '').slice(0, 1500) || null, url: String(b.url || '').slice(0, 200) || null,
      versao_sw: String(b.versao_sw || '').slice(0, 40) || null, assinatura,
    });
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(200).json({ ok: false, erro: String(e?.message || e) });
  }
}
