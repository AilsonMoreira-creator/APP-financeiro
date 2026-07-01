// ═══════════════════════════════════════════════════════════════════════════
// lojas-whats-vendeu-valores.js — Resolve o valor da venda dos cards em 'vendeu'
// que estao sem vendeu_valor, buscando no Mire pelos caminhos ja definidos:
//   documento (CPF/CNPJ) -> telefone (ultimos digitos) -> nome
// Em lojas_vendas (atacado) + lojas_vendas_varejo (varejo).
// Persiste vendeu_valor (+ vendeu_canal='match_mire' quando estava null).
//
// GET  -> executa e retorna { ok, resolvidos:[...], nao_encontrados:[...] }
// GET ?preview=1 -> so conta quantos estao sem valor, sem gravar
// ═══════════════════════════════════════════════════════════════════════════

import { supabase, setCors, log, logErro } from './_lojas-whats-helpers.js';

function tel10(t) {
  const d = (t || '').replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : d;
}

// documento -> telefone -> nome. Retorna { valor, numero_pedido, categoria, tipo_match } ou null
async function resolverVenda(conv) {
  const iniciaDate = (conv.iniciada_em || '').split('T')[0] || '2000-01-01';

  // 1. DOCUMENTO (CPF/CNPJ)
  if (conv.documento) {
    const docLimpo = conv.documento.replace(/\D/g, '');
    const docs = [docLimpo, conv.documento].filter(Boolean);

    const { data: atac } = await supabase.from('lojas_vendas')
      .select('numero_pedido, data_venda, valor_liquido')
      .in('documento_cliente_raw', docs)
      .gte('data_venda', iniciaDate)
      .order('data_venda', { ascending: true })
      .limit(1);
    if (atac?.length) return { valor: atac[0].valor_liquido, numero_pedido: atac[0].numero_pedido, categoria: 'atacado', tipo_match: 'documento' };

    const { data: vrj } = await supabase.from('lojas_vendas_varejo')
      .select('numero_pedido, data_venda, valor_liquido')
      .in('documento_raw', docs)
      .gte('data_venda', iniciaDate)
      .order('data_venda', { ascending: true })
      .limit(1);
    if (vrj?.length) return { valor: vrj[0].valor_liquido, numero_pedido: vrj[0].numero_pedido, categoria: 'varejo', tipo_match: 'documento' };
  }

  // 2. TELEFONE (compara ultimos 10 digitos)
  const alvo = tel10(conv.telefone);
  if (alvo && alvo.length >= 10) {
    const fim8 = alvo.slice(-8);
    const { data: atac } = await supabase.from('lojas_vendas')
      .select('numero_pedido, data_venda, valor_liquido, cliente_whatsapp_raw')
      .ilike('cliente_whatsapp_raw', `%${fim8}%`)
      .gte('data_venda', iniciaDate)
      .order('data_venda', { ascending: true })
      .limit(10);
    const mA = (atac || []).find(v => tel10(v.cliente_whatsapp_raw) === alvo);
    if (mA) return { valor: mA.valor_liquido, numero_pedido: mA.numero_pedido, categoria: 'atacado', tipo_match: 'telefone' };

    const { data: vrj } = await supabase.from('lojas_vendas_varejo')
      .select('numero_pedido, data_venda, valor_liquido, whatsapp_raw')
      .ilike('whatsapp_raw', `%${fim8}%`)
      .gte('data_venda', iniciaDate)
      .order('data_venda', { ascending: true })
      .limit(10);
    const mV = (vrj || []).find(v => tel10(v.whatsapp_raw) === alvo);
    if (mV) return { valor: mV.valor_liquido, numero_pedido: mV.numero_pedido, categoria: 'varejo', tipo_match: 'telefone' };
  }

  // 3. NOME (duas palavras mais significativas, >=3 letras)
  const partes = (conv.nome_cliente || '').toLowerCase().split(/\s+/).filter(p => p.length >= 3);
  if (partes.length) {
    const like = '%' + partes.slice(0, 2).join('%') + '%';
    const { data: atac } = await supabase.from('lojas_vendas')
      .select('numero_pedido, data_venda, valor_liquido')
      .ilike('cliente_razao_raw', like)
      .gte('data_venda', iniciaDate)
      .order('data_venda', { ascending: true })
      .limit(1);
    if (atac?.length) return { valor: atac[0].valor_liquido, numero_pedido: atac[0].numero_pedido, categoria: 'atacado', tipo_match: 'nome' };

    const { data: vrj } = await supabase.from('lojas_vendas_varejo')
      .select('numero_pedido, data_venda, valor_liquido')
      .ilike('cliente_raw', like)
      .gte('data_venda', iniciaDate)
      .order('data_venda', { ascending: true })
      .limit(1);
    if (vrj?.length) return { valor: vrj[0].valor_liquido, numero_pedido: vrj[0].numero_pedido, categoria: 'varejo', tipo_match: 'nome' };
  }

  return null;
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    const { data: pendentes, error } = await supabase
      .from('lojas_whats_conversas')
      .select('id, nome_cliente, telefone, documento, iniciada_em, vendeu_canal')
      .eq('etapa', 'vendeu')
      .is('vendeu_valor', null);
    if (error) throw error;

    if (req.query.preview === '1') {
      return res.status(200).json({ ok: true, preview: true, sem_valor: pendentes?.length || 0 });
    }

    const resolvidos = [];
    const nao_encontrados = [];

    for (const conv of (pendentes || [])) {
      try {
        const venda = await resolverVenda(conv);
        if (!venda || !(Number(venda.valor) > 0)) {
          nao_encontrados.push({ id: conv.id, nome: conv.nome_cliente });
          continue;
        }
        await supabase.from('lojas_whats_conversas').update({
          vendeu_valor: Number(venda.valor),
          vendeu_canal: conv.vendeu_canal || 'match_mire',
          atualizado_em: new Date().toISOString(),
        }).eq('id', conv.id);
        resolvidos.push({ id: conv.id, nome: conv.nome_cliente, valor: Number(venda.valor), tipo_match: venda.tipo_match });
      } catch (e) {
        logErro('vendeu-valores/conv', e);
        nao_encontrados.push({ id: conv.id, nome: conv.nome_cliente, erro: true });
      }
    }

    log('vendeu-valores', `resolvidos=${resolvidos.length} nao_encontrados=${nao_encontrados.length}`);
    return res.status(200).json({ ok: true, resolvidos, nao_encontrados });
  } catch (e) {
    logErro('vendeu-valores', e);
    return res.status(500).json({ error: e.message });
  }
}
