// bling-lumia-skus.js — READ-ONLY. Lista codigos do catalogo Bling de uma conta
// em blocos de paginas (?ini&fim), pra auditoria de SKU. Nao grava nada.
import { refreshBlingToken, blingFetch } from './_bling-helpers.js';

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  const conta = String(req.query?.conta || 'lumia').toLowerCase().trim();
  const ini = parseInt(req.query?.ini || '1', 10);
  const fim = parseInt(req.query?.fim || '15', 10);
  try {
    const token = await refreshBlingToken(conta);
    const out = [];
    let amostra = null;
    for (let pagina = ini; pagina <= fim; pagina++) {
      const url = `https://www.bling.com.br/Api/v3/produtos?limite=100&pagina=${pagina}`;
      const resp = await blingFetch(url, { Authorization: `Bearer ${token}`, Accept: 'application/json' });
      if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        return res.json({ ok: false, conta, pagina, status: resp.status, body: body.slice(0, 300), lidos: out.length });
      }
      const json = await resp.json();
      const lista = json?.data || [];
      if (pagina === ini && lista[0]) amostra = { id: lista[0].id, codigo: lista[0].codigo, nome: lista[0].nome, tipo: lista[0].tipo, formato: lista[0].formato };
      for (const p of lista) out.push(String(p.codigo || '').trim());
      if (lista.length < 100) {
        return res.json({ ok: true, conta, ini, fim_real: pagina, ultima_pagina: true, lidos: out.length, amostra, codigos: out });
      }
      await new Promise(r => setTimeout(r, 350));
    }
    return res.json({ ok: true, conta, ini, fim, ultima_pagina: false, lidos: out.length, amostra, codigos: out });
  } catch (e) {
    return res.json({ ok: false, conta, erro: String(e?.message || e) });
  }
}
