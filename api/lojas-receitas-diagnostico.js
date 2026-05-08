// ═══════════════════════════════════════════════════════════════════════════
// /api/lojas-receitas-diagnostico
// ═══════════════════════════════════════════════════════════════════════════
// Diagnostico de divergencia entre app (modulo Lancamentos) e Mire pra um
// dia/loja especifico. Sessao Ailson 08/05/2026 — caso real 04/05/2026
// Bom Retiro mostrou R$ 2.210 no app vs R$ 9.329,90 no relatorio Mire.
//
// Uso:
//   GET /api/lojas-receitas-diagnostico?user=ailson&data=2026-05-04&loja=Bom%20Retiro
//
// Mostra:
//   1. Valor atual em payload.receitasPorMes[mes][dia][campo]
//   2. Lista de vendas em lojas_vendas (atacado fisico+vesti) pro dia/loja
//      com numero_pedido, valor_liquido, criado_em
//   3. Lista de vendas em lojas_vendas_varejo pro dia/loja
//   4. Total agregado (que o cron usaria)
//   5. Ultimas 5 importacoes que tocam tabelas de venda dessa loja:
//      vendas_clientes_*, vendas_historico_*, vendas_semanal_*, relatorio_bi_*
//      Com data_iniciada, status, contadores, detalhes_ignorados, drive_modified_at
//
// Auth: admin via ?user=ailson|amicia-admin|tamara
// ═══════════════════════════════════════════════════════════════════════════
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const ADMINS = ['ailson', 'amicia-admin', 'admin', 'tamara'];

const MAPA_LOJA_CAMPO = {
  'Bom Retiro': 'bomRetiro',
  'Silva Teles': 'silvaTeles',
};

const MAPA_LOJA_SUFIXO = {
  'Bom Retiro': '_br',
  'Silva Teles': '_st',
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = req.query.user || '';
  if (!ADMINS.includes(user)) {
    return res.status(403).json({ error: 'Auth: ?user=ailson|amicia-admin|tamara' });
  }

  const data = req.query.data;     // 'YYYY-MM-DD'
  const loja = req.query.loja;     // 'Bom Retiro' | 'Silva Teles'

  if (!data || !/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    return res.status(400).json({ error: 'data obrigatoria, formato YYYY-MM-DD' });
  }
  if (!MAPA_LOJA_CAMPO[loja]) {
    return res.status(400).json({ error: "loja deve ser 'Bom Retiro' ou 'Silva Teles'" });
  }

  const campo = MAPA_LOJA_CAMPO[loja];
  const sufixo = MAPA_LOJA_SUFIXO[loja];
  const [, mesStr, diaStr] = data.split('-');
  const mes = parseInt(mesStr, 10);
  const dia = parseInt(diaStr, 10);

  try {
    // 1. Valor atual no payload financeiro
    const { data: dadoFin } = await supabase
      .from('amicia_data')
      .select('payload, updated_at')
      .eq('user_id', 'amicia-admin')
      .maybeSingle();
    const valorNoApp = dadoFin?.payload?.receitasPorMes?.[mes]?.[dia]?.[campo] ?? null;

    // 2. Vendas atacado em lojas_vendas
    const { data: vendasAtacado, error: errA } = await supabase
      .from('lojas_vendas')
      .select('numero_pedido, valor_liquido, valor_bruto, canal_origem, vendedora_nome_raw, cliente_razao_raw, created_at, hora_venda')
      .eq('loja', loja)
      .eq('data_venda', data)
      .order('numero_pedido');
    if (errA) throw new Error('atacado: ' + errA.message);

    const totalAtacado = (vendasAtacado || []).reduce((s, v) => s + Number(v.valor_liquido || 0), 0);

    // 3. Vendas varejo em lojas_vendas_varejo
    const { data: vendasVarejo, error: errV } = await supabase
      .from('lojas_vendas_varejo')
      .select('numero_pedido, valor_liquido, valor_bruto, vendedora_nome_raw, forma_pagamento, hora_venda, created_at')
      .eq('loja', loja)
      .eq('data_venda', data)
      .order('numero_pedido');
    if (errV) throw new Error('varejo: ' + errV.message);

    const totalVarejo = (vendasVarejo || []).reduce((s, v) => s + Number(v.valor_liquido || 0), 0);

    // 4. Ultimas importacoes que tocam essa loja
    const tipos = [
      `vendas_clientes${sufixo}`,
      `vendas_historico${sufixo}`,
      `vendas_semanal${sufixo}`,
      `relatorio_bi${sufixo}`,
    ];
    const { data: imports, error: errI } = await supabase
      .from('lojas_importacoes')
      .select('id, tipo, arquivo_nome, status, qtd_inseridos, qtd_atualizados, qtd_ignorados, detalhes_ignorados, drive_modified_at, iniciada_em, finalizada_em, duracao_ms, mensagem_erro')
      .in('tipo', tipos)
      .order('iniciada_em', { ascending: false })
      .limit(15);
    if (errI) throw new Error('imports: ' + errI.message);

    // Agrupa por tipo, mostra o mais recente de cada
    const ultimoPorTipo = {};
    for (const imp of (imports || [])) {
      if (!ultimoPorTipo[imp.tipo]) ultimoPorTipo[imp.tipo] = imp;
    }

    // 5. Diagnostico textual
    const totalCalculado = Math.round((totalAtacado + totalVarejo) * 100) / 100;
    const diagnostico = [];
    if (valorNoApp === null) {
      diagnostico.push('Sem entrada em receitasPorMes pra essa data — cron nunca rodou ou estrutura nao foi inicializada.');
    } else if (valorNoApp === totalCalculado) {
      diagnostico.push(`Valor no app (${valorNoApp}) bate exatamente com o calculado (${totalCalculado}). Esta tudo certo.`);
    } else if (valorNoApp < totalCalculado) {
      diagnostico.push(`Valor no app (${valorNoApp}) MENOR que calculado (${totalCalculado}). Diferenca: R$ ${(totalCalculado - valorNoApp).toFixed(2)}.`);
      diagnostico.push('Causa provavel: cron rodou quando o banco tinha menos vendas. Rodar /api/lojas-receitas-cron-diario?user=ailson pra auto-corrigir.');
    } else {
      diagnostico.push(`Valor no app (${valorNoApp}) MAIOR que calculado (${totalCalculado}). Diferenca: R$ ${(valorNoApp - totalCalculado).toFixed(2)}.`);
      diagnostico.push('Causa possivel: lancamento manual no app, ou vendas removidas do banco depois.');
    }

    if ((vendasAtacado?.length || 0) + (vendasVarejo?.length || 0) === 0) {
      diagnostico.push('NENHUMA venda no banco pra esse dia/loja. Verificar se algum arquivo de vendas (historico/semanal) foi importado pra esse dia.');
    } else if ((vendasVarejo?.length || 0) === 0 && (vendasAtacado?.length || 0) > 0) {
      diagnostico.push('Atacado presente, mas ZERO varejo. Provavel: importacao foi feita antes da Sprint A (04/05/2026) quando varejo era descartado, OU arquivo importado eh do tipo vendas_clientes (agregado) que nao popula varejo.');
    }

    return res.json({
      ok: true,
      consulta: { data, loja, mes, dia, campo },
      app: {
        valor_no_app: valorNoApp,
        payload_atualizado_em: dadoFin?.updated_at || null,
      },
      banco: {
        atacado: {
          qtd_pedidos: vendasAtacado?.length || 0,
          total_liquido: Math.round(totalAtacado * 100) / 100,
          pedidos: vendasAtacado || [],
        },
        varejo: {
          qtd_pedidos: vendasVarejo?.length || 0,
          total_liquido: Math.round(totalVarejo * 100) / 100,
          pedidos: vendasVarejo || [],
        },
        total_calculado: totalCalculado,
      },
      ultimas_importacoes: ultimoPorTipo,
      diagnostico,
    });
  } catch (e) {
    console.error('[receitas-diagnostico] erro:', e?.message);
    return res.status(500).json({ error: e?.message || 'Erro' });
  }
}
