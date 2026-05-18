/**
 * lojas-janela-acertos.js
 *
 * Endpoint admin pra ler estatisticas de % de acerto da janela de compra.
 * Le da view vw_lojas_janela_acertos.
 *
 * Modos:
 *   - GET (admin)
 *     Retorna agregado geral + breakdown por vendedora + insights.
 *
 *   - GET ?cliente_id=UUID
 *     Retorna historico de predicoes de 1 cliente especifico.
 *
 * Auth: admin only (por enquanto). Vendedora nao precisa ver isso.
 *
 * Resposta agregado:
 *   {
 *     geral: { total_predicoes, acertos, erros, pct_acerto, tendencia, ... },
 *     por_vendedora: [ { vendedora_id, nome, total, acertos, pct_acerto } ],
 *     ultimas_7d: { ... },
 *     insights: { mensagem, recomendacao }
 *   }
 *
 * Ailson 18/05/2026.
 */
import { supabase, validarUsuario, setCors } from './_lojas-helpers.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Use GET' });

  const auth = await validarUsuario(req);
  if (!auth.ok) return res.status(auth.status || 403).json({ error: auth.error });
  if (!auth.isAdmin) return res.status(403).json({ error: 'Admin only' });

  const { cliente_id } = req.query;

  // ─── Modo 1: historico de 1 cliente ─────────────────────────────────
  if (cliente_id) {
    const { data, error } = await supabase
      .from('lojas_janela_predicoes')
      .select('*')
      .eq('cliente_id', cliente_id)
      .order('data_predicao', { ascending: false })
      .limit(50);

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ cliente_id, predicoes: data || [] });
  }

  // ─── Modo 2: agregado geral pro admin ───────────────────────────────
  const { data: geral, error: errGeral } = await supabase
    .from('vw_lojas_janela_acertos')
    .select('*')
    .maybeSingle();

  if (errGeral) return res.status(500).json({ error: errGeral.message });

  // Quebra por vendedora (via join com clientes)
  // Postgrest nao faz aggregate facil, entao usa RPC ou query direta.
  const { data: porVendedora, error: errVend } = await supabase.rpc(
    'lojas_janela_acertos_por_vendedora'
  );
  // Se RPC nao existir, retorna vazio (silencioso)
  const breakdown = (errVend ? [] : (porVendedora || []));

  // Ultimos 7 dias: predicoes resolvidas
  const seteDiasAtras = new Date();
  seteDiasAtras.setDate(seteDiasAtras.getDate() - 7);
  const { data: ultimas7d, error: err7d } = await supabase
    .from('lojas_janela_predicoes')
    .select('status', { count: 'exact' })
    .gte('resolvida_em', seteDiasAtras.toISOString())
    .neq('status', 'aguardando');

  const ultimas7dStats = (ultimas7d || []).reduce((acc, p) => {
    acc.total++;
    if (p.status === 'acertou') acc.acertos++;
    if (p.status === 'errou_adiantado') acc.adiantado++;
    if (p.status === 'errou_atrasado') acc.atrasado++;
    return acc;
  }, { total: 0, acertos: 0, adiantado: 0, atrasado: 0 });
  ultimas7dStats.pct_acerto = ultimas7dStats.total
    ? Math.round(100 * ultimas7dStats.acertos / ultimas7dStats.total * 10) / 10
    : null;

  // Insights amigaveis baseados na tendencia
  let insights = null;
  if (geral && geral.tendencia) {
    if (geral.tendencia === 'modelo_superestima_prazo') {
      insights = {
        mensagem: `Em geral, clientes voltam ${Math.abs(geral.media_dias_adiantado)}d antes do previsto`,
        recomendacao: 'IA deveria reduzir o prazo previsto (clientes compram mais frequente do que a media calculada)',
      };
    } else if (geral.tendencia === 'modelo_subestima_prazo') {
      insights = {
        mensagem: `Em geral, clientes voltam ${geral.media_dias_atrasado}d depois do previsto`,
        recomendacao: 'IA deveria aumentar o prazo previsto (clientes demoram mais que a media calculada)',
      };
    } else {
      insights = {
        mensagem: 'Modelo balanceado: erros adiantados e atrasados em proporcao parecida',
        recomendacao: 'Manter prazos atuais, focar em afinar caso a caso',
      };
    }
  }

  return res.status(200).json({
    geral: geral || null,
    por_vendedora: breakdown,
    ultimas_7d: ultimas7dStats,
    insights,
  });
}
