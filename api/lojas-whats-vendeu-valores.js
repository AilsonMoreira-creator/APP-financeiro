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


// Venda do SITE nao tem vendedora humana (Mire marca "CONVERTR").
// Ailson 23/07/2026: toda venda casada carrega a vendedora; site vira flag.
function comVendedora(v, extra) {
  const site = /convertr/i.test(String(v.vendedora_nome_raw || ''));
  return { valor: v.valor_liquido, numero_pedido: v.numero_pedido, vendedora_id: v.vendedora_id || null, vendedora_site: site, ...extra };
}

// documento -> telefone -> nome. Retorna { valor, numero_pedido, categoria, tipo_match } ou null
async function resolverVenda(conv) {
  const iniciaDate = (conv.iniciada_em || '').split('T')[0] || '2000-01-01';

  // 1. DOCUMENTO (CPF/CNPJ)
  if (conv.documento) {
    const docLimpo = conv.documento.replace(/\D/g, '');
    const docs = [docLimpo, conv.documento].filter(Boolean);

    const { data: atac } = await supabase.from('lojas_vendas')
      .select('numero_pedido, data_venda, valor_liquido, vendedora_id, vendedora_nome_raw')
      .in('documento_cliente_raw', docs)
      .gte('data_venda', iniciaDate)
      .order('data_venda', { ascending: true })
      .limit(1);
    if (atac?.length) return comVendedora(atac[0], { categoria: 'atacado', tipo_match: 'documento' });

    const { data: vrj } = await supabase.from('lojas_vendas_varejo')
      .select('numero_pedido, data_venda, valor_liquido, vendedora_id, vendedora_nome_raw')
      .in('documento_raw', docs)
      .gte('data_venda', iniciaDate)
      .order('data_venda', { ascending: true })
      .limit(1);
    if (vrj?.length) return comVendedora(vrj[0], { categoria: 'varejo', tipo_match: 'documento' });
  }

  // 2. TELEFONE (compara ultimos 10 digitos)
  const alvo = tel10(conv.telefone);
  if (alvo && alvo.length >= 10) {
    const fim8 = alvo.slice(-8);
    const { data: atac } = await supabase.from('lojas_vendas')
      .select('numero_pedido, data_venda, valor_liquido, cliente_whatsapp_raw, vendedora_id, vendedora_nome_raw')
      .ilike('cliente_whatsapp_raw', `%${fim8}%`)
      .gte('data_venda', iniciaDate)
      .order('data_venda', { ascending: true })
      .limit(10);
    const mA = (atac || []).find(v => tel10(v.cliente_whatsapp_raw) === alvo);
    if (mA) return comVendedora(mA, { categoria: 'atacado', tipo_match: 'telefone' });

    const { data: vrj } = await supabase.from('lojas_vendas_varejo')
      .select('numero_pedido, data_venda, valor_liquido, whatsapp_raw, vendedora_id, vendedora_nome_raw')
      .ilike('whatsapp_raw', `%${fim8}%`)
      .gte('data_venda', iniciaDate)
      .order('data_venda', { ascending: true })
      .limit(10);
    const mV = (vrj || []).find(v => tel10(v.whatsapp_raw) === alvo);
    if (mV) return comVendedora(mV, { categoria: 'varejo', tipo_match: 'telefone' });
  }

  // 3. NOME (duas palavras mais significativas, >=3 letras)
  const partes = (conv.nome_cliente || '').toLowerCase().split(/\s+/).filter(p => p.length >= 3);
  if (partes.length) {
    const like = '%' + partes.slice(0, 2).join('%') + '%';
    const { data: atac } = await supabase.from('lojas_vendas')
      .select('numero_pedido, data_venda, valor_liquido, vendedora_id, vendedora_nome_raw')
      .ilike('cliente_razao_raw', like)
      .gte('data_venda', iniciaDate)
      .order('data_venda', { ascending: true })
      .limit(1);
    if (atac?.length) return comVendedora(atac[0], { categoria: 'atacado', tipo_match: 'nome' });

    const { data: vrj } = await supabase.from('lojas_vendas_varejo')
      .select('numero_pedido, data_venda, valor_liquido, vendedora_id, vendedora_nome_raw')
      .ilike('cliente_raw', like)
      .gte('data_venda', iniciaDate)
      .order('data_venda', { ascending: true })
      .limit(1);
    if (vrj?.length) return comVendedora(vrj[0], { categoria: 'varejo', tipo_match: 'nome' });
  }

  return null;
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    // Sem valor OU (com valor mas sem vendedora e sem flag de site):
    // Ailson 23/07/2026 — toda venda casada tem que carregar a vendedora.
    const { data: pendentes, error } = await supabase
      .from('lojas_whats_conversas')
      .select('id, nome_cliente, telefone, documento, iniciada_em, vendeu_canal, vendeu_valor, vendedora_atribuida_id, vendeu_site')
      .eq('etapa', 'vendeu')
      .or('vendeu_valor.is.null,and(vendedora_atribuida_id.is.null,vendeu_site.is.null)');
    if (error) throw error;

    if (req.query.preview === '1') {
      return res.status(200).json({ ok: true, preview: true, pendentes: pendentes?.length || 0 });
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
        // Se a conversa JA tem valor, so aceita a vendedora se a venda achada
        // for a MESMA (valor bate) — evita carimbar vendedora de outra compra.
        const jaTemValor = Number(conv.vendeu_valor) > 0;
        if (jaTemValor && Math.abs(Number(venda.valor) - Number(conv.vendeu_valor)) > 0.01) {
          nao_encontrados.push({ id: conv.id, nome: conv.nome_cliente, motivo: 'valor difere' });
          continue;
        }
        const patch = { atualizado_em: new Date().toISOString() };
        if (!jaTemValor) {
          patch.vendeu_valor = Number(venda.valor);
          patch.vendeu_canal = conv.vendeu_canal || 'match_mire';
        }
        if (!conv.vendedora_atribuida_id && venda.vendedora_id) patch.vendedora_atribuida_id = venda.vendedora_id;
        patch.vendeu_site = !!venda.vendedora_site;
        await supabase.from('lojas_whats_conversas').update(patch).eq('id', conv.id);
        resolvidos.push({ id: conv.id, nome: conv.nome_cliente, valor: Number(venda.valor), tipo_match: venda.tipo_match, vendedora_id: venda.vendedora_id || null, site: !!venda.vendedora_site });
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
