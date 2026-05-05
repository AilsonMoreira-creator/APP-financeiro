// ═══════════════════════════════════════════════════════════════════════════
// /api/lojas-vesti-salvar
// ═══════════════════════════════════════════════════════════════════════════
// POST: vendedora salva seus links Vesti (até 3) e marca qual é o ativo.
//
// Bug fix Ailson 05/05/2026: o frontend tentava fazer .update() direto na
// tabela lojas_vendedoras com o anon key, mas as RLS policies só liberam
// UPDATE pra service_role (admin) ou via app_full_access que era exclusiva
// do backend. Vendedoras logam com header user-id customizado (sem
// supabase.auth.signIn) então auth.role() = 'anon' — UPDATE silenciava.
//
// Fix: rotear pelo backend que usa SERVICE_ROLE_KEY (bypassa RLS).
// ═══════════════════════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY  // service role
);

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-user-id');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { vendedora_id, link_1, link_2, link_3, link_ativo } = req.body || {};

    if (!vendedora_id) {
      return res.status(400).json({ error: 'vendedora_id obrigatorio' });
    }

    // Validação básica de URL (evita lixo no banco)
    const validar = (s) => {
      if (!s) return true;
      try {
        const u = new URL(String(s).trim());
        return u.protocol === 'http:' || u.protocol === 'https:';
      } catch {
        return false;
      }
    };
    if (!validar(link_1) || !validar(link_2) || !validar(link_3)) {
      return res.status(400).json({ error: 'URL inválida (precisa começar com http:// ou https://)' });
    }

    // Validar que ativo bate com algum link preenchido
    let ativoFinal = link_ativo;
    if (ativoFinal === 1 && !(link_1 && String(link_1).trim())) ativoFinal = null;
    if (ativoFinal === 2 && !(link_2 && String(link_2).trim())) ativoFinal = null;
    if (ativoFinal === 3 && !(link_3 && String(link_3).trim())) ativoFinal = null;

    const { error } = await supabase
      .from('lojas_vendedoras')
      .update({
        vesti_link_1: link_1 ? String(link_1).trim() : null,
        vesti_link_2: link_2 ? String(link_2).trim() : null,
        vesti_link_3: link_3 ? String(link_3).trim() : null,
        vesti_link_ativo: ativoFinal,
      })
      .eq('id', vendedora_id);

    if (error) {
      console.error('[lojas-vesti-salvar] supabase erro:', error);
      return res.status(500).json({ error: error.message });
    }

    return res.json({ ok: true });
  } catch (e) {
    console.error('[lojas-vesti-salvar] erro:', e?.message);
    return res.status(500).json({ error: e?.message || 'Erro' });
  }
}
