/**
 * bling-devolucoes-sync.js — devoluções pelas NOTAS DE ENTRADA do Bling
 * (Ailson 15/08/2026)
 *
 * Regra combinada: Mercado Livre (3 contas, Full incluso) e TikTok vêm da API
 * do próprio canal; **os demais canais (Shein, Shopee, Magalu…) vêm daqui**,
 * das notas de devolução emitidas no Bling — assim nada é contado duas vezes.
 *
 * A nota de entrada traz o item com a descrição no padrão
 *   "Calca ... (ref 02600)  (F) Cor:BEGE;Tamanho:G"
 * de onde saem ref, cor e tamanho.
 *
 * GET ?dias=30[&contas=exitus,lumia,muniam]
 */
import { supabase, blingFetch, refreshBlingToken, canonizarCor } from './_bling-helpers.js';

export const config = { maxDuration: 300 };
const PAUSA = 380;
const espera = (ms) => new Promise(r => setTimeout(r, ms));
const n = (v) => Number(v) || 0;

// CFOPs de devolução de venda (dentro e fora do estado)
const CFOP_DEVOLUCAO = /^(1202|2202|1411|2411|1201|2201)$/;

function parseItem(desc) {
  const s = String(desc || '');
  const ref = (s.match(/\(ref\.?\s*0*(\d+)\)/i) || [])[1] || null;
  const cor = (s.match(/Cor:\s*([^;]+)/i) || [])[1] || null;
  const tam = (s.match(/Tamanho:\s*([^;]+)/i) || [])[1] || null;
  return {
    ref: ref ? String(Number(ref)) : null,
    cor: cor ? canonizarCor(cor.trim()) : null,
    tam: tam ? tam.trim().toUpperCase() : null,
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const dias = Math.min(parseInt(req.query?.dias) || 30, 90);
  const contas = String(req.query?.contas || 'exitus,lumia,muniam').split(',').map(c => c.trim());
  const desde = new Date(Date.now() - dias * 86400000).toISOString().slice(0, 10);
  const resumo = { desde, contas: {}, gravados: 0 };
  const inicio = Date.now();

  try {
    for (const conta of contas) {
      const r = resumo.contas[conta] = { notas: 0, itens: 0, sem_escopo: false, canais_ignorados: 0 };
      let token;
      try { token = await refreshBlingToken(conta); } catch { r.erro = 'token'; continue; }
      const h = { Authorization: 'Bearer ' + token, Accept: 'application/json' };

      // canais da conta: ML e TikTok saem (vêm da API do canal)
      const cR = await blingFetch('https://api.bling.com.br/Api/v3/canais-venda', h);
      if (cR.status === 403) { r.sem_escopo = true; continue; }
      const cJ = typeof cR.json === 'function' ? await cR.json().catch(() => ({})) : {};
      const canal = {};
      for (const c of (cJ?.data || [])) canal[c.id] = { nome: c.descricao, tipo: c.tipo };
      await espera(PAUSA);

      const vemDaApi = (lojaId) => {
        const c = canal[lojaId];
        if (!c) return false;
        return /mercado ?livre|tiktok/i.test(`${c.nome} ${c.tipo}`);
      };

      // notas de entrada do período
      const notas = [];
      for (let pg = 1; pg <= 6; pg++) {
        const lr = await blingFetch(`https://api.bling.com.br/Api/v3/nfe?tipo=0&dataEmissaoInicial=${desde}&limite=100&pagina=${pg}`, h);
        if (lr.status === 403) { r.sem_escopo = true; break; }
        const lj = typeof lr.json === 'function' ? await lr.json().catch(() => ({})) : {};
        const lista = lj?.data || [];
        notas.push(...lista);
        if (lista.length < 100) break;
        await espera(PAUSA);
      }
      if (r.sem_escopo) continue;

      // já gravadas? (não reprocessa nota antiga)
      const ids = notas.map(x => x.id);
      const jaTem = new Set();
      for (let i = 0; i < ids.length; i += 300) {
        const { data } = await supabase.from('bling_devolucoes').select('nf_id').in('nf_id', ids.slice(i, i + 300));
        (data || []).forEach(x => jaTem.add(String(x.nf_id)));
      }

      for (const nf of notas) {
        if (Date.now() - inicio > 260000) { r.aviso = 'tempo esgotado — continua na próxima rodada'; break; }
        if (jaTem.has(String(nf.id))) continue;
        if (vemDaApi(nf.loja?.id)) { r.canais_ignorados++; continue; }  // ML/TikTok: API do canal

        const dr = await blingFetch(`https://api.bling.com.br/Api/v3/nfe/${nf.id}`, h);
        const dj = typeof dr.json === 'function' ? await dr.json().catch(() => ({})) : {};
        const d = dj?.data || {};
        await espera(PAUSA);
        r.notas++;

        const linhas = [];
        for (const it of (d.itens || [])) {
          if (it.cfop && !CFOP_DEVOLUCAO.test(String(it.cfop))) continue;
          const p = parseItem(it.descricao);
          if (!p.ref) continue;
          linhas.push({
            conta, nf_id: nf.id, nf_numero: nf.numero,
            data_nota: String(nf.dataEmissao || '').slice(0, 10),
            loja_id: nf.loja?.id || null,
            canal: canal[nf.loja?.id]?.nome || null,
            cliente: nf.contato?.nome || null,
            ref: p.ref, cor: p.cor, tam: p.tam,
            qtd: n(it.quantidade) || 1, valor: n(it.valorTotal) || n(it.valor),
            cfop: String(it.cfop || ''),
          });
        }
        if (linhas.length) {
          await supabase.from('bling_devolucoes').upsert(linhas, { onConflict: 'nf_id,ref,cor,tam' });
          r.itens += linhas.length;
          resumo.gravados += linhas.length;
        }
      }
    }
    resumo.segundos = Math.round((Date.now() - inicio) / 1000);
    return res.status(200).json(resumo);
  } catch (e) {
    return res.status(500).json({ erro: e.message, resumo });
  }
}
