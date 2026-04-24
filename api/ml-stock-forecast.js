/**
 * ml-stock-forecast.js — Previsão de chegada baseada em ailson_cortes
 *                        (módulo Oficinas Cortes — fonte 100% real)
 *
 * REGRA AILSON 22/04 (já documentada em 14_fase8_cortes_oficinas.sql):
 *   "Sempre usar do módulo oficina cortes (com ou sem granularidade)"
 *
 * Lógica:
 *   - Pega item_id do anúncio ML
 *   - Extrai REF via seller_custom_field
 *   - Busca em amicia_data user_id='ailson_cortes' → payload.cortes[]
 *   - Filtra: ref=X, entregue=false, data dentro da janela (30 dias)
 *   - Se corte tem detalhes.cores: bate por nome (case-insensitive, partial)
 *   - Se corte SEM detalhes (sem matriz): considera "qualquer cor" — não
 *     dá pra confirmar que aquela cor específica está nele (confiança baixa)
 *   - Calcula 22 dias a partir do campo `data` do corte
 *
 * Uso:
 *   GET /api/ml-stock-forecast?item_id=MLB6302508314&cor=branco&tamanho=M
 */
import { supabase, getValidToken, BRANDS, setCors } from './_ml-helpers.js';

const ML_API = 'https://api.mercadolibre.com';
const PRAZO_MEDIO_DIAS = 22;
const JANELA_BUSCA_DIAS = 30;

function extractRefFromCustomField(scf) {
  if (!scf) return null;
  const scfTrim = String(scf).trim();
  const m = scfTrim.match(/\(\s*(?:ref\s*)?(\d{3,5})\s*\)/i);
  if (m) return String(parseInt(m[1], 10)).padStart(5, '0');
  const m2 = scfTrim.match(/^\s*0*(\d{3,5})\s*$/);
  if (m2) return String(parseInt(m2[1], 10)).padStart(5, '0');
  return null;
}

function normCor(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

function corMatch(corCliente, coresArray) {
  const norm = normCor(corCliente);
  if (!norm) return null;
  for (const c of (coresArray || [])) {
    const nomeOrdem = normCor(c.nome);
    if (!nomeOrdem) continue;
    if (nomeOrdem === norm || nomeOrdem.includes(norm) || norm.includes(nomeOrdem)) {
      return c;
    }
  }
  return null;
}

function refMatch(refA, refB) {
  if (!refA || !refB) return false;
  const a = String(refA).replace(/^0+/, '').trim();
  const b = String(refB).replace(/^0+/, '').trim();
  return a === b;
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

  // ── 1. Pega item do ML ──
  let itemData = null;
  let usedBrand = null;
  for (const brand of BRANDS) {
    try {
      const token = await getValidToken(brand);
      const r = await fetch(
        `${ML_API}/items/${itemId}?attributes=id,title,seller_custom_field,variations`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (r.ok) { itemData = await r.json(); usedBrand = brand; break; }
    } catch {}
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

  // ── 2. Extrai REF: 1) ml_scf_ref_map, 2) regex, 3) sku via variations ──
  let ref = null;
  let refOrigem = null;
  const scfTrim = String(itemData.seller_custom_field || '').trim();

  if (scfTrim) {
    const { data: scfRow } = await supabase
      .from('ml_scf_ref_map').select('ref').eq('scf', scfTrim).maybeSingle();
    if (scfRow?.ref) {
      ref = String(scfRow.ref).replace(/^0+/, '').padStart(5, '0');
      refOrigem = 'scf_map';
    }
  }

  if (!ref) {
    ref = extractRefFromCustomField(itemData.seller_custom_field);
    if (ref) refOrigem = 'regex';
  }

  if (!ref) {
    const variations = itemData.variations || [];
    for (const v of variations) {
      const sku = v.seller_custom_field || (v.attributes || []).find(a => a.id === 'SELLER_SKU')?.value_name;
      if (!sku) continue;
      const { data: refRow } = await supabase
        .from('ml_sku_ref_map').select('ref').eq('sku', sku).maybeSingle();
      if (refRow?.ref) { ref = refRow.ref; refOrigem = 'sku_map'; break; }
    }
  }

  out.ref_extraida = ref;
  out.ref_origem = refOrigem;
  if (!ref) {
    out.error = 'Não conseguiu extrair REF do anúncio (scf/sku não mapeados)';
    return res.status(200).json(out);
  }

  // ── 3. Busca payload ailson_cortes ──
  const { data: row, error: payErr } = await supabase
    .from('amicia_data').select('payload').eq('user_id', 'ailson_cortes').maybeSingle();

  if (payErr || !row?.payload) {
    out.error = 'Payload ailson_cortes vazio: ' + (payErr?.message || 'sem dados');
    return res.status(500).json(out);
  }

  const todosCortes = row.payload.cortes || [];
  out.total_cortes_no_payload = todosCortes.length;

  // ── 4. Filtra cortes ativos da REF ──
  const desdeMs = Date.now() - JANELA_BUSCA_DIAS * 86400000;
  const cortesAtivos = todosCortes.filter(c => {
    if (!c || c.entregue) return false;
    if (!refMatch(c.ref, ref)) return false;
    const dataCorte = new Date(c.data).getTime();
    if (isNaN(dataCorte) || dataCorte < desdeMs) return false;
    return true;
  }).sort((a, b) => new Date(b.data) - new Date(a.data));

  out.cortes_ativos_da_ref = cortesAtivos.length;

  // ── 5. Filtra por cor ──
  const candidatos = [];
  let semMatrizCount = 0;

  for (const c of cortesAtivos) {
    const detalhes = c.detalhes;
    const temMatriz = detalhes && Array.isArray(detalhes.cores) && detalhes.cores.length > 0;

    if (!temMatriz) {
      semMatrizCount++;
      candidatos.push({
        id: c.id,
        nCorte: c.nCorte,
        ref: c.ref,
        descricao: c.descricao,
        oficina: c.oficina,
        data: c.data,
        qtd: c.qtd,
        qtdEntregue: c.qtdEntregue,
        cor_match: null,
        confianca: 'baixa',
        nota: 'corte sem matriz preenchida — não dá pra confirmar se essa cor está nele',
      });
      continue;
    }

    const corMatched = corMatch(cor, detalhes.cores);
    if (!corMatched) continue;

    let temTamanho = null;
    if (tamanho && Array.isArray(detalhes.tamanhos)) {
      const tamUpper = tamanho.toUpperCase();
      temTamanho = detalhes.tamanhos.some(t => String(t.tam).toUpperCase() === tamUpper && (t.grade || 0) > 0);
    }

    candidatos.push({
      id: c.id,
      nCorte: c.nCorte,
      ref: c.ref,
      descricao: c.descricao,
      oficina: c.oficina,
      data: c.data,
      qtd: c.qtd,
      qtdEntregue: c.qtdEntregue,
      cor_match: corMatched,
      tem_tamanho: temTamanho,
      confianca: 'alta',
    });
  }

  out.cortes_sem_matriz_total = semMatrizCount;
  out.candidatos = candidatos;

  // ── 6. Decide previsão ──
  const altaConfianca = candidatos.filter(c => c.confianca === 'alta');
  const baixaConfianca = candidatos.filter(c => c.confianca === 'baixa');
  const escolhido = altaConfianca[0] || baixaConfianca[0] || null;

  out.encontrou = !!escolhido;

  if (escolhido) {
    const diasDecorridos = Math.floor((Date.now() - new Date(escolhido.data).getTime()) / 86400000);
    const diasRestantes = PRAZO_MEDIO_DIAS - diasDecorridos;

    let faixa, mensagem;
    if (diasRestantes <= 0) {
      faixa = 'ATRASADO';
      mensagem = null;
    } else if (diasRestantes <= 7) {
      faixa = 'ATE_7_DIAS';
      const corNome = escolhido.cor_match?.nome || cor;
      mensagem = `Olá! Boa notícia: este modelo na cor ${corNome} está em fase final de produção e a previsão é chegar nos próximos dias (até 7 dias). Fique de olho no anúncio que atualizamos assim que estiver disponível! Agradecemos seu contato!`;
    } else {
      faixa = 'PROXIMAS_SEMANAS';
      const corNome = escolhido.cor_match?.nome || cor;
      mensagem = `Olá! Este modelo na cor ${corNome} está em produção e deve chegar nas próximas semanas. Fique de olho no anúncio que atualizamos assim que estiver disponível! Agradecemos seu contato!`;
    }

    out.previsao = {
      corte_referencia_id: escolhido.id,
      data_corte: escolhido.data,
      dias_decorridos: diasDecorridos,
      dias_restantes_estimados: diasRestantes,
      prazo_medio_total: PRAZO_MEDIO_DIAS,
      faixa,
      confianca: escolhido.confianca,
      mensagem_sugerida: mensagem,
    };
  }

  return res.status(200).json(out);
}
