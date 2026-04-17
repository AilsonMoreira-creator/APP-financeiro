/**
 * ml-estoque-import-scf-bling-pdf.js
 * 
 * Popula ml_scf_ref_map com os pares ref→sku_pai conhecidos.
 * Fonte principal: PDF "Relatório de Produtos" Bling (17/abr/2026) — 53 pares.
 * Fonte complementar: SCFs órfãos que o Ailson confirmou manualmente — 3 pares.
 *
 * Acesse via GET ou POST (sem body necessário). Idempotente.
 */
import { supabase } from './_ml-helpers.js';

// ── 53 pares extraídos do PDF do Bling ──
// Convenção: cada produto-pai no Bling tem um único scf (começa com 'z'),
// extraído da linha do cabeçalho do produto (sem Cor: / Tamanho:).
const PAIRS_PDF = [
  { ref: '5',    scf: 'z23101938082' },
  { ref: '1287', scf: 'z23042792980' },
  { ref: '1871', scf: 'z23041920878' },
  { ref: '2134', scf: 'z23062789886' },
  { ref: '2136', scf: 'z23111549252' },
  { ref: '2267', scf: 'z23042228451' },
  { ref: '2274', scf: 'z23042993226' },
  { ref: '2277', scf: 'z23071326203' },
  { ref: '2321', scf: 'z23070182585' },
  { ref: '2329', scf: 'z23071294758' },
  { ref: '2339', scf: 'z23081248458' },
  { ref: '2347', scf: 'z23071231159' },
  { ref: '2352', scf: 'z23071261461' },
  { ref: '2353', scf: 'z23062616468' },
  { ref: '2358', scf: 'z23062392244' },
  { ref: '2361', scf: 'z23062160770' },
  { ref: '2362', scf: 'z23062174146' },
  { ref: '2382', scf: 'z23082339979' },
  { ref: '2410', scf: 'z23100673177' },
  { ref: '2413', scf: 'z24022868661' },
  { ref: '2472', scf: 'z24022801195' },
  { ref: '2502', scf: 'z24022865561' },
  { ref: '2534', scf: 'z24041337932' },
  { ref: '2544', scf: 'z23062710147' },
  { ref: '2553', scf: 'z230627101478' },
  { ref: '2592', scf: 'z24062834311' },
  { ref: '2600', scf: 'z23111549264' },
  { ref: '2601', scf: 'z231020958987' },
  { ref: '2638', scf: 'z24070665696' },
  { ref: '2655', scf: 'z24070665797' },
  { ref: '2671', scf: 'z240706658101' },
  { ref: '2700', scf: 'z23042966435' },
  { ref: '2708', scf: 'z2304224848' },
  { ref: '2723', scf: 'z230422484952' },
  { ref: '2733', scf: 'z240706657101' },
  { ref: '2773', scf: 'z23042236352' },
  { ref: '2776', scf: 'z230419120282' },
  { ref: '2780', scf: 'z230422363523' },
  { ref: '2782', scf: 'z230422363553' },
  { ref: '2790', scf: 'z2304200525' },
  { ref: '2798', scf: 'z23042425459' },
  { ref: '2820', scf: 'z230422454415578' },
  { ref: '2822', scf: 'z231115492642738' },
  { ref: '2823', scf: 'z230429664353117' },
  { ref: '2832', scf: 'z2304296643501587' },
  { ref: '2864', scf: 'z231115492647980' },
  { ref: '2881', scf: 'z2304296643511085' },
  { ref: '2891', scf: 'z23042478459453' },
  { ref: '2902', scf: 'z2304191202847810' },
  { ref: '2927', scf: 'z230422363585367' },
  { ref: '2934', scf: 'z2304223635237650' },
  { ref: '3150', scf: 'z2304223635853152671' },
  { ref: '3186', scf: 'z2304224544174521' },
];

// ── SCFs órfãos confirmados pelo Ailson (não estão no PDF mas ativos na Lumia) ──
const PAIRS_MANUAL = [
  { ref: '376',  scf: 'z23041476303', obs: 'Body transpassado decote V poliamida (ref 0376)' },
  { ref: '395',  scf: 'z23041818108', obs: 'Body malha poliamida premium (ref 0395)' },
  { ref: '2277', scf: 'z23042054535', obs: 'Segundo scf pai antigo da ref 02277 (saia linho super nobre)' },
];

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST' && req.method !== 'GET') {
      return res.status(405).json({ error: 'Use GET ou POST' });
    }

    const todos = [
      ...PAIRS_PDF.map(p => ({
        scf: p.scf,
        ref: p.ref,
        origem: 'pdf_bling_20260417',
        observacao: null,
        updated_at: new Date().toISOString(),
      })),
      ...PAIRS_MANUAL.map(p => ({
        scf: p.scf,
        ref: p.ref,
        origem: 'manual_ailson',
        observacao: p.obs,
        updated_at: new Date().toISOString(),
      })),
    ];

    let inseridos = 0;
    for (let i = 0; i < todos.length; i += 100) {
      const batch = todos.slice(i, i + 100);
      const { error } = await supabase
        .from('ml_scf_ref_map')
        .upsert(batch, { onConflict: 'scf' });
      if (error) throw new Error(error.message);
      inseridos += batch.length;
    }

    return res.json({
      ok: true,
      total_scfs: todos.length,
      inseridos,
      origem: {
        pdf_bling: PAIRS_PDF.length,
        manual_ailson: PAIRS_MANUAL.length,
      },
      proximo_passo: 'Agora abre /api/ml-estoque-cron pra rodar o sync',
    });
  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
}
