/**
 * wms-nf-sync.js — mantém a SITUAÇÃO DAS NOTAS pré-carregada (Ailson 17/08)
 *
 * Motivo do redesenho: a tela de etiquetas consultava o Bling na hora do
 * clique (descobrir nf_id de cada pedido + varrer a lista de notas). Com a
 * Exitus emitindo centenas de notas por dia isso virou minutos de espera e
 * às vezes nem achava a nota nova. Agora:
 *
 *   este cron (a cada 10 min) escreve nf_id + nf_situacao no wms_pedidos
 *   → a tela LÊ SÓ O BANCO e abre instantânea
 *   → o Bling só é chamado no momento real da impressão (buscar a etiqueta)
 *
 * A varredura é curta de propósito: só as notas dos ÚLTIMOS 2 DIAS, que é
 * onde a situação muda (5 autorizada → 6 DANFE emitida).
 *
 * GET ?dias=2&contas=exitus,lumia,muniam
 */
import { supabase, blingFetch, refreshBlingToken } from './_bling-helpers.js';

export const config = { maxDuration: 300 };
const espera = (ms) => new Promise(r => setTimeout(r, ms));

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const dias = Math.min(parseInt(req.query?.dias) || 2, 10);
  const contas = String(req.query?.contas || 'exitus,lumia,muniam').split(',').map(c => c.trim());
  const desde = new Date(Date.now() - dias * 86400000).toISOString().slice(0, 10);
  const inicio = Date.now();
  const resumo = { desde, contas: {} };

  try {
    for (const conta of contas) {
      const r = resumo.contas[conta] = { notas_lidas: 0, situacoes_gravadas: 0, nf_id_descobertos: 0 };
      let token;
      try { token = await refreshBlingToken(conta); } catch { r.erro = 'token'; continue; }
      const h = { Authorization: 'Bearer ' + token, Accept: 'application/json' };

      // ── 1. descobrir o nf_id de quem ainda não tem (NF feita à mão no Bling)
      // 18/08: Full/Flex/Meluni não precisam de NF neste fluxo e estavam
      // ocupando as 60 vagas da rodada — pedido com nota recém-emitida nunca
      // era consultado. Agora: só quem precisa, em RODÍZIO (carimba o check
      // sempre, achou ou não, e a fila ordena pelo check mais antigo).
      const { data: semNf } = await supabase.from('wms_pedidos')
        .select('pedido_id')
        .eq('conta', conta).is('nf_id', null)
        .neq('status_wms', 'cancelado')
        .or('ml_logistic_type.is.null,ml_logistic_type.not.in.(fulfillment,self_service)')
        .neq('canal_geral', 'Meluni')
        .gte('criado_em', new Date(Date.now() - 3 * 86400000).toISOString())
        .order('nf_checado_em', { ascending: true, nullsFirst: true })
        .limit(60);
      for (const p of (semNf || [])) {
        if (Date.now() - inicio > 240000) break;
        let nfId = null;
        try {
          const rr = await blingFetch(`https://api.bling.com.br/Api/v3/pedidos/vendas/${p.pedido_id}`, h);
          const j = typeof rr.json === 'function' ? await rr.json().catch(() => ({})) : {};
          nfId = j?.data?.notaFiscal?.id || null;
        } catch { /* carimba mesmo assim pra não travar o rodízio */ }
        await supabase.from('wms_pedidos')
          .update({ ...(nfId ? { nf_id: nfId } : {}), nf_checado_em: new Date().toISOString() })
          .eq('pedido_id', p.pedido_id);
        if (nfId) r.nf_id_descobertos++;
        await espera(340);
      }

      // ── 2. situação das notas recentes → grava em quem tem aquele nf_id
      const situacoes = {};
      for (let pagina = 1; pagina <= 30; pagina++) {
        if (Date.now() - inicio > 270000) { r.aviso = 'tempo esgotado'; break; }
        const url = `https://api.bling.com.br/Api/v3/nfe?tipo=1&dataEmissaoInicial=${desde}&limite=100&pagina=${pagina}`;
        let j = {};
        try {
          const rr = await blingFetch(url, h);
          j = typeof rr.json === 'function' ? await rr.json().catch(() => ({})) : {};
        } catch { break; }
        const lista = j?.data || [];
        for (const nf of lista) if (nf?.id) situacoes[String(nf.id)] = nf.situacao;
        r.notas_lidas += lista.length;
        if (lista.length < 100) break;
        await espera(300);
      }

      // 25/08 (caso 155050: NF cancelada dias atras e o espelho preso em
      // "autorizada"): PENDENCIAS DA FILA sao re-checadas SEMPRE, uma a uma,
      // independente da janela da varredura — a lista e minuscula (sit 5 sem
      // carimbo, ate 3 dias) e e exatamente o que o contador mostra.
      try {
        const desde3p = new Date(Date.now() - 3 * 86400000 - 3 * 3600000).toISOString().slice(0, 10);
        const { data: pends } = await supabase.from('wms_pedidos')
          .select('nf_id')
          .eq('conta', conta)
          .eq('nf_situacao', 5)
          .is('etiqueta_impressa_em', null)
          .neq('status_wms', 'cancelado')
          .gte('data_pedido', desde3p)
          .not('nf_id', 'is', null)
          .limit(40);
        for (const pd of (pends || [])) {
          if (situacoes[String(pd.nf_id)] !== undefined) continue; // a varredura ja cobriu
          try {
            const rr2 = await blingFetch(`https://api.bling.com.br/Api/v3/nfe/${pd.nf_id}`, h);
            const j2 = typeof rr2.json === 'function' ? await rr2.json().catch(() => ({})) : {};
            const sit2 = j2?.data?.situacao;
            if (sit2 != null) { situacoes[String(pd.nf_id)] = sit2; r.pendencias_checadas = (r.pendencias_checadas || 0) + 1; }
          } catch { /* proxima */ }
          await espera(350);
        }
      } catch { /* a varredura normal segue */ }

      // grava agrupando por situação (poucos updates em vez de um por nota)
      const porSituacao = {};
      for (const [id, sit] of Object.entries(situacoes)) {
        (porSituacao[sit] = porSituacao[sit] || []).push(Number(id));
      }
      for (const [sit, ids] of Object.entries(porSituacao)) {
        for (let i = 0; i < ids.length; i += 200) {
          const { count } = await supabase.from('wms_pedidos')
            .update({ nf_situacao: Number(sit), nf_checado_em: new Date().toISOString() }, { count: 'exact' })
            .in('nf_id', ids.slice(i, i + 200));
          r.situacoes_gravadas += count || 0;
        }
      }
    }
    resumo.segundos = Math.round((Date.now() - inicio) / 1000);
    return res.status(200).json(resumo);
  } catch (e) {
    return res.status(500).json({ erro: e.message, resumo });
  }
}
