// bling-lumia-skus.js — READ-ONLY (catalogo Bling) + dump p/ tabela de auditoria.
// ?conta=lumia&ini=1&fim=12   -> devolve codigos daquelas paginas (debug)
// ?conta=lumia&dump=1         -> varre TUDO e grava em audit_lumia_sku (nao devolve lista)
import { supabase, refreshBlingToken, blingFetch } from './_bling-helpers.js';

export const config = { maxDuration: 120 };

export default async function handler(req, res) {
  const conta = String(req.query?.conta || 'lumia').toLowerCase().trim();
  const dump = req.query?.dump === '1';
  try {
    const token = await refreshBlingToken(conta);

    if (dump) {
      const tabela = conta === 'lumia' ? 'audit_lumia_sku' : 'audit_exitus_sku';
      let pagina = 1, total = 0, gravados = 0, buffer = [];
      const inicio = Date.now();
      const flush = async () => {
        if (!buffer.length) return;
        const rows = buffer.map(s => ({ sku: s }));
        const { error } = await supabase.from(tabela).upsert(rows, { onConflict: 'sku', ignoreDuplicates: true });
        if (error) throw new Error('upsert: ' + error.message);
        gravados += buffer.length; buffer = [];
      };
      while (true) {
        if (Date.now() - inicio > 110000) return res.json({ ok: false, motivo: 'timeout', pagina, total, gravados });
        const url = `https://www.bling.com.br/Api/v3/produtos?limite=100&pagina=${pagina}`;
        const resp = await blingFetch(url, { Authorization: `Bearer ${token}`, Accept: 'application/json' });
        if (!resp.ok) return res.json({ ok: false, pagina, status: resp.status, body: (await resp.text().catch(()=>'')).slice(0,300), total, gravados });
        const lista = (await resp.json())?.data || [];
        for (const p of lista) { const c = String(p.codigo || '').trim(); if (c) { buffer.push(c); total++; } }
        if (buffer.length >= 400) await flush();
        if (lista.length < 100) break;
        pagina++;
        await new Promise(r => setTimeout(r, 340));
      }
      await flush();
      return res.json({ ok: true, conta, paginas: pagina, total_codigos: total, gravados, tabela });
    }

    // modo debug por faixa de paginas
    const ini = parseInt(req.query?.ini || '1', 10), fim = parseInt(req.query?.fim || '12', 10);
    const out = []; let amostra = null;
    for (let pagina = ini; pagina <= fim; pagina++) {
      const url = `https://www.bling.com.br/Api/v3/produtos?limite=100&pagina=${pagina}`;
      const resp = await blingFetch(url, { Authorization: `Bearer ${token}`, Accept: 'application/json' });
      if (!resp.ok) return res.json({ ok: false, conta, pagina, status: resp.status, lidos: out.length });
      const lista = (await resp.json())?.data || [];
      if (pagina === ini && lista[0]) amostra = { codigo: lista[0].codigo, nome: lista[0].nome };
      for (const p of lista) out.push(String(p.codigo || '').trim());
      if (lista.length < 100) return res.json({ ok: true, conta, ini, ultima_pagina: true, lidos: out.length, amostra, codigos: out });
      await new Promise(r => setTimeout(r, 340));
    }
    return res.json({ ok: true, conta, ini, fim, ultima_pagina: false, lidos: out.length, amostra, codigos: out });
  } catch (e) {
    return res.json({ ok: false, conta, erro: String(e?.message || e) });
  }
}
