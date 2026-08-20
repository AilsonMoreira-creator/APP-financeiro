// /api/bling-fix-corte-9876 — ESTORNO do incidente de 20/08 (Cris):
// o corte 9876 da ref 2798 entrou 2-3x em 4 células por causa do timeout
// sem trava. Este endpoint volta as 4 células pros valores PRÉ-corte no
// Bling + espelho, apaga os logs das levas duplicadas e registra a
// correção — deixando o corte 9876 VIRGEM pra ser acrescentado de novo
// pelo fluxo normal (agora com selo + retomada).
// GET sem parâmetro = prévia seca; ?executar=1 roda.
import { refreshBlingToken, blingFetch, supabase } from './_bling-helpers.js';

export const config = { maxDuration: 120 };
const API = 'https://api.bling.com.br/Api/v3';

// vendável PRÉ-corte medido nos logs (qtd_anterior da 1ª leva)
const CELULAS = [
  { cor_norm: 'verdesalvia', tam: 'M',  valor_correto: 0 },
  { cor_norm: 'verdesalvia', tam: 'G',  valor_correto: 0 },
  { cor_norm: 'verdesalvia', tam: 'GG', valor_correto: 5 },
  { cor_norm: 'nude',        tam: 'M',  valor_correto: 14 },
];
const REF = '2798';
const MOTIVO_CORTE = 'corte 9876';

export default async function handler(req, res) {
  const executar = String(req.query?.executar || '') === '1';
  try {
    const { data: linhas } = await supabase.from('bling_estoque')
      .select('ref, cor_norm, tam, cor_label, qtd, qtd_lumia, qtd_muniam, bling_produto_id')
      .eq('ref', REF).in('cor_norm', [...new Set(CELULAS.map(c => c.cor_norm))]);
    const plano = CELULAS.map(c => {
      const row = (linhas || []).find(l => l.cor_norm === c.cor_norm && l.tam === c.tam);
      return { ...c, atual: row?.qtd ?? null, produto_id: row?.bling_produto_id ?? null, cor_label: row?.cor_label };
    });
    const { count: logsCorte } = await supabase.from('bling_estoque_logs')
      .select('id', { count: 'exact', head: true })
      .eq('ref', REF).eq('origem', 'acrescentar_corte').eq('motivo', MOTIVO_CORTE);

    if (!executar) return res.status(200).json({ previa: true, plano, logs_a_apagar: logsCorte });

    const token = await refreshBlingToken('exitus');
    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' };
    const { data: cfg } = await supabase.from('amicia_data').select('payload').eq('user_id', 'bling-estoque-config').maybeSingle();
    const depositoId = cfg?.payload?.deposito_geral_exitus;
    if (!depositoId) return res.status(500).json({ erro: 'deposito geral exitus não configurado' });

    const feito = [];
    for (const c of plano) {
      if (!c.produto_id) { feito.push({ ...c, ok: false, erro: 'sem produto_id no espelho' }); continue; }
      const r = await fetch(`${API}/estoques`, {
        method: 'POST', headers,
        body: JSON.stringify({ produto: { id: Number(c.produto_id) }, deposito: { id: Number(depositoId) }, operacao: 'B', quantidade: c.valor_correto }),
      });
      if (!r.ok) { feito.push({ ...c, ok: false, erro: `Bling HTTP ${r.status}` }); continue; }
      await supabase.from('bling_estoque').update({
        qtd: c.valor_correto, atualizado_em: new Date().toISOString(), atualizado_por: 'correcao-9876',
      }).eq('ref', REF).eq('cor_norm', c.cor_norm).eq('tam', c.tam);
      await supabase.from('bling_estoque_logs').insert({
        ref: REF, cor_norm: c.cor_norm, tam: c.tam, cor_label: c.cor_label || null,
        qtd_anterior: c.atual, qtd_nova: c.valor_correto, delta: c.valor_correto - (c.atual || 0),
        motivo: 'estorno do corte 9876 somado em duplicidade (incidente 20/08)',
        usuario: 'sistema', origem: 'manual',
      });
      feito.push({ ...c, ok: true });
      await new Promise(r2 => setTimeout(r2, 400));
    }

    // apaga os logs das levas duplicadas — o corte volta a ficar virgem
    // (a retomada por célula usa esses logs; sem apagar, o re-acréscimo pularia as 4)
    const { error: eDel } = await supabase.from('bling_estoque_logs').delete()
      .eq('ref', REF).eq('origem', 'acrescentar_corte').eq('motivo', MOTIVO_CORTE);

    return res.status(200).json({ ok: feito.every(f => f.ok), feito, logs_apagados: !eDel });
  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
}
