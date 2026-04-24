/**
 * ml-perguntas-com-cor.js — Lista perguntas recentes que mencionam cor
 *                          junto com item_id pra testar o forecast
 *
 * Pega de ml_pending_questions as últimas 20 perguntas, identifica
 * quais mencionam cores não-cadastradas (candidatas ao fluxo de previsão)
 * e devolve com URL pronta pra testar /api/ml-stock-forecast.
 */
import { supabase, getStockColors, isColorRequest, detectColorsInText, detectSizeInText, setCors } from './_ml-helpers.js';

// Lista mais ampla de cores (incluindo as não-cadastradas) — pra detectar
// quando cliente menciona uma cor que NÃO está nas 7 carro-chefe
const TODAS_CORES = [
  'preto','preta','bege','figo','marrom','marron','azul marinho','marinho','vinho',
  'branco','branca','off white','off-white','natural','creme','nude',
  'azul','azul claro','azul bebê','azul bebe','azul royal','azul escuro',
  'verde','verde militar','verde oliva','verde menta','verde água','verde agua',
  'rosa','rose','pink','rosê','salmão','salmao','coral',
  'amarelo','mostarda','dourado',
  'vermelho','terracota','tijolo',
  'cinza','grafite','prata',
  'caramelo','cappuccino','chocolate','caqui','areia','marrom escuro',
  'lilás','lilas','roxo','lavanda',
];

function extrairCoresMencionadas(texto) {
  const lower = String(texto || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const encontradas = [];
  for (const c of TODAS_CORES) {
    const cn = c.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (lower.includes(cn) && !encontradas.includes(c)) encontradas.push(c);
  }
  return encontradas;
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const baseUrl = `https://${req.headers.host || 'app-financeiro-brown.vercel.app'}`;
  const stockColors = await getStockColors();
  const stockColorsNomes = stockColors.map(c => c.nome.toLowerCase());

  // Busca últimas 30 perguntas
  const { data: qs, error } = await supabase
    .from('ml_pending_questions')
    .select('question_id, brand, item_id, question_text, received_at, status')
    .order('received_at', { ascending: false })
    .limit(30);

  if (error) return res.status(500).json({ error: error.message });

  const resultado = [];
  for (const q of (qs || [])) {
    const texto = q.question_text || '';
    const coresMencionadas = extrairCoresMencionadas(texto);
    const tamanho = detectSizeInText(texto);

    // Cores que NÃO estão nas 7 carro-chefe (candidatas ao forecast)
    const coresNaoStock = coresMencionadas.filter(c => {
      // Normaliza pra comparar
      const cNorm = c.toLowerCase();
      // Está em stockColors se algum nome tem match direto
      return !stockColorsNomes.some(s => cNorm.includes(s) || s.includes(cNorm));
    });

    // Só inclui se há cor mencionada
    if (coresMencionadas.length === 0 && !tamanho) continue;

    const item = {
      brand: q.brand,
      item_id: q.item_id,
      pergunta: texto.length > 120 ? texto.slice(0, 117) + '...' : texto,
      received_at: q.received_at,
      status: q.status,
      cores_mencionadas: coresMencionadas,
      tamanho_mencionado: tamanho,
      cores_nao_cadastradas: coresNaoStock,
      candidata_forecast: coresNaoStock.length > 0,
    };

    // Gera URL de teste pra cada cor não-stock mencionada
    if (coresNaoStock.length > 0) {
      item.urls_teste = coresNaoStock.map(c => {
        const u = new URL(baseUrl + '/api/ml-stock-forecast');
        u.searchParams.set('item_id', q.item_id);
        u.searchParams.set('cor', c);
        if (tamanho) u.searchParams.set('tamanho', tamanho);
        return u.toString();
      });
    }

    resultado.push(item);
  }

  // Ordena: candidatas primeiro
  resultado.sort((a, b) => (b.candidata_forecast ? 1 : 0) - (a.candidata_forecast ? 1 : 0));

  return res.status(200).json({
    timestamp: new Date().toISOString(),
    total_analisadas: (qs || []).length,
    total_com_cor_ou_tamanho: resultado.length,
    candidatas_forecast: resultado.filter(r => r.candidata_forecast).length,
    resultados: resultado,
  });
}
