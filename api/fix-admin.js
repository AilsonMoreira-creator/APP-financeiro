// api/fix-admin.js — Corrige admin:false no usuario admin (EMERGÊNCIA)
// GET /api/fix-admin

import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const { data } = await supabase.from('amicia_data').select('payload').eq('user_id', 'usuarios').single();
    if (!data?.payload?.usuarios) return res.json({ error: 'sem usuarios' });

    const usuarios = data.payload.usuarios;
    const adminUser = usuarios.find(u => u.id === 1 || u.usuario === 'admin');
    
    if (!adminUser) return res.json({ error: 'usuario admin não encontrado' });

    const antes = { ...adminUser };
    
    // Fix: admin SEMPRE true pra user id=1
    adminUser.admin = true;
    adminUser._mod = Date.now();

    const payload = { usuarios, _updated: Date.now() };
    const { error } = await supabase.from('amicia_data').upsert({
      user_id: 'usuarios', payload
    }, { onConflict: 'user_id' });

    return res.json({
      ok: !error,
      antes: { id: antes.id, usuario: antes.usuario, admin: antes.admin },
      depois: { id: adminUser.id, usuario: adminUser.usuario, admin: adminUser.admin },
      error: error?.message || null,
      instrucao: 'Recarregue o app e faça login novamente como admin.'
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
