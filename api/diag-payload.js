// api/diag-payload.js — Diagnóstico: mostra estado real do payload no Supabase
// GET /api/diag-payload

import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache');
  try {
    // Busca payload principal
    const { data: main, error: e1 } = await supabase
      .from('amicia_data').select('payload').eq('user_id', 'amicia-admin').single();
    
    // Busca usuarios
    const { data: usr, error: e2 } = await supabase
      .from('amicia_data').select('payload').eq('user_id', 'usuarios').single();

    // Busca cortes
    const { data: cortes, error: e3 } = await supabase
      .from('amicia_data').select('payload').eq('user_id', 'ailson_cortes').single();

    const p = main?.payload || {};
    const u = usr?.payload || {};
    const c = cortes?.payload || {};

    return res.status(200).json({
      timestamp: new Date().toISOString(),
      
      amicia_admin: {
        _updated: p._updated ? new Date(p._updated).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : 'sem timestamp',
        _updated_raw: p._updated || null,
        receitasPorMes: {
          meses_presentes: Object.keys(p.receitasPorMes || {}),
          total_meses: Object.keys(p.receitasPorMes || {}).length,
          // Mostra resumo por mês (total de dias com dados)
          resumo: Object.fromEntries(
            Object.entries(p.receitasPorMes || {}).map(([m, dias]) => [
              m, 
              typeof dias === 'object' ? `${Object.keys(dias).length} dias com dados` : 'vazio'
            ])
          ),
        },
        auxDataPorMes_meses: Object.keys(p.auxDataPorMes || {}),
        categoriasPorMes_meses: Object.keys(p.categoriasPorMes || {}),
        boletos: {
          total: (p.boletosShared || []).length,
          pagos: (p.boletosShared || []).filter(b => b.pago).length,
          nao_pagos: (p.boletosShared || []).filter(b => !b.pago).length,
        },
        produtos_count: (p.produtos || []).length,
        oficinasCAD_count: (p.oficinasCAD || []).length,
        prestadores_count: Object.keys(p.prestadores || {}).length,
        fixosConfig: p.fixosConfig ? 'presente' : 'ausente',
        fixosNomesFunc: p.fixosNomesFunc ? 'presente' : 'ausente',
        tecidosCAD_count: (p.tecidosCAD || []).length,
        error: e1?.message || null,
      },

      usuarios: {
        _updated: u._updated ? new Date(u._updated).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : 'sem timestamp',
        total: (u.usuarios || []).length,
        lista: (u.usuarios || []).map(usr => ({
          id: usr.id,
          usuario: usr.usuario,
          admin: usr.admin,
          modulos: usr.modulos,
          _mod: usr._mod ? new Date(usr._mod).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : 'sem _mod',
        })),
        error: e2?.message || null,
      },

      ailson_cortes: {
        cortes_count: (c.cortes || []).length,
        produtos_count: (c.produtos || []).length,
        oficinasCAD_count: (c.oficinasCAD || []).length,
        error: e3?.message || null,
      },
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
