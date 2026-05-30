// ═══════════════════════════════════════════════════════════════════════════
// /api/lojas-whats-cron-aprendizado  — roda 1x/semana (seg 08h BRT)
// ═══════════════════════════════════════════════════════════════════════════
// Aprendizado autonomo da Sofia (Ailson 30/05/2026).
//
// Le fn_lojas_whats_aprendizado_features() (taxas por feature vs baseline,
// derivadas da view vw_lojas_whats_aprendizado_msg), filtra por amostra minima
// e lift claro, e escreve uma ORIENTACAO em lojas_whats_aprendizado(id=1).
// O prompt da Sofia (lojas-whats-ia.js) consome essa orientacao como guidance
// SUAVE (nao regra dura). Correlacional -> guarda de amostra evita perseguir
// ruido. Atualiza sozinho conforme os dados mudam.
// ═══════════════════════════════════════════════════════════════════════════

import { supabase, log, logErro } from './_lojas-whats-helpers.js';

const MIN_N    = 20;    // amostra minima por feature
const LIFT_POS = 1.5;   // >= 1.5x a media -> "faca"
const LIFT_NEG = 0.67;  // <= 0.67x a media -> "evite"

// Frases por feature (positivo = faca, negativo = evite)
const FRASE_POS = {
  abertura: {
    pergunta: 'abrir terminando com uma pergunta',
    oferecer_catalogo: 'oferecer/mandar o catálogo logo na abertura',
    curta: 'manter a abertura curta e direta',
  },
  mensagem: {
    pergunta: 'terminar a mensagem com uma pergunta',
    oferecer_catalogo: 'oferecer o catálogo quando fizer sentido',
    mencionar_preco: 'falar de preço/valores quando o cliente abrir espaço',
    enviar_foto: 'mandar foto da peça',
  },
};
const FRASE_NEG = {
  abertura: { longa: 'aberturas longas', curta: 'aberturas curtas demais', pergunta: 'aberturas sem pergunta', oferecer_catalogo: 'forçar catálogo na abertura' },
  mensagem: { pergunta: 'mensagens sem pergunta', mencionar_preco: 'puxar preço cedo demais', enviar_foto: 'mandar foto sem o cliente pedir', oferecer_catalogo: 'reoferecer catálogo' },
};

export default async function handler(req, res) {
  const ua = req.headers?.['user-agent'] || '';
  const ehCron = ua.startsWith('vercel-cron') || !!req.headers?.['x-vercel-cron'];
  if (!ehCron && req.query?.force !== '1') {
    return res.status(403).json({ error: 'Cron only. Use ?force=1 pra teste.' });
  }

  try {
    const { data: rows, error } = await supabase.rpc('fn_lojas_whats_aprendizado_features');
    if (error) throw error;

    const faca = { abertura: [], mensagem: [] };
    const evite = { abertura: [], mensagem: [] };

    for (const r of (rows || [])) {
      const n = Number(r.n) || 0;
      const lift = r.lift == null ? null : Number(r.lift);
      if (n < MIN_N || lift == null) continue;
      if (lift >= LIFT_POS && FRASE_POS[r.escopo]?.[r.feature]) {
        faca[r.escopo].push({ txt: FRASE_POS[r.escopo][r.feature], lift, n });
      } else if (lift <= LIFT_NEG && FRASE_NEG[r.escopo]?.[r.feature]) {
        evite[r.escopo].push({ txt: FRASE_NEG[r.escopo][r.feature], lift, n });
      }
    }

    // Ordena por lift desc (faca) / asc (evite) e limita a 3 por linha
    const top = (arr, asc = false) => arr
      .sort((a, b) => asc ? a.lift - b.lift : b.lift - a.lift)
      .slice(0, 3).map(x => x.txt);

    const linhas = [];
    const fAb = top(faca.abertura), eAb = top(evite.abertura, true);
    const fMs = top(faca.mensagem), eMs = top(evite.mensagem, true);
    if (fAb.length || eAb.length) {
      linhas.push(`- ABERTURA — o que mais faz o cliente RESPONDER${fAb.length ? `: ${fAb.join('; ')}` : ''}.${eAb.length ? ` Evite: ${eAb.join('; ')}.` : ''}`);
    }
    if (fMs.length || eMs.length) {
      linhas.push(`- MENSAGENS — o que mais GERA INTERESSE${fMs.length ? `: ${fMs.join('; ')}` : ''}.${eMs.length ? ` Evite: ${eMs.join('; ')}.` : ''}`);
    }

    let guidance = null;
    if (linhas.length) {
      const dataStr = new Date().toLocaleDateString('pt-BR');
      guidance = `APRENDIZADO (dados reais das conversas, atualizado ${dataStr} — use como ORIENTAÇÃO, não regra rígida):\n${linhas.join('\n')}`;
    }

    const { error: upErr } = await supabase
      .from('lojas_whats_aprendizado')
      .update({ guidance, stats: rows || [], atualizado_em: new Date().toISOString() })
      .eq('id', 1);
    if (upErr) throw upErr;

    log('cron-aprendizado', `guidance ${guidance ? 'atualizada' : 'vazia (sem feature com amostra+lift)'}; features avaliadas=${(rows || []).length}`);
    return res.status(200).json({ ok: true, guidance, features: rows || [] });
  } catch (e) {
    logErro('cron-aprendizado', e);
    return res.status(500).json({ error: e.message });
  }
}
