// ═══════════════════════════════════════════════════════════════════════════
// /api/lojas-receitas-cron-diario
// ═══════════════════════════════════════════════════════════════════════════
// Cron diário 04:00 BRT (07:00 UTC) que automatiza o lançamento das receitas
// das lojas físicas (Silva Teles + Bom Retiro) no módulo Lançamentos →
// Receitas do app financeiro.
//
// Sprint Ailson 06/05/2026.
//
// LÓGICA:
// - Janela: últimos 7 dias retroativos
// - Ignora domingos (loja fechada)
// - Pra cada (data, loja):
//     1. Soma valor_liquido em lojas_vendas (todos canais: fisico/vesti/convertr)
//     2. Mapeia loja → coluna no payload (Bom Retiro=bomRetiro, Silva Teles=silvaTeles)
//     3. Se receitasPorMes[mes][dia][campo] === 0 ou undefined → grava
//     4. Se já tem valor > 0 → PULA (preserva manual ou cron anterior)
// - NUNCA mexe em receitasPorMes[mes][dia].marketplaces
// - Persiste de volta em amicia_data user_id='amicia-admin' campo 'amica_financeiro'
//
// AUTH:
//   - Cron Vercel (header user-agent contém 'vercel-cron')
//   - Manual: ?user=ailson|amicia-admin
// ═══════════════════════════════════════════════════════════════════════════
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY  // service role
);

export const config = { maxDuration: 60 };

const ADMINS_AUTORIZADOS = ['ailson', 'amicia-admin', 'admin', 'tamara'];

// Mapeamento loja → campo no payload
const MAPA_LOJA_CAMPO = {
  'Bom Retiro': 'bomRetiro',
  'Silva Teles': 'silvaTeles',
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Auth
  const userAgent = req.headers['user-agent'] || '';
  const userQuery = req.query.user || '';
  const ehCron = userAgent.startsWith('vercel-cron');
  const ehAdmin = ADMINS_AUTORIZADOS.includes(userQuery);
  if (!ehCron && !ehAdmin) {
    return res.status(403).json({ error: 'Auth: cron ou admin' });
  }

  const startedAt = Date.now();
  console.log('[receitas-cron] iniciando, origem:', ehCron ? 'cron' : `manual:${userQuery}`);

  try {
    // 1. Calcula janela 7 dias retroativos (date-only, BRT)
    const hoje = new Date();
    const dataInicio = new Date(hoje);
    dataInicio.setDate(hoje.getDate() - 7);
    const dataInicioISO = dataInicio.toISOString().slice(0, 10);
    const dataFimISO = hoje.toISOString().slice(0, 10);

    // 2. Busca vendas agregadas por (loja, data_venda)
    // SELECT loja, data_venda, SUM(valor_liquido) FROM lojas_vendas WHERE ...
    const { data: vendas, error: errV } = await supabase
      .from('lojas_vendas')
      .select('loja, data_venda, valor_liquido')
      .gte('data_venda', dataInicioISO)
      .lte('data_venda', dataFimISO);

    if (errV) {
      console.error('[receitas-cron] erro buscando vendas:', errV);
      return res.status(500).json({ error: errV.message });
    }

    // Agrupa por (loja, data) e soma valor_liquido
    const agregado = {};  // { 'Bom Retiro|2026-05-06': 1234.56, ... }
    for (const v of (vendas || [])) {
      // Pula domingo (getDay()===0)
      const dia = new Date(v.data_venda + 'T12:00:00').getDay();
      if (dia === 0) continue;

      const key = `${v.loja}|${v.data_venda}`;
      agregado[key] = (agregado[key] || 0) + Number(v.valor_liquido || 0);
    }

    // 3. Carrega payload financeiro atual
    const { data: dadoFin, error: errD } = await supabase
      .from('amicia_data')
      .select('payload')
      .eq('user_id', 'amicia-admin')
      .maybeSingle();

    if (errD) {
      console.error('[receitas-cron] erro lendo payload:', errD);
      return res.status(500).json({ error: errD.message });
    }
    if (!dadoFin?.payload) {
      console.warn('[receitas-cron] payload amicia-admin não encontrado, abortando');
      return res.status(404).json({ error: 'Payload financeiro não existe' });
    }

    const payload = dadoFin.payload;
    payload.receitasPorMes = payload.receitasPorMes || {};

    // 4. Pra cada agregado, decide se grava ou pula
    const stats = { gravados: 0, pulados_existente: 0, pulados_loja_invalida: 0, dias_processados: 0 };
    const detalhe = [];

    for (const [key, valorLiq] of Object.entries(agregado)) {
      const [loja, dataVenda] = key.split('|');
      const campo = MAPA_LOJA_CAMPO[loja];

      if (!campo) {
        stats.pulados_loja_invalida++;
        continue;
      }

      // Extrai mês e dia da data
      const [, mesStr, diaStr] = dataVenda.split('-');
      const mes = parseInt(mesStr, 10);
      const dia = parseInt(diaStr, 10);

      // Garante estrutura
      if (!payload.receitasPorMes[mes]) payload.receitasPorMes[mes] = {};
      if (!payload.receitasPorMes[mes][dia]) {
        payload.receitasPorMes[mes][dia] = { silvaTeles: 0, bomRetiro: 0, marketplaces: 0 };
      }

      const valorAtual = Number(payload.receitasPorMes[mes][dia][campo] || 0);

      if (valorAtual > 0) {
        // Já tem valor manual ou cron anterior — preserva
        stats.pulados_existente++;
        detalhe.push({ data: dataVenda, loja, campo, acao: 'pulado', valor_atual: valorAtual, valor_calculado: Math.round(valorLiq * 100) / 100 });
        continue;
      }

      // Grava (mesmo se for 0 — caso loja não tenha vendido nada naquele dia, fica 0)
      const valorRedondo = Math.round(valorLiq * 100) / 100;
      payload.receitasPorMes[mes][dia][campo] = valorRedondo;
      stats.gravados++;
      detalhe.push({ data: dataVenda, loja, campo, acao: 'gravado', valor: valorRedondo });
    }

    stats.dias_processados = Object.keys(agregado).length;

    // 5. Persiste payload de volta
    if (stats.gravados > 0) {
      const { error: errU } = await supabase
        .from('amicia_data')
        .update({ payload, updated_at: new Date().toISOString() })
        .eq('user_id', 'amicia-admin');

      if (errU) {
        console.error('[receitas-cron] erro gravando payload:', errU);
        return res.status(500).json({ error: errU.message });
      }
    }

    const duracaoMs = Date.now() - startedAt;
    console.log('[receitas-cron] sucesso', stats, 'duracao=' + duracaoMs + 'ms');

    return res.json({
      ok: true,
      duracao_ms: duracaoMs,
      janela: { inicio: dataInicioISO, fim: dataFimISO },
      stats,
      detalhe,
    });
  } catch (e) {
    console.error('[receitas-cron] exception:', e?.message);
    return res.status(500).json({ error: e?.message || 'Erro' });
  }
}
