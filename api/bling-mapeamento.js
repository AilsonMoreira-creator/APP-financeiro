/**
 * bling-mapeamento.js — AUDITORIA DE MAPEAMENTO SKU × CANAL (Ailson 13/08/2026)
 *
 * SOMENTE LEITURA. Nenhuma rota de escrita neste arquivo (regra do guia dele:
 * detectar → alertar → correção humana no Bling).
 *
 * Pergunta que responde, por REFERÊNCIA: cada cor/tamanho tem vínculo em cada
 * canal ativo das 3 empresas? O vínculo aponta pra um anúncio de verdade?
 *
 * GET ?ref=02601[&contas=exitus,lumia,muniam][&cores=Preto,Bege]
 *
 * Regras combinadas:
 *  - tamanhos esperados = os que EXISTEM no Bling pra aquela cor (3 plus,
 *    4 regular, 5 na 2361 com PP — sem número fixo)
 *  - canais Full ficam de fora (ele trata Full em outra frente)
 *  - canal inativo não gera alerta (cinza)
 *  - conta sem o escopo liberado devolve status 'sem_permissao' e a tela
 *    mostra o aviso, sem quebrar as outras
 */
import { blingFetch, refreshBlingToken } from './_bling-helpers.js';

export const config = { maxDuration: 120 };
const PAUSA = 340; // 3 req/s do Bling
const espera = (ms) => new Promise(r => setTimeout(r, ms));

const parseVariacao = (nome) => {
  const cor = (String(nome).match(/Cor:\s*([^;]+)/i) || [])[1] || '';
  const tam = (String(nome).match(/Tamanho:\s*([^;]+)/i) || [])[1] || '';
  return { cor: cor.trim(), tam: tam.trim().toUpperCase() };
};
const norm = (s) => String(s || '').trim().toLowerCase();

async function auditarConta(conta, ref, coresFiltro) {
  const saida = { conta, status: 'ok', canais: [], cores: {}, avisos: [] };
  let token;
  try { token = await refreshBlingToken(conta); }
  catch (e) { return { ...saida, status: 'erro', erro: `token: ${e.message}` }; }
  const headers = { Authorization: 'Bearer ' + token, Accept: 'application/json' };

  // canais ativos (Full fora — frente separada dele)
  const cR = await blingFetch('https://api.bling.com.br/Api/v3/canais-venda', headers);
  const cJ = typeof cR.json === 'function' ? await cR.json().catch(() => ({})) : {};
  if (cR.status === 403) return { ...saida, status: 'sem_permissao' };
  const canais = {};
  for (const c of (cJ?.data || [])) {
    if (c.situacao !== 1) continue;
    if (/full/i.test(c.descricao || '')) continue;
    canais[c.id] = { id: c.id, nome: c.descricao, tipo: c.tipo };
  }
  saida.canais = Object.values(canais);
  await espera(PAUSA);

  // produto pai pela REF no nome
  const alvo = String(ref).replace(/^0+/, '');
  let pai = null;
  for (let pg = 1; pg <= 10 && !pai; pg++) {
    const r = await blingFetch(`https://api.bling.com.br/Api/v3/produtos?limite=100&pagina=${pg}&tipo=P`, headers);
    const j = typeof r.json === 'function' ? await r.json().catch(() => ({})) : {};
    const lista = j?.data || [];
    pai = lista.find(p => p.formato === 'V' && new RegExp(`ref[ .]?0*${alvo}\\b`, 'i').test(String(p.nome || '')));
    if (lista.length < 100) break;
    await espera(PAUSA);
  }
  if (!pai) return { ...saida, status: 'sem_produto' };
  saida.produto = { id: pai.id, nome: pai.nome, codigo: pai.codigo };
  await espera(PAUSA);

  // variações
  const dR = await blingFetch(`https://api.bling.com.br/Api/v3/produtos/${pai.id}`, headers);
  const dJ = typeof dR.json === 'function' ? await dR.json().catch(() => ({})) : {};
  const todas = (dJ?.data?.variacoes || []).map(v => {
    const { cor, tam } = parseVariacao(v.variacao?.nome || v.nome || '');
    return { id: v.id, sku: v.codigo, cor, tam, situacao: v.situacao, estoque: v.estoque?.saldoVirtualTotal ?? null };
  }).filter(v => v.cor);
  const filtro = (coresFiltro || []).map(norm);
  const variacoes = filtro.length ? todas.filter(v => filtro.includes(norm(v.cor))) : todas;
  saida.total_variacoes = todas.length;
  saida.auditadas = variacoes.length;
  await espera(PAUSA);

  // vínculos por variação
  for (const v of variacoes) {
    const r = await blingFetch(`https://api.bling.com.br/Api/v3/produtos/lojas?idProduto=${v.id}`, headers);
    const j = typeof r.json === 'function' ? await r.json().catch(() => ({})) : {};
    const vincs = (j?.data || []).filter(x => canais[x.loja?.id]);

    saida.cores[v.cor] = saida.cores[v.cor] || { cor: v.cor, tamanhos: [], por_canal: {} };
    const bloco = saida.cores[v.cor];
    bloco.tamanhos.push(v.tam);

    for (const canal of Object.values(canais)) {
      const doCanal = vincs.filter(x => x.loja.id === canal.id);
      const p = bloco.por_canal[canal.id] = bloco.por_canal[canal.id] || {
        canal: canal.nome, tipo: canal.tipo, esperados: 0, vinculados: 0, sem_id: 0, duplicados: 0, itens: [],
      };
      p.esperados++;
      const comId = doCanal.filter(x => String(x.codigo || '').trim());
      if (doCanal.length) p.vinculados++;
      if (doCanal.length && !comId.length) p.sem_id++;
      if (doCanal.length > 1 && canal.tipo !== 'MercadoLivre') p.duplicados++;
      p.itens.push({
        tam: v.tam, sku: v.sku, estoque: v.estoque, situacao: v.situacao,
        ids: doCanal.map(x => String(x.codigo || '').trim()).filter(Boolean),
        vinculos: doCanal.length,
      });
    }
    // variação órfã: sem vínculo em canal nenhum
    if (!vincs.length) saida.avisos.push(`${v.cor} ${v.tam} (${v.sku}) não tem vínculo em canal nenhum`);
    await espera(PAUSA);
  }
  return saida;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const ref = String(req.query?.ref || '').trim();
  if (!ref) return res.status(400).json({ erro: 'use ?ref=' });
  const contas = String(req.query?.contas || 'exitus,lumia,muniam').split(',').map(c => c.trim()).filter(Boolean);
  const cores = String(req.query?.cores || '').split(',').map(c => c.trim()).filter(Boolean);

  try {
    const t0 = Date.now();
    // as 3 empresas em PARALELO (tokens e limites independentes)
    const resultados = await Promise.all(contas.map(c => auditarConta(c, ref, cores).catch(e => ({
      conta: c, status: 'erro', erro: String(e.message).slice(0, 160),
    }))));
    return res.status(200).json({
      ref, cores_filtradas: cores, segundos: Math.round((Date.now() - t0) / 1000),
      empresas: resultados,
    });
  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
}
