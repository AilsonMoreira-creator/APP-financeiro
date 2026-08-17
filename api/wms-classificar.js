/**
 * wms-classificar.js — PRINT PLAN por pedido (Ailson 17/08/2026)
 *
 * Tira as regras de dentro do gerador de PDF e transforma em dado. Depois
 * disso a impressão fica "burra": ela só pega quem está PRONTO.
 *
 * Regras da operação (as mesmas de hoje, agora num lugar só):
 *   NORMAL         → imprime NF + etiqueta
 *   MELI_FLEX      → só etiqueta (a nota não vai no pacote do Flex)
 *   MELI_AGENDADO  → só a NF, com a data de envio no cabeçalho; a etiqueta
 *                    do ML só libera no dia agendado
 *   MELUNI         → fluxo próprio (não entra na impressão do marketplace)
 *   SEM_NF         → nada a imprimir até a nota existir
 *
 * Estados: AGUARDA_NF · AGUARDA_LOGISTICA · PRONTO · IMPRESSO · ERRO
 * Roda sozinho (cron) e é chamado no início do "Preparar lote".
 * GET ?contas=todas
 */
import { supabase } from './_bling-helpers.js';

export const config = { maxDuration: 120 };

export function classificar(p, hojeBRT) {
  const canal = String(p.canal_geral || '');
  const flex = p.ml_logistic_type === 'self_service';
  const full = p.ml_logistic_type === 'fulfillment';
  const meluni = canal === 'Meluni' || (p.conta === 'lumia' && canal === 'Outros');
  const agendado = p.ml_agendado_em && String(p.ml_agendado_em) > hojeBRT;
  const temNf = !!p.nf_id;
  const nfPronta = p.nf_situacao === 5;         // autorizada, DANFE não impressa
  const nfImpressa = p.nf_situacao === 6;       // DANFE já emitida

  if (meluni) return { regra: 'MELUNI', nf: false, etiqueta: true, estado: 'PRONTO', motivo: 'fluxo Meluni' };
  if (full) return { regra: 'ML_FULL', nf: false, etiqueta: false, estado: 'PRONTO', motivo: 'Full: sai pelo armazém do ML' };

  if (agendado) {
    return {
      regra: 'MELI_AGENDADO', nf: true, etiqueta: false,
      estado: p.nf_agendada_impressa_em ? 'IMPRESSO' : (temNf ? 'PRONTO' : 'AGUARDA_NF'),
      motivo: temNf ? `envio programado para ${String(p.ml_agendado_em).split('-').reverse().join('/')}` : 'agendado, sem nota ainda',
    };
  }

  if (flex) {
    return {
      regra: 'MELI_FLEX', nf: false, etiqueta: true,
      estado: p.etiqueta_impressa_em ? 'IMPRESSO' : 'PRONTO',
      motivo: 'Flex: só etiqueta',
    };
  }

  if (!temNf) return { regra: 'SEM_NF', nf: false, etiqueta: false, estado: 'AGUARDA_NF', motivo: 'sem nota fiscal ainda' };

  if (nfImpressa || p.etiqueta_impressa_em) {
    return { regra: 'NORMAL', nf: true, etiqueta: true, estado: 'IMPRESSO', motivo: 'já impresso' };
  }
  if (!nfPronta) {
    return { regra: 'NORMAL', nf: true, etiqueta: true, estado: 'AGUARDA_NF', motivo: 'nota ainda não autorizada' };
  }
  return { regra: 'NORMAL', nf: true, etiqueta: true, estado: 'PRONTO', motivo: 'nota autorizada, pronto pra imprimir' };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const hojeBRT = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
  try {
    const { data: peds } = await supabase.from('wms_pedidos')
      .select('pedido_id, conta, canal_geral, ml_logistic_type, status_wms, nf_id, nf_situacao, ml_agendado_em, etiqueta_impressa_em, nf_agendada_impressa_em')
      .neq('status_wms', 'cancelado')
      .gte('criado_em', new Date(Date.now() - 5 * 86400000).toISOString())
      .limit(2000);

    const contagem = {};
    const porEstado = {};
    for (const p of (peds || [])) {
      const c = classificar(p, hojeBRT);
      contagem[c.estado] = (contagem[c.estado] || 0) + 1;
      const chave = `${c.regra}|${c.nf}|${c.etiqueta}|${c.estado}|${c.motivo}`;
      (porEstado[chave] = porEstado[chave] || []).push(p.pedido_id);
    }
    // grava agrupado (poucos updates em vez de um por pedido)
    let gravados = 0;
    for (const [chave, ids] of Object.entries(porEstado)) {
      const [regra, nf, etiqueta, estado, motivo] = chave.split('|');
      for (let i = 0; i < ids.length; i += 200) {
        const { count } = await supabase.from('wms_pedidos').update({
          print_regra: regra, print_nf: nf === 'true', print_etiqueta: etiqueta === 'true',
          print_estado: estado, print_motivo: motivo,
          print_classificado_em: new Date().toISOString(),
        }, { count: 'exact' }).in('pedido_id', ids.slice(i, i + 200));
        gravados += count || 0;
      }
    }
    return res.status(200).json({ ok: true, avaliados: (peds || []).length, gravados, por_estado: contagem });
  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
}
