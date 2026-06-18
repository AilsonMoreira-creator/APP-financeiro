/**
 * lojas-ia.js — Edge Function do módulo Lojas IA.
 *
 * Roteia 2 ações:
 *   - gerar_sugestoes: monta prompt A com carteira + produtos + promoções,
 *     chama Claude, parseia JSON de 7 sugestões, salva em
 *     lojas_sugestoes_diarias (idempotente: deleta as do dia antes de inserir).
 *
 *   - gerar_mensagem: monta prompt B com 1 sugestão expandida, chama Claude,
 *     retorna texto puro pronto pra copiar. Cacheia em
 *     lojas_sugestoes_diarias.mensagem_gerada (TTL 5 min).
 *
 * Padrão técnico:
 *   - SUPABASE_KEY (service role) — bypassa RLS pra deletar/inserir
 *   - ANTHROPIC_API_KEY — chamada via fetch direto (sem SDK)
 *   - Prompt caching ativado (cache_control: ephemeral)
 *   - Modelo lido de lojas_config.modelo_ia (default claude-sonnet-4-6)
 *   - Rate limit por vendedora (lojas_config.rate_limit_ms, default 3000ms)
 *   - Orçamento global compartilhado com IA Pergunta (ia_config.orcamento_brl_mensal)
 *
 * Frontend chama via:
 *   POST /api/lojas-ia
 *   Headers: { 'X-User': '<userId>' }
 *   Body: { action, vendedora_id?, sugestao_id?, contexto? }
 */

import {
  supabase,
  setCors,
  validarUsuario,
  ehAdminLojas,
  getLojasConfig,
  temOrcamento,
  checarRateLimit,
  chamarClaude,
  parseJsonTolerante,
  logarChamadaIA,
  refSemZero,
  diasDesde,
} from './_lojas-helpers.js';

import {
  SYSTEM_PROMPT_SUGESTOES,
  SYSTEM_PROMPT_MENSAGENS,
  SYSTEM_PROMPT_ENRIQUECER,
  EXEMPLOS_FEW_SHOT,
} from './lojas-ia-prompts.js';

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════

export default async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Valida usuário
  const auth = await validarUsuario(req);
  if (!auth.ok) {
    return res.status(auth.status || 401).json({ error: auth.error });
  }

  // Checa orçamento mensal global
  const orc = await temOrcamento();
  if (!orc.ok) {
    return res.status(429).json({
      error: 'Orçamento mensal de IA esgotado',
      gasto: orc.gasto.toFixed(2),
      limite: orc.limite.toFixed(2),
      mensagem: 'Aguarda virar o mês ou aumenta o orçamento em ia_config.orcamento_brl_mensal.',
    });
  }

  const action = req.body?.action;

  try {
    if (action === 'gerar_sugestoes') {
      return await handleGerarSugestoes(req, res, auth);
    }
    if (action === 'gerar_mensagem') {
      return await handleGerarMensagem(req, res, auth);
    }
    // Geracao avulsa — cliente_id direto, sem precisar de sugestao_id pre-existente
    // Ailson 08/05/2026: pra vendedora pedir mensagem direto do card da carteira
    if (action === 'gerar_mensagem_avulsa') {
      return await handleGerarMensagemAvulsa(req, res, auth);
    }
    if (action === 'gerar_resumo_semanal') {
      return await handleGerarResumoSemanal(req, res, auth);
    }
    if (action === 'conversoes_dashboard') {
      return await handleConversoesDashboard(req, res, auth);
    }
    if (action === 'metas_dashboard') {
      return await handleMetasDashboard(req, res, auth);
    }
    // Enriquecer observacao via IA — Onda 2 (Ailson 10/05/2026)
    // Vendedora marca reclamacao/elogio/evento -> IA gera 3 perguntas com
    // alternativas pra ela responder rapido. Resposta entra em
    // observacoes_ia.<categoria>[i].contexto.respostas_ia
    if (action === 'enriquecer_observacao') {
      return await handleEnriquecerObservacao(req, res, auth);
    }
    return res.status(400).json({ error: `Action desconhecida: ${action}` });
  } catch (e) {
    console.error('[lojas-ia] erro fatal:', e);
    return res.status(500).json({ error: e.message || 'Erro interno' });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// AÇÃO 1: gerar_sugestoes (Prompt A)
// ═══════════════════════════════════════════════════════════════════════════

async function handleGerarSugestoes(req, res, auth) {
  const vendedoraIdAlvo = req.body?.vendedora_id;
  if (!vendedoraIdAlvo) {
    return res.status(400).json({ error: 'vendedora_id obrigatório' });
  }

  // Permissão: vendedora só pode regenerar PRÓPRIAS sugestões. Admin pode regenerar de qualquer.
  if (!auth.isAdmin && auth.vendedoraId !== vendedoraIdAlvo) {
    return res.status(403).json({ error: 'Sem permissão pra regenerar sugestões de outra vendedora' });
  }

  // Rate limit
  const rl = await checarRateLimit(vendedoraIdAlvo);
  if (!rl.ok) {
    return res.status(429).json({
      error: 'Aguarda alguns segundos antes de regerar',
      ms_espera: rl.msEspera,
    });
  }

  // 1. Carrega contexto: vendedora, carteira, produtos, promoções, regras
  const ctx = await montarContextoSugestoes(vendedoraIdAlvo);
  if (ctx.erro) {
    return res.status(400).json({ error: ctx.erro });
  }

  // 2. Monta system prompt em blocos (com cache)
  const systemBlocks = montarSystemSugestoes(ctx.regrasCustomizadas);

  // 3. Monta messages (few-shot + user input)
  const messages = montarMessagesSugestoes(ctx);

  // 4. Modelo
  const modelo = String(await getLojasConfig('modelo_ia', 'claude-sonnet-4-6'));

  // 5. Chama Claude
  // max_tokens=8000 (era 4000): com schema v2 (top_refs_cliente,
  // mais_vendidos, refs_reposicao, parágrafos com \n\n), JSON de 7
  // sugestoes pode passar de 4000 tokens facilmente. Sintoma: erro
  // "Unterminated string in JSON" porque resposta foi truncada.
  const r = await chamarClaude({
    modelo,
    systemBlocks,
    messages,
    max_tokens: 8000,
    temperature: 0.7,
    // Timeout 240s (era 75s) — Ailson 18/05/2026 hotfix.
    // Carteiras grandes (Cleide 318, Vanessa 233) estavam estourando 75s
    // historicamente; Sprint A (feedback no prompt) foi a gota d'agua.
    // 240s da margem real e fica abaixo do maxDuration 300s do Vercel.
    timeoutMs: 240000,
  });

  // 6. Loga (independente de sucesso)
  await logarChamadaIA({
    vendedoraId: vendedoraIdAlvo,
    userId: auth.userId,
    tipoPrompt: 'sugestoes',
    modelo,
    usage: r.usage,
    latencia_ms: r.latencia_ms,
    requestSummary: `vendedora=${ctx.vendedoraNome} carteira=${ctx.clientes.length} produtos=${ctx.produtos.length}`,
    responseSummary: r.ok ? r.texto.slice(0, 500) : null,
    erro: r.ok ? null : r.erro,
  });

  if (!r.ok) {
    return res.status(502).json({ error: 'Erro ao chamar IA', detalhe: r.erro });
  }

  // 7. Parse JSON tolerante
  const parsed = parseJsonTolerante(r.texto);
  if (!parsed.ok) {
    return res.status(502).json({
      error: 'IA retornou JSON inválido',
      detalhe: parsed.erro,
      raw: parsed.raw,
    });
  }

  // 8. Valida estrutura mínima
  const sugestoesIA = parsed.parsed?.sugestoes;
  if (!Array.isArray(sugestoesIA) || sugestoesIA.length === 0) {
    return res.status(502).json({
      error: 'IA não retornou sugestões válidas',
      raw: parsed.parsed,
    });
  }

  // 9. Persiste (idempotente: apaga as PENDENTES do dia da vendedora primeiro)
  // FIX 07/05/2026 (Ailson): adicionado .eq('status', 'pendente') pra
  // PRESERVAR sugestoes que a vendedora ja executou ou dispensou. Antes,
  // qualquer regerar (botao 'Atualizar' clicado pela vendedora durante o
  // dia) apagava TUDO incluindo trabalho concluido. Caso real Celia 06/05:
  // ela executou 7 sugestoes ao longo do dia e clicou 'Atualizar' por
  // engano 3 vezes — cada clique apagava as executadas e gerava 7 novas
  // pendentes. Vendedora pensava que 'nao salvou'.
  // Com este fix, executadas/dispensadas ficam imutaveis no historico.
  const hoje = new Date().toISOString().slice(0, 10);
  await supabase
    .from('lojas_sugestoes_diarias')
    .delete()
    .eq('vendedora_id', vendedoraIdAlvo)
    .eq('data_geracao', hoje)
    .eq('status', 'pendente');

  // Sanitiza travessoes (em-dash —, en-dash –) que IA gera por habito mesmo
  // contra instrucao do prompt. Defesa em profundidade. Ailson 18/05/2026.
  // Mantém hifen comum (-) intacto pra palavras compostas (pos-venda etc).
  const semTravessao = (txt) => {
    if (!txt || typeof txt !== 'string') return txt;
    return txt
      .replace(/\s*—\s*/g, ', ')   // em-dash com espacos -> virgula+espaco
      .replace(/\s*–\s*/g, ', ')   // en-dash com espacos -> virgula+espaco
      .replace(/—/g, ', ')          // em-dash colado
      .replace(/–/g, ', ')          // en-dash colado
      .replace(/,\s*,/g, ',')       // limpa virgula dupla se sobrou
      .replace(/\s+/g, ' ')         // colapsa espaços
      .replace(/\s+([.,!?])/g, '$1') // tira espaço antes de pontuação
      .trim();
  };

  // Sanitiza alvo_nome_display — Ailson 18/05/2026 (Sprint A fix bug Karina)
  // Quando IA gera placeholder generico tipo "Sacola antiga (cliente)" ou
  // simplesmente "Cliente" como nome no card, a vendedora manda mensagem
  // sem saber quem e. Sobrescrevemos com apelido REAL do cliente.
  //
  // Carrega apelidos dos clientes-alvo em lote.
  const clienteIdsParaNomes = [...new Set(
    sugestoesIA
      .filter(s => s.alvo_tipo === 'cliente' && s.alvo_id)
      .map(s => s.alvo_id)
  )];
  const apelidoPorCliente = new Map();
  if (clienteIdsParaNomes.length) {
    const { data: clientesData } = await supabase
      .from('lojas_clientes')
      .select('id, apelido, comprador_nome')
      .in('id', clienteIdsParaNomes);
    (clientesData || []).forEach(c => {
      apelidoPorCliente.set(c.id, c.apelido || c.comprador_nome || null);
    });
  }
  const ehPlaceholderGenerico = (nome) => {
    if (!nome || typeof nome !== 'string') return true;
    const t = nome.trim().toLowerCase();
    // Padroes que IA gera quando "nao sabe" o nome
    return /\(cliente\)|^cliente$|sacola.*\(.*\)|^a cliente$|^a aluna$/i.test(t);
  };
  const resolverNomeDisplay = (s) => {
    // Nome em CAIXA ALTA vira Title Case (Ailson 11/06/2026): "MARIA SILVA" →
    // "Maria Silva". Só converte se estiver TODO em maiúsculas (preserva
    // apelidos com capitalização intencional tipo "Lu" ou "Medida Certa Lobo").
    const titleSeCaps = (nome) => {
      if (!nome) return nome;
      const str = String(nome);
      if (str !== str.toUpperCase() || !/[A-ZÀ-Ú]/.test(str)) return str;
      return str.toLowerCase().replace(/(^|\s)([a-zà-ú])/g, (m, sp, ch) => sp + ch.toUpperCase());
    };
    if (s.alvo_tipo !== 'cliente') return titleSeCaps(s.alvo_nome_display) || null;
    const apelidoReal = apelidoPorCliente.get(s.alvo_id);
    if (apelidoReal && ehPlaceholderGenerico(s.alvo_nome_display)) {
      return titleSeCaps(apelidoReal);
    }
    return titleSeCaps(s.alvo_nome_display || apelidoReal) || null;
  };

  // 10. Insere as novas
  const linhas = sugestoesIA.map((s, idx) => ({
    vendedora_id: vendedoraIdAlvo,
    data_geracao: hoje,
    prioridade: s.prioridade ?? (idx + 1),
    tipo: validarTipo(s.tipo),
    subtipo_sacola: s.subtipo_sacola || null,
    alvo_tipo: s.alvo_tipo === 'grupo' ? 'grupo' : 'cliente',
    cliente_id: s.alvo_tipo === 'cliente' ? s.alvo_id : null,
    grupo_id: s.alvo_tipo === 'grupo' ? s.alvo_id : null,
    alvo_nome_display: resolverNomeDisplay(s),
    titulo: semTravessao(s.titulo) || 'Sugestão',
    contexto: semTravessao(s.contexto) || null,
    fatos: Array.isArray(s.fatos) ? s.fatos.map(semTravessao) : null,
    acao_sugerida: semTravessao(s.acao_sugerida) || null,
    produto_ref: s.produto_ref || null,
    produto_nome: s.produto_nome || null,
    promocao_id: s.promocao_id || null,
    fallback_used: !!s.fallback_used,
    // BUG FIX Ailson 20/05/2026: era 'parsed.parsed?.metadados' que pegava
    // metadados GLOBAL e aplicava em TODAS sugestoes. O correto eh pegar
    // 's.metadados' que eh por sugestao. Sem esse fix, trilha_winback_id
    // nunca chegava aqui -> trilhas eternizavam na etapa 1 -> mesma
    // sugestao aparecia dia apos dia (Vanessa reportou repeticoes 20/05).
    metadados_ia: s.metadados || null,
    status: 'pendente',
  }));

  // FALLBACK AUTOMATICO trilha_winback_id (Ailson 20/05/2026):
  // Se a IA esqueceu de preencher metadados.trilha_winback_id em uma
  // sugestao tipo='trilha_winback', backend busca a trilha ativa do
  // cliente+vendedora e injeta. Defesa contra IA esquecer (jah aconteceu).
  try {
    const linhasTrilhaSemId = linhas.filter(l =>
      l.tipo === 'trilha_winback' &&
      l.cliente_id &&
      !l.metadados_ia?.trilha_winback_id
    );
    if (linhasTrilhaSemId.length > 0) {
      const clienteIds = linhasTrilhaSemId.map(l => l.cliente_id);
      const { data: trilhasAtivas } = await supabase
        .from('lojas_trilha_winback')
        .select('id, cliente_id, etapa_atual')
        .eq('vendedora_id', vendedoraId)
        .is('encerrada_em', null)
        .in('cliente_id', clienteIds);
      const mapaTrilhas = {};
      for (const t of (trilhasAtivas || [])) {
        mapaTrilhas[t.cliente_id] = t;
      }
      let preenchidos = 0;
      for (const l of linhasTrilhaSemId) {
        const t = mapaTrilhas[l.cliente_id];
        if (t) {
          l.metadados_ia = {
            ...(l.metadados_ia || {}),
            trilha_winback_id: t.id,
            etapa_trilha: t.etapa_atual,
            fonte_id: 'fallback_backend_20250520',
          };
          preenchidos++;
        }
      }
      if (preenchidos > 0) {
        console.log('[lojas-ia] fallback trilha_winback_id preencheu', preenchidos, 'de', linhasTrilhaSemId.length);
      }
    }
  } catch (e) {
    console.warn('[lojas-ia] fallback trilha_id falhou (nao critico):', e?.message);
  }

  // ═════════════════════════════════════════════════════════════════════════
  // GUARD SACOLA COOLDOWN NO OUTPUT (Ailson 20/05/2026)
  // ═════════════════════════════════════════════════════════════════════════
  // BUG REAL detectado: Joelma teve sugestao de sacola da Gildelucia em 5
  // dias consecutivos (11, 12, 13, 15, 19/05) - intervalos de 1-2-2-4 dias,
  // todos abaixo dos 7d definidos. Filter no INPUT da IA (ctx.sacolas) existe
  // mas IA estava "lembrando" da sacola pelo historicoSugestoes e gerando
  // sugestao tipo='sacola' mesmo sem ela estar em sacolas_ativas.
  //
  // Defesa: pra cada linha que vai ser inserida com tipo='sacola', verifica
  // se cliente_id ja teve sugestao tipo='sacola' nos ultimos 7 dias. Se sim,
  // REJEITA a linha (loga aviso). Resto das sugestoes segue normal.
  // ═════════════════════════════════════════════════════════════════════════
  try {
    const linhasSacola = linhas.filter(l => l.tipo === 'sacola' && l.cliente_id);
    if (linhasSacola.length > 0) {
      const data7dAtras = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
      const clienteIdsSacolaNovas = linhasSacola.map(l => l.cliente_id);
      const { data: sugSacolaRecentes } = await supabase
        .from('lojas_sugestoes_diarias')
        .select('cliente_id, data_geracao, status')
        .eq('vendedora_id', vendedoraId)
        .eq('tipo', 'sacola')
        .gte('data_geracao', data7dAtras)
        .lt('data_geracao', new Date().toISOString().slice(0, 10)) // < hoje
        .in('cliente_id', clienteIdsSacolaNovas);

      if (sugSacolaRecentes && sugSacolaRecentes.length > 0) {
        const clientesBloqueados = new Set(sugSacolaRecentes.map(s => s.cliente_id));
        const linhasFiltradas = linhas.filter(l => {
          if (l.tipo === 'sacola' && l.cliente_id && clientesBloqueados.has(l.cliente_id)) {
            const ultimaSug = sugSacolaRecentes.find(s => s.cliente_id === l.cliente_id);
            console.warn('[lojas-ia] BLOQUEIO sacola cooldown:',
              ctx.vendedoraNome,
              'cliente=' + l.cliente_id,
              'titulo=' + l.titulo,
              'ultima_em=' + ultimaSug?.data_geracao + '/' + ultimaSug?.status);
            return false;
          }
          return true;
        });
        const bloqueadas = linhas.length - linhasFiltradas.length;
        if (bloqueadas > 0) {
          console.warn('[lojas-ia] guard cooldown sacola removeu', bloqueadas, 'de', linhas.length, 'sugestoes');
          linhas.length = 0;
          linhas.push(...linhasFiltradas);
        }
      }
    }
  } catch (e) {
    console.warn('[lojas-ia] guard cooldown sacola falhou (segue normal):', e?.message);
  }

  // ═════════════════════════════════════════════════════════════════════════
  // VALIDADOR JANELA PERFEITA (Ailson 21/05/2026)
  // ═════════════════════════════════════════════════════════════════════════
  // Identifica clientes obrigatorios (>=70% ciclo, sem cooldown, individual)
  // e LOGA quais a IA esqueceu. Nao force INSERT manual pq nao tem mensagem
  // gerada (precisaria chamar IA de novo). Em vez disso, sinaliza pro Ailson
  // via log + grava em metadados_ia.diagnostico_filtros pra auditoria depois.
  //
  // Proxima iteracao: se a IA continuar ignorando, fazer 2a chamada de IA
  // SOMENTE pros obrigatorios esquecidos e SUBSTITUIR as menos urgentes.
  try {
    const obrigatorios = (clientes || []).filter(c => {
      const k = kpis[c.id] || {};
      const j = janela[c.id];
      if (!j?.media_confiavel || !j.media_dias_compras || !k.dias_sem_comprar) return false;
      const pct = k.dias_sem_comprar / j.media_dias_compras;
      const semCooldown = !clientesEmCooldownGeral.has(c.id);
      const naoEmGrupo = !c.grupo_id;
      // OPCAO B (Ailson 21/05/2026): 0.8-1.3 + >=5 visitas
      // Antes: 0.7-1.5 + >=4. Mais conservador, menos falsos positivos.
      // Impacto medido em 21/05: reduz obrigatorios totais de 41 -> 20 (-51%).
      const visitasOk = (j.qtd_datas_unicas || 0) >= 5;
      return visitasOk && pct >= 0.8 && pct <= 1.3 && semCooldown && naoEmGrupo;
    });
    const clienteIdsSugeridos = new Set(linhas.filter(l => l.cliente_id).map(l => l.cliente_id));
    const obrigEsquecidos = obrigatorios.filter(c => !clienteIdsSugeridos.has(c.id));
    if (obrigEsquecidos.length > 0) {
      const nomes = obrigEsquecidos.slice(0, 5).map(c =>
        (c.apelido || c.razao_social?.split(' ')[0] || c.id.substring(0, 8))
      ).join(', ');
      console.warn('[lojas-ia] IA ESQUECEU', obrigEsquecidos.length,
        'clientes janela perfeita:', nomes, '(de', obrigatorios.length, 'obrigatorios)');
    } else if (obrigatorios.length > 0) {
      console.log('[lojas-ia] IA respeitou todos os', obrigatorios.length, 'obrigatorios janela perfeita');
    }
  } catch (e) {
    console.warn('[lojas-ia] validador janela perfeita falhou:', e?.message);
  }

  // ═════════════════════════════════════════════════════════════════════════
  // VALIDADOR SACOLAS (Ailson 21/05/2026)
  // ═════════════════════════════════════════════════════════════════════════
  // Regra (Ailson): ate 2 slots podem ser sacola. Backend ja filtra cooldown
  // 7d. IA decide quais 2 caso a caso. Logo: se ha >=1 sacola no input mas
  // IA gerou ZERO -> sinal de problema (caso real Cleide 21/05: 13 sacolas
  // validas, IA gerou 0). Esse validador so loga ZERO USO quando havia
  // sacolas no input. Nao força reinjecao.
  try {
    const totalSacolasInput = (ctx.sacolas || []).length;
    const totalSacolasGeradas = linhas.filter(l => l.tipo === 'sacola').length;
    if (totalSacolasInput >= 1 && totalSacolasGeradas === 0) {
      const mapCliente = new Map((clientes || []).map(c => [c.id, c]));
      const nomes = (ctx.sacolas || []).slice(0, 3).map(s => {
        const c = mapCliente.get(s.cliente_id);
        return c?.apelido || c?.razao_social?.split(' ')[0] || s.cliente_id?.substring(0, 8);
      }).join(', ');
      console.warn('[lojas-ia] IA IGNOROU TODAS as', totalSacolasInput,
        'sacolas validas:', nomes);
    } else if (totalSacolasInput > 0) {
      console.log('[lojas-ia] sacolas: input=' + totalSacolasInput,
        'sugeridas=' + totalSacolasGeradas, '(max 2)');
    }
  } catch (e) {
    console.warn('[lojas-ia] validador sacolas falhou:', e?.message);
  }

  // ═════════════════════════════════════════════════════════════════════════
  // VALIDADOR FK PRE-INSERT (Ailson 25/05/2026)
  // ═════════════════════════════════════════════════════════════════════════
  // A IA as vezes alucina UUIDs de clientes/grupos que nao existem no banco
  // (caso real Vanessa 25/05: gerou d2f5eabe-... pra "MARIA GORETTI DA"
  //  quando o id real era bab6e623-...). O INSERT em batch viola FK e
  // PERDE AS 7 SUGESTOES inteiras pq eh transacao.
  // Fix: valida cada cliente_id/grupo_id contra o banco. Descarta linhas
  // com FK invalida, ajusta prioridade, segue com as validas. Ailson
  // prefere ter 5/7 sugestoes a perder todas as 7.
  try {
    const clienteIds = [...new Set(linhas.filter(l => l.cliente_id).map(l => l.cliente_id))];
    const grupoIds   = [...new Set(linhas.filter(l => l.grupo_id).map(l => l.grupo_id))];

    const [{ data: clientesOk }, { data: gruposOk }] = await Promise.all([
      clienteIds.length
        ? supabase.from('lojas_clientes').select('id').in('id', clienteIds)
        : Promise.resolve({ data: [] }),
      grupoIds.length
        ? supabase.from('lojas_grupos').select('id').in('id', grupoIds)
        : Promise.resolve({ data: [] }),
    ]);

    const setClientesOk = new Set((clientesOk || []).map(c => c.id));
    const setGruposOk   = new Set((gruposOk   || []).map(g => g.id));

    const total = linhas.length;
    const linhasValidas = linhas.filter(l => {
      if (l.cliente_id && !setClientesOk.has(l.cliente_id)) {
        console.warn(`[lojas-ia] FK invalida — cliente_id ${l.cliente_id} (${l.alvo_nome_display}) nao existe. Descartando sugestao "${l.titulo}".`);
        return false;
      }
      if (l.grupo_id && !setGruposOk.has(l.grupo_id)) {
        console.warn(`[lojas-ia] FK invalida — grupo_id ${l.grupo_id} (${l.alvo_nome_display}) nao existe. Descartando sugestao "${l.titulo}".`);
        return false;
      }
      return true;
    });

    if (linhasValidas.length < total) {
      // Re-numera prioridade pra ficar 1..N continuo
      linhasValidas.forEach((l, i) => { l.prioridade = i + 1; });
      const descartadas = total - linhasValidas.length;
      console.warn(`[lojas-ia] ${descartadas}/${total} sugestoes descartadas por FK invalida. Salvando ${linhasValidas.length}.`);
      linhas.length = 0;
      linhas.push(...linhasValidas);
    }
  } catch (e) {
    // Validacao falhou — segue tentando INSERT, melhor que abortar
    console.warn('[lojas-ia] validador FK falhou:', e?.message);
  }

  if (linhas.length === 0) {
    return res.status(500).json({
      error: 'Erro ao salvar sugestões',
      detalhe: 'Todas as sugestoes da IA tinham cliente_id/grupo_id invalido (alucinacao). Tente novamente.',
    });
  }

  // ─── Fotos anexadas (Ailson 11/06/2026) ─────────────────────────────
  // Resolve fotos das REFs citadas (produto_ref + metadados.refs_fotos):
  // Sofia mídias primeiro (mais recente), ficha técnica complementa.
  // Mín 2 / máx 5. Falha aqui NÃO bloqueia as sugestões.
  // EXCEÇÃO (Ailson 18/06/2026): durante o prazo de promoção, a co-piloto
  // manda o CATÁLOGO DE PROMOÇÃO no lugar das fotos.
  try {
    const { resolverFotosSugestoes, resolverCatalogoPromoAtivo } = await import('./_lojas-fotos-helpers.js');
    const catPromo = await resolverCatalogoPromoAtivo(supabase);
    if (catPromo) {
      for (const l of linhas) { l.catalogo = catPromo; l.fotos = null; }
    } else {
      await resolverFotosSugestoes(supabase, linhas);
    }
  } catch (e) {
    console.warn('[lojas-ia] resolverFotosSugestoes falhou:', e?.message);
  }

  const { error: errIns } = await supabase
    .from('lojas_sugestoes_diarias')
    .insert(linhas);

  if (errIns) {
    console.error('[lojas-ia] erro inserir sugestões:', errIns);
    return res.status(500).json({ error: 'Erro ao salvar sugestões', detalhe: errIns.message });
  }

  // ─── Avança trilhas Win-back que foram usadas — Ailson 13/05/2026 ────
  // IA marca cada sugestão de trilha com metadados.trilha_winback_id.
  // Pra cada uma encontrada, chama lojas_trilha_winback_avancar() que:
  //   - Etapa 1 → 2: avança + data_proxima_msg = D+7
  //   - Etapa 2 → 3: idem
  //   - Etapa 3 → 4: encerra trilha (motivo='concluida_3_semanas')
  // Re-busca sugestões inseridas pra pegar IDs (insert nao retorna)
  try {
    const trilhasUsadas = linhas
      .filter(l => l.metadados_ia?.trilha_winback_id)
      .map(l => ({
        trilha_id: l.metadados_ia.trilha_winback_id,
        cliente_id: l.cliente_id,
      }));

    if (trilhasUsadas.length > 0) {
      // Busca IDs das sugestões recém criadas (data + vendedora + cliente)
      const hojeISO = new Date().toISOString().slice(0, 10);
      const { data: sugIds } = await supabase
        .from('lojas_sugestoes_diarias')
        .select('id, cliente_id')
        .eq('vendedora_id', vendedoraId)
        .eq('data_geracao', hojeISO)
        .eq('tipo', 'trilha_winback');

      for (const t of trilhasUsadas) {
        const sug = (sugIds || []).find(s => s.cliente_id === t.cliente_id);
        try {
          await supabase.rpc('lojas_trilha_winback_avancar', {
            p_trilha_id: t.trilha_id,
            p_sugestao_id: sug?.id || null,
          });
        } catch (e) {
          console.warn('[lojas-ia] avancar trilha falhou:', t.trilha_id, e.message);
        }
      }
      console.log('[lojas-ia]', ctx.vendedoraNome, 'trilhas_avancadas=' + trilhasUsadas.length);
    }
  } catch (e) {
    console.warn('[lojas-ia] erro no avanço de trilhas:', e.message);
    // Não bloqueia o response — trilhas podem ser avançadas no próximo cron
  }

  // ─── Marca aviso como consumido (se havia um) ─────────────────────────
  // Decisão: só marca consumido APOS o INSERT das sugestoes ter dado certo.
  // Se IA falhou ou banco recusou, aviso fica pendente pra retry.
  if (ctx?.avisosDestaVendedora?.length > 0) {
    const avisoId = ctx.avisosDestaVendedora[0].id;
    await supabase
      .from('lojas_avisos')
      .update({ status: 'consumido', consumido_em: new Date().toISOString() })
      .eq('id', avisoId);
  }

  return res.json({
    ok: true,
    sugestoes_criadas: linhas.length,
    metadata: parsed.parsed?.metadados || null,
    usage: r.usage,
    latencia_ms: r.latencia_ms,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// AÇÃO 2: gerar_mensagem (Prompt B)
// ═══════════════════════════════════════════════════════════════════════════

async function handleGerarMensagem(req, res, auth) {
  const sugestaoId = req.body?.sugestao_id;
  const contextoExtra = req.body?.contexto || {};

  if (!sugestaoId) {
    return res.status(400).json({ error: 'sugestao_id obrigatório' });
  }

  // Carrega sugestão
  const { data: sug, error: errSug } = await supabase
    .from('lojas_sugestoes_diarias')
    .select('*')
    .eq('id', sugestaoId)
    .maybeSingle();

  if (errSug) return res.status(500).json({ error: errSug.message });
  if (!sug) return res.status(404).json({ error: 'Sugestão não encontrada' });

  // Permissão
  if (!auth.isAdmin && auth.vendedoraId !== sug.vendedora_id) {
    return res.status(403).json({ error: 'Sem permissão' });
  }

  // Cache: se já tem mensagem gerada nos últimos 5min E sem contextoExtra novo, retorna ela
  const cacheTtlSeg = Number(await getLojasConfig('cache_ttl_seconds', 300));
  if (
    sug.mensagem_gerada &&
    sug.mensagem_gerada_em &&
    !contextoExtra.regerar &&
    Object.keys(contextoExtra).length === 0
  ) {
    const ageSec = (Date.now() - new Date(sug.mensagem_gerada_em).getTime()) / 1000;
    if (ageSec < cacheTtlSeg) {
      return res.json({ ok: true, mensagem: sug.mensagem_gerada, cached: true, fotos: sug.fotos || null, catalogo: sug.catalogo || null });
    }
  }

  // Rate limit
  const rl = await checarRateLimit(sug.vendedora_id);
  if (!rl.ok) {
    return res.status(429).json({
      error: 'Aguarda alguns segundos antes de pedir outra mensagem',
      ms_espera: rl.msEspera,
    });
  }

  // ─── GATE de Contexto — Ailson 13/05/2026 (Sprint B) ────────────────────
  // Algumas sugestões precisam de info da vendedora antes de gerar mensagem
  // boa. Caso atual: trilha_winback etapa 2 ou 3 — vendedora precisa contar
  // o que rolou na semana anterior (cliente respondeu? mandou catálogo?
  // o que ela disse?). Sem isso a IA gera msg genérica de followup.
  //
  // Quando: sug.tipo='trilha_winback' E metadados.etapa_trilha >= 2 E
  //         contextoExtra NÃO traz respostas_contexto.
  // Resposta: 200 { requires_context: true, questions: [...] }
  //          (não é erro — front detecta e abre modal pra vendedora preencher)
  //
  // Após vendedora preencher modal, front chama de novo COM respostas_contexto
  // e este endpoint segue normal (gera mensagem + salva contexto na trilha).
  const etapaTrilha = sug?.metadados_ia?.etapa_trilha || 0;
  const trilhaId = sug?.metadados_ia?.trilha_winback_id || null;
  const precisaContexto = (
    sug.tipo === 'trilha_winback' &&
    etapaTrilha >= 2 &&
    !contextoExtra?.respostas_contexto
  );

  if (precisaContexto) {
    return res.json({
      requires_context: true,
      etapa: etapaTrilha,
      trilha_id: trilhaId,
      titulo_modal: etapaTrilha === 2
        ? `📞 Como foi com ${sug.alvo_nome_display || 'a cliente'} na semana passada?`
        : `📞 E aí, ${sug.alvo_nome_display || 'a cliente'} deu retorno?`,
      questions: [
        {
          id: 'respondeu',
          tipo: 'opcao',
          pergunta: 'Ela respondeu sua última mensagem?',
          opcoes: [
            { valor: 'sim', label: '✅ Sim, respondeu' },
            { valor: 'visualizou', label: '👀 Visualizou e não respondeu' },
            { valor: 'nao', label: '❌ Não respondeu nem visualizou' },
          ],
          obrigatoria: true,
        },
        {
          id: 'o_que_disse',
          tipo: 'opcao',
          pergunta: 'O que ela disse? (se respondeu)',
          opcoes: [
            { valor: 'pediu_prazo', label: '⏳ Pediu prazo / vai pensar' },
            { valor: 'quer_preco', label: '💰 Perguntou preço / desconto' },
            { valor: 'gostou_mas_nao_fechou', label: '👍 Gostou mas não fechou' },
            { valor: 'sem_interesse', label: '🚫 Disse que não tem interesse' },
            { valor: 'outro', label: '✍️ Outro (descreve abaixo)' },
            { valor: 'nao_respondeu', label: 'Pula — não respondeu' },
          ],
          mostrar_se: { respondeu: ['sim', 'visualizou'] },
        },
        {
          id: 'detalhes_extras',
          tipo: 'texto',
          pergunta: 'Algo mais que ajuda a IA escrever? (opcional)',
          placeholder: 'Ex: ela falou da viagem dela, pediu pra esperar o salário, etc',
          obrigatoria: false,
        },
        {
          id: 'mandou_catalogo',
          tipo: 'opcao',
          pergunta: 'Você mandou catálogo ou peça específica?',
          opcoes: [
            { valor: 'sim_catalogo', label: '📋 Mandei catálogo geral' },
            { valor: 'sim_pecas', label: '📸 Mandei peças específicas' },
            { valor: 'nao', label: '❌ Só a mensagem' },
          ],
          obrigatoria: true,
        },
      ],
    });
  }
  // ─── Fim do gate ────────────────────────────────────────────────────────

  // Carrega cliente OU grupo (depende de alvo_tipo) com KPIs
  const ctx = await montarContextoMensagem(sug, contextoExtra);
  if (ctx.erro) return res.status(400).json({ error: ctx.erro });

  // System blocks com cache
  const systemBlocks = montarSystemMensagens(ctx.regrasCustomizadas);

  // Messages (few-shot do tipo da sugestão + user)
  const messages = montarMessagesMensagem(sug, ctx, contextoExtra);

  const modelo = String(await getLojasConfig('modelo_ia', 'claude-sonnet-4-6'));

  const r = await chamarClaude({
    modelo,
    systemBlocks,
    messages,
    max_tokens: 600,
    temperature: 0.85,
    timeoutMs: 30000,
  });

  await logarChamadaIA({
    vendedoraId: sug.vendedora_id,
    userId: auth.userId,
    tipoPrompt: 'mensagem',
    modelo,
    usage: r.usage,
    latencia_ms: r.latencia_ms,
    requestSummary: `sug=${sug.id} tipo=${sug.tipo}`,
    responseSummary: r.ok ? r.texto.slice(0, 500) : null,
    erro: r.ok ? null : r.erro,
  });

  if (!r.ok) {
    return res.status(502).json({ error: 'Erro ao chamar IA', detalhe: r.erro });
  }

  // Ailson 29/05/2026 — rede de segurança: a IA as vezes "pensa em voz alta"
  // (rascunho com markdown/flags) e separa do texto real com '---', mesmo
  // proibido no prompt. Fica so com o que vem DEPOIS do ultimo '---'.
  const textoBruto = r.texto.includes('---')
    ? r.texto.slice(r.texto.lastIndexOf('---') + 3)
    : r.texto;

  // Texto puro (sem cercas markdown) + sanitiza travessões (em-dash —,
  // en-dash –) que IA gera por habito mesmo proibido no prompt.
  // Ailson 18/05/2026 — defesa em profundidade.
  const mensagem = textoBruto
    .replace(/^```(?:[a-z]+)?\s*|\s*```$/g, '')
    .replace(/\s*—\s*/g, ', ')
    .replace(/\s*–\s*/g, ', ')
    .replace(/—/g, ', ')
    .replace(/–/g, ', ')
    .replace(/,\s*,/g, ',')
    .replace(/\s+([.,!?])/g, '$1')
    .trim();

  // Cacheia
  await supabase
    .from('lojas_sugestoes_diarias')
    .update({
      mensagem_gerada: mensagem,
      mensagem_gerada_em: new Date().toISOString(),
    })
    .eq('id', sugestaoId);

  // ─── Sprint B: salva contexto na trilha winback se foi modal ──────────
  // Quando vendedora preencheu modal (semana 2 ou 3), persiste as respostas
  // em lojas_trilha_winback.contexto_s2/s3. Útil pra auditar + pra IA usar
  // referência cruzada se vendedora regerar mensagem.
  if (
    sug.tipo === 'trilha_winback' &&
    contextoExtra?.respostas_contexto &&
    trilhaId
  ) {
    const colunaContexto = etapaTrilha === 2 ? 'contexto_s2' 
                         : etapaTrilha === 3 ? 'contexto_s3' 
                         : null;
    if (colunaContexto) {
      try {
        await supabase
          .from('lojas_trilha_winback')
          .update({ 
            [colunaContexto]: contextoExtra.respostas_contexto,
            updated_at: new Date().toISOString(),
          })
          .eq('id', trilhaId);
      } catch (e) {
        console.warn('[lojas-ia] erro salvar contexto trilha:', e.message);
      }
    }
  }

  return res.json({
    ok: true,
    mensagem,
    cached: false,
    usage: r.usage,
    latencia_ms: r.latencia_ms,
    fotos: sug.fotos || null,
    catalogo: sug.catalogo || null,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// MONTAGEM DE CONTEXTO — gerar_sugestoes
// ═══════════════════════════════════════════════════════════════════════════

async function montarContextoSugestoes(vendedoraId) {
  // Vendedora
  const { data: vendedora, error: errV } = await supabase
    .from('lojas_vendedoras')
    .select('*')
    .eq('id', vendedoraId)
    .maybeSingle();
  if (errV) return { erro: errV.message };
  if (!vendedora) return { erro: 'Vendedora não encontrada' };

  // Carteira (clientes ativos com KPIs)
  const { data: clientes } = await supabase
    .from('lojas_clientes')
    .select('id, documento, tipo_documento, razao_social, nome_fantasia, apelido, comprador_nome, telefone_principal, vendedora_id, grupo_id, pular_ate, canal_cadastro')
    .eq('vendedora_id', vendedoraId)
    .is('arquivado_em', null);

  const clienteIds = (clientes || []).map(c => c.id);

  // KPIs em chunks (limite Supabase)
  const kpis = {};
  for (let i = 0; i < clienteIds.length; i += 200) {
    const chunk = clienteIds.slice(i, i + 200);
    const { data: kpisChunk } = await supabase
      .from('lojas_clientes_kpis')
      .select('*')
      .in('cliente_id', chunk);
    (kpisChunk || []).forEach(k => { kpis[k.cliente_id] = k; });
  }

  // ATENCAO ESPECIAL — view vw_lojas_clientes_atencao_especial (Ailson 06/05/2026)
  // Cliente ativo+confiavel com sinais de mudanca de comportamento (score>=3).
  // IA usa pra priorizar e personalizar mensagem com motivos.
  const atencaoEspecial = {};
  try {
    const { data: aeData } = await supabase
      .from('vw_lojas_clientes_atencao_especial')
      .select('cliente_id, score, motivos, tem_atraso_ciclo, tem_queda_volume, tem_queda_ticket, tem_devolucao')
      .eq('vendedora_id', vendedoraId);
    (aeData || []).forEach(a => { atencaoEspecial[a.cliente_id] = a; });
  } catch (e) {
    console.error('[lojas-ia] erro carregar atencao_especial:', e.message);
  }

  // JANELA DE COMPRA — view vw_lojas_clientes_janela (Ailson 06/05/2026)
  // GAP 1 da auditoria 07/05/2026: IA precisa saber quem esta CONFORTAVEL
  // no ciclo natural (faltam X dias pra entrar na janela = nao precisa mensagem)
  // vs quem PASSOU da janela (esta atrasando o ciclo proprio = ja precisa).
  //
  // Antes da auditoria a IA recebia status_atual mas nao sabia diferenciar:
  //   - cliente media 90d, 60 dias sem comprar = ATIVO (faltam 12d pra atencao)
  //     → NAO mandar mensagem, vai comprar naturalmente
  //   - cliente media 30d, 35 dias sem comprar = ATIVO (passou 5d da janela)
  //     → MANDAR, ele esta atrasando
  //
  // View ja calcula:
  //   - dentro_janela_compra (true/false)
  //   - dias_ate_janela_atencao (positivo = ainda confortavel, negativo = passou)
  //   - media_confiavel
  const janela = {};
  try {
    const { data: jData } = await supabase
      .from('vw_lojas_clientes_janela')
      .select('cliente_id, dias_ate_janela_atencao, dentro_janela_compra, media_confiavel, media_dias_compras, qtd_datas_unicas')
      .eq('vendedora_id', vendedoraId);
    (jData || []).forEach(j => { janela[j.cliente_id] = j; });
  } catch (e) {
    console.error('[lojas-ia] erro carregar janela:', e.message);
  }

  // TRILHA WIN-BACK 3 SEMANAS — Ailson 13/05/2026 (Sprint A)
  // Cliente +3M/+6M fiel (qtd_compras>=4) entra em trilha de 3 mensagens
  // semanais. Trilha SUBSTITUI slot +6M ou +3M correspondente (sugestao A do
  // alinhamento). Cron lojas-trilha-winback-cron cria 2 trilhas/vendedora/segunda.
  //
  // Aqui carregamos as trilhas ATIVAS com msg_pronta_hoje=true. A IA vai
  // priorizar essas clientes nos slots correspondentes.
  const trilhasWinback = [];
  try {
    const { data: trilhasData } = await supabase
      .from('vw_lojas_trilhas_winback_ativas')
      .select('*')
      .eq('vendedora_id', vendedoraId)
      .eq('msg_pronta_hoje', true);
    if (trilhasData) trilhasWinback.push(...trilhasData);
  } catch (e) {
    console.error('[lojas-ia] erro carregar trilhas winback:', e.message);
  }

  // CONVERSOES — Ailson 07/05/2026 (auditoria GAP 2)
  // Cliente que recebeu mensagem em status atencao/semAtividade/inativo e
  // voltou a comprar em ate 15d. Pra IA saber:
  //   1) por cliente: ja converteu antes? quanto tempo demorou?
  //   2) geral da vendedora: total de conversoes ultimos 60d (numero/valor)
  // Usa pra:
  //   - priorizar clientes que historicamente convertem
  //   - tom diferente pra quem ja teve historico de mensagem→compra
  //     ('boa, voltei pra dar uma olhada nas novidades — tem aquele estilo
  //      que vc gosta' em vez de 'oi sumida').
  const conversoesPorCliente = {};
  let conversoesGeral = { qtd_60d: 0, valor_60d: 0, qtd_30d: 0 };
  try {
    const dataLimite = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
    const { data: convData } = await supabase
      .from('lojas_conversoes')
      .select('cliente_id, data_mensagem, data_venda, dias_ate_compra, valor_venda, status_no_envio')
      .eq('vendedora_id', vendedoraId)
      .gte('data_venda', dataLimite);

    const data30d = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

    (convData || []).forEach(c => {
      // Por cliente
      if (!conversoesPorCliente[c.cliente_id]) {
        conversoesPorCliente[c.cliente_id] = {
          total: 0,
          ultima_data_venda: null,
          ultimo_dias_ate_compra: null,
          ultimo_valor: null,
        };
      }
      const slot = conversoesPorCliente[c.cliente_id];
      slot.total++;
      if (!slot.ultima_data_venda || c.data_venda > slot.ultima_data_venda) {
        slot.ultima_data_venda = c.data_venda;
        slot.ultimo_dias_ate_compra = c.dias_ate_compra;
        slot.ultimo_valor = c.valor_venda;
      }
      // Geral
      conversoesGeral.qtd_60d++;
      conversoesGeral.valor_60d += parseFloat(c.valor_venda || 0);
      if (c.data_venda >= data30d) conversoesGeral.qtd_30d++;
    });
    conversoesGeral.valor_60d = Math.round(conversoesGeral.valor_60d * 100) / 100;
  } catch (e) {
    console.error('[lojas-ia] erro carregar conversoes:', e.message);
  }

  // HISTORICO DE SUGESTOES EXECUTADAS — Ailson 07/05/2026 (auditoria GAP 4)
  // Ultimas 28 dias por cliente — IA usa pra NAO REPETIR conteudo:
  //   - mesma REF que ja foi oferecida ha 5 dias
  //   - mesmo tipo (followup, novidade) repetido em sequencia
  //   - mesmo titulo/tema
  // Cooldown geral (7-10d) ja existia mas era binario (pulava cliente).
  // Agora a IA pode SUGERIR a cliente de novo MAS com conteudo DIFERENTE.
  const historicoSugestoes = {};
  try {
    const dataLimiteHist = new Date(Date.now() - 28 * 86400000).toISOString().slice(0, 10);
    const { data: histData } = await supabase
      .from('lojas_sugestoes_diarias')
      .select('cliente_id, grupo_id, data_geracao, tipo, titulo, produto_ref, status')
      .eq('vendedora_id', vendedoraId)
      .gte('data_geracao', dataLimiteHist)
      .in('status', ['executada', 'pendente']) // ignora dispensadas/expiradas
      .order('data_geracao', { ascending: false });

    (histData || []).forEach(h => {
      const key = h.cliente_id || h.grupo_id;
      if (!key) return;
      if (!historicoSugestoes[key]) historicoSugestoes[key] = [];
      // Limita a 5 mais recentes por cliente — suficiente pra IA evitar repetir
      if (historicoSugestoes[key].length < 5) {
        historicoSugestoes[key].push({
          data: h.data_geracao,
          tipo: h.tipo,
          ref: h.produto_ref || null,
          titulo: h.titulo,
        });
      }
    });
  } catch (e) {
    console.error('[lojas-ia] erro carregar historico sugestoes:', e.message);
  }

  // FEEDBACK DIARIO POR CLIENTE — Ailson 18/05/2026 (Sprint A Modal Fechamento)
  // Pra cada cliente DESSA vendedora, ultimas respostas do modal de
  // fechamento (90d, max 3 por cliente). 3 sinais: estado/percepcao/plano.
  // IA usa pra: nao sugerir cliente ja_era+deixar_quieta, modular tom em
  // clientes quietas, ajustar gancho se vendedora indicou plano.
  const feedbackPorCliente = {};
  try {
    const dataLimiteFb = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
    const { data: fbData } = await supabase
      .from('lojas_feedback_diario')
      .select('cliente_id, data_pergunta, data_sugestao, resposta_q1, resposta_q2, resposta_q3, motivo_encerramento')
      .eq('vendedora_id', vendedoraId)
      .gte('data_pergunta', dataLimiteFb)
      .order('data_pergunta', { ascending: false });
    (fbData || []).forEach(f => {
      if (!f.resposta_q1) return; // ignora linhas que vendedora nem comecou
      if (!feedbackPorCliente[f.cliente_id]) feedbackPorCliente[f.cliente_id] = [];
      if (feedbackPorCliente[f.cliente_id].length >= 3) return; // max 3 por cliente
      feedbackPorCliente[f.cliente_id].push({
        data:          f.data_pergunta,
        data_sugestao: f.data_sugestao,
        estado:        f.resposta_q1,
        percepcao:     f.resposta_q2 || null,
        plano:         f.resposta_q3 || null,
        encerramento:  f.motivo_encerramento || 'parcial',
      });
    });
  } catch (e) {
    console.error('[lojas-ia] erro carregar feedback diario:', e.message);
  }

  // Sacolas ativas dessa vendedora
  const { data: sacolasRaw } = await supabase
    .from('lojas_pedidos_sacola')
    .select('*')
    .eq('vendedora_id', vendedoraId)
    .eq('ativo', true);

  // ANTI-REPETIÇÃO sacola: cliente_id sugerido como sacola nos ULTIMOS 7 DIAS
  // fica em cooldown. Decisao Ailson 06/05/2026: ajustado de 5→7d pra alinhar
  // com os outros tipos. Sem isso, mesmo cliente aparecia todo dia.
  const data7diasSacola = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const { data: sacolasRecentes } = await supabase
    .from('lojas_sugestoes_diarias')
    .select('cliente_id')
    .eq('vendedora_id', vendedoraId)
    .eq('tipo', 'sacola')
    .gte('data_geracao', data7diasSacola)
    .not('cliente_id', 'is', null);
  const clientesEmCooldownSacola = new Set(
    (sacolasRecentes || []).map(s => s.cliente_id)
  );

  // ANTI-REPETIÇÃO geral (Ailson 06/05/2026): cliente sugerido em qualquer
  // tipo (exceto sacola — tem regra propria) nos ULTIMOS N DIAS fica em
  // cooldown.
  //
  // N varia conforme tamanho da carteira:
  //   - Carteira >= 100 clientes ativos: cooldown = 10 dias
  //   - Carteira < 100  (ex: Fran tem 78): cooldown = 7 dias
  //     (caso contrario fica sem opcoes pra variar)
  //
  // Conta carteira ANTES dos filtros de pular_ate/kpi_inutil porque o que
  // importa eh o pool disponivel da vendedora, nao o filtrado naquele dia.
  const totalCarteira = (clientes || []).filter(c => !c.arquivado_em).length;
  const cooldownGeralDias = totalCarteira < 100 ? 7 : 10;
  const dataCooldownGeral = new Date(Date.now() - cooldownGeralDias * 86400000).toISOString().slice(0, 10);

  const { data: sugestoesRecentes } = await supabase
    .from('lojas_sugestoes_diarias')
    .select('cliente_id, grupo_id, tipo')
    .eq('vendedora_id', vendedoraId)
    .neq('tipo', 'sacola')
    .gte('data_geracao', dataCooldownGeral);
  // FIX Ailson 21/05/2026: separar Sets pra cliente_id E grupo_id.
  // ANTES o filter so tinha cliente_id e excluia .not('cliente_id','is',null)
  // -> sugestoes de grupo (cliente_id=null, grupo_id=X) passavam INVISIVEIS.
  // CASO REAL: Vanessa/Mari Diez (grupo) apareceu 7 dias seguidos porque
  // grupo_id nao era checado em lugar nenhum. Joelma/Ju idem.
  const clientesEmCooldownGeral = new Set();
  const gruposEmCooldownGeral = new Set();
  (sugestoesRecentes || []).forEach(s => {
    if (s.cliente_id) clientesEmCooldownGeral.add(s.cliente_id);
    if (s.grupo_id) gruposEmCooldownGeral.add(s.grupo_id);
  });

  // FILTRA TRILHAS WINBACK pelo cooldown geral (Ailson 20/05/2026):
  // Mesma regra: cliente contactada nos ultimos 7-10d (qualquer tipo, exceto
  // sacola) nao recebe trilha hoje. data_proxima_msg da trilha NAO eh
  // alterada — proximo cron volta a tentar quando cooldown vencer.
  // Caso real evitado: REGILANIA tinha followup dispensado 18/05 +
  // trilha pendente 20/05 (so 2d entre). Agora trilha so dispara se cliente
  // estiver com cooldown limpo.
  if (trilhasWinback.length > 0) {
    const antes = trilhasWinback.length;
    const filtradas = trilhasWinback.filter(t => !clientesEmCooldownGeral.has(t.cliente_id));
    if (filtradas.length < antes) {
      console.log('[lojas-ia] trilha winback filtrada por cooldown geral:',
        (antes - filtradas.length), 'de', antes);
      trilhasWinback.length = 0;
      trilhasWinback.push(...filtradas);
    }
  }

  // FIX 07/05/2026: garantir que clientes ja TRABALHADOS hoje
  // (executada ou dispensada) NAO voltem em regerar do mesmo dia.
  // Caso real: vendedora executa 6 sugestoes, clica 'Atualizar' por
  // engano, e a IA podia sugerir os mesmos 6 clientes de novo. Com este
  // bloco, os clientes ja contatados/dispensados HOJE entram em cooldown
  // forte.
  const hojeData = new Date().toISOString().slice(0, 10);
  const { data: sugestoesTrabalhadas } = await supabase
    .from('lojas_sugestoes_diarias')
    .select('cliente_id')
    .eq('vendedora_id', vendedoraId)
    .eq('data_geracao', hojeData)
    .in('status', ['executada', 'dispensada'])
    .not('cliente_id', 'is', null);
  (sugestoesTrabalhadas || []).forEach(s => clientesEmCooldownGeral.add(s.cliente_id));

  console.log('[lojas-ia]', vendedora.nome, 'carteira=' + totalCarteira,
    'cooldown_geral=' + cooldownGeralDias + 'd',
    'em_cooldown=' + clientesEmCooldownGeral.size);

  // FILTRO SACOLAS (28/04/2026, decisão Ailson):
  //   - valor_total <= 0 → dado faltante do PDF, descarta
  //   - dias < 6 → muito recente, vendedora ainda monta a sacola
  //   - cliente em cooldown sacola (7 dias) → descarta (decisao 05/05)
  //   - cliente_id IS NULL → descarta (Ailson 20/05/2026): sacola orfa
  //     que nao da pra cadastrar sugestao decente (apareceria como "Sacola
  //     (cliente UUID)" feio). Vendedora regulariza cadastro no Mire
  //     primeiro.
  //   - cliente em grupo → descarta (Ailson 20/05/2026): grupo eh
  //     representado como agregado em ctx.grupos. Sacola individual de
  //     CNPJ em grupo conflita com sugestao tipo='grupo' (caso real:
  //     Cleide/Heloisa H Porto em grupo).
  //   - cliente em COOLDOWN GERAL (Ailson 20/05/2026): mesma regra
  //     7-10d se aplica AGORA a sacola. Antes sacola bypassava (era
  //     "prioridade absoluta"). Decisao: cliente nenhum recebe contato
  //     com menos de 7d, mesmo que tenha sacola nova/atualizada. Caso
  //     real: Fran/ANA LOJA teve novidade 14/05 + sacola amanha 21/05
  //     (7d exatos = no limite). Agora ANA LOJA fica em cooldown ate 22/05.
  // Telemetria pra debug em metadados_ia
  const clientesEmGrupoSet = new Set(
    (clientes || []).filter(c => c.grupo_id).map(c => c.id)
  );
  const sacolasDescartadas = { sem_valor: 0, muito_recente: 0, em_cooldown: 0, sem_cliente: 0, cliente_em_grupo: 0, em_cooldown_geral: 0 };
  const hojeMs = Date.now();
  const sacolas = (sacolasRaw || []).filter(s => {
    const valor = Number(s.valor_total) || 0;
    if (valor <= 0) { sacolasDescartadas.sem_valor++; return false; }
    if (!s.data_cadastro_sacola) { sacolasDescartadas.sem_valor++; return false; }
    if (!s.cliente_id) { sacolasDescartadas.sem_cliente++; return false; }
    const dias = Math.floor((hojeMs - new Date(s.data_cadastro_sacola).getTime()) / 86400000);
    if (dias < 6) { sacolasDescartadas.muito_recente++; return false; }
    if (clientesEmCooldownSacola.has(s.cliente_id)) {
      sacolasDescartadas.em_cooldown++;
      return false;
    }
    if (clientesEmGrupoSet.has(s.cliente_id)) {
      sacolasDescartadas.cliente_em_grupo++;
      return false;
    }
    if (clientesEmCooldownGeral.has(s.cliente_id)) {
      sacolasDescartadas.em_cooldown_geral++;
      return false;
    }
    return true;
  });

  // Grupos da vendedora — Ailson 07/05/2026:
  // Carrega grupos + AGREGADOS calculados a partir dos KPIs dos CNPJs do grupo.
  // BUG REAL ANTERIOR: backend mandava so id+nome+apelido. IA recebia grupo
  // sem dados (sem lifetime, sem ultima_compra, sem qtd_compras, sem status)
  // e nao conseguia gerar sugestao tipo 'grupo'. Resultado: cada CNPJ do
  // grupo virava sugestao separada — Vanessa reportou 4 sugestoes do grupo
  // Sandra em vez de 1.
  // Mesmos calculos que o frontend (Lojas_Telas_Vendedora.jsx linha 2224).
  const { data: gruposRaw } = await supabase
    .from('lojas_grupos')
    .select('id, nome_grupo, apelido, vendedora_id, observacao')
    .eq('vendedora_id', vendedoraId)
    .is('arquivado_em', null);

  // Mapa de cliente_id → kpi pra calcular agregados rapido
  const clientePorId = new Map((clientes || []).map(c => [c.id, c]));

  const grupos = (gruposRaw || []).map(g => {
    const docsDoGrupo = (clientes || []).filter(c => c.grupo_id === g.id);
    if (docsDoGrupo.length === 0) return null;

    const docsKpi = docsDoGrupo.map(c => ({
      cliente_id: c.id,
      apelido: c.apelido || c.comprador_nome || c.razao_social?.split(' ').slice(0, 3).join(' '),
      documento: c.documento,
      kpi: kpis[c.id] || {},
    }));

    const lifetimeGrupo = docsKpi.reduce((s, d) => s + (d.kpi.lifetime_total || 0), 0);
    const qtdComprasGrupo = docsKpi.reduce((s, d) => s + (d.kpi.qtd_compras || 0), 0);
    const qtdPecasGrupo = docsKpi.reduce((s, d) => s + (d.kpi.qtd_pecas || 0), 0);

    // Dias da compra mais recente do grupo (= MIN dos dias_sem_comprar)
    const diasArr = docsKpi.map(d => d.kpi.dias_sem_comprar).filter(v => v != null);
    const diasSemGrupo = diasArr.length ? Math.min(...diasArr) : null;

    // Ultima compra do grupo (= MAX das ultimas_compras)
    const ultimasArr = docsKpi.map(d => d.kpi.ultima_compra).filter(Boolean);
    const ultimaCompraGrupo = ultimasArr.length ? ultimasArr.sort().reverse()[0] : null;

    // Status agregado: pega o MELHOR (mais ativo) dos status individuais
    // Mesma logica do frontend (Ailson 28/04/2026)
    const ordemStatus = ['ativo', 'separandoSacola', 'atencao', 'semAtividade', 'inativo', 'arquivo'];
    const statusGrupo = ordemStatus.find(s =>
      docsKpi.some(d => d.kpi.status_atual === s)
    ) || 'ativo';

    // Doc principal: o que tem maior lifetime
    const docPrincipal = [...docsKpi].sort((a, b) =>
      (b.kpi.lifetime_total || 0) - (a.kpi.lifetime_total || 0)
    )[0];

    // JANELA DE COMPRA AGREGADA DO GRUPO — Ailson 15/05/2026
    // Bug capturado caso Grupo Sandra: comprou ontem (dias_sem_grupo=1) mas IA
    // gerou sugestao 'novidade' proativa achando que era 'momento quente'.
    // Mesmo cliente individual confortavel no ciclo nao recebe novidade
    // proativa — regra DEVE valer pra grupo tambem.
    //
    // Calculo: pega o MIN da media_dias_compras entre docs com media_confiavel.
    // Razao: cliente do grupo com ciclo MAIS CURTO eh o que dita o ritmo
    // natural — se ele acabou de comprar, o grupo nao precisa de empurrao.
    let janelaGrupo = null;
    const docsComJanela = docsKpi
      .map(d => ({ d, j: janela[d.cliente_id] }))
      .filter(x => x.j?.media_confiavel);
    if (docsComJanela.length > 0 && diasSemGrupo != null) {
      const minMediaGrupo = Math.min(...docsComJanela.map(x => Number(x.j.media_dias_compras)));
      // Mesmos multiplicadores das faixas custom individuais:
      // 0.8x = entrada em atencao | 1.2x = entrada em semAtividade
      const limiarAtencao = minMediaGrupo * 0.8;
      const limiarSemAtividade = minMediaGrupo * 1.2;
      let estado;
      if (diasSemGrupo < limiarAtencao) estado = 'confortavel';
      else if (diasSemGrupo < limiarSemAtividade) estado = 'na_janela';
      else estado = 'passou_janela';
      janelaGrupo = {
        media_dias: Math.round(minMediaGrupo),
        dentro_janela: estado === 'na_janela',
        dias_ate_janela: Math.round(limiarAtencao - diasSemGrupo),
        estado,
      };
    }

    return {
      id: g.id,
      nome_grupo: g.nome_grupo,
      apelido: g.apelido,
      observacao: g.observacao,
      // Agregados — mesmo nome dos campos que o prompt usa
      lifetime_grupo: Math.round(lifetimeGrupo * 100) / 100,
      qtd_compras_grupo: qtdComprasGrupo,
      qtd_pecas_grupo: qtdPecasGrupo,
      ticket_medio_grupo: qtdComprasGrupo > 0 ? Math.round(lifetimeGrupo / qtdComprasGrupo) : 0,
      dias_sem_grupo: diasSemGrupo,
      ultima_compra_grupo: ultimaCompraGrupo,
      status_grupo: statusGrupo,
      // JANELA DE COMPRA DO GRUPO (Ailson 15/05/2026) — null se sem media confiavel
      janela_grupo: janelaGrupo,
      doc_principal_id: docPrincipal?.cliente_id,
      doc_principal_apelido: docPrincipal?.apelido,
      // Lista de docs — IA nao deve assumir que cada doc eh loja diferente
      // (pode ser mesma loja com varios CNPJs por questao tributaria).
      docs: docsKpi.map(d => ({
        cliente_id: d.cliente_id,
        apelido: d.apelido,
        dias_sem_comprar: d.kpi.dias_sem_comprar,
        status: d.kpi.status_atual,
        lifetime: Math.round((d.kpi.lifetime_total || 0) * 100) / 100,
        qtd_compras: d.kpi.qtd_compras || 0,
      })),
    };
  }).filter(Boolean)
  // FILTRO COOLDOWN GRUPO (Ailson 21/05/2026):
  // Grupos seguem mesma regra de cliente: nao recebem sugestao se ja foram
  // contactados nos ultimos 7-10 dias. Caso real: Vanessa/Mari Diez (grupo)
  // apareceu 7 dias seguidos antes desse fix.
  .filter(g => {
    if (gruposEmCooldownGeral.has(g.id)) {
      console.log('[lojas-ia] grupo filtrado por cooldown:', g.nome_grupo || g.apelido || g.id);
      return false;
    }
    return true;
  });

  // Produtos oferecíveis (view já filtrada)
  const { data: produtos } = await supabase
    .from('vw_lojas_produtos_oferecveis')
    .select('*')
    .order('score_relevancia', { ascending: false })
    .limit(150);

  // Curadoria ativa
  const hoje = new Date().toISOString().slice(0, 10);
  const { data: curadoria } = await supabase
    .from('lojas_produtos_curadoria')
    .select('ref, tipo, motivo, data_fim')
    .eq('ativo', true)
    .or(`data_fim.is.null,data_fim.gte.${hoje}`);

  // Best sellers e em_alta automáticos.
  // Decisão Ailson 28/04/2026: derivado das vendas REAIS da loja física Amícia
  // (lojas_vendas_itens, populado pelo Relatório BI do Mire). NÃO MISTURAR com
  // vendas Bling (marketplaces, fonte completamente diferente).
  //
  // REGRA REVISADA Ailson 04/05/2026 (sprint curadoria):
  //   • best_sellers = SO MANUAL (Ailson cadastra) — sem auto
  //   • em_alta automatico = curva A (top 10) — não curva B
  //   • curva B nao entra em nada
  //
  // Plus: novidades automaticas (5-12 dias apos entrega da oficina) tambem
  // entram, lidas da view vw_lojas_novidades_auto.
  //
  // Plus: refs em lojas_curadoria_exclusoes nao entram (admin "vetou").
  let bestSellersAuto = [];
  let emAltaAuto = [];
  let novidadesAuto = [];
  let produtosExtras = [];
  try {
    // Carrega exclusoes do admin pra filtrar todos os automaticos
    const { data: excluidasRaw } = await supabase
      .from('lojas_curadoria_exclusoes')
      .select('ref, tipo');
    const excluidas = excluidasRaw || [];
    const setExclEm = new Set(excluidas.filter(e => e.tipo === 'em_alta').map(e => e.ref));
    const setExclNov = new Set(excluidas.filter(e => e.tipo === 'novidade_manual').map(e => e.ref));

    // Em alta = curva A (top 10) — REVISADO 04/05/2026
    const { data: topVendas } = await supabase
      .from('vw_lojas_top_vendas_loja_fisica')
      .select('ref, curva, posicao_ranking, pecas_45d')
      .eq('curva', 'a')
      .order('posicao_ranking', { ascending: true })
      .limit(10);
    emAltaAuto = (topVendas || [])
      .map(r => r.ref)
      .filter(ref => !setExclEm.has(ref));
    // bestSellersAuto fica vazio — best_seller e SO manual agora

    // Novidades automaticas — refs entregues pela oficina ha 5-12 dias.
    // View criada em sql/lojas-curadoria-exclusoes.sql.
    const { data: novidadesRaw } = await supabase
      .from('vw_lojas_novidades_auto')
      .select('ref');
    novidadesAuto = (novidadesRaw || [])
      .map(n => n.ref)
      .filter(ref => !setExclNov.has(ref));

    // A view vw_lojas_produtos_oferecveis filtra por estoque>100. REFs top
    // que vendem muito podem ter estoque BAIXO justamente por isso. Tambem
    // REFs antigas (descontinuadas mas ainda em estoque) ficam fora da view.
    // Buscamos direto em lojas_produtos pra IA enxergar.
    //
    // INCLUI tambem REFs da CURADORIA MANUAL (best_seller/em_alta/novidade_manual).
    // Sem isso, REFs marcadas pelo Ailson como best_seller mas que cairam fora
    // da view (peças classicas, sem destaque recente) ficavam invisiveis pra IA
    // — bug detectado 30/04/2026: dos 8 best_sellers manuais cadastrados,
    // todos estavam fora de vw_lojas_produtos_oferecveis.
    const refsCuradoriaManual = (curadoria || []).map(c => c.ref);
    const todasExtras = [...new Set([
      ...emAltaAuto,
      ...novidadesAuto,
      ...refsCuradoriaManual,
    ])];

    // Map ref -> tipo de curadoria (pra setar motivo_oferta correto)
    const curadoriaTipoPorRef = new Map(
      (curadoria || []).map(c => [c.ref, c.tipo])
    );

    if (todasExtras.length > 0) {
      const { data: extras } = await supabase
        .from('lojas_produtos')
        .select('ref, descricao, categoria, qtd_estoque')
        .in('ref', todasExtras);
      produtosExtras = (extras || [])
        .filter(p => p.descricao)
        .map(p => {
          // Curadoria manual tem PRIORIDADE no motivo_oferta.
          const tipoCurMan = curadoriaTipoPorRef.get(p.ref);
          let motivo;
          if (tipoCurMan === 'novidade_manual') motivo = 'novidade_oficina';
          else if (tipoCurMan === 'best_seller') motivo = 'best_seller';
          else if (tipoCurMan === 'em_alta') motivo = 'em_alta';
          else if (novidadesAuto.includes(p.ref)) motivo = 'novidade_oficina';
          else if (emAltaAuto.includes(p.ref)) motivo = 'em_alta';
          else motivo = 'em_alta';

          return {
            ref: p.ref,
            descricao: p.descricao,
            categoria: p.categoria,
            qtd_estoque: p.qtd_estoque,
            motivo_oferta: motivo,
          };
        });
    }
  } catch (e) {
    console.warn('[lojas-ia] sem top vendas loja fisica (view ausente?):', e?.message);
  }

  // Junta produtos da view + extras da loja fisica. Dedup por REF.
  const refsView = new Set((produtos || []).map(p => p.ref));
  const produtosFinal = [
    ...(produtos || []),
    ...produtosExtras.filter(p => !refsView.has(p.ref)),
  ];

  // ─── TOP 3 REFs POR CLIENTE (decisão Ailson 28/04/2026) ───────────────
  // Cliente compra "bem" uma REF se ela está no top 3 dela (score mesclado
  // peças×0.7 + recorrência×3.0). Usado pra:
  //   1. IA saber quando dizer "esse modelo vende bem pra você"
  //   2. Detectar reposição: REF do top do cliente disponível em estoque
  //   3. Alternar entre os 3 ao longo dos dias (anti-monotonia)
  //
  // Mapa REF -> estoque (pra anotar em_estoque em cada top_ref do cliente).
  // Decisão Ailson 30/04/2026: ampliar conceito de reposicao — não precisa
  // ser novidade da oficina; basta a REF estar em estoque relevante hoje.
  const ESTOQUE_MIN_REPOSICAO = 50;
  const estoqueDisponivelPorRef = new Map();
  for (const p of produtosFinal) {
    estoqueDisponivelPorRef.set(p.ref, p.qtd_estoque || 0);
  }

  const topRefsPorCliente = {};
  if (clienteIds.length > 0) {
    try {
      // Em chunks pra não estourar limite Supabase
      for (let i = 0; i < clienteIds.length; i += 200) {
        const chunk = clienteIds.slice(i, i + 200);
        const { data: tops } = await supabase
          .from('vw_lojas_top_refs_por_cliente')
          .select('cliente_id, ref, posicao, pecas_total, vezes_comprou')
          .in('cliente_id', chunk)
          .order('posicao', { ascending: true });
        for (const r of tops || []) {
          if (!topRefsPorCliente[r.cliente_id]) topRefsPorCliente[r.cliente_id] = [];
          const estoqueAtual = estoqueDisponivelPorRef.get(r.ref) || 0;
          topRefsPorCliente[r.cliente_id].push({
            ref: r.ref,
            posicao: r.posicao,
            pecas_total: r.pecas_total,
            vezes_comprou: r.vezes_comprou,
            // em_estoque=true → IA pode oferecer essa REF como REPOSICAO
            // (cliente compra bem + temos estoque hoje). Sinal explícito
            // pra IA não ter que cruzar listas mentalmente.
            em_estoque: estoqueAtual >= ESTOQUE_MIN_REPOSICAO,
            qtd_estoque: estoqueAtual,
          });
        }
      }
    } catch (e) {
      console.warn('[lojas-ia] sem top refs por cliente (view ausente?):', e?.message);
    }
  }

  // ─── CATEGORIAS FREQUENTES POR CLIENTE (decisão Ailson 30/04/2026) ────
  // Além das top 3 REFs específicas, IA também precisa saber em quais
  // CATEGORIAS (calça, blusa, vestido, macacão...) cada cliente compra
  // muito. Isso permite oferecer uma novidade/best_seller que é dessa
  // categoria mesmo quando a REF não está no top 3 específico dela.
  // Threshold "dominante" = pct >= 30% (config DOMINANTE_PCT_MIN).
  const DOMINANTE_PCT_MIN = 30;
  const categoriasFreqPorCliente = {}; // { cliente_id: [{categoria, pct, pecas}, ...] }
  if (clienteIds.length > 0) {
    try {
      for (let i = 0; i < clienteIds.length; i += 200) {
        const chunk = clienteIds.slice(i, i + 200);
        const { data: cats } = await supabase
          .from('vw_lojas_categorias_freq_por_cliente')
          .select('cliente_id, categoria, pct, pecas')
          .in('cliente_id', chunk)
          .order('pct', { ascending: false });
        for (const r of cats || []) {
          if (!categoriasFreqPorCliente[r.cliente_id]) categoriasFreqPorCliente[r.cliente_id] = [];
          categoriasFreqPorCliente[r.cliente_id].push({
            categoria: r.categoria,
            pct: Number(r.pct) || 0,
            pecas: r.pecas,
            // dominante = cliente compra MUITO essa categoria. Sinal pro
            // prompt usar como gatilho de "oferecer novidade da categoria
            // mesmo sem REF específica no top".
            dominante: Number(r.pct) >= DOMINANTE_PCT_MIN,
          });
        }
      }
    } catch (e) {
      console.warn('[lojas-ia] sem categorias freq por cliente (view ausente?):', e?.message);
    }
  }

  // ─── MAIS VENDIDOS 45d (categoria de produtos no payload) ─────────────
  // Decisão Ailson 28/04/2026: top 10 vendas 45d (loja física) entra como
  // categoria PRÓPRIA no produtos_disponiveis (não vira slot, é só repertório).
  // Texto sugerido: "Esse modelo tá saindo super bem na loja, quer ver?"
  // ATUALIZADO 04/05/2026: emAltaAuto agora e o top 10 curva A (era curva B
  // antes da correcao da regra). Usamos emAltaAuto que tem o top 10 real.
  const maisVendidos45d = emAltaAuto.slice(0, 10);

  // ─── REPOSIÇÃO: REFs ja vendidas, em janela de reposicao ─────────
  //
  // Decisão Ailson 28/04/2026: tipo NOVO de sugestão. Quando IA pega uma
  // novidade da oficina e essa REF já existe em vendas anteriores, é
  // REPOSIÇÃO (não novidade pura). Substitui 1 slot de novidade ou followup.
  //
  // BUG CRITICO CORRIGIDO 04/05/2026:
  // Codigo anterior lia de 'produtos' (vw_lojas_produtos_oferecveis) filtrando
  // motivo_oferta='novidade_oficina'. MAS:
  //   - lojas_produtos.data_entrega_oficina NUNCA foi populado (NULL pra todos)
  //   - lojas_produtos.motivo_pode_oferecer NUNCA recebeu 'novidade_oficina'
  // Resultado: refsReposicao=[] sempre.
  //
  // SOLUCAO 04/05/2026: view vw_lojas_reposicoes_auto faz tudo:
  //   - Cortes Amícia entregues
  //   - Janela 5-10d (sem caseado) ou 7-12d (com caseado, lido da ficha técnica)
  //   - REF tem que ter vendido alguma vez antes (EXISTS lojas_vendas_itens)
  // Plus: refs em curadoria manual 'novidade_manual' que ja venderam tambem
  // entram (admin marcou como novidade, mas ja tinha historico → reposição).
  let refsReposicao = [];
  try {
    const { data: repoRaw } = await supabase
      .from('vw_lojas_reposicoes_auto')
      .select('ref');
    refsReposicao = (repoRaw || []).map(r => r.ref);

    // Inclui curadoria manual de novidade que ja vendeu antes.
    const refsCuradoriaNovidade = (curadoria || [])
      .filter(c => c.tipo === 'novidade_manual')
      .map(c => c.ref);
    if (refsCuradoriaNovidade.length > 0) {
      const { data: vendaAnt } = await supabase
        .from('lojas_vendas_itens')
        .select('ref')
        .in('ref', refsCuradoriaNovidade)
        .limit(500);
      const refsManualComVenda = new Set((vendaAnt || []).map(v => v.ref));
      // Adiciona sem duplicar
      const setRepo = new Set(refsReposicao);
      for (const r of refsCuradoriaNovidade) {
        if (refsManualComVenda.has(r) && !setRepo.has(r)) {
          refsReposicao.push(r);
        }
      }
    }
  } catch (e) {
    console.warn('[lojas-ia] sem reposicoes (view ausente?):', e?.message);
  }

  // Promoções ativas (exclui as 'catalogo_gate' — essas servem só de prazo pro
  // anexo do catálogo na co-piloto, não viram texto no prompt. Ailson 18/06/2026)
  const { data: promocoes } = await supabase
    .from('lojas_promocoes')
    .select('id, nome_curto, descricao_completa, categoria, data_inicio, data_fim, pedido_minimo, desconto_pct')
    .eq('ativo', true)
    .neq('categoria', 'catalogo_gate')
    .gte('data_fim', hoje)
    .order('data_fim');

  // ─── AÇÕES VIGENTES (Ailson 30/04/2026) ───────────────────────────────
  // Mensagens contextuais que a IA INCORPORA nas sugestões (não consome
  // slot). Ex: "feliz dia das mulheres", "loja fecha mais cedo na quinta".
  const { data: acoesVigentes } = await supabase
    .from('lojas_contextos_ia')
    .select('id, texto, data_inicio, data_fim')
    .eq('ativa', true)
    .lte('data_inicio', hoje)
    .gte('data_fim', hoje);

  // ─── CAMPANHA: compradores de promoção (Ailson 17/06/2026) ─────────────
  // Durante a campanha 30% off (17→22/06), a IA prioriza clientes DESTA
  // vendedora que já compraram em promoção antes — ordem ativo > atencao >
  // semAtividade (prioridade 1..3 na view). Alvo: 4 cards/dia. A mensagem do
  // 30% vem da Ação vigente (incorporada automaticamente).
  const CAMPANHA_PROMO_INI = '2026-06-17';
  const CAMPANHA_PROMO_FIM = '2026-06-22';
  let compradoresPromo = [];
  if (hoje >= CAMPANHA_PROMO_INI && hoje <= CAMPANHA_PROMO_FIM) {
    const { data: cp } = await supabase
      .from('vw_lojas_compradores_promo')
      .select('cliente_id, status_atual, prioridade, promo_recorrente, compras_promo, ult_compra_promo')
      .lte('prioridade', 3)
      .order('prioridade', { ascending: true })
      .order('promo_recorrente', { ascending: false })
      .order('ult_compra_promo', { ascending: false })
      .limit(500);
    const ids = (cp || []).map(x => x.cliente_id);
    if (ids.length) {
      const { data: meus } = await supabase
        .from('lojas_clientes')
        .select('id, apelido, comprador_nome, razao_social')
        .eq('vendedora_id', vendedoraId)
        .in('id', ids);
      const nomeDe = {};
      (meus || []).forEach(c => { nomeDe[c.id] = c.apelido || c.comprador_nome || (c.razao_social ? c.razao_social.split(' ').slice(0, 3).join(' ') : 'cliente'); });
      compradoresPromo = (cp || [])
        .filter(x => nomeDe[x.cliente_id] !== undefined)
        .slice(0, 12)
        .map(x => ({ cliente_id: x.cliente_id, apelido: nomeDe[x.cliente_id], status: x.status_atual, recorrente: x.promo_recorrente, compras_promo: x.compras_promo }));
    }
  }

  // ─── AVISO DEDICADO PRO DIA ───────────────────────────────────────────
  // Disparo único pra essa vendedora (ou todas) hoje. IA cria sugestão
  // dedicada no slot 1 e marca como consumido após o cron.
  // vendedoras_ids vazio/null = todas; senão filtra.
  const { data: avisosHoje } = await supabase
    .from('lojas_avisos')
    .select('id, texto, vendedoras_ids, cliente_id')
    .eq('status', 'pendente')
    .eq('data_disparo', hoje);

  // Filtra avisos que pertencem a essa vendedora (todas OU explicitamente
  // selecionada). Pode ter mais de 1, mas só consideramos o primeiro como
  // slot dedicado — outros viram "ver também" no contexto.
  // EXCLUI avisos VENDA_SITE_ORGANICA — esses são pins celebrativos
  // renderizados pelo frontend, nao viram sugestao da IA. (Ailson 18/05/2026)
  const avisosDestaVendedora = (avisosHoje || []).filter(a =>
    !(a.texto || '').startsWith('[VENDA_SITE_ORGANICA]')
    && (
      !a.vendedoras_ids
      || a.vendedoras_ids.length === 0
      || a.vendedoras_ids.includes(vendedoraId)
    )
  );

  // ─── CORES EM ALTA (Ailson 30/04/2026, semantica opt-in + fallback auto 20/05/2026)
  // 1a opcao: lojas_cores_curadoria_manual (admin opt-in - ativa cores no UI)
  // 2a opcao (fallback Ailson 20/05/2026): se manual vazia, usa top 6 do Bling
  // automaticamente. Senao a IA nunca fala de cor (problema relatado: ele criou
  // a regra mas a curadoria estava vazia, IA nunca usava).
  // Admin pode SOBRESCREVER o automatico ativando cores manuais (que vem 1o
  // entao tem prioridade).
  const coresEmAlta = [];
  try {
    const { data: coresManuais } = await supabase
      .from('lojas_cores_curadoria_manual')
      .select('cor, cor_key, motivo')
      .eq('ativa', true);
    for (const c of coresManuais || []) {
      coresEmAlta.push({
        cor: c.cor,
        cor_key: c.cor_key,
        fonte: c.motivo === 'top_bling_selecionada' ? 'bling_auto' : 'manual',
        motivo: c.motivo,
      });
    }

    // Fallback automatico: se admin nao curou nada, usa as 6 cores das
    // posicoes 3-8 do Bling (PULA Preto e Bege que sao top 1-2 - Ailson
    // 20/05/2026: sao obvias, todo mundo ja sabe que vendem, IA fica
    // repetitiva). Cores 3-8 trazem variedade real (Marrom, Azul Marinho,
    // Figo, Verde Militar, Caramelo, Nude).
    if (coresEmAlta.length === 0) {
      const { data: coresAutoBling } = await supabase
        .from('vw_ranking_cores_catalogo')
        .select('cor, cor_key, vendas_30d, rank_global')
        .eq('elegivel_gate1', true)
        .gte('rank_global', 3) // pula rank 1-2 (Preto + Bege)
        .lte('rank_global', 8) // pega ate rank 8 (6 cores variadas)
        .order('rank_global', { ascending: true });
      for (const c of coresAutoBling || []) {
        coresEmAlta.push({
          cor: c.cor,
          cor_key: c.cor_key,
          fonte: 'fallback_bling_30d_rank3a8',
          motivo: `top vendas 30d, rank ${c.rank_global} (${c.vendas_30d} peças)`,
        });
      }
    }
  } catch (e) {
    console.warn('[lojas-ia] cores indisponiveis:', e?.message);
  }

  // Regras customizadas (do RegrasScreen)
  const [tomGeral, posicionamento, sempre, nunca, descontoReat, descontoAten, saudacao, fechamento] = await Promise.all([
    getLojasConfig('regras_ia.tom_geral', null),
    getLojasConfig('regras_ia.posicionamento', null),
    getLojasConfig('regras_ia.sempre', null),
    getLojasConfig('regras_ia.nunca', null),
    getLojasConfig('parametros.desconto_reativacao', 10),
    getLojasConfig('parametros.desconto_atencao', 5),
    getLojasConfig('parametros.saudacao_padrao', null),
    getLojasConfig('parametros.fechamento_padrao', null),
  ]);

  // ─── RAIO-X PRODUTOS — acrescimos no cardapio (Ailson 06/05/2026) ─────
  // Carrega dados das views do raio-x pra IA usar como gatilhos extras:
  //   1. top_recompra: refs com mais ocorrencias (90d) — usar em followup_nova
  //      (cliente que comprou 1a vez ha 15d)
  //   2. matches_por_ref: pra cada uma das top 30 refs, suas top 5 matches
  //      (a IA usa pra reposicao + cliente ativa + match dos top 3 do cliente)
  //
  // Essas views sao admin-only no endpoint /api/lojas-produtos-raiox, mas
  // aqui estamos no backend com service_role — pode ler direto.
  let topRecompra = [];
  let matchesPorRef = {};
  try {
    // Top 10 refs em recompra (agregado todas lojas)
    const { data: recRows } = await supabase
      .from('vw_lojas_recompra_90d')
      .select('ref, ocorrencias');
    if (recRows) {
      const aggMap = new Map();
      for (const r of recRows) {
        aggMap.set(r.ref, (aggMap.get(r.ref) || 0) + Number(r.ocorrencias || 0));
      }
      topRecompra = [...aggMap.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([ref, ocorr]) => {
          const p = produtosFinal.find(pp => pp.ref === ref);
          return {
            ref,
            ocorrencias: ocorr,
            descricao: p?.descricao || null,
            categoria: p?.categoria || null,
            qtd_estoque: p?.qtd_estoque || 0,
          };
        });
    }

    // Matches da materialized view (top 5 por ref)
    const { data: matchRows } = await supabase
      .from('mv_lojas_matches_90d')
      .select('ref_top, ref_match, pct, coocorrencias')
      .order('ref_top')
      .order('pct', { ascending: false });
    if (matchRows) {
      for (const m of matchRows) {
        if (!matchesPorRef[m.ref_top]) matchesPorRef[m.ref_top] = [];
        if (matchesPorRef[m.ref_top].length < 5) {
          const p = produtosFinal.find(pp => pp.ref === m.ref_match);
          matchesPorRef[m.ref_top].push({
            ref_match: m.ref_match,
            pct: m.pct,
            coocorrencias: m.coocorrencias,
            descricao: p?.descricao || null,
            categoria: p?.categoria || null,
            qtd_estoque: p?.qtd_estoque || 0,
          });
        }
      }
    }
  } catch (e) {
    console.warn('[lojas-ia] sem dados raiox (views ausentes?):', e?.message);
  }

  return {
    vendedoraNome: vendedora.nome,
    vendedoraId,
    vendedora: { id: vendedora.id, nome: vendedora.nome, loja: vendedora.loja },
    clientes: clientes || [],
    kpis,
    atencaoEspecial,         // { cliente_id: {score, motivos, tem_atraso_ciclo, ...} } — Ailson 06/05/2026
    janela,                  // { cliente_id: {dias_ate_janela_atencao, dentro_janela_compra, media_confiavel} } — Ailson 07/05/2026 (auditoria GAP 1)
    trilhasWinback,          // [{ trilha_id, cliente_id, cliente_nome, etapa_atual, status_inicial, mensagem_anterior, ... }] — Ailson 13/05/2026 (Sprint A)
    conversoesPorCliente,    // { cliente_id: {total, ultima_data_venda, ultimo_dias_ate_compra, ultimo_valor} } — Ailson 07/05/2026 (auditoria GAP 2)
    conversoesGeral,         // { qtd_60d, valor_60d, qtd_30d } — agregado da vendedora
    historicoSugestoes,      // { cliente_id|grupo_id: [{data, tipo, ref, titulo}, ...max 5] } — Ailson 07/05/2026 GAP 4
    feedbackPorCliente,      // { cliente_id: [{data, estado, percepcao, plano, encerramento}, ...max 3] } — Ailson 18/05/2026 Sprint A
    sacolas: sacolas || [],
    sacolasDescartadas,
    grupos: grupos || [],
    produtos: produtosFinal,
    curadoria: curadoria || [],
    bestSellersAuto,
    emAltaAuto,
    maisVendidos45d,         // top 10 vendas 45d (categoria mais_vendidos)
    topRefsPorCliente,       // { cliente_id: [{ref, posicao, pecas, vezes}] }
    categoriasFreqPorCliente, // { cliente_id: [{categoria, pct, pecas, dominante}] }
    refsReposicao,           // [ref] — novidades que já tinham venda passada
    topRecompra,             // top 10 refs com mais ocorrencias (90d) — Ailson 06/05/2026
    matchesPorRef,           // { ref: [{ref_match, pct, coocorrencias, ...}] } — Ailson 06/05/2026
    clientesEmCooldownGeral, // Set<cliente_id> sugeridos nos ultimos N dias (nao-sacola) — Ailson 06/05/2026
    cooldownGeralDias,       // 7 ou 10 dependendo do tamanho da carteira
    totalCarteira,           // tamanho da carteira da vendedora (pra IA priorizar conversao em carteiras pequenas)
    promocoes: promocoes || [],
    acoesVigentes: acoesVigentes || [],
    compradoresPromo,
    avisosDestaVendedora,
    coresEmAlta,
    // Link Vesti escolhido pela vendedora (pode ser null = livre)
    vestiLinkAtivo: vendedora.vesti_link_ativo
      ? (vendedora[`vesti_link_${vendedora.vesti_link_ativo}`] || null)
      : null,
    regrasCustomizadas: {
      tomGeral, posicionamento, sempre, nunca,
      descontoReat, descontoAten, saudacao, fechamento,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// MONTAGEM DE CONTEXTO — gerar_mensagem
// ═══════════════════════════════════════════════════════════════════════════

async function montarContextoMensagem(sug, contextoExtra) {
  let cliente = null, grupo = null, kpi = null, docsGrupo = [];

  if (sug.alvo_tipo === 'cliente' && sug.cliente_id) {
    const { data: c } = await supabase
      .from('lojas_clientes')
      .select('*')
      .eq('id', sug.cliente_id)
      .maybeSingle();
    cliente = c;

    const { data: k } = await supabase
      .from('lojas_clientes_kpis')
      .select('*')
      .eq('cliente_id', sug.cliente_id)
      .maybeSingle();
    kpi = k;
  } else if (sug.alvo_tipo === 'grupo' && sug.grupo_id) {
    const { data: g } = await supabase
      .from('lojas_grupos')
      .select('*')
      .eq('id', sug.grupo_id)
      .maybeSingle();
    grupo = g;

    const { data: docs } = await supabase
      .from('lojas_clientes')
      .select('*')
      .eq('grupo_id', sug.grupo_id);
    docsGrupo = docs || [];
  } else {
    return { erro: 'Sugestão sem cliente/grupo válido' };
  }

  // Produto referenciado (se houver)
  let produto = null;
  if (sug.produto_ref) {
    const refNorm = refSemZero(sug.produto_ref);
    const { data: p } = await supabase
      .from('lojas_produtos')
      .select('ref, descricao, categoria, qtd_estoque, preco_medio')
      .eq('ref', refNorm)
      .maybeSingle();
    produto = p;
  }

  // Promoção referenciada (se houver)
  let promocao = null;
  if (sug.promocao_id) {
    const { data: p } = await supabase
      .from('lojas_promocoes')
      .select('id, nome_curto, descricao_completa, categoria, data_fim, desconto_pct, pedido_minimo')
      .eq('id', sug.promocao_id)
      .maybeSingle();
    promocao = p;
  }

  // Top 6 cores do ranking Bling — pra IA mencionar UMA cor real na mensagem
  // (gancho do tipo "tem cor que tá acabando").
  // Fonte: vw_ranking_cores_catalogo (mesma view usada pelo OS Amícia).
  let coresTop = [];
  try {
    const { data: cores } = await supabase
      .from('vw_ranking_cores_catalogo')
      .select('cor, vendas_30d')
      .order('vendas_30d', { ascending: false })
      .limit(6);
    coresTop = (cores || []).map(c => c.cor).filter(Boolean);
  } catch (e) {
    console.warn('[lojas-ia/mensagem] sem cores top:', e?.message);
  }

  // Regras customizadas (mesmas que sugestões)
  const [tomGeral, posicionamento, sempre, nunca, saudacao, fechamento] = await Promise.all([
    getLojasConfig('regras_ia.tom_geral', null),
    getLojasConfig('regras_ia.posicionamento', null),
    getLojasConfig('regras_ia.sempre', null),
    getLojasConfig('regras_ia.nunca', null),
    getLojasConfig('parametros.saudacao_padrao', null),
    getLojasConfig('parametros.fechamento_padrao', null),
  ]);

  // Link Vesti da vendedora (Ailson 12/05/2026) — bug fix:
  // mensagem pra cliente Vesti deve incluir o link cadastrado pela vendedora.
  // Antes, montarContextoSugestoes carregava esse campo, mas
  // montarContextoMensagem nao — entao a IA escrevia "te mando o link"
  // sem ter como colar URL nenhuma. Agora carrega e expoe via vestiLinkAtivo.
  let vestiLinkAtivo = null;
  try {
    const { data: vend } = await supabase
      .from('lojas_vendedoras')
      .select('vesti_link_ativo, vesti_link_1, vesti_link_2, vesti_link_3')
      .eq('id', sug.vendedora_id)
      .maybeSingle();
    if (vend?.vesti_link_ativo) {
      vestiLinkAtivo = vend[`vesti_link_${vend.vesti_link_ativo}`] || null;
    }
  } catch (e) {
    console.warn('[lojas-ia/mensagem] sem vesti_link:', e?.message);
  }

  // Estilo aprendido da vendedora (Ailson 04/05/2026): IA usa as edicoes
  // anteriores dela como referencia pra gerar mensagem mais parecida com o
  // jeito dela escrever. So entra no prompt se houver pelo menos 1 edicao.
  //
  // REFERENCIA VIVA — Ailson 07/05/2026:
  // Se vendedora B tem chave aprende_com.<B> = <A>, IA busca estilo de A
  // em vez de B. Permite admin definir vendedora top como referencia
  // pra outras imitarem. Estilo de A continua evoluindo (A continua
  // editando), B sempre acompanha automaticamente.
  let estiloVendedora = null;
  let estiloVendedoraOrigemId = sug.vendedora_id; // por default usa o proprio
  try {
    const { data: aprendeRow } = await supabase
      .from('lojas_config')
      .select('valor')
      .eq('chave', `aprende_com.${sug.vendedora_id}`)
      .maybeSingle();
    if (aprendeRow?.valor) {
      estiloVendedoraOrigemId = aprendeRow.valor; // redireciona pra referencia
    }

    // ═════════════════════════════════════════════════════════════════════════
    // PREFERE ANÁLISE ESTRUTURADA (Ailson 21/05/2026)
    // ═════════════════════════════════════════════════════════════════════════
    // Filosofia: vendedora ensina TEMPERO, não RECEITA.
    // - IA tem cardapio AMPLO de aberturas/finalizacoes (17+10 variacoes no prompt).
    // - Vendedora contribui com vocabulario, emojis, pontuacao, tom — INGREDIENTES.
    // - IA aplica esses ingredientes SOBRE seu cardapio amplo, nao copia frases.
    //
    // Antes pegava 2 edicoes inteiras como few-shot e a IA copiava o esqueleto.
    // Agora: 1) tenta analise estruturada de lojas_config.analise_estilo.X
    //       2) se nao tem, fallback pra contadores simples + tag de degradado
    const { data: analiseRow } = await supabase
      .from('lojas_config')
      .select('valor')
      .eq('chave', `analise_estilo.${estiloVendedoraOrigemId}`)
      .maybeSingle();

    const analise = analiseRow?.valor;

    const { data: estilo } = await supabase
      .from('lojas_estilo_vendedora')
      .select('*')
      .eq('vendedora_id', estiloVendedoraOrigemId)
      .maybeSingle();

    if (analise && analise.estruturado) {
      // CASO IDEAL: analise estruturada via Claude (lojas-analisar-estilo)
      const e = analise.estruturado;
      estiloVendedora = {
        tem_analise: true,
        qtd_edicoes_analisadas: analise.qtd_edicoes_analisadas,
        tom_geral: e.tom_geral,                                      // "calorosa direta informal"
        comprimento_medio: e.comprimento_medio,                       // curta | media | longa
        vocabulario_caracteristico: e.linguagem || [],                // ["usa 'tô'", "abrevia td/vc", "muitas reticências"]
        emojis_preferidos: e.emojis_frequentes || [],                 // ["😘","💕","🥰"]
        tratamentos_preferidos: e.tratamentos || [],                  // ["linda","amor"]
        padroes_adiciona: e.padroes_de_edicao?.adiciona || [],        // ["emoji no fim","apelido depois do oi"]
        padroes_remove: e.padroes_de_edicao?.remove || [],            // ["palavras formais","sobrenomes"]
        eh_de_referencia: estiloVendedoraOrigemId !== sug.vendedora_id,
      };
    } else if (estilo && (estilo.qtd_edicoes || 0) > 0) {
      // FALLBACK: so contadores simples, sem few-shot de frases inteiras
      const top3 = (counterObj) => Object.entries(counterObj || {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([k]) => k);
      estiloVendedora = {
        tem_analise: false,
        qtd_edicoes_aprendidas: estilo.qtd_edicoes,
        saudacao_inicial_top: top3(estilo.saudacao_inicial),
        saudacao_final_top: top3(estilo.saudacao_final),
        tratamentos_preferidos: top3(estilo.tratamento),
        emojis_preferidos: top3(estilo.emojis),
        eh_de_referencia: estiloVendedoraOrigemId !== sug.vendedora_id,
      };
    }
  } catch (e) {
    console.warn('[ia-mensagem] estilo vendedora indisponivel:', e?.message);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CONTEXTO RICO — Ailson 07/05/2026
  // Dados que ja existem mas nao estavam indo pra geracao individual de
  // mensagem. Trazendo paridade com as sugestoes diarias.
  // ═══════════════════════════════════════════════════════════════════════════

  let janelaCompra = null;
  let conversoesCliente = null;
  let historicoSugestoes = [];
  let feedbackHistorico = [];   // Ailson 18/05/2026 — feedback diario da vendedora sobre esse cliente
  let topCategorias = [];
  let ultimaCompra = null;
  let perfilCanal = null;
  let statusEfetivo = null;
  let pecaInfo = null; // novidade? reposição? combina com estilo dela?

  if (cliente && cliente.id) {
    // 1. JANELA DE COMPRA
    try {
      const { data: jData } = await supabase
        .from('vw_lojas_clientes_janela')
        .select('dias_ate_janela_atencao, dentro_janela_compra, media_confiavel, media_dias_compras')
        .eq('cliente_id', cliente.id)
        .maybeSingle();
      if (jData?.media_confiavel) {
        janelaCompra = {
          estado: jData.dentro_janela_compra
            ? 'na_janela'
            : (jData.dias_ate_janela_atencao > 0 ? 'confortavel' : 'passou_janela'),
          media_dias: Math.round(jData.media_dias_compras || 0),
          dias_ate_janela: jData.dias_ate_janela_atencao,
        };
      }
    } catch (e) { /* silent */ }

    // 2. CONVERSOES anteriores (60d)
    try {
      const dataLimite = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
      const { data: conv } = await supabase
        .from('lojas_conversoes')
        .select('data_venda, dias_ate_compra, valor_venda')
        .eq('cliente_id', cliente.id)
        .gte('data_venda', dataLimite)
        .order('data_venda', { ascending: false });
      if (conv?.length > 0) {
        conversoesCliente = {
          total: conv.length,
          ultima_data: conv[0].data_venda,
          ultimo_dias_ate_compra: conv[0].dias_ate_compra,
          ultimo_valor: conv[0].valor_venda,
        };
      }
    } catch (e) { /* silent */ }

    // 3. HISTORICO de sugestoes (28d, max 5) — anti-repeticao
    try {
      const dataLimiteHist = new Date(Date.now() - 28 * 86400000).toISOString().slice(0, 10);
      const { data: hist } = await supabase
        .from('lojas_sugestoes_diarias')
        .select('data_geracao, tipo, titulo, produto_ref')
        .eq('cliente_id', cliente.id)
        .gte('data_geracao', dataLimiteHist)
        .in('status', ['executada', 'pendente'])
        .order('data_geracao', { ascending: false })
        .limit(5);
      historicoSugestoes = (hist || []).map(h => ({
        data: h.data_geracao,
        tipo: h.tipo,
        ref: h.produto_ref || null,
        titulo: h.titulo,
      }));
    } catch (e) { /* silent */ }

    // 3.5 FEEDBACK HISTORICO da vendedora (90d, max 3) — Ailson 18/05/2026
    // O que a vendedora respondeu sobre interacoes passadas com esse cliente.
    // 3 sinais por feedback: estado (Q1), percepcao (Q2), plano (Q3).
    // IA usa pra: nao sugerir clientes ja_era+deixar_quieta, modular tom em
    // clientes quietas, apoiar follow-up se vendedora indicou plano.
    try {
      const dataLimiteFb = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
      const { data: fb } = await supabase
        .from('lojas_feedback_diario')
        .select('data_pergunta, data_sugestao, resposta_q1, resposta_q2, resposta_q3, motivo_encerramento')
        .eq('cliente_id', cliente.id)
        .gte('data_pergunta', dataLimiteFb)
        .order('data_pergunta', { ascending: false })
        .limit(3);
      feedbackHistorico = (fb || [])
        .filter(f => f.resposta_q1)  // ignora linhas que vendedora nem comecou
        .map(f => ({
          data:         f.data_pergunta,
          data_sugestao: f.data_sugestao,
          estado:       f.resposta_q1,
          percepcao:    f.resposta_q2 || null,
          plano:        f.resposta_q3 || null,
          encerramento: f.motivo_encerramento || 'parcial',
        }));
    } catch (e) { /* silent */ }


    // 4. TOP CATEGORIAS — o que cliente mais compra
    try {
      const { data: itens } = await supabase
        .from('lojas_vendas_itens')
        .select('categoria, qtd, lojas_vendas!inner(cliente_id)')
        .eq('lojas_vendas.cliente_id', cliente.id);
      if (itens?.length) {
        const counts = {};
        itens.forEach(i => {
          const cat = i.categoria || 'outros';
          counts[cat] = (counts[cat] || 0) + (i.qtd || 1);
        });
        topCategorias = Object.entries(counts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 4)
          .map(([cat, qtd]) => ({ categoria: cat, qtd }));
      }
    } catch (e) { /* silent */ }

    // 5. ULTIMA COMPRA — data + REFs principais
    try {
      const { data: ultima } = await supabase
        .from('lojas_vendas')
        .select('id, data_venda, valor_total')
        .eq('cliente_id', cliente.id)
        .order('data_venda', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (ultima) {
        const { data: itensUlt } = await supabase
          .from('lojas_vendas_itens')
          .select('ref, descricao, categoria')
          .eq('venda_id', ultima.id)
          .limit(5);
        const diasAtras = Math.round((Date.now() - new Date(ultima.data_venda).getTime()) / 86400000);
        ultimaCompra = {
          data: ultima.data_venda,
          dias_atras: diasAtras,
          valor: parseFloat(ultima.valor_total || 0),
          itens: (itensUlt || []).map(i => ({
            ref: i.ref,
            descricao: (i.descricao || '').slice(0, 50),
            categoria: i.categoria,
          })),
        };
      }
    } catch (e) { /* silent */ }

    // 6. PERFIL CANAL — granular (igual gap 3)
    if (kpi) {
      const fis = kpi.qtd_compras_fisicas || 0;
      const ves = kpi.qtd_compras_vesti || 0;
      const con = kpi.qtd_compras_convertr || 0;
      const total = fis + ves + con;
      if (total === 0) {
        perfilCanal = cliente.canal_cadastro === 'vesti' ? 'so_cadastro_vesti' : 'sem_dados';
      } else {
        const pctF = fis / total, pctV = ves / total, pctC = con / total;
        if (pctF >= 0.9) perfilCanal = 'so_presencial';
        else if (pctV >= 0.9) perfilCanal = 'so_vesti';
        else if (pctC >= 0.9) perfilCanal = 'so_online';
        else if (pctF >= 0.5 && pctV > 0) perfilCanal = 'hibrido_loja_vesti';
        else if (pctF >= 0.5 && pctC > 0) perfilCanal = 'hibrido_loja_online';
        else perfilCanal = 'misto';
      }
    }

    // 7. STATUS EFETIVO (dias_sem_comprar -> categoria)
    if (kpi?.dias_sem_comprar != null) {
      const d = kpi.dias_sem_comprar;
      if (d <= 30) statusEfetivo = 'ativo';
      else if (d <= 60) statusEfetivo = 'atencao';
      else if (d <= 120) statusEfetivo = 'sem_atividade';
      else statusEfetivo = 'inativo';
    }

    // 8. PECA INFO — a peca da sugestao eh novidade? reposicao? combina?
    if (sug.produto_ref) {
      const refSemZ = String(sug.produto_ref).replace(/^0+/, '') || '0';
      try {
        // Verifica se eh novidade
        const { data: nov } = await supabase
          .from('vw_lojas_novidades_auto')
          .select('ref')
          .eq('ref', refSemZ)
          .maybeSingle();
        // Verifica se eh reposicao
        const { data: rep } = await supabase
          .from('vw_lojas_reposicoes_auto')
          .select('ref')
          .eq('ref', refSemZ)
          .maybeSingle();
        // Cruza com top categorias da cliente
        const categoriaSug = produto?.categoria || null;
        const combinaEstilo = categoriaSug && topCategorias.some(t => t.categoria === categoriaSug);
        pecaInfo = {
          eh_novidade: !!nov,
          eh_reposicao: !!rep,
          combina_estilo_cliente: !!combinaEstilo,
          categoria: categoriaSug,
        };
      } catch (e) { /* silent */ }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CARDÁPIO RICO PRA CONVERSÃO — Ailson 10/05/2026
  // IA precisa do leque pra escolher o gancho de MAIOR chance de retorno.
  // Antes, mensagem avulsa recebia só 1 ref pre-escolhida pelo backend ->
  // qd ela nao casava nada especifico, IA caia em "tem novidade chegando".
  // Agora ela ve top do cliente + cardapio geral e escolhe o melhor gancho.
  // ═══════════════════════════════════════════════════════════════════════════
  let topRefsCliente = [];
  let novidadesDisponiveis = [];
  let reposicoesDisponiveis = [];
  let matchesDaPeca = [];
  let topRecompra = [];
  let curadoriaManual = [];
  let avisoDoDia = null;

  if (cliente && cliente.id) {
    // Top 3 REFs do cliente — score=pecas×0.7 + recorrencia×3.0 (ja calculado na view)
    try {
      const { data: tops } = await supabase
        .from('vw_lojas_top_refs_por_cliente')
        .select('ref, posicao, pecas_total, vezes_comprou')
        .eq('cliente_id', cliente.id)
        .order('posicao')
        .limit(3);
      if (tops?.length) {
        const refs = tops.map(t => t.ref);
        const { data: prods } = await supabase
          .from('lojas_produtos')
          .select('ref, descricao, categoria, qtd_estoque')
          .in('ref', refs);
        const prodMap = new Map((prods || []).map(p => [p.ref, p]));
        topRefsCliente = tops.map(t => {
          const p = prodMap.get(t.ref);
          return {
            ref: t.ref,
            posicao: t.posicao,
            pecas_total: t.pecas_total,
            vezes_comprou: t.vezes_comprou,
            descricao: p?.descricao || null,
            categoria: p?.categoria || null,
            qtd_estoque: p?.qtd_estoque || 0,
            em_estoque: (p?.qtd_estoque || 0) >= 50, // pode oferecer reposicao
          };
        });
      }
    } catch (e) { /* silent */ }
  }

  // Top 8 novidades com estoque
  try {
    const { data: nov } = await supabase
      .from('vw_lojas_novidades_auto')
      .select('ref')
      .limit(30);
    if (nov?.length) {
      const refs = nov.map(n => n.ref);
      const { data: prods } = await supabase
        .from('lojas_produtos')
        .select('ref, descricao, categoria, qtd_estoque')
        .in('ref', refs);
      // Cores top 3 vendidas por REF nos ultimos 30d (Ailson 20/05/2026):
      // Permite IA falar "voltou body transpassado, o caqui ta lindo" so
      // se realmente existe esse modelo na cor mencionada.
      const { data: coresPorRef } = await supabase
        .from('vw_variacoes_vendidas_30d_ref_cor')
        .select('ref, cor, vendas_30d_cor_ref')
        .in('ref', refs)
        .eq('elegivel_gate2', true)
        .order('vendas_30d_cor_ref', { ascending: false });
      const mapaCoresRef = {};
      for (const c of coresPorRef || []) {
        if (!mapaCoresRef[c.ref]) mapaCoresRef[c.ref] = [];
        if (mapaCoresRef[c.ref].length < 3) mapaCoresRef[c.ref].push(c.cor);
      }
      novidadesDisponiveis = (prods || [])
        .filter(p => (p.qtd_estoque || 0) > 5 && p.descricao)
        .map(p => ({
          ref: p.ref,
          descricao: p.descricao,
          categoria: p.categoria,
          qtd_estoque: p.qtd_estoque,
          cores_disponiveis: mapaCoresRef[p.ref] || [],
        }))
        .slice(0, 8);
    }
  } catch (e) { /* silent */ }

  // Top 8 reposicoes com estoque (refs ja vendidas + cortes 5-12d)
  try {
    const { data: rep } = await supabase
      .from('vw_lojas_reposicoes_auto')
      .select('ref')
      .limit(30);
    if (rep?.length) {
      const refs = rep.map(r => r.ref);
      const { data: prods } = await supabase
        .from('lojas_produtos')
        .select('ref, descricao, categoria, qtd_estoque')
        .in('ref', refs);
      // Cores top 3 por REF (mesma logica das novidades)
      const { data: coresPorRef } = await supabase
        .from('vw_variacoes_vendidas_30d_ref_cor')
        .select('ref, cor, vendas_30d_cor_ref')
        .in('ref', refs)
        .eq('elegivel_gate2', true)
        .order('vendas_30d_cor_ref', { ascending: false });
      const mapaCoresRef = {};
      for (const c of coresPorRef || []) {
        if (!mapaCoresRef[c.ref]) mapaCoresRef[c.ref] = [];
        if (mapaCoresRef[c.ref].length < 3) mapaCoresRef[c.ref].push(c.cor);
      }
      reposicoesDisponiveis = (prods || [])
        .filter(p => (p.qtd_estoque || 0) > 5 && p.descricao)
        .map(p => ({
          ref: p.ref,
          descricao: p.descricao,
          categoria: p.categoria,
          qtd_estoque: p.qtd_estoque,
          cores_disponiveis: mapaCoresRef[p.ref] || [],
        }))
        .slice(0, 8);
    }
  } catch (e) { /* silent */ }

  // Matches REF×REF da peca referenciada (top 5 — quem compra X tb compra Y)
  if (sug.produto_ref) {
    try {
      const refNorm = refSemZero(sug.produto_ref);
      const { data: matches } = await supabase
        .from('mv_lojas_matches_90d')
        .select('ref_match, pct, coocorrencias')
        .eq('ref_top', refNorm)
        .order('pct', { ascending: false })
        .limit(5);
      if (matches?.length) {
        const refsMatch = matches.map(m => m.ref_match);
        const { data: prodsM } = await supabase
          .from('lojas_produtos')
          .select('ref, descricao, categoria, qtd_estoque')
          .in('ref', refsMatch);
        const mapM = new Map((prodsM || []).map(p => [p.ref, p]));
        matchesDaPeca = matches
          .map(m => {
            const p = mapM.get(m.ref_match);
            return {
              ref_match: m.ref_match,
              pct: Math.round(m.pct),
              coocorrencias: m.coocorrencias,
              descricao: p?.descricao || null,
              categoria: p?.categoria || null,
              qtd_estoque: p?.qtd_estoque || 0,
            };
          })
          .filter(m => (m.qtd_estoque || 0) > 5);
      }
    } catch (e) { /* silent */ }
  }

  // Top recompra 90d agregado (top 5 mais pedidas de novo)
  try {
    const { data: recRows } = await supabase
      .from('vw_lojas_recompra_90d')
      .select('ref, ocorrencias');
    if (recRows?.length) {
      const aggMap = new Map();
      for (const r of recRows) aggMap.set(r.ref, (aggMap.get(r.ref) || 0) + Number(r.ocorrencias || 0));
      const top5 = [...aggMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
      if (top5.length) {
        const refs = top5.map(([r]) => r);
        const { data: prodsR } = await supabase
          .from('lojas_produtos')
          .select('ref, descricao, categoria, qtd_estoque')
          .in('ref', refs);
        const mapR = new Map((prodsR || []).map(p => [p.ref, p]));
        topRecompra = top5
          .map(([ref, ocorr]) => {
            const p = mapR.get(ref);
            return {
              ref,
              ocorrencias: ocorr,
              descricao: p?.descricao || null,
              categoria: p?.categoria || null,
              qtd_estoque: p?.qtd_estoque || 0,
            };
          })
          .filter(t => (t.qtd_estoque || 0) > 5);
      }
    }
  } catch (e) { /* silent */ }

  // Curadoria manual (best_seller + em_alta marcados pelo admin)
  try {
    const hoje = new Date().toISOString().slice(0, 10);
    const { data: cur } = await supabase
      .from('lojas_produtos_curadoria')
      .select('ref, tipo')
      .eq('ativo', true)
      .or(`data_fim.is.null,data_fim.gte.${hoje}`)
      .limit(30);
    if (cur?.length) {
      const refs = cur.map(c => c.ref);
      const tipoMap = new Map(cur.map(c => [c.ref, c.tipo]));
      const { data: prodsC } = await supabase
        .from('lojas_produtos')
        .select('ref, descricao, categoria, qtd_estoque')
        .in('ref', refs);
      curadoriaManual = (prodsC || [])
        .filter(p => (p.qtd_estoque || 0) > 5 && p.descricao)
        .map(p => ({
          ref: p.ref,
          tipo: tipoMap.get(p.ref),
          descricao: p.descricao,
          categoria: p.categoria,
          qtd_estoque: p.qtd_estoque,
        }))
        .slice(0, 10);
    }
  } catch (e) { /* silent */ }

  // Aviso dedicado pra essa vendedora hoje (se houver)
  try {
    const hoje = new Date().toISOString().slice(0, 10);
    const vendedoraIdAtual = sug.vendedora_id;
    const { data: avisos } = await supabase
      .from('lojas_avisos')
      .select('id, texto, vendedoras_ids')
      .eq('status', 'pendente')
      .eq('data_disparo', hoje);
    const meu = (avisos || []).find(a =>
      !a.vendedoras_ids || a.vendedoras_ids.length === 0 || a.vendedoras_ids.includes(vendedoraIdAtual)
    );
    if (meu) avisoDoDia = { texto: meu.texto };
  } catch (e) { /* silent */ }

  // ═══════════════════════════════════════════════════════════════════════════
  // CLIENTE SILENCIOSO DEMAIS — Ailson 10/05/2026
  // Quando cliente passou MUITO da janela natural dele (90+ dias da janela)
  // OU 120+ dias sem comprar -> abordagem INVESTIGATIVA, nao empurrar produto.
  // IA pergunta motivo primeiro ('aconteceu alguma coisa?', 'teve modelo q
  // nao vendeu bem?') e finaliza oferecendo ajuda ('se for problema a gente
  // resolve'). O objetivo eh REABRIR CANAL, nao vender nessa msg.
  // ═══════════════════════════════════════════════════════════════════════════
  let clienteSilenciosoDemais = false;
  // Caso 1: janela confiavel + passou 90+ dias da janela propria
  if (janelaCompra?.estado === 'passou_janela' && (janelaCompra.dias_ate_janela ?? 0) <= -90) {
    clienteSilenciosoDemais = true;
  }
  // Caso 2: sem janela confiavel mas >= 120 dias sem comprar (entrou em
  // sem_atividade pelo fallback fixo dos KPIs)
  else if ((kpi?.dias_sem_comprar || 0) >= 120) {
    clienteSilenciosoDemais = true;
  }

  // ULTIMOS MODELOS LEVADOS — Ailson 10/05/2026 (etapa silencioso demais)
  // Quando cliente silenciosa demais, IA personaliza pergunta investigativa
  // mencionando 2 modelos especificos q ela levou: "teve algum modelo q nao
  // vendeu bem? aquela calca pantalona ou aquele body que vc levou?"
  // Filtra >= 01/03/2026 (data confiavel das vendas).
  let ultimosModelosLevados = [];
  if (clienteSilenciosoDemais && cliente?.id) {
    try {
      const { data: vendasRecentes } = await supabase
        .from('lojas_vendas')
        .select('id, data_venda')
        .eq('cliente_id', cliente.id)
        .gte('data_venda', '2026-03-01')
        .order('data_venda', { ascending: false })
        .limit(10);
      if (vendasRecentes?.length) {
        const idsVendas = vendasRecentes.map(v => v.id);
        const { data: itens } = await supabase
          .from('lojas_vendas_itens')
          .select('ref, descricao, categoria, venda_id')
          .in('venda_id', idsVendas);
        // Mapa data_venda por venda_id (pra ordenar itens pela data)
        const dataPorVenda = new Map(vendasRecentes.map(v => [v.id, v.data_venda]));
        const ordenados = (itens || [])
          .filter(i => i.descricao)
          .map(i => ({ ...i, data_venda: dataPorVenda.get(i.venda_id) }))
          .sort((a, b) => (b.data_venda || '').localeCompare(a.data_venda || ''));
        // Dedup por descricao normalizada — pega ate 2 modelos distintos
        const vistos = new Set();
        for (const it of ordenados) {
          const key = (it.descricao || '').toLowerCase().trim();
          if (!key || vistos.has(key)) continue;
          vistos.add(key);
          ultimosModelosLevados.push({
            descricao: it.descricao,
            categoria: it.categoria || null,
          });
          if (ultimosModelosLevados.length >= 2) break;
        }
      }
    } catch (e) {
      console.warn('[lojas-ia] ultimos modelos levados indisponivel:', e?.message);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LOCALIZAÇÃO + HISTÓRICO "VEM PRA SP?" — Ailson 10/05/2026
  // Cliente fora de SP cujo perfil é presencial -> usar gancho "vc vem pra
  // SP esse mês?". Mas SO repetir esse gancho a cada 90d (sem perguntar 2x
  // em sequencia). IA respeita ja_perguntei_vir_sp_90d=true e omite a
  // pergunta nesse caso.
  // ═══════════════════════════════════════════════════════════════════════════
  const enderecoUf = (cliente?.endereco_uf || '').trim().toUpperCase() || null;
  const enderecoCidade = cliente?.endereco_cidade || null;
  let jaPerguntouVirSP = false;
  if (cliente && enderecoUf && enderecoUf !== 'SP') {
    try {
      const data90d = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
      const { data: msgsAnt } = await supabase
        .from('lojas_sugestoes_diarias')
        .select('mensagem_gerada')
        .eq('cliente_id', cliente.id)
        .gte('data_geracao', data90d)
        .not('mensagem_gerada', 'is', null)
        .limit(30);
      const todasMsgs = (msgsAnt || []).map(m => (m.mensagem_gerada || '').toLowerCase()).join(' ');
      // padroes comuns que indicam que IA ja perguntou sobre vir pra SP
      const padroes = [
        'vem pra sp', 'vem pra são paulo', 'vem pra sao paulo',
        'vir pra sp', 'vir pra são paulo', 'vir pra sao paulo',
        'vier pra sp', 'vier pra são paulo',
        'passa em sp', 'vem aqui em sp', 'subir pra sp',
      ];
      jaPerguntouVirSP = padroes.some(p => todasMsgs.includes(p));
    } catch (e) { /* silent */ }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CORES REAIS DAS PEÇAS via MÓDULO OFICINAS — Ailson 10/05/2026
  // Pra cada ref nas listas (top do cliente, novidades, reposicoes, matches,
  // top_recompra, curadoria), busca o ULTIMO CORTE ENTREGUE da ref (em
  // amicia_data user_id='ailson_cortes') e extrai as cores reais.
  // Depois cruza com cores_top_bling posicoes 3-5 (pulando top 1-2 que sao
  // sempre preto/bege e nao impressionam). Resulta em `cor_destaque` pra
  // cada peca — cor que esta TANTO no corte da peca QUANTO bombando no Bling.
  // ═══════════════════════════════════════════════════════════════════════════
  const refsRelevantes = new Set();
  const addRef = (r) => { if (r) refsRelevantes.add(String(r).replace(/^0+/, '') || '0'); };
  if (produto?.ref) addRef(produto.ref);
  for (const r of topRefsCliente) addRef(r.ref);
  for (const p of novidadesDisponiveis) addRef(p.ref);
  for (const p of reposicoesDisponiveis) addRef(p.ref);
  for (const m of matchesDaPeca) addRef(m.ref_match);
  for (const t of topRecompra) addRef(t.ref);
  for (const c of curadoriaManual) addRef(c.ref);

  const parseDataBR = (s) => {
    if (!s) return 0;
    const m = String(s).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) return 0;
    return new Date(`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`).getTime() || 0;
  };

  const coresPorRef = new Map();
  if (refsRelevantes.size > 0) {
    try {
      const { data: row } = await supabase
        .from('amicia_data')
        .select('payload')
        .eq('user_id', 'ailson_cortes')
        .maybeSingle();
      const cortes = row?.payload?.cortes || [];
      for (const ref of refsRelevantes) {
        const dosRef = cortes.filter(c => {
          const cRef = String(c.ref || '').replace(/^0+/, '') || '0';
          return cRef === ref && c.entregue === true;
        });
        if (dosRef.length === 0) continue;
        // Ordena pela data de entrega DESC, pega o mais recente
        dosRef.sort((a, b) => parseDataBR(b.dataEntrega) - parseDataBR(a.dataEntrega));
        const ultimo = dosRef[0];
        const cores = (ultimo.cores || [])
          .filter(co => (co.folhas || 0) > 0)
          .map(co => co.nome)
          .filter(Boolean);
        if (cores.length > 0) coresPorRef.set(ref, cores);
      }
    } catch (e) {
      console.warn('[lojas-ia] cortes (oficinas) indisponivel:', e?.message);
    }
  }

  // Cores em destaque do Bling = posições 3-5 (pula top 1-2 = preto/bege).
  // Sao as cores "que estao subindo" agora — fala disso impressiona, fala
  // de preto/bege não impressiona (qse sempre top).
  const coresDestaqueBling = coresTop.slice(2, 5);

  // Anotar cor_destaque pra cada item: cor da peça que ALSO está em destaque Bling
  const anotarCorDestaque = (ref) => {
    if (!ref) return null;
    const refN = String(ref).replace(/^0+/, '') || '0';
    const coresDaPeca = coresPorRef.get(refN) || [];
    if (coresDaPeca.length === 0) return null;
    for (const corBling of coresDestaqueBling) {
      const matchCor = coresDaPeca.find(c => c && c.toLowerCase() === corBling.toLowerCase());
      if (matchCor) return matchCor; // retorna nome original (case da peça)
    }
    return null; // sem interseccao -> IA nao menciona cor
  };

  // Aplica nas listas (mutaveis ate aqui)
  topRefsCliente = topRefsCliente.map(r => ({ ...r, cor_destaque: anotarCorDestaque(r.ref) }));
  novidadesDisponiveis = novidadesDisponiveis.map(p => ({ ...p, cor_destaque: anotarCorDestaque(p.ref) }));
  reposicoesDisponiveis = reposicoesDisponiveis.map(p => ({ ...p, cor_destaque: anotarCorDestaque(p.ref) }));
  matchesDaPeca = matchesDaPeca.map(m => ({ ...m, cor_destaque: anotarCorDestaque(m.ref_match) }));
  topRecompra = topRecompra.map(r => ({ ...r, cor_destaque: anotarCorDestaque(r.ref) }));
  curadoriaManual = curadoriaManual.map(c => ({ ...c, cor_destaque: anotarCorDestaque(c.ref) }));
  const corDestaqueDaPeca = produto?.ref ? anotarCorDestaque(produto.ref) : null;

  // ANTI-CLONE — Ailson 22/05/2026
  // Busca mensagens ja geradas HOJE pela mesma vendedora pra OUTROS clientes.
  // Sem isso a IA repetia abertura ("Faz um tempinho q vc nao passa por aqui")
  // e produto ("conjunto couro cropped saia midi top do mes") em varias msgs
  // do mesmo dia porque cada chamada era independente, sem memoria do que ela
  // acabou de escrever 5min antes.
  // Caso real 22/05: Joelma->Joelma e Joelma->Maria, mesma atencao, msgs quase
  // identicas geradas com 9min de diferenca.
  let msgsHojeOutras = [];
  try {
    const hojeStr = new Date().toISOString().slice(0, 10);
    const { data } = await supabase
      .from('lojas_sugestoes_diarias')
      .select('alvo_nome_display, tipo, subtipo_sacola, mensagem_gerada, produto_ref')
      .eq('vendedora_id', sug.vendedora_id)
      .eq('data_geracao', hojeStr)
      .not('mensagem_gerada', 'is', null)
      .neq('id', sug.id)
      .order('mensagem_gerada_em', { ascending: false })
      .limit(6);
    msgsHojeOutras = (data || []).map(m => ({
      para: m.alvo_nome_display,
      tipo: m.subtipo_sacola ? `${m.tipo}:${m.subtipo_sacola}` : m.tipo,
      produto_ref: m.produto_ref || null,
      abertura: (m.mensagem_gerada || '').split('\n')[0].slice(0, 80),
      texto_completo: m.mensagem_gerada,
    }));
  } catch (e) {
    console.warn('[lojas-ia/mensagem] anti-clone msgs do dia indisponivel:', e?.message);
  }

  return {
    cliente, grupo, kpi, docsGrupo,
    produto, promocao, coresTop,
    regrasCustomizadas: { tomGeral, posicionamento, sempre, nunca, saudacao, fechamento },
    estiloVendedora,
    // Contexto rico — Ailson 07/05/2026
    janelaCompra, conversoesCliente, historicoSugestoes,
    feedbackHistorico,   // Ailson 18/05/2026 — Sprint A Modal Fechamento
    topCategorias, ultimaCompra, perfilCanal, statusEfetivo, pecaInfo,
    // Observações da vendedora — Ailson 07/05/2026 (etapa B)
    observacoesVendedora: cliente?.observacoes_ia || null,
    // CARDÁPIO RICO — Ailson 10/05/2026 (ganchos de conversão)
    topRefsCliente, novidadesDisponiveis, reposicoesDisponiveis,
    matchesDaPeca, topRecompra, curadoriaManual, avisoDoDia,
    // LOCALIZAÇÃO + CORES REAIS — Ailson 10/05/2026 (segunda passada)
    enderecoUf, enderecoCidade, jaPerguntouVirSP,
    coresDestaqueBling,    // top 3-5 do Bling (pula preto/bege)
    corDestaqueDaPeca,     // cor da peca da sug que ALSO esta em coresDestaqueBling
    // CLIENTE SILENCIOSO DEMAIS — Ailson 10/05/2026 (terceira passada)
    clienteSilenciosoDemais, ultimosModelosLevados,
    // LINK VESTI DA VENDEDORA — Ailson 12/05/2026 (bug fix)
    // Quando cliente eh Vesti (perfilCanal=so_vesti/hibrido_loja_vesti/etc),
    // a IA DEVE colar essa URL na mensagem. Se null, ela so promete sem URL.
    vestiLinkAtivo,
    // ANTI-CLONE — Ailson 22/05/2026
    // Ate 6 mensagens ja escritas hoje pela mesma vendedora pra outros clientes.
    // IA usa pra NAO repetir abertura, produto destacado e gancho.
    msgsHojeOutras,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// CONSTRUÇÃO DE PROMPTS COM CACHE_CONTROL
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Anthropic prompt caching: blocos com cache_control viram cache.
 *
 * Estrutura: [base, regras_dinamicas]
 *  - base = SYSTEM_PROMPT_SUGESTOES (estável, hash quase nunca muda) → CACHED
 *  - regras_dinamicas = inject das config customizadas → não cacheada
 *
 * Anthropic mantém o cache por 5min. Sucessivas chamadas dentro desse prazo
 * pagam só 10% do input pra parte cacheada.
 */
function montarSystemSugestoes(regras) {
  const blocks = [
    {
      type: 'text',
      text: SYSTEM_PROMPT_SUGESTOES,
      cache_control: { type: 'ephemeral' },
    },
  ];

  // Bloco dinâmico: regras customizadas + parâmetros (NÃO cacheia — muda toda hora)
  const dinamico = construirBlocoDinamico(regras);
  if (dinamico) {
    blocks.push({ type: 'text', text: dinamico });
  }

  return blocks;
}

function montarSystemMensagens(regras) {
  const blocks = [
    {
      type: 'text',
      text: SYSTEM_PROMPT_MENSAGENS,
      cache_control: { type: 'ephemeral' },
    },
  ];

  const dinamico = construirBlocoDinamico(regras);
  if (dinamico) {
    blocks.push({ type: 'text', text: dinamico });
  }

  return blocks;
}

function construirBlocoDinamico(r) {
  if (!r) return null;
  const linhas = [];

  if (r.tomGeral) linhas.push(`## Tom personalizado pela equipe\n\n${r.tomGeral}`);
  if (r.posicionamento) linhas.push(`## Posicionamento da marca\n\n${r.posicionamento}`);

  if (Array.isArray(r.sempre) && r.sempre.length > 0) {
    linhas.push(`## Regras adicionais — A IA SEMPRE deve\n\n${r.sempre.map(x => `- ${x}`).join('\n')}`);
  }
  if (Array.isArray(r.nunca) && r.nunca.length > 0) {
    linhas.push(`## Regras adicionais — A IA NUNCA deve\n\n${r.nunca.map(x => `- ${x}`).join('\n')}`);
  }

  if (r.descontoReat != null) {
    linhas.push(`## Parâmetros\n\n- Desconto reativação (cliente 90+ dias): ${r.descontoReat}%\n- Desconto atenção (cliente 45-90 dias): ${r.descontoAten || 5}%`);
  }

  if (r.saudacao) linhas.push(`## Saudação padrão\n\n${r.saudacao}`);
  if (r.fechamento) linhas.push(`## Fechamento padrão\n\n${r.fechamento}`);

  return linhas.length > 0 ? linhas.join('\n\n') : null;
}

// ═══════════════════════════════════════════════════════════════════════════
// MENSAGENS (few-shot + user input)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Pra Prompt A: few-shot ensina a IA a gerar JSON de qualidade. Não
 * mandamos os 23 exemplos — só os 2-3 mais relevantes ao tipo de carteira.
 *
 * Pra Prompt A na verdade os exemplos são de mensagem (Prompt B) — então
 * eles servem mais pra calibrar o "tom" das sugestões. Vou enviar só 2
 * exemplos de tipos diferentes pra IA pegar o vibe.
 */
function montarMessagesSugestoes(ctx) {
  // Set de clientes com sacola ativa (preservar mesmo se KPI fraco)
  const clientesComSacola = new Set((ctx.sacolas || []).map(s => s.cliente_id));

  // FILTROS DE CARTEIRA (28/04/2026, decisão Ailson):
  //   - Cliente sem dias_sem_comprar E sem ultima_compra → KPI inutilizável pra
  //     reativar/atenção/followup. Remove (a menos que tenha sacola).
  //   - pular_ate futuro → vendedora marcou pra pular agora
  //
  // ACRESCIMO 06/05/2026: cooldown geral
  //   - Cliente sugerido nos ultimos N dias (10 padrao, 7 pra carteiras <100):
  //     remove. Excecao: cliente com sacola ativa passa (sacola tem regra propria)
  //
  // ACRESCIMO 12/05/2026 (Ailson): cliente em grupo (grupo_id != null) NAO
  //   entra como candidato individual. O grupo todo eh representado em
  //   ctx.grupos com agregados (dias_sem_grupo = MIN dos docs, etc).
  //   Sem isso, IA estava gerando sugestao "inativo" pra UM CNPJ do grupo
  //   mesmo OUTRO CNPJ do mesmo grupo ter comprado recente
  //   (ex: Grupo Sandra — SANDRA SAIA comprou ha 5d, mas IA sugeriu
  //   reativar IND COM DE com 276d). Tambem evita duplicar sugestoes
  //   (1 pro grupo + 1 pra cada CNPJ).
  const carteiraFiltradaInfo = { sem_kpi: 0, pulando: 0, kpi_parcial: 0, em_cooldown: 0, em_grupo: 0 };
  const hojeISO = new Date().toISOString().slice(0, 10);

  const carteira = ctx.clientes
    .filter(c => {
      // Pular_ate
      if (c.pular_ate && c.pular_ate >= hojeISO) {
        carteiraFiltradaInfo.pulando++;
        return false;
      }
      // KPI inutilizável — descarta SE não tiver sacola ativa
      const k = ctx.kpis[c.id] || {};
      const kpiInutil = (k.dias_sem_comprar == null && !k.ultima_compra);
      if (kpiInutil && !clientesComSacola.has(c.id)) {
        carteiraFiltradaInfo.sem_kpi++;
        return false;
      }
      // Cliente em grupo: descarta individualmente — grupo agregado em ctx.grupos
      // representa o conjunto. EXCECAO: cliente com sacola ativa passa
      // (sacola eh atributo individual, nao do grupo).
      if (c.grupo_id && !clientesComSacola.has(c.id)) {
        carteiraFiltradaInfo.em_grupo++;
        return false;
      }
      // Cooldown geral (Ailson 20/05/2026): aplica TAMBEM em clientes com
      // sacola ativa. Antes havia excecao (sacola bypassava cooldown), mas
      // decisao: cliente nenhum recebe contato com menos de 7-10d, mesmo
      // que abriu/atualizou sacola. Cliente espera o ciclo virar.
      // Sacola dessa cliente nao vai ser sugerida hoje (filter da sacola
      // tambem aplica clientesEmCooldownGeral em lojas-ia.js linha ~989).
      if (ctx.clientesEmCooldownGeral?.has(c.id)) {
        carteiraFiltradaInfo.em_cooldown++;
        return false;
      }
      return true;
    })
    .map(c => {
      const k = ctx.kpis[c.id] || {};
      // Flag kpi_incompleto: cliente passou no filtro mas falta dado importante
      const kpiIncompleto = (k.dias_sem_comprar == null || !k.ultima_compra);
      if (kpiIncompleto) carteiraFiltradaInfo.kpi_parcial++;
      // Cliente usa Vesti se: comprou pelo Vesti antes (vendas físicas registram
      // canal_dominante=vesti_dominante OU qtd_compras_vesti>0) OU foi importada
      // como contato Vesti (canal_cadastro='vesti', mesmo sem vendas físicas).
      // Decisão Ailson 30/04/2026: import de pedidos Vesti ultimos 75d gera
      // clientes com canal_cadastro=vesti — IA precisa enxergar como Vesti pra
      // sugerir mandar link/video do app.
      const usaVestiCli = c.canal_cadastro === 'vesti'
        || k.canal_dominante === 'vesti_dominante'
        || (k.qtd_compras_vesti || 0) > 0;

      // PERFIL DE CANAL CONSOLIDADO — Ailson 07/05/2026 (auditoria GAP 3)
      // Combina qtd_compras_fisicas/vesti/convertr pra escolher tom/canal:
      //   so_presencial: 90%+ veio na loja — fala "passa aqui pra ver"
      //   so_vesti:      90%+ comprou Vesti — sempre manda link Vesti
      //   so_online:     90%+ Convertr/sacola — manda fotos+link, nao convida loja
      //   hibrido_loja_vesti: vai na loja MAS tambem usa Vesti
      //   hibrido_loja_online: vai na loja MAS tambem compra online
      //   so_cadastro_vesti: tem canal_cadastro=vesti mas ZERO compra (nova)
      //   sem_dados: cliente sem compras — usa canal_cadastro raw
      const fis = k.qtd_compras_fisicas || 0;
      const ves = k.qtd_compras_vesti || 0;
      const con = k.qtd_compras_convertr || 0;
      const totalCompras = fis + ves + con;
      let perfilCanal;
      if (totalCompras === 0) {
        perfilCanal = c.canal_cadastro === 'vesti' ? 'so_cadastro_vesti' : 'sem_dados';
      } else {
        const pctFis = fis / totalCompras;
        const pctVes = ves / totalCompras;
        const pctCon = con / totalCompras;
        if (pctFis >= 0.9) perfilCanal = 'so_presencial';
        else if (pctVes >= 0.9) perfilCanal = 'so_vesti';
        else if (pctCon >= 0.9) perfilCanal = 'so_online';
        else if (pctFis >= 0.5 && pctVes > 0) perfilCanal = 'hibrido_loja_vesti';
        else if (pctFis >= 0.5 && pctCon > 0) perfilCanal = 'hibrido_loja_online';
        else perfilCanal = 'misto';
      }

      return {
        id: c.id,
        apelido: c.apelido || c.comprador_nome || c.razao_social?.split(' ').slice(0, 3).join(' '),
        documento_tipo: c.tipo_documento,
        grupo_id: c.grupo_id,
        pular_ate: c.pular_ate,
        kpi_incompleto: kpiIncompleto, // ⚠️ NÃO use pra reativar/atenção/followup se true
        // ATENCAO ESPECIAL — Ailson 06/05/2026.
        // Cliente ATIVO mas com mudanca de comportamento (atrasou ciclo,
        // queda volume, queda ticket, devolucao). IA deve PRIORIZAR este
        // cliente e MENCIONAR motivos discretamente na mensagem.
        // null = cliente nao tem score >=3.
        atencao_especial: ctx.atencaoEspecial?.[c.id] ? {
          score: ctx.atencaoEspecial[c.id].score,
          motivos: ctx.atencaoEspecial[c.id].motivos,
        } : null,
        // JANELA DE COMPRA — Ailson 07/05/2026 (auditoria GAP 1).
        // Indica se cliente esta confortavel no ciclo natural ou se passou
        // do prazo. IA deve usar pra DESPRIORIZAR cliente que vai comprar
        // sozinho. NAO eh filtro absoluto — IA ainda pode sugerir se houver
        // razao forte (sacola, atencao_especial, novidade do top_ref).
        // null = cliente sem media confiavel (<5 visitas) — usa regra fixa.
        janela_compra: ctx.janela?.[c.id]?.media_confiavel ? {
          dentro_janela: ctx.janela[c.id].dentro_janela_compra,
          dias_ate_janela: ctx.janela[c.id].dias_ate_janela_atencao,
          media_dias: Math.round(ctx.janela[c.id].media_dias_compras || 0),
          // Estado humano-legivel pra IA usar:
          //   'confortavel'   = ainda no ciclo natural (faltam dias pra janela)
          //   'na_janela'     = entrou na janela ideal de compra
          //   'passou_janela' = ja passou da janela (atrasando ciclo proprio)
          estado: ctx.janela[c.id].dentro_janela_compra
            ? 'na_janela'
            : (ctx.janela[c.id].dias_ate_janela_atencao > 0 ? 'confortavel' : 'passou_janela'),
          // OBRIGATORIO_JANELA_PERFEITA (Ailson 21/05/2026):
          // Cliente com >=70% do ciclo passado E sem cooldown = HARD pick.
          // IA NAO PODE deixar de fora. Limite 150% pra nao pegar inativo
          // que provavelmente nao volta. Auditoria 21/05: 41 quentes hoje,
          // apenas 2 viraram sugestao. IA estava ignorando regra textual.
          // Agora flag explicita + prompt enforcement.
          obrigatorio: (() => {
            const kpi = ctx.kpis?.[c.id] || {};
            const j = ctx.janela?.[c.id];
            if (!j?.media_confiavel || !j.media_dias_compras || !kpi.dias_sem_comprar) return false;
            const pct = kpi.dias_sem_comprar / j.media_dias_compras;
            const semCooldown = !ctx.clientesEmCooldownGeral?.has(c.id);
            const naoEmGrupo = !c.grupo_id;
            // OPCAO B (Ailson 21/05/2026): 0.8-1.3 + >=5 visitas
            const visitasOk = (j.qtd_datas_unicas || 0) >= 5;
            return visitasOk && pct >= 0.8 && pct <= 1.3 && semCooldown && naoEmGrupo;
          })(),
        } : null,
        // CONVERSOES — Ailson 07/05/2026 (auditoria GAP 2).
        // Indica se cliente ja respondeu a mensagem com compra antes (60d).
        // total: quantas vezes converteu
        // ultima_dias_ate_compra: tempo de resposta (0-15d)
        // ultimo_valor: valor da ultima conversao
        // null = nunca converteu (ou nao tem registro nos ultimos 60d)
        conversoes: ctx.conversoesPorCliente?.[c.id] ? {
          total: ctx.conversoesPorCliente[c.id].total,
          ultima_data: ctx.conversoesPorCliente[c.id].ultima_data_venda,
          ultimo_dias_ate_compra: ctx.conversoesPorCliente[c.id].ultimo_dias_ate_compra,
          ultimo_valor: ctx.conversoesPorCliente[c.id].ultimo_valor,
        } : null,
        // HISTORICO recente de sugestoes (28 dias) — Ailson 07/05/2026 GAP 4.
        // IA usa pra evitar repetir conteudo: mesma REF, mesmo tipo, mesmo
        // tema. Lista vem ordenada (mais recente primeiro). Maximo 5 itens.
        // Vazio = cliente novo no fluxo IA OU nao foi sugerido nos ultimos
        // 28 dias.
        historico_sugestoes: ctx.historicoSugestoes?.[c.id] || [],
        // FEEDBACK DIARIO da vendedora (90d, max 3) — Ailson 18/05/2026 Sprint A
        // 3 sinais por feedback: estado (Q1=reacao da cliente), percepcao
        // (Q2=tua leitura), plano (Q3=o que pretende). NULL = nunca foi
        // perguntado. Regras de uso explicadas no SYSTEM_PROMPT (secao
        // FEEDBACK HISTORICO). Vendedora ja_era+deixar_quieta = NAO sugerir.
        feedback_vendedora: ctx.feedbackPorCliente?.[c.id] || null,
        // Cliente Vesti? Combina vendas físicas (KPIs) + cadastro Vesti
        // (canal_cadastro). True = priorizar sugerir link/video do app.
        usa_vesti: usaVestiCli,
        canal_cadastro: c.canal_cadastro || null,
        perfil_canal: perfilCanal,    // Ailson 07/05/2026 GAP 3 — granularidade Vesti/presencial/online/hibrido
        // Top 3 REFs que essa cliente compra bem (score peças+recorrência).
        // IA usa pra: detectar reposição, dizer "vende bem pra você",
        // alternar recomendações sem repetir.
        // ACRESCIMO 06/05/2026: cada top_ref vem com .matches[] (top 5 refs
        // que aparecem juntas com ela em outras compras). IA pode oferecer
        // o match em vez de buscar peca da mesma categoria.
        top_refs_cliente: (ctx.topRefsPorCliente?.[c.id] || []).map(tr => ({
          ...tr,
          matches: ctx.matchesPorRef?.[tr.ref] || [],
        })),
        // Distribuicao de compras por CATEGORIA (calça, blusa, vestido,
        // macacão...). Categoria com dominante=true (pct>=30%) sinaliza pra
        // IA: pode oferecer novidade/best_seller dessa categoria mesmo sem
        // REF específica no top 3 da cliente. Item: {categoria, pct,
        // pecas, dominante}.
        categorias_freq: ctx.categoriasFreqPorCliente?.[c.id] || [],
        kpi: {
          dias_sem_comprar: k.dias_sem_comprar,
          ultima_compra: k.ultima_compra,
          lifetime_total: k.lifetime_total,
          qtd_compras: k.qtd_compras,
          ticket_medio: k.ticket_medio,
          fase_ciclo_vida: k.fase_ciclo_vida,
          status_atual: k.status_atual,
          canal_dominante: k.canal_dominante,
          perfil_presenca: k.perfil_presenca,
          paga_com_cheque: k.paga_com_cheque,
          estilo_dominante: k.estilo_dominante,
          tamanhos_frequentes: k.tamanhos_frequentes,
        },
      };
    });

  // Classifica produtos uma vez só (usado no payload e na telemetria)
  const produtosClassificados = classificarProdutos(
    ctx.produtos, ctx.curadoria, ctx.bestSellersAuto, ctx.emAltaAuto, ctx.maisVendidos45d
  );

  // Constrói payload enxuto pra IA — só dados que ela usa
  const userPayload = {
    data_geracao: new Date().toISOString(),
    vendedora: ctx.vendedora,
    carteira,
    grupos: ctx.grupos,
    // ─── TRILHAS WIN-BACK ATIVAS HOJE ───────────────────────────
    // Ailson 13/05/2026 (Sprint A). Cliente +3M/+6M fiel (>=4 compras) em
    // trilha de 3 semanas. CADA TRILHA SUBSTITUI o slot correspondente:
    //   - status_inicial='semAtividade' → substitui slot +3M
    //   - status_inicial='inativo'      → substitui slot +6M
    // IA: pega o trilha_id no metadados da sugestão gerada. Backend depois
    // chama lojas_trilha_winback_avancar(trilha_id, sugestao_id).
    trilhas_winback: (ctx.trilhasWinback || []).map(t => ({
      trilha_id: t.trilha_id,
      cliente_id: t.cliente_id,
      cliente_nome: t.cliente_nome,
      etapa: t.etapa_atual,                  // 1, 2 ou 3
      etapa_label: t.etapa_label,            // 'Semana 1 — Reconexão' etc
      status_inicial: t.status_inicial,      // 'semAtividade' ou 'inativo'
      qtd_compras_inicio: t.qtd_compras_inicio,
      lifetime_inicio: t.lifetime_inicio,
      dias_em_trilha: t.dias_em_trilha,
      mensagem_anterior: t.mensagem_anterior, // texto da msg semana anterior
      contexto_resposta: t.etapa_atual === 2 ? t.contexto_s2 
                       : t.etapa_atual === 3 ? t.contexto_s3 : null,
    })),
    sacolas_ativas: ctx.sacolas.map(s => ({
      cliente_id: s.cliente_id,
      data_cadastro_sacola: s.data_cadastro_sacola,
      valor_total: s.valor_total,
      qtd_pecas: s.qtd_pecas,
      subtipo_sugerido: s.subtipo_sugerido,
      observacao: s.observacao,
    })),
    produtos_disponiveis: produtosClassificados,
    // REFs que aparecem em "novidades" mas JÁ FORAM vendidas antes — são
    // candidatas a sugestão tipo "reposicao" (decisão Ailson 28/04/2026).
    // IA usa: se uma novidade da oficina está nessa lista E está no top 3 da
    // cliente, vira sugestão de reposição (substitui novidade ou followup).
    refs_reposicao: ctx.refsReposicao || [],
    // Top 10 refs com MAIS RECOMPRA (90d, agregado todas lojas).
    // ACRESCIMO 06/05/2026: IA usa em followup_nova (cliente que comprou 1a
    // vez ha 15d) pra oferecer "recompra certeira" — peca que outros clientes
    // levam de volta toda hora. Cada item tem ref, ocorrencias, descricao,
    // categoria, qtd_estoque.
    top_recompra: ctx.topRecompra || [],
    promocoes_ativas: ctx.promocoes.map(p => ({
      id: p.id,
      nome: p.nome_curto,
      descricao: p.descricao_completa,
      categoria: p.categoria,
      vence_em: p.data_fim,
      desconto_pct: p.desconto_pct,
      pedido_minimo: p.pedido_minimo,
    })),
    // Mensagens contextuais admin pra incorporar nas sugestoes durante o
    // periodo. NAO consome slot. Ex: "feliz dia das mulheres".
    acoes_vigentes: (ctx.acoesVigentes || []).map(a => ({
      id: a.id,
      texto: a.texto,
      vence_em: a.data_fim,
    })),
    // CAMPANHA 30% off (Ailson 17/06/2026): priorizar compradores de promoção.
    campanha_promo: (ctx.compradoresPromo && ctx.compradoresPromo.length)
      ? {
          ativa: true,
          vence_em: '2026-06-22',
          alvo_por_dia: 4,
          instrucao: 'Campanha 30% off ativa. INCLUA ATÉ 4 sugestões priorizando os clientes listados em clientes_alvo — são clientes que JÁ COMPRARAM EM PROMOÇÃO antes e têm alta chance de comprar de novo. Ordem de prioridade: status ativo, depois atencao, depois semAtividade (a lista já vem nessa ordem; prefira tambem os recorrente=true). Redistribua o mix usual (pode reduzir novidade/atencao) pra abrir espaço pra esses ate 4 cards. A mensagem deve usar a Ação vigente do 30% off. Nao repita cliente que ja recebeu sugestao recente.',
          clientes_alvo: ctx.compradoresPromo,
        }
      : null,
    // Aviso DEDICADO pra essa vendedora hoje. Se presente, IA DEVE criar a
    // sugestao prioridade=1 baseada no texto, em vez do reativar usual.
    aviso_dedicado_hoje: (ctx.avisosDestaVendedora || []).length > 0
      ? {
          id: ctx.avisosDestaVendedora[0].id,
          texto: ctx.avisosDestaVendedora[0].texto,
          cliente_id_alvo: ctx.avisosDestaVendedora[0].cliente_id || null,
        }
      : null,
    // Cores em alta (top Bling + manuais). IA pode mencionar nas mensagens
    // mesmo sem REF especifica. Ex: "chegou varios modelos de Marrom, ta
    // super em alta!"
    cores_em_alta: (ctx.coresEmAlta || []).map(c => ({
      cor: c.cor,
      fonte: c.fonte,  // 'bling_auto' ou 'manual'
    })),
    // Link Vesti que a vendedora cadastrou e marcou como ativo. Se null,
    // IA fica livre pra mencionar Vesti sem link, ou nao mencionar.
    vesti_link_vendedora: ctx.vestiLinkAtivo,
    diagnostico_filtros: {
      ...carteiraFiltradaInfo,
      sacolas_descartadas: ctx.sacolasDescartadas || {},
      cooldown_geral: {
        dias: ctx.cooldownGeralDias || null,
        clientes_em_cooldown: ctx.clientesEmCooldownGeral?.size || 0,
        carteira_total: ctx.totalCarteira || null,
      },
      produtos: {
        novidades: produtosClassificados.novidades.length,
        best_sellers: produtosClassificados.best_sellers.length,
        em_alta: produtosClassificados.em_alta.length,
        mais_vendidos: produtosClassificados.mais_vendidos.length,
        estoque_geral: produtosClassificados.estoque_geral.length,
        best_sellers_auto_loja_fisica: ctx.bestSellersAuto?.length || 0,
        em_alta_auto_loja_fisica: ctx.emAltaAuto?.length || 0,
        refs_reposicao: ctx.refsReposicao?.length || 0,
      },
      clientes_com_top_refs: Object.keys(ctx.topRefsPorCliente || {}).length,
      // Quantos clientes da carteira tem ao menos 1 categoria DOMINANTE
      // (pct>=30%). Sinal pra IA poder oferecer novidade dessa categoria
      // mesmo sem REF especifica no top 3 da cliente.
      clientes_com_categoria_dominante: Object.values(ctx.categoriasFreqPorCliente || {})
        .filter(arr => arr.some(c => c.dominante)).length,
      // Quantos clientes da carteira tem AO MENOS 1 REF do seu top em
      // estoque hoje — esses sao candidatos fortes pra sugestao tipo
      // "reposicao" ampla. Se esse numero for alto e a IA nao gerar
      // nenhuma "reposicao", o prompt nao esta sendo seguido.
      clientes_com_top_ref_em_estoque: (carteira || [])
        .filter(c => (c.top_refs_cliente || []).some(t => t.em_estoque)).length,
      // Vesti unificado: vendas físicas + import de cadastro Vesti
      clientes_vesti_na_carteira: (ctx.clientes || [])
        .filter(c => c.canal_cadastro === 'vesti'
          || ctx.kpis[c.id]?.canal_dominante === 'vesti_dominante'
          || (ctx.kpis[c.id]?.qtd_compras_vesti || 0) > 0).length,
      // Detalhamento: quantos vieram de cada origem (debug do import 30/04)
      clientes_vesti_por_canal_cadastro: (ctx.clientes || [])
        .filter(c => c.canal_cadastro === 'vesti').length,
      clientes_vesti_por_compras_fisicas: (ctx.clientes || [])
        .filter(c => ctx.kpis[c.id]?.canal_dominante === 'vesti_dominante'
          || (ctx.kpis[c.id]?.qtd_compras_vesti || 0) > 0).length,
    },
    instrucao: 'Gere as 7 sugestões priorizadas conforme o schema do system prompt. Responda APENAS o JSON.',
    // CONVERSOES da vendedora ultimos 60d — Ailson 07/05/2026 (auditoria GAP 2)
    // Sinal pra IA calibrar tom geral (vendedora produtiva ou nao).
    conversoes_vendedora: ctx.conversoesGeral || { qtd_60d: 0, valor_60d: 0, qtd_30d: 0 },
  };

  return [
    {
      role: 'user',
      content: JSON.stringify(userPayload, null, 2),
    },
  ];
}

/**
 * Pra Prompt B: few-shot do tipo da sugestão + user com 1 sugestão expandida.
 */
function montarMessagesMensagem(sug, ctx, contextoExtra) {
  // Pega 2-3 exemplos few-shot do mesmo tipo (ou similares)
  const exemplosDoTipo = EXEMPLOS_FEW_SHOT
    .filter(e => e.tipo === sug.tipo || (sug.subtipo_sacola && e.tipo === sug.subtipo_sacola))
    .slice(0, 3);

  const messages = [];

  for (const ex of exemplosDoTipo) {
    messages.push({ role: 'user', content: JSON.stringify(ex.input, null, 2) });
    messages.push({ role: 'assistant', content: ex.output });
  }

  // User input real
  const userPayload = {
    sugestao: {
      tipo: sug.tipo,
      subtipo_sacola: sug.subtipo_sacola,
      titulo: sug.titulo,
      contexto: sug.contexto,
      fatos: sug.fatos,
      acao_sugerida: sug.acao_sugerida,
      alvo_tipo: sug.alvo_tipo,
    },
    cliente: ctx.cliente ? (() => {
      // Decisão Ailson 28/04/2026: na mensagem WhatsApp, IA deve tratar a
      // cliente pelo PRIMEIRO NOME (ex: "Rosana Ruiva" → "Rosana"). O nome
      // completo fica na UI das 7 sugestões; mensagem fica mais próxima
      // usando só o primeiro nome.
      const nomeCompleto = (ctx.cliente.apelido || ctx.cliente.comprador_nome || '').trim();
      const palavras = nomeCompleto.split(/\s+/).filter(p => p.length >= 2);
      const apelidoCurto = palavras[0] || nomeCompleto || null;
      // Vesti = app de vendas usado SÓ no Bom Retiro. Cliente é Vesti se:
      // 1. Comprou via Vesti (canal_dominante=vesti_dominante OU qtd>0) OU
      // 2. Foi importada como contato Vesti (canal_cadastro='vesti', mesmo
      //    sem vendas físicas — caso de cliente que só comprou pelo app).
      // Decisão Ailson 30/04/2026: import de pedidos Vesti 75d gera contatos
      // novos com canal_cadastro=vesti — IA precisa enxergar como Vesti pra
      // sugerir link/video do app.
      const usaVesti = ctx.cliente?.canal_cadastro === 'vesti'
        || ctx.kpi?.canal_dominante === 'vesti_dominante'
        || (ctx.kpi?.qtd_compras_vesti || 0) > 0;
      return {
        apelido: apelidoCurto,
        nome_completo_comprador: nomeCompleto || null,
        razao_social: ctx.cliente.razao_social,
        perfil_presenca: ctx.kpi?.perfil_presenca,
        canal_dominante: ctx.kpi?.canal_dominante,
        usa_vesti: usaVesti,
        loja_origem: ctx.cliente.loja_origem,
        paga_com_cheque: ctx.kpi?.paga_com_cheque,
        dias_sem_comprar: ctx.kpi?.dias_sem_comprar,
        lifetime_total: ctx.kpi?.lifetime_total,
        qtd_compras: ctx.kpi?.qtd_compras,
        estilo_dominante: ctx.kpi?.estilo_dominante,
        fase_ciclo_vida: ctx.kpi?.fase_ciclo_vida,
      };
    })() : null,
    grupo: ctx.grupo ? {
      nome_grupo: ctx.grupo.nome_grupo,
      qtd_documentos: ctx.docsGrupo.length,
    } : null,
    produto: ctx.produto ? {
      nome: ctx.produto.descricao,
      categoria: ctx.produto.categoria,
    } : null,
    // Cor destaque da peca da sug (Ailson 10/05/2026)
    // Cor que esta TANTO no ultimo corte entregue dessa ref QUANTO no top
    // 3-5 do Bling (cores "do momento"). Se null, IA NAO menciona cor.
    cor_destaque_da_peca: ctx.corDestaqueDaPeca || null,
    // Cores 3-5 do Bling — usar SO essas (top 1-2 sao sempre preto/bege).
    // Substitui o antigo cores_top_bling (top 6 sem filtro).
    cores_destaque_bling: ctx.coresDestaqueBling && ctx.coresDestaqueBling.length > 0
      ? ctx.coresDestaqueBling : null,
    promocao: ctx.promocao ? {
      nome: ctx.promocao.nome_curto,
      descricao: ctx.promocao.descricao_completa,
      vence_em: ctx.promocao.data_fim,
    } : null,
    // Estilo aprendido da vendedora (Ailson 04/05/2026 → refeito 21/05/2026)
    // FILOSOFIA: vendedora ensina TEMPERO (vocabulário, emojis, pontuação),
    // não RECEITA (frase pronta). IA tem cardapio amplo de aberturas/finalizacoes
    // no prompt — vendedora só contribui com ingredientes a aplicar SOBRE o cardapio.
    estilo_vendedora: ctx.estiloVendedora ? (ctx.estiloVendedora.tem_analise ? {
      // CASO RICO: analise estruturada disponivel
      tom_geral: ctx.estiloVendedora.tom_geral,
      comprimento_medio: ctx.estiloVendedora.comprimento_medio,
      vocabulario_caracteristico: ctx.estiloVendedora.vocabulario_caracteristico,
      emojis_preferidos: ctx.estiloVendedora.emojis_preferidos,
      tratamentos_preferidos: ctx.estiloVendedora.tratamentos_preferidos,
      o_que_ela_adiciona: ctx.estiloVendedora.padroes_adiciona,
      o_que_ela_remove: ctx.estiloVendedora.padroes_remove,
      qtd_edicoes_analisadas: ctx.estiloVendedora.qtd_edicoes_analisadas,
      eh_de_referencia: ctx.estiloVendedora.eh_de_referencia,
      instrucao: 'Esses são os INGREDIENTES do estilo dela, não receitas. Use seu CARDÁPIO AMPLO de aberturas/finalizações do prompt e TEMPERE com esses ingredientes: ' +
        '(1) Aplique emojis preferidos no fim de frases que combinem; ' +
        '(2) Use o tratamento dela ("linda", "amor", etc) quando fizer sentido; ' +
        '(3) Aplique o vocabulário/abreviações dela ("vc", "tô", "td", etc); ' +
        '(4) Respeite o comprimento médio (curta/media/longa); ' +
        '(5) Adote os padrões que ela ADICIONA. NÃO copie frases literais — varie a abertura sempre.',
    } : {
      // FALLBACK: so contadores simples (sem analise rica ainda)
      qtd_edicoes_aprendidas: ctx.estiloVendedora.qtd_edicoes_aprendidas,
      tratamentos_preferidos: ctx.estiloVendedora.tratamentos_preferidos,
      emojis_preferidos: ctx.estiloVendedora.emojis_preferidos,
      eh_de_referencia: ctx.estiloVendedora.eh_de_referencia,
      instrucao: 'INGREDIENTES limitados (sem análise rica ainda). Use seu CARDÁPIO AMPLO de aberturas/finalizações e tempere apenas com os emojis e tratamentos preferidos. NÃO copie frases literais.',
    }) : null,
    // CONTEXTO RICO — Ailson 07/05/2026 (auditoria mensagem individual)
    // Mesmos sinais que a IA das sugestoes diarias usa — agora disponiveis
    // pra geracao de mensagem individual tambem.
    status_cliente: ctx.statusEfetivo, // 'ativo' | 'atencao' | 'sem_atividade' | 'inativo' | null
    perfil_canal: ctx.perfilCanal,     // 'so_presencial' | 'so_vesti' | 'so_online' | 'hibrido_*' | 'misto' | 'so_cadastro_vesti' | 'sem_dados'
    janela_compra: ctx.janelaCompra,   // {estado, media_dias, dias_ate_janela}
    top_categorias_cliente: ctx.topCategorias?.length > 0 ? ctx.topCategorias : null,
    ultima_compra: ctx.ultimaCompra,
    conversoes_anteriores: ctx.conversoesCliente,
    historico_sugestoes_28d: ctx.historicoSugestoes,
    // FEEDBACK DIARIO da vendedora — Ailson 18/05/2026 (Sprint A)
    // Respostas do modal de fechamento sobre interacoes passadas com este cliente.
    // 3 sinais por feedback: estado (Q1=reacao da cliente), percepcao (Q2=tua
    // leitura), plano (Q3=o que pretende). Ate 3 entradas ordenadas por mais
    // recente. NULL = nunca foi perguntado sobre este cliente.
    // Regras de uso explicadas no SYSTEM_PROMPT (secao FEEDBACK HISTORICO).
    feedback_vendedora: ctx.feedbackHistorico?.length > 0 ? ctx.feedbackHistorico : null,
    peca_info: ctx.pecaInfo, // { eh_novidade, eh_reposicao, combina_estilo_cliente }
    // Observacoes da vendedora — Ailson 07/05/2026 (etapa B)
    // Persistidas em lojas_clientes.observacoes_ia. Vendedora preenche modal
    // (perguntas guiadas + texto livre). IA usa pra calibrar TOM e CONTEUDO,
    // mas NUNCA menciona o conteudo na mensagem.
    observacoes_vendedora: ctx.observacoesVendedora,
    // CARDÁPIO RICO — Ailson 10/05/2026 (ganchos de conversão)
    // IA usa pra ESCOLHER o gancho de maior chance de retorno em vez de
    // cair em "tem novidade chegando". Hierarquia de prioridade explicada
    // no SYSTEM_PROMPT (secao ESTRATEGIA DE CONVERSAO).
    top_refs_cliente: ctx.topRefsCliente?.length > 0 ? ctx.topRefsCliente : null,
    novidades_disponiveis: ctx.novidadesDisponiveis?.length > 0 ? ctx.novidadesDisponiveis : null,
    reposicoes_disponiveis: ctx.reposicoesDisponiveis?.length > 0 ? ctx.reposicoesDisponiveis : null,
    matches_da_peca: ctx.matchesDaPeca?.length > 0 ? ctx.matchesDaPeca : null,
    top_recompra: ctx.topRecompra?.length > 0 ? ctx.topRecompra : null,
    curadoria_manual: ctx.curadoriaManual?.length > 0 ? ctx.curadoriaManual : null,
    aviso_do_dia: ctx.avisoDoDia || null,
    // LOCALIZAÇÃO — Ailson 10/05/2026
    // Cliente fora de SP cujo perfil é presencial -> gancho "vc vem pra SP esse mês?"
    // MAS so se ja_perguntei_vir_sp_90d=false (anti-repeticao 90d)
    cliente_uf: ctx.enderecoUf || null,
    cliente_cidade: ctx.enderecoCidade || null,
    ja_perguntei_vir_sp_90d: ctx.jaPerguntouVirSP || false,
    // CLIENTE SILENCIOSO DEMAIS — Ailson 10/05/2026 (terceira passada)
    // Cliente passou 90+ dias da janela natural OU 120+ dias sem comprar
    // -> NÃO empurrar produto, INVESTIGAR motivo primeiro.
    cliente_silencioso_demais: ctx.clienteSilenciosoDemais || false,
    // ultimos_modelos_levados (>=01/03/2026): 2 modelos distintos pra IA
    // PERSONALIZAR a pergunta investigativa ('aquela calça pantalona ou
    // aquele body que vc levou, alguma não vendeu bem?'). So tem valor
    // quando cliente_silencioso_demais=true.
    ultimos_modelos_levados: ctx.ultimosModelosLevados?.length > 0
      ? ctx.ultimosModelosLevados : null,
    // LINK VESTI DA VENDEDORA — Ailson 12/05/2026 (bug fix critico)
    // Quando cliente_dominante=vesti_dominante OU canal_cadastro=vesti
    // a IA DEVE colar essa URL na mensagem. NUNCA escreva "te mando o
    // link" sem ter o URL aqui. Se null, IA so pode mencionar Vesti
    // sem URL especifica. NAO altere a URL.
    vesti_link_vendedora: ctx.vestiLinkAtivo || null,
    // DDD + REGIÃO DO CLIENTE — Ailson 11/06/2026
    // Pra regra de clima: NÃO oferecer couro / peças de frio pesado pra cliente
    // do Norte/Nordeste. DDD extraído do telefone principal. Se null, IA não
    // pode usar gancho de couro condicionado a região (usa gancho neutro).
    ddd_cliente: (() => {
      const tel = String(ctx.cliente?.telefone_principal || '').replace(/\D/g, '');
      const semDdi = tel.startsWith('55') && tel.length >= 12 ? tel.slice(2) : tel;
      const ddd = semDdi.slice(0, 2);
      return /^[1-9][0-9]$/.test(ddd) ? ddd : null;
    })(),
    // ANTI-CLONE — Ailson 22/05/2026
    // Mensagens que VOCE MESMA (mesma vendedora) ja escreveu hoje pra outros
    // clientes. Use pra NAO repetir abertura, produto destacado nem gancho.
    // Caso real 22/05: Joelma mandou pra Joelma "chegou conjunto couro cropped
    // saia midi top do mes" e 9min depois mandou texto QUASE IDENTICO pra Maria.
    // Cada cliente merece mensagem unica.
    mensagens_que_voce_ja_escreveu_hoje: ctx.msgsHojeOutras?.length > 0 ? {
      qtd: ctx.msgsHojeOutras.length,
      mensagens: ctx.msgsHojeOutras,
      instrucao: 'CRITICO: voce (mesma vendedora) ja mandou essas mensagens hoje pra outras clientes. ' +
        'NAO REPITA: (a) mesma frase de abertura — varie completamente, ' +
        '(b) mesmo produto destacado — escolha outro do cardapio se houver opcao, ' +
        '(c) mesmo gancho ("chegou X", "voltou Y", "no top do mes", "tah sendo sucesso de vendas"), ' +
        '(d) mesma frase de FECHAMENTO/CTA ("vou enviar o catalogo", "me conta que a gente resolve", ' +
        '"qualquer coisa to a disposicao", "passa aqui essa semana") — varie tambem o final. ' +
        'Varie a mensagem INTEIRA: abertura, corpo E fechamento, nao so a abertura. ' +
        'Cada cliente eh unica. Se voce ESTAVA prestes a usar uma frase repetida, MUDE. ' +
        'O objetivo eh parecer humana de verdade, nao scripted.',
    } : null,
    contexto_extra: contextoExtra && Object.keys(contextoExtra).length > 0 ? contextoExtra : null,
    instrucao: 'Gere a mensagem WhatsApp pronta pra copiar. APENAS o texto, sem aspas ao redor.',
  };

  // Few-shot REAL: ultimas edicoes da vendedora (mostra original->editada
  // pra IA "ver" o que ela costuma mudar)
  if (ctx.estiloVendedora?.ultimas_edicoes?.length > 0) {
    for (const ed of ctx.estiloVendedora.ultimas_edicoes.slice(0, 2)) {
      messages.push({
        role: 'user',
        content: 'Exemplo: a IA havia gerado esta mensagem...\n\n' + ed.texto_original,
      });
      messages.push({
        role: 'assistant',
        content: ed.texto_editado,
      });
    }
  }

  messages.push({
    role: 'user',
    content: JSON.stringify(userPayload, null, 2),
  });

  return messages;
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Classifica produtos em listas: novidades, best_sellers, em_alta, estoque_geral.
 * A view vw_lojas_produtos_oferecveis já calcula motivo_oferta — só agrupar.
 */
function classificarProdutos(produtos, curadoria, bestSellersAuto = [], emAltaAuto = [], maisVendidos45d = []) {
  // Curadoria manual tem PRIORIDADE sobre auto.
  const curBs = new Set(curadoria.filter(c => c.tipo === 'best_seller').map(c => c.ref));
  const curAlta = new Set(curadoria.filter(c => c.tipo === 'em_alta').map(c => c.ref));
  const curNov = new Set(curadoria.filter(c => c.tipo === 'novidade_manual').map(c => c.ref));

  // Auto (vw_lojas_top_vendas_loja_fisica) — só aplica se REF não tiver
  // curadoria manual.
  const autoBs = new Set(bestSellersAuto || []);
  const autoAlta = new Set(emAltaAuto || []);
  const setMaisVendidos = new Set(maisVendidos45d || []);

  const out = {
    novidades: [],
    best_sellers: [],
    em_alta: [],
    mais_vendidos: [], // top 10 vendas 45d loja física (categoria nova)
    estoque_geral: [],
  };

  for (const p of produtos) {
    const item = {
      ref: p.ref,
      nome: p.descricao,
      categoria: p.categoria,
      estoque: p.qtd_estoque,
    };
    const motivo = p.motivo_oferta;

    if (motivo === 'novidade_oficina' || curNov.has(p.ref)) {
      out.novidades.push(item);
    } else if (curBs.has(p.ref) || motivo === 'best_seller' || autoBs.has(p.ref)) {
      out.best_sellers.push(item);
    } else if (curAlta.has(p.ref) || motivo === 'em_alta' || autoAlta.has(p.ref)) {
      out.em_alta.push(item);
    } else if (motivo === 'estoque') {
      out.estoque_geral.push(item);
    }

    // mais_vendidos é categoria PARALELA — uma REF pode estar em best_sellers
    // E em mais_vendidos (são contextos diferentes pra IA usar).
    if (setMaisVendidos.has(p.ref)) {
      out.mais_vendidos.push(item);
    }
  }

  // Limita pra não estourar contexto
  out.novidades = out.novidades.slice(0, 25);
  out.best_sellers = out.best_sellers.slice(0, 15);
  out.em_alta = out.em_alta.slice(0, 15);
  out.mais_vendidos = out.mais_vendidos.slice(0, 10);
  out.estoque_geral = out.estoque_geral.slice(0, 30);

  return out;
}

const TIPOS_VALIDOS = ['reativar', 'atencao', 'novidade', 'followup', 'followup_nova', 'sacola', 'reposicao', 'aviso_admin', 'inativo', 'semAtividade', 'trilha_winback', 'previsao_pontual'];
function validarTipo(t) {
  return TIPOS_VALIDOS.includes(t) ? t : 'followup';
}

// ═══════════════════════════════════════════════════════════════════════════
// AÇÃO 2.5: gerar_mensagem_avulsa (Ailson 08/05/2026)
// ═══════════════════════════════════════════════════════════════════════════
//
// Vendedora pede mensagem direto do card da carteira, sem ter sugestao
// pre-existente das 7 diarias. Backend:
//   1. Cria sugestao "fantasma" em lojas_sugestoes_diarias com tipo='avulsa'
//   2. Escolhe peca via cascata:
//      a. Novidade que combina com categoria dominante da cliente (preferida)
//      b. Reposicao que combina com categoria dominante
//      c. Novidade qualquer da semana
//      d. Followup sem peca (fallback final)
//   3. Reusa handleGerarMensagem normal
//
// Decisao Ailson 08/05/2026:
//   Q1=A (IA escolhe peca sozinha)
//   Q2=2 (novidade na categoria dominante prioridade)
//   Q3=C (salva como tipo='avulsa', entra no anti-repeticao)

async function handleGerarMensagemAvulsa(req, res, auth) {
  const clienteId = req.body?.cliente_id;
  const contextoExtra = req.body?.contexto || {};

  if (!clienteId) {
    return res.status(400).json({ error: 'cliente_id obrigatório' });
  }

  // 1. Carrega cliente + KPIs
  const { data: cliente, error: errCli } = await supabase
    .from('lojas_clientes')
    .select('*')
    .eq('id', clienteId)
    .maybeSingle();
  if (errCli) return res.status(500).json({ error: errCli.message });
  if (!cliente) return res.status(404).json({ error: 'Cliente não encontrado' });

  // Permissão: vendedora dona OU admin
  if (!auth.isAdmin && cliente.vendedora_id !== auth.vendedoraId) {
    return res.status(403).json({ error: 'Sem permissão pra esse cliente' });
  }

  // ═════════════════════════════════════════════════════════════════════════
  // ANTI-REPETICAO MENSAGEM AVULSA (Ailson 20/05/2026)
  // Vendedora pode apertar botao 2-3x rapido ou tentar mandar avulsa pra
  // cliente que jah foi contactada. Antes do INSERT, faz 2 verificacoes:
  //
  // GUARD 1 - Double-click (<60s pra mesma cliente):
  //   Retorna idempotente a sugestao existente (200 com flag). Resolve
  //   POSTs duplicados do front (network glitch, click multiplo).
  //   Caso real: Celia/Eliane teve 6 mensagens avulsas em 2 min dia 14/05.
  //
  // GUARD 2 - Cliente contactada nos ultimos N dias:
  //   Carteira <100: 7 dias, >=100: 10 dias (mesma regra do cooldown geral).
  //   Excecao: cliente com sacola ativa passa direto (igual cooldown geral).
  //   Retorna 409 com info pra front mostrar dialogo "ja contatou ha X dias".
  //   Force bypass: req.body.forcar_avulsa=true ignora o cooldown.
  // ═════════════════════════════════════════════════════════════════════════
  try {
    // GUARD 1: double-click — mesmo cliente, ultimos 60s
    const sessentaSegAtras = new Date(Date.now() - 60000).toISOString();
    const { data: ultimaAvulsa } = await supabase
      .from('lojas_sugestoes_diarias')
      .select('id, titulo, status, produto_ref, created_at')
      .eq('cliente_id', clienteId)
      .eq('vendedora_id', cliente.vendedora_id)
      .gte('created_at', sessentaSegAtras)
      .order('created_at', { ascending: false })
      .limit(1);

    if (ultimaAvulsa && ultimaAvulsa.length > 0) {
      const sug = ultimaAvulsa[0];
      const segundosAtras = Math.round((Date.now() - new Date(sug.created_at).getTime()) / 1000);
      console.log('[avulsa] double-click bloqueado:', clienteId, segundosAtras + 's');
      return res.status(200).json({
        ok: true,
        sugestao_id: sug.id,
        titulo: sug.titulo,
        mensagem: null, // front re-busca via /api/lojas-ia gerar_mensagem normal
        duplicada: true,
        motivo: 'double_click',
        segundos_atras: segundosAtras,
        nota: 'Mensagem ja foi criada ha ' + segundosAtras + 's. Reusando.',
      });
    }

    // GUARD 2: cliente contactada nos ultimos 7-10 dias (bypass se forcar_avulsa)
    const forcarAvulsa = !!req.body?.forcar_avulsa;
    if (!forcarAvulsa) {
      // Conta carteira da vendedora pra decidir cooldown (mesma regra do gerador)
      const { count: totalCart } = await supabase
        .from('lojas_clientes')
        .select('id', { count: 'exact', head: true })
        .eq('vendedora_id', cliente.vendedora_id)
        .is('arquivado_em', null);
      const cooldownDias = (totalCart || 0) < 100 ? 7 : 10;
      const dataLimite = new Date(Date.now() - cooldownDias * 86400000).toISOString().slice(0, 10);

      // Checa sugestoes recentes (exclui sacola — tem regra propria)
      // Cooldown estrito (Ailson 20/05/2026): inclui TAMBEM sacolas.
      // Antes excluia sacola da contagem (era bypass). Agora cliente que
      // recebeu QUALQUER sugestao nos ultimos 7-10d nao recebe avulsa.
      const { data: contactosRecentes } = await supabase
        .from('lojas_sugestoes_diarias')
        .select('data_geracao, tipo, titulo, status, produto_ref')
        .eq('cliente_id', clienteId)
        .eq('vendedora_id', cliente.vendedora_id)
        .gte('data_geracao', dataLimite)
        .order('data_geracao', { ascending: false })
        .limit(3);

      if (contactosRecentes && contactosRecentes.length > 0) {
        const ultimo = contactosRecentes[0];
        const diasAtras = Math.floor((Date.now() - new Date(ultimo.data_geracao).getTime()) / 86400000);
        console.log('[avulsa] cooldown bloqueado:', clienteId, diasAtras + 'd', cooldownDias + 'd cooldown');
        return res.status(409).json({
          ok: false,
          motivo: 'cliente_contactada_recente',
          cooldown_dias: cooldownDias,
          dias_atras: diasAtras,
          ultimo_contato: {
            data: ultimo.data_geracao,
            tipo: ultimo.tipo,
            titulo: ultimo.titulo,
            status: ultimo.status,
            ref: ultimo.produto_ref,
          },
          historico_recente: contactosRecentes.map(c => ({
            data: c.data_geracao, tipo: c.tipo, ref: c.produto_ref, status: c.status,
          })),
          nota: 'Cliente ja foi contactada ha ' + diasAtras + ' dias. Mande forcar_avulsa=true pra ignorar.',
        });
      }
    }
  } catch (e) {
    // Se a checagem falhar (timeout etc), nao bloqueia o fluxo principal
    console.warn('[avulsa] anti-repeticao falhou (segue normal):', e?.message);
  }

  // 2. Cascata pra escolher peça
  // Top categorias da cliente (mesmo calculo do montarContextoMensagem)
  let topCategoria = null;
  try {
    const { data: itens } = await supabase
      .from('lojas_vendas_itens')
      .select('categoria, qtd, lojas_vendas!inner(cliente_id)')
      .eq('lojas_vendas.cliente_id', clienteId);
    if (itens?.length) {
      const counts = {};
      itens.forEach(i => {
        const cat = i.categoria || 'outros';
        counts[cat] = (counts[cat] || 0) + (i.qtd || 1);
      });
      const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      topCategoria = sorted[0]?.[0] || null;
    }
  } catch (e) { /* silent */ }

  // Helper: pega 1 ref de view + filtra por categoria se categoria_alvo informada
  async function escolherDaView(viewName, categoriaAlvo) {
    try {
      const { data } = await supabase
        .from(viewName)
        .select('ref')
        .limit(50);
      if (!data?.length) return null;
      // Cruza com lojas_produtos pra ter categoria + estoque
      const refs = data.map(r => r.ref);
      const { data: prods } = await supabase
        .from('lojas_produtos')
        .select('ref, categoria, qtd_estoque')
        .in('ref', refs);
      if (!prods?.length) return null;
      // Filtra: tem estoque > 5 (vai dar pra falar com tranquilidade)
      let candidatos = prods.filter(p => (p.qtd_estoque || 0) > 5);
      // Se categoria_alvo, prefere ela
      if (categoriaAlvo) {
        const matchCat = candidatos.filter(p => p.categoria === categoriaAlvo);
        if (matchCat.length) candidatos = matchCat;
      }
      return candidatos[0]?.ref || null;
    } catch (e) {
      return null;
    }
  }

  // Cascata
  let refEscolhida = null;
  let tipoSug = 'followup'; // default fallback
  // (a) Novidade na categoria dominante
  if (topCategoria) {
    refEscolhida = await escolherDaView('vw_lojas_novidades_auto', topCategoria);
    if (refEscolhida) tipoSug = 'novidade';
  }
  // (b) Reposicao na categoria dominante
  if (!refEscolhida && topCategoria) {
    refEscolhida = await escolherDaView('vw_lojas_reposicoes_auto', topCategoria);
    if (refEscolhida) tipoSug = 'reposicao';
  }
  // (c) Novidade qualquer
  if (!refEscolhida) {
    refEscolhida = await escolherDaView('vw_lojas_novidades_auto', null);
    if (refEscolhida) tipoSug = 'novidade';
  }
  // (d) Sem peça — followup puro

  // Status da cliente pra ajustar tipo
  const dias = cliente.kpi_dias_sem_comprar; // pode não existir; usa fallback
  // Vou usar lojas_clientes_kpis pra precisão
  let diasSemComprar = null;
  try {
    const { data: kpi } = await supabase
      .from('lojas_clientes_kpis')
      .select('dias_sem_comprar')
      .eq('cliente_id', clienteId)
      .maybeSingle();
    diasSemComprar = kpi?.dias_sem_comprar;
  } catch (e) { /* silent */ }

  // Se cliente está em atenção/inativo e não pegou peça, vira reativar
  if (!refEscolhida && diasSemComprar != null) {
    if (diasSemComprar > 60) tipoSug = 'reativar';
    else if (diasSemComprar > 30) tipoSug = 'atencao';
  }

  // 3. Cria sugestao avulsa em lojas_sugestoes_diarias
  // Marca origem='avulsa' em metadados_ia pra distinguir das 7 diarias do cron
  // FIX 08/05/2026 (Ailson): INSERT estava usando 3 nomes de coluna errados
  // que nao existem no schema (ordem→prioridade, subtipo→nao existe), e
  // faltava alvo_tipo NOT NULL. Resultado: erro 500 PostgREST schema cache.
  // FIX 08/05/2026 (Ailson 2a leva): inclui nome do cliente no titulo e
  // popula alvo_nome_display — antes saia "Mensagem avulsa" anonimo na
  // lista de sugestoes do dia.
  const nomeCliente = cliente.apelido
    || cliente.comprador_nome
    || (cliente.razao_social ? cliente.razao_social.split(' ').slice(0, 3).join(' ') : 'Cliente');
  const hoje = new Date().toISOString().slice(0, 10);
  const { data: sugCriada, error: errCriar } = await supabase
    .from('lojas_sugestoes_diarias')
    .insert({
      vendedora_id: cliente.vendedora_id,
      alvo_tipo: 'cliente',                      // NOT NULL no schema
      cliente_id: clienteId,
      grupo_id: null,
      alvo_nome_display: nomeCliente,
      data_geracao: hoje,
      tipo: tipoSug,
      titulo: refEscolhida
        ? `Mensagem avulsa — ${nomeCliente} · REF ${refEscolhida}`
        : `Mensagem avulsa — ${nomeCliente}`,
      produto_ref: refEscolhida,
      status: 'pendente',
      prioridade: 99,                             // 99 = avulsa, fora das 7 do dia
      fatos: { origem: 'avulsa', escolhida_via: refEscolhida ? 'cascata' : 'sem_peca' },
      metadados_ia: { origem: 'avulsa' },        // marca pra relatorios filtrarem
    })
    .select()
    .single();

  if (errCriar) {
    // FIX Ailson 21/05/2026: race condition double-click.
    // UNIQUE INDEX uniq_avulsa_vendedora_cliente_dia (vendedora_id,
    // cliente_id, data_geracao) WHERE titulo LIKE 'Mensagem avulsa%'
    // bloqueia INSERT duplicado no nivel DB. Quando 2 requests chegam
    // simultaneamente (86-259ms entre clicks), 1 ganha e o outro recebe
    // 23505. Aqui pegamos esse erro, buscamos a sugestao existente e
    // retornamos como duplicada — mesmo comportamento do guard 60s mas
    // que funciona MESMO em race condition.
    if (errCriar.code === '23505') {
      const { data: existente } = await supabase
        .from('lojas_sugestoes_diarias')
        .select('id, titulo, status')
        .eq('vendedora_id', cliente.vendedora_id)
        .eq('cliente_id', clienteId)
        .eq('data_geracao', hoje)
        .like('titulo', 'Mensagem avulsa%')
        .order('created_at', { ascending: true })
        .limit(1)
        .single();
      console.log('[avulsa] race-condition pego pelo UNIQUE INDEX:', clienteId);
      if (existente) {
        return res.status(200).json({
          ok: true,
          sugestao_id: existente.id,
          titulo: existente.titulo,
          mensagem: null,
          duplicada: true,
          motivo: 'double_click_db_race',
          nota: 'Mensagem ja foi criada (race condition detectada no DB). Reusando.',
        });
      }
    }
    console.error('[avulsa] erro criar sugestao:', errCriar);
    return res.status(500).json({ error: 'Erro ao criar sugestão: ' + errCriar.message });
  }

  // Fotos na avulsa (Ailson 11/06/2026): mesma regra das sugestões do dia —
  // 1 foto por REF (Sofia mídias > ficha técnica). A vendedora revisa no
  // modal e o envio vai foto + mensagem junto.
  // EXCEÇÃO (Ailson 18/06/2026): durante o prazo de promoção, manda o CATÁLOGO.
  try {
    const { resolverFotosSugestoes, resolverCatalogoPromoAtivo } = await import('./_lojas-fotos-helpers.js');
    const catPromo = await resolverCatalogoPromoAtivo(supabase);
    if (catPromo) {
      sugCriada.catalogo = catPromo; sugCriada.fotos = null;
      await supabase.from('lojas_sugestoes_diarias')
        .update({ catalogo: catPromo, fotos: null })
        .eq('id', sugCriada.id);
    } else {
      await resolverFotosSugestoes(supabase, [sugCriada]); // muta in-place
      if (sugCriada.fotos) {
        await supabase.from('lojas_sugestoes_diarias')
          .update({ fotos: sugCriada.fotos })
          .eq('id', sugCriada.id);
      }
    }
  } catch (e) {
    console.warn('[avulsa] resolverFotos falhou (segue sem fotos):', e?.message);
  }

  // 4. Reusa handleGerarMensagem injetando o sugestao_id criado
  // Modifica req.body em place pra reaproveitar a logica
  req.body = { ...req.body, sugestao_id: sugCriada.id, contexto: contextoExtra };
  return await handleGerarMensagem(req, res, auth);
}

// ═══════════════════════════════════════════════════════════════════════════
// AÇÃO 3: gerar_resumo_semanal (semana finalizada → resumo + motivacional)
// ═══════════════════════════════════════════════════════════════════════════
//
// Roda toda terça 07:00 BRT (cron). Pra cada vendedora ATIVA, calcula:
//   • Mensagens enviadas na semana (seg-dom anterior)
//   • Sugestões geradas / dispensadas
//   • Conversões com sucesso (regra dos 15 dias):
//     - mensagens enviadas em clientes "atenção" (45-90d sem comprar) ou
//       "inativo" (180-365d) nas últimas 4 semanas
//     - se cliente comprou da MESMA vendedora em até 15 dias após msg
//     → conta como conversão de sucesso
//   • Top 3 clientes que compraram da vendedora na semana
//   • Mensagem motivacional gerada por Claude (tom otimista)
//
// Salva em lojas_resumos_semanais. Vendedora vê no app.
// ═══════════════════════════════════════════════════════════════════════════

async function handleGerarResumoSemanal(req, res, auth) {
  const vendedoraIdAlvo = req.body?.vendedora_id;
  // Pode rodar pra 1 vendedora específica ou pra todas (modo cron)
  const modoTodas = !vendedoraIdAlvo;

  // Permissão: admin pode rodar pra qualquer uma. Vendedora só pra si mesma.
  if (!modoTodas && !auth.isAdmin && auth.vendedoraId !== vendedoraIdAlvo) {
    return res.status(403).json({ error: 'Sem permissão' });
  }
  if (modoTodas && !auth.isAdmin) {
    return res.status(403).json({ error: 'Modo todas: apenas admin' });
  }

  // Carrega vendedoras alvo
  let { data: vendedoras, error: errVend } = await supabase
    .from('lojas_vendedoras')
    .select('id, nome, loja, ativa, is_placeholder')
    .eq('ativa', true);
  if (errVend) {
    return res.status(500).json({ error: errVend.message });
  }
  vendedoras = (vendedoras || []).filter(v => !v.is_placeholder);  // pula placeholders
  if (!modoTodas) {
    vendedoras = vendedoras.filter(v => v.id === vendedoraIdAlvo);
  }
  if (vendedoras.length === 0) {
    return res.status(404).json({ error: 'Nenhuma vendedora ativa elegível' });
  }

  // Janela: segunda anterior → domingo anterior
  const { semana_inicio, semana_fim } = calcularSemanaPassada();

  const resultados = [];
  for (const v of vendedoras) {
    try {
      const r = await gerarResumoVendedora(v, semana_inicio, semana_fim);
      resultados.push({ vendedora_id: v.id, nome: v.nome, ...r });
    } catch (e) {
      console.error(`[resumo-semanal] erro ${v.nome}:`, e);
      resultados.push({ vendedora_id: v.id, nome: v.nome, erro: e.message });
    }
  }

  return res.status(200).json({
    semana_inicio, semana_fim,
    total: vendedoras.length,
    sucessos: resultados.filter(r => !r.erro).length,
    erros: resultados.filter(r => r.erro).length,
    resultados,
  });
}

/**
 * Calcula segunda → domingo da semana ANTERIOR (não a atual).
 * Ex: se hoje é terça 28/04, retorna { inicio: 21/04, fim: 27/04 }
 */
function calcularSemanaPassada() {
  const hoje = new Date();
  const diaDaSemana = hoje.getDay(); // 0=dom, 1=seg, ..., 6=sab
  // Quantos dias voltar pra chegar na segunda anterior:
  //   se hoje é seg(1) → voltar 7 dias
  //   se hoje é ter(2) → voltar 8 dias
  //   se hoje é dom(0) → voltar 6 dias
  const diasParaSegundaAnterior = diaDaSemana === 0 ? 6 : diaDaSemana + 6;
  const segAnterior = new Date(hoje);
  segAnterior.setDate(hoje.getDate() - diasParaSegundaAnterior);
  segAnterior.setHours(0, 0, 0, 0);

  const domAnterior = new Date(segAnterior);
  domAnterior.setDate(segAnterior.getDate() + 6);
  domAnterior.setHours(23, 59, 59, 999);

  return {
    semana_inicio: segAnterior.toISOString().split('T')[0],
    semana_fim: domAnterior.toISOString().split('T')[0],
  };
}

async function gerarResumoVendedora(vendedora, semana_inicio, semana_fim) {
  const inicioISO = `${semana_inicio}T00:00:00Z`;
  const fimISO = `${semana_fim}T23:59:59Z`;

  // ─── 1. Métricas brutas da semana ──────────────────────────────────────
  const { data: acoesSemana } = await supabase
    .from('lojas_acoes')
    .select('tipo_acao, resultado')
    .eq('vendedora_id', vendedora.id)
    .gte('created_at', inicioISO)
    .lte('created_at', fimISO);

  const mensagens_enviadas = (acoesSemana || [])
    .filter(a => a.tipo_acao === 'mensagem_enviada').length;
  const sugestoes_dispensadas = (acoesSemana || [])
    .filter(a => a.tipo_acao === 'dispensada').length;

  const { count: sugestoes_geradas } = await supabase
    .from('lojas_sugestoes_diarias')
    .select('*', { count: 'exact', head: true })
    .eq('vendedora_id', vendedora.id)
    .gte('data_referencia', semana_inicio)
    .lte('data_referencia', semana_fim);

  // ─── 2. Conversões com sucesso (regra dos 15 dias) ────────────────────
  // Pega mensagens enviadas nas últimas 4 semanas pra clientes atenção/inativo
  const quatroSemanasAtras = new Date(inicioISO);
  quatroSemanasAtras.setDate(quatroSemanasAtras.getDate() - 21); // semana_inicio - 21d = 4 semanas total

  const { data: msgs4semanas } = await supabase
    .from('lojas_acoes')
    .select(`
      id, cliente_id, created_at, observacao,
      lojas_clientes!inner(id, razao_social, fantasia, status_atual)
    `)
    .eq('vendedora_id', vendedora.id)
    .eq('tipo_acao', 'mensagem_enviada')
    .gte('created_at', quatroSemanasAtras.toISOString())
    .lte('created_at', fimISO);

  const msgs_atencao_inativo = (msgs4semanas || []).filter(m => {
    const status = m.lojas_clientes?.status_atual;
    // Inclui as 3 faixas que disparam mensagem de reativação
    return status === 'atencao' || status === 'semAtividade' || status === 'inativo';
  });

  const mensagens_atencao_inativo = msgs_atencao_inativo.length;

  // Pra cada msg atenção/semAtividade/inativo, ver se houve compra em até 15d
  // (regra Ailson 01/05/2026: era 30d, ajustada pra 15d).
  const JANELA_CONVERSAO_DIAS = 15;
  const conversoes_detalhe = [];
  for (const msg of msgs_atencao_inativo) {
    const dataMsg = new Date(msg.created_at);
    const dataFimJanela = new Date(dataMsg);
    dataFimJanela.setDate(dataMsg.getDate() + JANELA_CONVERSAO_DIAS);

    const { data: vendasPosMsg } = await supabase
      .from('lojas_vendas')
      .select('id, data_venda, valor_liquido')
      .eq('vendedora_id', vendedora.id)
      .eq('cliente_id', msg.cliente_id)
      .gte('data_venda', dataMsg.toISOString().split('T')[0])
      .lte('data_venda', dataFimJanela.toISOString().split('T')[0])
      .order('data_venda', { ascending: true })
      .limit(1);

    if (vendasPosMsg && vendasPosMsg.length > 0) {
      const venda = vendasPosMsg[0];
      const dias = Math.round((new Date(venda.data_venda) - dataMsg) / 86400000);
      const statusEnvio = msg.lojas_clientes?.status_atual;
      const clienteNome = msg.lojas_clientes?.fantasia || msg.lojas_clientes?.razao_social;
      conversoes_detalhe.push({
        cliente_id: msg.cliente_id,
        cliente_nome: clienteNome,
        data_msg: msg.created_at.split('T')[0],
        data_venda: venda.data_venda,
        dias,
        valor: Number(venda.valor_liquido),
      });

      // ─── Arquiva conversão (idempotente via unique key msg+venda) ──────
      // Mesmo se a mensagem ou venda forem deletadas/arquivadas depois,
      // o histórico de conversão fica preservado pra dashboard.
      try {
        await supabase
          .from('lojas_conversoes')
          .upsert({
            vendedora_id: vendedora.id,
            cliente_id: msg.cliente_id,
            mensagem_id: msg.id,
            data_mensagem: msg.created_at.split('T')[0],
            status_no_envio: statusEnvio,
            venda_id: venda.id,
            data_venda: venda.data_venda,
            dias_ate_compra: dias,
            valor_venda: Number(venda.valor_liquido),
            cliente_nome: clienteNome,
          }, { onConflict: 'mensagem_id,venda_id' });
      } catch (e) {
        // Não bloqueia o fluxo se arquivamento falhar (tabela pode não existir
        // antes do SQL ser rodado). Loga e segue.
        console.warn('[lojas-conversao] erro arquivar:', e?.message);
      }
    }
  }
  const conversoes_sucesso = conversoes_detalhe.length;
  const taxa_conversao = mensagens_atencao_inativo > 0
    ? Math.round((conversoes_sucesso / mensagens_atencao_inativo) * 10000) / 100
    : 0;

  // ─── 3. Top 3 clientes da semana ──────────────────────────────────────
  const { data: vendasSemana } = await supabase
    .from('lojas_vendas')
    .select(`
      cliente_id, valor_liquido,
      lojas_clientes!inner(id, razao_social, fantasia)
    `)
    .eq('vendedora_id', vendedora.id)
    .gte('data_venda', semana_inicio)
    .lte('data_venda', semana_fim);

  const agregado = new Map();
  for (const v of (vendasSemana || [])) {
    const k = v.cliente_id;
    if (!k) continue;
    const cur = agregado.get(k) || {
      cliente_id: k,
      nome: v.lojas_clientes?.fantasia || v.lojas_clientes?.razao_social || 'Cliente sem nome',
      qtd_pedidos: 0, total_comprado: 0,
    };
    cur.qtd_pedidos++;
    cur.total_comprado += Number(v.valor_liquido) || 0;
    agregado.set(k, cur);
  }
  const top_clientes = Array.from(agregado.values())
    .sort((a, b) => b.total_comprado - a.total_comprado)
    .slice(0, 3);

  // ─── 4. Gera mensagem motivacional via Claude ─────────────────────────
  const promptMotivacional = montarPromptMotivacional(vendedora, {
    mensagens_enviadas, sugestoes_geradas, sugestoes_dispensadas,
    mensagens_atencao_inativo, conversoes_sucesso, taxa_conversao,
    top_clientes, semana_inicio, semana_fim,
  });

  const modeloIA = await getLojasConfig('modelo_ia', 'claude-sonnet-4-6');
  let mensagem_motivacional = null;
  let tokens_input = 0, tokens_output = 0, custo_brl = 0;
  try {
    const resp = await chamarClaude({
      model: modeloIA,
      max_tokens: 400,
      system: 'Você é uma coach motivacional pra vendedoras de moda. Tom: otimista, próximo, brasileiro descontraído. Frases curtas (máximo 3-4 frases). Use emojis com moderação. Valoriza o esforço sem ser piegas.',
      messages: [{ role: 'user', content: promptMotivacional }],
    });
    mensagem_motivacional = resp?.content?.find(b => b?.type === 'text')?.text?.trim() || null;
    tokens_input = resp?.usage?.input_tokens || 0;
    tokens_output = resp?.usage?.output_tokens || 0;
    // logarChamadaIA já calcula custo
    await logarChamadaIA({
      contexto: 'lojas_resumo_semanal',
      vendedora_id: vendedora.id,
      modelo: modeloIA,
      tokens_input, tokens_output,
    });
  } catch (e) {
    console.error('[resumo-semanal] erro Claude:', e);
  }
  // FIX 11/06/2026 (Ailson): o fallback só rodava em exceção — quando a IA
  // respondia mas o texto vinha vazio (ex: bloco thinking em content[0]),
  // mensagem_motivacional ia NULL pro banco e a vendedora via resumo sem
  // mensagem. Fallback agora é garantido.
  if (!mensagem_motivacional) {
    mensagem_motivacional = `Olá ${vendedora.nome}! Mais uma semana fechada. Bora pra próxima! 💪`;
  }

  // ─── 5. Salva (upsert pela chave única vendedora_id+semana_inicio) ────
  const { data: salvo, error: errSalvar } = await supabase
    .from('lojas_resumos_semanais')
    .upsert({
      vendedora_id: vendedora.id,
      semana_inicio, semana_fim,
      mensagens_enviadas: mensagens_enviadas || 0,
      sugestoes_geradas: sugestoes_geradas || 0,
      sugestoes_dispensadas: sugestoes_dispensadas || 0,
      mensagens_atencao_inativo,
      conversoes_sucesso,
      taxa_conversao,
      top_clientes,
      conversoes_detalhe,
      mensagem_motivacional,
      modelo_ia: modeloIA,
      tokens_input, tokens_output,
      gerado_em: new Date().toISOString(),
    }, { onConflict: 'vendedora_id,semana_inicio' })
    .select()
    .single();

  if (errSalvar) throw new Error(`Erro salvando resumo: ${errSalvar.message}`);

  return {
    resumo_id: salvo.id,
    metricas: {
      mensagens_enviadas, sugestoes_geradas, sugestoes_dispensadas,
      mensagens_atencao_inativo, conversoes_sucesso, taxa_conversao,
    },
    top_clientes_qtd: top_clientes.length,
    mensagem_preview: mensagem_motivacional?.substring(0, 100),
  };
}

function montarPromptMotivacional(vendedora, dados) {
  const {
    mensagens_enviadas, sugestoes_geradas, sugestoes_dispensadas,
    mensagens_atencao_inativo, conversoes_sucesso, taxa_conversao,
    top_clientes,
  } = dados;

  const topClientesTxt = top_clientes.length === 0
    ? 'Nenhum.'
    : top_clientes.map((c, i) =>
      `${i + 1}. ${c.nome}: ${c.qtd_pedidos} pedido(s), R$ ${c.total_comprado.toFixed(2)}`
    ).join('\n');

  return `Vendedora: ${vendedora.nome} (${vendedora.loja})

Métricas da semana passada:
- Mensagens enviadas: ${mensagens_enviadas}
- Sugestões geradas pra você pela IA: ${sugestoes_geradas}
- Sugestões dispensadas: ${sugestoes_dispensadas}
- Mensagens enviadas pra clientes em atenção/inativo (últimas 4 sem): ${mensagens_atencao_inativo}
- Dessas, converteram em compra (até 15 dias): ${conversoes_sucesso}
- Taxa de conversão: ${taxa_conversao}%

Top clientes da semana:
${topClientesTxt}

Gere uma mensagem motivacional curta (3-4 frases máximo) chamando pelo nome dela. Use os números reais quando relevante. Tom otimista mas honesto — se foi uma semana fraca, encoraja sem fingir. Se foi forte, celebra com ela. Brasileiro descontraído, sem ser piegas.`;
}


// ═══════════════════════════════════════════════════════════════════════════
// AÇÃO 4: conversoes_dashboard (KPI card no Dashboard Lojas)
// ═══════════════════════════════════════════════════════════════════════════
//
// Retorna agregado de conversoes pra o card Conversoes.
// Filtros suportados:
//   - vendedora_id (opcional, default = todas)
//   - periodo: 'mes_atual' (default) | '7d' | 'mes_passado' | 'all'
//
// Resposta: { periodo, periodo_label, total, valor_total, por_status,
// por_vendedora, detalhe (top 50) }
// ═══════════════════════════════════════════════════════════════════════════

function _calcularRangeConversoes(periodo) {
  const hoje = new Date();
  const fim = hoje.toISOString().slice(0, 10);
  let inicio;
  let label;
  switch (periodo) {
    case '7d': {
      const d = new Date(hoje);
      d.setDate(d.getDate() - 7);
      inicio = d.toISOString().slice(0, 10);
      label = 'Últimos 7 dias';
      break;
    }
    case 'mes_passado': {
      const d = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
      const fimMes = new Date(hoje.getFullYear(), hoje.getMonth(), 0);
      inicio = d.toISOString().slice(0, 10);
      const fimMesStr = fimMes.toISOString().slice(0, 10);
      label = 'Mês passado';
      return { inicio, fim: fimMesStr, label };
    }
    case 'all': {
      inicio = '2024-01-01';
      label = 'Todo período';
      break;
    }
    case 'mes_atual':
    default: {
      const d = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
      inicio = d.toISOString().slice(0, 10);
      label = 'Mês atual';
      break;
    }
  }
  return { inicio, fim, label };
}

async function handleConversoesDashboard(req, res, _auth) {
  const vendedora_id = req.body?.vendedora_id || null;
  const periodo = req.body?.periodo || 'mes_atual';
  const { inicio, fim, label } = _calcularRangeConversoes(periodo);

  let query = supabase
    .from('lojas_conversoes')
    .select('vendedora_id, cliente_id, cliente_nome, status_no_envio, dias_ate_compra, valor_venda, data_venda, data_mensagem, origem_tipo, canal_pedido, lead_id, pedido_mire_id')
    .gte('data_venda', inicio)
    .lte('data_venda', fim)
    .order('data_venda', { ascending: false });

  if (vendedora_id) {
    query = query.eq('vendedora_id', vendedora_id);
  }

  const { data: conversoes, error } = await query;
  if (error) {
    return res.status(500).json({ error: error.message });
  }

  // Carrega nomes das vendedoras (pra agregado)
  const { data: vendedoras } = await supabase
    .from('lojas_vendedoras')
    .select('id, nome');
  const nomeVendedora = (vid) => {
    const v = (vendedoras || []).find(x => x.id === vid);
    return v?.nome || '?';
  };

  const total = (conversoes || []).length;
  const valor_total = (conversoes || []).reduce((s, c) => s + Number(c.valor_venda || 0), 0);

  const por_status = { atencao: 0, semAtividade: 0, inativo: 0 };
  for (const c of conversoes || []) {
    if (por_status[c.status_no_envio] !== undefined) {
      por_status[c.status_no_envio]++;
    }
  }

  // ─── Agregado por origem (cliente vs lead carrinho) — Ailson 13/05/2026 ──
  // Inclui conversões automaticas detectadas via cruzamento Miré ↔ leads.
  // Pra admin, mostra a quebra completa no card.
  const por_origem = {
    cliente: { total: 0, valor: 0 },
    lead_carrinho: { total: 0, valor: 0, site: 0, manual: 0, valor_site: 0, valor_manual: 0 },
  };
  for (const c of conversoes || []) {
    const origem = c.origem_tipo === 'lead_carrinho' ? 'lead_carrinho' : 'cliente';
    const v = Number(c.valor_venda || 0);
    por_origem[origem].total++;
    por_origem[origem].valor += v;
    if (origem === 'lead_carrinho') {
      if (c.canal_pedido === 'site') {
        por_origem.lead_carrinho.site++;
        por_origem.lead_carrinho.valor_site += v;
      } else {
        por_origem.lead_carrinho.manual++;
        por_origem.lead_carrinho.valor_manual += v;
      }
    }
  }
  // Arredondar valores
  por_origem.cliente.valor = Math.round(por_origem.cliente.valor * 100) / 100;
  por_origem.lead_carrinho.valor = Math.round(por_origem.lead_carrinho.valor * 100) / 100;
  por_origem.lead_carrinho.valor_site = Math.round(por_origem.lead_carrinho.valor_site * 100) / 100;
  por_origem.lead_carrinho.valor_manual = Math.round(por_origem.lead_carrinho.valor_manual * 100) / 100;

  const mapaVendedora = new Map();
  for (const c of conversoes || []) {
    const k = c.vendedora_id;
    if (!mapaVendedora.has(k)) {
      mapaVendedora.set(k, { vendedora_id: k, vendedora_nome: nomeVendedora(k), total: 0, valor: 0 });
    }
    const v = mapaVendedora.get(k);
    v.total++;
    v.valor += Number(c.valor_venda || 0);
  }
  const por_vendedora = Array.from(mapaVendedora.values()).sort((a, b) => b.total - a.total);

  // ─── Conversões Vesti (teste A/B Fase 2) — Ailson 02/06/2026 ────────────
  // O sinal vesti mora em lojas_whats_conversas.vendeu_canal (marcado pela
  // função lojas_whats_vesti_auto_vendeu), NÃO em lojas_conversoes. Por isso
  // contamos direto da fonte aqui, filtrando vendedora + período por vendeu_em.
  let vesti = { qtd: 0, valor: 0 };
  try {
    // fim é date 'YYYY-MM-DD'; vendeu_em é timestamptz → usa próximo dia exclusivo
    const _fim1 = new Date(fim + 'T00:00:00Z');
    _fim1.setUTCDate(_fim1.getUTCDate() + 1);
    const fimExclusivo = _fim1.toISOString().slice(0, 10);

    let vestiQ = supabase
      .from('lojas_whats_conversas')
      .select('vendeu_valor')
      .eq('vendeu_canal', 'vesti')
      .gte('vendeu_em', inicio)
      .lt('vendeu_em', fimExclusivo);
    if (vendedora_id) vestiQ = vestiQ.eq('vendedora_atribuida_id', vendedora_id);

    const { data: vestiRows, error: vestiErr } = await vestiQ;
    if (vestiErr) {
      console.error('[conversoes_dashboard] erro query vesti:', vestiErr.message);
    } else {
      vesti.qtd = (vestiRows || []).length;
      vesti.valor = Math.round((vestiRows || []).reduce((s, r) => s + Number(r.vendeu_valor || 0), 0) * 100) / 100;
    }
  } catch (e) {
    console.error('[conversoes_dashboard] exceção query vesti:', e.message);
  }

  return res.json({
    periodo,
    periodo_label: label,
    data_inicio: inicio,
    data_fim: fim,
    vendedora_id: vendedora_id || null,
    total,
    valor_total: Math.round(valor_total * 100) / 100,
    por_status,
    por_origem,
    por_vendedora,
    vesti,
    detalhe: (conversoes || []).slice(0, 50),
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// AÇÃO 5: metas_dashboard (Card de metas vendedora — Sprint A 04/05/2026)
// ═══════════════════════════════════════════════════════════════════════════
//
// Retorna progresso da meta de cada vendedora ATIVA no período (default: mes
// corrente em BRT, mas aceita filtros).
//
// Uso:
//   POST /api/lojas-ia { action: 'metas_dashboard', periodo: 'mes_atual' | '2026-04' }
//
// Lê de vw_lojas_vendas_completo (UNION atacado + varejo). Soma agrupado
// por vendedora_id + categoria. Filtra mês corrente em BRT. Calcula
// checkpoints batidos (sem dispara push, só info pro frontend).
//
// Estrutura de resposta:
//   {
//     periodo: '2026-05',
//     periodo_label: 'Maio/2026',
//     data_inicio: '2026-05-01',
//     data_fim: '2026-05-31',
//     vendedoras: [
//       { vendedora_id, nome, loja, atacado, varejo, total,
//         meta_principal, percentual, checkpoints_batidos: [35000, 50000] }
//     ],
//     loja_BR: { total, vendedoras_ativas },
//     loja_ST: { total, vendedoras_ativas },
//   }

const METAS_BR = {
  // Bom Retiro: 70/80/90/100k metas, com checkpoints intermediários
  meta_principal: 100000,
  checkpoints: [35000, 50000, 60000, 70000, 80000, 90000, 100000],
  metas: [70000, 80000, 90000, 100000],  // metas que dão bônus
};

const METAS_ST = {
  // Silva Teles: 70k 1ª meta (contida) / 140k grande
  meta_principal: 140000,
  checkpoints: [60000, 70000, 80000, 90000, 100000, 140000],
  metas: [70000, 140000],
};

function metasDaLoja(loja) {
  if (loja === 'Bom Retiro') return METAS_BR;
  if (loja === 'Silva Teles') return METAS_ST;
  return METAS_BR;  // fallback
}

async function handleMetasDashboard(req, res, _auth) {
  const { periodo = 'mes_atual', vendedora_id } = req.body || {};

  // Calcula intervalo de datas em BRT
  const agora = new Date();
  const agoraBRT = new Date(agora.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  let ano, mes;  // 1-indexed
  if (periodo === 'mes_atual') {
    ano = agoraBRT.getFullYear();
    mes = agoraBRT.getMonth() + 1;
  } else if (/^\d{4}-\d{2}$/.test(periodo)) {
    [ano, mes] = periodo.split('-').map(Number);
  } else {
    return res.status(400).json({ error: 'periodo invalido (use "mes_atual" ou "AAAA-MM")' });
  }

  const inicio = `${ano}-${String(mes).padStart(2, '0')}-01`;
  // Ultimo dia do mes:
  const fimDate = new Date(ano, mes, 0);  // dia 0 do mês seguinte = último dia do mês
  const fim = `${ano}-${String(mes).padStart(2, '0')}-${String(fimDate.getDate()).padStart(2, '0')}`;
  const periodo_label = fimDate.toLocaleString('pt-BR', { month: 'long', year: 'numeric' })
    .replace(/^\w/, c => c.toUpperCase());

  // Busca vendas no periodo (atacado + varejo via view)
  let query = supabase
    .from('vw_lojas_vendas_completo')
    .select('vendedora_id, categoria, valor_liquido, loja')
    .gte('data_venda', inicio)
    .lte('data_venda', fim);

  if (vendedora_id) {
    query = query.eq('vendedora_id', vendedora_id);
  }

  const { data: vendas, error } = await query;
  if (error) {
    return res.status(500).json({ error: 'erro buscar vendas', detalhe: error.message });
  }

  // Busca vendedoras ativas (filtra placeholders)
  const { data: vendedorasRaw } = await supabase
    .from('lojas_vendedoras')
    .select('id, nome, loja')
    .eq('ativa', true)
    .eq('is_placeholder', false)
    .order('loja')
    .order('nome');

  const vendedoras = vendedorasRaw || [];

  // Agrupa vendas por vendedora_id + categoria
  const mapa = new Map();  // vendedora_id → { atacado, varejo, total }
  for (const v of vendas || []) {
    if (!v.vendedora_id) continue;  // venda sem vendedora não conta meta
    if (!mapa.has(v.vendedora_id)) {
      mapa.set(v.vendedora_id, { atacado: 0, varejo: 0, total: 0 });
    }
    const valor = Number(v.valor_liquido || 0);
    const acc = mapa.get(v.vendedora_id);
    if (v.categoria === 'atacado') acc.atacado += valor;
    else if (v.categoria === 'varejo') acc.varejo += valor;
    acc.total += valor;
  }

  // Monta resposta vendedora a vendedora
  const respVend = vendedoras.map(vd => {
    const totais = mapa.get(vd.id) || { atacado: 0, varejo: 0, total: 0 };
    const cfg = metasDaLoja(vd.loja);
    const checkpointsBatidos = cfg.checkpoints.filter(c => totais.total >= c);
    const percentual = cfg.meta_principal > 0
      ? Math.round((totais.total / cfg.meta_principal) * 100)
      : 0;
    return {
      vendedora_id: vd.id,
      nome: vd.nome,
      loja: vd.loja,
      atacado: Math.round(totais.atacado * 100) / 100,
      varejo: Math.round(totais.varejo * 100) / 100,
      total: Math.round(totais.total * 100) / 100,
      meta_principal: cfg.meta_principal,
      checkpoints_loja: cfg.checkpoints,
      checkpoints_batidos: checkpointsBatidos,
      percentual,
    };
  });

  // Totais por loja
  // FIX 06/05/2026 (Ailson): somar direto da `vendas` (view) em vez de
  // somar de respVend.filter(...). Razao: respVend so tem vendedoras
  // fixas (is_placeholder=false). Vendas que caem em:
  //   - placeholders Vendedora_3/Vendedora_4 (vendedoras antigas absorvidas)
  //   - vendedora_id=NULL (caso extremo)
  //   - vendedora teste com nome novo que cair na padrao da loja (ja entra,
  //     mas eh redundancia ok)
  // ficavam fora do total. Agora o total da loja eh a soma REAL daquele
  // dia/mes, batendo com o relatorio Mire.
  // Card de metas individual continua mostrando so as fixas.
  const somarLoja = (nomeLoja) => (vendas || [])
    .filter(v => v.loja === nomeLoja)
    .reduce((s, v) => s + Number(v.valor_liquido || 0), 0);

  const lojaBR = {
    total: Math.round(somarLoja('Bom Retiro') * 100) / 100,
    vendedoras_ativas: respVend.filter(r => r.loja === 'Bom Retiro').length,
    meta_principal_individual: METAS_BR.meta_principal,
  };

  const lojaST = {
    total: Math.round(somarLoja('Silva Teles') * 100) / 100,
    vendedoras_ativas: respVend.filter(r => r.loja === 'Silva Teles').length,
    meta_principal_individual: METAS_ST.meta_principal,
  };

  return res.json({
    periodo: `${ano}-${String(mes).padStart(2, '0')}`,
    periodo_label,
    data_inicio: inicio,
    data_fim: fim,
    vendedoras: respVend,
    loja_BR: lojaBR,
    loja_ST: lojaST,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER: enriquecer_observacao — Onda 2 (Ailson 10/05/2026)
// ═══════════════════════════════════════════════════════════════════════════
//
// Quando vendedora marca uma reclamacao/elogio/evento e quer enriquecer com IA,
// chamamos Claude com:
//   - contexto resumido da cliente (apelido, status, dias_sem, top categorias, etc)
//   - categoria + tipo + detalhe do que ela acabou de marcar
//   - observacoes existentes (pra evitar perguntar o que ja sabe)
// e Claude retorna 3 perguntas com 3-4 alternativas cada (JSON estrito).
//
// Frontend renderiza as perguntas, vendedora responde clicando, e as respostas
// sao salvas em observacoes_ia.<categoria>[i].contexto.respostas_ia
//
// Body: { action: 'enriquecer_observacao', cliente_id, categoria, tipo, detalhe }
// Retorno: { ok: true, perguntas: [{id, texto, alternativas: [{id, label}]}] }
//
async function handleEnriquecerObservacao(req, res, auth) {
  const { cliente_id, categoria, tipo, detalhe = '' } = req.body || {};

  if (!cliente_id || !categoria || !tipo) {
    return res.status(400).json({
      error: 'cliente_id, categoria e tipo sao obrigatorios',
    });
  }
  const CATS_VALIDAS = ['reclamacao', 'elogio', 'evento_timeline'];
  if (!CATS_VALIDAS.includes(categoria)) {
    return res.status(400).json({
      error: `categoria invalida (esperado: ${CATS_VALIDAS.join(', ')})`,
    });
  }

  // 1) Carrega cliente + valida auth
  const { data: cliente, error: errCli } = await supabase
    .from('lojas_clientes')
    .select('id, apelido, comprador_nome, vendedora_id, endereco_uf, observacoes_ia')
    .eq('id', cliente_id)
    .maybeSingle();
  if (errCli) return res.status(500).json({ error: errCli.message });
  if (!cliente) return res.status(404).json({ error: 'Cliente nao encontrado' });
  if (!auth.isAdmin && cliente.vendedora_id !== auth.vendedoraId) {
    return res.status(403).json({ error: 'Sem permissao pra esse cliente' });
  }

  // 2) Carrega KPIs basicos
  const { data: kpi } = await supabase
    .from('lojas_clientes_kpis')
    .select('status_atual, dias_sem_comprar, lifetime_total, qtd_compras, ticket_medio')
    .eq('cliente_id', cliente_id)
    .maybeSingle();

  // 3) Top categorias (resumido)
  let topCategorias = [];
  try {
    const { data: itens } = await supabase
      .from('lojas_vendas_itens')
      .select('categoria, qtd, lojas_vendas!inner(cliente_id)')
      .eq('lojas_vendas.cliente_id', cliente_id);
    if (itens?.length) {
      const counts = {};
      itens.forEach(i => {
        const cat = i.categoria || 'outros';
        counts[cat] = (counts[cat] || 0) + (i.qtd || 1);
      });
      topCategorias = Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([cat, qtd]) => ({ categoria: cat, qtd }));
    }
  } catch (e) { /* silent */ }

  // 4) Conta ultimas conversoes (resumido — sem detalhe das peças aqui)
  let ultimaCompraResumo = null;
  try {
    const { data: ultV } = await supabase
      .from('lojas_vendas')
      .select('id, data_venda, total')
      .eq('cliente_id', cliente_id)
      .order('data_venda', { ascending: false })
      .limit(1);
    if (ultV?.length) {
      ultimaCompraResumo = {
        data_venda: ultV[0].data_venda,
        total: ultV[0].total,
      };
    }
  } catch (e) { /* silent */ }

  // 5) Observacoes existentes (pra IA nao perguntar o que ja sabe)
  // Mas remove o item recem-adicionado pra nao confundir
  const obsExistente = cliente.observacoes_ia || {};
  const apelido = cliente.apelido || cliente.comprador_nome || '';

  // 6) Configuracao + orcamento
  const cfg = await getLojasConfig();
  const orcOk = await temOrcamento({ acao: 'enriquecer_observacao' });
  if (!orcOk.ok) {
    return res.status(429).json({
      error: orcOk.motivo || 'Orcamento mensal esgotado',
    });
  }

  // 7) Monta payload pro Claude
  const userPayload = {
    cliente: {
      apelido,
      status_cliente: kpi?.status_atual || 'desconhecido',
      dias_sem_comprar: kpi?.dias_sem_comprar || null,
      qtd_compras: kpi?.qtd_compras || 0,
      lifetime: kpi?.lifetime_total || 0,
      ticket_medio: kpi?.ticket_medio || null,
      cliente_uf: (cliente.endereco_uf || '').trim().toUpperCase() || null,
    },
    historico_resumo: {
      top_categorias: topCategorias.length > 0 ? topCategorias : null,
      ultima_compra: ultimaCompraResumo,
    },
    categoria,
    tipo,
    detalhe: detalhe ? String(detalhe).slice(0, 300).trim() : '',
    observacoes_existentes: {
      personalidade: obsExistente.personalidade || null,
      evento_recente: obsExistente.evento_recente || null,
      perfil_compra: obsExistente.perfil_compra || [],
      preferencias: obsExistente.preferencias || '',
      observacao_livre: obsExistente.observacao_livre || '',
      tem_reclamacoes: (obsExistente.reclamacoes || []).length,
      tem_elogios: (obsExistente.elogios || []).length,
      tem_eventos_timeline: (obsExistente.eventos_timeline || []).length,
    },
  };

  // 8) Chama Claude
  const systemBlocks = [
    {
      type: 'text',
      text: SYSTEM_PROMPT_ENRIQUECER,
      cache_control: { type: 'ephemeral' },
    },
  ];
  const messages = [
    {
      role: 'user',
      content: JSON.stringify(userPayload, null, 2),
    },
  ];

  const resp = await chamarClaude({
    modelo: cfg.modelo_ia || 'claude-sonnet-4-6',
    systemBlocks,
    messages,
    max_tokens: 1500,
    temperature: 0.5, // mais determinista — perguntas devem ser coerentes
  });

  if (!resp.ok) {
    await logarChamadaIA({
      acao: 'enriquecer_observacao',
      vendedora_id: auth.vendedoraId,
      modelo: cfg.modelo_ia || 'claude-sonnet-4-6',
      ok: false,
      erro: resp.erro,
      latencia_ms: resp.latencia_ms,
    }).catch(() => {});
    return res.status(502).json({ error: resp.erro });
  }

  // 9) Parseia JSON tolerante
  const parsed = parseJsonTolerante(resp.texto);
  if (!parsed || !Array.isArray(parsed.perguntas) || parsed.perguntas.length !== 3) {
    await logarChamadaIA({
      acao: 'enriquecer_observacao',
      vendedora_id: auth.vendedoraId,
      modelo: cfg.modelo_ia || 'claude-sonnet-4-6',
      ok: false,
      erro: 'JSON invalido ou perguntas != 3',
      latencia_ms: resp.latencia_ms,
      input_tokens: resp.usage?.input_tokens || 0,
      output_tokens: resp.usage?.output_tokens || 0,
    }).catch(() => {});
    return res.status(502).json({
      error: 'IA retornou formato invalido. Tente novamente.',
      raw: resp.texto.slice(0, 500),
    });
  }

  // 10) Sanitiza perguntas (whitelist forma)
  const perguntasSanitizadas = parsed.perguntas
    .filter(p => p && typeof p === 'object' && p.texto && Array.isArray(p.alternativas))
    .slice(0, 3)
    .map((p, idx) => ({
      id: typeof p.id === 'string' ? p.id.slice(0, 20) : `p${idx + 1}`,
      texto: String(p.texto).slice(0, 200),
      alternativas: (p.alternativas || [])
        .filter(a => a && typeof a === 'object' && a.label)
        .slice(0, 4)
        .map((a, ai) => ({
          id: typeof a.id === 'string' ? a.id.slice(0, 30) : `a${ai + 1}`,
          label: String(a.label).slice(0, 100),
        })),
    }))
    .filter(p => p.alternativas.length >= 2);

  if (perguntasSanitizadas.length !== 3) {
    return res.status(502).json({
      error: 'IA retornou perguntas em formato invalido. Tente novamente.',
    });
  }

  // 11) Log + retorna
  await logarChamadaIA({
    acao: 'enriquecer_observacao',
    vendedora_id: auth.vendedoraId,
    modelo: cfg.modelo_ia || 'claude-sonnet-4-6',
    ok: true,
    latencia_ms: resp.latencia_ms,
    input_tokens: resp.usage?.input_tokens || 0,
    output_tokens: resp.usage?.output_tokens || 0,
    cache_read_tokens: resp.usage?.cache_read_input_tokens || 0,
  }).catch(() => {});

  return res.json({
    ok: true,
    perguntas: perguntasSanitizadas,
    latencia_ms: resp.latencia_ms,
  });
}
