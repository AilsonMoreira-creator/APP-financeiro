/**
 * ml-stock-forecast.js — Previsão de chegada baseada em ordens_corte
 *
 * Quando cliente pergunta sobre cor NÃO cadastrada nas 7 carro-chefe,
 * busca em ordens_corte se há produção ativa daquela cor pra aquela REF.
 *
 * Lógica:
 *   - Pega item_id do anúncio ML
 *   - Extrai REF via seller_custom_field (mesmo método do ml-estoque-cron)
 *   - Busca em ordens_corte: REF + cor + status != concluido/cancelado
 *   - Calcula dias decorridos vs prazo médio (22 dias)
 *   - Retorna previsão formatada
 *
 * Uso (FASE 1 - teste):
 *   GET /api/ml-stock-forecast?item_id=MLB6302508314&cor=branco&tamanho=M
 *
 * Retorna:
 *   {
 *     ref, cor_buscada, encontrou,
 *     ordens_em_producao: [...],
 *     previsao: { dias_decorridos, dias_restantes, faixa, mensagem_sugerida }
 *   }
 */
import { supabase, getValidToken, BRANDS, setCors } from './_ml-helpers.js';

const ML_API = 'https://api.mercadolibre.com';
const PRAZO_MEDIO_DIAS = 22;

// Mesma lógica do ml-estoque-cron.js linha 177
function extractRefFromCustomField(scf) {
  if (!scf) return null;
  const scfTrim = String(scf).trim();
  const m = scfTrim.match(/\(\s*(?:ref\s*)?(\d{3,5})\s*\)/i);
  if (m) return String(parseInt(m[1], 10)).padStart(5, '0');
  const m2 = scfTrim.match(/^\s*0*(\d{3,5})\s*$/);
  if (m2) return String(parseInt(m2[1], 10)).padStart(5, '0');
  return null;
}

// Normaliza string pra comparar cores (sem acento, lowercase)
function normCor(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

// Verifica se uma cor (do cliente) bate com alguma cor da ordem
// Ex: cliente "branco" bate com "Branco Off", "off white", etc se contiver
function corMatch(corCliente, coresOrdem) {
  const norm = normCor(corCliente);
  if (!norm) return null;
  for (const c of (coresOrdem || [])) {
    const nomeOrdem = normCor(c.nome);
    if (nomeOrdem === norm || nomeOrdem.includes(norm) || norm.includes(nomeOrdem)) {
      return c;
    }
  }
  return null;
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const itemId = String(req.query.item_id || '').trim();
  const cor = String(req.query.cor || '').trim();
  const tamanho = String(req.query.tamanho || '').trim();

  if (!itemId || !cor) {
    return res.status(400).json({
      error: 'item_id e cor são obrigatórios',
      uso: '/api/ml-stock-forecast?item_id=MLB6302508314&cor=branco&tamanho=M',
    });
  }

  const out = {
    timestamp: new Date().toISOString(),
    input: { item_id: itemId, cor, tamanho: tamanho || null },
  };

  // ── 1. Pega item do ML pra extrair REF ──
  // Tenta nas 3 marcas até funcionar (item pertence a uma das 3)
  let itemData = null;
  let usedBrand = null;
  for (const brand of BRANDS) {
    try {
      const token = await getValidToken(brand);
      const r = await fetch(
        `${ML_API}/items/${itemId}?attributes=id,title,seller_id,seller_custom_field,variations`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (r.ok) {
        itemData = await r.json();
        usedBrand = brand;
        break;
      }
    } catch (e) {}
  }

  if (!itemData) {
    out.error = 'Item não encontrado nas 3 contas ML';
    return res.status(404).json(out);
  }

  out.item = {
    title: itemData.title,
    seller_custom_field: itemData.seller_custom_field || null,
    brand_match: usedBrand,
  };

  // ── 2. Extrai REF ──
  let ref = extractRefFromCustomField(itemData.seller_custom_field);

  // Fallback: tenta pegar REF via SKU das variations + ml_sku_ref_map
  if (!ref) {
    const variations = itemData.variations || [];
    for (const v of variations) {
      const sku = v.seller_custom_field || (v.attributes || []).find(a => a.id === 'SELLER_SKU')?.value_name;
      if (!sku) continue;
      const { data: refRow } = await supabase
        .from('ml_sku_ref_map')
        .select('ref')
        .eq('sku', sku)
        .maybeSingle();
      if (refRow?.ref) { ref = refRow.ref; break; }
    }
  }

  out.ref_extraida = ref;

  if (!ref) {
    out.error = 'Não conseguiu extrair REF do anúncio (sem seller_custom_field e SKU não mapeado)';
    return res.status(200).json(out);
  }

  // ── 3. Busca ordens_corte ativas com essa REF nos últimos 30 dias ──
  const desde = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: ordens, error: ordErr } = await supabase
    .from('ordens_corte')
    .select('id, ref, cores, grade, status, created_at, origem')
    .eq('ref', ref)
    .not('status', 'in', '(concluido,cancelado)')
    .gte('created_at', desde)
    .order('created_at', { ascending: false });

  if (ordErr) {
    out.error = 'Erro consulta ordens_corte: ' + ordErr.message;
    return res.status(500).json(out);
  }

  out.ordens_ativas_total = (ordens || []).length;

  // ── 4. Filtra por cor (case-insensitive, partial match) ──
  const ordensComCor = [];
  for (const o of (ordens || [])) {
    const corMatched = corMatch(cor, o.cores);
    if (corMatched) {
      ordensComCor.push({
        id: o.id,
        ref: o.ref,
        status: o.status,
        created_at: o.created_at,
        origem: o.origem,
        cor_matched: corMatched,
        grade: o.grade,
        // Verifica se o tamanho perguntado está na grade
        tem_tamanho: tamanho ? Object.keys(o.grade || {}).includes(tamanho.toUpperCase()) : null,
      });
    }
  }

  out.ordens_em_producao = ordensComCor;
  out.encontrou = ordensComCor.length > 0;

  // ── 5. Calcula previsão (usa a ordem mais recente) ──
  if (ordensComCor.length > 0) {
    const maisRecente = ordensComCor[0]; // já ordenado desc
    const diasDecorridos = Math.floor((Date.now() - new Date(maisRecente.created_at).getTime()) / 86400000);
    const diasRestantes = PRAZO_MEDIO_DIAS - diasDecorridos;

    let faixa, mensagem;
    if (diasRestantes <= 0) {
      faixa = 'ATRASADO';
      mensagem = null; // deixa IA Claude responder, não promete prazo
    } else if (diasRestantes <= 7) {
      faixa = 'ATE_7_DIAS';
      mensagem = `Olá! Boa notícia: este modelo na cor ${maisRecente.cor_matched.nome} está em fase final de produção e a previsão é chegar nos próximos dias (até 7 dias). Fique de olho no anúncio que atualizamos assim que estiver disponível! Agradecemos seu contato!`;
    } else {
      faixa = 'PROXIMAS_SEMANAS';
      mensagem = `Olá! Este modelo na cor ${maisRecente.cor_matched.nome} está em produção e deve chegar nas próximas semanas. Fique de olho no anúncio que atualizamos assim que estiver disponível! Agradecemos seu contato!`;
    }

    out.previsao = {
      ordem_referencia_id: maisRecente.id,
      created_at: maisRecente.created_at,
      dias_decorridos: diasDecorridos,
      dias_restantes_estimados: diasRestantes,
      prazo_medio_total: PRAZO_MEDIO_DIAS,
      faixa,
      mensagem_sugerida: mensagem,
    };
  }

  return res.status(200).json(out);
}
