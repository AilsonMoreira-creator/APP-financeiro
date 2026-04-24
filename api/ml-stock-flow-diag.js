/**
 * ml-stock-flow-diag.js — Diagnóstico do fluxo de oferta de cor/estoque
 *
 * Mostra:
 *  - Cores carro-chefe configuradas
 *  - Histórico de stock_offers (oferecidas, confirmadas, recusadas)
 *  - Histórico de stock_alerts (clientes que confirmaram interesse)
 *  - Últimas perguntas que MENCIONAM cor (pra ver se IA pegou ou não)
 */
import { supabase, getStockColors, isColorRequest, detectColorsInText, detectSizeInText, setCors } from './_ml-helpers.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const desde = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const out = { timestamp: new Date().toISOString(), janela: '30 dias' };

  // 1. Cores configuradas
  try {
    const cores = await getStockColors();
    out.cores_configuradas = cores;
  } catch (e) { out.cores_configuradas = { ERRO: e.message }; }

  // 2. Histórico de ofertas (ml_stock_offers)
  try {
    const { data: offers } = await supabase
      .from('ml_stock_offers')
      .select('*')
      .gte('created_at', desde)
      .order('created_at', { ascending: false })
      .limit(30);

    const lista = offers || [];
    out.ofertas = {
      total: lista.length,
      por_status: lista.reduce((acc, o) => { acc[o.status] = (acc[o.status] || 0) + 1; return acc; }, {}),
      ultimas_5: lista.slice(0, 5).map(o => ({
        criada: o.created_at,
        status: o.status,
        brand: o.brand,
        cores: o.cores,
        tamanho: o.tamanho,
        item_id: o.item_id,
      })),
    };
  } catch (e) { out.ofertas = { ERRO: e.message }; }

  // 3. Alertas confirmados (ml_stock_alerts) — produto quente pra repor
  try {
    const { data: alerts } = await supabase
      .from('ml_stock_alerts')
      .select('*')
      .gte('promised_at', desde)
      .order('promised_at', { ascending: false })
      .limit(20);

    out.alertas_confirmados = {
      total: (alerts || []).length,
      por_status: (alerts || []).reduce((acc, a) => { acc[a.status] = (acc[a.status] || 0) + 1; return acc; }, {}),
      ultimas_5: (alerts || []).slice(0, 5).map(a => ({
        promised_at: a.promised_at,
        status: a.status,
        brand: a.brand,
        item_title: a.item_title?.slice(0, 50),
        question_text: a.question_text?.slice(0, 80),
        detail: a.detail?.slice(0, 100),
      })),
    };
  } catch (e) { out.alertas_confirmados = { ERRO: e.message }; }

  // 4. AUDITORIA: últimas 30 perguntas — testar se TERIAM disparado fluxo de cor
  try {
    const stockColors = await getStockColors();
    const { data: qs } = await supabase
      .from('ml_pending_questions')
      .select('question_id, brand, item_id, question_text, received_at, status')
      .gte('received_at', desde)
      .order('received_at', { ascending: false })
      .limit(50);

    const auditoria = (qs || []).map(q => {
      const text = q.question_text || '';
      const ehColor = isColorRequest(text);
      const cores = detectColorsInText(text, stockColors);
      const tam = detectSizeInText(text);
      let cenario = 'IA_NORMAL';
      if (ehColor && cores.length > 0) cenario = 'FLUXO_A (cor + oferta automatica)';
      else if (ehColor && tam) cenario = 'FLUXO_B (so tamanho, perguntar cor)';
      else if (ehColor) cenario = 'COLOR_REQUEST_NAO_CADASTRADA (deixa IA responder)';

      return {
        question_id: q.question_id,
        brand: q.brand,
        text_preview: text.slice(0, 100),
        received_at: q.received_at,
        status: q.status,
        detectado: { eh_color_request: ehColor, cores_match: cores.map(c => c.nome), tamanho_match: tam },
        cenario_esperado: cenario,
      };
    });

    out.auditoria_perguntas = {
      total_analisadas: auditoria.length,
      por_cenario: auditoria.reduce((acc, a) => { acc[a.cenario_esperado] = (acc[a.cenario_esperado] || 0) + 1; return acc; }, {}),
      candidatos_fluxo_cor: auditoria.filter(a => a.cenario_esperado.startsWith('FLUXO')),
      ultimas_10_geral: auditoria.slice(0, 10),
    };
  } catch (e) { out.auditoria_perguntas = { ERRO: e.message }; }

  return res.status(200).json(out);
}
