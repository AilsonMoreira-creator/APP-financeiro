/**
 * lojas-trilha-winback-cron.js — Cron Trilha Win-back 3 semanas
 *
 * Schedule: 0 9 * * 1-5 (06:00 BRT, segunda a sexta — ANTES do cron de IA das 07h)
 *
 * Roda DIARIAMENTE:
 *   1. Detecta conversões — trilhas onde cliente comprou desde data_inicio
 *      vira encerrada (motivo='convertida')
 *
 * SEGUNDA (uma vez por semana):
 *   2. Cria 2 trilhas novas por vendedora ativa
 *      - Critério candidato: lojas_trilha_winback_candidatos()
 *      - Top 2 por qtd_compras DESC + lifetime DESC
 *
 * Sessão Ailson 13/05/2026 — Sprint A da Trilha Win-back.
 */
import { supabase, setCors } from './_lojas-helpers.js';

export const config = { maxDuration: 120 };

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ═══ Auth ═══
  const userAgent = req.headers['user-agent'] || '';
  const ehCron = userAgent.startsWith('vercel-cron') || !!req.headers['x-vercel-cron'];
  const userId = req.query?.user || req.headers['x-user'];
  const ehAdmin = userId === 'ailson';
  const forceMonday = req.query?.force_monday === '1'; // teste manual

  if (!ehCron && !ehAdmin) {
    return res.status(403).json({
      error: 'Apenas cron Vercel ou admin',
      uso_manual: '/api/lojas-trilha-winback-cron?user=ailson',
      teste_segunda: '/api/lojas-trilha-winback-cron?user=ailson&force_monday=1',
    });
  }

  const tInicio = Date.now();
  
  // ═══ Log de invocação ═══
  let healthId = null;
  try {
    const { data: hl } = await supabase
      .from('lojas_cron_health')
      .insert({
        cron_name: 'lojas-trilha-winback-cron',
        origem: ehCron ? 'vercel-cron' : (ehAdmin ? 'manual-admin' : 'unknown'),
        user_agent: userAgent,
        triggered_by: userId || 'vercel',
        status: 'iniciada',
      })
      .select('id')
      .single();
    healthId = hl?.id || null;
  } catch (e) {
    console.warn('[trilha-winback-cron] health insert falhou:', e?.message);
  }

  const finalizar = async (status, detalhes = {}) => {
    if (!healthId) return;
    try {
      await supabase
        .from('lojas_cron_health')
        .update({
          finished_at: new Date().toISOString(),
          duracao_ms: Date.now() - tInicio,
          status,
          ...detalhes,
        })
        .eq('id', healthId);
    } catch {}
  };

  try {
    // ═══ 1. Detecta conversões — diário ═══
    // Encerra trilhas onde cliente comprou desde data_inicio.
    const { data: convData, error: convErr } = await supabase
      .rpc('lojas_trilha_winback_detectar_conversoes');
    if (convErr) {
      await finalizar('erro', { erro_msg: 'detectar_conversoes: ' + convErr.message });
      return res.status(500).json({ error: convErr.message });
    }
    const conversoesDetectadas = convData || 0;

    // ═══ 2. Criar trilhas novas — só segunda-feira ═══
    // BRT = UTC-3. Cron roda 09 UTC = 06 BRT. Dayof getDay() retorna 0-6.
    // Mas em UTC, segunda-feira BRT pode ser 09 UTC do mesmo dia
    // (todo Brasil tá ainda em segunda no UTC 09h). Então getUTCDay() ===  1 é seguro.
    const agora = new Date();
    const diaSemanaUTC = agora.getUTCDay(); // 0=dom, 1=seg, ..., 6=sab
    const ehSegunda = diaSemanaUTC === 1 || forceMonday;

    let trilhasNovas = 0;
    const detalhePorVendedora = [];

    if (ehSegunda) {
      const { data: vendedoras, error: vErr } = await supabase
        .from('lojas_vendedoras')
        .select('id, nome')
        .eq('ativa', true)
        .eq('is_placeholder', false);

      if (vErr) {
        await finalizar('erro', { erro_msg: 'load_vendedoras: ' + vErr.message });
        return res.status(500).json({ error: vErr.message });
      }

      for (const v of vendedoras || []) {
        // Top 2 candidatos pra essa vendedora
        const { data: candidatos, error: cErr } = await supabase
          .rpc('lojas_trilha_winback_candidatos', { 
            p_vendedora_id: v.id, 
            p_limit: 2 
          });
        
        if (cErr) {
          console.warn('[trilha-winback]', v.nome, 'candidatos erro:', cErr.message);
          detalhePorVendedora.push({ vendedora: v.nome, erro: cErr.message });
          continue;
        }

        const criadosVendedora = [];
        for (const c of candidatos || []) {
          try {
            const { data: trilhaId, error: tErr } = await supabase
              .rpc('lojas_trilha_winback_criar', { p_cliente_id: c.cliente_id });
            if (tErr) {
              console.warn('[trilha-winback]', v.nome, c.cliente_nome, tErr.message);
              continue;
            }
            trilhasNovas++;
            criadosVendedora.push({
              cliente_nome: c.cliente_nome,
              status: c.status,
              qtd_compras: c.qtd_compras,
              lifetime: c.lifetime_total,
              trilha_id: trilhaId,
            });
          } catch (e) {
            console.warn('[trilha-winback]', v.nome, e.message);
          }
        }
        
        detalhePorVendedora.push({ 
          vendedora: v.nome, 
          criadas: criadosVendedora.length,
          clientes: criadosVendedora,
        });
      }
    }

    await finalizar('sucesso', {
      detalhes: {
        eh_segunda: ehSegunda,
        conversoes_detectadas: conversoesDetectadas,
        trilhas_novas_criadas: trilhasNovas,
        vendedoras_processadas: detalhePorVendedora.length,
      },
    });

    return res.json({
      ok: true,
      duracao_ms: Date.now() - tInicio,
      eh_segunda: ehSegunda,
      data_iso: agora.toISOString(),
      conversoes_detectadas: conversoesDetectadas,
      trilhas_novas_criadas: trilhasNovas,
      detalhe_por_vendedora: detalhePorVendedora,
    });
  } catch (e) {
    console.error('[trilha-winback-cron]', e);
    await finalizar('erro', { erro_msg: e.message });
    return res.status(500).json({ error: e.message });
  }
}
