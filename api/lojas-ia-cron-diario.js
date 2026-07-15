/**
 * lojas-ia-cron-diario.js — Cron diário das sugestões da IA Lojas.
 *
 * Schedule: 0 10 * * 1-5 (07:00 BRT, segunda a sexta)
 *   - 10:00 UTC = 07:00 BRT (UTC-3)
 *
 * Pra cada vendedora ATIVA não-placeholder, dispara internamente
 * /api/lojas-ia { action: 'gerar_sugestoes', vendedora_id }.
 *
 * Cada vendedora recebe 7 sugestões: 1 reativar + 2 atenção + 3 novidade +
 * 1 followup (com sacola substituindo novidade quando há).
 */

import { supabase, setCors } from './_lojas-helpers.js';

export const config = { maxDuration: 800 };

export default async function handler(req, res) {
  setCors(res);

  // ═══ LOG DE INVOCAÇÃO (sempre, antes de qualquer guard) ═══
  // Garante que conseguimos ver no Supabase se o Vercel chamou esse handler
  // — independente de retornar 403, sucesso ou erro depois.
  const userAgent = req.headers['user-agent'] || '';
  // Vercel sempre envia user-agent 'vercel-cron/1.0' quando dispara cron.
  // Header 'x-vercel-cron' foi descontinuado (não vem mais — bug 30/04/2026
  // descoberto qdo cron retornou 403 todo dia 7h e nenhuma sugestão era gerada).
  // Mantemos check do header legado por compatibilidade defensiva.
  const ehCron = userAgent.startsWith('vercel-cron') || req.headers['x-vercel-cron'] !== undefined;
  const userId = req.query?.user || req.headers['x-user'];

  let healthId = null;
  try {
    const { data: hl } = await supabase
      .from('lojas_cron_health')
      .insert({
        cron_name: 'lojas-ia-cron-diario',
        origem: ehCron ? 'vercel-cron' : (userId === 'ailson' ? 'manual-admin' : 'unknown'),
        user_agent: userAgent,
        triggered_by: userId || (ehCron ? 'vercel' : null),
        status: 'iniciada',
      })
      .select('id')
      .single();
    healthId = hl?.id || null;
  } catch (e) {
    console.warn('[cron-health] insert falhou:', e?.message);
  }

  const inicio = Date.now();

  // Helper pra finalizar log antes de retornar
  const finalizar = async (status, detalhes = {}) => {
    if (!healthId) return;
    try {
      await supabase
        .from('lojas_cron_health')
        .update({
          finished_at: new Date().toISOString(),
          duracao_ms: Date.now() - inicio,
          status,
          ...detalhes,
        })
        .eq('id', healthId);
    } catch (e) {
      console.warn('[cron-health] update falhou:', e?.message);
    }
  };

  // ═══ Guard de auth ═══
  const ehAdmin = userId === 'ailson';
  if (!ehCron && !ehAdmin) {
    await finalizar('erro', { erro_msg: 'auth-403: nao eh cron nem admin' });
    return res.status(403).json({
      error: 'Apenas cron Vercel ou admin',
      uso_manual: '/api/lojas-ia-cron-diario?user=ailson',
    });
  }

  // Carrega vendedoras ativas (não placeholders)
  const { data: vendedoras, error } = await supabase
    .from('lojas_vendedoras')
    .select('id, nome, loja')
    .eq('ativa', true)
    .eq('is_placeholder', false);
  if (error) {
    await finalizar('erro', { erro_msg: `load-vendedoras: ${error.message}` });
    return res.status(500).json({ error: error.message });
  }
  if (!vendedoras || vendedoras.length === 0) {
    await finalizar('sucesso', { total_alvos: 0, sucessos: 0, erros: 0, detalhes: { vazio: true } });
    return res.status(200).json({ ok: true, mensagem: 'Nenhuma vendedora ativa', total: 0 });
  }

  // Dispara em SÉRIE com delay (Anthropic rate limit: 30k input tokens/min).
  // Cada vendedora consome ~70-90k tokens. Sem delay, 2ª vendedora em diante
  // estoura limite (erro 429). Solução: 75s entre cada uma garante reset
  // do contador por minuto.
  const baseUrl = `https://${req.headers.host}`;
  const resultados = [];
  const DELAY_ENTRE_VENDEDORAS_MS = 20000; // 20s
  // Ailson 25/05/2026: reduzido 30s -> 20s. Em 24/05 Vanessa (6a vendedora)
  // nao foi processada — cron timeoutou aos 10min. Conta: 5x70s IA + 5x30s
  // delay = 510s, sobrou 90s pro retry da Vanessa. Mas retry 1 = 63s +
  // delay 5s + retry 2 = mais 63s = 131s. Estourou.
  // Agora: 5x70s + 5x20s = 460s + Vanessa 70s + retry max 70s = ~600s.
  // Combinado com maxDuration aumentado pra 800s, sobra 200s de folga.
  // Ailson 07/05/2026: reduzido de 75s pra 30s. Margem de 600s do Vercel
  // estava apertada (~8min com prompt maior dos GAPs 1-4 da auditoria).
  // Anthropic Sonnet 4.6 permite ~50 chamadas/min — 30s entre 5 vendedoras
  // = 10 chamadas em ~3min, bem dentro do limite.
  // Calculo: 5 vendedoras × (30s delay + ~50s IA) = ~7min, sobra ~3min
  // de folga vs 8min anterior que so deixava 2min.

  // FIX 07/05/2026 (Ailson): atualizar progresso INCREMENTAL no health.
  // Antes: finalizar() so era chamado no fim. Cron com 5 vendedoras + 75s
  // delay leva 6-9min, perto do timeout 10min do Vercel. Quando timeoutava,
  // processo morria sem chamar finalizar() — todos os registros ficavam
  // 'iniciada' pra sempre. Sem visibilidade do que rodou.
  // Agora: cada vendedora processada atualiza o status com sucessos parciais,
  // entao se timeoutar conseguimos ver ate onde foi.
  const atualizarProgresso = async () => {
    if (!healthId) return;
    const sucessosAteAgora = resultados.filter(r => r.ok).length;
    const errosAteAgora = resultados.filter(r => !r.ok).length;
    try {
      await supabase
        .from('lojas_cron_health')
        .update({
          duracao_ms: Date.now() - inicio,
          total_alvos: vendedoras.length,
          sucessos: sucessosAteAgora,
          erros: errosAteAgora,
          detalhes: {
            processadas: resultados.length,
            ultimo_resultado: resultados[resultados.length - 1] || null,
          },
        })
        .eq('id', healthId);
    } catch (e) {
      console.warn('[cron-health] progresso falhou:', e?.message);
    }
  };

  // RETRY POR VENDEDORA (Ailson 20/05/2026):
  // Tenta ate 2x se vier erro OU se gerar menos que 7 sugestoes. Espera
  // 5s entre tentativas. Resolve falha intermitente (bug temporario do
  // prompt em 20/05 quebrou cron entre 6h e 12h - Joelma ficou com 1,
  // Cleide com 2, Fran/Tamires com 0 ate o hotfix).
  const SUGESTOES_MINIMAS_OK = 7;
  const RETRY_DELAY_MS = 5000;
  async function gerarComRetry(v) {
    let ultimo = null;
    for (let tentativa = 1; tentativa <= 2; tentativa++) {
      try {
        const r = await fetch(`${baseUrl}/api/lojas-ia`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-User': 'ailson',
            'X-Internal-Cron': '1',
          },
          body: JSON.stringify({ action: 'gerar_sugestoes', vendedora_id: v.id }),
        });
        const data = await r.json().catch(() => ({}));
        // FIX Ailson 21/05/2026: o backend retorna 'sugestoes_criadas' (linha
        // 463 do lojas-ia.js), NAO 'sugestoes'. Antes o cron lia campo
        // inexistente -> sempre 0 -> sempre achava que falhou -> sempre fazia
        // retry. Resultado: cada vendedora demorava 2x (chamava IA 2x), cron
        // timeoutava antes de chegar nas ultimas. CASO REAL hoje 21/05:
        // Tamires e Joelma ficaram fora porque cron timeoutou na Celia (4a).
        // Fallback no 'sugestoes' pra compatibilidade caso o backend mude.
        const qtdSug = data?.sugestoes_criadas ?? data?.sugestoes?.length ?? 0;
        ultimo = {
          vendedora: v.nome, loja: v.loja,
          ok: r.ok && qtdSug >= SUGESTOES_MINIMAS_OK,
          status: r.status,
          sugestoes: qtdSug,
          erro: data?.error || (qtdSug < SUGESTOES_MINIMAS_OK ? `apenas ${qtdSug} sugestoes` : null),
          tentativas: tentativa,
        };
        if (ultimo.ok) return ultimo; // sucesso, sai do retry
      } catch (e) {
        ultimo = { vendedora: v.nome, loja: v.loja, ok: false, erro: e.message, tentativas: tentativa };
      }
      // Espera antes de tentar de novo (se houver proxima tentativa)
      if (tentativa < 2) {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
    return ultimo;
  }

  for (let i = 0; i < vendedoras.length; i++) {
    const v = vendedoras[i];

    // Delay antes de cada vendedora (exceto a 1ª)
    if (i > 0) {
      await new Promise(resolve => setTimeout(resolve, DELAY_ENTRE_VENDEDORAS_MS));
    }

    const resultado = await gerarComRetry(v);
    resultados.push(resultado);

    // Atualiza health depois de cada vendedora — visibilidade incremental
    await atualizarProgresso();
  }

  // VERIFICACAO POS-LOOP: confere no BANCO quem ficou com <7 sugestoes
  // e tenta UMA terceira vez (Ailson 20/05/2026 — defesa adicional contra
  // falhas que o endpoint reportou ok mas o INSERT no banco falhou).
  try {
    const hoje = new Date().toISOString().slice(0, 10);
    const { data: contagemBanco } = await supabase
      .from('lojas_sugestoes_diarias')
      .select('vendedora_id')
      .eq('data_geracao', hoje);
    const contadorPorVend = {};
    for (const s of contagemBanco || []) {
      contadorPorVend[s.vendedora_id] = (contadorPorVend[s.vendedora_id] || 0) + 1;
    }
    const incompletas = vendedoras.filter(v =>
      (contadorPorVend[v.id] || 0) < SUGESTOES_MINIMAS_OK
    );

    if (incompletas.length > 0) {
      console.log(`[cron-diario] Verificacao pos-loop: ${incompletas.length} incompletas, tentando 3a vez:`,
        incompletas.map(v => `${v.nome}=${contadorPorVend[v.id] || 0}`).join(', '));

      for (const v of incompletas) {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
        const resultadoTerceira = await gerarComRetry(v);
        // Atualiza o resultado dela na lista (substituindo)
        const idx = resultados.findIndex(r => r.vendedora === v.nome);
        if (idx >= 0) {
          resultados[idx] = { ...resultadoTerceira, tentativas: (resultadoTerceira.tentativas || 0) + 2, recuperacao_pos_loop: true };
        }
        await atualizarProgresso();
      }
    }
  } catch (e) {
    console.warn('[cron-diario] verificacao pos-loop falhou (nao critico):', e?.message);
  }

  const sucessos = resultados.filter(r => r.ok).length;
  const erros = resultados.filter(r => !r.ok).length;
  await finalizar(erros > 0 ? (sucessos > 0 ? 'sucesso' : 'erro') : 'sucesso', {
    total_alvos: vendedoras.length,
    sucessos,
    erros,
    detalhes: { resultados: resultados.slice(0, 10) }, // primeiros 10 pra não inflar
    erro_msg: erros > 0 ? `${erros}/${vendedoras.length} falharam` : null,
  });

  // ─── TEMA DA QUINTA via piggyback (Ailson 15/07/2026) ──────────────────
  // O cron dedicado lojas-tema-quinta-cron parou de ser disparado pelo Vercel
  // (excesso de crons no projeto — 73). Como ESTE cron diário roda fielmente
  // todo dia 7h, ele passa a acionar o tema quando for QUINTA (BRT). O tema tem
  // idempotência própria (não duplica se já existir da semana), então é seguro.
  let temaQuinta = null;
  try {
    const brtDia = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' })).getDay();
    if (brtDia === 4) { // 4 = quinta
      const rt = await fetch(`${baseUrl}/api/lojas-tema-quinta-cron`, {
        method: 'GET',
        headers: { 'X-User': 'ailson', 'X-Internal-Cron': '1' },
      });
      temaQuinta = await rt.json().catch(() => ({ ok: false, erro: 'parse' }));
    }
  } catch (e) {
    temaQuinta = { ok: false, erro: String(e?.message || e) };
    console.error('[cron-diario] tema-quinta piggyback falhou:', e?.message);
  }

  return res.status(200).json({
    ok: true,
    duracao_ms: Date.now() - inicio,
    total: vendedoras.length,
    sucessos,
    erros,
    resultados,
    tema_quinta: temaQuinta,
  });
}
