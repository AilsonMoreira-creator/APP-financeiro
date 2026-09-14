/**
 * full-recomendacao.js — a tela do botão FULL no card de produto
 * (Ailson 17/08/2026)
 *
 * Junta tudo que a Cris precisa pra decidir, por cor+tamanho:
 *   estoque no Full · estoque na fábrica (Bling Exitus) · venda/dia de TODAS
 *   as plataformas · tendência · corte chegando · quantidade ideal · possível
 *   · sugerida (já arredondada) — e o motivo em uma frase.
 *
 * GET ?ref=02782
 */
import { supabase, chaveCor, canonizarCor } from './_bling-helpers.js';
import { getValidToken } from './_ml-helpers.js';
import { lerRegras, calcularLinha } from './_full-motor.js';

export const config = { maxDuration: 120 };
const n = (v) => Number(v) || 0;
const refNorm = (r) => String(r || '').replace(/^0+/, '');
// 18/08: usar o chaveCor de _bling-helpers, que aplica a TABELA DE SINÔNIMOS
// (Azul claro = Azul-claro = Azul bebê · Branco = Off-white · Rosa = Rosa
// claro · Marrom = Marrom escuro). Um chaveCor local, sem sinônimos, escondia
// a Azul Claro: a venda estava gravada como "Azul bebê" e não casava.
const dia = (d) => new Date(d).toISOString().slice(0, 10);

/** venda por cor+tamanho no período, somando TODAS as plataformas */
async function vendaPorSku(ref, dias, soFull = false) {
  const desde = dia(new Date(Date.now() - dias * 86400000));
  let q = supabase.from('bling_vendas_detalhe')
    .select('itens, data_pedido').gte('data_pedido', desde).limit(20000);
  if (soFull) q = q.eq('canal_detalhe', 'ML Full');   // 14/09: projeção de 10 dias = só o Full
  const { data } = await q;
  const m = {};
  for (const v of (data || [])) {
    for (const it of (v.itens || [])) {
      if (refNorm(it.ref) !== refNorm(ref)) continue;
      const k = `${chaveCor(it.cor)}|${String(it.tamanho || '').toUpperCase()}`;
      m[k] = (m[k] || 0) + (n(it.quantidade) || 1);
    }
  }
  return m;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const ref = String(req.query?.ref || req.body?.ref || '').trim();
  if (!ref) return res.status(400).json({ erro: 'use ?ref=' });
  // 14/09: a tela manda a MESMA matriz de reposição (cortes ativos) que exibe na
  // coluna Reposição — chave "corNorm|tam" (normCorBling do front == chaveCor daqui)
  const reposicaoFront = (req.body && typeof req.body.reposicao === 'object' && req.body.reposicao) || {};
  const reposicaoDe = (cor, tam) => n(reposicaoFront[`${chaveCor(cor)}|${String(tam || '').toLowerCase().trim()}`]);

  try {
    const regras = await lerRegras();
    const hoje = new Date();

    // 1) estoque da fábrica (Bling Exitus) por cor+tamanho
    const { data: estoque } = await supabase.from('bling_estoque')
      .select('cor_label, cor_norm, tam, qtd, bling_sku, bling_produto_id')
      .in('ref', [refNorm(ref), String(ref).padStart(5, '0')]);

    // 2) venda: 14 dias e os 14 anteriores (tendência)
    const [v14, v28, v30, vFull14] = await Promise.all([vendaPorSku(ref, 14), vendaPorSku(ref, 28), vendaPorSku(ref, 30), vendaPorSku(ref, 14, true)]);
    // "ranking de cores" = cor que aparece nas vendas dos últimos 30 dias.
    // Cor parada no Full que nem no ranking está fica OCULTA (ordem dele 18/08).
    const noRanking = new Set();
    for (const [k, q] of Object.entries(v30)) if (q > 0) noRanking.add(k.split('|')[0]);

    // 3) estoque atual no Full (ML Exitus) por COR+TAMANHO
    // 17/08: as variações do ML vêm com o campo de SKU VAZIO — o casamento
    // tem que ser pelos atributos (Cor/Tamanho) da variação, que são
    // confiáveis. Antes eu tentava pelo seller_sku da variação e dava 0
    // mesmo com ~400 peças no Full.
    const fullPorSku = {};
    try {
      const token = await getValidToken('Exitus');
      const h = { Authorization: `Bearer ${token}` };
      const me = await (await fetch('https://api.mercadolibre.com/users/me', { headers: h })).json();
      // acha os anúncios Full desta REF (basta um SKU dela levar ao anúncio)
      const itensFull = new Set(); var itensFullDebug = itensFull;
      for (const e of (estoque || []).slice(0, 8)) {
        if (!e.bling_sku) continue;
        const b = await (await fetch(
          `https://api.mercadolibre.com/users/${me.id}/items/search?seller_sku=${encodeURIComponent(e.bling_sku)}&logistic_type=fulfillment`,
          { headers: h })).json();
        (b?.results || []).forEach(id => itensFull.add(id));
        await new Promise(r => setTimeout(r, 150));
        if (itensFull.size >= 3) break;
      }
      // lê as variações e casa por Cor + Tamanho
      for (const itemId of itensFull) {
        const it = await (await fetch(`https://api.mercadolibre.com/items/${itemId}`, { headers: h })).json();
        for (const v of (it.variations || [])) {
          const combo = v.attribute_combinations || [];
          const cor = (combo.find(a => /cor|color/i.test(a.id || a.name)) || {}).value_name;
          const tam = (combo.find(a => /size|tamanho/i.test(a.id || a.name)) || {}).value_name;
          if (!cor || !tam) continue;
          const k = `${chaveCor(cor)}|${String(tam).toUpperCase().trim()}`;
          // 13/09 (REF 2700: Azul Marinho e Creme "no Full" com o numero da FABRICA):
          // variacao SEM inventory_id nao esta no armazem do ML — o available_quantity
          // dela e o estoque que o Bling empurra pro anuncio, nao o do Full. So conta
          // variacao com inventory_id.
          if (!v.inventory_id) { fullPorSku[k] = fullPorSku[k] || { qtd: 0, inventory_id: null, anuncio: itemId, sem_inventory: true }; continue; }
          const atual = fullPorSku[k]?.qtd || 0;
          fullPorSku[k] = { qtd: atual + n(v.available_quantity), inventory_id: v.inventory_id, anuncio: itemId };
        }
        await new Promise(r => setTimeout(r, 150));
      }
      // 13/09 (Creme P "83 no Full" = estoque da fabrica): o available_quantity da
      // variacao e o numero que o Bling empurra pro anuncio, NAO o do armazem. A
      // verdade do Full e /inventories/{id}/stock/fulfillment. Consulta so as
      // variacoes com inventory_id e quantidade > 0 (as zeradas ja sao zero).
      const pendentes = Object.entries(fullPorSku).filter(([, v]) => v.inventory_id && n(v.qtd) > 0);
      for (const [k, v] of pendentes) {
        try {
          const st = await (await fetch(`https://api.mercadolibre.com/inventories/${v.inventory_id}/stock/fulfillment`, { headers: h })).json();
          if (st && typeof st.available_quantity === 'number') {
            fullPorSku[k] = { ...v, qtd_anuncio: v.qtd, qtd: n(st.available_quantity), total_armazem: n(st.total), fonte: 'fulfillment' };
          }
        } catch { /* mantem o valor do anuncio */ }
        await new Promise(r => setTimeout(r, 120));
      }
    } catch (e) { /* segue sem o Full: a tela avisa */ }

    if (req.query?.debug_full === '1') return res.status(200).json({ anuncios: [...itensFullDebug], full: fullPorSku });
    // 4) corte chegando (Oficinas) — quantas peças e em quantos dias
    const { data: cortes } = await supabase.from('ordens_corte')
      .select('ref, cores, status, created_at')   // 14/09: data_entrega não existe na tabela — a consulta falhava calada
      .in('ref', [refNorm(ref), String(ref).padStart(5, '0')])
      .neq('status', 'cancelado').order('created_at', { ascending: false }).limit(6);

    // 5) já enviado e ainda em trânsito (não conta duas vezes)
    const { data: transito } = await supabase.from('full_decisoes')
      .select('cor, tam, qtd_enviada, remessa_id, full_remessas!inner(status)')
      .eq('ref', refNorm(ref)).eq('full_remessas.status', 'em_transito');
    const emTransitoPorSku = {};
    for (const t of (transito || [])) {
      emTransitoPorSku[`${chaveCor(t.cor)}|${String(t.tam).toUpperCase()}`] = n(t.qtd_enviada);
    }

    // 6) trava de 72h (o que a Cris já confirmou nesta semana)
    const { data: travas } = await supabase.from('full_travas')
      .select('cor, tam, tipo, qtd, vence_em')
      .eq('ref', refNorm(ref)).is('usada_em', null).gt('vence_em', new Date().toISOString());

    // venda semanal POR COR (soma dos tamanhos) — é o que decide entrada no
    // Full e permanência fora de estação
    const semanaPorCor = {};
    for (const [k, q] of Object.entries(v14)) {
      const cor = k.split('|')[0];
      semanaPorCor[cor] = (semanaPorCor[cor] || 0) + (q / 14) * 7;
    }

    // ── monta as linhas ──
    // 18/08: o Bling tem a mesma cor com duas grafias (Marrom e Marrom
    // Escuro). Junta antes de calcular — uma linha por cor+tamanho, com o
    // rótulo canônico e o maior saldo (não soma: é o mesmo produto).
    const porCorTam = {};
    for (const e of (estoque || [])) {
      if (!e.cor_label && !e.cor_norm) continue;      // linha do produto pai
      const k = `${chaveCor(e.cor_label || e.cor_norm)}|${String(e.tam).toUpperCase()}`;
      const at = porCorTam[k];
      if (!at || Math.abs(n(e.qtd)) > Math.abs(n(at.qtd))) {
        porCorTam[k] = { ...e, cor_label: canonizarCor(e.cor_label || e.cor_norm) };
      }
    }

    const linhas = [];
    for (const e of Object.values(porCorTam)) {
      const k = `${chaveCor(e.cor_label || e.cor_norm)}|${String(e.tam).toUpperCase()}`;
      const vendaDia = (v14[k] || 0) / 14;
      const vendaAnterior = Math.max(0, (v28[k] || 0) - (v14[k] || 0)) / 14;
      const tendencia = vendaAnterior > 0 ? ((vendaDia - vendaAnterior) / vendaAnterior) * 100 : (vendaDia > 0 ? 100 : 0);

      const noFull = fullPorSku[k];   // casado por cor+tamanho
      const corte = (cortes || []).find(c => (c.cores || []).some(x => chaveCor(x.nome) === chaveCor(e.cor_label)));
      const diasAteCorte = corte?.data_entrega
        ? Math.max(0, Math.ceil((new Date(corte.data_entrega) - hoje) / 86400000)) : 99;

      const linha = calcularLinha({
        cor: e.cor_label || e.cor_norm, tam: e.tam,
        vendaDia,
        vendaDiaFull: (vFull14[k] || 0) / 14,
        novaNoFull: !noFull || n(noFull.qtd) === 0,
        reposicao: reposicaoDe(e.cor_label || e.cor_norm, e.tam),
        estoqueFull: n(noFull?.qtd),
        estoqueFabrica: n(e.qtd),
        emTransito: n(emTransitoPorSku[k]),
        corteChegando: corte ? 1 : 0,
        diasAteCorte,
        jaNoFull: !!noFull,
        vendaSemanaCor: semanaPorCor[chaveCor(e.cor_label || e.cor_norm)] || 0,
      }, regras, hoje);

      const trava = (travas || []).find(t => chaveCor(t.cor) === chaveCor(e.cor_label) && String(t.tam).toUpperCase() === String(e.tam).toUpperCase());
      const corK = chaveCor(e.cor_label || e.cor_norm);
      linhas.push({
        nova_no_full: !noFull || n(noFull.qtd) === 0,     // recomendação de cor nova
        no_ranking: noRanking.has(corK),
        ...linha, sku: e.bling_sku,
        vendaDiaFull: +(((vFull14[k] || 0) / 14).toFixed(2)),
        tendencia_pct: Math.round(tendencia),
        ja_no_full: !!noFull,
        travado: trava ? { tipo: trava.tipo, qtd: trava.qtd, vence_em: trava.vence_em } : null,
        qtd_enviar: trava?.tipo === 'fora_da_semana' ? 0 : (trava?.qtd ?? linha.qtd_sugerida),
      });
    }

    // ── cor NOVA no Full só entra com a GRADE COMPLETA (ordem dele 18/08):
    //    4 tamanhos no regular (P M G GG) ou 3 no plus. Faltando um, não
    //    recomenda nenhum — mandar grade quebrada trava a venda no anúncio.
    const PLUS = ['G1', 'G2', 'G3'];
    const porCorNova = {};
    for (const l of linhas) {
      if (!l.nova_no_full) continue;
      (porCorNova[chaveCor(l.cor)] = porCorNova[chaveCor(l.cor)] || []).push(l);
    }
    for (const [ck, itens] of Object.entries(porCorNova)) {
      const ehPlus = itens.some(i => PLUS.includes(String(i.tam).toUpperCase()));
      const exigidos = ehPlus ? 3 : 4;
      const completos = itens.filter(i => n(i.qtd_sugerida) > 0).length;
      if (completos < exigidos) {
        for (const i of itens) {
          if (!n(i.qtd_sugerida)) continue;
          i.qtd_sugerida = 0; i.qtd_enviar = 0;
          i.motivo = `cor nova: só daria ${completos} de ${exigidos} tamanhos — grade incompleta não entra no Full`;
        }
      }
    }

    // ── 13/09 (regras dele): CORES QUE DEVERIAM ESTAR NO FULL ─────────────
    // (1) cor entre as TOP 20 do ranking de cores do Bling (30d, todos os canais);
    // (2) >= 20 vendas da cor NESTA REF nos ultimos 15 dias, todos os canais;
    // (3) fabrica com >= 5 pecas em TODOS os tamanhos da grade da cor;
    // (4) cor fora do Full (armazem zerado) ou sub-estocada (soma < 5 pecas ou
    //     mais da metade dos tamanhos zerados). Botao preenche 5 por tamanho.
    let cores_sugeridas = [];
    let topKeys = new Set();   // 14/09: também decide o que fica visível na tabela
    try {
      const { data: top } = await supabase.from('vw_ranking_cores_catalogo').select('cor_key, cor, vendas_30d, rank_global').lte('rank_global', 20);
      topKeys = new Set((top || []).map(t => chaveCor(t.cor)));
      const v15 = await vendaPorSku(ref, 15);
      const vendasCor15 = {};
      for (const [k, q] of Object.entries(v15)) { const c = k.split('|')[0]; vendasCor15[c] = (vendasCor15[c] || 0) + n(q); }
      const porCor = {};
      for (const e of (estoque || [])) {
        const c = chaveCor(e.cor_label || e.cor_norm); const t = String(e.tam || '').toUpperCase().trim();
        if (!c || !t) continue;
        porCor[c] = porCor[c] || { cor: e.cor_label || e.cor_norm, tams: {} };
        porCor[c].tams[t] = { fabrica: n(e.qtd), full: n(fullPorSku[`${c}|${t}`]?.qtd), reposicao: reposicaoDe(e.cor_label || e.cor_norm, t) };
      }
      for (const [c, info] of Object.entries(porCor)) {
        if (!topKeys.has(c)) continue;
        const vendas = vendasCor15[c] || 0;
        if (vendas < 20) continue;
        const tams = Object.entries(info.tams);
        if (!tams.length || tams.some(([, x]) => x.fabrica < 5 && !(x.reposicao > 0))) continue;   // 14/09: fábrica zerada com corte ativo conta
        const somaFull = tams.reduce((s, [, x]) => s + x.full, 0);
        const zerados = tams.filter(([, x]) => x.full === 0).length;
        const fora = somaFull === 0, sub = !fora && (somaFull < 5 || zerados > tams.length / 2);
        if (!fora && !sub) continue;
        cores_sugeridas.push({ cor: info.cor, cor_key: c, vendas_15d: vendas, situacao: fora ? 'fora do Full' : 'sub-estocada no Full',
          full_total: somaFull, tamanhos: tams.map(([t, x]) => ({ tam: t, fabrica: x.fabrica, full: x.full, reposicao: x.reposicao, enviar: 5 })), total_enviar: tams.length * 5 });
      }
      cores_sugeridas.sort((a, b) => b.vendas_15d - a.vendas_15d);
    } catch (e) { cores_sugeridas = []; }

    const coresSugKeys = new Set(cores_sugeridas.map(c => c.cor_key));

    // ── o que aparece na tela (ordem dele 18/08) ──
    //   fica: cor ATIVA no Full (com quantidade) que esteja no ranking de
    //         cores, e cor FORA do Full que a régua recomenda enviar
    //   sai:  cor parada no Full que nem aparece no ranking de vendas
    // 14/09 (regra dele): a decisão de mostrar é POR COR, com todos os tamanhos:
    //   · cor que tem estoque no Full em qualquer tamanho → todos os tamanhos aparecem
    //     (Amarelo GG e Branco P zerados não podem sumir; Azul Serenity aparece zerado)
    //   · cor do TOP 20 do ranking do Bling com alguma sugestão → todos os tamanhos
    //   · some só a cor zerada no Full em todos os tamanhos e que a régua não sugere
    const fullPorCor = {}, sugPorCor = {};
    for (const l of linhas) {
      const c = chaveCor(l.cor);
      fullPorCor[c] = (fullPorCor[c] || 0) + n(l.estoqueFull);
      sugPorCor[c] = (sugPorCor[c] || 0) + n(l.qtd_enviar) + n(l.qtd_sugerida);
    }
    const minEntradaSem = n(regras.entrada_nova_cor_semana) || 12;
    const ocultas = [];
    const visiveis = linhas.filter(l => {
      const ativaNoFull = n(l.estoqueFull) > 0;
      const corK = chaveCor(l.cor);
      const corTemSugestao = sugPorCor[corK] > 0 || coresSugKeys.has(corK) || (semanaPorCor[corK] || 0) >= minEntradaSem;
      if (fullPorCor[corK] > 0) return true;                                // cor presente no Full: grade inteira
      if (topKeys.has(corK) && corTemSugestao) return true;               // top 20 com sugestão: grade inteira
      if (n(l.qtd_enviar) > 0 || n(l.qtd_sugerida) > 0) return true;    // recomendada
      if (coresSugKeys.has(chaveCor(l.cor))) { l.cor_sugerida = true; return true; }   // 13/09: cor que deveria estar no Full
      // 14/09 (regra dele): cor com DEMANDA ATIVA (vende >= o mínimo de entrada por
      // semana, todos os canais) e ZERADA no Full — ou que nunca foi pro Full — nunca
      // fica escondida: aparece com o motivo, mesmo que a régua tenha dado 0
      if (l.nova_no_full && (semanaPorCor[chaveCor(l.cor)] || 0) >= (n(regras.entrada_nova_cor_semana) || 12)) { l.cor_sugerida = true; return true; }
      if (ativaNoFull && l.no_ranking) return true;                     // ativa e vendendo
      ocultas.push(`${l.cor} ${l.tam}`);
      return false;
    });
    linhas.length = 0;
    linhas.push(...visiveis);

    // ordena: quem mais precisa primeiro
    linhas.sort((a, b) => (b.qtd_sugerida - a.qtd_sugerida) || String(a.cor).localeCompare(String(b.cor)) || String(a.tam).localeCompare(String(b.tam)));

    return res.status(200).json({
      ref: refNorm(ref),
      cores_sugeridas,
      regras: { cobertura: n(regras.cobertura_dias), basicas: n(regras.cobertura_basicas), transito: n(regras.transito_dias) },
      total_sugerido: linhas.reduce((s, l) => s + n(l.qtd_enviar), 0),
      novas_no_full: linhas.filter(l => l.nova_no_full && n(l.qtd_enviar) > 0).length,
      ocultas: ocultas.length,
      ocultas_exemplo: ocultas.slice(0, 6),
      linhas,
    });
  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
}
