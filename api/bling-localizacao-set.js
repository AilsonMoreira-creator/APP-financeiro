/**
 * bling-localizacao-set.js — Define a localização de estoque de uma REF inteira.
 *
 * Mesmo caminho do código de barras (bling-gtin-popular + bling-gtin-drain):
 * este endpoint PREPARA (grava a letra na fila e marca as 3 contas como
 * pendentes) e o bling-localizacao-popular GRAVA no Bling, conta por conta.
 *
 * Pega TODOS os SKUs da ref (variações) e enfileira pras 3 contas. Se a ref já
 * tinha localização, sobrescreve — é o caminho de alteração também.
 * Preserva o cache de id do produto por conta (pid_*), pra não refazer busca.
 *
 * Uso:
 *   GET /api/bling-localizacao-set?ref=2934            -> consulta o estado atual
 *   GET /api/bling-localizacao-set?ref=2934&loc=A      -> define/altera e enfileira
 *
 * Ailson 19/07/2026.
 */
import { supabase } from './_bling-helpers.js';

export const config = { maxDuration: 30 };

const normRef = (v) => String(v || '').replace(/\D/g, '').replace(/^0+/, '') || '';
const normLoc = (v) => String(v || '').trim().toUpperCase().slice(0, 6);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-User');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const ref = normRef(req.query.ref);
  if (!ref) return res.status(400).json({ error: 'ref_obrigatoria' });

  // Variações da ref (fonte: espelho do estoque). bling_produto_id é o id na exitus.
  const { data: skus, error: errSku } = await supabase
    .from('bling_estoque')
    .select('bling_sku, ref, titulo, bling_produto_id')
    .eq('ref', ref)
    .not('bling_sku', 'is', null);
  if (errSku) return res.status(500).json({ error: errSku.message });
  if (!skus || !skus.length) return res.status(404).json({ error: 'ref_sem_skus_no_estoque', ref });

  // Estado atual da fila pra essa ref (o que já está gravado / pendente).
  const { data: atuais } = await supabase
    .from('bling_localizacao_fila')
    .select('sku, localizacao, feito_exitus, feito_lumia, feito_muniam, pid_exitus, pid_lumia, pid_muniam')
    .eq('ref', ref);
  const porSku = new Map((atuais || []).map(r => [r.sku, r]));

  // Sem ?loc= é só consulta — usado pra pré-preencher o modal.
  if (req.query.loc === undefined) {
    const locs = [...new Set((atuais || []).map(r => r.localizacao).filter(Boolean))];
    return res.status(200).json({
      ok: true, ref,
      total_skus: skus.length,
      localizacao_atual: locs.length === 1 ? locs[0] : (locs.length ? locs : null),
      gravados: {
        exitus: (atuais || []).filter(r => r.feito_exitus).length,
        lumia: (atuais || []).filter(r => r.feito_lumia).length,
        muniam: (atuais || []).filter(r => r.feito_muniam).length,
      },
    });
  }

  const loc = normLoc(req.query.loc);
  if (!loc) return res.status(400).json({ error: 'loc_vazia' });
  if (!/^[A-Z0-9-]{1,6}$/.test(loc)) return res.status(400).json({ error: 'loc_invalida', dica: 'use letras/números, ex: A, B2, J' });

  // Monta as linhas: mantém o cache de pid por conta e zera as flags, pra que o
  // drain regrave nas 3 contas (é isso que faz a ALTERAÇÃO sobrescrever).
  const linhas = skus.map(s => {
    const ant = porSku.get(s.bling_sku) || {};
    return {
      sku: s.bling_sku,
      ref,
      localizacao: loc,
      titulo: s.titulo || null,
      pid_exitus: ant.pid_exitus || s.bling_produto_id || null,
      pid_lumia: ant.pid_lumia || null,
      pid_muniam: ant.pid_muniam || null,
      feito_exitus: false,
      feito_lumia: false,
      feito_muniam: false,
      erro_msg: null,
      atualizado_em: new Date().toISOString(),
    };
  });

  const { error: errUp } = await supabase
    .from('bling_localizacao_fila')
    .upsert(linhas, { onConflict: 'sku' });
  if (errUp) return res.status(500).json({ error: errUp.message });

  return res.status(200).json({
    ok: true,
    ref,
    localizacao: loc,
    enfileirados: linhas.length,
    novos: linhas.filter(l => !porSku.has(l.sku)).length,
  });
}
