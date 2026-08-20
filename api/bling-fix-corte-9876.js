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

// 20/08 22h — REVISADO após os logs: a Cris já corrigiu quase tudo na mão
// (17:04-17:07). Sobrou SÓ a Sálvia GG com o corte dobrado (53; correto =
// 5 pré + 24 do corte = 29). Estorno cirúrgico + selo do corte.
const CELULAS = [
  { cor_norm: 'verdesalvia', tam: 'GG', valor_correto: 29 },
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

    // SELA o corte 9876 como adicionado: sai da projeção e a trava impede
    // qualquer novo acréscimo (a matriz toda já está no estoque, conferida)
    const corteId = String(req.query?.corte_id || '');
    let selo = null;
    if (corteId) {
      const { error: eS } = await supabase.from('bling_cortes_inseridos').upsert({
        ref_norm: REF, corte_id: corteId, corte_n: '9876', inserido_por: 'correcao-incidente',
        status: 'ok', atualizado_em: new Date().toISOString(),
        resultado: [{ obs: 'incidente 20/08: levas duplicadas corrigidas manualmente pela Cris + estorno da Salvia GG; matriz completa no estoque' }],
      }, { onConflict: 'ref_norm,corte_id' });
      selo = eS ? eS.message : 'gravado';
    }

    return res.status(200).json({ ok: feito.every(f => f.ok), feito, selo });
  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
}
