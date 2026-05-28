// ═══════════════════════════════════════════════════════════════════════════
// lojas-whats-encaminhar.js — Assistente envia lead Sofia pra vendedora
// ═══════════════════════════════════════════════════════════════════════════
//
// Chamado quando assistente clica "Enviar vendedora" no card de conversa
// em etapa 'quente'.
//
// Modos:
//   - 'rodizio': sistema escolhe próxima vendedora elegível
//                (round-robin por lojas_whats_vendedoras.ultima_atribuicao_em)
//   - 'manual':  assistente escolhe vendedora_id direto (qualquer cadastrada)
//
// Cria entry em lojas_whats_handoffs com:
//   - status='aguardando'
//   - push_enviado=true, push_enviado_em=NOW
//   - expirou_em=NOW+30min
//
// Janela de envio: SEG-SEX 9-13h BRT (todas vendedoras)
//                  SAB     9-13h BRT (só BR — ST fecha)
//                  DOM nada
// Se fora da janela: cria handoff mas push_enviado=false, sera ativado
// no proximo horario de janela pelo cron rotacionar.
//
// Ailson 26/05/2026
// ═══════════════════════════════════════════════════════════════════════════

import { supabase, setCors } from './_lojas-whats-helpers.js';
import { gerarContextoHandoff } from './_lojas-whats-handoff-ia.js';

const ROTACAO_MIN = 30;  // janela por vendedora

/**
 * Retorna info da janela de envio AGORA (em BRT).
 * { ativa: bool, motivo: text, restringeLoja: 'Bom Retiro'|null }
 */
function getJanelaAtualBRT() {
  const nowUtc = new Date();
  // BRT = UTC-3 (sem DST atualmente)
  const brt = new Date(nowUtc.getTime() - 3 * 3600 * 1000);
  const diaSemana = brt.getUTCDay(); // 0=dom, 1=seg, ..., 6=sab
  const hora = brt.getUTCHours();

  if (diaSemana === 0) return { ativa: false, motivo: 'domingo (loja fechada)' };
  const sab = diaSemana === 6;
  const horaFim = sab ? 13 : 18;
  if (hora < 9 || hora >= horaFim) {
    return { ativa: false, motivo: `${hora}h BRT — fora janela ${sab ? 'sab 9-13h' : 'seg-sex 9-18h'}` };
  }
  if (sab) return { ativa: true, motivo: 'sab 9-13h — só BR', restringeLoja: 'Bom Retiro' };
  return { ativa: true, motivo: 'seg-sex 9-18h — todas', restringeLoja: null };
}

/**
 * Escolhe proxima vendedora do rodízio.
 * - filtra participa_rodizio=true
 * - filtra pelo restringeLoja (sabado=só BR)
 * - exclui vendedoras que JA receberam handoff dessa conversa
 * - ordena por ultima_atribuicao_em (NULL primeiro, depois mais antiga)
 */
async function escolherProximaVendedora(conversaId, restringeLoja) {
  // Vendedoras que ja receberam handoff dessa conversa
  const { data: handoffsAnteriores } = await supabase
    .from('lojas_whats_handoffs')
    .select('vendedora_id')
    .eq('conversa_id', conversaId);
  const idsExcluir = new Set((handoffsAnteriores || []).map(h => h.vendedora_id));

  // Candidatas: participam rodizio
  let qb = supabase
    .from('lojas_whats_vendedoras')
    .select('vendedora_id, ultima_atribuicao_em, peso_rodizio')
    .eq('participa_rodizio', true);
  const { data: candidatasWhats, error: errC } = await qb;
  if (errC) throw new Error('Erro listando vendedoras rodizio: ' + errC.message);
  if (!candidatasWhats || candidatasWhats.length === 0) return null;

  // Hidrata com nome+loja de lojas_vendedoras
  const ids = candidatasWhats.map(c => c.vendedora_id);
  const { data: vendInfo } = await supabase
    .from('lojas_vendedoras').select('id, nome, loja').in('id', ids);
  const infoMap = new Map((vendInfo || []).map(v => [v.id, v]));

  // Filtra exclusoes + loja restrita
  const elegiveis = candidatasWhats
    .filter(c => !idsExcluir.has(c.vendedora_id))
    .filter(c => {
      if (!restringeLoja) return true;
      const info = infoMap.get(c.vendedora_id);
      return info?.loja === restringeLoja;
    })
    .map(c => ({
      vendedora_id: c.vendedora_id,
      ultima: c.ultima_atribuicao_em,
      nome: infoMap.get(c.vendedora_id)?.nome,
      loja: infoMap.get(c.vendedora_id)?.loja,
    }))
    .sort((a, b) => {
      // NULL primeiro, depois mais antiga
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
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST esperado' });
  }

  try {
    const { conversa_id, modo, vendedora_id: vendedoraIdManual, motivo } = req.body || {};
    if (!conversa_id) return res.status(400).json({ error: 'conversa_id obrigatorio' });
    if (!['rodizio', 'manual'].includes(modo)) {
      return res.status(400).json({ error: "modo deve ser 'rodizio' ou 'manual'" });
    }
    if (modo === 'manual' && !vendedoraIdManual) {
      return res.status(400).json({ error: 'vendedora_id obrigatorio quando modo=manual' });
    }

    // Carrega conversa
    const { data: conversa, error: errCv } = await supabase
      .from('lojas_whats_conversas')
      .select('id, etapa, telefone, contexto_ia, gatilhos_detectados')
      .eq('id', conversa_id).maybeSingle();
    if (errCv || !conversa) {
      return res.status(404).json({ error: 'conversa nao encontrada' });
    }
    if (['vendeu', 'perdida'].includes(conversa.etapa)) {
      return res.status(409).json({ error: `conversa ja em etapa ${conversa.etapa}` });
    }

    // Ailson 27/05/2026: bloqueia duplicacao — se ja existe handoff
    // pendente (status 'aguardando' ou 'fila_fora_janela') pra essa conversa.
    // Ailson 28/05/2026: no modo MANUAL (re-atribuicao deliberada a uma
    // vendedora escolhida), CANCELA o pendente e segue — assim da pra
    // reenviar/trocar de vendedora sem ficar travado. No rodizio automatico
    // mantem o 409 pra evitar dupes acidentais.
    const { data: handoffPendente } = await supabase
      .from('lojas_whats_handoffs')
      .select('id, vendedora_id, status, criado_em')
      .eq('conversa_id', conversa_id)
      .in('status', ['aguardando', 'fila_fora_janela'])
      .maybeSingle();
    if (handoffPendente) {
      if (modo === 'manual') {
        await supabase
          .from('lojas_whats_handoffs')
          .update({ status: 'cancelado', atualizado_em: new Date().toISOString() })
          .eq('id', handoffPendente.id);
      } else {
        return res.status(409).json({
          error: 'handoff_ja_pendente',
          detalhe: `Já existe handoff pendente pra essa conversa (status=${handoffPendente.status}). Espera a vendedora aceitar/recusar, ou reenvie no modo manual escolhendo a vendedora.`,
          handoff_id: handoffPendente.id,
        });
      }
    }

    // Determina vendedora alvo
    const janela = getJanelaAtualBRT();
    let vendedoraIdAlvo = null;

    if (modo === 'manual') {
      vendedoraIdAlvo = vendedoraIdManual;
      // valida que esta cadastrada (pode estar fora rodizio — definir manual permite)
      const { data: v } = await supabase.from('lojas_vendedoras')
        .select('id, nome').eq('id', vendedoraIdAlvo).maybeSingle();
      if (!v) return res.status(404).json({ error: 'vendedora_id invalido' });
    } else {
      // rodizio
      const escolhida = await escolherProximaVendedora(
        conversa_id, janela.restringeLoja
      );
      if (!escolhida) {
        return res.status(409).json({
          error: 'Nenhuma vendedora elegivel no rodizio. Cadastre via UI ou use modo=manual.',
        });
      }
      vendedoraIdAlvo = escolhida.vendedora_id;
    }

    // Cria handoff
    const agora = new Date();
    const expira = new Date(agora.getTime() + ROTACAO_MIN * 60 * 1000);
    // Manual = vendedora foi escolhida deliberadamente pelo operador, vai
    // direto pra ela (ativa na hora). Rodizio automatico respeita a janela
    // (nao acorda vendedora fora de horario). Ailson 28/05/2026.
    const pushAgora = (modo === 'manual') ? true : janela.ativa;

    // Gera contexto IA (resumo, modelos, msg sugerida) via Claude Haiku ANTES
    // de inserir. Se falhar, campos ficam null e handoff segue normal.
    // Ailson 26/05/2026 (sessao tarde) — card vendedora rico.
    const ctxIa = await gerarContextoHandoff(conversa_id);

    const { data: handoff, error: errH } = await supabase
      .from('lojas_whats_handoffs')
      .insert({
        conversa_id,
        vendedora_id: vendedoraIdAlvo,
        motivo: motivo || (modo === 'manual' ? 'assistente_definiu' : 'rodizio_quente'),
        gatilhos_detectados: conversa.gatilhos_detectados || null,
        resumo_ia: typeof conversa.contexto_ia === 'string'
          ? conversa.contexto_ia.slice(0, 500)
          : null,
        // Campos novos (Ailson 26/05/2026)
        resumo_conversa: ctxIa.resumo_conversa,
        pecas_info: ctxIa.pecas_info,
        modelos_interesse: ctxIa.modelos_interesse || [],
        mensagem_sugerida: ctxIa.mensagem_sugerida,
        mensagem_sugerida_em: ctxIa.mensagem_sugerida ? agora.toISOString() : null,
        push_enviado: pushAgora,
        push_enviado_em: pushAgora ? agora.toISOString() : null,
        expirou_em: pushAgora ? expira.toISOString() : null,
        status: pushAgora ? 'aguardando' : 'fila_fora_janela',
        criado_em: agora.toISOString(),
      })
      .select().single();
    if (errH) {
      console.error('[encaminhar] erro insert handoff:', errH);
      return res.status(500).json({ error: errH.message });
    }

    // Atualiza ultima_atribuicao_em da vendedora (se foi enviado)
    if (pushAgora) {
      await supabase
        .from('lojas_whats_vendedoras')
        .update({ ultima_atribuicao_em: agora.toISOString(), atualizado_em: agora.toISOString() })
        .eq('vendedora_id', vendedoraIdAlvo);
      // Incrementa contador
      await supabase.rpc('increment', { table_name: 'lojas_whats_vendedoras', row_id: vendedoraIdAlvo, col: 'total_leads_recebidos' })
        .then(() => null, () => null);  // ignora se RPC nao existir
    }

    // Ailson 27/05/2026: atualiza etapa da conversa pra 'quente' e limpa
    // sugestao_quente_pendente_em (foi promovido, nao precisa mais sugestao).
    // Aguarda a vendedora aceitar (vira 'atendida') ou expirar (fila).
    // So muda se a conversa ainda estava em pre-quente.
    if (!['quente', 'atendida'].includes(conversa.etapa)) {
      await supabase.from('lojas_whats_conversas').update({
        etapa: 'quente',
        sugestao_quente_pendente_em: null,
        sugestao_quente_motivo: null,
        sugestao_quente_gatilhos: null,
        atualizado_em: agora.toISOString(),
      }).eq('id', conversa_id);
    }

    return res.json({
      ok: true,
      handoff_id: handoff.id,
      vendedora_id: vendedoraIdAlvo,
      modo,
      push_enviado: pushAgora,
      janela: janela,
      expirou_em: handoff.expirou_em,
      mensagem: pushAgora
        ? `Enviado pra vendedora. Janela de ${ROTACAO_MIN}min ate ${expira.toLocaleString('pt-BR')} BRT.`
        : `Fora da janela (${janela.motivo}). Sera ativado no proximo horario util.`,
    });
  } catch (e) {
    console.error('[lojas-whats-encaminhar] exception:', e);
    return res.status(500).json({ error: e.message });
  }
}
