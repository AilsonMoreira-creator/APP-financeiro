/**
 * ml-estoque-import-scf-bling-pdf.js — Importa os 53 pares ref→sku_pai
 * extraídos do PDF "Relatório de Produtos" do Bling em 17/abr/2026
 *
 * POST /api/ml-estoque-import-scf-bling-pdf  (sem body necessário)
 *   → popula ml_scf_ref_map com os 53 pares ref→scf já extraídos
 */
import { supabase } from './_ml-helpers.js';

// Extraídos manualmente do PDF enviado pelo Ailson (Bling_-_Relato_rio_de_Produtos.pdf)
// Formato: ref normalizada → sku pai (seller_custom_field no ML)
const MAPPING = {
  '5':    'z23101938082',
  '1287': 'z23042792980',
  '1871': 'z23041920878',
  '2134': 'z23062789886',
  '2136': 'z23111549252',
  '2267': 'z23042228451',
  '2274': 'z23042993226',
  '2277': 'z23071326203',
  '2321': 'z23070182585',
  '2329': 'z23071294758',
  '2339': 'z23081248458',
  '2347': 'z23071231159',
  '2352': 'z23071261461',
  '2353': 'z23062616468',
  '2358': 'z23062392244',
  '2361': 'z23062160770',
  '2362': 'z23062174146',
  '2382': 'z23082339979',
  '2410': 'z23100673177',
  '2413': 'z24022868661',
  '2472': 'z24022801195',
  '2502': 'z24022865561',
  '2534': 'z24041337932',
  '2544': 'z23062710147',
  '2553': 'z230627101478',
  '2592': 'z24062834311',
  '2600': 'z23111549264',
  '2601': 'z231020958987',
  '2638': 'z24070665696',
  '2655': 'z24070665797',
  '2671': 'z240706658101',
  '2700': 'z23042966435',
  '2708': 'z2304224848',
  '2723': 'z230422484952',
  '2733': 'z240706657101',
  '2773': 'z23042236352',
  '2776': 'z230419120282',
  '2780': 'z230422363523',
  '2782': 'z230422363553',
  '2790': 'z2304200525',
  '2798': 'z23042425459',
  '2820': 'z230422454415578',
  '2822': 'z231115492642738',
  '2823': 'z230429664353117',
  '2832': 'z2304296643501587',
  '2864': 'z231115492647980',
  '2881': 'z2304296643511085',
  '2891': 'z23042478459453',
  '2902': 'z2304191202847810',
  '2927': 'z230422363585367',
  '2934': 'z2304223635237650',
  '3150': 'z2304223635853152671',
  '3186': 'z2304224544174521',
};

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST' && req.method !== 'GET') {
      return res.status(405).json({ error: 'Use GET ou POST' });
    }

    const rows = Object.entries(MAPPING).map(([ref, scf]) => ({
      scf,
      ref,
      origem: 'pdf_bling_20260417',
      observacao: 'Extraído do PDF Relatório de Produtos Bling enviado 17/abr/2026',
      updated_at: new Date().toISOString(),
    }));

    let inseridos = 0;
    for (let i = 0; i < rows.length; i += 100) {
      const batch = rows.slice(i, i + 100);
      const { error } = await supabase
        .from('ml_scf_ref_map')
        .upsert(batch, { onConflict: 'scf' });
      if (error) throw new Error(error.message);
      inseridos += batch.length;
    }

    return res.json({
      ok: true,
      total_rows: rows.length,
      inseridos,
      observacao: 'Mapa carregado. Roda /api/ml-estoque-cron pra resolver as refs.',
      amostra: rows.slice(0, 5),
    });
  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
}
