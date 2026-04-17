/**
 * ml-estoque-refs-sem-dados.js
 * Lista as refs da Calculadora que não foram resolvidas no último sync
 */
import { supabase } from './_ml-helpers.js';

function normRef(r) { return String(r || '').replace(/\D/g, '').replace(/^0+/, '').trim(); }

export default async function handler(req, res) {
  try {
    // 1. Refs ativas da Calculadora
    const { data: calcData } = await supabase.from('amicia_data')
      .select('payload').eq('user_id', 'calc-meluni').maybeSingle();
    const prodsCalc = calcData?.payload?.prods || [];
    const refsCalc = new Map(); // ref → descrição
    for (const p of prodsCalc) {
      const r = normRef(p.ref);
      if (r) refsCalc.set(r, p.descricao || '');
    }

    // 2. Refs que foram resolvidas (estão em ml_estoque_ref_atual com qtd_total > 0)
    const { data: refsResolvidas } = await supabase
      .from('ml_estoque_ref_atual')
      .select('ref, qtd_total, sem_dados, mlb_escolhido, alerta_duplicata');
    const refsResolvidasSet = new Set(
      (refsResolvidas || [])
        .filter(r => !r.sem_dados && (r.qtd_total || 0) > 0)
        .map(r => normRef(r.ref))
    );
    // Mapa completo pra retornar detalhes
    const refsResolvidasMap = new Map(
      (refsResolvidas || []).map(r => [normRef(r.ref), r])
    );

    // 3. Diferença = refs sem dados
    const semDados = [];
    const comDados = [];
    for (const [ref, desc] of refsCalc) {
      const resolved = refsResolvidasMap.get(ref);
      if (refsResolvidasSet.has(ref)) {
        comDados.push({
          ref,
          descricao: desc,
          qtd_total: resolved?.qtd_total || 0,
          mlb_escolhido: resolved?.mlb_escolhido || null,
          alerta_duplicata: resolved?.alerta_duplicata || false,
        });
      } else {
        semDados.push({ ref, descricao: desc });
      }
    }

    // 4. Pra cada sem_dados, checa no mapa scf→ref se tem entry
    const { data: scfMap } = await supabase.from('ml_scf_ref_map').select('ref, scf, origem');
    const refsNoScfMap = new Set((scfMap || []).map(s => normRef(s.ref)));

    // 5. Classifica cada ref sem_dados
    for (const item of semDados) {
      item.tem_no_scf_map = refsNoScfMap.has(item.ref);
    }

    return res.json({
      ok: true,
      total_calc: refsCalc.size,
      total_resolvidas: comDados.length,
      total_sem_dados: semDados.length,
      refs_resolvidas: comDados.sort((a, b) => b.qtd_total - a.qtd_total),
      refs_sem_dados: semDados.sort((a, b) => a.ref.localeCompare(b.ref)),
      interpretacao: {
        'tem_no_scf_map: true':  'Ref está no mapa mas não há anúncio ativo com esse scf na Lumia (pode ser só Exitus/Muniam)',
        'tem_no_scf_map: false': 'Ref não está no mapa scf→ref — anúncio pode existir na Lumia mas sem scf pai conhecido',
      },
    });
  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
}
