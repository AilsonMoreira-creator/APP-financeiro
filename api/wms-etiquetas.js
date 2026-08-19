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
  const COLS = 'conta, pedido_id, numero, numero_loja, canal_geral, ml_logistic_type, itens, status_wms, data_pedido, etiqueta_impressa_em, finalizado_em, nf_id, nf_situacao, nf_checado_em, ml_agendado_em, ml_ship_status, ml_ship_substatus, nf_agendada_impressa_em, print_estado, print_regra, print_nf, print_etiqueta, print_motivo';

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

  const [{ data: comNf }, { data: semNf }, { data: finSemNf }] = await Promise.all([q1, q2, q3]);
  const peds = [...(comNf || []), ...(semNf || []), ...(finSemNf || [])];

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
    const etiquetaLiberada = agendadoChegou
      && p.ml_ship_status === 'ready_to_ship'
      && p.ml_ship_substatus === 'ready_to_print'
      && !p.etiqueta_impressa_em && p.status_wms !== 'finalizado';
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
      let sel = supabase.from('wms_pedidos')
        .select('conta, canal_geral, ml_logistic_type, print_regra, print_estado, ml_agendado_em, ml_ship_status, ml_ship_substatus, nf_agendada_impressa_em, nf_situacao, etiqueta_impressa_em, status_wms')
        .neq('status_wms', 'cancelado')
        .gte('criado_em', new Date(Date.now() - 5 * 86400000).toISOString())
        .limit(3000);
      if (contasFiltro !== 'todas') sel = sel.in('conta', contasFiltro.split(','));
      const { data } = await sel;
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
        if (agendadoChegou
          && p.ml_ship_status === 'ready_to_ship'
          && p.ml_ship_substatus === 'ready_to_print'
          && !p.etiqueta_impressa_em
          && p.status_wms !== 'finalizado') c.etiqueta_liberada++;
        if (p.print_estado !== 'PRONTO') continue;
        if (p.print_regra === 'MELI_FLEX') c.flex++;
        else if (p.print_regra === 'MELUNI') c.meluni++;
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
        } else if (sit === 6 || p.etiqueta_impressa_em || p.print_estado === 'IMPRESSO') {
          if (impressaHoje || sit === 6) { grupos[k].impressas++; jaImpressas++; }
          else grupos[k].pedidos--;          // impressa em outro dia: fora da conta
        } else if (sit === 5 || p.print_estado === 'PRONTO') { grupos[k].prontas++; prontas++; }
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
        grupos: Object.values(grupos).map(g => ({ ...g, contas: [...g.contas], canais: [...g.canais] })),
        nota: peds.length > 60 ? 'Acima de 60 pedidos a geração demora alguns minutos — considere gerar por REF.' : null,
      });
    }

    // ── MODO ZPL (13/08): a etiqueta do Bling vem em ZPL dentro de um ZIP —
    // é o formato NATIVO da térmica. Com o QZ Tray na máquina da expedição,
    // mandamos o ZPL direto: mais rápido e mais nítido que PDF.
    if (q.zpl === '1' && q.tipo === 'nf_agendada') {
      return res.status(200).json({ total: 0, blocos: [], ids: [], em_pdf: ['nota'], so_pdf: true });
    }
    if (q.zpl === '1') {
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

      const podeSair = (p) => q.reimprimir === '1' || q.tipo === 'etiqueta_liberada'
        || (!p.etiqueta_impressa_em && (p.print_estado === 'PRONTO' || sitDe[String(p.nf_id)] === 5));
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
      for (const c of new Set(faltando.map(p => p.conta))) tk[c] = await refreshBlingToken(c).catch(() => null);
      const links = faltando.length ? await linksEtiqueta(faltando, tk, 'impressao') : {};

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
            .select('pedido_id, conteudo').eq('tipo', 'DANFE').is('erro', null)
            .in('pedido_id', idsD.slice(i, i + 300));
          (data || []).forEach(d => { if (d.conteudo) danfeGuardada[String(d.pedido_id)] = d.conteudo; });
        }
      }
      const buscarDanfe = async (p) => {
        let d64 = danfeGuardada[String(p.pedido_id)] || null;
        if (d64 || !p.nf_id) return d64;
        const tkC = await pegarToken(p.conta);
        if (!tkC) return null;
        try {
          const hb2 = { Authorization: 'Bearer ' + tkC, Accept: 'application/json' };
          const nfR = await blingFetch(`https://api.bling.com.br/Api/v3/nfe/${p.nf_id}`, hb2);
          const nf = typeof nfR.json === 'function' ? await nfR.json().catch(() => ({})) : {};
          const link = nf?.data?.linkDanfe || nf?.data?.linkPDF;
          if (!link) return null;
          const dR = await fetch(link);
          if (!dR.ok) return null;
          const db = new Uint8Array(await dR.arrayBuffer());
          if (db[0] !== 0x25) return null;   // não veio PDF
          d64 = Buffer.from(db).toString('base64');
          await supabase.from('wms_documentos').upsert({
            pedido_id: p.pedido_id, conta: p.conta, tipo: 'DANFE', formato: 'PDF',
            conteudo: d64, bytes: d64.length, hash: hashDoc(d64), origem: 'bling', erro: null,
          }, { onConflict: 'pedido_id,tipo' });
          return d64;
        } catch { return null; }
        finally { await new Promise(r2 => setTimeout(r2, 340)); }
      };
      const alvo = candidatosLote.filter(p => guardados[String(p.pedido_id)] || links[String(p.pedido_id)]);

      const blocos = []; const idsOk = []; const emPdf = []; const semDanfe = []; let grupoAtual = '';
      for (const p of alvo.slice(0, 120)) {
        // baixa primeiro: só cria separador se a etiqueta for mesmo ZPL
        let zplDoPedido = null, ehPdf = false, pdf64 = null;
        const jaTem = guardados[String(p.pedido_id)];
        if (jaTem) {
          if (jaTem.formato === 'ZPL') zplDoPedido = jaTem.conteudo;
          else { ehPdf = true; pdf64 = jaTem.conteudo; }
        }
        try {
          if (jaTem) throw { pulaDownload: true };
          const r0 = await fetch(links[String(p.pedido_id)]);
          const b0 = new Uint8Array(await r0.arrayBuffer());
          if (b0[0] === 0x50 && b0[1] === 0x4b) {
            const z0 = unzipSync(b0);
            const nomeZ = Object.keys(z0).find(n => /\.txt$|zpl/i.test(n));
            const nomeP = Object.keys(z0).find(n => /\.pdf$/i.test(n));
            if (nomeZ) zplDoPedido = Buffer.from(z0[nomeZ]).toString('utf8');
            else if (nomeP) { ehPdf = true; pdf64 = Buffer.from(z0[nomeP]).toString('base64'); }
          } else if (b0[0] === 0x25) { ehPdf = true; pdf64 = Buffer.from(b0).toString('base64'); }
          else if (String.fromCharCode(b0[0], b0[1]) === '^X') zplDoPedido = Buffer.from(b0).toString('utf8');
        } catch (e) { if (!e?.pulaDownload) { /* sem etiqueta */ } }
        if (!zplDoPedido && !ehPdf) continue;

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
        // PAR: a DANFE entra na frente da etiqueta do mesmo pedido
        if (comDanfe) {
          const d64 = await buscarDanfe(p);
          if (d64) blocos.push({ tipo: 'danfe_pdf', pedido: p.numero, ref: p.ref, loc: p.loc, pdf: d64 });
          else semDanfe.push(p.numero);
        }
        if (ehPdf) {
          // o QZ Tray imprime PDF direto na térmica (type pixel) — sem conversão
          blocos.push({ tipo: 'etiqueta_pdf', pedido: p.numero, ref: p.ref, loc: p.loc, pdf: pdf64 });
          emPdf.push(p.numero);
        } else {
          blocos.push({ tipo: 'etiqueta', pedido: p.numero, ref: p.ref, loc: p.loc, zpl: zplDoPedido });
        }
        idsOk.push(p.pedido_id);
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
      return res.status(200).json({ total: idsOk.length, blocos, ids: idsOk, em_pdf: emPdf, sem_danfe: semDanfe, restantes });
    }

    // ── marcar como impressas depois que a térmica confirmou
    if (q.marcar === '1' && q.ids) {
      const ids = String(q.ids).split(',').map(x => parseInt(x)).filter(Boolean);
      const lote = `T${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}`;
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
            const link = nf?.data?.linkDanfe || nf?.data?.linkPDF;
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
          const dDoc = await PDFDocument.load(Buffer.from(guardadoPdf.conteudo, 'base64'));
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
            const eDoc = await PDFDocument.load(new Uint8Array(await eR.arrayBuffer()));
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
