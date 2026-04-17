/**
 * ml-estoque-scan-scf.js — Varre TODOS os anúncios da Lumia e coleta
 * o seller_custom_field de cada um. Serve pra ver padrões reais.
 */
import { supabase, getValidToken } from './_ml-helpers.js';

const ML_API = 'https://api.mercadolibre.com';

export default async function handler(req, res) {
  try {
    const token = await getValidToken('Lumia');
    const { data: tokRec } = await supabase.from('ml_tokens').select('seller_id').eq('brand', 'Lumia').single();
    const sellerId = tokRec?.seller_id;

    // Lista todos IDs
    const allIds = [];
    let offset = 0;
    while (offset < 500) {
      const r = await fetch(
        `${ML_API}/users/${sellerId}/items/search?status=active&offset=${offset}&limit=100`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!r.ok) break;
      const d = await r.json();
      const results = d.results || [];
      if (results.length === 0) break;
      allIds.push(...results);
      if (results.length < 100) break;
      offset += 100;
    }

    // Multiget em batches — pega SÓ o que interessa
    const coletados = [];
    for (let i = 0; i < allIds.length; i += 20) {
      const batch = allIds.slice(i, i + 20);
      const r = await fetch(
        `${ML_API}/items?ids=${batch.join(',')}&attributes=id,title,seller_custom_field,variations,available_quantity`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!r.ok) continue;
      const arr = await r.json();
      for (const entry of arr) {
        if (entry.code !== 200 || !entry.body) continue;
        const item = entry.body;
        coletados.push({
          mlb: item.id,
          title: item.title,
          scf: item.seller_custom_field,
          qty_variations: (item.variations || []).length,
          total_stock: item.available_quantity,
        });
      }
      await new Promise(r => setTimeout(r, 100));
    }

    // Agrupa por padrão de SCF
    const padroes = {
      null_ou_vazio: [],
      so_digitos_3a5: [],           // "02277", "2277"
      com_parenteses_digitos: [],   // "xxx(02277)", "(02277)"
      outro: [],
    };

    for (const c of coletados) {
      const scf = c.scf;
      if (!scf || scf.trim() === '') {
        padroes.null_ou_vazio.push(c);
      } else if (/^\s*0*\d{3,5}\s*$/.test(scf)) {
        padroes.so_digitos_3a5.push(c);
      } else if (/\(\d{3,5}\)/.test(scf)) {
        padroes.com_parenteses_digitos.push(c);
      } else {
        padroes.outro.push(c);
      }
    }

    return res.json({
      total_anuncios: coletados.length,
      contagem_por_padrao: {
        null_ou_vazio: padroes.null_ou_vazio.length,
        so_digitos_3a5: padroes.so_digitos_3a5.length,
        com_parenteses_digitos: padroes.com_parenteses_digitos.length,
        outro: padroes.outro.length,
      },
      amostras: {
        null_ou_vazio: padroes.null_ou_vazio.slice(0, 8).map(c => ({ mlb: c.mlb, title: c.title, scf: c.scf, vars: c.qty_variations, total: c.total_stock })),
        so_digitos_3a5: padroes.so_digitos_3a5.slice(0, 8).map(c => ({ mlb: c.mlb, title: c.title, scf: c.scf, vars: c.qty_variations })),
        com_parenteses_digitos: padroes.com_parenteses_digitos.slice(0, 8).map(c => ({ mlb: c.mlb, title: c.title, scf: c.scf, vars: c.qty_variations })),
        outro: padroes.outro.slice(0, 15).map(c => ({ mlb: c.mlb, title: c.title, scf: c.scf, vars: c.qty_variations })),
      },
    });
  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
}
