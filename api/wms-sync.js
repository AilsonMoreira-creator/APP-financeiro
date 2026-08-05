/**
 * wms-sync.js — Picking WMS (Ailson 05/08/2026)
 * Puxa pedidos das 3 contas Bling nas situações "Em aberto", "Atendido" e
 * "Em andamento" e cacheia em wms_pedidos com itens parseados (ref/cor/tam/
 * localização). O status_wms (aberto → em_separacao → finalizado) é gerido
 * pelo módulo e NUNCA sobrescrito pelo sync; o sync só atualiza a situação
 * Bling e marca cancelados.
 *
 * Situações resolvidas POR NOME via API (ids podem variar por conta);
 * fallback nos ids padrão 6/9/15/12.
 *
 * Query: ?conta=exitus limita | ?dias=14 janela (default 14)
 */
import { supabase, parseDescricao, parseCanal, blingFetch, refreshBlingToken } from './_bling-helpers.js';

export const config = { maxDuration: 300 };

const CONTAS = ['exitus', 'lumia', 'muniam'];
const DELAY_MS = 350;
const SITUACOES_ALVO = ['em aberto', 'atendido', 'em andamento'];
const IDS_PADRAO = { 'em aberto': 6, 'atendido': 9, 'em andamento': 15, 'cancelado': 12 };

async function resolverSituacoes(headers) {
  // devolve { 'em aberto': id, 'atendido': id, ... } resolvido por nome
  const mapa = { ...IDS_PADRAO };
  try {
    const mr = await blingFetch('https://api.bling.com.br/Api/v3/situacoes/modulos', headers);
    if (!mr.ok) return mapa;
    const md = await mr.json();
    const modVendas = (md.data || []).find(m =>
      String(m.modulo || m.descricao || m.nome || '').toLowerCase().includes('venda'));
    if (!modVendas) return mapa;
    const sr = await blingFetch(`https://api.bling.com.br/Api/v3/situacoes/modulos/${modVendas.id}`, headers);
    if (!sr.ok) return mapa;
    const sd = await sr.json();
    for (const s of (sd.data || [])) {
      const nome = String(s.nome || '').trim().toLowerCase();
      if (nome) mapa[nome] = s.id;
    }
  } catch { /* fallback padrão */ }
  return mapa;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const inicio = Date.now();
  const soConta = String(req.query?.conta || '').toLowerCase();
  // Default 2 dias (hoje + ontem, cobre o ciclo do corte 12h). Janela maior
  // suja o funil enquanto a disciplina do "Verificado" não engata no Bling:
  // pedido antigo já despachado continua "em aberto" lá (Ailson 05/08/2026).
  const dias = Math.min(60, Math.max(1, parseInt(req.query?.dias) || 2));
  const dataInicial = new Date(Date.now() - dias * 86400000).toISOString().slice(0, 10);
  const dataFinal = new Date().toISOString().slice(0, 10);

  const resumo = {};
  const contas = soConta && CONTAS.includes(soConta) ? [soConta] : CONTAS;

  for (const conta of contas) {
    const r = { listados: 0, novos: 0, atualizados: 0, cancelados: 0, erros: 0 };
    resumo[conta] = r;
    if (Date.now() - inicio > 270000) { r.detalhe = 'timeout: continua no próximo sync'; break; }

    let token;
    try { token = await refreshBlingToken(conta); } catch (e) { r.detalhe = 'token: ' + e.message; r.erros++; continue; }
    if (!token) { r.detalhe = 'sem token'; r.erros++; continue; }
    const headers = { 'Authorization': 'Bearer ' + token, 'Accept': 'application/json' };

    const situacoes = await resolverSituacoes(headers);
    const idCancelado = situacoes['cancelado'] || 12;
    const nomePorId = {};
    for (const [nome, id] of Object.entries(situacoes)) nomePorId[id] = nome;

    // mapa de lojas (nome dos canais)
    let lojaMap = {};
    try {
      const lr = await blingFetch('https://api.bling.com.br/Api/v3/lojas?limite=100', headers);
      if (lr.ok) { const ld = await lr.json(); for (const l of (ld.data || [])) lojaMap[l.id] = l.nome || l.descricao || ''; }
    } catch { /* segue */ }

    // 1. lista pedidos das situações alvo
    const pedidosLista = [];
    for (const nomeSit of SITUACOES_ALVO) {
      const sid = situacoes[nomeSit];
      if (!sid) continue;
      let pagina = 1;
      while (true) {
        if (Date.now() - inicio > 260000) break;
        const url = `https://api.bling.com.br/Api/v3/pedidos/vendas?situacaoId=${sid}&dataInicial=${dataInicial}&dataFinal=${dataFinal}&pagina=${pagina}&limite=100`;
        const resp = await blingFetch(url, headers);
        if (!resp.ok) { r.erros++; break; }
        const d = await resp.json();
        if (!d.data || d.data.length === 0) break;
        for (const p of d.data) {
          const lojaObj = p.loja || {};
          let lojaNome = lojaObj.descricao || lojaObj.nome || '';
          if (!lojaNome && lojaObj.id && lojaMap[lojaObj.id]) lojaNome = lojaMap[lojaObj.id];
          pedidosLista.push({ id: p.id, numero: p.numero, situacaoId: sid, situacaoNome: nomeSit, lojaNome, data: (p.data || '').slice(0, 10) });
        }
        if (d.data.length < 100) break;
        pagina++;
        await new Promise(x => setTimeout(x, DELAY_MS));
      }
    }
    r.listados = pedidosLista.length;

    // 2. separa novos vs cacheados
    const ids = pedidosLista.map(p => p.id);
    const cache = new Map();
    for (let i = 0; i < ids.length; i += 400) {
      const { data: exist } = await supabase.from('wms_pedidos')
        .select('pedido_id, situacao_bling, status_wms')
        .eq('conta', conta).in('pedido_id', ids.slice(i, i + 400));
      for (const e of (exist || [])) cache.set(e.pedido_id, e);
    }

    // 3. atualiza situação dos cacheados que mudaram (sem re-detalhar)
    for (const p of pedidosLista) {
      const c = cache.get(p.id);
      if (c && c.situacao_bling !== p.situacaoId) {
        await supabase.from('wms_pedidos')
          .update({ situacao_bling: p.situacaoId, situacao_nome: p.situacaoNome, visto_em: new Date().toISOString(), atualizado_em: new Date().toISOString() })
          .eq('conta', conta).eq('pedido_id', p.id);
        r.atualizados++;
      } else if (c) {
        await supabase.from('wms_pedidos')
          .update({ visto_em: new Date().toISOString() })
          .eq('conta', conta).eq('pedido_id', p.id);
      }
    }

    // 4. detalha e insere os novos
    const novos = pedidosLista.filter(p => !cache.has(p.id));
    for (const pedido of novos) {
      if (Date.now() - inicio > 270000) { r.detalhe = 'timeout no detalhe: continua no próximo sync'; break; }
      try {
        const dr = await blingFetch(`https://api.bling.com.br/Api/v3/pedidos/vendas/${pedido.id}`, headers, { maxRetries: 2, baseDelay: 2000 });
        if (!dr.ok) { r.erros++; continue; }
        const det = await dr.json();
        const ped = det.data || det;
        let lojaNome = pedido.lojaNome || '';
        if (!lojaNome) {
          const lj = ped.loja || {};
          lojaNome = lj.descricao || lj.nome || (lj.id && lojaMap[lj.id]) || '';
        }
        const canal = parseCanal(lojaNome, {
          lojaId: ped.loja?.id, intermediador: ped.intermediador,
          numeroPedidoLoja: ped.numeroPedidoLoja, contato: ped.contato,
        });
        const itens = [];
        let qtdPecas = 0;
        for (const item of (ped.itens || [])) {
          const pp = parseDescricao(item.descricao);
          const qtd = parseInt(item.quantidade) || 1;
          qtdPecas += qtd;
          itens.push({
            codigo: item.codigo || '', descricao: item.descricao || '',
            quantidade: qtd, ref: pp.ref, cor: pp.cor, tamanho: pp.tamanho,
            estoque: pp.estoque, descLimpa: pp.descLimpa,
          });
        }
        const skusDistintos = new Set(itens.map(i => i.codigo || (i.ref + '|' + i.cor + '|' + i.tamanho))).size;
        await supabase.from('wms_pedidos').upsert({
          conta, pedido_id: pedido.id, numero: String(ped.numero || pedido.numero || ''),
          numero_loja: ped.numeroPedidoLoja || null,
          data_pedido: pedido.data || (ped.data || '').slice(0, 10) || null,
          situacao_bling: pedido.situacaoId, situacao_nome: pedido.situacaoNome,
          loja_nome: lojaNome || '', loja_id: ped.loja?.id || null,
          canal_geral: canal.geral, canal_detalhe: canal.detalhe,
          cliente_nome: ped.contato?.nome || '',
          itens, qtd_skus: skusDistintos, qtd_pecas: qtdPecas,
          multi_sku: skusDistintos > 1,
          visto_em: new Date().toISOString(), atualizado_em: new Date().toISOString(),
        }, { onConflict: 'conta,pedido_id' });
        r.novos++;
        await new Promise(x => setTimeout(x, DELAY_MS));
      } catch (e) { r.erros++; }
    }

    // 5. cancelados: pedidos ativos no WMS que não apareceram nas situações alvo
    //    e estão cancelados no Bling (checagem individual, barata: só os sumidos)
    try {
      const { data: ativos } = await supabase.from('wms_pedidos')
        .select('pedido_id')
        .eq('conta', conta).in('status_wms', ['aberto', 'em_separacao'])
        .gte('data_pedido', dataInicial);
      const vistos = new Set(ids);
      const sumidos = (ativos || []).filter(a => !vistos.has(a.pedido_id)).slice(0, 20);
      for (const s of sumidos) {
        if (Date.now() - inicio > 280000) break;
        const dr = await blingFetch(`https://api.bling.com.br/Api/v3/pedidos/vendas/${s.pedido_id}`, headers, { maxRetries: 1, baseDelay: 1500 });
        if (!dr.ok) continue;
        const det = await dr.json();
        const sit = det.data?.situacao?.id;
        if (sit === idCancelado) {
          await supabase.from('wms_pedidos')
            .update({ status_wms: 'cancelado', situacao_bling: sit, situacao_nome: 'cancelado', atualizado_em: new Date().toISOString() })
            .eq('conta', conta).eq('pedido_id', s.pedido_id);
          r.cancelados++;
        } else if (sit != null) {
          await supabase.from('wms_pedidos')
            .update({ situacao_bling: sit, situacao_nome: nomePorId[sit] || String(sit), atualizado_em: new Date().toISOString() })
            .eq('conta', conta).eq('pedido_id', s.pedido_id);
        }
        await new Promise(x => setTimeout(x, DELAY_MS));
      }
    } catch { /* segue */ }
  }

  return res.status(200).json({ ok: true, dias, resumo });
}
