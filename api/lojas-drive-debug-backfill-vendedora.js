/**
 * lojas-drive-debug-backfill-vendedora.js — V2 com supabase do helpers
 * Roda backfill em batch de 50 por vez, mostra erro detalhado
 */

import { supabase, setCors } from './_lojas-helpers.js';

export const config = { maxDuration: 120 };

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.query.user !== 'ailson') {
    return res.status(403).json({ error: 'Apenas admin (?user=ailson)' });
  }

  const debug = { etapa: 'inicio' };

  try {
    debug.etapa = 'select_vendas';
    const { data: vendas, error: errV } = await supabase
      .from('lojas_vendas')
      .select('cliente_id, vendedora_id')
      .not('cliente_id', 'is', null)
      .not('vendedora_id', 'is', null);

    if (errV) return res.status(500).json({ debug, erro: 'select vendas', detail: errV.message });

    debug.total_vendas = vendas?.length || 0;

    const vendedoraCount = new Map();
    for (const v of vendas || []) {
      if (!vendedoraCount.has(v.cliente_id)) vendedoraCount.set(v.cliente_id, new Map());
      const inner = vendedoraCount.get(v.cliente_id);
      inner.set(v.vendedora_id, (inner.get(v.vendedora_id) || 0) + 1);
    }
    debug.total_clientes_no_count = vendedoraCount.size;

    const dominantePorCliente = new Map();
    for (const [cid, vends] of vendedoraCount) {
      let melhor = null, max = 0;
      for (const [vid, c] of vends) {
        if (c > max) { max = c; melhor = vid; }
      }
      if (melhor) dominantePorCliente.set(cid, melhor);
    }
    debug.total_dominante = dominantePorCliente.size;

    debug.etapa = 'select_clientes';
    const ids = Array.from(dominantePorCliente.keys());
    const { data: semVend, error: errC } = await supabase
      .from('lojas_clientes')
      .select('id, documento, razao_social, vendedora_id')
      .in('id', ids);

    if (errC) return res.status(500).json({ debug, erro: 'select clientes', detail: errC.message });

    debug.total_clientes_encontrados = semVend?.length || 0;
    debug.total_clientes_sem_vendedora = (semVend || []).filter(c => !c.vendedora_id).length;

    const idsParaAtualizar = (semVend || []).filter(c => !c.vendedora_id).map(c => c.id);

    debug.etapa = 'select_vendedoras';
    const vendedoraIds = [...new Set(idsParaAtualizar.map(id => dominantePorCliente.get(id)))];
    const { data: vends, error: errVd } = await supabase
      .from('lojas_vendedoras')
      .select('id, loja, nome')
      .in('id', vendedoraIds);

    if (errVd) return res.status(500).json({ debug, erro: 'select vendedoras', detail: errVd.message });

    const vendIdToLoja = new Map((vends || []).map(v => [v.id, v.loja]));
    const vendIdToNome = new Map((vends || []).map(v => [v.id, v.nome]));

    debug.etapa = 'update_loop';
    debug.total_para_atualizar = idsParaAtualizar.length;

    let atualizados = 0;
    let erros = [];
    let zeroRows = 0;

    const limite = parseInt(req.query.limite || '20');
    const testIds = idsParaAtualizar.slice(0, limite);

    for (const cid of testIds) {
      const vid = dominantePorCliente.get(cid);
      const loja = vendIdToLoja.get(vid);
      const { error, data } = await supabase
        .from('lojas_clientes')
        .update({
          vendedora_id: vid,
          loja_origem: loja,
          vendedor_a_definir: false,
          fonte_atribuicao: 'vendedora_dominante_historico',
          data_atribuicao: new Date().toISOString(),
        })
        .eq('id', cid)
        .is('vendedora_id', null)
        .select('id');

      if (error) {
        if (erros.length < 3) erros.push({ cid, vid, loja, msg: error.message });
      } else if (data && data.length > 0) {
        atualizados++;
      } else {
        zeroRows++;
      }
    }

    debug.atualizados = atualizados;
    debug.zero_rows_returned = zeroRows;
    debug.erros = erros;
    debug.amostra = testIds.slice(0, 3).map(cid => ({
      cliente_id: cid,
      vendedora: vendIdToNome.get(dominantePorCliente.get(cid)),
      loja: vendIdToLoja.get(dominantePorCliente.get(cid)),
    }));

    return res.status(200).json(debug);
  } catch (err) {
    return res.status(500).json({ debug, erro: err.message, stack: err.stack?.split('\n').slice(0, 8) });
  }
}
