// ═══════════════════════════════════════════════════════════════════════════
// /api/lojas-vesti-auditoria
// ═══════════════════════════════════════════════════════════════════════════
// GET: retorna estatisticas de clientes Vesti pra admin auditar:
//   1. Quantos clientes Vesti tem (total/loja/vendedora)
//   2. Lista de clientes (com vendedora, valor lifetime, ultima compra)
//   3. Sugestoes IA pra Vesti nos ultimos 30d
//   4. Quantas dessas sugestoes mencionam link Vesti (validacao regra IA)
//   5. Mensagens enviadas pra Vesti nos ultimos 30d
//
// Auth: so admin.
//
// Sprint Ailson 05/05/2026: 'fico no escuro... qtos clientes ela encontrou,
// ta chamando mesmo, o filtro ta certo'.
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
    const dataLimite = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

    // 1. Clientes Vesti — fonte primaria eh lojas_clientes.canal_cadastro
    // FIX 06/05/2026: antes buscava so via lojas_clientes_kpis.canal_dominante,
    // mas KPIs nao recalcula automaticamente quando canal_cadastro eh
    // atualizado em massa (ex: planilha de 56 clientes Vesti).
    // Resultado: planilha tem 56 clientes Vesti mas card mostrava 15.
    //
    // SOLUCAO: comecar de lojas_clientes (fonte de verdade do cadastro) e
    // enriquecer com KPI opcional. Captura ambos:
    //   - canal_cadastro='vesti' (fonte: importer/planilha)
    //   - canal_dominante='vesti_dominante' em KPI (fonte: vendas mire)
    const { data: clientesVesti, error: errC } = await supabase
      .from('lojas_clientes')
      .select('id, razao_social, fantasia, status_atual, canal_cadastro, loja_origem, vendedora_id')
      .eq('canal_cadastro', 'vesti')
      .is('arquivado_em', null);
    if (errC) return res.status(500).json({ error: errC.message });

    // Tambem busca os que estao em vesti_dominante via KPI mas talvez nao
    // tenham canal_cadastro='vesti' (UNIAO)
    const { data: kpisVestiDominante } = await supabase
      .from('lojas_clientes_kpis')
      .select('cliente_id')
      .eq('canal_dominante', 'vesti_dominante');

    const idsViaKpi = new Set((kpisVestiDominante || []).map(k => k.cliente_id));
    const idsViaCadastro = new Set((clientesVesti || []).map(c => c.id));
    const refsClientes = [...new Set([...idsViaCadastro, ...idsViaKpi])];

    // Garante que tem todos os clientes (mesmo os que so vieram via KPI)
    let mapCliente = new Map((clientesVesti || []).map(c => [c.id, c]));
    const idsExtras = refsClientes.filter(id => !mapCliente.has(id));
    if (idsExtras.length > 0) {
      const { data: extras } = await supabase
        .from('lojas_clientes')
        .select('id, razao_social, fantasia, status_atual, canal_cadastro, loja_origem, vendedora_id')
        .in('id', idsExtras)
        .is('arquivado_em', null);
      for (const c of (extras || [])) mapCliente.set(c.id, c);
    }

    // Carrega KPIs (opcional — alguns clientes Vesti recem-importados podem
    // nao ter KPI ainda)
    let mapKpi = new Map();
    if (refsClientes.length > 0) {
      const { data: kpis } = await supabase
        .from('lojas_clientes_kpis')
        .select('cliente_id, lifetime_total, ultima_compra, dias_sem_comprar')
        .in('cliente_id', refsClientes);
      mapKpi = new Map((kpis || []).map(k => [k.cliente_id, k]));
    }

    // Agora deriva vendedora_id de cada cliente (via mapCliente)
    const refsVendedoras = [...new Set(
      refsClientes
        .map(id => mapCliente.get(id)?.vendedora_id)
        .filter(Boolean)
    )];

    // Hidrata vendedora
    let mapVendedora = new Map();
    if (refsVendedoras.length > 0) {
      const { data: vendedoras } = await supabase
        .from('lojas_vendedoras')
        .select('id, nome, loja, vesti_link_ativo, vesti_link_1, vesti_link_2, vesti_link_3')
        .in('id', refsVendedoras);
      mapVendedora = new Map((vendedoras || []).map(v => {
        const linkAtivo = v.vesti_link_ativo
          ? v[`vesti_link_${v.vesti_link_ativo}`] || null
          : null;
        return [v.id, { ...v, link_ativo_url: linkAtivo }];
      }));
    }

    // Lista enriquecida de clientes
    const clientesEnriquecidos = refsClientes.map(id => {
      const cli = mapCliente.get(id) || {};
      const k = mapKpi.get(id) || {};
      const vendedoraId = cli.vendedora_id || null;
      const vd = mapVendedora.get(vendedoraId);
      return {
        cliente_id: id,
        nome: cli.fantasia || cli.razao_social || '(sem nome)',
        status_atual: cli.status_atual,
        canal_cadastro: cli.canal_cadastro,
        loja: vd?.loja || cli.loja_origem,
        vendedora_id: vendedoraId,
        vendedora_nome: vd?.nome || '(sem vendedora)',
        vendedora_tem_link: !!vd?.link_ativo_url,
        lifetime_total: k.lifetime_total || 0,
        ultima_compra: k.ultima_compra || null,
        dias_sem_comprar: k.dias_sem_comprar ?? null,
      };
    });

    // Agregados
    const porLoja = {};
    const porVendedora = {};
    const porStatus = {};
    for (const c of clientesEnriquecidos) {
      const loja = c.loja || 'Sem loja';
      porLoja[loja] = (porLoja[loja] || 0) + 1;

      const key = `${c.vendedora_nome}__${c.vendedora_id}`;
      if (!porVendedora[key]) {
        porVendedora[key] = {
          vendedora_id: c.vendedora_id,
          vendedora_nome: c.vendedora_nome,
          loja,
          tem_link: c.vendedora_tem_link,
          qtd_clientes: 0,
          ativo: 0,
          atencao: 0,
          semAtividade: 0,
          inativo: 0,
        };
      }
      porVendedora[key].qtd_clientes++;
      const st = c.status_atual || 'desconhecido';
      if (porVendedora[key][st] !== undefined) porVendedora[key][st]++;

      porStatus[st] = (porStatus[st] || 0) + 1;
    }

    // 2. Sugestoes IA dos ultimos 30d pra clientes Vesti
    let sugestoesVesti = [];
    if (refsClientes.length > 0) {
      const { data: sugs } = await supabase
        .from('lojas_sugestoes_diarias')
        .select('id, cliente_id, vendedora_id, tipo, data_geracao, mensagem_gerada, executada_em')
        .in('cliente_id', refsClientes)
        .gte('data_geracao', dataLimite);
      sugestoesVesti = sugs || [];
    }

    // Quantas mencionam 'catalogo' ou 'vesti' ou link http
    const sugsComLink = sugestoesVesti.filter(s => {
      const m = String(s.mensagem_gerada || '').toLowerCase();
      return m.includes('vesti.app') || m.includes('https://') || m.includes('http://')
        || m.includes('catálogo') || m.includes('catalogo');
    });

    const sugsExecutadas = sugestoesVesti.filter(s => s.executada_em).length;

    // 3. Mensagens enviadas (lojas_acoes tipo_acao=mensagem_enviada)
    let mensagensEnviadas = 0;
    if (refsClientes.length > 0) {
      const { count } = await supabase
        .from('lojas_acoes')
        .select('id', { count: 'exact', head: true })
        .eq('tipo_acao', 'mensagem_enviada')
        .in('cliente_id', refsClientes)
        .gte('created_at', dataLimite);
      mensagensEnviadas = count || 0;
    }

    return res.json({
      total_clientes: clientesEnriquecidos.length,
      por_loja: porLoja,
      por_vendedora: Object.values(porVendedora).sort((a, b) => b.qtd_clientes - a.qtd_clientes),
      por_status: porStatus,
      clientes: clientesEnriquecidos.sort((a, b) => (b.lifetime_total || 0) - (a.lifetime_total || 0)),
      sugestoes_30d: {
        total: sugestoesVesti.length,
        com_link_ou_catalogo: sugsComLink.length,
        executadas: sugsExecutadas,
        pct_com_link: sugestoesVesti.length > 0
          ? Math.round(100 * sugsComLink.length / sugestoesVesti.length)
          : 0,
      },
      mensagens_enviadas_30d: mensagensEnviadas,
      data_limite: dataLimite,
    });
  } catch (e) {
    console.error('[lojas-vesti-auditoria] erro:', e?.message);
    return res.status(500).json({ error: e?.message || 'Erro' });
  }
}
