// ═══════════════════════════════════════════════════════════════════════════
// /api/lojas-site-auditoria
// ═══════════════════════════════════════════════════════════════════════════
// GET: estatisticas dos clientes do SITE B2B (amicialoja.com.br / Convertr)
// pro admin auditar — gemeo do lojas-vesti-auditoria (pedido Ailson 29/07/2026):
//   1. Quantos clientes do site tem (canal_cadastro='convertr' OU compras
//      convertr no KPI) e quantos estao na carteira da Cleide
//   2. Vendas com vendedor CONVERTR importadas (0 = export do Mire ainda nao
//      inclui o site — sinal pro Ailson conferir o export)
//   3. Sugestoes IA pra esses clientes nos ultimos 30d + quantas citam o site
//      amicialoja.com.br (validacao da regra do prompt)
//
// Auth: so admin.
// ═══════════════════════════════════════════════════════════════════════════
import { supabase, validarUsuario, setCors } from './_lojas-helpers.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Use GET' });

  const auth = await validarUsuario(req);
  if (!auth.ok) return res.status(auth.status || 403).json({ error: auth.error });
  if (!auth.isAdmin) return res.status(403).json({ error: 'Apenas admin' });

  try {
    const dataLimite30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

    // 1a. Clientes por cadastro do site
    const { data: porCadastro } = await supabase
      .from('lojas_clientes')
      .select('id, vendedora_id')
      .eq('canal_cadastro', 'convertr')
      .is('arquivado_em', null);

    // 1b. Clientes por compras convertr no KPI
    const { data: porKpi } = await supabase
      .from('lojas_clientes_kpis')
      .select('cliente_id')
      .gt('qtd_compras_convertr', 0);

    const idsSite = new Set([
      ...(porCadastro || []).map(c => c.id),
      ...(porKpi || []).map(k => k.cliente_id),
    ]);

    // Vendedora de cada cliente do site (pra saber quantos estao com a Cleide)
    let naCarteiraCleide = 0;
    let semVendedora = 0;
    if (idsSite.size) {
      const { data: cleide } = await supabase
        .from('lojas_vendedoras').select('id').eq('nome', 'Cleide').maybeSingle();
      const { data: donos } = await supabase
        .from('lojas_clientes')
        .select('id, vendedora_id')
        .in('id', [...idsSite].slice(0, 1000));
      for (const c of (donos || [])) {
        if (!c.vendedora_id) semVendedora++;
        else if (cleide && c.vendedora_id === cleide.id) naCarteiraCleide++;
      }
    }

    // 2. Vendas CONVERTR importadas (qualquer periodo + 30d)
    const { count: vendasConvertr } = await supabase
      .from('lojas_vendas')
      .select('id', { count: 'exact', head: true })
      .ilike('vendedora_nome_raw', '%convert%');
    const { count: vendasConvertr30d } = await supabase
      .from('lojas_vendas')
      .select('id', { count: 'exact', head: true })
      .ilike('vendedora_nome_raw', '%convert%')
      .gte('data_venda', dataLimite30);

    // 3. Sugestoes 30d pra clientes do site + quantas citam o site
    let sugestoes30 = 0, sugestoesComSite = 0;
    if (idsSite.size) {
      const { data: sugs } = await supabase
        .from('lojas_sugestoes_diarias')
        .select('id, mensagem_gerada')
        .gte('data_geracao', dataLimite30)
        .in('cliente_id', [...idsSite].slice(0, 1000));
      sugestoes30 = (sugs || []).length;
      sugestoesComSite = (sugs || []).filter(s => (s.mensagem_gerada || '').toLowerCase().includes('amicialoja')).length;
    }

    return res.status(200).json({
      clientes_site_total: idsSite.size,
      por_cadastro: (porCadastro || []).length,
      por_compras: (porKpi || []).length,
      na_carteira_cleide: naCarteiraCleide,
      sem_vendedora: semVendedora,
      vendas_convertr_importadas: vendasConvertr ?? 0,
      vendas_convertr_30d: vendasConvertr30d ?? 0,
      sugestoes_30d: sugestoes30,
      sugestoes_citando_site: sugestoesComSite,
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
}
