/**
 * lojas-ia-debug.js — Diagnóstico do estado da IA Lojas.
 *
 * GET /api/lojas-ia-debug?X-User=ailson (ou qualquer admin via header)
 *
 * Retorna:
 *  - Vars de ambiente presentes (Anthropic, Supabase)
 *  - Vendedoras ativas + qtd clientes na carteira
 *  - Última sugestão gerada (se houver)
 *  - Última chamada IA logada
 *  - Status de orçamento mensal
 *  - Última importação Drive
 */

import {
  supabase, setCors, validarUsuario, gastoMesAtualBRL, temOrcamento, getLojasConfig,
} from './_lojas-helpers.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const auth = await validarUsuario(req);
    if (!auth.ok) return res.status(auth.status || 401).json({ error: auth.error });
    if (!auth.isAdmin) return res.status(403).json({ error: 'Apenas admin' });

    // 1. Vars de ambiente
    const env_check = {
      ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY,
      ANTHROPIC_API_KEY_inicio: process.env.ANTHROPIC_API_KEY?.substring(0, 8) || null,
      SUPABASE_URL: !!process.env.SUPABASE_URL,
      SUPABASE_KEY: !!process.env.SUPABASE_KEY,
    };

    // 2. Vendedoras
    const { data: vendedoras } = await supabase
      .from('lojas_vendedoras')
      .select('id, nome, loja, ativa, is_placeholder')
      .eq('ativa', true)
      .order('loja, nome');

    // 3. Pra cada vendedora, conta clientes
    const vendedorasComCarteira = [];
    for (const v of (vendedoras || [])) {
      const { count } = await supabase
        .from('lojas_clientes')
        .select('*', { count: 'exact', head: true })
        .eq('vendedora_id', v.id);
      vendedorasComCarteira.push({
        nome: v.nome, loja: v.loja,
        is_placeholder: v.is_placeholder,
        qtd_clientes: count || 0,
      });
    }

    // 4. Última sugestão
    const { data: ultimaSugest } = await supabase
      .from('lojas_sugestoes_diarias')
      .select('id, vendedora_id, data_referencia, tipo, created_at')
      .order('created_at', { ascending: false })
      .limit(5);

    // 5. Última chamada IA
    const { data: ultimaIA } = await supabase
      .from('lojas_ia_chamadas_log')
      .select('id, contexto, modelo, custo_brl, status, erro, created_at')
      .order('created_at', { ascending: false })
      .limit(5);

    // 6. Orçamento
    const orcamento_status = await temOrcamento();
    const gasto = await gastoMesAtualBRL();
    const modelo_ia = await getLojasConfig('modelo_ia', 'NÃO_DEFINIDO');

    // 7. Total clientes no banco
    const { count: total_clientes } = await supabase
      .from('lojas_clientes')
      .select('*', { count: 'exact', head: true });
    const { count: clientes_com_vendedora } = await supabase
      .from('lojas_clientes')
      .select('*', { count: 'exact', head: true })
      .not('vendedora_id', 'is', null);

    return res.status(200).json({
      env_check,
      modelo_ia_config: modelo_ia,
      orcamento: { ok: orcamento_status.ok, gasto, limite: orcamento_status.limite },
      vendedoras_total: vendedoras?.length || 0,
      vendedoras_com_carteira: vendedorasComCarteira,
      total_clientes,
      clientes_com_vendedora,
      ultimas_5_sugestoes: ultimaSugest,
      ultimas_5_chamadas_ia: ultimaIA,
    });
  } catch (e) {
    console.error('[lojas-ia-debug] erro:', e);
    return res.status(500).json({ error: e.message, stack: e.stack });
  }
}
