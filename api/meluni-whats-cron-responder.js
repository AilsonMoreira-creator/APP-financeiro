// ============================================================================
// /api/meluni-whats-cron-responder — roda 1x/min.
// ----------------------------------------------------------------------------
// Espelha o cron-responder da Sofia, pro inbox da Lara (Meluni). Pega conversas
// com responder_em vencido e última msg do cliente, gera a sugestão da IA
// (processarConversaMeluni) e zera o debounce. Se lara_auto_resposta_ativa
// estiver true, aprova+envia automático; senão só deixa a sugestão pendente
// pro atendente aprovar. Ailson 16/06/2026.
// ============================================================================
import { supabase, cfgMeluni } from './_meluni-whats-helpers.js';
import { processarConversaMeluni } from './meluni-whats-ia.js';
import { aprovarSugestao } from './meluni-whats-aprovar.js';

const LIMITE = 12;
const ETAPAS_FECHADAS = ['vendeu', 'perdida', 'resolvido'];

async function zerar(id) {
  await supabase.from('meluni_conversas').update({ responder_em: null }).eq('id', id);
}

export default async function handler(req, res) {
  const ua = req.headers?.['user-agent'] || '';
  const ehCron = ua.startsWith('vercel-cron') || !!req.headers?.['x-vercel-cron'];
  if (!ehCron && req.query?.force !== '1') {
    return res.status(403).json({ erro: 'Cron only. Use ?force=1 pra teste.' });
  }

  const agora = new Date().toISOString();
  let gerados = 0, pulados = 0, erros = 0, enviados = 0;
  const detalhe = [];

  const autoAtivo = (await cfgMeluni('lara_auto_resposta_ativa', false)) === true;

  try {
    const { data: convs, error } = await supabase.from('meluni_conversas')
      .select('id, etapa')
      .not('responder_em', 'is', null)
      .lte('responder_em', agora)
      .eq('ultima_msg_direcao', 'entrada')
      .order('responder_em', { ascending: true })
      .limit(LIMITE);
    if (error) throw error;
    if (!convs?.length) return res.status(200).json({ ok: true, total: 0, gerados, enviados, pulados, erros });

    for (const c of convs) {
      if (ETAPAS_FECHADAS.includes(c.etapa)) { await zerar(c.id); pulados++; continue; }
      try {
        const r = await processarConversaMeluni(c.id);
        await zerar(c.id);
        if (r.motivo === 'sugestao_criada') {
          gerados++;
          if (autoAtivo && r.sugestaoId) {
            const env = await aprovarSugestao(r.sugestaoId, 'lara_auto');
            if (env.ok) enviados++; else erros++;
          }
        } else {
          pulados++;
        }
        detalhe.push({ id: c.id, motivo: r.motivo, erro: r.erro || null });
      } catch (e) {
        erros++;
        await zerar(c.id);
        detalhe.push({ id: c.id, erro: e?.message || String(e) });
      }
    }

    return res.status(200).json({ ok: true, total: convs.length, gerados, enviados, pulados, erros, auto: autoAtivo, detalhe });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: e?.message || String(e) });
  }
}
