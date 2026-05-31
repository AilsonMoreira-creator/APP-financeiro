// ═══════════════════════════════════════════════════════════════════════════
// lojas-whats-cron-capi-match.js — Cruza Mire x Sofia e dispara CAPI
// ═══════════════════════════════════════════════════════════════════════════
//
// Sprint Attribution Sofia (Ailson 25/05/2026).
// Roda 1x/dia (sugestao: 03h BRT — depois do import diario do Drive).
//
// Logica:
//   1. Lista conversas Sofia origem='anuncio_instagram' OR origem='carrinho_site_amicialoja'
//      AND capi_purchase_enviado=false
//      AND etapa IN ('quente','atendida','vendeu','conversando','follow_up')
//      AND iniciada_em >= 60 dias atras (janela de attribution Meta)
//   2. Pra cada uma, busca venda Mire correspondente:
//      a) PRIMARY: por documento (CPF/CNPJ) se Sofia tiver capturado
//      b) FALLBACK: por telefone normalizado
//      Em ambas tabelas: lojas_vendas (atacado) + lojas_vendas_varejo
//   3. Se achou venda com data_venda >= conversa.iniciada_em::date:
//      - Chama dispararPurchase
//      - Marca conversa em etapa='vendeu' (se ainda nao tava)
//
// GET ?executar=1 = executa | GET sem param = preview
// ═══════════════════════════════════════════════════════════════════════════

import { supabase, setCors, log, logErro } from './_lojas-whats-helpers.js';
import { dispararPurchase } from './lojas-whats-meta-capi-purchase.js';

const JANELA_ATTRIBUTION_DIAS = 60;
const MAX_POR_RODADA = 200;

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method === 'GET') {
    if (req.query.executar === '1' || req.headers['user-agent']?.includes('vercel-cron')) {
      try {
        const r = await executar();
        return res.status(200).json({ ok: true, ...r });
      } catch (e) {
        logErro('cron-capi-match', e);
        return res.status(500).json({ error: e.message });
      }
    }
    return await preview(req, res);
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  try {
    const r = await executar();
    return res.status(200).json({ ok: true, ...r });
  } catch (e) {
    logErro('cron-capi-match', e);
    return res.status(500).json({ error: e.message });
  }
}

async function preview(req, res) {
  const cutoff = new Date(Date.now() - JANELA_ATTRIBUTION_DIAS * 86400000).toISOString();
  const { count: candidatas } = await supabase
    .from('lojas_whats_conversas')
    .select('*', { count: 'exact', head: true })
    .in('origem_lead', ['anuncio_instagram', 'carrinho_site_amicialoja'])
    .eq('capi_purchase_enviado', false)
    .gte('iniciada_em', cutoff);
  return res.status(200).json({ preview: true, conversas_candidatas: candidatas || 0, janela_dias: JANELA_ATTRIBUTION_DIAS });
}

async function executar() {
  const inicio = Date.now();
  const cutoff = new Date(Date.now() - JANELA_ATTRIBUTION_DIAS * 86400000).toISOString();

  // 1. Conversas elegiveis pra match
  const { data: conversas, error } = await supabase
    .from('lojas_whats_conversas')
    .select('id, telefone, documento, tipo_documento, iniciada_em, origem_lead, ctwa_clid, etapa, nome_cliente')
    .in('origem_lead', ['anuncio_instagram', 'carrinho_site_amicialoja'])
    .eq('capi_purchase_enviado', false)
    .gte('iniciada_em', cutoff)
    .order('iniciada_em', { ascending: false })
    .limit(MAX_POR_RODADA);
  if (error) throw error;

  log('cron-capi-match', `${conversas?.length || 0} conversas candidatas pra match`);

  const stats = {
    avaliadas: 0,
    sem_venda: 0,
    com_match: 0,
    capi_enviado_ok: 0,
    capi_falhou: 0,
    pre_iniciada_em: 0,  // venda achada mas anterior a iniciada_em
    erros: 0,
  };

  for (const conv of (conversas || [])) {
    stats.avaliadas++;
    try {
      const match = await buscarVendaParaConversa(conv);
      if (!match) {
        stats.sem_venda++;
        continue;
      }
      // Venda anterior a iniciada_em? Nao conta (cliente ja comprava antes)
      if (new Date(match.data_venda) < new Date(conv.iniciada_em.split('T')[0])) {
        stats.pre_iniciada_em++;
        continue;
      }
      stats.com_match++;

      const resultado = await dispararPurchase({
        conversa_id: conv.id,
        venda_info: {
          valor: Number(match.valor_liquido),
          numero_pedido: match.numero_pedido,
          venda_id: match.venda_id,
          categoria: match.categoria,
        },
        tipo_match: match.tipo_match,
      });

      if (resultado.status === 'enviado') {
        stats.capi_enviado_ok++;
        // Marca conversa como 'vendeu' se ainda nao tava
        if (conv.etapa !== 'vendeu' && conv.etapa !== 'feedback' && conv.etapa !== 'inativo') {
          await supabase.from('lojas_whats_conversas').update({
            etapa: 'vendeu',
            vendeu_em: new Date().toISOString(),
            atualizado_em: new Date().toISOString(),
          }).eq('id', conv.id);
        }
      } else if (resultado.status === 'duplicado') {
        // ja tinha sido enviado — nao conta como sucesso novo nem como falha
      } else {
        stats.capi_falhou++;
      }
    } catch (e) {
      logErro('cron-capi-match/conv', e);
      stats.erros++;
    }
  }

  stats.duracao_ms = Date.now() - inicio;
  log('cron-capi-match', `done ${JSON.stringify(stats)}`);
  return stats;
}

// ─── BUSCA VENDA NO MIRE PARA UMA CONVERSA ────────────────────────────────
async function buscarVendaParaConversa(conv) {
  const iniciaDate = conv.iniciada_em.split('T')[0];

  // 1. PRIMARY — match por documento (CPF/CNPJ) se Sofia tem
  if (conv.documento) {
    const docLimpo = conv.documento.replace(/\D/g, '');

    const { data: atac } = await supabase.from('lojas_vendas')
      .select('id, numero_pedido, data_venda, valor_liquido')
      .or(`documento_cliente_raw.eq.${docLimpo},documento_cliente_raw.eq.${conv.documento}`)
      .gte('data_venda', iniciaDate)
      .order('data_venda', { ascending: true })
      .limit(1);
    if (atac?.length) {
      return {
        venda_id: atac[0].id,
        numero_pedido: atac[0].numero_pedido,
        data_venda: atac[0].data_venda,
        valor_liquido: atac[0].valor_liquido,
        categoria: 'atacado',
        tipo_match: 'documento',
      };
    }

    const { data: varejo } = await supabase.from('lojas_vendas_varejo')
      .select('id, numero_pedido, data_venda, valor_liquido')
      .or(`documento_raw.eq.${docLimpo},documento_raw.eq.${conv.documento}`)
      .gte('data_venda', iniciaDate)
      .order('data_venda', { ascending: true })
      .limit(1);
    if (varejo?.length) {
      return {
        venda_id: varejo[0].id,
        numero_pedido: varejo[0].numero_pedido,
        data_venda: varejo[0].data_venda,
        valor_liquido: varejo[0].valor_liquido,
        categoria: 'varejo',
        tipo_match: 'documento',
      };
    }
  }

  // 2. FALLBACK — match por telefone normalizado
  // Usa RPC pq a funcao SQL normalizar_telefone_br nao funciona em filtros do JS client
  // Vou usar query raw via rpc
  const { data: telMatch, error } = await supabase.rpc('match_venda_por_telefone', {
    tel_sofia: conv.telefone,
    data_min: iniciaDate,
  });
  if (error) {
    // Funcao SQL nao existe ainda — fallback manual
    log('cron-capi-match', 'rpc match_venda_por_telefone nao existe, usando fallback raw');
    return await buscarVendaPorTelefoneFallback(conv.telefone, iniciaDate);
  }
  if (telMatch && telMatch.length) {
    const m = telMatch[0];
    return {
      venda_id: m.venda_id,
      numero_pedido: m.numero_pedido,
      data_venda: m.data_venda,
      valor_liquido: m.valor_liquido,
      categoria: m.categoria,
      tipo_match: 'telefone',
    };
  }
  return null;
}

// Fallback puro JS quando rpc nao existe (deveria existir, mas seguranca)
async function buscarVendaPorTelefoneFallback(telefone, iniciaDate) {
  const digits = (telefone || '').replace(/\D/g, '');
  const telNorm = digits.length >= 11 ? digits.slice(-11) : digits;
  if (!telNorm || telNorm.length < 10) return null;

  // Busca em ambas tabelas vendo se LIKE bate
  const { data: atac } = await supabase.from('lojas_vendas')
    .select('id, numero_pedido, data_venda, valor_liquido, cliente_whatsapp_raw')
    .ilike('cliente_whatsapp_raw', `%${telNorm}%`)
    .gte('data_venda', iniciaDate)
    .order('data_venda', { ascending: true })
    .limit(5);
  for (const v of (atac || [])) {
    if ((v.cliente_whatsapp_raw || '').replace(/\D/g, '').slice(-11) === telNorm) {
      return {
        venda_id: v.id, numero_pedido: v.numero_pedido,
        data_venda: v.data_venda, valor_liquido: v.valor_liquido,
        categoria: 'atacado', tipo_match: 'telefone',
      };
    }
  }
  const { data: vrj } = await supabase.from('lojas_vendas_varejo')
    .select('id, numero_pedido, data_venda, valor_liquido, whatsapp_raw')
    .ilike('whatsapp_raw', `%${telNorm}%`)
    .gte('data_venda', iniciaDate)
    .order('data_venda', { ascending: true })
    .limit(5);
  for (const v of (vrj || [])) {
    if ((v.whatsapp_raw || '').replace(/\D/g, '').slice(-11) === telNorm) {
      return {
        venda_id: v.id, numero_pedido: v.numero_pedido,
        data_venda: v.data_venda, valor_liquido: v.valor_liquido,
        categoria: 'varejo', tipo_match: 'telefone',
      };
    }
  }
  return null;
}
