/**
 * bling-estoque-consolidar-cron.js — consolidação diária do vendável (5h BRT).
 *
 * Problema (Ailson 08/07/2026): o site da Meluni (Convertr) lê o depósito
 * Geral da EXITUS, mas o vendável real é a SOMA dos 3 Gerais (Exitus + Lumia +
 * Muniam) — os filhos acumulam saldo NEGATIVO com as vendas deles e o site
 * anuncia estoque que não existe.
 *
 * O que faz: pra cada SKU com filho ≠ 0 na bling_estoque:
 *   1. zera o Geral de Lumia e Muniam (helper compartilhado)
 *   2. balanço no Geral Exitus = qtd + qtd_lumia + qtd_muniam (o vendável)
 *   3. espelha na bling_estoque (qtd = vendável, filhos = 0)
 * Se a soma der NEGATIVA, tenta gravar o negativo no Exitus (preserva a
 * dívida); se o Bling recusar o balanço negativo, grava 0 e marca no log.
 *
 * Ordem dos crons da manhã: 6h/6h20/6h40 BRT rodam os syncs das 3 contas
 * (fonte da leitura), este roda às 5h BRT do dia SEGUINTE — ou seja, consome
 * a foto dos syncs de ontem + o que o webhook/set atualizaram durante o dia.
 * Roda ?limit=45 SKUs por invocação (pacing ~3 chamadas/s do Bling); o que
 * sobrar fica pra próxima madrugada. GET manual: ?limit=&dry=1 pra simular.
 */
import { refreshBlingToken, blingFetch, supabase } from './_bling-helpers.js';
import { zerarFilhosSku, saldoDeposito } from './_bling-filhos-helpers.js';

export const config = { maxDuration: 300 };
const API = 'https://api.bling.com.br/Api/v3';
const pausa = ms => new Promise(r => setTimeout(r, ms));

export default async function handler(req, res) {
  const t0 = Date.now();
  const dry = String(req.query?.dry || '') === '1';
  const limit = Math.min(Math.max(Number(req.query?.limit) || 45, 1), 120);

  const resumo = { dry, processados: 0, ok: 0, falhas: 0, restantes: 0, detalhes: [], erros: [] };
  try {
    // ── SKUs sujos (filho ≠ 0) — sem gastar UMA chamada no Bling pra descobrir ──
    const { data: sujos, error: eSel } = await supabase.from('bling_estoque')
      .select('ref,cor_norm,tam,qtd,qtd_lumia,qtd_muniam,bling_sku,bling_produto_id')
      .or('qtd_lumia.neq.0,qtd_muniam.neq.0')
      .not('bling_sku', 'is', null)
      .order('qtd_lumia', { ascending: true })
      .limit(limit + 400);
    if (eSel) throw new Error('select: ' + eSel.message);
    const fila = (sujos || []).filter(r => (Number(r.qtd_lumia) || 0) !== 0 || (Number(r.qtd_muniam) || 0) !== 0);
    resumo.fila_total = fila.length;
    const lote = fila.slice(0, limit);
    resumo.restantes = Math.max(0, fila.length - lote.length);
    if (!lote.length) return res.status(200).json({ ...resumo, msg: 'nada a consolidar' });

    // ── config (cache de depósitos) + token exitus ──
    const { data: cfgRow } = await supabase.from('amicia_data').select('payload').eq('user_id', 'bling-estoque-config').maybeSingle();
    const cfg = cfgRow?.payload || {};
    let cfgMudou = false;
    const tokenEx = await refreshBlingToken('exitus');
    const headersEx = { Authorization: `Bearer ${tokenEx}`, Accept: 'application/json', 'Content-Type': 'application/json' };
    const depEx = cfg.deposito_geral || null;
    if (!depEx) throw new Error('deposito_geral do exitus não configurado em bling-estoque-config');

    for (const row of lote) {
      if (Date.now() - t0 > 240000) { resumo.restantes += lote.length - resumo.processados; resumo.erros.push('tempo esgotado — resto fica pra próxima madrugada'); break; }
      const det = { ref: row.ref, cor: row.cor_norm, tam: row.tam, exitus: row.qtd, lumia: row.qtd_lumia, muniam: row.qtd_muniam };
      resumo.processados++;
      try {
        const vendavel = (Number(row.qtd) || 0) + (Number(row.qtd_lumia) || 0) + (Number(row.qtd_muniam) || 0);
        det.vendavel = vendavel;
        if (dry) { det.dry = true; resumo.ok++; resumo.detalhes.push(det); continue; }

        // 1. zera filhos
        const z = await zerarFilhosSku(row.bling_sku, cfg);
        if (z.cfgMudou) cfgMudou = true;
        const zFail = z.resultados.filter(x => !x.ok);
        if (zFail.length) throw new Error('filhos: ' + zFail.map(x => `${x.conta} ${x.erro}`).join('; '));

        // 2. balanço no Exitus = vendável
        let produtoIdEx = row.bling_produto_id || null;
        if (!produtoIdEx) {
          const rp = await blingFetch(`${API}/produtos?codigo=${encodeURIComponent(row.bling_sku)}`, headersEx);
          const jp = await rp.json().catch(() => ({}));
          produtoIdEx = jp.data?.[0]?.id || null;
        }
        if (!produtoIdEx) throw new Error('produto não encontrado no exitus');
        let alvo = vendavel;
        let rb = await fetch(`${API}/estoques`, {
          method: 'POST', headers: headersEx,
          body: JSON.stringify({ produto: { id: Number(produtoIdEx) }, deposito: { id: Number(depEx) }, operacao: 'B', quantidade: alvo }),
        });
        if (!rb.ok && alvo < 0) {
          // Bling recusou balanço negativo → grava 0 e registra a dívida perdida
          det.negativo_recusado = true; alvo = 0;
          rb = await fetch(`${API}/estoques`, {
            method: 'POST', headers: headersEx,
            body: JSON.stringify({ produto: { id: Number(produtoIdEx) }, deposito: { id: Number(depEx) }, operacao: 'B', quantidade: 0 }),
          });
        }
        if (!rb.ok) throw new Error(`balanço exitus HTTP ${rb.status}`);

        // 3. espelho
        await supabase.from('bling_estoque').update({
          qtd: alvo, qtd_lumia: 0, qtd_muniam: 0,
          bling_produto_id: produtoIdEx,
          atualizado_em: new Date().toISOString(), atualizado_por: 'consolidar_cron',
        }).eq('ref', row.ref).eq('cor_norm', row.cor_norm).eq('tam', row.tam);

        det.gravado = alvo; resumo.ok++;
      } catch (e) {
        det.erro = e.message || String(e); resumo.falhas++;
      }
      resumo.detalhes.push(det);
      await pausa(300);
    }

    if (cfgMudou) {
      await supabase.from('amicia_data').upsert(
        { user_id: 'bling-estoque-config', payload: cfg, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      );
    }
    if (resumo.detalhes.length > 60) resumo.detalhes = resumo.detalhes.filter(d => d.erro || d.negativo_recusado).slice(0, 60);
    resumo.duracao_s = Math.round((Date.now() - t0) / 1000);
    return res.status(200).json(resumo);
  } catch (e) {
    resumo.erros.push(e.message || String(e));
    return res.status(500).json(resumo);
  }
}
