// ═══════════════════════════════════════════════════════════════════════════
// lojas-whats-cron-rotacionar.js — Rotaciona handoffs expirados
// ═══════════════════════════════════════════════════════════════════════════
//
// Roda a cada 5 minutos (vercel cron). Faz 3 coisas:
//
//   1. ATIVA handoffs na fila (status='fila_fora_janela') quando entra
//      em horario util. Marca push_enviado=true, define expirou_em.
//
//   2. ROTACIONA handoffs aguardando que expiraram (vendedora nao clicou
//      em 30min). Escolhe próxima vendedora elegivel (round-robin) e
//      cria novo handoff. Anterior vira status='expirado'.
//
//   3. ENCERRA quando todas vendedoras ja receberam (status='sem_resposta')
//      ou quando conversa saiu de quente/atendida.
//
// Janela: seg-sex 9-13h BRT (todas) / sab 9-13h BRT (só BR) / dom nada
//
// Ailson 26/05/2026
// ═══════════════════════════════════════════════════════════════════════════

import { supabase, setCors } from './_lojas-whats-helpers.js';

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
  const idsExcluir = new Set((ant || []).map(h => h.vendedora_id));

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
      nome: infoMap.get(c.vendedora_id)?.nome,
      loja: infoMap.get(c.vendedora_id)?.loja,
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

  const ua = req.headers['user-agent'] || '';
  const ehCron = ua.startsWith('vercel-cron') || !!req.headers['x-vercel-cron'];
  if (!ehCron && req.query?.force !== '1') {
    return res.status(403).json({ error: 'Cron only. Use ?force=1 pra teste.' });
  }

  const tInicio = Date.now();
  const janela = getJanelaAtualBRT();
  const agora = new Date();
  let ativadosFila = 0, rotacionados = 0, semResposta = 0, encerrados = 0;

  try {
    // ── 1. ATIVAR fila quando entra em janela ──
    if (janela.ativa) {
      const { data: filaItens } = await supabase
        .from('lojas_whats_handoffs')
        .select('id, conversa_id, vendedora_id')
        .eq('status', 'fila_fora_janela')
        .order('criado_em', { ascending: true })
        .limit(20);

      for (const h of (filaItens || [])) {
        // Verifica conversa ainda ativa (nao virou vendeu/perdida)
        const { data: cv } = await supabase
          .from('lojas_whats_conversas').select('etapa').eq('id', h.conversa_id).maybeSingle();
        if (!cv || ['vendeu', 'perdida'].includes(cv.etapa)) {
          await supabase.from('lojas_whats_handoffs')
            .update({ status: 'encerrado', atualizado_em: agora.toISOString() })
            .eq('id', h.id);
          encerrados++;
          continue;
        }

        // Verifica vendedora ainda elegivel (sabado=só BR)
        if (janela.restringeLoja) {
          const { data: v } = await supabase.from('lojas_vendedoras')
            .select('loja').eq('id', h.vendedora_id).maybeSingle();
          if (v?.loja !== janela.restringeLoja) continue;
        }

        const expira = new Date(agora.getTime() + ROTACAO_MIN * 60 * 1000);
        await supabase.from('lojas_whats_handoffs').update({
          status: 'aguardando',
          push_enviado: true,
          push_enviado_em: agora.toISOString(),
          expirou_em: expira.toISOString(),
          atualizado_em: agora.toISOString(),
        }).eq('id', h.id);
        await supabase.from('lojas_whats_vendedoras').update({
          ultima_atribuicao_em: agora.toISOString(),
          atualizado_em: agora.toISOString(),
        }).eq('vendedora_id', h.vendedora_id);
        ativadosFila++;
      }
    }

    // ── 2. ROTACIONAR aguardando que expiraram ──
    if (janela.ativa) {
      const { data: expirados } = await supabase
        .from('lojas_whats_handoffs')
        .select('id, conversa_id, vendedora_id, resumo_conversa, pecas_info, modelos_interesse, mensagem_sugerida, mensagem_sugerida_em, gatilhos_detectados, resumo_ia')
        .eq('status', 'aguardando')
        .lte('expirou_em', agora.toISOString())
        .limit(50);

      for (const h of (expirados || [])) {
        // Conversa ainda ativa?
        const { data: cv } = await supabase
          .from('lojas_whats_conversas').select('etapa').eq('id', h.conversa_id).maybeSingle();
        if (!cv || ['vendeu', 'perdida', 'atendida'].includes(cv.etapa)) {
          await supabase.from('lojas_whats_handoffs')
            .update({ status: 'encerrado', atualizado_em: agora.toISOString() })
            .eq('id', h.id);
          encerrados++;
          continue;
        }

        // Marca atual como expirado
        await supabase.from('lojas_whats_handoffs')
          .update({ status: 'expirado', atualizado_em: agora.toISOString() })
          .eq('id', h.id);

        // Acha próxima
        const proxima = await escolherProximaVendedora(h.conversa_id, janela.restringeLoja);
        if (!proxima) {
          // Ja passou por todas — encerra
          await supabase.from('lojas_whats_handoffs').insert({
            conversa_id: h.conversa_id,
            vendedora_id: null,
            motivo: 'sem_resposta_todos_passaram',
            status: 'sem_resposta',
            criado_em: agora.toISOString(),
          });
          semResposta++;
          continue;
        }

        // Cria novo handoff — herda contexto IA do anterior. Como a mensagem
        // usa placeholder [VENDEDORA], o frontend troca pelo nome de quem
        // realmente atende, entao a msg sugerida serve pra nova vendedora tb.
        // Ailson 28/05/2026.
        const novaExpira = new Date(agora.getTime() + ROTACAO_MIN * 60 * 1000);
        const { data: novoH } = await supabase.from('lojas_whats_handoffs').insert({
          conversa_id: h.conversa_id,
          vendedora_id: proxima.vendedora_id,
          motivo: 'rodizio_rotacao_30min',
          resumo_conversa: h.resumo_conversa || null,
          pecas_info: h.pecas_info || null,
          modelos_interesse: h.modelos_interesse || [],
          mensagem_sugerida: h.mensagem_sugerida || null,
          mensagem_sugerida_em: h.mensagem_sugerida_em || null,
          gatilhos_detectados: h.gatilhos_detectados || null,
          resumo_ia: h.resumo_ia || null,
          push_enviado: true,
          push_enviado_em: agora.toISOString(),
          expirou_em: novaExpira.toISOString(),
          status: 'aguardando',
          criado_em: agora.toISOString(),
        }).select().single();

        // Linka anterior <-> novo
        if (novoH) {
          await supabase.from('lojas_whats_handoffs')
            .update({ proximo_handoff_id: novoH.id })
            .eq('id', h.id);
        }

        // Atualiza ultima_atribuicao_em
        await supabase.from('lojas_whats_vendedoras').update({
          ultima_atribuicao_em: agora.toISOString(),
          atualizado_em: agora.toISOString(),
        }).eq('vendedora_id', proxima.vendedora_id);

        rotacionados++;
      }
    } else {
      // Fora janela: NAO rota nem ativa. Handoffs aguardando ficam paradas
      // ate proxima janela (sera processada no proximo run dentro da janela).
    }

    return res.json({
      ok: true,
      duracao_ms: Date.now() - tInicio,
      janela,
      ativados_fila: ativadosFila,
      rotacionados,
      sem_resposta: semResposta,
      encerrados,
    });
  } catch (e) {
    console.error('[lojas-whats-cron-rotacionar] exception:', e);
    return res.status(500).json({ error: e.message, duracao_ms: Date.now() - tInicio });
  }
}
