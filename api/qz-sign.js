// /api/qz-sign — assina as conexões do QZ Tray com o certificado do Grupo
// Amícia (Ailson 19/08/2026). Sem assinatura o QZ trata o app como "anonymous
// request / Untrusted website" e NÃO memoriza o Allow (volta a perguntar a
// cada reinício). Com a assinatura o Remember vira permanente.
// Chave privada em amicia_data user_id='qz-sign-key' (só service role lê).
// O certificado público correspondente está em public/qz-cert.crt.
import crypto from 'crypto';
import { supabase } from './_lojas-whats-helpers.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, erro: 'POST' });

  try {
    let body = req.body;
    if (typeof body === 'string') body = JSON.parse(body || '{}');
    const toSign = body?.toSign;
    if (!toSign || typeof toSign !== 'string' || toSign.length > 4096) {
      return res.status(400).json({ ok: false, erro: 'toSign invalido' });
    }
    const { data } = await supabase.from('amicia_data')
      .select('payload').eq('user_id', 'qz-sign-key').maybeSingle();
    const pem = data?.payload?.pem;
    if (!pem) return res.status(500).json({ ok: false, erro: 'chave de assinatura ausente' });

    const assinatura = crypto.createSign('SHA512').update(toSign).sign(pem, 'base64');
    return res.status(200).json({ ok: true, assinatura });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: e.message });
  }
}
