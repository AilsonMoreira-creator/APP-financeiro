/**
 * wms-etiquetas.js — O MAÇO DE ETIQUETAS CASADAS (Ailson 12/08/2026)
 *
 * A ideia dele: em vez de imprimir etiquetas em ordem aleatória no Bling,
 * imprimir NF (DANFE simplificada) + etiqueta de transporte AGRUPADAS por
 * REF e localização — o casamento peça↔etiqueta acontece na arara, uma REF
 * por vez. Formato 10x15 (térmica).
 *
 * GET ?previa=1&contas=muniam&loja=todas&tipo=nf_transporte[&ref=2277][&corte=1]
 *   → JSON dos grupos (ref, loc, pedidos, com/sem NF) na ordem de impressão
 * GET ?pdf=1&mesmos filtros
 *   → PDF único: separador de REF (10x15) + DANFE + etiqueta ML por pedido
 *
 * Fontes: DANFE via Bling (linkDanfe — precisa do escopo NF-e na conta;
 * hoje só a Muniam tem). Etiqueta de transporte: Mercado Livre via API
 * oficial (shipment_labels em lote). Outros canais: fase 2.
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { supabase, blingFetch, refreshBlingToken } from './_bling-helpers.js';
import { getValidToken } from './_ml-helpers.js';
import crypto from 'crypto';
import { etiquetasDoMl } from './_wms-ml-etiquetas.js';

const hashDoc = (b) => crypto.createHash('sha256').update(b).digest('hex').slice(0, 32);

export const config = { maxDuration: 300 };

const BRAND = { exitus: 'Exitus', lumia: 'Lumia', muniam: 'Muniam' };
const n = (v) => Number(v) || 0;

async function pedidosFiltrados(q) {
  const hojeBRT = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
  const contas = String(q.contas || 'todas');
  const loja = String(q.loja || 'todas');
  const tipo = String(q.tipo || 'nf_transporte');
  const ref = String(q.ref || '').replace(/^0+/, '');
  // 22/08: reimpressao POR BLOCO — a tela manda refs=2601,2708 (grupos
  // selecionados na Ordem de impressao) e so eles entram no lote
  const refsSel = q.refs ? new Set(String(q.refs).split(',').map(s => s.trim().replace(/^0+/, '')).filter(Boolean)) : null;
  // corte=HH:MM (Ailson 12/08): só pedidos que entraram até o horário de corte
  // de HOJE — mesma lógica da lista de separação
  const corte = String(q.corte || '');
  let limiteCorte = null;
  if (/^\d{1,2}:\d{2}$/.test(corte)) {
    const [hh, mm] = corte.split(':').map(Number);
    const agora = new Date();
    const hojeBRT = new Date(agora.getTime() - 3 * 3600000).toISOString().slice(0, 10);
    limiteCorte = new Date(`${hojeBRT}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00-03:00`).getTime();
  }

  // 13/08 (chave dada por ele): a FILA DE IMPRESSÃO é a SITUAÇÃO DA NF, não o
  // status do funil — "Autorizada sem DANFE" (situação 5) = precisa imprimir;
  // "Emitida DANFE" (6) = já saiu, inclusive se a Sthefany imprimiu no painel.
  // Por isso buscamos: (1) quem já tem NF (últimos 7 dias, qualquer status) e
  // (2) quem ainda está no funil sem NF (aparece como "aguardando").
  const desde7 = new Date(Date.now() - 7 * 86400000).toISOString();
  const COLS = 'conta, pedido_id, numero, numero_loja, canal_geral, ml_logistic_type, itens, status_wms, data_pedido, etiqueta_impressa_em, finalizado_em, nf_id, nf_situacao, nf_checado_em, ml_agendado_em, ml_ship_status, ml_ship_substatus, nf_agendada_impressa_em, print_estado, print_regra, print_nf, print_etiqueta, print_motivo, situacao_bling';

  let q1 = supabase.from('wms_pedidos').select(COLS)
    .not('nf_id', 'is', null)
    .neq('status_wms', 'cancelado')
    .gte('data_pedido', desde7)
    .order('data_pedido', { ascending: false }).limit(500);
  if (contas !== 'todas') q1 = q1.in('conta', contas.split(','));

  let q2 = supabase.from('wms_pedidos').select(COLS)
    .is('nf_id', null)
    .in('status_wms', ['aberto', 'em_separacao'])
    .order('data_pedido', { ascending: true }).limit(300);
  if (contas !== 'todas') q2 = q2.in('conta', contas.split(','));

  // (3) FINALIZADOS RECENTES SEM nf_id no nosso banco — é o caso da NF feita
  // À MÃO no Bling (14/08, pedido 70997 Christine/Shopee Lumia): o pedido já
  // tinha nota, mas como o nf_id não estava gravado ele não caía em (1) nem
  // em (2) e sumia da tela. O cron wms-nf-sync descobre o nf_id deles em até ~20 min.
  let q3 = supabase.from('wms_pedidos').select(COLS)
    .is('nf_id', null)
    .eq('status_wms', 'finalizado')
    // usa criado_em: quando o SYNC finaliza o pedido (situação atendido no
    // Bling) o finalizado_em fica vazio, e o filtro por ele escondia o pedido
    .gte('criado_em', new Date(Date.now() - 2 * 86400000).toISOString())
    .order('criado_em', { ascending: false }).limit(120);
  if (contas !== 'todas') q3 = q3.in('conta', contas.split(','));

  // (4) AGENDADOS do ML — compra de até 20 dias atrás libera hoje; a janela
  // de 7 dias das outras consultas escondia a liberada do dia (19/08)
  let q4 = supabase.from('wms_pedidos').select(COLS)
    .not('ml_agendado_em', 'is', null)
    .neq('status_wms', 'cancelado')
    .gte('criado_em', new Date(Date.now() - 20 * 86400000).toISOString())
    .order('data_pedido', { ascending: false }).limit(300);
  if (contas !== 'todas') q4 = q4.in('conta', contas.split(','));

  const [{ data: comNf }, { data: semNf }, { data: finSemNf }, { data: agend }] = await Promise.all([q1, q2, q3, q4]);
  const vistosP = new Set();
  const peds = [...(comNf || []), ...(semNf || []), ...(finSemNf || []), ...(agend || [])].filter(p => {
    const k = String(p.pedido_id);
    if (vistosP.has(k)) return false;
    vistosP.add(k); return true;
  });

  const out = [];
  for (const p of (peds || [])) {
    const canal = String(p.canal_geral || '');
    const flex = p.ml_logistic_type === 'self_service';
    const full = p.ml_logistic_type === 'fulfillment';
    if (full) continue; // equipe não encosta
    // 18/08: pedido do FULL não imprime nada aqui — a mercadoria já está no
    // armazém do ML e ele mesmo despacha. Estava inflando "prontas" (eram 218
    // na Exitus) e o PDF depois vinha vazio.
    if (p.print_regra === 'ML_FULL' || p.ml_logistic_type === 'fulfillment') continue;
    if (tipo === 'flex' && !flex) continue;
    if (tipo === 'meluni' && canal !== 'Meluni') continue;
    if (tipo === 'nf_transporte' && (flex || canal === 'Meluni')) continue;

    // 17/08 — ENVIOS PROGRAMADOS do Mercado Livre. A equipe imprime a NF antes
    // (com a data em cima) e separa; no dia, imprime só a etiqueta e despacha.
    const agendadoFuturo = p.ml_agendado_em && String(p.ml_agendado_em) > hojeBRT;
    // 18/08 (regra dele): "liberada" é o AGENDADO cujo dia chegou — pedido
    // normal em ready_to_print pertence ao NF + transporte, não aqui
    const agendadoChegou = p.ml_agendado_em && String(p.ml_agendado_em).slice(0, 10) <= hojeBRT;
    // 19/08: SEM excluir finalizado — no agendado a NF sai dias antes, o
    // pedido vira atendido no Bling (finalizado) e a etiqueta só libera no
    // dia. Quem diz se saiu e o ML: ready_to_print = falta imprimir.
    const etiquetaLiberada = agendadoChegou
      && p.ml_ship_status === 'ready_to_ship'
      && p.ml_ship_substatus === 'ready_to_print'
      && !p.etiqueta_impressa_em;
    if (tipo === 'nf_agendada') {
      if (!(agendadoFuturo || p.ml_ship_substatus === 'buffered')) continue;
      // 17/08 (ordem dele): a nota do agendado sai UMA vez — some da lista
      // depois de impressa (carimbo próprio, separado do da etiqueta)
      if (p.nf_agendada_impressa_em && q.reimprimir !== '1') continue;
    }
    if (tipo === 'etiqueta_liberada' && !etiquetaLiberada) continue;
    // nos demais tipos, o pedido agendado NÃO entra (a etiqueta nem existe)
    if (['nf_transporte', 'flex'].includes(tipo) && agendadoFuturo) continue;
    if (loja !== 'todas' && canal !== loja) continue;
    if (limiteCorte && new Date(p.data_pedido).getTime() > limiteCorte) continue;
    const it0 = (p.itens || [])[0] || {};
    const r = String(it0.ref || '?').replace(/^0+/, '');
    if (ref && r !== ref) continue;
    if (refsSel && !refsSel.has(r)) continue;
    out.push({ ...p, ref: r, loc: String(it0.estoque || '—').toUpperCase() });
  }
  // ORDEM DE IMPRESSÃO (regra dele 13/08): localização A → todas as refs
  // daquela localização ordenadas por MAIOR QUANTIDADE → localização B → …
  // Com ?por_empresa=1 as empresas saem inteiras, uma depois da outra
  // (Exitus → Lumia → Muniam), cada uma com esse mesmo critério interno.
  const ORDEM_CONTA = { exitus: 0, lumia: 1, muniam: 2 };
  const qtdPorGrupo = {};
  for (const p of out) {
    const k = `${q.por_empresa === '1' ? p.conta : ''}|${p.loc}|${p.ref}`;
    qtdPorGrupo[k] = (qtdPorGrupo[k] || 0) + 1;
  }
  const chaveDe = (p) => `${q.por_empresa === '1' ? p.conta : ''}|${p.loc}|${p.ref}`;
  const locOrdem = (l) => (l === '—' ? 'zzz' : l); // sem localização por último
  out.sort((a, b) =>
    (q.por_empresa === '1' ? (ORDEM_CONTA[a.conta] ?? 9) - (ORDEM_CONTA[b.conta] ?? 9) : 0)
    || locOrdem(a.loc).localeCompare(locOrdem(b.loc))
    || (qtdPorGrupo[chaveDe(b)] - qtdPorGrupo[chaveDe(a)])
    || a.ref.localeCompare(b.ref)
    || String(a.data_pedido).localeCompare(String(b.data_pedido))
  );
  return out;
}

// 19/08 v2: NORMALIZAR o PDF do Bling página a página — deitada corta em
// duas 10x15 em pé (esquerda antes), em pé mantém. Cobre [etiqueta|DANFE],
// multi-volume [et1|et2]+[DANFE na pg2] e Shein multi-página, sem descartar
// nada (o corte antigo só olhava a página 1 e jogava a 2 fora — pedido de
// 2 volumes saía com as etiquetas achatadas e SEM a nota).
async function normalizarCasada(pdf64) {
  try {
    const doc = await PDFDocument.load(Buffer.from(pdf64, 'base64'));
    const nPg = doc.getPageCount();
    const W = 288, H = 432;   // 4x6 pol em pontos
    const saida = await PDFDocument.create();
    let cortes = 0;
    // 20/08 (Ailson): quando o documento TEM página deitada, a casada já traz
    // etiqueta+DANFE — as páginas em pé extras (DANFE A4 completa) são
    // redundantes e não saem. Documento todo em pé (Shein) mantém tudo.
    let temDeitada = false;
    for (let ip = 0; ip < nPg; ip++) {
      const { width, height } = doc.getPage(ip).getSize();
      if (width > height * 1.15) { temDeitada = true; break; }
    }
    for (let ip = 0; ip < nPg; ip++) {
      const pg = doc.getPage(ip);
      const { width, height } = pg.getSize();
      const ehDeitada = width > height * 1.15;
      if (temDeitada && !ehDeitada) continue;   // A4 redundante da casada
      const partes = ehDeitada
        ? [{ left: 0, right: width / 2 }, { left: width / 2, right: width }]
        : [{ left: 0, right: width }];
      if (partes.length === 2) cortes++;
      for (const parte of partes) {
        const [emb] = await saida.embedPages([pg], [{ left: parte.left, right: parte.right, top: height, bottom: 0 }]);
        const larguraParte = parte.right - parte.left;
        const esc = Math.min(W / larguraParte, H / height);
        const pgN = saida.addPage([W, H]);
        pgN.drawPage(emb, {
          x: (W - larguraParte * esc) / 2,
          y: (H - height * esc) / 2,
          xScale: esc, yScale: esc,
        });
      }
    }
    const total = saida.getPageCount();
    return {
      pdf: Buffer.from(await saida.save()).toString('base64'),
      paginas: total,
      casada: total >= 2,   // ≥2 páginas finais = DANFE embutida no documento
      cortes,
    };
  } catch { return null; }
}

// 18/08: situacaoPorNfId e preencherNfIds saíram daqui — o cron wms-nf-sync
// mantém nf_id e nf_situacao no banco, e a DANFE tem reserva no detalhe do pedido.

// links de etiqueta do Bling (só existem depois de gerada/casada no Bling)
/**
 * ATENÇÃO (13/08, regra do Ailson): puxar a etiqueta MUDA O ESTADO NO
 * MARKETPLACE — na Shein o pedido vira "aguardando coleta" só de baixar o
 * arquivo, mesmo sem imprimir, e isso confunde a equipe. Por isso esta função
 * só pode ser chamada no MOMENTO REAL da impressão (?zpl=1 / ?pdf=1), nunca
 * na prévia, no debug ou em cron. O parâmetro `motivo` documenta a origem.
 */
async function linksEtiqueta(peds, tokenPorConta, motivo = 'impressao') {
  if (motivo !== 'impressao') {
    console.warn('[etiquetas] chamada bloqueada fora da impressão:', motivo);
    return {};
  }
  const mapa = {};
  for (const conta of new Set(peds.map(p => p.conta))) {
    if (!tokenPorConta[conta]) continue;
    const hb = { Authorization: 'Bearer ' + tokenPorConta[conta], Accept: 'application/json' };
    const ids = peds.filter(p => p.conta === conta).map(p => p.pedido_id);
    // ATENÇÃO (13/08): se UM id do lote não tiver logística cadastrada, o
    // Bling rejeita o LOTE INTEIRO. Então: tenta em lote (rápido quando todos
    // têm) e, se falhar, cai pra individual — assim um pedido sem etiqueta
    // não esconde os que estão prontos.
    for (let i = 0; i < ids.length; i += 20) {
      const fatia = ids.slice(i, i + 20);
      let achouNoLote = false;
      try {
        const url = `https://api.bling.com.br/Api/v3/logisticas/etiquetas?formato=PDF&${fatia.map(id => `idsVendas[]=${id}`).join('&')}`;
        const r = await blingFetch(url, hb);
        const j = typeof r.json === 'function' ? await r.json().catch(() => ({})) : {};
        for (const e of (j?.data || [])) {
          if (!e?.id || !e?.link) continue;
          mapa[String(e.id)] = e.link;   // pode vir com id do pedido OU da NF
          const doPedido = peds.find(p => String(p.nf_id) === String(e.id));
          if (doPedido) mapa[String(doPedido.pedido_id)] = e.link;
          achouNoLote = true;
        }
      } catch { /* cai no individual */ }
      await new Promise(r2 => setTimeout(r2, 350));
      // 14/08 (bug do pedido da Fernanda): a resposta identifica a etiqueta
      // pelo id da NOTA FISCAL quando o pedido já tem NF — não pelo id do
      // pedido. Casar por e.id perdia a etiqueta. Aqui perguntamos UM A UM
      // pros que faltaram e guardamos com o id do pedido que pedimos.
      for (const id of fatia) {
        if (mapa[String(id)]) continue;
        try {
          const r = await blingFetch(`https://api.bling.com.br/Api/v3/logisticas/etiquetas?formato=PDF&idsVendas[]=${id}`, hb);
          const j = typeof r.json === 'function' ? await r.json().catch(() => ({})) : {};
          const link = j?.data?.[0]?.link;
          if (link) mapa[String(id)] = link;
        } catch { /* segue */ }
        await new Promise(r2 => setTimeout(r2, 340));
      }
    }
  }
  return mapa;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const q = req.query || {};
  // 18/08: o contador de "impressas hoje" usa esta data e ela só existia
  // dentro de pedidosFiltrados — a tela quebrava com "hojeBRT is not defined".
  const hojeBRT = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
  try {
    // CONTADORES POR TIPO (17/08, pedido dele): cada botão de IMPRIMIR mostra
    // quantas etiquetas estão esperando impressão. Lê só o banco.
    if (q.contadores === '1') {
      const hoje = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
      const contasFiltro = String(q.contas || 'todas');
      const COLS_CONT = 'pedido_id, conta, canal_geral, ml_logistic_type, print_regra, print_estado, ml_agendado_em, ml_ship_status, ml_ship_substatus, nf_agendada_impressa_em, nf_situacao, etiqueta_impressa_em, status_wms, situacao_bling';
      let sel = supabase.from('wms_pedidos')
        .select(COLS_CONT)
        .neq('status_wms', 'cancelado')
        .gte('criado_em', new Date(Date.now() - 5 * 86400000).toISOString())
        .limit(3000);
      if (contasFiltro !== 'todas') sel = sel.in('conta', contasFiltro.split(','));
      // 19/08: AGENDADOS têm consulta própria — compra de até 20 dias atrás
      // libera hoje; alargar a janela geral estourava o limit de 3000 sem
      // ordenação e as liberadas ficavam de fora do sorteio.
      let selAg = supabase.from('wms_pedidos')
        .select(COLS_CONT)
        .not('ml_agendado_em', 'is', null)
        .neq('status_wms', 'cancelado')
        .gte('criado_em', new Date(Date.now() - 20 * 86400000).toISOString())
        .limit(500);
      if (contasFiltro !== 'todas') selAg = selAg.in('conta', contasFiltro.split(','));
      const [{ data: dGeral }, { data: dAg }] = await Promise.all([sel, selAg]);
      const vistos = new Set();
      const data = [...(dGeral || []), ...(dAg || [])].filter(p => {
        const k = String(p.pedido_id);
        if (vistos.has(k)) return false;
        vistos.add(k); return true;
      });
      const c = { nf_transporte: 0, flex: 0, meluni: 0, nf_agendada: 0, etiqueta_liberada: 0 };
      for (const p of (data || [])) {
        // 18/08: Full sai ANTES de tudo — reposição do Full tem ml_agendado_em
        // e vazava pro contador de NF agendada (sem nem ter nota)
        if (p.print_regra === 'ML_FULL' || p.ml_logistic_type === 'fulfillment') continue;
        const agendado = p.ml_agendado_em && String(p.ml_agendado_em) > hoje;
        // AGENDADAS: sai do contador assim que a nota é impressa (carimbo nosso
        // ou DANFE emitida no Bling) — ordem dele 17/08
        if (p.print_regra === 'MELI_AGENDADO' || agendado) {
          if (!p.nf_agendada_impressa_em && p.nf_situacao !== 6 && p.print_estado === 'PRONTO') c.nf_agendada++;
          continue;
        }
        // LIBERADAS: só as que ainda não saíram. Etiqueta impressa (nossa ou
        // pelo painel) e pedido já finalizado não contam mais.
        // 17/08: "liberada" = o ML está ESPERANDO A IMPRESSÃO (ready_to_print).
        // 18/08 (regra dele): e tem que ser pedido AGENDADO cujo dia chegou —
        // pedido normal em ready_to_print é do NF + transporte, contava em dobro.
        const agendadoChegou = p.ml_agendado_em && String(p.ml_agendado_em).slice(0, 10) <= hoje;
        // 19/08: finalizado NAO exclui — a NF antecipada finaliza o pedido no
        // Bling dias antes da etiqueta liberar; ready_to_print = falta imprimir
        if (agendadoChegou
          && p.ml_ship_status === 'ready_to_ship'
          && p.ml_ship_substatus === 'ready_to_print'
          && !p.etiqueta_impressa_em) c.etiqueta_liberada++;
        // 22/08: MELUNI segue o Bling e nada mais — em aberto conta, atendido
        // zera (as meninas nao geram NF; logistica sai pela Frenet)
        if (p.print_regra === 'MELUNI') { if (p.situacao_bling !== 9) c.meluni++; continue; }
        if (p.print_estado !== 'PRONTO') continue;
        if (p.print_regra === 'MELI_FLEX') c.flex++;
        else if (p.print_regra === 'NORMAL') c.nf_transporte++;
      }
      return res.status(200).json({ ok: true, contadores: c });
    }

    const peds = await pedidosFiltrados(q);

    if (q.previa === '1') {
      // 17/08 — REDESENHO: a prévia NÃO fala mais com o Bling. A situação da
      // nota vem pré-carregada pelo cron `wms-nf-sync` (a cada 10 min), o que
      // tirou a tela de MINUTOS de espera para instantânea. O Bling só é
      // chamado no momento real da impressão (buscar a etiqueta).
      const sitDe = {};
      for (const p of peds) if (p.nf_id && p.nf_situacao != null) sitDe[String(p.nf_id)] = p.nf_situacao;
      const links = {};
      const grupos = {};
      let prontas = 0, jaImpressas = 0, semEtiqueta = 0;
      for (const p of peds) {
        const k = `${q.por_empresa === '1' ? p.conta + '·' : ''}${p.loc}·${p.ref}`;
        grupos[k] = grupos[k] || { loc: p.loc, ref: p.ref, empresa: q.por_empresa === '1' ? p.conta : null, pedidos: 0, prontas: 0, impressas: 0, contas: new Set(), canais: new Set() };
        grupos[k].pedidos++;
        grupos[k].contas.add(p.conta);
        grupos[k].canais.add(p.canal_geral);
        // REGRA (13/08): situação 6 = DANFE já emitida → já impressa;
        // situação 5 = autorizada sem DANFE → PRECISA IMPRIMIR (se a etiqueta
        // já existe no Bling); sem NF ainda → aguardando
        const sit = p.nf_id ? sitDe[String(p.nf_id)] : null;
        // 18/08 (ele apontou): "já impressas" tem que contar SÓ AS DE HOJE —
        // estava somando os dias anteriores. E Flex não tem NF, então não
        // pode entrar em "aguardando nota".
        const impressaHoje = p.etiqueta_impressa_em
          && String(new Date(p.etiqueta_impressa_em).getTime() - 3 * 3600000 > 0
            ? new Date(new Date(p.etiqueta_impressa_em).getTime() - 3 * 3600000).toISOString().slice(0, 10) : '') === hojeBRT;
        const ehFlexLinha = p.ml_logistic_type === 'self_service';

        if (q.tipo === 'nf_agendada') {
          // aqui o que conta é a NOTA: pronta = tem NF e ainda não foi impressa
          if (p.nf_agendada_impressa_em) { grupos[k].impressas++; jaImpressas++; }
          else if (p.nf_id) { grupos[k].prontas++; prontas++; }
          else semEtiqueta++;
        } else if (q.tipo === 'etiqueta_liberada') {
          grupos[k].prontas++; prontas++;   // liberada pelo ML = pode imprimir
        } else if (sit === 6 || p.situacao_bling === 9 || p.etiqueta_impressa_em || p.print_estado === 'IMPRESSO') {
          // 20/08 (ele apontou: "540 impressas" impossível): situação 6 de
          // QUALQUER dia entrava na conta de hoje. Agora "já impressas" =
          // carimbo NOSSO de hoje OU impressa PELO BLING (sit 6/atendido, sem
          // carimbo nosso) de pedido de hoje — 22/08: o card conta App+Bling.
          // 22/08 (ele apontou contagem baixa): pedido de ONTEM impresso HOJE
          // pelo painel nao tem carimbo nosso — a regua de "so pedido de hoje"
          // derrubava ele da conta. Janela: hoje + ontem.
          const ontemBRT = new Date(Date.now() - 3 * 3600000 - 86400000).toISOString().slice(0, 10);
          const impressaBlingHoje = !p.etiqueta_impressa_em && String(p.data_pedido || '').slice(0, 10) >= ontemBRT;
          if (impressaHoje || impressaBlingHoje) { grupos[k].impressas++; jaImpressas++; }
          else grupos[k].pedidos--;          // impressa em outro dia: fora da conta
        } else if (q.tipo === 'meluni'
          // 22/08 (regra dele): Meluni e VISUAL — NF e logistica saem pela
          // Frenet, fora do Bling. Conta o pedido EM ABERTO; atendido some.
          ? (p.situacao_bling !== 9 && (grupos[k].prontas++, prontas++, true))
          : ((sit === 5 || p.print_estado === 'PRONTO') && p.ml_ship_status !== 'cancelled' && p.situacao_bling !== 9 && (grupos[k].prontas++, prontas++, true))) { /* contado acima */ }
        else if (ehFlexLinha) { grupos[k].pedidos--; }   // Flex não tem nota
        else if (p.print_etiqueta === false || p.status_wms === 'finalizado') {
          // 17/08 (ordem dele): Flex/Meluni sem NF e pedido já finalizado NÃO
          // são "aguardando" — não têm nada pra imprimir aqui. Ficam fora da
          // conta pra não assustar a equipe com um número que não é problema.
          grupos[k].pedidos--;
        } else semEtiqueta++;
      }
      const ultimaChecagem = peds.map(p => p.nf_checado_em).filter(Boolean).sort().pop() || null;
      return res.status(200).json({
        sincronizado_em: ultimaChecagem,
        total_pedidos: peds.length,
        prontas,
        ja_impressas: jaImpressas,
        aguardando: semEtiqueta,
        // 22/08 (ele apontou 0/2 e 0/0 na lista): grupo SEM pronta e SEM
        // impressa nao tem acao possivel — aguardando NF ja tem o chip
        // proprio; card vazio so polui a auditoria visual.
        grupos: Object.values(grupos).filter(g => (g.prontas || 0) > 0 || (g.impressas || 0) > 0).map(g => ({ ...g, contas: [...g.contas], canais: [...g.canais] })),
        nota: peds.length > 60 ? 'Acima de 60 pedidos a geração demora alguns minutos — considere gerar por REF.' : null,
      });
    }

    // ── MODO ZPL (13/08): a etiqueta do Bling vem em ZPL dentro de um ZIP —
    // é o formato NATIVO da térmica. Com o QZ Tray na máquina da expedição,
    // mandamos o ZPL direto: mais rápido e mais nítido que PDF.
    // ── PRÉVIA (19/08, pedido do Ailson): PDF único de conferência com a
    // sequência REAL da impressão — SEM efeito colateral: nada é puxado do
    // Bling/marketplace. Fontes: documentos guardados + DANFEs em cache.
    //   · PDF guardado → normalizado (casada cortada) e incorporado
    //   · ZPL guardado (Shopee) → renderizado via labelary (visual), com
    //     fallback de página descritiva se o serviço falhar
    //   · Shein → SEMPRE página placeholder "Shein logística" (nunca puxa)
    //   · sem documento → página "será puxada na hora da impressão"
    // ── PRINT JOB (20/08, arquitetura do Ailson): cada clique de imprimir
    // vira um PACOTE com identidade, e cada passo fica no histórico —
    // rodadas, marcações, falhas e fechamento. Base pra fila/estados finos.
    if (q.job_criar === '1') {
      const { data: job, error } = await supabase.from('wms_print_jobs')
        .insert({ filtros: { contas: q.contas, tipo: q.tipo, ref: q.ref || null, periodo: q.periodo || null } })
        .select('id').single();
      if (error) return res.status(500).json({ ok: false, erro: error.message });
      await supabase.from('wms_print_log').insert({ job_id: job.id, evento: 'criado', detalhe: { filtros: q } });
      return res.status(200).json({ ok: true, job_id: job.id });
    }
    if (q.job_fechar) {
      const jid = parseInt(q.job_fechar, 10);
      const falhou = !!q.falha;
      await supabase.from('wms_print_jobs').update({
        status: falhou ? 'falhou' : 'concluido',
        totais: { impressas: parseInt(q.total, 10) || 0, sem_danfe: parseInt(q.sem_danfe, 10) || 0 },
        fechado_em: new Date().toISOString(),
      }).eq('id', jid);
      await supabase.from('wms_print_log').insert({
        job_id: jid, evento: falhou ? 'falhou' : 'concluido',
        detalhe: { total: q.total, falha: q.falha ? String(q.falha).slice(0, 300) : undefined },
      });
      return res.status(200).json({ ok: true });
    }
    if (q.job_listar === '1') {
      const { data: jobs } = await supabase.from('wms_print_jobs')
        .select('id, criado_em, status, filtros, totais, fechado_em')
        .order('id', { ascending: false }).limit(10);
      const ids = (jobs || []).map(j2 => j2.id);
      const { data: logs } = ids.length ? await supabase.from('wms_print_log')
        .select('job_id, ts, evento, detalhe').in('job_id', ids).order('ts') : { data: [] };
      return res.status(200).json({ ok: true, jobs, logs });
    }

    if (q.previa_pdf === '1') {
      const peds = await pedidosFiltrados(q);
      // 20/08 (ele apontou): a prévia mostrava TODO pedido em aberto — até sem
      // NF. Agora usa exatamente o critério de "pronta" da tela/impressão.
      const sitDe = {};
      for (const p of peds) if (p.nf_id && p.nf_situacao != null) sitDe[String(p.nf_id)] = p.nf_situacao;
      const candidatos = peds.filter(p => {
        if (p.ml_ship_status === 'cancelled') return false;   // cancelado NUNCA sai — nem em reimpressao
        if (q.reimprimir === '1') return true;                // reimpressao: inclui impressas no App E no Bling
        if (q.tipo === 'nf_agendada') return !!p.nf_id && !p.nf_agendada_impressa_em;
        if (q.tipo === 'etiqueta_liberada') return true;
        const sit = p.nf_id ? sitDe[String(p.nf_id)] : null;
        if (sit === 6 || p.etiqueta_impressa_em || p.print_estado === 'IMPRESSO') return false;
        if (p.situacao_bling === 9) return false;             // atendido no Bling = impresso por la
        return sit === 5 || p.print_estado === 'PRONTO';
      }).slice(0, 80);
      if (!candidatos.length) return res.status(200).json({ ok: false, erro: 'nenhum pedido pronto nesses filtros' });

      const ids = candidatos.map(p => p.pedido_id);
      const docsPor = {};
      for (let i = 0; i < ids.length; i += 200) {
        const { data } = await supabase.from('wms_documentos')
          .select('pedido_id, tipo, formato, conteudo').in('pedido_id', ids.slice(i, i + 200));
        (data || []).forEach(d => {
          const k = String(d.pedido_id);
          docsPor[k] = docsPor[k] || {};
          docsPor[k][d.tipo] = d;
        });
      }

      const saida = await PDFDocument.create();
      const fB = await saida.embedFont(StandardFonts.HelveticaBold);
      const fN = await saida.embedFont(StandardFonts.Helvetica);
      const W = 288, H = 432;
      const pagTexto = (linhas, corFundo) => {
        const pg = saida.addPage([W, H]);
        if (corFundo) pg.drawRectangle({ x: 0, y: 0, width: W, height: H, color: corFundo });
        let y = H - 90;
        linhas.forEach((l, i2) => {
          pg.drawText(String(l).slice(0, 34), { x: 22, y, size: i2 === 0 ? 16 : 11, font: i2 === 0 ? fB : fN, color: rgb(0.17, 0.24, 0.31) });
          y -= i2 === 0 ? 30 : 17;
        });
      };
      const addPdf = async (b64) => {
        try {
          const doc = await PDFDocument.load(Buffer.from(b64, 'base64'));
          const pgs = await saida.copyPages(doc, doc.getPageIndices());
          pgs.forEach(pg => saida.addPage(pg));
          return true;
        } catch { return false; }
      };
      const desenharPng = async (bytes) => {
        const png = await saida.embedPng(bytes);
        const pg = saida.addPage([W, H]);
        const esc = Math.min(W / png.width, H / png.height);
        pg.drawImage(png, { x: (W - png.width * esc) / 2, y: (H - png.height * esc) / 2, width: png.width * esc, height: png.height * esc });
      };
      const renderZpl = async (zpl, pngCache64, p2) => {
        // 20/08: o preparo das 7:50 já deixa o visual pronto (PREVIA_PNG) —
        // aqui só desenha; renderizar na hora vira exceção (e alimenta o cache)
        try {
          if (pngCache64) { await desenharPng(Buffer.from(pngCache64, 'base64')); return true; }
          const rz = await fetch('https://api.labelary.com/v1/printers/8dpmm/labels/4x6/0/', {
            method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'image/png' },
            body: zpl,
          });
          if (!rz.ok) return null;
          const bytes = await rz.arrayBuffer();
          await desenharPng(bytes);
          try {
            const png64 = Buffer.from(bytes).toString('base64');
            await supabase.from('wms_documentos').upsert({
              pedido_id: p2.pedido_id, conta: p2.conta, tipo: 'PREVIA_PNG', formato: 'PNG',
              conteudo: png64, bytes: png64.length, hash: hashDoc(png64), origem: 'labelary', erro: null,
            }, { onConflict: 'pedido_id,tipo' });
          } catch { /* cache é conveniência */ }
          return true;
        } catch { return null; }
      };

      const addDanfe = async (docs, p3) => {
        const d = docs.DANFE;
        if (!d?.conteudo) {
          // par completo SEMPRE: sem DANFE em cache, entra o cartão dela —
          // a prévia espelha 1:1 a sequência física (nota, etiqueta, nota...)
          pagTexto([`DANFE`, ``, `Pedido ${p3.numero}  REF ${p3.ref}`, `Loc ${p3.loc} · ${p3.conta}`, ``, `Gerada na hora da impressão`, `(simplificada em ZPL, com`, `produtos e código de barras)`], rgb(0.93, 0.96, 0.93));
          return;
        }
        if (d.formato === 'ZPL') await renderZpl(d.conteudo, null, p3);
        else await addPdf(d.conteudo);
      };
      let n = 0;
      for (const p of candidatos) {
        n++;
        const docs = docsPor[String(p.pedido_id)] || {};
        const ehShein = String(p.canal_geral || '').toLowerCase().includes('shein');
        // DANFE em cache primeiro (quando não vem embutida na casada)
        const et = docs.ETIQUETA;
        if (ehShein) {
          await addDanfe(docs, p);
          pagTexto([`Shein logística`, ``, `Pedido ${p.numero}  REF ${p.ref}`, `Loc ${p.loc} · ${p.conta}`, ``, `A etiqueta é puxada só na`, `hora da impressão (regra:`, `baixar muda o status na Shein)`], rgb(0.97, 0.95, 0.90));
          continue;
        }
        // Mercado Livre (20/08): a impressão usa o ZPL2 ORIGINAL da API do ML,
        // que a prévia não pode baixar (marcaria "printed" no painel). Se o
        // cache já tem esse ZPL (impressão anterior), mostra ele; a casada PDF
        // do Bling NÃO aparece mais — o corte dela não representa a impressão.
        const ehMl = String(p.canal_geral || '') === 'Mercado Livre' && p.ml_logistic_type !== 'fulfillment';
        if (ehMl && et?.formato !== 'ZPL') {
          await addDanfe(docs, p);
          pagTexto([`Mercado Livre`, ``, `Pedido ${p.numero}  REF ${p.ref}`, `Loc ${p.loc} · ${p.conta}`, ``, `A etiqueta ZPL original do ML`, `é puxada só na hora da`, `impressão (regra: baixar`, `muda o status no painel)`], rgb(0.97, 0.95, 0.90));
          continue;
        }
        if (et?.formato === 'PDF' && et?.conteudo) {
          const norm = await normalizarCasada(et.conteudo);
          if (norm?.casada) { await addPdf(norm.pdf); continue; }
          await addDanfe(docs, p);
          await addPdf(norm ? norm.pdf : et.conteudo);
          continue;
        }
        if (et?.formato === 'ZPL' && et?.conteudo) {
          await addDanfe(docs, p);
          const ok = await renderZpl(et.conteudo, docs.PREVIA_PNG?.conteudo, p);
          if (!ok) pagTexto([`Etiqueta ZPL`, ``, `Pedido ${p.numero}  REF ${p.ref}`, `Loc ${p.loc} · ${p.conta}`, ``, `(render visual indisponível —`, `a impressão usa o ZPL original)`]);
          continue;
        }
        await addDanfe(docs, p);
        pagTexto([`Etiqueta ${String(p.canal_geral || '')}`.trim(), ``, `Pedido ${p.numero}  REF ${p.ref}`, `Loc ${p.loc} · ${p.conta}`, ``, `Será puxada na hora da`, `impressão (ou rode Preparar)`], rgb(0.99, 0.93, 0.88));
      }

      const pdfBytes = await saida.save();
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline; filename="previa-impressao.pdf"');
      return res.status(200).send(Buffer.from(pdfBytes));
    }

    if (q.zpl === '1' && q.tipo === 'nf_agendada') {
      return res.status(200).json({ total: 0, blocos: [], ids: [], em_pdf: ['nota'], so_pdf: true });
    }
    if (q.zpl === '1') {
      // 22/08: MELUNI nunca imprime por aqui — etiqueta de logistica e da
      // Frenet. O botao e visual; o guard vale pra qualquer chamada direta.
      if (q.tipo === 'meluni') return res.status(200).json({ total: 0, blocos: [], ids: [], so_aviso: 'frenet' });
      const { unzipSync } = await import('fflate');
      // 17/08 — REDESENHO: os documentos já preparados vêm do banco. Só o que
      // não estiver guardado é buscado agora no Bling (é o caso da Shein, que
      // fica de fora do preparo porque baixar a etiqueta muda o status dela).
      const idsLote = peds.map(p => p.pedido_id);
      const guardados = {};
      for (let i = 0; i < idsLote.length; i += 300) {
        const { data } = await supabase.from('wms_documentos')
          .select('pedido_id, formato, conteudo')
          .eq('tipo', 'ETIQUETA').is('erro', null)
          .in('pedido_id', idsLote.slice(i, i + 300));
        (data || []).forEach(d => { if (d.conteudo) guardados[String(d.pedido_id)] = d; });
      }
      const tk = {};
      const pegarToken = async (c) => {
        if (!(c in tk)) tk[c] = await refreshBlingToken(c).catch(() => null);
        return tk[c];
      };
      // a situação já vem pré-carregada no banco (cron wms-nf-sync)
      const sitDe = {};
      for (const p of peds) if (p.nf_id && p.nf_situacao != null) sitDe[String(p.nf_id)] = p.nf_situacao;

      // 19/08 DIAGNÓSTICO: ?zpl=1&debug_casada=1 mede a geometria do primeiro
      // PDF de etiqueta guardado (ML) e testa o corte — nada é impresso/puxado.
      if (q.debug_casada) {
        let selD = supabase.from('wms_documentos')
          .select('pedido_id, conteudo').eq('tipo', 'ETIQUETA').eq('formato', 'PDF')
          .order('criado_em', { ascending: false }).limit(3);
        const { data: docsAll } = await selD;
        let docs = docsAll;
        if (q.debug_casada.length > 1) {   // ?debug_casada=shein filtra por canal
          const idsD2 = (docsAll || []).map(d => d.pedido_id);
          const { data: docs30 } = await supabase.from('wms_documentos')
            .select('pedido_id, conteudo').eq('tipo', 'ETIQUETA').eq('formato', 'PDF')
            .order('criado_em', { ascending: false }).limit(30);
          const ids30 = (docs30 || []).map(d => d.pedido_id);
          const { data: pcs } = await supabase.from('wms_pedidos')
            .select('pedido_id, canal_geral').in('pedido_id', ids30);
          const canalDe = {};
          (pcs || []).forEach(pc => { canalDe[String(pc.pedido_id)] = String(pc.canal_geral || '').toLowerCase(); });
          docs = (docs30 || []).filter(d => (canalDe[String(d.pedido_id)] || '').includes(q.debug_casada.toLowerCase())).slice(0, 3);
        }
        const saida = [];
        for (const d of (docs || [])) {
          try {
            const doc = await PDFDocument.load(Buffer.from(d.conteudo, 'base64'));
            const pags = [];
            for (let ip = 0; ip < doc.getPageCount(); ip++) {
              const { width, height } = doc.getPage(ip).getSize();
              pags.push({ pg: ip + 1, width, height, deitada: width > height * 1.15 });
            }
            const norm = await normalizarCasada(d.conteudo);
            saida.push({ pedido: d.pedido_id, paginas_origem: pags, saida_paginas: norm?.paginas, cortes: norm?.cortes, casada: norm?.casada });
          } catch (e2) { saida.push({ pedido: d.pedido_id, erro: e2.message }); }
        }
        return res.status(200).json({ debug_casada: saida });
      }

      // 19/08 DIAGNÓSTICO: ?zpl=1&debug_danfe=1 roda o caminho da DANFE no
      // primeiro candidato com nf_id e devolve cada passo — NUNCA puxa etiqueta.
      if (q.debug_danfe) {
        const alvoDbg = peds.find(p2 => String(p2.pedido_id) === String(q.debug_danfe)) || peds.find(p2 => p2.nf_id);
        if (!alvoDbg) return res.status(200).json({ debug: 'nenhum candidato com nf_id', total_peds: peds.length });
        const passos = { pedido: alvoDbg.numero, conta: alvoDbg.conta, nf_id: alvoDbg.nf_id || null };
        try {
          const tkD = await refreshBlingToken(alvoDbg.conta).catch(e2 => { passos.token_erro = e2.message; return null; });
          passos.token_ok = !!tkD;
          if (tkD && alvoDbg.nf_id) {
            const hb3 = { Authorization: 'Bearer ' + tkD, Accept: 'application/json' };
            const nfR = await blingFetch(`https://api.bling.com.br/Api/v3/nfe/${alvoDbg.nf_id}`, hb3);
            passos.nfe_ok = !!nfR.ok; passos.nfe_status = nfR.status || null;
            const nf = typeof nfR.json === 'function' ? await nfR.json().catch(() => ({})) : {};
            passos.tem_linkDanfe = !!nf?.data?.linkDanfe; passos.tem_linkPDF = !!nf?.data?.linkPDF;
            // 20/08: testar o linkPDF SEPARADO (o buscarDanfe nunca chegava nele)
            if (nf?.data?.linkPDF) {
              try {
                const pR = await fetch(nf.data.linkPDF, { headers: { Accept: 'application/pdf' } });
                passos.linkpdf_status = pR.status;
                passos.linkpdf_content_type = pR.headers.get('content-type');
                const pb = new Uint8Array(await pR.arrayBuffer());
                passos.linkpdf_bytes = pb.length;
                let posP = -1;
                for (let i5 = 0; i5 < Math.min(pb.length - 3, 2048); i5++) {
                  if (pb[i5] === 0x25 && pb[i5+1] === 0x50 && pb[i5+2] === 0x44 && pb[i5+3] === 0x46) { posP = i5; break; }
                }
                passos.linkpdf_e_pdf = posP >= 0;
              } catch (e6) { passos.linkpdf_erro = e6.message; }
            }
            passos.campos_data = Object.keys(nf?.data || {}).slice(0, 25);
            // 20/08 PROVADO no debug: linkPDF = DANFE em PDF real; linkDanfe = pagina
          // HTML do visualizador. A ordem antiga nunca chegava no PDF.
          const link = nf?.data?.linkPDF || nf?.data?.linkDanfe;
            if (link) {
              const dR = await fetch(link);
              passos.download_status = dR.status;
              const db = new Uint8Array(await dR.arrayBuffer());
              passos.bytes = db.length; passos.magic_pdf = db[0] === 0x25;
              let posPdf = -1;
              for (let i3 = 0; i3 < Math.min(db.length - 3, 2048); i3++) {
                if (db[i3] === 0x25 && db[i3 + 1] === 0x50 && db[i3 + 2] === 0x44 && db[i3 + 3] === 0x46) { posPdf = i3; break; }
              }
              passos.pdf_comeca_no_byte = posPdf;
              passos.content_type = dR.headers.get('content-type');
              passos.primeiros_bytes = Buffer.from(db.slice(0, 160)).toString('utf8').replace(/[^\x20-\x7e]/g, '.');
              // 20/08: testar o GARIMPO — se veio HTML, procurar a URL do PDF
              // dentro e tentar baixar (o mesmo caminho do buscarDanfe real)
              if (db[0] === 0x3c) {
                const html2 = Buffer.from(db).toString('utf8');
                const m2 = html2.match(/https?:\/\/[^"'<>\s]+\.pdf[^"'<>\s]*/i);
                passos.garimpo_achou_url = m2 ? m2[0].slice(0, 120) : null;
                if (m2) {
                  try {
                    const d2R = await fetch(m2[0], { headers: { Accept: 'application/pdf' } });
                    passos.garimpo_status = d2R.status;
                    const db2 = new Uint8Array(await d2R.arrayBuffer());
                    passos.garimpo_bytes = db2.length;
                    let pos2 = -1;
                    for (let i4 = 0; i4 < Math.min(db2.length - 3, 2048); i4++) {
                      if (db2[i4] === 0x25 && db2[i4+1] === 0x50 && db2[i4+2] === 0x44 && db2[i4+3] === 0x46) { pos2 = i4; break; }
                    }
                    passos.garimpo_e_pdf = pos2 >= 0;
                  } catch (e3) { passos.garimpo_erro = e3.message; }
                }
              }
            }
          }
        } catch (e2) { passos.erro = e2.message; }
        return res.status(200).json({ debug: passos });
      }

      const podeSair = (p) => p.ml_ship_status !== 'cancelled' && p.situacao_bling !== 9 && (q.reimprimir === '1' || q.tipo === 'etiqueta_liberada'
        || (!p.etiqueta_impressa_em && (p.print_estado === 'PRONTO' || sitDe[String(p.nf_id)] === 5)));
      const candidatos = peds.filter(podeSair);
      // 19/08: LOTES. Com os pares (DANFE+etiqueta) 130 pedidos numa resposta
      // estouravam o tempo e o teto de 4,5MB do Vercel ("An error occurred").
      // O front chama em rodadas até `restantes` zerar.
      const comDanfeLote = String(q.tipo || 'nf_transporte') === 'nf_transporte';
      const tamLote = Math.max(1, Math.min(parseInt(q.lote, 10) || (comDanfeLote ? 15 : 60), 120));
      const restantes = Math.max(0, candidatos.length - tamLote);
      const candidatosLote = candidatos.slice(0, tamLote);
      // busca no Bling SÓ o que ainda não está guardado — e o token só das
      // contas que têm algo faltando (18/08: com tudo preparado, zero refresh)
      const faltando = candidatosLote.filter(p => !guardados[String(p.pedido_id)]);

      // 20/08 (arquitetura aprovada, item 2): pedidos do MERCADO LIVRE usam o
      // ZPL2 ORIGINAL da API do ML como fonte primária — formato nativo da
      // Zebra, zero transformação. O par vira DANFE(linkPDF) + ZPL, igual à
      // Shopee. A casada do Bling continua como FALLBACK de quem não vier.
      // Baixar aqui marca "printed" no painel do ML — ok: é o momento real da
      // impressão e etiqueta_impressa_em é gravada segundos depois.
      const doMlZpl = {};
      if (comDanfeLote) {
        const mlPorConta = {};
        // 20/08 v2 (foto do teste): pedido ML com casada em CACHE nunca tentava
        // o ZPL2 — e o corte cego da casada fatia na fronteira errada. Agora
        // TODO ML do lote tenta o ZPL2 original primeiro; o cache é fallback.
        for (const p of candidatosLote) {
          if (String(p.canal_geral || '') === 'Mercado Livre' && p.ml_logistic_type !== 'fulfillment' && p.numero_loja) {
            (mlPorConta[p.conta] = mlPorConta[p.conta] || []).push(p);
          }
        }
        for (const [conta2, lst] of Object.entries(mlPorConta)) {
          try {
            const r2 = await etiquetasDoMl(lst, conta2);
            Object.assign(doMlZpl, r2);
          } catch { /* fallback Bling cuida */ }
        }
      }
      const aindaFaltando = faltando.filter(p => !doMlZpl[String(p.pedido_id)]);
      for (const c of new Set(aindaFaltando.map(p => p.conta))) tk[c] = await refreshBlingToken(c).catch(() => null);
      const links = aindaFaltando.length ? await linksEtiqueta(aindaFaltando, tk, 'impressao') : {};

      // 18/08 (ordem dele): a térmica sai em PARES — DANFE do pedido e logo a
      // etiqueta dele. Só no NF + transporte (Flex/Meluni não têm nota e a
      // liberada é só etiqueta). A DANFE é nossa: baixar não mexe em
      // marketplace, então fica guardada em wms_documentos pra sair na hora.
      const comDanfe = comDanfeLote;
      const danfeGuardada = {};
      if (comDanfe) {
        const idsD = candidatosLote.map(p => p.pedido_id);
        for (let i = 0; i < idsD.length; i += 300) {
          const { data } = await supabase.from('wms_documentos')
            .select('pedido_id, conteudo, formato').eq('tipo', 'DANFE').is('erro', null)
            .in('pedido_id', idsD.slice(i, i + 300));
          (data || []).forEach(d => { if (d.conteudo) danfeGuardada[String(d.pedido_id)] = { conteudo: d.conteudo, formato: d.formato || 'PDF' }; });
        }
      }
      // 20/08 v2 (foto do Ailson: DANFE A4 espremida em 10x15 = letra de
      // formiga). A nota avulsa agora sai como DANFE SIMPLIFICADA gerada em
      // ZPL — nativa da Zebra, texto nítido e código de barras perfeito, sem
      // rasterizar A4. Os dados vêm do XML da NFe (emitente, protocolo, tudo).
      // Fallback: se o XML falhar, o PDF do linkPDF sai como antes.
      // Retorna { formato:'ZPL'|'PDF', conteudo } ou null.
      const xmlCampo = (xml, tag) => {
        const m = xml.match(new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + tag + '>'));
        return m ? m[1].trim() : '';
      };
      // 21/08 (achado da Sthefany): o painel entrega junto uma DANFE "mini"
      // (so chave/protocolo, sem produtos) que a equipe DESCARTA. Aplicado
      // SOMENTE no ZPL2 do MERCADO LIVRE (ordem dele 21/08: a Shopee ja sai
      // certa pelo App — nao mexer no que esta validado). A nossa DANFE rica
      // e gerada a parte e nunca passa por aqui.
      const cortarMiniDanfe = (zpl) => {
        if (!zpl || !/DANFE|Chave de acesso|Protocolo de Autoriza/i.test(zpl)) return zpl;
        const blocos2 = String(zpl).match(/\^XA[\s\S]*?\^XZ/g);
        if (!blocos2 || blocos2.length < 2) return zpl;   // bloco unico = etiqueta; nao mexe
        const uteis = blocos2.filter(b2 => !/DANFE|Chave de acesso|Protocolo de Autoriza/i.test(b2));
        return uteis.length ? uteis.join('\n') : zpl;    // nunca deixa o pedido sem etiqueta
      };
      const xmlItens = (xml) => {
        const itens = [];
        const re = /<det[^>]*>([\s\S]*?)<\/det>/g;
        let m2;
        while ((m2 = re.exec(xml)) && itens.length < 8) {
          const det = m2[1];
          const xp = xmlCampo(det, 'xProd');
          // 21/08 (pedido dele): REF primeiro, cor e tamanho — o xProd do
          // Bling traz "... (ref 02773) (H) Cor:PRETO;Tamanho:G2"
          const ref2 = (xp.match(/ref[.\s]*0*(\d{3,5})/i) || [])[1] || null;
          const cor2 = (xp.match(/Cor:\s*([^;<]+)/i) || [])[1]?.trim() || null;
          const tam2 = (xp.match(/Tamanho:\s*([^;<\s]+)/i) || [])[1]?.trim() || null;
          const descLimpa = xp.replace(/\(ref[^)]*\)/i, '').replace(/\(H\)/i, '').replace(/Cor:[^;<]+;?/i, '').replace(/Tamanho:[^;<\s]+/i, '').replace(/\s+-\s*$/, '').replace(/\s{2,}/g, ' ').trim();
          itens.push({
            desc: descLimpa || xp,
            ref: ref2, cor: cor2, tam: tam2,
            sku: xmlCampo(det, 'cProd'),
            qtd: Math.round(parseFloat(xmlCampo(det, 'qCom') || '1')) || 1,
          });
        }
        return itens;
      };
      const montarDanfeZpl = (info) => {
        const esc = (t) => String(t || '').replace(/[\^~]/g, ' ').slice(0, 46);
        const chaveFmt = (info.chave.match(/.{1,4}/g) || []).join(' ');
        const dt = info.emissao ? info.emissao.slice(8, 10) + '/' + info.emissao.slice(5, 7) + '/' + info.emissao.slice(0, 4) : '';
        const valor = info.valor ? Number(info.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '';
        return '^XA^CI28^PW812^LL1218^LH0,0'
          + '^FO30,30^A0N,34,34^FDDANFE SIMPLIFICADO - ETIQUETA^FS'
          + '^FO30,72^A0N,24,24^FDNF-e Num ' + esc(info.numero) + '  Serie ' + esc(info.serie) + '  Emissao ' + dt + '^FS'
          + '^FO30,106^GB752,2,2^FS'
          + '^FO30,124^A0N,22,22^FDEMITENTE^FS'
          + '^FO30,152^A0N,26,26^FD' + esc(info.emitNome) + '^FS'
          + '^FO30,184^A0N,24,24^FDCNPJ ' + esc(info.emitCnpj) + '^FS'
          + '^FO30,222^A0N,22,22^FDDESTINATARIO^FS'
          + '^FO30,250^A0N,26,26^FD' + esc(info.destNome) + '^FS'
          + (info.destDoc ? '^FO30,282^A0N,24,24^FDCPF/CNPJ ' + esc(info.destDoc) + '^FS' : '')
          + '^FO30,320^GB752,2,2^FS'
          + '^FO30,340^A0N,26,26^FDVALOR TOTAL  R$ ' + valor + '^FS'
          + (info.protocolo ? '^FO30,376^A0N,22,22^FDProtocolo de autorizacao ' + esc(info.protocolo) + '^FS' : '')
          + '^FO30,420^A0N,22,22^FDCHAVE DE ACESSO^FS'
          + '^FO30,450^BY2,2.5,150^BCN,150,N,N,N^FD' + info.chave + '^FS'
          + '^FO30,616^A0N,22,22^FD' + chaveFmt + '^FS'
          + '^FO30,652^A0N,20,20^FDConsulta pela chave em www.nfe.fazenda.gov.br^FS'
          + '^FO30,690^GB752,2,2^FS'
          + '^FO30,706^A0N,22,22^FDPRODUTOS^FS'
          + (info.itens || []).slice(0, 6).map((it, ix) => {
            // REF primeiro (negrito maior), depois cor · tamanho · qtd, e a
            // descricao curta embaixo — leitura de bancada em 1 segundo
            const y = 736 + ix * 58;
            const l1 = (it.ref ? 'REF ' + it.ref + '  ' : '') + (it.cor ? String(it.cor).toUpperCase() + '  ' : '') + (it.tam ? 'TAM ' + it.tam + '  ' : '') + it.qtd + ' pc';
            const l2 = String(it.desc || '').slice(0, 44) + (!it.ref && it.sku ? ' (' + String(it.sku).slice(0, 14) + ')' : '');
            return '^FO30,' + y + '^A0N,26,26^FD' + l1.replace(/[\^~]/g, ' ').slice(0, 46) + '^FS'
              + '^FO30,' + (y + 28) + '^A0N,20,20^FD' + l2.replace(/[\^~]/g, ' ') + '^FS';
          }).join('')
          + ((info.itens || []).length > 6 ? '^FO30,' + (736 + 6 * 58) + '^A0N,20,20^FD... e mais ' + (info.itens.length - 6) + ' item(ns)^FS' : '')
          // 22/08 (pedido dele): envio PROGRAMADO — a data de despacho na
          // ULTIMA linha, centralizada, um pouco maior que a descricao e em
          // negrito (ZPL nao tem bold: duas passadas com 1 dot de offset)
          + (info.agendadoEm ? (() => {
            const dAg = String(info.agendadoEm).slice(0, 10).split('-').reverse().join('/');
            const tAg = 'ENVIAR ' + dAg;
            return '^FO30,1150^FB752,1,0,C^A0N,28,28^FD' + tAg + '^FS'
                 + '^FO31,1151^FB752,1,0,C^A0N,28,28^FD' + tAg + '^FS';
          })() : '')
          + '^XZ';
      };
      const buscarDanfe = async (p) => {
        const cache = danfeGuardada[String(p.pedido_id)] || null;
        if (cache || !p.nf_id) return cache;
        const tkC = await pegarToken(p.conta);
        if (!tkC) return null;
        try {
          const hb2 = { Authorization: 'Bearer ' + tkC, Accept: 'application/json' };
          const nfR = await blingFetch(`https://api.bling.com.br/Api/v3/nfe/${p.nf_id}`, hb2);
          const nf = typeof nfR.json === 'function' ? await nfR.json().catch(() => ({})) : {};

          // 1º caminho: XML da NFe → DANFE simplificada em ZPL
          if (nf?.data?.xml) {
            try {
              const xr = await fetch(nf.data.xml);
              if (xr.ok) {
                const xml = await xr.text();
                const chave = (xml.match(/Id="NFe(\d{44})"/) || [])[1] || String(nf?.data?.chaveAcesso || '').replace(/\D/g, '');
                const emit = xmlCampo(xml, 'emit');
                const dest = xmlCampo(xml, 'dest');
                const prot = xmlCampo(xml, 'protNFe');
                if (chave && chave.length === 44) {
                  const zplDanfe = montarDanfeZpl({
                    chave,
                    numero: nf?.data?.numero || xmlCampo(xml, 'nNF'),
                    serie: nf?.data?.serie ?? xmlCampo(xml, 'serie'),
                    emissao: String(nf?.data?.dataEmissao || xmlCampo(xml, 'dhEmi') || ''),
                    emitNome: xmlCampo(emit, 'xNome'),
                    emitCnpj: xmlCampo(emit, 'CNPJ'),
                    destNome: xmlCampo(dest, 'xNome'),
                    destDoc: xmlCampo(dest, 'CPF') || xmlCampo(dest, 'CNPJ'),
                    valor: nf?.data?.valorNota ?? xmlCampo(xml, 'vNF'),
                    protocolo: xmlCampo(prot, 'nProt'),
                    itens: xmlItens(xml),
                    agendadoEm: p.ml_agendado_em || null,
                  });
                  await supabase.from('wms_documentos').upsert({
                    pedido_id: p.pedido_id, conta: p.conta, tipo: 'DANFE', formato: 'ZPL',
                    conteudo: zplDanfe, bytes: zplDanfe.length, hash: hashDoc(zplDanfe), origem: 'xml-nfe', erro: null,
                  }, { onConflict: 'pedido_id,tipo' });
                  return { formato: 'ZPL', conteudo: zplDanfe };
                }
              }
            } catch { /* cai pro PDF */ }
          }

          // 2º caminho (fallback): PDF do linkPDF, como antes
          const link = nf?.data?.linkPDF || nf?.data?.linkDanfe;
          if (!link) return null;
          const acharPdf = async (u) => {
            const r3 = await fetch(u, { headers: { Accept: 'application/pdf' } });
            if (!r3.ok) return null;
            return new Uint8Array(await r3.arrayBuffer());
          };
          let db = await acharPdf(link);
          if (!db) return null;
          if (db[0] === 0x3c) {
            const html = Buffer.from(db).toString('utf8');
            const m = html.match(/https?:\/\/[^"'<>\s]+\.pdf[^"'<>\s]*/i);
            db = m ? await acharPdf(m[0]) : null;
            if (!db) return null;
          }
          let iniPdf = -1;
          for (let i2 = 0; i2 < Math.min(db.length - 3, 2048); i2++) {
            if (db[i2] === 0x25 && db[i2 + 1] === 0x50 && db[i2 + 2] === 0x44 && db[i2 + 3] === 0x46) { iniPdf = i2; break; }
          }
          if (iniPdf < 0) return null;
          const d64 = Buffer.from(iniPdf ? db.slice(iniPdf) : db).toString('base64');
          await supabase.from('wms_documentos').upsert({
            pedido_id: p.pedido_id, conta: p.conta, tipo: 'DANFE', formato: 'PDF',
            conteudo: d64, bytes: d64.length, hash: hashDoc(d64), origem: 'bling', erro: null,
          }, { onConflict: 'pedido_id,tipo' });
          return { formato: 'PDF', conteudo: d64 };
        } catch { return null; }
        finally { await new Promise(r2 => setTimeout(r2, 340)); }
      };
      // 21/08 (teste dele: "5 prontas" e clique dizia nenhuma): o alvo
      // ignorava a fonte ML (ZPL2) e descartava em SILENCIO quem nao tinha
      // cache nem link do Bling — 6 prontos viravam zero sem explicacao.
      const alvo = [];
      const foraDoAlvo = [];
      const foraIds = [];
      for (const p of candidatosLote) {
        if (doMlZpl[String(p.pedido_id)] || guardados[String(p.pedido_id)] || links[String(p.pedido_id)]) alvo.push(p);
        else { foraDoAlvo.push(p.numero); foraIds.push(p.pedido_id); }
      }

      const blocos = []; const idsOk = []; const refsOk = []; const emPdf = []; const semDanfe = []; const semEtiqueta = [...foraDoAlvo]; let grupoAtual = '';
      for (const p of alvo.slice(0, 120)) {
        // baixa primeiro: só cria separador se a etiqueta for mesmo ZPL
        let zplDoPedido = null, ehPdf = false, pdf64 = null, zipDanfe64 = null;
        // fonte primária ML (ZPL2 original da API) — depois guardados, depois Bling
        const doMl = doMlZpl[String(p.pedido_id)];
        const jaTem = doMl ? null : guardados[String(p.pedido_id)];
        if (doMl) {
          if (doMl.formato === 'ZPL') zplDoPedido = cortarMiniDanfe(doMl.conteudo);
          else { ehPdf = true; pdf64 = doMl.conteudo; }
        }
        if (jaTem) {
          if (jaTem.formato === 'ZPL') zplDoPedido = jaTem.conteudo;
          else { ehPdf = true; pdf64 = jaTem.conteudo; }
        }
        try {
          if (jaTem || doMl) throw { pulaDownload: true };
          const r0 = await fetch(links[String(p.pedido_id)]);
          const b0 = new Uint8Array(await r0.arrayBuffer());
          if (b0[0] === 0x50 && b0[1] === 0x4b) {
            const z0 = unzipSync(b0);
            const nomeZ = Object.keys(z0).find(n => /\.txt$|zpl/i.test(n));
            const nomeP = Object.keys(z0).find(n => /\.pdf$/i.test(n));
            if (nomeZ) {
              zplDoPedido = Buffer.from(z0[nomeZ]).toString('utf8');
              // 19/08: o zip da casada pode trazer a DANFE em PDF junto do ZPL
              if (nomeP) zipDanfe64 = Buffer.from(z0[nomeP]).toString('base64');
            }
            else if (nomeP) { ehPdf = true; pdf64 = Buffer.from(z0[nomeP]).toString('base64'); }
          } else if (b0[0] === 0x25) { ehPdf = true; pdf64 = Buffer.from(b0).toString('base64'); }
          else if (String.fromCharCode(b0[0], b0[1]) === '^X') zplDoPedido = Buffer.from(b0).toString('utf8');
        } catch (e) { if (!e?.pulaDownload) { /* sem etiqueta */ } }
        if (!zplDoPedido && !ehPdf) continue;

        // 20/08 (P3/P8 da arquitetura dele): toda etiqueta baixada na impressão
        // fica GUARDADA — reimpressão sai do banco sem re-consultar o
        // marketplace (crítico pra Shein: puxar de novo mexe no status), e a
        // geometria de qualquer canal vira auditável pelo debug.
        if (!jaTem) {
          try {
            const conteudoDoc = ehPdf ? pdf64 : zplDoPedido;
            await supabase.from('wms_documentos').upsert({
              pedido_id: p.pedido_id, conta: p.conta, tipo: 'ETIQUETA',
              formato: ehPdf ? 'PDF' : 'ZPL', conteudo: conteudoDoc,
              bytes: conteudoDoc.length, hash: hashDoc(conteudoDoc),
              origem: doMl ? 'ml-zpl2' : 'impressao', erro: null,
            }, { onConflict: 'pedido_id,tipo' });
            if (zipDanfe64) {
              await supabase.from('wms_documentos').upsert({
                pedido_id: p.pedido_id, conta: p.conta, tipo: 'DANFE', formato: 'PDF',
                conteudo: zipDanfe64, bytes: zipDanfe64.length, hash: hashDoc(zipDanfe64),
                origem: 'impressao', erro: null,
              }, { onConflict: 'pedido_id,tipo' });
            }
          } catch { /* guardar é conveniência; a impressão segue */ }
        }

        const k = `${q.por_empresa === '1' ? p.conta + '·' : ''}${p.loc}·${p.ref}`;
        if (false && k !== grupoAtual) {   // sem separadora (ordem dele 18/08)
          grupoAtual = k;
          const qtd = alvo.filter(x => `${q.por_empresa === '1' ? x.conta + '·' : ''}${x.loc}·${x.ref}` === k).length;
          // etiqueta separadora 10x15 em ZPL (203dpi: 812x1218 pontos)
          blocos.push({ tipo: 'separador', ref: p.ref, loc: p.loc, empresa: p.conta, pedidos: qtd, zpl:
            `^XA^CI28^PW812^LL1218^LH0,0
${q.por_empresa === '1' ? `^FO40,120^A0N,110,110^FD${String(p.conta).toUpperCase()}^FS` : ''}
^FO40,260^A0N,170,170^FDLOC ${p.loc}^FS
^FO40,460^A0N,170,170^FDREF ${p.ref}^FS
^FO40,680^A0N,80,80^FD${qtd} etiqueta(s)^FS
^FO40,800^A0N,50,50^FD${String(p.itens?.[0]?.descLimpa || '').slice(0, 30).replace(/[\^~]/g, '')}^FS
^FO40,900^GB730,6,6^FS
^XZ` });
        }
        // PAR em cascata (19/08): a DANFE sai da MELHOR fonte disponível —
        // 1) casada DEITADA (ML): corta a página em duas 10x15 em pé;
        // 2) casada EM PÉ multi-página (Shein): já é o par, vai inteira;
        // 3) PDF que veio no zip junto do ZPL (Shopee casada);
        // 4) linkDanfe do Bling (último recurso — pode vir como HTML).
        let parFeito = false;
        if (ehPdf && comDanfe) {
          const norm = await normalizarCasada(pdf64);
          if (norm?.casada) {
            // documento casado normalizado: DANFE já embutida, tudo 10x15 em pé
            blocos.push({ tipo: 'etiqueta_pdf', pedido: p.numero, ref: p.ref, loc: p.loc, pdf: norm.pdf });
            emPdf.push(p.numero); parFeito = true;
          } else if (norm) {
            pdf64 = norm.pdf;   // 1 página: etiqueta simples normalizada; DANFE vem da cascata
          }
        }
        if (!parFeito) {
          // 20/08 (ordem dele): o PAR é ATÔMICO — DANFE e etiqueta saem juntas
          // ou o pedido não sai. Antes a DANFE era empurrada antes de saber se
          // a etiqueta existia; quando falhava, saía NOTA ÓRFÃ e a esteira
          // física embaralhava os pares.
          const temEtiqueta = ehPdf ? !!pdf64 : !!zplDoPedido;
          if (!temEtiqueta) { semEtiqueta.push(p.numero); continue; }
          if (comDanfe) {
            const dRes = zipDanfe64 ? { formato: 'PDF', conteudo: zipDanfe64 } : await buscarDanfe(p);
            if (dRes?.formato === 'ZPL') blocos.push({ tipo: 'danfe_zpl', pedido: p.numero, ref: p.ref, loc: p.loc, zpl: dRes.conteudo });
            else if (dRes?.conteudo) blocos.push({ tipo: 'danfe_pdf', pedido: p.numero, ref: p.ref, loc: p.loc, pdf: dRes.conteudo });
            else { semDanfe.push(p.numero); continue; }   // sem nota, etiqueta não sai sozinha
          }
          if (ehPdf) {
            // o QZ Tray imprime PDF direto na térmica (type pixel) — sem conversão
            blocos.push({ tipo: 'etiqueta_pdf', pedido: p.numero, ref: p.ref, loc: p.loc, pdf: pdf64 });
            emPdf.push(p.numero);
          } else {
            blocos.push({ tipo: 'etiqueta', pedido: p.numero, ref: p.ref, loc: p.loc, zpl: zplDoPedido });
          }
        }
        idsOk.push(p.pedido_id);
        refsOk.push(String(p.ref || ''));
        // 18/08: a pausa só faz sentido quando BAIXOU da rede — com o
        // documento já preparado eram 14s parados num lote de 120
        if (!jaTem) await new Promise(r2 => setTimeout(r2, 120));
      }
      // etiquetas que o canal entrega em PDF (Shein) não vão pra térmica em
      // ZPL — a tela orienta a usar o PDF nesses casos
      // FLEX: a etiqueta vem do Mercado Livre. Se nada foi montado aqui, manda
      // a tela pelo caminho do PDF, que já sabe buscar no ML (17/08).
      if (!idsOk.length && (q.tipo === 'flex' || candidatos.some(p => p.ml_logistic_type === 'self_service'))) {
        return res.status(200).json({ total: 0, blocos: [], ids: [], em_pdf: ['flex'], so_pdf: true });
      }
      if (q.job) {
        await supabase.from('wms_print_log').insert({
          job_id: parseInt(q.job, 10), evento: 'rodada',
          detalhe: { pares: idsOk.length, restantes, sem_danfe: semDanfe.length ? semDanfe : undefined, pedidos: idsOk },
        }).then?.(() => {}, () => {});
      }
      return res.status(200).json({ total: idsOk.length, blocos, ids: idsOk, refs: refsOk, em_pdf: emPdf, sem_danfe: semDanfe, sem_etiqueta: semEtiqueta, sem_etiqueta_ids: foraIds, restantes });
    }

    // ── marcar como impressas depois que a térmica confirmou
    if (q.marcar === '1' && q.ids) {
      const ids = String(q.ids).split(',').map(x => parseInt(x)).filter(Boolean);
      const lote = q.origem === 'fora' ? `FORA${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}` : `T${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}`;
      if (ids.length) {
        await supabase.from('wms_pedidos')
          .update({ etiqueta_impressa_em: new Date().toISOString(), etiqueta_lote: lote })
          .in('pedido_id', ids);
      }
      return res.status(200).json({ marcados: ids.length, lote });
    }

    if (q.pdf !== '1' && q.debug !== '1') return res.status(400).json({ erro: 'use ?previa=1, ?zpl=1 ou ?pdf=1' });
    if (!peds.length) return res.status(404).json({ erro: 'nenhum pedido nos filtros' });
    // 17/08: declarados no TOPO do bloco — antes ficavam no meio e o separador,
    // que roda no início de cada grupo, quebrava com "soDanfe before init"
    // (era esse o erro que abria a aba do PDF em branco).
    const soDanfe = q.tipo === 'nf_agendada';          // NF antes, etiqueta depois
    const soEtiqueta = q.tipo === 'etiqueta_liberada';  // no dia do envio

    // 18/08: a DANFE ainda é buscada uma a uma no Bling (~1,5s cada), então
    // um PDF de 60 pedidos estourava o tempo e a aba abria em branco. Teto de
    // 25 por rodada: sai rápido e a última folha avisa quantos faltam.
    const TETO_PDF = 25;
    // 18/08: filtrar ANTES de cortar. Cortando primeiro, as 25 primeiras eram
    // quase todas já impressas e o PDF voltava vazio ("nenhuma etiqueta
    // pronta") mesmo com 59 esperando.
    const hojePdf = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
    const elegivel = (p) => {
      if (q.reimprimir === '1') return true;
      if (q.tipo === 'nf_agendada') return !!p.nf_id && !p.nf_agendada_impressa_em;
      if (q.tipo === 'etiqueta_liberada') return true;
      if (p.etiqueta_impressa_em) return false;
      return p.print_estado === 'PRONTO' || p.nf_situacao === 5;
    };
    const candidatosPdf = peds.filter(elegivel);
    const totalNoFiltro = candidatosPdf.length;
    const lote = candidatosPdf.slice(0, TETO_PDF);

    // tokens por conta (Bling) e por marca (ML)
    const tokenBling = {}; const tokenMl = {};
    for (const c of new Set(lote.map(p => p.conta))) {
      tokenBling[c] = await refreshBlingToken(c).catch(() => null);
      tokenMl[c] = await getValidToken(BRAND[c]).catch(() => null);
    }

    // ETIQUETA PELO BLING — só quando é impressão de verdade (o debug não
    // pode disparar isso: mexeria no status da Shein sem imprimir nada)
    // 18/08: usa primeiro o que o preparo já guardou — antes o PDF buscava
    // DANFE e etiqueta de TODOS na hora e estourava o tempo com 59 pedidos
    // (a aba abria em branco no Mac). Só o que falta é buscado agora.
    const idsLotePdf = lote.map(p => p.pedido_id);
    const docsPdf = {};
    for (let i = 0; i < idsLotePdf.length; i += 300) {
      const { data } = await supabase.from('wms_documentos')
        .select('pedido_id, formato, conteudo').eq('tipo', 'ETIQUETA').is('erro', null)
        .in('pedido_id', idsLotePdf.slice(i, i + 300));
      (data || []).forEach(x => { if (x.conteudo) docsPdf[String(x.pedido_id)] = x; });
    }
    const faltamPdf = lote.filter(p => !docsPdf[String(p.pedido_id)]);
    const linkBlingDe = q.debug === '1' ? {} : await linksEtiqueta(faltamPdf, tokenBling, 'impressao');

    // shipment_ids do ML por pedido (RESERVA — só pros que o Bling não deu)
    const shipDe = {};
    for (const p of (q.debug === '1' ? [] : lote)) {
      if (linkBlingDe[String(p.pedido_id)]) continue; // já tem etiqueta do Bling
      if (p.canal_geral !== 'Mercado Livre' || !tokenMl[p.conta] || !p.numero_loja) continue;
      try {
        const r = await fetch(`https://api.mercadolibre.com/orders/${p.numero_loja}`, { headers: { Authorization: `Bearer ${tokenMl[p.conta]}` } });
        const j = await r.json();
        if (j?.shipping?.id) shipDe[p.pedido_id] = { sid: String(j.shipping.id), conta: p.conta };
      } catch (e) { if (q.debug === '1') console.log('ship err', e.message); }
      await new Promise(r2 => setTimeout(r2, 120));
    }
    const dbg = { pedidos: lote.length, por_logistica: {}, shipments: Object.keys(shipDe).length, etiquetas_baixadas: 0, erros_etiqueta: [] };
    for (const p of lote) dbg.por_logistica[p.ml_logistic_type || p.canal_geral] = (dbg.por_logistica[p.ml_logistic_type || p.canal_geral] || 0) + 1;
    // etiquetas ML em lote por conta (PDF multi-página, uma por shipment, na ordem pedida)
    const etiquetaPdfPorSid = {};
    for (const conta of Object.keys(tokenMl)) {
      const sids = Object.values(shipDe).filter(x => x.conta === conta).map(x => x.sid);
      for (let i = 0; i < sids.length; i += 40) {
        const fatia = sids.slice(i, i + 40);
        try {
          const r = await fetch(`https://api.mercadolibre.com/shipment_labels?shipment_ids=${fatia.join(',')}&response_type=pdf&label_type=label`, { headers: { Authorization: `Bearer ${tokenMl[conta]}` } });
          if (r.ok && String(r.headers.get('content-type')).includes('pdf')) {
            const bytes = new Uint8Array(await r.arrayBuffer());
            const doc = await PDFDocument.load(bytes);
            fatia.forEach((sid, idx) => { if (idx < doc.getPageCount()) etiquetaPdfPorSid[sid] = { doc, pagina: idx }; });
            dbg.etiquetas_baixadas += Math.min(fatia.length, doc.getPageCount());
          } else {
            const txt = await r.text().catch(() => '');
            dbg.erros_etiqueta.push(`${conta} http ${r.status}: ${txt.slice(0, 220)}`);
          }
        } catch (e) { dbg.erros_etiqueta.push(`${conta}: ${e.message}`); }
      }
    }

    dbg.etiquetas_bling = Object.keys(linkBlingDe).length;
    if (q.debug === '1') return res.status(200).json(dbg);

    // monta o PDF final: separadores 10x15 + DANFE + etiqueta na ordem
    // 12/08 (ordem dele): a folha de impressão é SÓ etiqueta — nada de
    // pendências ou avisos no papel. Pedido sem etiqueta pronta não entra
    // (evita separador órfão); o que falta aparece na TELA.
    // TRAVA (12/08, pedido dele): pedido com etiqueta JÁ IMPRESSA fica de fora
    // por padrão — só entra com ?reimprimir=1 (escolha consciente na tela)
    // 18/08: saíram daqui preencherNfIds + situacaoPorNfId — custavam até 90s
    // por PDF e alimentavam só uma função que ninguém chamava. O filtro
    // `elegivel` acima já decide com nf_situacao/print_estado do banco.
    const prontos = q.tipo === 'nf_agendada'
      ? lote.filter(p => p.nf_id)                    // basta ter NF: a etiqueta vem depois
      : lote.filter(p => docsPdf[String(p.pedido_id)]
        || linkBlingDe[String(p.pedido_id)]
        || (p.canal_geral === 'Mercado Livre' && tokenMl[p.conta]));
    if (!prontos.length) {
      return res.status(404).json({
        erro: 'Nenhuma etiqueta pronta nesses filtros.',
        detalhe: 'A etiqueta só existe depois de gerada no Bling (nasce junto com a NF). Pedidos ainda abertos não têm etiqueta.',
        pedidos_no_filtro: lote.length,
      });
    }

    const saida = await PDFDocument.create();
    const fonte = await saida.embedFont(StandardFonts.HelveticaBold);
    const fonteN = await saida.embedFont(StandardFonts.Helvetica);
    const P10x15 = [283.5, 425.2]; // 100x150mm em pt
    const semNf = []; const semEtiqueta = [];
    let grupoAtual = '';

    for (const p of prontos) {
      const k = `${q.por_empresa === '1' ? p.conta + '·' : ''}${p.loc}·${p.ref}`;
      // 18/08 (regra dele): na tela de etiquetas o papel sai SÓ com etiqueta —
      // nada de folha de localização, aviso ou carimbo. A separadora fica só
      // no modo NF + transporte, onde a equipe usa pra agrupar a separação.
      // 18/08 (ordem dele): NENHUMA impressão leva folha separadora — todas
      // saem só com as etiquetas. LOC e REF continuam aparecendo na TELA.
      const usaSeparadora = false;
      if (k !== grupoAtual && usaSeparadora) {
        grupoAtual = k;
        const pg = saida.addPage(P10x15);
        const qtdG = prontos.filter(x => `${q.por_empresa === '1' ? x.conta + '·' : ''}${x.loc}·${x.ref}` === k).length;
        // a linha da empresa só existe quando o lote é separado por empresa —
        // antes ela saía em branco e empurrava o LOC/REF pra baixo (17/08)
        if (q.por_empresa === '1' && p.conta) {
          pg.drawText(String(p.conta).toUpperCase(), { x: 24, y: 378, size: 26, font: fonte, color: rgb(0.45, 0.42, 0.36) });
        }
        pg.drawText(`LOC ${p.loc}`, { x: 24, y: 320, size: 48, font: fonte, color: rgb(0.17, 0.24, 0.31) });
        pg.drawText(`REF ${p.ref}`, { x: 24, y: 262, size: 48, font: fonte, color: rgb(0.29, 0.50, 0.65) });
        pg.drawText(`${qtdG} pedido(s)`, { x: 24, y: 220, size: 24, font: fonteN });
        pg.drawText(String((p.itens?.[0]?.descLimpa || '')).slice(0, 34), { x: 24, y: 185, size: 13, font: fonteN, color: rgb(0.35, 0.35, 0.35) });
      }


      // DANFE do pedido (Bling, se a conta tem escopo)
      let danfeOk = soEtiqueta;   // no modo etiqueta, DANFE não entra
      if (tokenBling[p.conta] && !soEtiqueta) {
        try {
          const hb = { Authorization: 'Bearer ' + tokenBling[p.conta], Accept: 'application/json' };
          // 18/08: o nf_id já vem do banco (cron nf-sync) — ir direto na nota
          // corta um GET por pedido; o detalhe do pedido fica só de reserva
          let nfId = p.nf_id;
          if (!nfId) {
            const detR = await blingFetch(`https://api.bling.com.br/Api/v3/pedidos/vendas/${p.pedido_id}`, hb);
            const det = detR.ok ? await detR.json() : {};
            nfId = det?.data?.notaFiscal?.id;
          }
          if (nfId) {
            const nfR = await blingFetch(`https://api.bling.com.br/Api/v3/nfe/${nfId}`, hb);
            const nf = nfR.ok ? await nfR.json() : {};
            // 20/08 PROVADO no debug: linkPDF = DANFE em PDF real; linkDanfe = pagina
          // HTML do visualizador. A ordem antiga nunca chegava no PDF.
          const link = nf?.data?.linkPDF || nf?.data?.linkDanfe;
            if (link) {
              const dR = await fetch(link);
              if (dR.ok) {
                const dBytes = new Uint8Array(await dR.arrayBuffer());
                try {
                  const dDoc = await PDFDocument.load(dBytes);
                  const pgs = await saida.copyPages(dDoc, dDoc.getPageIndices());
                  pgs.forEach((pg, idx) => {
                    saida.addPage(pg);
                    // 17/08 (ordem dele): a data de envio ESCRITA EM CIMA da
                    // nota — é o que a equipe fazia à mão. Só a data.
                    // 17/08 (ajuste dele): a data ENTRA NO CABEÇALHO da própria
                    // nota, discreta — sem tarja grande e sem folha a mais.
                    if (idx === 0 && soDanfe && p.ml_agendado_em) {
                      const { width, height } = pg.getSize();
                      const txt = 'ENVIAR ' + String(p.ml_agendado_em).slice(0, 10).split('-').reverse().join('/');
                      const tam = 12;
                      const larg = fonte.widthOfTextAtSize(txt, tam) + 12;
                      pg.drawRectangle({ x: width - larg - 12, y: height - 26, width: larg, height: 18, color: rgb(1, 1, 1) });
                      pg.drawText(txt, { x: width - larg - 6, y: height - 22, size: tam, font: fonte, color: rgb(0.6, 0.1, 0.1) });
                    }
                  });
                  danfeOk = true;
                } catch { /* link não era pdf */ }
              }
            }
          }
        } catch { /* sem danfe */ }
      }
      if (!danfeOk) semNf.push(p.numero);

      // etiqueta: Bling primeiro (qualquer marketplace), ML como reserva
      let etqOk = soDanfe;   // no modo NF agendada, etiqueta não entra
      const guardadoPdf = soDanfe ? null : docsPdf[String(p.pedido_id)];
      if (guardadoPdf && guardadoPdf.formato === 'PDF') {
        try {
          // 20/08: mesmo no modo PDF a casada sai NORMALIZADA (em pé, cortada,
          // sem a A4 redundante) — antes ia inteira e o navegador rotacionava
          const normG = await normalizarCasada(guardadoPdf.conteudo);
          const dDoc = await PDFDocument.load(Buffer.from(normG ? normG.pdf : guardadoPdf.conteudo, 'base64'));
          const pgs = await saida.copyPages(dDoc, dDoc.getPageIndices());
          pgs.forEach(pg => saida.addPage(pg));
          etqOk = true;
        } catch { /* cai pro link */ }
      }
      const linkB = (soDanfe || etqOk) ? null : linkBlingDe[String(p.pedido_id)];
      if (linkB) {
        try {
          const eR = await fetch(linkB);
          if (eR.ok) {
            const bruto64 = Buffer.from(new Uint8Array(await eR.arrayBuffer())).toString('base64');
            const normL = await normalizarCasada(bruto64);
            const eDoc = await PDFDocument.load(Buffer.from(normL ? normL.pdf : bruto64, 'base64'));
            const pgs = await saida.copyPages(eDoc, eDoc.getPageIndices());
            pgs.forEach(pg => saida.addPage(pg));
            etqOk = true;
          }
        } catch { /* cai no fallback */ }
      }
      const sh = shipDe[p.pedido_id];
      if (etqOk) { /* pronto */ }
      else if (sh && etiquetaPdfPorSid[sh.sid]) {
        const { doc, pagina } = etiquetaPdfPorSid[sh.sid];
        const [pg] = await saida.copyPages(doc, [pagina]);
        saida.addPage(pg);
      } else {
        semEtiqueta.push(p.numero);
      }
    }

    // REGISTRO: o que entrou neste PDF fica marcado como impresso (com lote),
    // pra ninguém imprimir duas vezes nem esquecer nenhum
    const lotePdf = `L${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}`;
    if (q.tipo === 'nf_agendada' && prontos.length) {
      await supabase.from('wms_pedidos')
        .update({ nf_agendada_impressa_em: new Date().toISOString() })
        .in('pedido_id', prontos.map(p => p.pedido_id));
    }
    const idsImpressos = [];
    for (const p of prontos) {
      if (linkBlingDe[String(p.pedido_id)] || shipDe[p.pedido_id]) idsImpressos.push(p.pedido_id);
    }
    if (idsImpressos.length) {
      await supabase.from('wms_pedidos')
        .update({ etiqueta_impressa_em: new Date().toISOString(), etiqueta_lote: lotePdf })
        .in('pedido_id', idsImpressos);
    }

    if (totalNoFiltro > TETO_PDF) {
      const aviso = saida.addPage([595.28, 841.89]);
      aviso.drawText('FALTAM ETIQUETAS NESTE FILTRO', { x: 60, y: 700, size: 19, font: fonte, color: rgb(0.55, 0.1, 0.1) });
      aviso.drawText(`Sairam ${lote.length} de ${totalNoFiltro} pedidos.`, { x: 60, y: 662, size: 14, font: fonte, color: rgb(0.2, 0.2, 0.2) });
      aviso.drawText('Clique em imprimir de novo para gerar as proximas.', { x: 60, y: 638, size: 12, font: fonte, color: rgb(0.4, 0.4, 0.4) });
    }
    const bytes = await saida.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=etiquetas-${new Date().toISOString().slice(0, 10)}.pdf`);
    return res.status(200).send(Buffer.from(bytes));
  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
}
