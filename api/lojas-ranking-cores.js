// lojas-ranking-cores.js — Ranking de cores das LOJAS FÍSICAS (Ailson 09/09/2026)
//
//   GET  ?loja=todas|BR|ST&dias=30|60        → ranking por cor (soma das lojas)
//   POST { codigo, nome, hex }  (admin)      → nomeia / renomeia um código de cor
//
// Fonte: lojas_vendas_itens (planilha do Miré importada todo dia). O SKU do
// Miré é REF(4) + COR(3) + TAM(2); a cor é lida dos 3 dígitos antes dos 2
// últimos. Nome/cor vêm de lojas_cores_codigo; código sem nome sai como
// "cor NNN" pra ser nomeado na tela.

import { supabase, validarUsuario, setCors } from './_lojas-helpers.js';

// 11/09 (ordem dele): os basicos 0050 e 0020 sao mais baratos e vendem em
// volume muito acima do resto — mascaravam a leitura de cor. Ficam FORA das
// somas do ranking (a tela avisa). ?incluir_basicos=1 traz de volta.
const REFS_BASICAS = ['50', '20'];
const ehBasica = (ref) => REFS_BASICAS.includes(String(ref || '').replace(/^0+/, ''));

const LOJA_BR = 'Bom Retiro';
const LOJA_ST = 'Silva Teles';
const codCor = (sku) => { const s = String(sku || '').replace(/\D/g, ''); return s.length >= 9 ? s.slice(-5, -2) : null; };

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  const auth = await validarUsuario(req);
  if (!auth.ok) return res.status(auth.status || 403).json({ error: auth.error });

  if (req.method === 'POST') {
    if (!auth.isAdmin) return res.status(403).json({ error: 'Apenas admin' });
    const { codigo, nome, hex } = req.body || {};
    const cod = String(codigo || '').replace(/\D/g, '').padStart(3, '0').slice(-3);
    if (!cod) return res.status(400).json({ error: 'codigo' });
    const { error } = await supabase.from('lojas_cores_codigo').upsert({
      codigo: cod, nome: String(nome || '').trim() || null, hex: /^#[0-9a-f]{6}$/i.test(String(hex || '')) ? hex : null,
      atualizado_em: new Date().toISOString(), atualizado_por: auth.userId || null,
    }, { onConflict: 'codigo' });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  const dias = Math.min(180, parseInt(req.query?.dias, 10) || 30);
  const incluirBasicos = req.query?.incluir_basicos === '1';
  const lojaFiltro = ['todas', 'BR', 'ST'].includes(req.query?.loja) ? req.query.loja : 'todas';
  const desde = new Date(Date.now() - dias * 86400000).toISOString().slice(0, 10);
  try {
    let q = supabase.from('lojas_vendas_itens').select('sku, ref, qtd, liquido_unit, loja, data_venda').gte('data_venda', desde).not('sku', 'is', null);
    if (lojaFiltro === 'BR') q = q.eq('loja', LOJA_BR);
    if (lojaFiltro === 'ST') q = q.eq('loja', LOJA_ST);
    const itens = [];
    for (let off = 0; off < 20000; off += 1000) {
      const { data, error } = await q.range(off, off + 999);
      if (error) throw error;
      itens.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    const { data: nomes } = await supabase.from('lojas_cores_codigo').select('codigo, nome, hex, agrupar_em');
    const mapa = {}; for (const c of (nomes || [])) mapa[c.codigo] = c;
    // 09/09 (ordem dele): cores fundidas — o codigo secundario soma no principal
    // (Branco->Off-white, Manteiga->Amarelo, Rosa->Rosa Claro, Salmao->Coral, Bege->Areia)
    const alvo = (cod) => { let c = cod; for (let i = 0; i < 3 && mapa[c]?.agrupar_em; i++) c = mapa[c].agrupar_em; return c; };

    // 09/09 (pedido dele): TENDENCIA — participacao da cor nos ultimos 15 dias
    // vs os 15 anteriores (independente da janela escolhida). Seta verde/vermelha.
    const d15 = new Date(Date.now() - 15 * 86400000).toISOString().slice(0, 10);
    const d30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    let itens30 = itens;
    if (dias < 30) {
      let q2 = supabase.from('lojas_vendas_itens').select('sku, ref, qtd, data_venda, loja').gte('data_venda', d30).not('sku', 'is', null);
      if (lojaFiltro === 'BR') q2 = q2.eq('loja', LOJA_BR);
      if (lojaFiltro === 'ST') q2 = q2.eq('loja', LOJA_ST);
      const acc = [];
      for (let off = 0; off < 20000; off += 1000) { const { data } = await q2.range(off, off + 999); acc.push(...(data || [])); if (!data || data.length < 1000) break; }
      itens30 = acc;
    }
    const rec = {}, ant = {}; let totRec = 0, totAnt = 0;
    for (const it of itens30) {
      const cod0 = codCor(it.sku); if (!cod0) continue;
      if (!incluirBasicos && ehBasica(it.ref)) continue;   // 11/09: mesma exclusao na tendencia
      const cod = alvo(cod0); const qtd = Number(it.qtd) || 0;
      const dv = String(it.data_venda || '').slice(0, 10);
      if (dv >= d15) { rec[cod] = (rec[cod] || 0) + qtd; totRec += qtd; }
      else if (dv >= d30) { ant[cod] = (ant[cod] || 0) + qtd; totAnt += qtd; }
    }
    const tendencia = (cod) => {
      const pr = totRec ? 100 * (rec[cod] || 0) / totRec : 0;
      const pa = totAnt ? 100 * (ant[cod] || 0) / totAnt : 0;
      const delta = Math.round((pr - pa) * 10) / 10;
      // 09/09 (ordem dele): seta SO em mudanca grande — participacao variou
      // 25% ou mais (relativo) e com volume minimo (>= 8 pecas numa das
      // quinzenas) pra nao acender por 2 pecas de diferenca.
      const varRel = pa > 0 ? Math.round(1000 * (pr - pa) / pa) / 10 : (pr > 0 ? 100 : 0);
      const volumeOk = Math.max(rec[cod] || 0, ant[cod] || 0) >= 8;
      const tend = !volumeOk ? 'flat' : varRel >= 25 ? 'up' : varRel <= -25 ? 'down' : 'flat';
      return { tend, delta_pp: delta, var_rel: varRel, pct_15d: Math.round(pr * 10) / 10, pct_15d_ant: Math.round(pa * 10) / 10, pecas_15d: rec[cod] || 0, pecas_15d_ant: ant[cod] || 0 };
    };

    const porCor = {};
    let totalPecas = 0, semCodigo = 0, pecasBasicas = 0;
    for (const it of itens) {
      const cod0 = codCor(it.sku);
      const qtd = Number(it.qtd) || 0;
      if (!cod0) { semCodigo += qtd; continue; }
      if (!incluirBasicos && ehBasica(it.ref)) { pecasBasicas += qtd; continue; }
      const cod = alvo(cod0);
      totalPecas += qtd;
      porCor[cod] = porCor[cod] || { codigo: cod, pecas: 0, valor: 0, refs: new Set(), por_loja: {} };
      porCor[cod].pecas += qtd;
      porCor[cod].valor += qtd * (Number(it.liquido_unit) || 0);
      if (it.ref) porCor[cod].refs.add(String(it.ref));
      porCor[cod].por_loja[it.loja] = (porCor[cod].por_loja[it.loja] || 0) + qtd;
    }
    const ranking = Object.values(porCor).map(c => ({
      codigo: c.codigo, nome: mapa[c.codigo]?.nome || null, hex: mapa[c.codigo]?.hex || null,
      pecas: c.pecas, valor: Math.round(c.valor * 100) / 100, refs: c.refs.size,
      pct: totalPecas ? Math.round(1000 * c.pecas / totalPecas) / 10 : 0,
      bom_retiro: c.por_loja[LOJA_BR] || 0, silva_teles: c.por_loja[LOJA_ST] || 0,
      ...tendencia(c.codigo),
    })).sort((a, b) => b.pecas - a.pecas).slice(0, Math.min(50, parseInt(req.query?.top, 10) || 20));   // 09/09: top 20 por padrao
    return res.status(200).json({ ok: true, dias, loja: lojaFiltro, desde, total_pecas: totalPecas, sem_codigo: semCodigo,
      basicas_fora: incluirBasicos ? 0 : pecasBasicas, refs_basicas: incluirBasicos ? [] : REFS_BASICAS.map(r => r.padStart(4, '0')),
      cores: ranking.length, sem_nome: ranking.filter(r => !r.nome).length, ranking });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
