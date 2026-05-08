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
//     1. Soma valor_liquido em vw_lojas_vendas_completo (atacado fisico+vesti
//        em lojas_vendas + balcao em lojas_vendas_varejo)
//     2. Mapeia loja → coluna no payload (Bom Retiro=bomRetiro, Silva Teles=silvaTeles)
//     3. Decide gravacao por idade da data:
//        • diasAtras ≤ 7  → SEMPRE atualiza pro valor calculado (auto-correcao
//          de importacoes parciais — caso 04/05/2026 onde so 1 pedido tinha
//          chegado quando o cron rodou e os 24 demais nunca foram refletidos).
//        • diasAtras > 7  → pula se ja tem valor > 0 (trava, preserva manual
//          ou cron anterior). Regra historica.
//        Esta janela passou de 'pula sempre se >0' (08/05/2026, Ailson).
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
    // FIX 06/05/2026: usar vw_lojas_vendas_completo em vez de lojas_vendas.
    // Razao: lojas_vendas tem so atacado (clientes com CNPJ valido). Vendas
    // balcao 'CONSUMIDOR' sem CPF vao pra lojas_vendas_varejo. A view une
    // os 2 pra dar o total real do dia (que bate com o relatorio Mire).
    // Soma 'fisico' + 'vesti' (atacado) + tudo de lojas_vendas_varejo.
    // Vendedora teste/nova: entra normalmente porque a view nao filtra
    // por vendedora, so por loja+data.
    // FIX 08/05/2026: tambem trazer numero_pedido pra logar qtd_pedidos
    // no detalhe — auditoria caso valor venha estranho (ex: dia com so 1
    // pedido provavelmente eh import parcial).
    const { data: vendas, error: errV } = await supabase
      .from('vw_lojas_vendas_completo')
      .select('loja, data_venda, valor_liquido, numero_pedido')
      .gte('data_venda', dataInicioISO)
      .lte('data_venda', dataFimISO);

    if (errV) {
      console.error('[receitas-cron] erro buscando vendas:', errV);
      return res.status(500).json({ error: errV.message });
    }

    // Agrupa por (loja, data) e soma valor_liquido + conta pedidos
    const agregado = {};  // { 'Bom Retiro|2026-05-06': { valor, qtd_pedidos } }
    for (const v of (vendas || [])) {
      // Pula domingo (getDay()===0)
      const dia = new Date(v.data_venda + 'T12:00:00').getDay();
      if (dia === 0) continue;

      const key = `${v.loja}|${v.data_venda}`;
      if (!agregado[key]) agregado[key] = { valor: 0, qtd_pedidos: 0 };
      agregado[key].valor += Number(v.valor_liquido || 0);
      agregado[key].qtd_pedidos += 1;
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

    // 4. Pra cada agregado, decide se grava ou pula.
    //
    // Nova regra (Ailson 08/05/2026): a regra antiga era "se valorAtual > 0,
    // pula sempre". Isso quebrou no dia 04/05/2026: cron rodou cedo, lojas_vendas
    // so tinha 1 pedido (R$ 2.210), gravou. Importacoes posteriores trouxeram
    // os outros 24 pedidos do dia (R$ 9.329 total), mas o cron nunca atualizou
    // porque ja tinha valor > 0.
    //
    // Nova logica:
    //   • dataDoRegistro <= 7 dias atras  → SEMPRE atualiza pro calculado
    //     (auto-correcao de imports parciais). Em casos raros pode sobrescrever
    //     correcao manual, mas o cenario muito mais comum eh import incompleto.
    //   • dataDoRegistro > 7 dias atras   → preserva valor existente (trava).
    //     Apos 7 dias, dado considerado definitivo.
    const hoje0 = new Date(hoje.toISOString().slice(0, 10) + 'T12:00:00');
    const stats = { gravados: 0, atualizados: 0, pulados_existente: 0, pulados_loja_invalida: 0, dias_processados: 0 };
    const detalhe = [];

    for (const [key, info] of Object.entries(agregado)) {
      const [loja, dataVenda] = key.split('|');
      const valorLiq = info.valor;
      const qtdPedidos = info.qtd_pedidos;
      const campo = MAPA_LOJA_CAMPO[loja];

      if (!campo) {
        stats.pulados_loja_invalida++;
        continue;
      }

      // Calcula idade da data
      const dataReg = new Date(dataVenda + 'T12:00:00');
      const diasAtras = Math.floor((hoje0 - dataReg) / (1000 * 60 * 60 * 24));
      const dentroJanelaAutoCorrige = diasAtras <= 7;

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
      const valorRedondo = Math.round(valorLiq * 100) / 100;

      if (!dentroJanelaAutoCorrige && valorAtual > 0) {
        // Fora da janela: respeita valor existente
        stats.pulados_existente++;
        detalhe.push({ data: dataVenda, loja, campo, acao: 'pulado_trava_7d', valor_atual: valorAtual, valor_calculado: valorRedondo, qtd_pedidos: qtdPedidos, dias_atras: diasAtras });
        continue;
      }

      if (valorAtual === valorRedondo) {
        // Sem mudanca, nao precisa gravar
        detalhe.push({ data: dataVenda, loja, campo, acao: 'sem_mudanca', valor: valorRedondo, qtd_pedidos: qtdPedidos, dias_atras: diasAtras });
        continue;
      }

      // Grava ou atualiza
      payload.receitasPorMes[mes][dia][campo] = valorRedondo;
      if (valorAtual > 0) {
        stats.atualizados++;
        detalhe.push({ data: dataVenda, loja, campo, acao: 'atualizado', valor_anterior: valorAtual, valor: valorRedondo, qtd_pedidos: qtdPedidos, dias_atras: diasAtras });
      } else {
        stats.gravados++;
        detalhe.push({ data: dataVenda, loja, campo, acao: 'gravado', valor: valorRedondo, qtd_pedidos: qtdPedidos, dias_atras: diasAtras });
      }
    }

    stats.dias_processados = Object.keys(agregado).length;

    // 5. Persiste payload de volta (se houve mudancas)
    if (stats.gravados > 0 || stats.atualizados > 0) {
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
