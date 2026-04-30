/**
 * lojas-drive-debug-backfill-vendedora.js
 *
 * GET /api/lojas-drive-debug-backfill-vendedora?user=ailson
 *
 * Roda o backfill de vendedora dominante MANUALMENTE, lendo TUDO
 * de lojas_vendas (sem depender de import). Diagnostica:
 *   - Se a logica funciona quando rodada isoladamente
 *   - Quantos clientes seriam atualizados
 *   - Quais erros aparecem
 */

import { createClient } from '@supabase/supabase-js';
import { setCors } from './_lojas-helpers.js';

export const config = { maxDuration: 120 };

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.query.user !== 'ailson') {
    return res.status(403).json({ error: 'Apenas admin (?user=ailson)' });
  }

  try {
    // 1. Le TODAS as vendas com cliente_id e vendedora_id
    const { data: vendas, error: errV } = await supabase
      .from('lojas_vendas')
      .select('cliente_id, vendedora_id')
      .not('cliente_id', 'is', null)
      .not('vendedora_id', 'is', null);

    if (errV) return res.status(500).json({ erro: 'select vendas', detail: errV.message });

    // 2. Conta vendedora por cliente
    const vendedoraCount = new Map();
    for (const v of vendas || []) {
      if (!vendedoraCount.has(v.cliente_id)) vendedoraCount.set(v.cliente_id, new Map());
      const inner = vendedoraCount.get(v.cliente_id);
      inner.set(v.vendedora_id, (inner.get(v.vendedora_id) || 0) + 1);
    }

    // 3. Vendedora dominante
    const dominantePorCliente = new Map();
    for (const [cid, vends] of vendedoraCount) {
      let melhor = null, max = 0;
      for (const [vid, c] of vends) {
        if (c > max) { max = c; melhor = vid; }
      }
      if (melhor) dominantePorCliente.set(cid, melhor);
    }

    // 4. Quais desses ainda não tem vendedora
    const ids = Array.from(dominantePorCliente.keys());
    const { data: semVend, error: errC } = await supabase
      .from('lojas_clientes')
      .select('id')
      .in('id', ids)
      .is('vendedora_id', null);

    if (errC) return res.status(500).json({ erro: 'select sem vendedora', detail: errC.message });

    const idsParaAtualizar = (semVend || []).map(c => c.id);

    // 5. Loja de cada vendedora
    const vendedoraIds = [...new Set(idsParaAtualizar.map(id => dominantePorCliente.get(id)))];
    const { data: vendoras } = await supabase
      .from('lojas_vendedoras')
      .select('id, loja, nome')
      .in('id', vendedoraIds);
    const vendIdToLoja = new Map((vendoras || []).map(v => [v.id, v.loja]));
    const vendIdToNome = new Map((vendoras || []).map(v => [v.id, v.nome]));

    // 6. Atualiza
    let atualizados = 0;
    let erros = [];
    for (const cid of idsParaAtualizar) {
      const vid = dominantePorCliente.get(cid);
      const loja = vendIdToLoja.get(vid);
      const { error, count } = await supabase
        .from('lojas_clientes')
        .update({
          vendedora_id: vid,
          loja_origem: loja,
          vendedor_a_definir: false,
          fonte_atribuicao: 'vendedora_dominante_historico',
          data_atribuicao: new Date().toISOString(),
        }, { count: 'exact' })
        .eq('id', cid)
        .is('vendedora_id', null);

      if (error) {
        if (erros.length < 5) erros.push({ cid, msg: error.message });
      } else if (count > 0) {
        atualizados++;
      }
    }

    return res.status(200).json({
      total_vendas_com_cliente_e_vendedora: vendas?.length || 0,
      total_clientes_no_count: vendedoraCount.size,
      total_clientes_dominante_definido: dominantePorCliente.size,
      total_ids_para_atualizar_pre_check: idsParaAtualizar.length,
      total_atualizados: atualizados,
      primeiros_erros: erros,
      sample_dominante: idsParaAtualizar.slice(0, 5).map(cid => ({
        cliente_id: cid,
        vendedora_dominante: vendIdToNome.get(dominantePorCliente.get(cid)),
        loja: vendIdToLoja.get(dominantePorCliente.get(cid)),
      })),
    });
  } catch (err) {
    return res.status(500).json({ erro: err.message, stack: err.stack?.split('\n').slice(0, 5) });
  }
}
