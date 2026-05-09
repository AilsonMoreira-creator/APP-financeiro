// ═══════════════════════════════════════════════════════════════════════════
// /api/folha-debug
// ═══════════════════════════════════════════════════════════════════════════
//
// Retorna JSON com tudo que o módulo Folha de Pagamento vai puxar pra cada
// funcionário ATIVO numa competência. Útil pra validar antes de marcar pago.
//
// GET /api/folha-debug?user=ailson[&competencia=2026-04]
//
// Sessão Ailson 09/05/2026.
// ═══════════════════════════════════════════════════════════════════════════
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const ADMINS = ['ailson', 'amicia-admin', 'admin', 'tamara'];

function norm(s) {
  return String(s || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function competenciaCorrente() {
  const brt = new Date(Date.now() - 3 * 3600 * 1000);
  return `${brt.getUTCFullYear()}-${String(brt.getUTCMonth() + 1).padStart(2, '0')}`;
}

function competenciaSeguinte(comp) {
  const [a, m] = comp.split('-').map(Number);
  const d = new Date(a, m, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = req.query.user || '';
  if (!ADMINS.includes(user)) {
    return res.status(403).json({ error: 'Auth: ?user=ailson' });
  }

  const competencia = req.query.competencia || competenciaCorrente();
  if (!/^\d{4}-\d{2}$/.test(competencia)) {
    return res.status(400).json({ error: 'competencia formato YYYY-MM' });
  }
  const [ano, mes] = competencia.split('-').map(Number);
  const inicio = `${competencia}-01`;
  const ultimoDia = new Date(ano, mes, 0).getDate();
  const fim = `${competencia}-${String(ultimoDia).padStart(2, '0')}`;
  const compSeg = competenciaSeguinte(competencia);
  const [, mesSeg] = compSeg.split('-').map(Number);

  try {
    // 1. Folha
    const { data: folha } = await supabase
      .from('amicia_data').select('payload')
      .eq('user_id', 'folha-pagamento').maybeSingle();
    const fp = folha?.payload || {};
    const funcionarios = (fp.funcionarios || []).filter(f => f.ativo);
    const regras = fp.regras || {};
    const valesAplicados = fp.vales_aplicados || {};

    // 2. Vendedoras
    const { data: vendedoras } = await supabase
      .from('lojas_vendedoras').select('id, nome, loja, aliases').eq('ativa', true);

    // 3. Vendas no período (separadas por categoria + loja)
    const { data: vendas } = await supabase
      .from('vw_lojas_vendas_completo')
      .select('vendedora_id, categoria, valor_liquido, loja')
      .gte('data_venda', inicio).lte('data_venda', fim);
    const porVend = new Map();
    let lojaBR_atacado = 0, lojaBR_varejo = 0, lojaST_atacado = 0, lojaST_varejo = 0;
    for (const v of (vendas || [])) {
      const val = Number(v.valor_liquido || 0);
      if (v.vendedora_id) {
        if (!porVend.has(v.vendedora_id)) porVend.set(v.vendedora_id, { atacado: 0, varejo: 0, total: 0 });
        const acc = porVend.get(v.vendedora_id);
        if (v.categoria === 'atacado') acc.atacado += val;
        else if (v.categoria === 'varejo') acc.varejo += val;
        acc.total += val;
      }
      if (v.loja === 'Bom Retiro') {
        if (v.categoria === 'atacado') lojaBR_atacado += val;
        else if (v.categoria === 'varejo') lojaBR_varejo += val;
      } else if (v.loja === 'Silva Teles') {
        if (v.categoria === 'atacado') lojaST_atacado += val;
        else if (v.categoria === 'varejo') lojaST_varejo += val;
      }
    }
    const lojaBR = lojaBR_atacado + lojaBR_varejo;
    const lojaST = lojaST_atacado + lojaST_varejo;

    // 3b. Vendas por vendedora ativa (independente de cadastro em folha)
    const vendedorasDoMes = (vendedoras || []).map(v => {
      const vendas_dela = porVend.get(v.id) || { atacado: 0, varejo: 0, total: 0 };
      return {
        id: v.id,
        nome: v.nome,
        loja: v.loja,
        aliases: v.aliases,
        vendas: vendas_dela,
      };
    }).sort((a, b) => b.vendas.total - a.vendas.total);

    // 4. Carrega payload financeiro (usado pra mktplc liquido + planilha)
    const { data: fin } = await supabase
      .from('amicia_data').select('payload')
      .eq('user_id', 'amicia-admin').maybeSingle();

    // 5. Bling — abordagem hibrida:
    //    - mktplc_liquido espelha receitasPorMes (Lancamentos)
    //    - mktplc_bruto = liquido / 0.9 (regra reversa)
    //    - muniam isolado vem de bling_vendas_detalhe (unica fonte com isolamento)
    //    - fallback total pra bling_vendas_detalhe se receitasPorMes vazio

    let mktplcLiquidoLancamentos = 0;
    const diasReceitas = fin?.payload?.receitasPorMes?.[mes] || {};
    const diasComMktplc = [];
    for (const [diaKey, dia] of Object.entries(diasReceitas)) {
      const v = Number(dia?.marketplaces || 0);
      if (v > 0) {
        mktplcLiquidoLancamentos += v;
        diasComMktplc.push({ dia: Number(diaKey), valor: v });
      }
    }

    let blingBruto = 0, muniam = 0, totalPedidosNoMes = 0;
    const porConta = { exitus: { qtd: 0, total: 0 }, lumia: { qtd: 0, total: 0 }, muniam: { qtd: 0, total: 0 }, outros: { qtd: 0, total: 0 } };
    let from = 0; const PAGE = 1000;
    while (true) {
      const { data: pedidos } = await supabase
        .from('bling_vendas_detalhe')
        .select('conta, total_produtos')
        .gte('data_pedido', inicio)
        .lte('data_pedido', fim)
        .range(from, from + PAGE - 1);
      if (!pedidos || pedidos.length === 0) break;
      for (const p of pedidos) {
        const v = Number(p.total_produtos || 0);
        blingBruto += v;
        totalPedidosNoMes++;
        const c = p.conta || 'outros';
        if (porConta[c]) { porConta[c].qtd++; porConta[c].total += v; }
        else { porConta.outros.qtd++; porConta.outros.total += v; }
        if (p.conta === 'muniam') muniam += v;
      }
      if (pedidos.length < PAGE) break;
      from += PAGE;
    }

    let mktplcBruto, mktplcLiquido, fonteEscolhida;
    if (mktplcLiquidoLancamentos > 0) {
      mktplcLiquido = mktplcLiquidoLancamentos;
      mktplcBruto = mktplcLiquido / 0.9;
      fonteEscolhida = 'receitasPorMes (espelho Lancamentos) — bruto via regra reversa /0.9';
    } else {
      mktplcBruto = blingBruto;
      mktplcLiquido = blingBruto * 0.9;
      fonteEscolhida = 'FALLBACK bling_vendas_detalhe (receitasPorMes vazio — Bling nao sincronizado no mes)';
    }
    const blingDiagnostico = {
      fonte_usada: fonteEscolhida,
      receitasPorMes_liquido: mktplcLiquidoLancamentos,
      receitasPorMes_dias_com_marketplaces: diasComMktplc,
      bling_vendas_detalhe_bruto: blingBruto,
      bling_vendas_detalhe_total_pedidos: totalPedidosNoMes,
      bling_vendas_detalhe_por_conta: porConta,
      muniam_de: 'bling_vendas_detalhe (sempre — receitasPorMes nao tem isolamento)',
    };

    // 6. Planilha competência + seguinte (do fin já carregado)
    const planilhaComp = fin?.payload?.auxDataPorMes?.[mes]?.['Funcionários'] || [];
    const planilhaSeg  = fin?.payload?.auxDataPorMes?.[mesSeg]?.['Funcionários'] || [];

    // 6. Por funcionário
    const detalhe = funcionarios.map(f => {
      const alvo = norm(f.nome_planilha || f.nome_display);

      // resolve vendedora
      let vendMatch = null;
      if (f.categoria?.startsWith('vendedora') && vendedoras) {
        const direto = vendedoras.find(v => norm(v.nome) === alvo);
        const alias = !direto && vendedoras.find(v => (v.aliases || []).map(norm).includes(alvo));
        if (direto) vendMatch = { id: direto.id, nome: direto.nome, via: 'nome' };
        else if (alias) vendMatch = { id: alias.id, nome: alias.nome, via: 'alias' };
      }
      const vid = f.vendedora_id || vendMatch?.id || null;
      const vendas_dela = (vid && porVend.get(vid)) || { atacado: 0, varejo: 0, total: 0 };

      // linha planilha
      const lComp = planilhaComp.find(r => norm(r.nome) === alvo);
      const lSeg  = planilhaSeg.find(r => norm(r.nome) === alvo);

      const valeRegra = (regras[f.id] || []).find(r => r.tipo === 'vale_pago' && r.ativo);
      const valeValor = Number(valeRegra?.config?.valor || 0);
      const valeJaAplicado = !!valesAplicados[`${f.id}|${competencia}`];

      const regrasResumo = (regras[f.id] || []).filter(r => r.ativo).sort((a, b) => a.ordem - b.ordem)
        .map(r => ({ tipo: r.tipo, config: r.config }));

      return {
        id: f.id,
        nome_display: f.nome_display,
        nome_planilha: f.nome_planilha,
        categoria: f.categoria,
        match_vendedora: vendMatch || (f.vendedora_id ? { id: f.vendedora_id, via: 'fixo' } : null),
        match_vendedora_status: f.categoria?.startsWith('vendedora')
          ? (vid ? '✓ resolvido' : '✕ NÃO BATEU em lojas_vendedoras')
          : 'n/a',
        vendas: vid ? vendas_dela : null,
        regras: regrasResumo,
        vale: { config: valeValor, ja_aplicado_em_competencia: valeJaAplicado },
        planilha_competencia: lComp
          ? { achou: true, nome_planilha: lComp.nome, salario: lComp.salario, comissao: lComp.comissao, vale: lComp.vale }
          : { achou: false, alvo_buscado: alvo, msg: `Linha não existe em auxDataPorMes[${mes}].Funcionários — vai precisar criar manual` },
        planilha_seguinte: lSeg
          ? { achou: true, nome_planilha: lSeg.nome, salario: lSeg.salario }
          : { achou: false, alvo_buscado: alvo, msg: `Linha não existe em auxDataPorMes[${mesSeg}].Funcionários — vai precisar criar manual` },
      };
    });

    return res.json({
      competencia,
      contexto_geral: {
        vendas_loja_BR: lojaBR,
        vendas_loja_ST: lojaST,
        mktplc_bruto: mktplcBruto,
        mktplc_liquido: mktplcLiquido,
        muniam: muniam,
      },
      vendas_por_loja_detalhado: {
        Silva_Teles: { atacado: lojaST_atacado, varejo: lojaST_varejo, total: lojaST },
        Bom_Retiro:  { atacado: lojaBR_atacado, varejo: lojaBR_varejo, total: lojaBR },
        total_lojas: lojaST + lojaBR,
      },
      vendedoras_do_mes: vendedorasDoMes,
      bling_diagnostico: blingDiagnostico,
      total_funcionarios_ativos: funcionarios.length,
      total_vendedoras_ativas: vendedoras?.length || 0,
      detalhe,
    });
  } catch (e) {
    console.error('[folha-debug]', e?.message);
    return res.status(500).json({ error: e?.message });
  }
}
