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

  const limite = Number(cfg?.payload?.config?.rate_limit_users ?? 15);

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
      'cortando', 'corte da', 'corte de', 'cortado', 'matriz', 'folhas',
      'entrega', 'prazo', 'chega', 'devolv', 'pronta', 'atrasad', 'lote',
    ],
    estoque: [
      'estoque', 'ruptura', 'zerad', 'acabando', 'acabou', 'vai acabar',
      'cobertura', 'dias de', 'variação', 'variacao', 'sku', 'disponível',
      'disponivel', 'risco de zerar', 'faltando', 'sem cor', 'carro-chefe',
      'curva a', 'curva b', 'curva c',
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
export async function buscarRefNoCadastro(ref) {
  if (!ref) return { encontrada: false };

  // Tenta gerar URL pública da foto - bucket 'produtos', arquivo {REF}.jpg.
  // Não checa se existe pra evitar 1 request a mais; se foto não existir,
  // o <img onError> no frontend cuida do fallback.
  let fotoUrl = '';
  try {
    const { data: pub } = supabase.storage.from('produtos').getPublicUrl(`${ref}.jpg`);
    fotoUrl = pub?.publicUrl || '';
  } catch (e) { /* sem foto, ok */ }

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
export async function contextoEstoque(ref = null) {
  if (ref) {
    const { data } = await supabase
      .from('ml_estoque_ref_atual')
      .select('ref, qtd_total, sem_dados, variations, updated_at')
      .eq('ref', ref)
      .maybeSingle();

    if (data) return { ref_foco: data };

    // REF não tem dados ML — checa cadastro pra diferenciar "não existe" de "existe mas zero no ML"
    const cad = await buscarRefNoCadastro(ref);
    return {
      ref_foco: null,
      ref_cadastrada: cad,
      msg: cad.encontrada
        ? 'REF cadastrada mas sem dados ML (pode estar zerada ou só ainda não sincronizou)'
        : 'REF não encontrada em nenhum cadastro',
    };
  }

  // Resumo geral: top ruptura + saudaveis
  const { data: ruptura } = await supabase
    .from('ml_estoque_ref_atual')
    .select('ref, qtd_total')
    .lt('qtd_total', 30)
    .order('qtd_total', { ascending: true })
    .limit(20);

  return {
    ruptura_top: ruptura || [],
    observacao: 'Refs com qtd_total < 30 peças (cobertura crítica)',
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
  if (!detalhes || !Array.isArray(detalhes.cores) || !Array.isArray(detalhes.tamanhos)) {
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
    try {
      const { data: pub } = supabase.storage.from('produtos').getPublicUrl(`${ref}.jpg`);
      fotoUrl = pub?.publicUrl || '';
    } catch (e) { /* sem foto, ok */ }
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

FILTRO MONETÁRIO:
${filtroMonetarioMsg}

PRODUÇÃO — PRIORIDADE DE FONTES (regra Ailson 22/04):
1. "cortes_reais" (de ailson_cortes) = REAL, tem data e prazo concreto
2. "estimativas_sala" (de ordens_corte) = ESTIMATIVA, ainda não virou corte
Se achar REAL, responda com data + fatos. Se só achar ESTIMATIVA, diga:
"Tá programado na sala, estimativa de X peças — ainda pode mudar. Pergunta em 2 dias."

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
- "Curva A" = bestseller (≥300 peças/ciclo), "Curva B" = ≥200, "Curva C" = resto
- "Matriz" = estrutura cor × tamanho × folhas do corte
- "Carro-chefe" = top 10 cores mais vendidas no Bling (Preto, Bege, Marrom, Figo, Azul Marinho, Caramelo, Verde Militar, Marrom Escuro, Nude, Azul Serenity)
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
