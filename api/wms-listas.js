/**
 * wms-listas.js — Picking WMS: dashboard, pedidos e ações de lista
 * GET  ?acao=dashboard                      → contadores por conta + prazos
 * GET  ?acao=pedidos&status=aberto[&conta=][&loja=] → pedidos com itens
 * POST { acao:'imprimir', pedido_ids:[], criado_por, filtros } → cria lista,
 *      marca em_separacao
 * POST { acao:'voltar', pedido_ids:[] }     → volta pra aberto
 * POST { acao:'finalizar', pedido_ids:[] }  → marca finalizado (fase 2: bipagem
 *      muda situação no Bling pra Verificado)
 */
import { supabase } from './_bling-helpers.js';

// Config do módulo (amicia_data user_id='wms-config')
export const WMS_CONFIG_DEFAULT = {
  situacoes_aberto: ['em aberto', 'em andamento'],
  situacoes_finalizado: ['atendido', 'verificado'],
  canais: [], // [{canal:'Mercado Livre', corte:'12:00', envio:'14:00', alerta_min:30}]
  // Avisos (Ailson 06/08/2026)
  avisos_fluxo_ativo: true,       // mensagens de fluxo 10:30 / 11:30 / 13:00
  aviso_prod_ativo: true,         // notificacao de produtividade das 13:30
  fluxo_ref_manual: {},           // { '10:30': n, ... } valor manual (guardado sempre)
  fluxo_ref_modo: {},             // { '10:30': 'auto'|'manual' } qual usar
  prod_ref_manual: null,          // pedidos/hora manual (guardado sempre)
  prod_ref_modo: 'auto',          // 'auto' | 'manual'
  duracoes: {                     // minutos de exibicao
    m1030: 10, m1130_normal: 10, m1130_atencao: 30,
    m1300_normal: 10, m1300_atencao: 15, m1300_vermelho_ate: '14:30', prod: 40,
  },
};
// Corte UNICO pra dividir a fila entre "ate o corte" e "depois do corte"
// (Ailson 07/08/2026). A config tem corte POR CANAL, mas ele so serve pros
// avisos de prazo; pra separacao vale um horario so.
export const CORTE_LISTA = '12:00';
// 28/08 (pedido dele): o horario de corte virou campo na tela de Config —
// muda ali e a TV/lista acompanham na hora. A constante acima e so o padrao
// de quando ainda nao foi configurado.
export function corteHhmm(cfg) {
  const v = String(cfg?.corte_lista || '').trim();
  return /^\d{2}:\d{2}$/.test(v) ? v : CORTE_LISTA;
}
// normalizacao local (o wms-sync ja importa daqui; nao da pra importar de la
// sem criar ciclo)
const normSitLocal = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
// Instante do corte de HOJE em BRT (ISO). Pedido com criado_em >= isso e
// pos-corte. criado_em = quando o sync viu o pedido pela 1a vez (precisao de
// 15 min de manha / 30 min de tarde, que e o intervalo do cron).
export function corteDeHoje(hhmm) {
  const hojeBrt = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
  const h = /^\d{2}:\d{2}$/.test(String(hhmm || '')) ? hhmm : CORTE_LISTA;
  return new Date(`${hojeBrt}T${h}:00-03:00`).toISOString();
}

export async function lerWmsConfig() {
  try {
    const { data } = await supabase.from('amicia_data').select('payload').eq('user_id', 'wms-config').maybeSingle();
    const p = data?.payload || {};
    return {
      situacoes_aberto: Array.isArray(p.situacoes_aberto) && p.situacoes_aberto.length ? p.situacoes_aberto : WMS_CONFIG_DEFAULT.situacoes_aberto,
      situacoes_finalizado: Array.isArray(p.situacoes_finalizado) && p.situacoes_finalizado.length ? p.situacoes_finalizado : WMS_CONFIG_DEFAULT.situacoes_finalizado,
      canais: Array.isArray(p.canais) ? p.canais : [],
      avisos_fluxo_ativo: p.avisos_fluxo_ativo !== false,
      aviso_prod_ativo: p.aviso_prod_ativo !== false,
      fluxo_ref_manual: (p.fluxo_ref_manual && typeof p.fluxo_ref_manual === 'object') ? p.fluxo_ref_manual : {},
      fluxo_ref_modo: (p.fluxo_ref_modo && typeof p.fluxo_ref_modo === 'object') ? p.fluxo_ref_modo : {},
      prod_ref_manual: p.prod_ref_manual != null && p.prod_ref_manual !== '' ? Number(p.prod_ref_manual) : null,
      prod_ref_modo: p.prod_ref_modo === 'manual' ? 'manual' : 'auto',
      duracoes: { ...WMS_CONFIG_DEFAULT.duracoes, ...(p.duracoes || {}) },
      corte_lista: /^\d{2}:\d{2}$/.test(String(p.corte_lista || '')) ? p.corte_lista : CORTE_LISTA,
    };
  } catch { return { ...WMS_CONFIG_DEFAULT }; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const acao = String(req.query?.acao || 'dashboard');

      if (acao === 'dashboard') {
        const cfgDash = await lerWmsConfig();
        const corteHoje = corteDeHoje(corteHhmm(cfgDash));
        const { data: rows, error } = await supabase.from('wms_pedidos')
          .select('conta, status_wms, qtd_pecas, data_pedido, canal_geral, impresso_em, finalizado_em, criado_em, situacao_nome, servico_frete, ml_logistic_type, canal_detalhe')
          .neq('status_wms', 'cancelado');
        if (error) throw error;
        // data de HOJE em BRT — com toISOString() puro o "Finalizados Hoje"
        // zerava as 21h (virada do dia em UTC). Ailson 07/08/2026.
        const hoje = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
        // 21/08 (ordem dele): pedido ABERTO com mais de 3 dias sai do contador
        // do dia — e caso antigo/orfao (cancelado na plataforma, esquecido),
        // nao fila de separacao. Continua visivel no Detalhar Pedidos.
        const limiteVelho = new Date(Date.now() - 3 * 3600000 - 3 * 86400000).toISOString().slice(0, 10);
        const corteMs = new Date(corteHoje).getTime();
        // 28/08 (regra dele): o Flex tem corte PROPRIO e FIXO às 12:30 — não
        // acompanha o horário configurável da lista. Flex que entra depois
        // disso é fila de amanhã.
        const corteFlexMs = new Date(corteDeHoje('12:30')).getTime();
        const porConta = {};
        const porCanal = {};
        const tot = { abertos: 0, pra_amanha: 0, em_separacao: 0, em_separacao_nf: 0, em_separacao_flex: 0, em_separacao_meluni: 0, em_separacao_com_nf_prevista: 0, finalizados_hoje: 0, pecas_abertas: 0, aguardando: 0, flex_abertos: 0 };
        // NF gerada = a situacao no Bling ja saiu de "em aberto" (hoje vira
        // atendido; no fluxo definitivo vira em andamento). Ailson 07/08/2026.
        const temNf = (nome) => { const n = normSitLocal(nome); return !!n && !n.includes('em aberto') && !n.includes('aberto'); };
        // Pedidos que NAO geram NF (Ailson 07/08/2026):
        //  - Meluni: entra no Bling Lumia com canal "Outros"
        //  - Mercado Livre Flex: logistic_type = self_service, vindo da API do
        //    ML (api/wms-ml-flex.js) — o Bling nao marca Flex em lugar nenhum.
        //    servico_frete fica de reserva caso o Bling passe a trazer.
        const ehMeluni = (r2) => r2.conta === 'lumia' && normSitLocal(r2.canal_geral) === 'outros';
        const ehFlex = (r2) => r2.ml_logistic_type === 'self_service' || normSitLocal(r2.servico_frete).includes('flex');
        // Full: sai do galpao do ML, a equipe nao encosta. Entra no Bling ja
        // como atendido, entao nunca aparece no funil — mas conta venda.
        const ehFull = (r2) => r2.ml_logistic_type === 'fulfillment' || normSitLocal(r2.canal_detalhe) === 'ml full';
        // Vendas do dia (regra do Ailson 09/08): pedido de LOJA conta no dia em
        // que foi FINALIZADO (feito seg 15:00, finalizado ter 11:30 = terca);
        // pedido FULL conta no dia em que ENTROU (00:01 -> 23:59), porque a
        // equipe nao encosta nele. total = loja finalizados hoje + full de hoje.
        const vendasDia = { total: 0, loja_finalizados: 0, full: 0 };
        for (const r of (rows || [])) {
          if (ehFull(r)) {
            if (r.data_pedido === hoje) { vendasDia.full++; vendasDia.total++; }
          } else if (r.status_wms === 'finalizado' && r.finalizado_em
              && new Date(new Date(r.finalizado_em).getTime() - 3 * 3600000).toISOString().slice(0, 10) === hoje) {
            vendasDia.loja_finalizados++; vendasDia.total++;
          }
          const c = porConta[r.conta] || (porConta[r.conta] = { abertos: 0, pra_amanha: 0, em_separacao: 0, em_separacao_nf: 0, em_separacao_flex: 0, em_separacao_meluni: 0, em_separacao_com_nf_prevista: 0, finalizados_hoje: 0, pecas_abertas: 0, aguardando: 0 });
          const k = porCanal[r.canal_geral || 'Outros'] || (porCanal[r.canal_geral || 'Outros'] = { pendentes: 0, finalizados_hoje: 0 });
          if (r.status_wms === 'pendente') { c.aguardando++; tot.aguardando++; k.pendentes++; }
          else if (r.status_wms === 'aberto') {
            // FLEX EM ABERTO (28/08): régua própria — corte fixo 12:30. O que
            // entrou depois já é de amanhã e não entra na conta de hoje.
            if (ehFlex(r) && (r.data_pedido || hoje) >= limiteVelho
              && !(r.criado_em && new Date(r.criado_em).getTime() >= corteFlexMs)) tot.flex_abertos++;
            // entrou depois do corte -> fila de AMANHA (vira aberto sozinho na
            // virada do dia, quando o corte de "hoje" passa a ser o de amanha).
            // Ailson 09/08: pos-corte NAO entra nos avisos amarelos de prazo
            // (k.pendentes) — o aviso e sobre a onda de hoje, ate o corte.
            if ((r.data_pedido || hoje) < limiteVelho) { /* velho demais: fora do contador */ }
            else if (r.criado_em && new Date(r.criado_em).getTime() >= corteMs) { c.pra_amanha++; tot.pra_amanha++; }
            else { k.pendentes++; c.abertos++; tot.abertos++; c.pecas_abertas += r.qtd_pecas || 0; tot.pecas_abertas += r.qtd_pecas || 0; }
          }
          else if (r.status_wms === 'em_separacao') {
            c.em_separacao++; tot.em_separacao++; k.pendentes++;
            const flex = ehFlex(r), meluni = ehMeluni(r);
            if (flex) { c.em_separacao_flex++; tot.em_separacao_flex++; }
            if (meluni) { c.em_separacao_meluni++; tot.em_separacao_meluni++; }
            if (!flex && !meluni) {
              c.em_separacao_com_nf_prevista++; tot.em_separacao_com_nf_prevista++;
              if (temNf(r.situacao_nome)) { c.em_separacao_nf++; tot.em_separacao_nf++; }
            }
          }
          // Full NAO conta no funil de "Finalizados Hoje" — a equipe nao encosta
          // nele (Ailson 09/08: "domingo nao existe pedido finalizado na loja").
          // O card mede trabalho da equipe: bipado + etiqueta.
          else if (r.status_wms === 'finalizado' && !ehFull(r) && r.finalizado_em && new Date(new Date(r.finalizado_em).getTime() - 3 * 3600000).toISOString().slice(0, 10) === hoje) { c.finalizados_hoje++; tot.finalizados_hoje++; k.finalizados_hoje++; }
        }
        const { data: ultSync } = await supabase.from('wms_pedidos')
          .select('visto_em').order('visto_em', { ascending: false }).limit(1);
        const config = cfgDash;

        // ENVIOS PROGRAMADOS do Mercado Livre (17/08, pra TV): pedido que só
        // libera a etiqueta num dia futuro — a equipe imprime a NF antes.
        const hojeAg = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
        const { count: agendadosMl } = await supabase.from('wms_pedidos')
          .select('pedido_id', { count: 'exact', head: true })
          .neq('status_wms', 'cancelado')
          .gte('ml_agendado_em', hojeAg);

        return res.status(200).json({ ok: true, total: tot, por_conta: porConta, por_canal: porCanal, vendas_dia: vendasDia, config, corte_lista: corteHhmm(cfgDash), corte_em: corteHoje, agendados_ml: agendadosMl || 0, ultimo_sync: ultSync?.[0]?.visto_em || null });
      }

      if (acao === 'config') {
        const config = await lerWmsConfig();
        return res.status(200).json({ ok: true, config });
      }

      if (acao === 'historico') {
        // Calendario do mes (Ailson 10/08/2026): por dia, total finalizado =
        // EXPEDICAO (pedido de loja, por finalizado_em BRT — mesma regra do
        // "Vendas do dia") + FULL (pelo dia em que o pedido ENTROU).
        const mes = String(req.query?.mes || '').match(/^\d{4}-\d{2}$/)
          ? String(req.query.mes)
          : new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 7);
        const ini = `${mes}-01`;
        const fimMes = new Date(Date.UTC(+mes.slice(0, 4), +mes.slice(5, 7), 1)).toISOString().slice(0, 10);
        const { data: rows, error } = await supabase.from('wms_pedidos')
          .select('status_wms, data_pedido, finalizado_em, ml_logistic_type, canal_detalhe, servico_frete, canal_geral, conta')
          .neq('status_wms', 'cancelado')
          .or(`and(data_pedido.gte.${ini},data_pedido.lt.${fimMes}),and(finalizado_em.gte.${ini}T00:00:00-03:00,finalizado_em.lt.${fimMes}T00:00:00-03:00)`);
        if (error) throw error;
        const full = (r2) => r2.ml_logistic_type === 'fulfillment' || normSitLocal(r2.canal_detalhe) === 'ml full';
        const dias = {};
        const cel = (d) => dias[d] || (dias[d] = { expedicao: 0, full: 0, total: 0 });
        for (const r of (rows || [])) {
          if (full(r)) {
            if (r.data_pedido && r.data_pedido >= ini && r.data_pedido < fimMes) {
              const c = cel(r.data_pedido); c.full++; c.total++;
            }
          } else if (r.status_wms === 'finalizado' && r.finalizado_em) {
            const d = new Date(new Date(r.finalizado_em).getTime() - 3 * 3600000).toISOString().slice(0, 10);
            if (d >= ini && d < fimMes) { const c = cel(d); c.expedicao++; c.total++; }
          }
        }
        return res.status(200).json({ ok: true, mes, dias });
      }

      if (acao === 'medias') {
        // Dados que temos hoje pra formar as médias (tela de config).
        const brt = new Date(Date.now() - 3 * 3600000);
        const hojeD = brt.toISOString().slice(0, 10);
        const MARCOS = { '10:30': 630, '11:30': 690, '13:00': 780 };
        const hhmm2 = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
        const dias = [];
        for (let k = 7; k <= 70 && dias.length < 2; k += 7) {
          const d = new Date(brt.getTime() - k * 86400000).toISOString().slice(0, 10);
          const { count } = await supabase.from('wms_pedidos').select('id', { count: 'exact', head: true })
            .gte('criado_em', `${d}T00:00:00-03:00`).lt('criado_em', `${d}T23:59:59-03:00`);
          if ((count || 0) > 0) dias.push(d);
        }
        const marcos = {};
        for (const [nome, min] of Object.entries(MARCOS)) {
          const vals = [];
          for (const d of dias) {
            const { count } = await supabase.from('wms_pedidos').select('id', { count: 'exact', head: true })
              .not('finalizado_em', 'is', null)
              .gte('finalizado_em', `${d}T00:00:00-03:00`)
              .lt('finalizado_em', new Date(`${d}T${hhmm2(min)}:00-03:00`).toISOString());
            vals.push(count || 0);
          }
          marcos[nome] = { dias_usados: dias, valores: vals, media: vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null };
        }
        const { data: hist } = await supabase.from('wms_produtividade')
          .select('data, pedidos_por_hora').lt('data', hojeD).order('data', { ascending: false }).limit(14);
        const validos = (hist || []).filter(h => h.pedidos_por_hora > 0);
        const prodMedia = validos.length
          ? +(validos.reduce((s, h) => s + Number(h.pedidos_por_hora), 0) / validos.length).toFixed(1) : null;
        return res.status(200).json({ ok: true, dia_semana: brt.getUTCDay(), marcos, produtividade: { media: prodMedia, dias: validos.length } });
      }

      if (acao === 'andamento') {
        // AVISOS PARCIAIS (Ailson 06/08/2026). Marcos 10:30, 11:30 e 13:00.
        // Corte 12:00, limite de envio 14:00.
        //  10:30 -> so volume vs media das 2 ultimas ocorrencias do MESMO dia
        //           da semana no mesmo horario (sabado so compara com sabado).
        //  11:30/13:00 -> projecao: ritmo de hoje x (abertos + em separacao +
        //           previsao de entrada ate as 12:00).
        // Janelas de exibicao: 10:30 = 10min | 11:30 = 10min normal / 30min
        // atencao | 13:00 = 10min normal / 15min atencao / ate 14:30 vermelho.
        const cfgA = await lerWmsConfig();
        if (!cfgA.avisos_fluxo_ativo) return res.status(200).json({ ok: true, aviso: null, desativado: true });
        const MARCOS = { '10:30': 630, '11:30': 690, '13:00': 780 };
        const brtAgora = new Date(Date.now() - 3 * 3600000);
        const hoje = brtAgora.toISOString().slice(0, 10);
        const minAgora = brtAgora.getUTCHours() * 60 + brtAgora.getUTCMinutes();
        const diaSemana = brtAgora.getUTCDay();
        const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(Math.round(min % 60)).padStart(2, '0')}`;

        // finalizados de um dia ate um minuto do dia
        const finalizadosAte = async (dia, min) => {
          const lim = new Date(`${dia}T${hhmm(min)}:00-03:00`).toISOString();
          const { count } = await supabase.from('wms_pedidos')
            .select('id', { count: 'exact', head: true })
            .not('finalizado_em', 'is', null)
            .gte('finalizado_em', `${dia}T00:00:00-03:00`).lt('finalizado_em', lim);
          return count || 0;
        };
        // pedidos que ENTRARAM (apareceram no sync) entre dois minutos do dia
        const entradosEntre = async (dia, minA, minB) => {
          const { count } = await supabase.from('wms_pedidos')
            .select('id', { count: 'exact', head: true })
            .gte('criado_em', new Date(`${dia}T${hhmm(minA)}:00-03:00`).toISOString())
            .lt('criado_em', new Date(`${dia}T${hhmm(minB)}:00-03:00`).toISOString());
          return count || 0;
        };
        // ultimas N ocorrencias do mesmo dia da semana (antes de hoje)
        const diasMesmoDiaSemana = async (n) => {
          const out = [];
          for (let k = 7; k <= 70 && out.length < n; k += 7) {
            const d = new Date(brtAgora.getTime() - k * 86400000).toISOString().slice(0, 10);
            const { count } = await supabase.from('wms_pedidos')
              .select('id', { count: 'exact', head: true })
              .gte('criado_em', `${d}T00:00:00-03:00`).lt('criado_em', `${d}T23:59:59-03:00`);
            if ((count || 0) > 0) out.push(d);
          }
          return out;
        };

        // marco ativo + janela de exibicao (a janela depende da situacao,
        // entao calculamos a situacao primeiro pro marco mais recente passado)
        let marcoAtivo = null;
        for (const [nome, min] of Object.entries(MARCOS)) {
          if (minAgora >= min && minAgora <= min + 90) marcoAtivo = { nome, min };
        }
        if (!marcoAtivo) return res.status(200).json({ ok: true, aviso: null });

        const { data: rows } = await supabase.from('wms_pedidos')
          .select('status_wms, finalizado_em, criado_em')
          .neq('status_wms', 'cancelado')
          .gte('criado_em', `${hoje}T00:00:00-03:00`);
        const lista = rows || [];
        const abertos = lista.filter(r => r.status_wms === 'aberto').length;
        const emSep = lista.filter(r => r.status_wms === 'em_separacao').length;
        const finalHoje = await finalizadosAte(hoje, minAgora);

        const refs = await diasMesmoDiaSemana(2);
        let mediaRef = null;
        if (refs.length) {
          const vals = [];
          for (const d of refs) vals.push(await finalizadosAte(d, marcoAtivo.min));
          mediaRef = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
        }
        // manual so entra quando o Ailson escolheu "manual" pra esse marco
        // (o valor fica guardado sem atrapalhar a media automatica)
        const manual = cfgA.fluxo_ref_manual?.[marcoAtivo.nome];
        const modoRef = cfgA.fluxo_ref_modo?.[marcoAtivo.nome] === 'manual' ? 'manual' : 'auto';
        if (modoRef === 'manual' && manual != null && !Number.isNaN(Number(manual))) mediaRef = Number(manual);

        let situacao = 'normal', titulo = '', texto = '', projecaoFim = null, ritmo = null;

        if (marcoAtivo.nome === '10:30') {
          if (mediaRef == null) {
            situacao = 'sem_base';
            titulo = `${finalHoje} pedidos finalizados até agora`;
            texto = `Ainda estou formando o histórico deste dia da semana — a comparação começa quando houver ${2 - refs.length} dia(s) a mais.`;
          } else if (finalHoje >= mediaRef * 0.9) {
            situacao = 'normal';
            titulo = 'Fluxo normal';
            texto = `${finalHoje} finalizados até agora (média das últimas ${refs.length === 1 ? 'vez' : '2 vezes'} nesse dia e horário: ${mediaRef}).`;
          } else {
            situacao = 'atencao';
            const pct = Math.round((1 - finalHoje / (mediaRef || 1)) * 100);
            titulo = 'Atenção no ritmo';
            texto = `${finalHoje} finalizados até agora, ${pct}% abaixo da média desse dia e horário (${mediaRef}).`;
          }
        } else {
          // projecao (11:30 e 13:00)
          const inicioMin = 8 * 60 + 40; // referencia: separacao comeca ~8h40
          const horasCorridas = Math.max(0.5, (minAgora - inicioMin) / 60);
          ritmo = +(finalHoje / horasCorridas).toFixed(1);
          // previsao de entrada ate o corte (12:00), pela media do mesmo dia da semana
          // Previsao de entrada ate o corte das 12:00 (Ailson 06/08): media dos
          // ULTIMOS 5 DIAS com movimento, no mesmo intervalo (marco → 12:00).
          let entradaPrevista = 0;
          if (minAgora < 720) {
            const recentes = [];
            for (let k = 1; k <= 20 && recentes.length < 5; k++) {
              const d = new Date(brtAgora.getTime() - k * 86400000).toISOString().slice(0, 10);
              const { count } = await supabase.from('wms_pedidos').select('id', { count: 'exact', head: true })
                .gte('criado_em', `${d}T00:00:00-03:00`).lt('criado_em', `${d}T23:59:59-03:00`);
              if ((count || 0) > 0) recentes.push(d);
            }
            if (recentes.length) {
              const vals = [];
              for (const d of recentes) vals.push(await entradosEntre(d, marcoAtivo.min, 720));
              entradaPrevista = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
            }
          }
          const restam = abertos + emSep + entradaPrevista;
          if (ritmo > 0) {
            const minFim = minAgora + (restam / ritmo) * 60;
            projecaoFim = hhmm(minFim);
            if (minFim <= 840) {
              situacao = 'normal';
              titulo = 'Fluxo normal';
              texto = `${restam} pedidos na fila e ritmo de ${ritmo}/h: a previsão é fechar por volta das ${projecaoFim}.`;
            } else if (minFim <= 900) {
              situacao = 'risco';
              titulo = 'Ritmo bom, volume acima do normal';
              texto = `${restam} pedidos na fila e ritmo de ${ritmo}/h: no ritmo atual a separação fecha por volta das ${projecaoFim}, depois do envio das 14:00.`;
            } else {
              situacao = 'vermelho';
              titulo = '🚨 Risco de estourar o envio';
              texto = `${restam} pedidos na fila e ritmo de ${ritmo}/h: a previsão é só fechar por volta das ${projecaoFim}. Precisa de mais gente na separação pra dar tempo.`;
            }
          } else {
            situacao = 'sem_base';
            titulo = `${restam} pedidos na fila`;
            texto = 'Ainda sem finalizados suficientes pra calcular o ritmo de hoje.';
          }
        }

        // janela de exibicao conforme a situacao
        const D = cfgA.duracoes || {};
        const minDoHhmm = (t, fb) => { const m = String(t || '').match(/^(\d{1,2}):(\d{2})$/); return m ? (+m[1]) * 60 + (+m[2]) : fb; };
        const jan = marcoAtivo.nome === '10:30' ? (D.m1030 ?? 10)
          : marcoAtivo.nome === '11:30' ? (situacao === 'normal' || situacao === 'sem_base' ? (D.m1130_normal ?? 10) : (D.m1130_atencao ?? 30))
          : (situacao === 'vermelho' ? (minDoHhmm(D.m1300_vermelho_ate, 870) - marcoAtivo.min)
            : (situacao === 'normal' || situacao === 'sem_base' ? (D.m1300_normal ?? 10) : (D.m1300_atencao ?? 15)));
        const visivel = minAgora <= marcoAtivo.min + jan;

        // snapshot do marco (uma vez por dia)
        try {
          await supabase.from('wms_snapshots').insert({
            data: hoje, dia_semana: diaSemana, marco: marcoAtivo.nome,
            finalizados: finalHoje, abertos, em_separacao: emSep,
            entrados_dia: lista.length, ritmo_hora: ritmo, projecao_fim: projecaoFim, situacao,
          });
        } catch { /* ja existe */ }

        return res.status(200).json({
          ok: true,
          aviso: visivel ? { marco: marcoAtivo.nome, situacao, titulo, texto } : null,
          risco_estouro: situacao === 'risco' || situacao === 'vermelho',
          detalhe: { finalizados: finalHoje, abertos, em_separacao: emSep, media_ref: mediaRef, ritmo, projecao_fim: projecaoFim },
        });
      }

      if (acao === 'produtividade') {
        // Métrica de separação (Ailson 05/08/2026):
        // cronômetro = 1ª impressão do dia + 10 min de margem → corte 12:00.
        // Desconta 25s por pedido que estava "em separação" no corte (mercadoria
        // já separada, faltando só bipar). Média por pedido e pedidos/hora.
        // Janela de calculo ate 12:45 (Ailson 06/08/2026; era 12:00) — a
        // notificacao passou pras 13:30.
        const MARGEM_MIN = 10, DESC_SEG_POR_PEDIDO = 25, HORA_CORTE = 12, MIN_CORTE = 45;
        const brt = (d) => new Date(d.getTime() - 3 * 3600000); // UTC → BRT
        const agora = new Date();
        const hojeBrt = brt(agora).toISOString().slice(0, 10);
        const corteEm = new Date(`${hojeBrt}T${String(HORA_CORTE).padStart(2, '0')}:${String(MIN_CORTE).padStart(2, '0')}:00-03:00`);

        const calcularDia = async (dia) => {
          const corte = new Date(`${dia}T${String(HORA_CORTE).padStart(2, '0')}:${String(MIN_CORTE).padStart(2, '0')}:00-03:00`);
          const { data: listas } = await supabase.from('wms_listas')
            .select('criado_em').gte('criado_em', `${dia}T00:00:00-03:00`).lt('criado_em', corte.toISOString())
            .order('criado_em', { ascending: true }).limit(1);
          let inicioBase = listas?.[0]?.criado_em || null;
          if (!inicioBase) {
            const { data: imp } = await supabase.from('wms_pedidos')
              .select('impresso_em').not('impresso_em', 'is', null)
              .gte('impresso_em', `${dia}T00:00:00-03:00`).lt('impresso_em', corte.toISOString())
              .order('impresso_em', { ascending: true }).limit(1);
            inicioBase = imp?.[0]?.impresso_em || null;
          }
          if (!inicioBase) return null;
          const inicio = new Date(new Date(inicioBase).getTime() + MARGEM_MIN * 60000);
          if (inicio >= corte) return null;

          const { data: fins } = await supabase.from('wms_pedidos')
            .select('id').not('finalizado_em', 'is', null)
            .gte('finalizado_em', inicio.toISOString()).lt('finalizado_em', corte.toISOString());
          const finalizados = (fins || []).length;

          // pedidos que estavam em separação no corte: impressos antes do corte
          // e não finalizados até lá
          const { data: emSep } = await supabase.from('wms_pedidos')
            .select('id, finalizado_em').not('impresso_em', 'is', null)
            .gte('impresso_em', `${dia}T00:00:00-03:00`).lt('impresso_em', corte.toISOString())
            .neq('status_wms', 'cancelado');
          const pendentesNoCorte = (emSep || []).filter(p => !p.finalizado_em || new Date(p.finalizado_em) >= corte).length;

          const brutos = Math.round((corte - inicio) / 1000);
          const desconto = pendentesNoCorte * DESC_SEG_POR_PEDIDO;
          const liquidos = Math.max(60, brutos - desconto);
          return {
            data: dia, inicio_em: inicio.toISOString(), corte_em: corte.toISOString(),
            segundos_brutos: brutos, pedidos_em_separacao: pendentesNoCorte,
            segundos_descontados: desconto, segundos_liquidos: liquidos,
            pedidos_finalizados: finalizados,
            media_seg_por_pedido: finalizados ? +(liquidos / finalizados).toFixed(2) : null,
            pedidos_por_hora: finalizados ? +(finalizados / (liquidos / 3600)).toFixed(2) : null,
          };
        };

        // histórico (dias já fechados)
        const { data: hist } = await supabase.from('wms_produtividade')
          .select('*').lt('data', hojeBrt).order('data', { ascending: false }).limit(30);
        const historico = (hist || []).reverse();
        const refBase = historico.filter(h => h.pedidos_por_hora > 0).slice(-14);
        const referencia = refBase.length
          ? +(refBase.reduce((s, h) => s + Number(h.pedidos_por_hora), 0) / refBase.length).toFixed(2) : null;

        // dia de hoje (ao vivo antes do corte, fechado depois)
        const hoje = await calcularDia(hojeBrt);
        let variacao = null;
        if (hoje?.pedidos_por_hora && referencia) {
          variacao = +(((hoje.pedidos_por_hora - referencia) / referencia) * 100).toFixed(1);
        }
        // persiste o fechamento uma vez por dia, após o corte
        // só grava dia com medição real (evita poluir a média de referência com
        // dia de teste/implantação, onde o cronômetro nem rodou direito)
        const diaValido = hoje && hoje.pedidos_finalizados > 0 && hoje.segundos_liquidos > 600;
        if (diaValido && agora >= corteEm) {
          const { data: ja } = await supabase.from('wms_produtividade').select('id').eq('data', hojeBrt).maybeSingle();
          if (!ja) {
            await supabase.from('wms_produtividade').insert({
              ...hoje, referencia_pedidos_hora: referencia, variacao_pct: variacao,
            });
          }
        }
        return res.status(200).json({
          ok: true, hoje: hoje ? { ...hoje, referencia_pedidos_hora: referencia, variacao_pct: variacao } : null,
          fechado: agora >= corteEm, referencia, historico, agora_iso: agora.toISOString(),
        });
      }

      if (acao === 'pedidos') {
        const status = String(req.query?.status || 'aberto');
        let q = supabase.from('wms_pedidos')
          .select('id, conta, pedido_id, numero, numero_loja, data_pedido, situacao_nome, loja_nome, canal_geral, canal_detalhe, cliente_nome, itens, qtd_skus, qtd_pecas, multi_sku, lista_id, impresso_em, finalizado_em, pendente_em, tentativas, criado_em, ml_logistic_type')
          .eq('status_wms', status)
          .order('data_pedido', { ascending: true }).limit(2000);
        const conta = String(req.query?.conta || '');
        if (conta) q = q.eq('conta', conta);
        const loja = String(req.query?.loja || '');
        if (loja) q = q.eq('canal_geral', loja);
        const { data, error } = await q;
        if (error) throw error;
        const cfgCorte = await lerWmsConfig();
        return res.status(200).json({ ok: true, pedidos: data || [], corte_em: corteDeHoje(corteHhmm(cfgCorte)), corte_lista: corteHhmm(cfgCorte) });
      }

      return res.status(400).json({ error: 'acao inválida' });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const acao = String(body.acao || '');

      if (acao === 'config') {
        const c = body.config || {};
        const payload = {
          situacoes_aberto: (Array.isArray(c.situacoes_aberto) ? c.situacoes_aberto : []).map(x => String(x).trim()).filter(Boolean),
          situacoes_finalizado: (Array.isArray(c.situacoes_finalizado) ? c.situacoes_finalizado : []).map(x => String(x).trim()).filter(Boolean),
          canais: (Array.isArray(c.canais) ? c.canais : []).map(x => ({
            canal: String(x.canal || '').trim(),
            corte: String(x.corte || ''), envio: String(x.envio || ''),
            alerta_min: parseInt(x.alerta_min) || 0,
          })).filter(x => x.canal),
          avisos_fluxo_ativo: c.avisos_fluxo_ativo !== false,
          aviso_prod_ativo: c.aviso_prod_ativo !== false,
          fluxo_ref_manual: Object.fromEntries(Object.entries(c.fluxo_ref_manual || {})
            .filter(([, v]) => v !== '' && v != null && !Number.isNaN(Number(v)))
            .map(([k, v]) => [k, Number(v)])),
          fluxo_ref_modo: Object.fromEntries(Object.entries(c.fluxo_ref_modo || {}).map(([k, v]) => [k, v === 'manual' ? 'manual' : 'auto'])),
          prod_ref_manual: (c.prod_ref_manual === '' || c.prod_ref_manual == null) ? null : Number(c.prod_ref_manual),
          prod_ref_modo: c.prod_ref_modo === 'manual' ? 'manual' : 'auto',
          duracoes: { ...WMS_CONFIG_DEFAULT.duracoes, ...(c.duracoes || {}) },
          corte_lista: /^\d{2}:\d{2}$/.test(String(c.corte_lista || '')) ? String(c.corte_lista) : CORTE_LISTA,
          _updated: new Date().toISOString(),
        };
        const { error } = await supabase.from('amicia_data')
          .upsert({ user_id: 'wms-config', payload }, { onConflict: 'user_id' });
        if (error) throw error;
        return res.status(200).json({ ok: true, config: payload });
      }

      if (acao === 'limpar_produtividade') {
        // Fase de testes (Ailson 05/08): zera o histórico pra média de
        // referência nascer limpa quando a operação engatar de verdade.
        const { error } = await supabase.from('wms_produtividade').delete().gte('data', '2000-01-01');
        if (error) throw error;
        return res.status(200).json({ ok: true });
      }

      const ids = Array.isArray(body.pedido_ids) ? body.pedido_ids.filter(Number.isFinite) : [];
      if (!ids.length) return res.status(400).json({ error: 'pedido_ids vazio' });

      if (acao === 'imprimir') {
        const { data: lista, error: eL } = await supabase.from('wms_listas')
          .insert({ criado_por: String(body.criado_por || ''), filtros: body.filtros || {}, qtd_pedidos: ids.length })
          .select('id').single();
        if (eL) throw eL;
        const agora = new Date().toISOString();
        for (let i = 0; i < ids.length; i += 400) {
          const { error } = await supabase.from('wms_pedidos')
            .update({ status_wms: 'em_separacao', lista_id: lista.id, impresso_em: agora, atualizado_em: agora })
            .in('id', ids.slice(i, i + 400)).eq('status_wms', 'aberto');
          if (error) throw error;
        }
        return res.status(200).json({ ok: true, lista_id: lista.id, marcados: ids.length });
      }

      if (acao === 'marcar_impresso') {
        // "Já vi na tela e já busquei no estoque" (Ailson 05/08): muda
        // aberto → em_separacao na hora, sem lista/PDF
        const agora = new Date().toISOString();
        const { error } = await supabase.from('wms_pedidos')
          .update({ status_wms: 'em_separacao', impresso_em: agora, atualizado_em: agora })
          .in('id', ids).eq('status_wms', 'aberto');
        if (error) throw error;
        return res.status(200).json({ ok: true });
      }

      if (acao === 'marcar_pendente') {
        // Repasse das faltas (Ailson 05/08): o auxiliar circula no papel, a
        // responsável toca na tela. Sai de em_separacao pra 'pendente' — não
        // conta no desconto de 25s da produtividade (falta de estoque não é
        // lentidão da equipe).
        const agora = new Date().toISOString();
        const { error } = await supabase.from('wms_pedidos')
          .update({ status_wms: 'pendente', pendente_em: agora, atualizado_em: agora })
          .in('id', ids).in('status_wms', ['aberto', 'em_separacao']);
        if (error) throw error;
        return res.status(200).json({ ok: true });
      }

      if (acao === 'pendente_chegou') {
        // Mercadoria chegou: volta pro funil de abertos com tentativas+1
        // (a lista da próxima onda destaca como 2ª tentativa e ordena no topo).
        const { data: atuais } = await supabase.from('wms_pedidos').select('id, tentativas').in('id', ids);
        for (const p of (atuais || [])) {
          await supabase.from('wms_pedidos').update({
            status_wms: 'aberto', pendente_em: null, lista_id: null, impresso_em: null,
            tentativas: (p.tentativas || 1) + 1, atualizado_em: new Date().toISOString(),
          }).eq('id', p.id);
        }
        return res.status(200).json({ ok: true, voltaram: (atuais || []).length });
      }

      if (acao === 'voltar') {
        const { error } = await supabase.from('wms_pedidos')
          .update({ status_wms: 'aberto', lista_id: null, impresso_em: null, atualizado_em: new Date().toISOString() })
          .in('id', ids).eq('status_wms', 'em_separacao');
        if (error) throw error;
        return res.status(200).json({ ok: true });
      }

      if (acao === 'finalizar') {
        const agora = new Date().toISOString();
        const { error } = await supabase.from('wms_pedidos')
          .update({ status_wms: 'finalizado', finalizado_em: agora, atualizado_em: agora })
          .in('id', ids);
        if (error) throw error;
        return res.status(200).json({ ok: true });
      }

      return res.status(400).json({ error: 'acao inválida' });
    }

    return res.status(405).json({ error: 'método' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
