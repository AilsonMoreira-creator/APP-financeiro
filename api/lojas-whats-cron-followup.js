// ═══════════════════════════════════════════════════════════════════════════
// lojas-whats-cron-followup.js — Sofia gera retomada quando tag FUp vence
// ═══════════════════════════════════════════════════════════════════════════
//
// Sprint B Sofia Follow-up (Ailson 25/05/2026).
//
// Roda 4x/dia (sugestao: 9h, 12h, 15h, 18h BRT) e:
//
//   1. SELECT conversas etapa='follow_up' AND follow_up_vence_em <= NOW()
//      AND follow_up_tentativas < 2 AND sem sugestao pendente
//
//   2. Pra cada: Claude gera msg de retomada baseada em CONTEXTO da
//      conversa anterior (nao na tag — a tag so define timing).
//
//   3. Cria sugestao pendente tipo='follow_up_retomada' + incrementa
//      follow_up_tentativas + atualiza follow_up_vence_em pra +1d
//      (vendedora tem 1d pra aprovar antes de re-disparar).
//
//   4. Conversas com follow_up_tentativas >= 2 E follow_up_vence_em < NOW()-3d
//      sem resposta -> perdida (motivo='followup_sem_retorno').
//
// Pode ser chamado por:
//   - Cron Vercel (vercel.json schedule)
//   - Manualmente via POST (botao admin)
//
// GET ?executar=1 = executa | GET sem param = preview
// ═══════════════════════════════════════════════════════════════════════════

import { supabase, setCors, log, logErro, getConfig, contarSofiaSemResposta, limparEstiloSofia } from './_lojas-whats-helpers.js';
import { chamarClaude } from './_lojas-helpers.js';

const MODELO_DEFAULT = 'claude-sonnet-4-6';
const MAX_POR_RODADA = 30;  // limita pra nao estourar Claude budget num cron so

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method === 'GET') {
    if (req.query.executar === '1' || req.headers['user-agent']?.includes('vercel-cron')) {
      try {
        const resultado = await executar();
        return res.status(200).json({ ok: true, ...resultado });
      } catch (e) {
        logErro('cron-followup', e);
        return res.status(500).json({ error: e.message });
      }
    }
    return await preview(req, res);
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  try {
    const resultado = await executar();
    return res.status(200).json({ ok: true, ...resultado });
  } catch (e) {
    logErro('cron-followup', e);
    return res.status(500).json({ error: e.message });
  }
}

// ─── PREVIEW (GET) ────────────────────────────────────────────────────────

async function preview(req, res) {
  const agora = new Date().toISOString();
  const cutoffPerdida = new Date(Date.now() - 3 * 86400000).toISOString();

  const { count: vencidasParaRetomar } = await supabase
    .from('lojas_whats_conversas')
    .select('*', { count: 'exact', head: true })
    .eq('etapa', 'follow_up')
    .lte('follow_up_vence_em', agora)
    .lt('follow_up_tentativas', 2);

  const { count: paraPerdida } = await supabase
    .from('lojas_whats_conversas')
    .select('*', { count: 'exact', head: true })
    .eq('etapa', 'follow_up')
    .gte('follow_up_tentativas', 2)
    .lt('follow_up_vence_em', cutoffPerdida);

  return res.status(200).json({
    preview: true,
    agora,
    vencidas_para_retomar: vencidasParaRetomar || 0,
    para_perdida: paraPerdida || 0,
  });
}

// ─── EXECUTAR ────────────────────────────────────────────────────────────

async function executar() {
  const inicio = Date.now();
  const agora = new Date().toISOString();
  const cutoffPerdida = new Date(Date.now() - 3 * 86400000).toISOString();

  // 1. Conversas com tag vencida — gera retomada
  const { data: vencidas, error: errVenc } = await supabase
    .from('lojas_whats_conversas')
    .select('id, telefone, nome_cliente, follow_up_tag, follow_up_motivo, follow_up_tentativas, valor_carrinho, qtd_pecas, cliente_indicou_site, observacao_para_sofia')
    .eq('etapa', 'follow_up')
    .lte('follow_up_vence_em', agora)
    .lt('follow_up_tentativas', 2)
    .order('follow_up_vence_em', { ascending: true })
    .limit(MAX_POR_RODADA);
  if (errVenc) throw errVenc;

  log('cron-followup', `${vencidas?.length || 0} conversas com tag vencida`);

  const resultados = { geradas: 0, skips: [], erros: [], promovidas_perdida: 0 };
  const modelo = await getConfig('modelo_ia', MODELO_DEFAULT);

  for (const conv of (vencidas || [])) {
    try {
      // Skip se ja tem sugestao pendente (ainda nao aprovada/dispensada)
      const { count: pendCount } = await supabase
        .from('lojas_whats_sugestoes')
        .select('*', { count: 'exact', head: true })
        .eq('conversa_id', conv.id)
        .eq('status', 'pendente');
      if (pendCount > 0) {
        resultados.skips.push({ id: conv.id, motivo: 'ja_tem_pendente' });
        continue;
      }

      // Regra Ailson 30/05/2026: catálogo + 6h + 24h = 3 toques legítimos.
      // Jamais a 4a sem resposta: se ja tem 3 saidas sem o cliente responder,
      // nao gera mais retomada.
      if (await contarSofiaSemResposta(conv.id) >= 3) {
        resultados.skips.push({ id: conv.id, motivo: '3_sem_resposta' });
        continue;
      }

      // Carrega historico (ultimas 15 msgs)
      const { data: hist } = await supabase
        .from('lojas_whats_mensagens')
        .select('direcao, autor, texto, tipo_midia, enviada_em')
        .eq('conversa_id', conv.id)
        .order('enviada_em', { ascending: false })
        .limit(15);
      const historico = (hist || []).reverse();

      const texto = await gerarMsgRetomada({ modelo, conv, historico });
      if (!texto) {
        resultados.erros.push({ id: conv.id, motivo: 'claude_vazio' });
        continue;
      }

      // Cria sugestao pendente
      const { error: errSug } = await supabase.from('lojas_whats_sugestoes').insert({
        conversa_id: conv.id,
        tipo: 'follow_up_retomada',
        texto_proposto: texto,
        status: 'pendente',
        contexto_ia: { follow_up_tag: conv.follow_up_tag, motivo: conv.follow_up_motivo, tentativa: (conv.follow_up_tentativas || 0) + 1 },
      });
      if (errSug) {
        resultados.erros.push({ id: conv.id, motivo: 'insert_sugestao', detalhe: errSug.message });
        continue;
      }

      // Incrementa tentativas + estende vence_em pra +1d
      // (se vendedora nao aprovar em 1d, cron tenta gerar de novo na proxima rodada)
      const novoVenceEm = new Date(Date.now() + 86400000).toISOString();
      await supabase.from('lojas_whats_conversas').update({
        follow_up_tentativas: (conv.follow_up_tentativas || 0) + 1,
        follow_up_vence_em: novoVenceEm,
        atualizado_em: agora,
      }).eq('id', conv.id);

      resultados.geradas++;
      log('cron-followup', `conv=${conv.id} gerou retomada tag=${conv.follow_up_tag} tent=${(conv.follow_up_tentativas || 0) + 1}`);
    } catch (e) {
      logErro('cron-followup/conv', e);
      resultados.erros.push({ id: conv.id, motivo: 'excecao', detalhe: e.message });
    }
  }

  // 2. Promove pra perdida: tentativas >=2 + vence_em < 3d atras (sem retorno)
  const { data: paraPerdida, error: errPerd } = await supabase
    .from('lojas_whats_conversas')
    .update({
      etapa: 'perdida',
      perdida_em: agora,
      motivo_perdida: 'followup_sem_retorno',
      atualizado_em: agora,
    })
    .eq('etapa', 'follow_up')
    .gte('follow_up_tentativas', 2)
    .lt('follow_up_vence_em', cutoffPerdida)
    .select('id');
  if (errPerd) logErro('cron-followup/perdida', errPerd);
  resultados.promovidas_perdida = (paraPerdida || []).length;

  resultados.duracao_ms = Date.now() - inicio;
  log('cron-followup', `finalizado: ${resultados.geradas} geradas, ${resultados.promovidas_perdida} perdida, ${resultados.duracao_ms}ms`);
  return resultados;
}

// ─── GERAR MSG DE RETOMADA via Claude ─────────────────────────────────────
// CONTEUDO depende do CONTEXTO da conversa anterior (decisao Ailson),
// nao da tag (1d/3d/7d). Tag so define timing.

async function gerarMsgRetomada({ modelo, conv, historico }) {
  const primeiroNome = (conv.nome_cliente || '').split(/\s+/)[0] || '';

  const historicoFormatado = historico.length === 0
    ? '(sem historico)'
    : historico.map(m => {
        const quem = m.direcao === 'entrada' ? `${primeiroNome || 'CLIENTE'}` : (m.autor === 'sofia_ia' ? 'SOFIA' : 'NOS');
        const conteudo = m.tipo_midia && m.tipo_midia !== 'text'
          ? `[${m.tipo_midia.toUpperCase()}]${m.texto ? ' ' + m.texto : ''}`
          : (m.texto || '');
        return `${quem}: ${conteudo}`;
      }).join('\n');

  const tentativaNum = (conv.follow_up_tentativas || 0) + 1;
  const carrinhoInfo = (conv.valor_carrinho > 0 || conv.qtd_pecas > 0)
    ? `Carrinho abandonado: ${conv.qtd_pecas || '?'} peças, R$${Number(conv.valor_carrinho || 0).toFixed(2)}.`
    : '';
  const siteInfo = conv.cliente_indicou_site ? 'Cliente sinalizou que vai voltar pelo site amicialoja.com.br.' : '';
  const obsAssist = conv.observacao_para_sofia
    ? `Observacao da vendedora: "${conv.observacao_para_sofia.slice(0, 200)}"`
    : '';

  const systemPrompt = `Você é Sofia, vendedora da Amícia (moda feminina atacado SP — Bom Retiro + Brás).

Esta conversa entrou em pausa porque: "${conv.follow_up_motivo || 'cliente esfriou'}".
Agora é hora de retomar. Esta é a tentativa ${tentativaNum} de 2 (depois vira Perdida).

TAREFA: gerar UMA mensagem CURTA de retomada (1-3 linhas, max 250 caracteres).

REGRAS DE OURO:
- Use "vc" (jamais "você", "senhora", "amiga")
- Tom: vendedora experiente, leve, sem pressão
- NÃO diga "tô voltando aqui", "passando aqui", "tudo bem??"
- NÃO use "incrível", "imperdível", "sensacional"
- NÃO use emoji 💛 nem travessão (—)
- Máximo 1 emoji simples (😊 😉) — opcional
- Se cliente disse "vou pensar": volta com pergunta concreta sobre o que ele viu
- Se cliente disse "amanhã te falo": leve, "tudo certo aí? me conta como ficou"
- Se cliente disse "vou pelo site": mostra disponibilidade sem invadir
- Reference algo CONCRETO da conversa (peça que ele perguntou, modelo, cor, etc.)
- Pergunta aberta no final
${tentativaNum === 2 ? '- ULTIMA tentativa: pode ser um pouco mais direta, mas ainda leve' : ''}

${carrinhoInfo}
${siteInfo}
${obsAssist}

HISTORICO DA CONVERSA (do mais antigo pro mais recente):
${historicoFormatado}

Responda APENAS com o texto da mensagem de retomada. Nada antes, nada depois.`;

  const cl = await chamarClaude({
    modelo,
    systemBlocks: [{ type: 'text', text: systemPrompt }],
    messages: [{ role: 'user', content: 'gere a mensagem de retomada agora' }],
    max_tokens: 250,
    temperature: 0.75,
  });

  if (!cl.ok) {
    logErro('cron-followup/claude', cl.erro);
    return null;
  }
  return limparEstiloSofia((cl.texto || '').trim());
}
