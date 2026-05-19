/**
 * lojas-trilha-winback-listar.js
 *
 * Lista trilhas de winback ATIVAS pra dashboard admin. Inclui dados da
 * cliente, vendedora, etapa e dias na trilha. Tambem retorna trilhas
 * encerradas recentes (ultimos 30d) pra historico.
 *
 * Ailson 20/05/2026.
 */
import { supabase, validarUsuario, setCors } from './_lojas-helpers.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Use GET' });

  const auth = await validarUsuario(req);
  if (!auth.ok) return res.status(auth.status || 403).json({ error: auth.error });
  if (!auth.isAdmin) return res.status(403).json({ error: 'Admin only' });

  try {
    // Trilhas ativas
    const { data: ativas, error: errA } = await supabase
      .from('lojas_trilha_winback')
      .select(`
        id, cliente_id, vendedora_id, status_inicial, etapa_atual,
        iniciado_em, data_proxima_msg, lifetime_inicio,
        qtd_compras_inicio, dias_sem_comprar_inicio,
        lojas_clientes!inner(apelido, razao_social, comprador_nome),
        lojas_vendedoras!inner(nome, loja)
      `)
      .is('encerrada_em', null)
      .order('iniciado_em', { ascending: false })
      .limit(100);
    if (errA) throw errA;

    // Trilhas encerradas ultimos 30d
    const { data: encerradas, error: errE } = await supabase
      .from('lojas_trilha_winback')
      .select(`
        id, cliente_id, vendedora_id, etapa_atual,
        iniciado_em, encerrada_em, motivo_encerramento,
        lojas_clientes!inner(apelido, razao_social),
        lojas_vendedoras!inner(nome)
      `)
      .not('encerrada_em', 'is', null)
      .gte('encerrada_em', new Date(Date.now() - 30 * 86400e3).toISOString())
      .order('encerrada_em', { ascending: false })
      .limit(50);
    if (errE) throw errE;

    const fmtAtiva = (t) => ({
      id: t.id,
      cliente_nome: t.lojas_clientes?.apelido || t.lojas_clientes?.razao_social || t.lojas_clientes?.comprador_nome || '???',
      vendedora_nome: t.lojas_vendedoras?.nome || '???',
      loja: t.lojas_vendedoras?.loja || '',
      etapa_atual: t.etapa_atual,
      iniciado_em: t.iniciado_em,
      data_proxima_msg: t.data_proxima_msg,
      status_inicial: t.status_inicial,
      lifetime: t.lifetime_inicio,
      qtd_compras: t.qtd_compras_inicio,
      dias_sem_comprar_inicio: t.dias_sem_comprar_inicio,
      dias_na_trilha: Math.floor((Date.now() - new Date(t.iniciado_em).getTime()) / 86400000),
    });

    const fmtEncerrada = (t) => ({
      id: t.id,
      cliente_nome: t.lojas_clientes?.apelido || t.lojas_clientes?.razao_social || '???',
      vendedora_nome: t.lojas_vendedoras?.nome || '???',
      etapa_final: t.etapa_atual,
      motivo: t.motivo_encerramento,
      iniciado_em: t.iniciado_em,
      encerrada_em: t.encerrada_em,
    });

    return res.status(200).json({
      ativas: (ativas || []).map(fmtAtiva),
      encerradas_30d: (encerradas || []).map(fmtEncerrada),
      totais: {
        ativas: (ativas || []).length,
        encerradas_30d: (encerradas || []).length,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
