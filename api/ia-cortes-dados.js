/**
 * ia-cortes-dados.js  -  Sugestao de Corte do TabProducao (Sprint 6.5).
 *
 * GET /api/ia-cortes-dados
 *   Header: X-User: <usuario admin>
 *   Query (opcional):
 *     - ref=<refnum>     filtra apenas uma ref especifica
 *     - limite=<N>       limita N primeiras refs (default 30, max 100)
 *
 * Retorna o payload de fn_ia_cortes_recomendados() v1.1 com 8+ campos
 * por ref alem dos campos historicos do Sprint 2:
 *   - cobertura_dias_ref
 *   - pecas_em_producao
 *   - projecao_22d_sem_corte
 *   - projecao_22d_com_corte
 *   - matriz_cor_tamanho[]
 *   - cores[].tendencia_pct
 *   - cores[].tendencia_label  ('alta'|'normal'|'baixa'|'nova')
 *   - expira_em / validade_dias / lead_time_dias (no topo)
 *
 * Arquitetura:
 *   - ADMIN-ONLY RIGIDO (dupla validacao): mesma decisao #5 do
 *     PROMPT MESTRE usada em ia-estoque-dados, ia-lucro-mes etc.
 *   - Cache s-maxage=120: a funcao SQL e mais pesada que as views do
 *     Estoque (faz 2 janelas de vendas + cruzamento), entao 2 minutos
 *     de cache alivia mais. Sugestao de corte muda lenta na pratica.
 *   - Sem limite hard pelo SQL: a funcao ja ordena por curva A
 *     primeiro. Deixamos o client filtrar/limitar via query param se
 *     precisar (default 30 refs e o suficiente pra TabProducao).
 *
 * Formato de resposta (ok=true):
 *   {
 *     "ok": true,
 *     "tempo_ms": NNN,
 *     "gerado_em": "...",
 *     "expira_em": "...",
 *     "validade_dias": 7,
 *     "lead_time_dias": 22,
 *     "versao": "1.1",
 *     "capacidade_semanal": { ... },
 *     "refs": [ {...} ]  // limitado a `limite`
 *   }
 *
 * Formato de erro:
 *   - 400: parametro invalido (limite fora de faixa)
 *   - 401/403: falha de auth admin
 *   - 500: erro interno na funcao SQL
 */
import { supabase, validarAdmin, setCors } from './_ia-helpers.js';

const LIMITE_DEFAULT = 30;
const LIMITE_MAX     = 100;

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'GET only' });
  }

  // 1a validacao: helper padrao
  const admin = await validarAdmin(req);
  if (!admin.ok) {
    return res.status(admin.status).json({ ok: false, error: admin.error });
  }

  // 2a validacao redundante: admin === true explicito (decisao #5)
  if (admin.user?.admin !== true) {
    return res.status(403).json({ ok: false, error: 'Acesso restrito a admin' });
  }

  // Parse de query params
  const refFiltro = String(req.query.ref || '').trim();
  let limite = parseInt(req.query.limite, 10);
  if (isNaN(limite)) limite = LIMITE_DEFAULT;
  if (limite < 1 || limite > LIMITE_MAX) {
    return res.status(400).json({
      ok: false,
      error: `Parametro "limite" deve estar entre 1 e ${LIMITE_MAX}`,
    });
  }

  try {
    const t0 = Date.now();

    // Chama a funcao SQL via RPC (sem parametros)
    const { data, error } = await supabase.rpc('fn_ia_cortes_recomendados');

    if (error) {
      throw new Error(`fn_ia_cortes_recomendados: ${error.message}`);
    }

    // Sanity check: a funcao retorna jsonb, supabase ja desserializa
    if (!data || typeof data !== 'object') {
      throw new Error('fn_ia_cortes_recomendados retornou payload invalido');
    }

    let refs = Array.isArray(data.refs) ? data.refs : [];

    // Filtro por ref especifica (se passado)
    if (refFiltro) {
      // Normaliza igual a funcao SQL (LTRIM zeros)
      const refNorm = refFiltro.replace(/^0+/, '');
      refs = refs.filter(r => String(r.ref || '').replace(/^0+/, '') === refNorm);
    }

    // Limita resultado
    const refs_limitadas = refs.slice(0, limite);

    const ms = Date.now() - t0;

    // Cache de 2min: funcao e mais pesada que views do Estoque
    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=60');

    return res.status(200).json({
      ok: true,
      tempo_ms: ms,
      gerado_em:          data.gerado_em,
      expira_em:          data.expira_em,
      validade_dias:      data.validade_dias,
      lead_time_dias:     data.lead_time_dias,
      versao:             data.versao,
      capacidade_semanal: data.capacidade_semanal,
      refs_total:         refs.length,
      refs_retornadas:    refs_limitadas.length,
      refs:               refs_limitadas,
    });
  } catch (e) {
    console.error('[ia-cortes-dados]:', e);
    return res.status(500).json({
      ok: false,
      error: e.message || 'erro interno',
    });
  }
}
