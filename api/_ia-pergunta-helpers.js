/**
 * _ia-pergunta-helpers.js — Helpers específicos do módulo "Perguntar à IA"
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Escopo do módulo (Sprint 8):
 *   - Botão global no cabeçalho do app, funcionário e admin usam
 *   - Pool de 15 perguntas/dia pra não-admin · admin ilimitado
 *   - Filtra valores R$ pra não-admin (exceto ficha técnica)
 *   - 4 domínios: estoque · produção · produto · ficha técnica
 *   - Produção: ailson_cortes (REAL) primeiro, ordens_corte (estimativa) segundo
 *
 * Reaproveita do _ia-helpers.js: supabase, calcularCustoBRL, gastoMesAtual,
 * temOrcamento. Aqui só ficam helpers específicos deste módulo.
 *
 * Convenções:
 *   - REF sempre normalizada com zero à esquerda (5 dígitos): "2277" → "02277"
 *   - Categoria: 'estoque' | 'producao' | 'produto' | 'ficha' | 'outros'
 *   - Contexto retornado pro prompt = objeto JS compacto (< 2KB) já filtrado
 * ═══════════════════════════════════════════════════════════════════════
 */

import { supabase } from './_ia-helpers.js';


// ═══════════════════════════════════════════════════════════════════════
// 1. NORMALIZAÇÃO DE REF (tolerante a zero à esquerda)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Normaliza uma string de REF pra forma canônica de 5 dígitos.
 *   "2277"     → "02277"
 *   "02277"    → "02277"
 *   " 2277 "   → "02277"
 *   "ref 2277" → "02277"
 *   "abc"      → null (não é REF válida)
 */
export function normalizarRef(txt) {
  if (!txt) return null;
  const m = String(txt).trim().match(/\b(\d{3,5})\b/);
  if (!m) return null;
  return m[1].padStart(5, '0');
}


/**
 * Extrai TODAS as refs mencionadas em um texto livre.
 * Retorna array de refs canônicas (5 dígitos), ordenadas e deduplicadas.
 * Usado quando o user compara várias: "2277 vs 2822".
 */
export function extrairRefs(texto) {
  if (!texto) return [];
  const matches = String(texto).match(/\b0?\d{4,5}\b/g) || [];
  const refs = matches
    .map(m => m.padStart(5, '0'))
    .filter(r => /^\d{5}$/.test(r));
  return [...new Set(refs)].sort();
}


// ═══════════════════════════════════════════════════════════════════════
// 2. VALIDAÇÃO DE USUÁRIO (admin OU funcionário)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Valida que o user_id (numérico Date.now do cadastro) corresponde a um
 * usuário cadastrado. Retorna o objeto do user com flag admin.
 *
 * Diferente do validarAdmin — este aceita não-admin também. Usado pra
 * saber SE o user existe e SE ele é admin (pra aplicar filtros).
 *
 * Estrutura do user: { id, usuario, admin, modulos, ... }
 */
export async function resolverUsuario(userId) {
  if (!userId) return { ok: false, error: 'user_id ausente', status: 401 };

  try {
    const { data, error } = await supabase
      .from('amicia_data')
      .select('payload')
      .eq('user_id', 'usuarios')
      .maybeSingle();

    if (error) return { ok: false, error: error.message, status: 500 };

    const lista = data?.payload?.usuarios || [];
    const encontrado = lista.find(u => String(u.id) === String(userId));

    if (!encontrado) {
      return { ok: false, error: 'Usuário não encontrado', status: 403 };
    }

    return {
      ok: true,
      user: {
        id: encontrado.id,
        usuario: encontrado.usuario || 'desconhecido',
        admin: encontrado.admin === true,
      },
    };
  } catch (e) {
    return { ok: false, error: e.message || 'Erro', status: 500 };
  }
}


// ═══════════════════════════════════════════════════════════════════════
// 3. RATE LIMIT (pool compartilhado de 15/dia pra não-admin)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Checa se o pool de não-admin ainda tem perguntas disponíveis hoje.
 * Admin sempre passa. Retorna { ok, usado, limite, restante }.
 */
export async function checarRateLimit(isAdmin) {
  if (isAdmin) return { ok: true, admin: true };

  const { data: cfg } = await supabase
    .from('amicia_data')
    .select('payload')
    .eq('user_id', 'ia-pergunta-config')
    .maybeSingle();

  const limite = Number(cfg?.payload?.config?.rate_limit_users ?? 50);

  const { data: poolRow } = await supabase.rpc('fn_ia_pergunta_pool_hoje');
  const usado = Number(poolRow ?? 0);

  return {
    ok: usado < limite,
    admin: false,
    usado,
    limite,
    restante: Math.max(0, limite - usado),
  };
}


// ═══════════════════════════════════════════════════════════════════════
// 3.1. SAUDAÇÃO INTELIGENTE (primeira pergunta do dia + hora BRT)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Retorna o ISO string do início do dia atual em BRT (UTC-3, sem DST).
 * Usado como filtro pra contar perguntas do dia corrente.
 */
function inicioDoDiaBRT_ISO() {
  const agora = new Date();
  const offsetMs = 3 * 3600000;
  const brtNow = new Date(agora.getTime() - offsetMs);
  brtNow.setUTCHours(0, 0, 0, 0);
  return new Date(brtNow.getTime() + offsetMs).toISOString();
}

/**
 * Calcula a saudação apropriada pro horário atual em BRT.
 *   5h-11:59  → "Bom dia"
 *   12h-17:59 → "Boa tarde"
 *   18h-4:59  → "Boa noite"
 */
export function saudacaoBRT() {
  const agora = new Date();
  const utcHour = agora.getUTCHours();
  const brtHour = (utcHour - 3 + 24) % 24;
  if (brtHour >= 5 && brtHour < 12) return 'Bom dia';
  if (brtHour >= 12 && brtHour < 18) return 'Boa tarde';
  return 'Boa noite';
}

/**
 * Verifica se é a primeira pergunta do dia desse user específico.
 * Ignora perguntas com erro (não contam como interação real).
 * Retorna true se ainda não falou com a IA hoje.
 */
export async function primeiraPerguntaDoDia(userId) {
  const { count, error } = await supabase
    .from('ia_pergunta_historico')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('erro', null)
    .gte('created_at', inicioDoDiaBRT_ISO());

  if (error) {
    console.error('[primeiraPerguntaDoDia]', error.message);
    return false; // na dúvida, não faz saudação (melhor que fazer sempre)
  }
  return (count || 0) === 0;
}

/**
 * Capitaliza o nome do usuário pra exibição na saudação.
 *   "admin" → "Admin"
 *   "stefany" → "Stefany"
 *   "maria.silva" → "Maria"  (pega só a primeira parte se tiver ponto)
 */
export function nomeExibicao(usuario) {
  if (!usuario) return '';
  const primeiro = String(usuario).trim().split(/[.\s_-]/)[0];
  if (!primeiro) return '';
  return primeiro.charAt(0).toUpperCase() + primeiro.slice(1).toLowerCase();
}


// ═══════════════════════════════════════════════════════════════════════
// 4. CLASSIFICADOR DE INTENÇÃO (keywords rápido)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Classifica a pergunta em uma das 4 categorias + 'outros' via heurística
 * de keywords. Retorna { categoria, confianca: 0-1, refs }.
 *
 * Se ambíguo (2+ categorias empatadas), marca como 'outros' e baixa conf
 * — o backend puxa contexto de múltiplos domínios pra IA decidir.
 */
export function classificarIntencao(pergunta) {
  const texto = String(pergunta || '').toLowerCase();
  const refs = extrairRefs(pergunta);

  // Keywords por domínio (ordem importa — mais específico primeiro)
  const KEYWORDS = {
    ficha: [
      'valor', 'preço', 'preco', 'quanto', 'custo', 'custa', 'sai por',
      'silva teles', 'brás', 'bras', 'josé paulino', 'jose paulino',
      'bom retiro', 'varejo', 'ficha técnica', 'ficha tecnica',
    ],
    producao: [
      'produção', 'producao', 'produzindo', 'produzida', 'produzido',
      'costureiro', 'costureira', 'costura', 'oficina', 'oficinas',
      'cortando', 'cortado', 'matriz', 'folhas',
      'corte ', 'cortes ', 'cortar', // pega "tem corte", "quantos cortes", "vai cortar"
      'entrega', 'prazo', 'chega', 'devolv', 'pronta', 'atrasad', 'lote',
    ],
    estoque: [
      'estoque', 'ruptura', 'zerad', 'acabando', 'acabou', 'vai acabar',
      'cobertura', 'dias de', 'variação', 'variacao', 'sku', 'disponível',
      'disponivel', 'risco de zerar', 'faltando', 'sem cor', 'carro-chefe',
      'curva a', 'curva b', 'curva c', 'parado', 'parada', 'parou', 'encalhad',
      'gira', 'girando', 'nao gira', 'não gira', 'fim de semana', 'fds',
      'best seller', 'best-seller', 'campeao', 'campeão',
    ],
    produto: [
      'mais vend', 'top', 'ranking', 'tendência', 'tendencia', 'subindo',
      'caindo', 'cresc', 'bombando', 'parou de vend', 'faturamento',
      'faturou', 'lucro', 'margem', 'venda', 'vendas', 'volume',
      'ticket médio', 'ticket medio', 'cor top', 'tamanho',
    ],
  };

  const scores = {};
  for (const [cat, kws] of Object.entries(KEYWORDS)) {
    scores[cat] = kws.filter(kw => texto.includes(kw)).length;
  }

  const max = Math.max(...Object.values(scores));
  const categorias = Object.entries(scores)
    .filter(([, s]) => s === max && s > 0)
    .map(([c]) => c);

  // Nenhum match → 'outros' (raro; user perguntou algo fora de escopo)
  if (max === 0) {
    return { categoria: 'outros', confianca: 0.3, refs, scores };
  }

  // 2+ empatados → 'outros' com baixa confiança, backend puxa tudo
  if (categorias.length > 1) {
    return { categoria: 'outros', confianca: 0.5, refs, scores, empate: categorias };
  }

  // Confiança proporcional ao número de keywords batidas
  const conf = Math.min(1, 0.5 + (max * 0.15));
  return { categoria: categorias[0], confianca: conf, refs, scores };
}


// ═══════════════════════════════════════════════════════════════════════
// 5. FILTRO DE VALORES R$ (pra não-admin, exceto ficha)
// ═══════════════════════════════════════════════════════════════════════

const CAMPOS_MONETARIOS = [
  'faturamento', 'bruto', 'liquido', 'frete', 'lucro', 'margem',
  'ticket_medio', 'ticket', 'valor_total', 'valor_unit', 'preco_medio',
  'custo_total', 'receita', 'vendas_brl', 'valor_venda',
];

/**
 * Remove recursivamente campos monetários de um objeto. Usado pra preparar
 * contexto pro prompt quando user não é admin.
 *
 * NÃO afeta ficha técnica — custo e 3 preços de venda ficam sempre visíveis.
 * Por isso passa `excluirFicha=true` quando o domínio é ficha.
 */
export function filtrarMonetarios(obj, excluirFicha = false) {
  if (excluirFicha || obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(v => filtrarMonetarios(v, false));

  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (CAMPOS_MONETARIOS.some(cm => k.toLowerCase().includes(cm))) continue;
    out[k] = filtrarMonetarios(v, false);
  }
  return out;
}


// ═══════════════════════════════════════════════════════════════════════
// 6. CARREGADORES DE CONTEXTO POR DOMÍNIO
// ═══════════════════════════════════════════════════════════════════════

/**
 * Verifica se uma REF existe no cadastro (produtos do app ou ficha técnica).
 * Usado quando NÃO encontra a REF em estoque/produção/vendas pra responder
 * com mais inteligência: "tá cadastrada mas sem corte" vs "nem existe".
 * Também retorna URL pública da foto do produto se existir no Storage.
 */
/**
 * Gera a URL publica da foto da REF no bucket 'produtos' do Supabase Storage.
 * O upload (api/produto-foto.js) usa REF.toUpperCase() + .{jpg|png|webp}, mas
 * fotos antigas podem estar gravadas SEM zero a esquerda (ex: '2277.jpg' em
 * vez de '02277.jpg') e/ou em outras extensoes.
 *
 * Mesma estrategia do componente FotoProdLarge no App.tsx (linha ~4154):
 * lista o bucket UMA vez e procura match em qualquer das variantes possiveis.
 */
export async function resolverFotoUrl(ref) {
  if (!ref) return '';
  try {
    const orig = String(ref).trim().toUpperCase();
    const norm = orig.replace(/^0+/, ''); // sem zero a esquerda
    const pad4 = norm.padStart(4, '0');
    const pad5 = norm.padStart(5, '0');

    // Set de basenames possiveis (case-insensitive comparado depois)
    const candidatos = new Set([orig, norm, pad4, pad5]);

    // Lista TODOS os arquivos cujo nome comeca com qualquer prefixo numerico
    // batendo a REF. Como search no Supabase eh prefix-match, tentamos com
    // norm (mais curto) que pega tanto '2277.jpg' quanto '02277.jpg'.
    const { data: files } = await supabase.storage
      .from('produtos')
      .list('', { search: norm, limit: 100 });

    if (!files || files.length === 0) return '';

    // Procura arquivo cujo basename (sem extensao) esta nos candidatos
    const match = files.find(f => {
      const baseName = f.name.replace(/\.[^.]+$/, '').toUpperCase();
      return candidatos.has(baseName);
    });

    if (!match) return '';

    const { data } = supabase.storage.from('produtos').getPublicUrl(match.name);
    return data?.publicUrl || '';
  } catch {
    return '';
  }
}


export async function buscarRefNoCadastro(ref) {
  if (!ref) return { encontrada: false };

  // Resolve foto via helper unificado (lista bucket pra achar extensao certa)
  const fotoUrl = await resolverFotoUrl(ref);

  // 1. Cadastro principal (amicia-admin.payload.produtos)
  const { data: adm } = await supabase
    .from('amicia_data')
    .select('payload')
    .eq('user_id', 'amicia-admin')
    .maybeSingle();

  const produtos = adm?.payload?.produtos || [];
  const prodMatch = produtos.find(p => normalizarRef(p.ref) === ref);
  if (prodMatch) {
    return {
      encontrada: true,
      fonte: 'cadastro_produtos',
      descricao: prodMatch.descricao || '',
      marca: prodMatch.marca || '',
      tecido: prodMatch.tecido || '',
      foto_url: fotoUrl,
    };
  }

  // 2. Ficha técnica (amicia_data.user_id='ficha-tecnica')
  const { data: ft } = await supabase
    .from('amicia_data')
    .select('payload')
    .eq('user_id', 'ficha-tecnica')
    .maybeSingle();

  const fichas = ft?.payload?.fichas || [];
  const fichaMatch = fichas.find(f => normalizarRef(f.ref) === ref);
  if (fichaMatch) {
    return {
      encontrada: true,
      fonte: 'ficha_tecnica',
      descricao: fichaMatch.descricao || '',
      foto_url: fotoUrl,
    };
  }

  return { encontrada: false, foto_url: fotoUrl };
}


/**
 * Carrega estado de estoque. Se `ref` informado, foca nela. Senão traz
 * resumo geral (top 20 ruptura + top 20 saudável).
 */
/**
 * contextoEstoque(ref?)
 * ─────────────────────────────────────────────────────────────────────
 * REF específica → granularidade fina cor+tam DAS CORES APROVADAS:
 *   - Cruza vw_variacoes_classificadas (variação ativa/fraca/inativa, cobertura)
 *     com vw_distribuicao_cores_por_ref (filtro top do catálogo + ≥2 var/cor)
 *   - Filtro padrão classificacao = 'principal' (mesma regra que o card de
 *     Sugestão de Corte usa) — fora dela, cor é considerada inativa pra fins
 *     de decisão.
 *   - Retorna lista granular ordenada por urgência (cobertura projetada ASC)
 *     + agregados (qtd_ativa, qtd_critica, qtd_zerada).
 *   - Se REF não existe no estoque ML, cai em buscarRefNoCadastro pra
 *     diferenciar "REF errada" de "REF cadastrada mas sem corte agora".
 *
 * SEM ref → resumo geral via vw_ia_curva_abc_ranking (Curva A/B/C por
 *   posição absoluta, janela 45d, dias_ate_zerar com vs sem oficinas).
 *   Devolve 3 listas: risco_zerar_curva_a, risco_zerar_geral, paradas.
 *
 * Decisão chave: a REGRA DAS CORES APROVADAS já está implementada nas
 * views `vw_distribuicao_cores_por_ref` (gate1=top do catálogo, gate2=≥2
 * variações vendendo) — a IA só consome o resultado. NÃO duplica regra
 * em JS.
 */
export async function contextoEstoque(ref = null) {
  // ═══════════════════════════════════════════════════════════════════
  // CASO 1: REF específica → granular por cor+tam (cores aprovadas)
  // ═══════════════════════════════════════════════════════════════════
  if (ref) {
    // IMPORTANTE: as views (vw_variacoes_classificadas, vw_distribuicao_cores_por_ref,
    // vw_ia_curva_abc_ranking, vw_ia_variacoes_em_ruptura) fazem LTRIM(...,'0')
    // na origem e armazenam ref SEM zero à esquerda (ex: "2832", não "02832").
    // O `ref` que chega aqui já vem normalizado em 5 dígitos pelo frontend.
    // Pra bater nas queries, preciso da forma curta também.
    const refSemZero = String(ref).replace(/^0+/, '') || '0';

    // Variações DAS CORES APROVADAS (classificacao='principal' do banco)
    const [
      { data: variacoes },
      { data: cores_aprovadas },
      { data: cores_excluidas },
      { data: ranking },
    ] = await Promise.all([
      supabase
        .from('vw_variacoes_classificadas')
        .select('cor, cor_key, tam, estoque_atual, vendas_15d, vendas_30d, vendas_mes_ant, vendas_90d, velocidade_dia, cobertura_dias, cobertura_projetada_dias, demanda_status, cobertura_status, pecas_em_corte, confianca')
        .eq('ref', refSemZero),
      supabase
        .from('vw_distribuicao_cores_por_ref')
        .select('cor_key, cor, classificacao, rank_cor, rank_catalogo, vendas_30d_cor, participacao_pct, tendencia_cor, gate1_ok, gate2_ok')
        .eq('ref', refSemZero)
        .eq('classificacao', 'principal'),
      supabase
        .from('vw_distribuicao_cores_por_ref')
        .select('cor, classificacao, motivo_exclusao, rank_catalogo, vendas_30d_cor')
        .eq('ref', refSemZero)
        .neq('classificacao', 'principal'),
      supabase
        .from('vw_ia_curva_abc_ranking')
        .select('curva, posicao_ranking, vendas_45d, vendas_dia, qtd_total_estoque, pecas_em_corte, dias_ate_zerar_ml_atual, dias_ate_zerar_com_oficinas')
        .eq('ref', refSemZero)
        .maybeSingle(),
    ]);

    const aprovadas = new Set((cores_aprovadas || []).map(c => c.cor_key));
    const todasVariacoes = variacoes || [];

    // Filtra variações cuja cor está aprovada (regra das cores corretas)
    const variacoesAprovadas = todasVariacoes.filter(v => aprovadas.has(v.cor_key));

    // Granularidade de risco: ordena por urgência (menor cobertura projetada primeiro)
    const variacoes_em_ruptura = variacoesAprovadas
      .filter(v => v.demanda_status === 'ativa' && ['critica', 'zerada'].includes(v.cobertura_status))
      .sort((a, b) => {
        const ca = a.cobertura_projetada_dias ?? -1;
        const cb = b.cobertura_projetada_dias ?? -1;
        return ca - cb;
      })
      .map(v => ({
        cor: v.cor,
        tam: v.tam,
        estoque_atual: v.estoque_atual,
        pecas_em_corte: v.pecas_em_corte,
        vendas_15d: v.vendas_15d,
        vendas_30d: v.vendas_30d,
        cobertura_projetada_dias: v.cobertura_projetada_dias,
        cobertura_status: v.cobertura_status,
      }));

    // Variações ativas que NÃO estão em ruptura (saudáveis ou em atenção)
    const variacoes_ativas_ok = variacoesAprovadas
      .filter(v => v.demanda_status === 'ativa' && !['critica', 'zerada'].includes(v.cobertura_status))
      .map(v => ({
        cor: v.cor,
        tam: v.tam,
        estoque_atual: v.estoque_atual,
        cobertura_projetada_dias: v.cobertura_projetada_dias,
        cobertura_status: v.cobertura_status,
      }));

    // Ruptura disfarçada (vendia e parou) — vale alertar mesmo em cor aprovada
    const ruptura_disfarcada = variacoesAprovadas
      .filter(v => v.demanda_status === 'ruptura_disfarcada')
      .map(v => ({
        cor: v.cor,
        tam: v.tam,
        estoque_atual: v.estoque_atual,
        vendas_mes_ant: v.vendas_mes_ant,
        vendas_15d: v.vendas_15d,
      }));

    // Se a ref não tem nenhum dado em nenhuma das views, busca cadastro
    if (todasVariacoes.length === 0 && !ranking) {
      const cad = await buscarRefNoCadastro(ref);
      return {
        ref_foco: null,
        ref_cadastrada: cad,
        msg: cad.encontrada
          ? `REF ${ref} cadastrada mas sem dados ML/vendas. Pode ser ref nova sem histórico ou sem cadastro de cores no anúncio.`
          : `REF ${ref} não encontrada em nenhum cadastro nem nas vendas ML.`,
      };
    }

    return {
      ref_foco: ref,
      ranking_geral: ranking || null, // posicao_ranking, curva, dias_ate_zerar_*
      cores_aprovadas: (cores_aprovadas || []).map(c => ({
        cor: c.cor,
        rank_na_ref: c.rank_cor,
        rank_catalogo: c.rank_catalogo,
        participacao_pct: c.participacao_pct,
        vendas_30d: c.vendas_30d_cor,
        tendencia: c.tendencia_cor,
      })),
      cores_excluidas_resumo: {
        total: (cores_excluidas || []).length,
        amostra: (cores_excluidas || []).slice(0, 5).map(c => ({
          cor: c.cor,
          motivo: c.motivo_exclusao,
        })),
      },
      qtd_variacoes_total: todasVariacoes.length,
      qtd_variacoes_em_cores_aprovadas: variacoesAprovadas.length,
      qtd_variacoes_ativas_ok: variacoes_ativas_ok.length,
      qtd_variacoes_em_ruptura: variacoes_em_ruptura.length,
      qtd_ruptura_disfarcada: ruptura_disfarcada.length,
      variacoes_em_ruptura,        // ordenadas por urgência (menor cobertura primeiro)
      variacoes_ativas_ok,         // saudáveis/atenção
      ruptura_disfarcada,          // vendia e parou
      observacao: 'Granularidade só conta variações em CORES APROVADAS (top do catálogo + ≥2 var. vendendo). Cores fora dessa lista são consideradas inativas. cobertura_projetada_dias = (estoque + peças_em_corte) / vendas_dia, devolução 10% já aplicada. demanda_status: ativa (≥6 vendas/15d) | fraca (1-5) | ruptura_disfarcada (vendia mês passado e parou) | inativa.',
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // CASO 2: SEM ref → resumo geral via vw_ia_curva_abc_ranking
  // ═══════════════════════════════════════════════════════════════════

  // Curva A em risco real considerando oficinas (mais relevante: já desconta produção)
  const { data: riscoCurvaA } = await supabase
    .from('vw_ia_curva_abc_ranking')
    .select('ref, posicao_ranking, vendas_45d, vendas_dia, qtd_total_estoque, pecas_em_corte, dias_ate_zerar_ml_atual, dias_ate_zerar_com_oficinas')
    .eq('curva', 'A')
    .lte('dias_ate_zerar_com_oficinas', 14)
    .order('dias_ate_zerar_com_oficinas', { ascending: true, nullsFirst: false })
    .limit(15);

  // Risco geral urgente (≤7 dias com oficinas, qualquer curva)
  const { data: riscoGeral } = await supabase
    .from('vw_ia_curva_abc_ranking')
    .select('ref, curva, posicao_ranking, vendas_dia, qtd_total_estoque, pecas_em_corte, dias_ate_zerar_com_oficinas')
    .lte('dias_ate_zerar_com_oficinas', 7)
    .order('dias_ate_zerar_com_oficinas', { ascending: true, nullsFirst: false })
    .limit(15);

  // Paradas com estoque alto (problema oposto: vende pouco mas ocupa giro)
  const { data: paradas } = await supabase
    .from('vw_ia_curva_abc_ranking')
    .select('ref, vendas_45d, qtd_total_estoque, pecas_em_corte')
    .eq('curva', 'C')
    .gt('qtd_total_estoque', 100)
    .lte('vendas_45d', 5)
    .order('qtd_total_estoque', { ascending: false })
    .limit(10);

  // Top 30 refs (responde "quais refs mais vendem" diretamente)
  const { data: top30Refs } = await supabase
    .from('vw_ia_curva_abc_ranking')
    .select('ref, posicao_ranking, curva, vendas_45d, vendas_dia, qtd_total_estoque, dias_ate_zerar_com_oficinas')
    .lte('posicao_ranking', 30)
    .order('posicao_ranking', { ascending: true });

  // Top cores do catálogo (responde "quais cores mais vendem" diretamente)
  // Fonte: vw_ranking_cores_catalogo — mesma view usada como gate1 pra
  // aprovar cor num corte. Limita 20 pra não inflar contexto.
  const { data: topCores } = await supabase
    .from('vw_ranking_cores_catalogo')
    .select('*')
    .order('rank_global', { ascending: true })
    .limit(20);

  // Variações granulares (cor+tam) em ruptura — DE QUALQUER REF, mas só
  // nas cores aprovadas. Resolve "tem variação prestes a zerar?" quando
  // o user NÃO dá REF específica. Top 30 mais urgentes.
  const { data: variacoesRupturaGeral } = await supabase
    .from('vw_ia_variacoes_em_ruptura')
    .select('ref, cor, tam, estoque_atual, pecas_em_corte, vendas_15d, vendas_30d, cobertura_projetada_dias, cobertura_status, rank_cor_na_ref, rank_catalogo')
    .order('cobertura_projetada_dias', { ascending: true, nullsFirst: true })
    .limit(30);

  return {
    risco_zerar_curva_a: riscoCurvaA || [],
    risco_zerar_geral_urgente: riscoGeral || [],
    paradas_alto_estoque: paradas || [],
    top_30_refs_mais_vendidas: top30Refs || [],
    top_cores_mais_vendidas: topCores || [],
    variacoes_em_ruptura_geral: variacoesRupturaGeral || [],
    observacao: 'Curva ABC por POSIÇÃO no ranking de vendas dos últimos 45 dias (Top Ranking 30 do Bling): A=1-10, B=11-20, C=21+. dias_ate_zerar_com_oficinas considera estoque ML + peças em produção. variacoes_em_ruptura_geral lista variações cor+tam em ruptura de QUALQUER ref (já filtradas pelas cores aprovadas) — use quando o usuário perguntar de variações sem citar uma REF específica.',
  };
}


/**
 * Carrega contexto de produção. Prioridade (Ailson 22/04):
 *   1. ailson_cortes (REAL — peças já cortadas indo pra oficina)
 *   2. ordens_corte (ESTIMATIVA — programado na sala, pode mudar)
 * Retorna { cortes_reais[], estimativas_sala[] } já enriquecidos com
 * prazo = 22 dias a partir de `data`, e matriz_render pré-montada
 * (células calculadas via folhas × grade).
 */
export async function contextoProducao(ref = null) {
  // 1. Cortes REAIS das oficinas
  const { data: ac } = await supabase
    .from('amicia_data')
    .select('payload')
    .eq('user_id', 'ailson_cortes')
    .maybeSingle();

  const todosCortes = ac?.payload?.cortes || [];
  const hoje = new Date();

  // Cortes em aberto (não entregues, ou entregues parcialmente)
  const cortesAtivos = todosCortes
    .filter(c => c.entregue !== true)
    .filter(c => !ref || normalizarRef(c.ref) === ref)
    .map(c => {
      const dataCorte = new Date(c.data);
      const dias_decorridos = Math.floor((hoje - dataCorte) / 86400000);
      const dias_restantes = 22 - dias_decorridos;
      return {
        ref: normalizarRef(c.ref),
        nCorte: c.nCorte,
        descricao: c.descricao,
        oficina: c.oficina,
        data: c.data,
        qtd: c.qtd,
        qtdEntregue: c.qtdEntregue || 0,
        dias_decorridos,
        dias_restantes,
        atrasado: dias_restantes < 0,
        matriz_render: construirMatrizRender(c.detalhes, c.qtd),
      };
    });

  // Cortes ENTREGUES RECENTES (≤3 dias) - relevante pra equipe saber o que
  // chegou ha pouco tempo. Mais antigo que isso polui a resposta.
  const cortesEntreguesRecentes = todosCortes
    .filter(c => c.entregue === true)
    .filter(c => !ref || normalizarRef(c.ref) === ref)
    .map(c => {
      // Tenta achar a data de entrega real; se nao tiver, usa a ultima atualizacao
      const dataEntrega = c.dataEntrega || c.dataConclusao || c.updatedAt || c.data;
      const dataE = new Date(dataEntrega);
      const dias_desde_entrega = Math.floor((hoje - dataE) / 86400000);
      return {
        ref: normalizarRef(c.ref),
        nCorte: c.nCorte,
        descricao: c.descricao,
        oficina: c.oficina,
        data_entrega: dataEntrega,
        data_entrega_fmt: dataE.toLocaleDateString('pt-BR'),
        dias_desde_entrega,
        qtd: c.qtd,
        qtdEntregue: c.qtdEntregue || c.qtd,
        matriz_render: construirMatrizRender(c.detalhes, c.qtd),
      };
    })
    .filter(c => c.dias_desde_entrega >= 0 && c.dias_desde_entrega <= 3) // só últimos 3 dias
    .sort((a, b) => a.dias_desde_entrega - b.dias_desde_entrega);

  // 2. Estimativas da Sala de Corte (fallback se não achou real)
  let estimativasSala = [];
  if (!ref || cortesAtivos.length === 0) {
    const query = supabase
      .from('ordens_corte')
      .select('id, ref, cores, grade, status, origem, created_at')
      .in('status', ['aberto', 'lancado', 'em_corte']);
    if (ref) query.eq('ref', ref);
    const { data: ordens } = await query.limit(20);
    estimativasSala = (ordens || []).map(o => ({
      ...o,
      ref: normalizarRef(o.ref),
      tipo: 'estimativa',
      observacao: 'Ainda não foi cortado — número pode mudar',
    }));
  }

  // 3. Se pediu REF específica e NÃO achou em nenhuma fonte,
  //    busca no cadastro pra saber se a ref existe (só não tem corte)
  let refCadastrada = null;
  if (ref && cortesAtivos.length === 0 && estimativasSala.length === 0) {
    refCadastrada = await buscarRefNoCadastro(ref);
  }

  return {
    cortes_reais: cortesAtivos.slice(0, 20),
    cortes_entregues_recentes: cortesEntreguesRecentes.slice(0, 5), // ≤3 dias, max 5
    estimativas_sala: estimativasSala,
    total_reais: cortesAtivos.length,
    ref_cadastrada: refCadastrada, // null se não foi checado, { encontrada: bool, descricao, ... } se foi
  };
}


/**
 * Constrói a estrutura matriz_render pronta pro frontend a partir dos
 * `detalhes` do corte (estrutura do módulo Oficina).
 *
 * Estrutura de entrada (do ailson_cortes):
 *   detalhes = {
 *     cores: [{nome: 'Figo', folhas: 33}, {nome: 'Azul Marinho', folhas: 30}],
 *     tamanhos: [{tam: 'P', grade: 1}, {tam: 'M', grade: 1}, ...]
 *   }
 *
 * Regra de cálculo: célula[cor][tam] = folhas[cor] × grade[tam]
 * (confirmado nos dados reais: Figo 33f × 4 grades = 132 peças)
 *
 * Estrutura de saída (o frontend MatrizRender espera):
 *   {
 *     cores: [{nome, folhas, P, M, G, GG, total}, ...],
 *     tamanhos: ['P','M','G','GG'],
 *     total_folhas, total_pecas, qtd_manual, qtd_calculada
 *   }
 */
export function construirMatrizRender(detalhes, qtdManual = null) {
  // Caso 1: corte SEM detalhamento de matriz (lancado direto com qtd total).
  // Em vez de retornar null (que faz a matriz nem aparecer), devolve uma
  // estrutura especial que o frontend interpreta como "matriz simples".
  // Assim a equipe ainda ve que existe o corte e quanto vai entregar,
  // mesmo sem o detalhe cor×tamanho.
  if (!detalhes || !Array.isArray(detalhes.cores) || !Array.isArray(detalhes.tamanhos)) {
    if (qtdManual && Number(qtdManual) > 0) {
      return {
        sem_matriz: true,
        qtd_manual: Number(qtdManual),
        qtd_calculada: Number(qtdManual),
        total_folhas: 0,
        total_pecas: Number(qtdManual),
        cores: [],
        tamanhos: [],
        nota: 'Corte lancado sem detalhamento cor x tamanho',
      };
    }
    return null;
  }

  const tams = detalhes.tamanhos.map(t => t.tam);
  const gradeMap = {};
  for (const t of detalhes.tamanhos) gradeMap[t.tam] = Number(t.grade) || 0;

  const cores = detalhes.cores.map(c => {
    const folhas = Number(c.folhas) || 0;
    const celulas = {};
    let totalCor = 0;
    for (const tam of tams) {
      const qtd = folhas * (gradeMap[tam] || 0);
      celulas[tam] = qtd;
      totalCor += qtd;
    }
    return {
      nome: c.nome,
      folhas,
      ...celulas,
      total: totalCor,
    };
  });

  const totalFolhas = cores.reduce((s, c) => s + (c.folhas || 0), 0);
  const totalPecas = cores.reduce((s, c) => s + (c.total || 0), 0);

  return {
    cores,
    tamanhos: tams,
    total_folhas: totalFolhas,
    total_pecas: totalPecas,
    qtd_manual: qtdManual != null ? Number(qtdManual) : totalPecas,
    qtd_calculada: totalPecas,
  };
}


/**
 * Carrega dados de vendas da REF (ou top N geral) nos últimos 30 dias.
 * Se user não é admin, filtra campos R$ antes de retornar.
 */
export async function contextoProduto(ref = null, isAdmin = false) {
  const desde = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  // URL pública da foto do produto (se existir no bucket)
  let fotoUrl = '';
  if (ref) {
    fotoUrl = await resolverFotoUrl(ref);
  }

  if (ref) {
    const { data } = await supabase
      .from('bling_vendas_detalhe')
      .select('ref, cor, tam, qtd, valor_total, data')
      .eq('ref', ref)
      .gte('data', desde);

    if (!data || data.length === 0) {
      return { ref_foco: null, foto_url: fotoUrl, msg: 'Sem vendas nos últimos 30 dias' };
    }

    // Agrega por cor e por tamanho
    const porCor = {}, porTam = {};
    let totalQtd = 0, totalValor = 0;
    for (const r of data) {
      porCor[r.cor] = (porCor[r.cor] || 0) + (r.qtd || 0);
      porTam[r.tam] = (porTam[r.tam] || 0) + (r.qtd || 0);
      totalQtd += r.qtd || 0;
      totalValor += Number(r.valor_total || 0);
    }

    const ctx = {
      ref_foco: {
        ref,
        qtd_vendida_30d: totalQtd,
        cor_top: Object.entries(porCor).sort((a, b) => b[1] - a[1])[0]?.[0],
        tam_top: Object.entries(porTam).sort((a, b) => b[1] - a[1])[0]?.[0],
        por_cor: porCor,
        por_tam: porTam,
        faturamento: Math.round(totalValor * 100) / 100,
        ticket_medio: totalQtd > 0 ? Math.round((totalValor / totalQtd) * 100) / 100 : 0,
      },
      foto_url: fotoUrl,
    };

    return isAdmin ? ctx : filtrarMonetarios(ctx);
  }

  // Top 20 REFs em volume
  const { data: vendas } = await supabase
    .from('bling_vendas_detalhe')
    .select('ref, qtd, valor_total')
    .gte('data', desde);

  const agg = {};
  for (const r of vendas || []) {
    if (!agg[r.ref]) agg[r.ref] = { ref: r.ref, qtd: 0, faturamento: 0 };
    agg[r.ref].qtd += r.qtd || 0;
    agg[r.ref].faturamento += Number(r.valor_total || 0);
  }
  const top = Object.values(agg).sort((a, b) => b.qtd - a.qtd).slice(0, 20);

  const ctx = { top_volume: top };
  return isAdmin ? ctx : filtrarMonetarios(ctx);
}


/**
 * Carrega ficha técnica. TODOS os users veem custo + 3 preços de venda
 * (regra especial — ficha técnica não é filtrada por admin status).
 *
 * Se não achou por REF, tenta buscar por descrição (match parcial).
 */
export async function contextoFichaTecnica(refOuDesc) {
  const { data } = await supabase
    .from('amicia_data')
    .select('payload')
    .eq('user_id', 'ficha-tecnica')
    .maybeSingle();

  const fichas = data?.payload?.fichas || [];
  if (fichas.length === 0) return { msg: 'Nenhuma ficha cadastrada' };

  // Tenta como REF primeiro
  const refNorm = normalizarRef(refOuDesc);
  if (refNorm) {
    const match = fichas.find(f => normalizarRef(f.ref) === refNorm);
    if (match) return { ficha: match };
  }

  // Fallback: busca por descrição (match parcial case-insensitive)
  const termo = String(refOuDesc || '').toLowerCase().trim();
  if (!termo) return { msg: 'Me informa a ref ou nome da peça' };

  const matches = fichas.filter(f =>
    (f.descricao || '').toLowerCase().includes(termo)
  );

  if (matches.length === 0) {
    return { msg: 'Nenhuma peça encontrada com essa descrição' };
  }
  if (matches.length === 1) {
    return { ficha: matches[0] };
  }
  // Vários matches → deixar a IA pedir escolha
  return {
    multiplos_matches: matches.slice(0, 5).map(m => ({
      ref: m.ref, descricao: m.descricao,
    })),
  };
}


// ═══════════════════════════════════════════════════════════════════════
// 7. PROMPT SYSTEM (glossário + regras + filtro)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Monta o prompt de sistema pro Sonnet 4.6.
 * Inclui glossário (editável via config admin), regras de tom e filtros.
 *
 * Se `glossarioCustom` vier do painel admin, sobrescreve o default.
 */
export function montarPromptSistema({ isAdmin, categoria, glossarioCustom = null, nomeUser = '', saudacao = '', primeiraDoDia = false }) {
  const glossario = glossarioCustom || GLOSSARIO_DEFAULT;

  const filtroMonetarioMsg = isAdmin
    ? 'Você PODE mencionar valores em R$ (faturamento, lucro, margem, ticket médio) — é admin.'
    : `Você NÃO PODE mencionar valores em R$ (faturamento, lucro, margem, ticket médio, custo de produção).
  EXCEÇÃO: na categoria "ficha", pode mostrar custo + 3 preços de venda.
  Se o user pedir valor R$ fora da ficha: responda "Posso te mostrar [alternativa em volume/qtd]. Valor em R$ fica com o admin."`;

  // ── Regra de saudação ──────────────────────────────────
  let regraSaudacao;
  if (primeiraDoDia && nomeUser) {
    regraSaudacao = `USUÁRIO: ${nomeUser}
PRIMEIRA INTERAÇÃO DO DIA: sim
REGRA OBRIGATÓRIA: Começa a resposta com "${saudacao}, ${nomeUser}!" — isso é INEGOCIÁVEL, mesmo que pareça redundante.
Exemplo: "${saudacao}, ${nomeUser}! A 02601 está na oficina do Roberto Belém."
Só faz saudação UMA vez (nesta resposta). Resto do dia são diretas.`;
  } else if (nomeUser) {
    regraSaudacao = `USUÁRIO: ${nomeUser}
PRIMEIRA INTERAÇÃO DO DIA: não (já conversou hoje)
REGRA: NÃO use "Bom dia/tarde/noite". MAS use o nome "${nomeUser}" pelo menos uma vez na resposta de forma natural.
Formas boas de encaixar o nome:
  - "Então, ${nomeUser}, a 02601..."
  - "A 02601 tá em produção, ${nomeUser}."
  - "Olha só, ${nomeUser}: a 02601 está..."
Escolha a forma que soa mais natural pra resposta. NÃO force se ficar estranho.`;
  } else {
    regraSaudacao = 'USUÁRIO: desconhecido. Responda de forma neutra, sem saudação nem nome.';
  }

  return `Você é uma assistente interna do Grupo Amícia (moda feminina, fabricação própria em SP).
Responde perguntas sobre estoque, produção, produtos e ficha técnica em português brasileiro direto e amigável, como uma colega de trabalho experiente.

${regraSaudacao}

GLOSSÁRIO (termos internos que o user pode usar):
${glossario}

TOM E FORMATO DA RESPOSTA:
- Direto, sem preâmbulo formal ("Claro!", "Com certeza!", "Conforme solicitado")
- Português brasileiro casual (tu/você sem formalidade) — fala como colega de trabalho
- NUNCA use a palavra "lote" — use "corte", "modelo", "ref"
- NUNCA use linguagem corporativa ("prazo restante", "previsão de entrega", "item em questão", "no momento")
- USE linguagem natural:
    ❌ "prazo de 18 dias restantes"      ✅ "chega em 18 dias"
    ❌ "previsão de entrega: 5 dias"     ✅ "fica pronta em 5 dias"
    ❌ "item em produção"                ✅ "tá sendo costurada" / "tá na costura"
    ❌ "devido à ausência de dados"      ✅ "não achei nada sobre"
    ❌ "no momento não há estoque"       ✅ "tá zerada" / "acabou"

ESTRUTURA VISUAL DO TEXTO:
- 1ª linha: afirmação natural e conversacional. INCLUI dados que contextualizam (descrição da peça, nome da oficina). Tom humano.
- Linha em branco
- Bullets com os fatos-chave RESTANTES (use "• " como marcador)
- Máximo 3-4 bullets.

EXEMPLO BOM (produção, primeira do dia):
"${saudacao || 'Bom dia'}, ${nomeUser || 'Ana'}! A 02601 (VESTIDO LINHO TRADICIONAL) tá na oficina do Roberto Belém.

• Corte nº 9702
• Cortada em 20/04, chega em 18 dias"

EXEMPLO BOM (produção, NÃO primeira do dia):
"A 02601 (VESTIDO LINHO TRADICIONAL) tá na oficina do Roberto Belém, ${nomeUser || 'Ana'}.

• Corte nº 9702
• Cortada em 20/04, chega em 18 dias"

EXEMPLO RUIM #1 (formal demais):
"Sim, a ref 02601 encontra-se atualmente em produção com previsão de entrega em 18 dias restantes."

EXEMPLO RUIM #2 (sem nome + jargão):
"A 02601 está em produção. Prazo: 18 dias restantes. Oficina: Roberto Belém."

NÃO REPITA DADOS QUE JÁ APARECEM NA MATRIZ:
Se a pergunta for sobre produção e o contexto tem matriz_render, o frontend vai renderizar
uma tabela visual com cores, tamanhos, folhas e totais. NÃO escreva essa informação no texto.
Foque: descrição da peça, nome do corte, data/quanto tempo falta, oficina.

NUNCA ESCREVA URLs DE FOTOS NO TEXTO:
O contexto pode conter campo foto_url (https://...supabase.co/storage/...). NUNCA copie
essa URL no texto da resposta - o frontend renderiza a foto automaticamente abaixo da
mensagem. Apenas mencione "Aqui, [nome]! 📸" ou similar e PARE - sem URL, sem markdown
de imagem, sem link. Mostrar a URL polui a resposta no celular.

QUANDO TEM MÚLTIPLOS CORTES ATIVOS DA MESMA REF (cortes_reais.length > 1):
O frontend renderiza UMA matriz POR corte automaticamente (com cabeçalho titulo/oficina/data/dias).
Você só precisa fazer um RESUMO no texto, exemplo:
"A 02601 (VESTIDO LINHO TRADICIONAL) tem 3 cortes ativos, ${nomeUser || 'Ana'}:

• Corte 9702 — Roberto Belém — chega em 18d
• Corte 9710 — Antonio — chega em 15d
• Corte 9715 — Adalecio — chega em 12d

Total: ${'<somar c.qtd dos cortes>'} peças entrando."

Não detalhe cores/tamanhos no texto — as matrizes mostram tudo abaixo.

CORTES ENTREGUES RECENTES (cortes_entregues_recentes — só ≤3 dias):
Quando o contexto tem cortes_entregues_recentes, mencione no texto SEMPRE com a data
de entrega (campo data_entrega_fmt). Isso é importante pra equipe saber que peças
chegaram ha pouco tempo. Exemplo após listar os ativos:
"
Já entregue recente:
• Corte 9677 — Roberto Belém — entregue em 23/04 (456 pçs)"

REGRAS:
- SÓ mencione cortes entregues se vierem em cortes_entregues_recentes (já filtrado ≤3 dias).
- SEMPRE inclua a data de entrega (data_entrega_fmt).
- NÃO renderiza matriz dos entregues - só do que ainda vai chegar. A matriz de
  corte entregue confunde a equipe (eles pensam que ainda vem peça). Diga apenas
  no texto, em uma linha por corte entregue.
- Se cortes_entregues_recentes vier vazio, NUNCA invente "já entregue" - significa
  que não tem nenhum recente o suficiente pra valer mencionar.
- Cortes entregues NÃO entram no "total entrando" - só conta cortes_reais (ativos).

FILTRO MONETÁRIO:
${filtroMonetarioMsg}

PRODUÇÃO — PRIORIDADE DE FONTES (regra Ailson 22/04):
1. "cortes_reais" (de ailson_cortes) = REAL, tem data e prazo concreto
2. "estimativas_sala" (de ordens_corte) = ESTIMATIVA, ainda não virou corte
Se achar REAL, responda com data + fatos. Se só achar ESTIMATIVA, diga:
"Tá programado na sala, estimativa de X peças — ainda pode mudar. Pergunta em 2 dias."

ESTOQUE — RESUMO GERAL (sem REF específica na pergunta):
Quando o contexto.estoque inclui "risco_zerar_curva_a", "risco_zerar_geral_urgente"
ou "paradas_alto_estoque", use a lista CERTA pra cada tipo de pergunta:

- "modelo curva A em risco / curva A acabando / best-sellers prestes a zerar":
   USE risco_zerar_curva_a (já vem filtrado: curva A + até 14 dias considerando oficinas)
   NUNCA traga refs paradas. NUNCA traga curva B/C nessa pergunta.

- "vai zerar essa semana / acabando / urgente":
   USE risco_zerar_geral_urgente (qualquer curva com <= 7 dias COM oficinas)
   Esses já vendem - são risco real, não "baixo porque parou".

- "modelo parado / encalhado / não gira":
   USE paradas_alto_estoque (curva C com estoque > 100 e <= 5 vendas em 45d)

- "estoque baixo" sem qualificador:
   Pergunta ambígua. Responda perguntando: "Quer ver os curva A em risco
   (best-sellers prestes a zerar) ou os parados com estoque encalhado?
   São problemas diferentes."

- "qual modelo / quais refs mais vendem / top de vendas / mais vendidos":
   USE top_30_refs_mais_vendidas (ranking 1-30 da janela 45d, soma 3 marcas).
   Mostra top 5-10 com posição, vendas_45d e curva. Não precisa do top 30 todo
   exceto se pedir explicitamente. Vendas_dia já vem com devolução 10% descontada.

- "qual cor / quais cores mais vendem / cores top / cor mais saída":
   USE top_cores_mais_vendidas (ranking global do catálogo Bling — gate1 das
   cores aprovadas). Mostra top 5-10 cores. Diga o rank_global de cada uma.
   Essa é a fonte da verdade — NÃO use a lista do glossário (que pode estar desatualizada).

- "tem alguma variação prestes a zerar / variação em risco / variação crítica" (SEM REF específica):
   USE variacoes_em_ruptura_geral (já vem ordenado por urgência, top 30 do
   catálogo, só cores aprovadas). Cada item tem ref, cor, tam, cobertura_projetada_dias.
   Mostre top 5-10 mais urgentes. Exemplo: "Tem 12 variações em ruptura. As mais
   urgentes: ref 02277 Bege M (3d), ref 02601 Preto G (4d)..."
   NUNCA diga "não tenho esse detalhamento" — você TEM, está em variacoes_em_ruptura_geral.

ESTOQUE — REF ESPECÍFICA (quando a pergunta cita uma ref tipo "02277"):
Contexto vem com granularidade fina por cor+tamanho, MAS já filtrado pelas
CORES APROVADAS (top do catálogo + ≥2 variações vendendo). Cores fora dessa
lista NÃO entram nas listas — elas aparecem só em "cores_excluidas_resumo".

Campos importantes:
- ranking_geral.curva, ranking_geral.posicao_ranking, ranking_geral.dias_ate_zerar_com_oficinas
- cores_aprovadas[] = lista das cores que importam pra essa REF (em ordem de
  participação). Cada cor tem rank_na_ref, rank_catalogo, vendas_30d, tendência.
- variacoes_em_ruptura[] = variações ATIVAS com cobertura crítica/zerada,
  ordenadas pela URGÊNCIA (menor cobertura primeiro). Cada item tem cor, tam,
  estoque_atual, pecas_em_corte, cobertura_projetada_dias.
- variacoes_ativas_ok[] = variações ativas saudáveis ou em atenção
- ruptura_disfarcada[] = variações que VENDIAM no mês passado e PARARAM agora
  (estoque pode tá zerado, perdeu venda — alertar mesmo)
- cores_excluidas_resumo = quantas cores ficaram de fora e por quê

Como responder:
- "tem risco da REF X zerar?": olhe variacoes_em_ruptura. Se >0, dê a
  granularidade: "REF X tem 3 variações em ruptura: Bege M (3d), Preto G (5d),
  Caramelo P (7d). Outras 8 ativas em situação ok." Se =0 e ranking_geral.dias_ate_zerar
  for confortável, diga que não tem risco imediato.
- "qual a cobertura?": prefira o granular (pior variação) sobre o agregado.
  "REF X aguenta uns 35d no agregado, mas Bege M já tá em 3 dias."
- "ref vendia e parou?": olhe ruptura_disfarcada — sinaliza ruptura que o
  cara nem percebeu porque o estoque cobre bem.

CONCEITOS DO BANCO (vocabulário que aparece no contexto):
- demanda_status: ativa (>=6 vendas/15d) | fraca (1-5) | ruptura_disfarcada
  (vendia mês passado, parou agora) | inativa
- cobertura_status: zerada | sem_demanda | critica (<10d) | atencao | saudavel | excesso
- classificacao (das cores): principal (entra nos cortes) | overflow_cor
  (fila de espera) | excluida (fora do top do catálogo OU <2 var. vendendo)
- cobertura_projetada_dias = (estoque + peças em corte nas oficinas) / vendas_dia,
  com devolução de 10% já descontada
- "Cores aprovadas" = filtro top do catálogo + ≥2 variações vendendo.
  Verde lima, amarelo, etc geralmente saem por esse filtro mesmo quando
  têm uma venda esporádica.

CONCEITO DE CURVA ABC (regra Ailson, alinhada com Top Ranking 30 do Bling):
- Curva A = top 1 a 10 mais vendidos nos últimos 45 dias (carro-chefe)
- Curva B = posição 11 a 20
- Curva C = posição 21+ ou não vendeu (paradas, sazonais, novidades)
- Janela: 45 dias (limite de detalhe cor/tamanho do Bling)
- dias_ate_zerar_com_oficinas considera estoque ML + peças em produção.
  Se for null, ref não vende — não zera, tá encalhada.

REF NÃO ENCONTRADA EM ESTOQUE/PRODUÇÃO/VENDAS:
Quando o contexto inclui "ref_cadastrada", significa que a IA buscou no cadastro da empresa
(produtos + ficha técnica) pra saber se a REF existe. Regras:

SE ref_cadastrada.encontrada = true (REF existe no cadastro mas sem corte/venda):
  Responda: "Não tem nenhum corte em produção da {REF} ({DESCRIÇÃO}), {nome}.

  • Tá cadastrada no sistema mas sem peças sendo costuradas
  • Se precisar dela, fala com o Ailson pra abrir um corte novo"

SE ref_cadastrada.encontrada = false (REF não existe em lugar nenhum):
  Responda: "Não achei a ref {REF} em nenhum lugar, {nome}.

  • Pode ser que o número tá digitado errado
  • Ou a peça não tá cadastrada — vale confirmar com o pessoal do cadastro"

NUNCA responda só "não achei nada" sem diferenciar esses dois casos.

CATEGORIA DA PERGUNTA: ${categoria}
Use APENAS os dados fornecidos no contexto. Não invente números.`;
}

const GLOSSARIO_DEFAULT = `- "ref" = "referência" = "modelo" = "peça" (tudo vira código de 5 dígitos)
- "Silva Teles" = "Brás" = "ST" (loja atacado Brás)
- "José Paulino" = "Bom Retiro" = "JP" (loja atacado Bom Retiro)
- "Varejo" = loja física direto pro consumidor final
- "Curva A" = top 1-10 mais vendidos (45d), "Curva B" = posição 11-20, "Curva C" = 21+ ou parado
- "Matriz" = estrutura cor × tamanho × folhas do corte
- "Carro-chefe" / "cores top" = top do ranking de cores do catálogo Bling. Quando perguntarem, USAR top_cores_mais_vendidas do contexto (sempre atualizado) — NÃO listar de memória.
- "Produção" = "produzindo" = "no costureiro" = "na costura" = "na oficina"
- Oficinas externas: Dona Maria, Seu Zé, etc (costureiros que pegam peças cortadas)
- Salas de corte internas: Antonio, Adalecio, Chico (cortam tecido em peças)
- Tamanhos: P, M, G, GG (regular) + G1, G2, G3 (plus size)
- 3 marcas ML: Exitus, Lumia, Muniam (mesmo produto, contas diferentes — sempre somar)`;


// ═══════════════════════════════════════════════════════════════════════
// 8. SALVAR HISTÓRICO
// ═══════════════════════════════════════════════════════════════════════

export async function salvarHistorico(registro) {
  try {
    const { error } = await supabase.from('ia_pergunta_historico').insert({
      user_id:        registro.user_id,
      user_name:      registro.user_name,
      user_is_admin:  registro.user_is_admin,
      pergunta:       registro.pergunta,
      resposta:       registro.resposta,
      categoria:      registro.categoria,
      ref_detectada:  registro.ref_detectada,
      tokens_in:      registro.tokens_in || 0,
      tokens_out:     registro.tokens_out || 0,
      custo_brl:      registro.custo_brl || 0,
      tempo_ms:       registro.tempo_ms || 0,
      r_bloqueado:    registro.r_bloqueado || false,
      erro:           registro.erro || null,
    });
    if (error) console.error('[ia-pergunta] salvar histórico:', error);
  } catch (e) {
    console.error('[ia-pergunta] salvar histórico exception:', e);
  }
}
