// ═══════════════════════════════════════════════════════════════════════════
// lojas-whats-handoff-dispensar.js — Vendedora dispensa lead Sofia
// ═══════════════════════════════════════════════════════════════════════════
//
// Quando vendedora clica "Não posso atender agora" no card lead Sofia.
// Marca handoff status='dispensada_vendedora' e DISPARA rotacao pra proxima
// vendedora elegivel imediatamente (sem esperar os 30min).
//
// Body: { vendedora_id, handoff_id?, motivo? }
//
// Diferenca pra expirar (cron-rotacionar):
//   - expirou: vendedora ignorou (timeout 30min)
//   - dispensou: vendedora pediu pra rotar imediatamente
// Ambos: anterior fica registrado, novo handoff vai pra proxima do rodizio.
//
// Ailson 26/05/2026 sessao tarde
// ═══════════════════════════════════════════════════════════════════════════

import { supabase, setCors } from './_lojas-whats-helpers.js';
import { gerarContextoHandoff } from './_lojas-whats-handoff-ia.js';

const ROTACAO_MIN = 30;

function getJanelaAtualBRT() {
  const nowUtc = new Date();
  const brt = new Date(nowUtc.getTime() - 3 * 3600 * 1000);
  const dia = brt.getUTCDay();
  const hora = brt.getUTCHours();
  if (dia === 0) return { ativa: false, motivo: 'domingo' };
  const sab = dia === 6;
  const horaFim = sab ? 13 : 18;
  if (hora < 9 || hora >= horaFim) {
    return { ativa: false, motivo: `${hora}h fora janela ${sab ? 'sab 9-13h' : 'seg-sex 9-18h'}` };
  }
  if (sab) return { ativa: true, motivo: 'sab 9-13h — so BR', restringeLoja: 'Bom Retiro' };
  return { ativa: true, motivo: 'seg-sex 9-18h — todas', restringeLoja: null };
}

async function escolherProximaVendedora(conversaId, restringeLoja) {
  const { data: ant } = await supabase
    .from('lojas_whats_handoffs').select('vendedora_id').eq('conversa_id', conversaId);
  const idsExcluir = new Set((ant || []).map(h => h.vendedora_id).filter(Boolean));

  const { data: cand } = await supabase
    .from('lojas_whats_vendedoras').select('vendedora_id, ultima_atribuicao_em').eq('participa_rodizio', true);
  if (!cand || !cand.length) return null;

  const { data: vendInfo } = await supabase
    .from('lojas_vendedoras').select('id, nome, loja').in('id', cand.map(c => c.vendedora_id));
  const infoMap = new Map((vendInfo || []).map(v => [v.id, v]));

  const elegiveis = cand
    .filter(c => !idsExcluir.has(c.vendedora_id))
    .filter(c => !restringeLoja || infoMap.get(c.vendedora_id)?.loja === restringeLoja)
    .map(c => ({
      vendedora_id: c.vendedora_id,
      ultima: c.ultima_atribuicao_em,
    }))
    .sort((a, b) => {
      if (a.ultima === null && b.ultima === null) return 0;
      if (a.ultima === null) return -1;
      if (b.ultima === null) return 1;
      return new Date(a.ultima) - new Date(b.ultima);
    });
  return elegiveis[0] || null;
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST esperado' });

  try {
    const { vendedora_id, handoff_id, motivo } = req.body || {};
    if (!vendedora_id) return res.status(400).json({ error: 'vendedora_id obrigatorio' });

    // Acha handoff (especifico ou ultimo aguardando da vendedora)
    let qb = supabase
      .from('lojas_whats_handoffs')
      .select('id, conversa_id, vendedora_id, status')
      .eq('vendedora_id', vendedora_id)
      .eq('status', 'aguardando')
      .order('criado_em', { ascending: false })
      .limit(1);
    if (handoff_id) qb = qb.eq('id', handoff_id);
    const { data: handoffs } = await qb;
    if (!handoffs || handoffs.length === 0) {
      return res.status(404).json({ error: 'Nenhum handoff aguardando' });
    }
    const h = handoffs[0];

    const agora = new Date();

    // Marca dispensado
    await supabase.from('lojas_whats_handoffs')
      .update({
        status: 'dispensada_vendedora',
        motivo: motivo ? `dispensada: ${motivo}` : 'dispensada_pela_vendedora',
        atualizado_em: agora.toISOString(),
      })
      .eq('id', h.id);

    // Verifica conversa ainda ativa
    const { data: cv } = await supabase
      .from('lojas_whats_conversas')
      .select('etapa').eq('id', h.conversa_id).maybeSingle();
    if (!cv || ['vendeu', 'perdida', 'atendida'].includes(cv.etapa)) {
      return res.json({ ok: true, rotacionou: false, motivo: `conversa em ${cv?.etapa || 'inexistente'}` });
    }

    // Rota pra proxima
    const janela = getJanelaAtualBRT();
    const proxima = await escolherProximaVendedora(h.conversa_id, janela.restringeLoja);

    if (!proxima) {
      await supabase.from('lojas_whats_handoffs').insert({
        conversa_id: h.conversa_id,
        vendedora_id: null,
        motivo: 'sem_resposta_todos_passaram',
        status: 'sem_resposta',
        criado_em: agora.toISOString(),
      });
      return res.json({ ok: true, rotacionou: false, motivo: 'todas vendedoras ja passaram' });
    }

    // Cria novo handoff (com mesmo contexto IA — reaproveita do anterior)
    const { data: anteriorComCtx } = await supabase
      .from('lojas_whats_handoffs')
      .select('resumo_conversa, pecas_info, modelos_interesse, mensagem_sugerida')
      .eq('id', h.id).maybeSingle();

    const pushAgora = janela.ativa;
    const expira = new Date(agora.getTime() + ROTACAO_MIN * 60 * 1000);

    const { data: novo } = await supabase.from('lojas_whats_handoffs').insert({
      conversa_id: h.conversa_id,
      vendedora_id: proxima.vendedora_id,
      motivo: 'rotacao_apos_dispensa',
      resumo_conversa: anteriorComCtx?.resumo_conversa || null,
      pecas_info: anteriorComCtx?.pecas_info || null,
      modelos_interesse: anteriorComCtx?.modelos_interesse || [],
      mensagem_sugerida: anteriorComCtx?.mensagem_sugerida || null,
      push_enviado: pushAgora,
      push_enviado_em: pushAgora ? agora.toISOString() : null,
      expirou_em: pushAgora ? expira.toISOString() : null,
      status: pushAgora ? 'aguardando' : 'fila_fora_janela',
      criado_em: agora.toISOString(),
    }).select().single();

    if (novo && pushAgora) {
      // Linka anterior -> novo
      await supabase.from('lojas_whats_handoffs')
        .update({ proximo_handoff_id: novo.id })
        .eq('id', h.id);
      // Atualiza ultima_atribuicao_em da nova vendedora
      await supabase.from('lojas_whats_vendedoras').update({
        ultima_atribuicao_em: agora.toISOString(),
        atualizado_em: agora.toISOString(),
      }).eq('vendedora_id', proxima.vendedora_id);
    }

    return res.json({
      ok: true,
      rotacionou: true,
      proxima_vendedora_id: proxima.vendedora_id,
      novo_handoff_id: novo?.id,
      push_enviado: pushAgora,
    });
  } catch (e) {
    console.error('[handoff-dispensar] exception:', e);
    return res.status(500).json({ error: e.message });
  }
}
