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
import { lerWmsConfig } from './wms-listas.js';

// Normalização de situação (Ailson 05/08): minúsculo, sem acento, e matching
// flexível — "em andamento" tem que casar com "andamento" (contains 2 lados).
export function normSit(x) {
  return String(x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}
export function sitCasa(a, b) {
  const na = normSit(a), nb = normSit(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

export const config = { maxDuration: 300 };

const CONTAS = ['exitus', 'lumia', 'muniam'];
const DELAY_MS = 350;
const IDS_PADRAO = { 'em aberto': 6, 'atendido': 9, 'em andamento': 15, 'cancelado': 12 };

async function resolverSituacoes(headers) {
  // devolve { 'em aberto': id, ... } resolvido por nome (lower, do Bling da conta)
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
  // Piso: a operação do WMS começou em 05/08/2026. Pedidos anteriores já foram
  // despachados fisicamente mas seguem "em aberto" no Bling (situação nunca foi
  // movida antes do Verificado existir) — sem o piso eles re-entrariam a cada
  // sync como backlog fantasma. Remover quando a disciplina do Verificado
  // cobrir o histórico. Override consciente: ?desde=YYYY-MM-DD.
  const DATA_INICIO_OPERACAO = '2026-08-05';
  // ?diag=1 -> so LISTA o que o Bling devolve (nao grava nada) e ignora o piso,
  // pra comparar com o que aparece no modulo (Ailson 07/08/2026)
  const diag = req.query?.diag === '1';
  let dataInicial = new Date(Date.now() - dias * 86400000).toISOString().slice(0, 10);
  const qDesde = String(req.query?.desde || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(qDesde)) dataInicial = qDesde;
  else if (!diag && dataInicial < DATA_INICIO_OPERACAO) dataInicial = DATA_INICIO_OPERACAO;
  const dataFinal = new Date().toISOString().slice(0, 10);

  const cfg = await lerWmsConfig();
  const alvosAbertos = cfg.situacoes_aberto;
  const alvosFinalizados = cfg.situacoes_finalizado;

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

    // casa as situações configuradas com as da conta (matching flexível):
    // buscar = abertos + finalizados; categoria decide o status_wms
    const buscar = []; // [{id, nome, categoria}]
    const jaIds = new Set();
    for (const [nome, id] of Object.entries(situacoes)) {
      if (nome === 'cancelado' || jaIds.has(id)) continue;
      if (alvosAbertos.some(alvo => sitCasa(nome, alvo))) { buscar.push({ id, nome, categoria: 'aberto' }); jaIds.add(id); }
      else if (alvosFinalizados.some(alvo => sitCasa(nome, alvo))) { buscar.push({ id, nome, categoria: 'finalizado' }); jaIds.add(id); }
    }
    r.situacoes_buscadas = buscar.map(b => `${b.nome}(${b.categoria})`);

    // mapa de lojas (nome dos canais)
    let lojaMap = {};
    try {
      const lr = await blingFetch('https://api.bling.com.br/Api/v3/lojas?limite=100', headers);
      if (lr.ok) { const ld = await lr.json(); for (const l of (ld.data || [])) lojaMap[l.id] = l.nome || l.descricao || ''; }
    } catch { /* segue */ }

    // 1. lista pedidos das situações alvo
    const pedidosLista = [];
    for (const alvo of buscar) {
      let pagina = 1;
      while (true) {
        if (Date.now() - inicio > 260000) break;
        // Bling v3 filtra por idsSituacoes[] — o `situacaoId` (estilo v2) e
        // IGNORADO e devolve TODOS os pedidos da janela (Ailson 07/08/2026).
        const url = `https://api.bling.com.br/Api/v3/pedidos/vendas?idsSituacoes%5B%5D=${alvo.id}&dataInicial=${dataInicial}&dataFinal=${dataFinal}&pagina=${pagina}&limite=100`;
        const resp = await blingFetch(url, headers);
        if (!resp.ok) { r.erros++; break; }
        const d = await resp.json();
        if (!d.data || d.data.length === 0) break;
        for (const p of d.data) {
          if (diag && !r.amostra_crua) r.amostra_crua = p;
          const lojaObj = p.loja || {};
          let lojaNome = lojaObj.descricao || lojaObj.nome || '';
          if (!lojaNome && lojaObj.id && lojaMap[lojaObj.id]) lojaNome = lojaMap[lojaObj.id];
          pedidosLista.push({ id: p.id, numero: p.numero, numeroLoja: p.numeroLoja || null, situacaoId: alvo.id, situacaoNome: alvo.nome, categoria: alvo.categoria, lojaNome, data: (p.data || '').slice(0, 10) });
        }
        if (d.data.length < 100) break;
        pagina++;
        await new Promise(x => setTimeout(x, DELAY_MS));
      }
    }
    r.listados = pedidosLista.length;

    if (diag) {
      // so contabiliza: por situacao, por data e o que ja esta no banco
      const porSit = {}, porData = {};
      for (const p of pedidosLista) {
        porSit[p.situacaoNome] = (porSit[p.situacaoNome] || 0) + 1;
        porData[p.data || 'sem data'] = (porData[p.data || 'sem data'] || 0) + 1;
      }
      const idsD = pedidosLista.map(p => p.id);
      let noBanco = 0;
      for (let i = 0; i < idsD.length; i += 400) {
        const { data: ex } = await supabase.from('wms_pedidos')
          .select('pedido_id').eq('conta', conta).in('pedido_id', idsD.slice(i, i + 400));
        noBanco += (ex || []).length;
      }
      r.diag = { janela: `${dataInicial} a ${dataFinal}`, por_situacao: porSit, por_data: porData, ja_no_banco: noBanco, fora_do_banco: pedidosLista.length - noBanco };

      // ?detalhes=N -> baixa o detalhe dos N primeiros e devolve so o que
      // interessa pra identificar Mercado Livre Flex (Ailson 07/08/2026)
      const nDet = Math.min(12, parseInt(req.query?.detalhes) || 0);
      if (nDet) {
        r.detalhes = [];
        for (const p of pedidosLista.slice(0, nDet)) {
          const dr = await blingFetch(`https://api.bling.com.br/Api/v3/pedidos/vendas/${p.id}`, headers, { maxRetries: 1 });
          if (!dr.ok) continue;
          const dd = (await dr.json()).data || {};
          r.detalhes.push({
            id: p.id, numeroLoja: dd.numeroLoja, loja: dd.loja,
            situacao: dd.situacao, transporte: dd.transporte, intermediador: dd.intermediador,
          });
          await new Promise(x => setTimeout(x, DELAY_MS));
        }
      }
      continue;
    }

    // 2. separa novos vs cacheados
    const ids = pedidosLista.map(p => p.id);
    const cache = new Map();
    for (let i = 0; i < ids.length; i += 400) {
      const { data: exist } = await supabase.from('wms_pedidos')
        .select('pedido_id, situacao_bling, status_wms, impresso_em, numero_loja')
        .eq('conta', conta).in('pedido_id', ids.slice(i, i + 400));
      for (const e of (exist || [])) cache.set(e.pedido_id, e);
    }

    // 3. atualiza situação dos cacheados que mudaram (sem re-detalhar)
    for (const p of pedidosLista) {
      const c = cache.get(p.id);
      if (!c) continue;
      const agora = new Date().toISOString();
      // backfill do numero do pedido no marketplace: a LISTAGEM ja traz
      // numeroLoja, entao nao precisa re-detalhar (Ailson 07/08/2026)
      const faltaNumeroLoja = !c.numero_loja && p.numeroLoja;
      // NF gerada NAO tira o pedido da separacao (Ailson 07/08/2026): a Sthefany
      // gera as notas enquanto os ajudantes fazem o picking, e a bipagem do
      // checkout so comeca com a nota pronta. Entao o pedido fica no card "Em
      // Separacao" com a marca de NF e sai de la pela bipagem/Verificado ou pelo
      // botao Finalizar. Auto-finalizar so vale pra quem ainda esta 'aberto'.
      const deveFinalizar = p.categoria === 'finalizado'
        && (c.status_wms === 'aberto' || (c.status_wms === 'em_separacao' && sitCasa(p.situacaoNome, 'verificado')));
      // O BLING E A FONTE DE VERDADE (Ailson 07/08/2026): se la o pedido segue
      // "em aberto", ele volta pro funil. Guarda: so reabre o que NUNCA foi
      // impresso — lista impressa/finalizada pela equipe fica como esta, senao
      // o sync desfaria o trabalho do dia toda vez que rodasse.
      const deveReabrir = p.categoria === 'aberto' && c.status_wms === 'finalizado' && !c.impresso_em;
      if (deveReabrir) {
        await supabase.from('wms_pedidos')
          .update({ status_wms: 'aberto', finalizado_em: null, situacao_bling: p.situacaoId, situacao_nome: p.situacaoNome, visto_em: agora, atualizado_em: agora, ...(faltaNumeroLoja ? { numero_loja: p.numeroLoja } : {}) })
          .eq('conta', conta).eq('pedido_id', p.id);
        r.reabertos = (r.reabertos || 0) + 1;
      } else if (deveFinalizar) {
        await supabase.from('wms_pedidos')
          .update({ status_wms: 'finalizado', finalizado_em: agora, situacao_bling: p.situacaoId, situacao_nome: p.situacaoNome, visto_em: agora, atualizado_em: agora, ...(faltaNumeroLoja ? { numero_loja: p.numeroLoja } : {}) })
          .eq('conta', conta).eq('pedido_id', p.id);
        r.finalizados = (r.finalizados || 0) + 1;
      } else if (c.situacao_bling !== p.situacaoId || faltaNumeroLoja) {
        await supabase.from('wms_pedidos')
          .update({ situacao_bling: p.situacaoId, situacao_nome: p.situacaoNome, visto_em: agora, atualizado_em: agora, ...(faltaNumeroLoja ? { numero_loja: p.numeroLoja } : {}) })
          .eq('conta', conta).eq('pedido_id', p.id);
        r.atualizados++;
      } else {
        await supabase.from('wms_pedidos')
          .update({ visto_em: agora })
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
        const statusInicial = pedido.categoria === 'finalizado' ? 'finalizado' : 'aberto';
        await supabase.from('wms_pedidos').upsert({
          status_wms: statusInicial,
          finalizado_em: statusInicial === 'finalizado' ? new Date().toISOString() : null,
          conta, pedido_id: pedido.id, numero: String(ped.numero || pedido.numero || ''),
          numero_loja: ped.numeroLoja || ped.numeroPedidoLoja || null,
          // servico do frete (transporte.volumes[0].servico) — e por aqui que da
          // pra separar o Mercado Livre Flex (Ailson 07/08/2026)
          servico_frete: ped.transporte?.volumes?.[0]?.servico || null,
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
