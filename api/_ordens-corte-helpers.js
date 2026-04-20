// api/_ordens-corte-helpers.js — Funções compartilhadas dos endpoints de ordens de corte
// Prefixo _ = Vercel não expõe como endpoint público
import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ── CORS padrão ──
export function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-User');
}

// ── Lê o usuário do request (header X-User ou body) ──
// Front pode mandar via header ou no body (criada_por, separado_por, etc)
export function getUserFromReq(req) {
  return (req.headers['x-user'] || req.body?.usuario || req.body?.criada_por || req.body?.separado_por || '').toString().trim() || null;
}

// ── Valida grade JSONB: { "P": 1, "G": 1, "GG": 2 } ──
export function validateGrade(grade) {
  if (!grade || typeof grade !== 'object' || Array.isArray(grade)) return 'grade deve ser objeto { tamanho: módulos }';
  const keys = Object.keys(grade);
  if (keys.length === 0) return 'grade vazia: precisa de pelo menos 1 tamanho';
  for (const k of keys) {
    const v = grade[k];
    if (!Number.isInteger(v) || v < 1 || v > 99) return `grade["${k}"] deve ser inteiro entre 1 e 99`;
  }
  return null;
}

// ── Valida cores JSONB: [{nome, rolos, hex?}, ...] ──
export function validateCores(cores) {
  if (!Array.isArray(cores) || cores.length === 0) return 'cores deve ser array com pelo menos 1 cor';
  for (let i = 0; i < cores.length; i++) {
    const c = cores[i];
    if (!c || typeof c !== 'object') return `cores[${i}] inválida`;
    if (!c.nome || typeof c.nome !== 'string') return `cores[${i}].nome obrigatório`;
    if (!Number.isInteger(c.rolos) || c.rolos < 1) return `cores[${i}].rolos deve ser inteiro ≥ 1`;
  }
  return null;
}

// ── Calcula total_rolos a partir do array de cores ──
export function calcTotalRolos(cores) {
  return (cores || []).reduce((sum, c) => sum + (Number(c.rolos) || 0), 0);
}

// ── Busca produto no payload ailson_cortes por ref ──
// Retorna { ref, descricao, marca, tecido } ou null
export async function buscarProdutoPorRef(ref) {
  if (!ref) return null;
  const refStr = String(ref).trim();
  const { data, error } = await supabase
    .from('amicia_data')
    .select('payload')
    .eq('user_id', 'ailson_cortes')
    .maybeSingle();
  if (error) {
    console.error('buscarProdutoPorRef erro:', error);
    return null;
  }
  const produtos = data?.payload?.produtos || [];
  // Match exato primeiro, depois normalizado (sem zeros à esquerda)
  let p = produtos.find(x => String(x.ref).trim() === refStr);
  if (!p) {
    const normR = (r) => String(r).replace(/^0+/, '');
    p = produtos.find(x => normR(x.ref) === normR(refStr));
  }
  return p || null;
}

// ── Insere registro em ordens_corte_historico ──
export async function insertHistorico({ ordem_id, acao, payload_antes, payload_depois, motivo, user_id }) {
  try {
    await supabase.from('ordens_corte_historico').insert({
      ordem_id,
      acao,
      payload_antes: payload_antes || null,
      payload_depois: payload_depois || null,
      motivo: motivo || null,
      user_id: user_id || 'desconhecido',
    });
  } catch (e) {
    // Histórico não bloqueia a operação principal
    console.error('insertHistorico falhou (não-fatal):', e?.message || e);
  }
}

// ── Cria corte no payload salas-corte (lê → merge → escreve) ──
// Usado pelo endpoint /api/ordens-corte-status quando ordem vai pra na_sala
// Retorna { ok: true, corte_id } ou { ok: false, error }
export async function criarCorteEmSalasCorte({ ordem }) {
  try {
    // 1. Lê payload atual
    const { data: row, error: errLoad } = await supabase
      .from('amicia_data')
      .select('payload')
      .eq('user_id', 'salas-corte')
      .maybeSingle();
    if (errLoad) return { ok: false, error: 'falha ao ler salas-corte: ' + errLoad.message };

    const remote = row?.payload || {};
    const cortesAtuais = remote.cortes || [];
    const salasAtuais = remote.salas || ['Antonio', 'Adalecio', 'Chico'];
    const logsAtuais = remote.logs || [];

    // 2. Cria objeto corte seguindo estrutura existente do módulo Salas de Corte
    //    (App.tsx ~5508: id=Date.now, data=hoje, sala, ref, qtdRolos, etc)
    const corteId = Date.now();
    const hoje = new Date().toISOString().slice(0, 10);
    const novoCorte = {
      id: corteId,
      data: hoje,
      sala: ordem.sala,
      ref: ordem.ref,
      descricao: ordem.descricao || '',
      marca: ordem.marca || '',
      qtdRolos: Number(ordem.total_rolos) || 0,
      qtdPecas: null,
      rendimento: null,
      status: 'pendente',
      alerta: false,
      visto: true,
      ordemId: ordem.id, // ⟵ vínculo NOVO com a ordem (compatível com cortes antigos sem esse campo)
    };

    // 3. Append log automático (mesmo padrão do addLog em App.tsx:5432)
    const novoLog = {
      id: corteId + 1, // garante id único próximo
      data: new Date().toISOString(),
      usuario: ordem.separado_por || ordem.criada_por || 'sistema',
      acao: 'criar_via_ordem',
      detalhe: `REF ${ordem.ref} · ${ordem.sala} · ${ordem.total_rolos}r (ordem ${ordem.id.slice(0, 8)})`,
    };

    // 4. Salva payload atualizado
    const novoPayload = {
      cortes: [...cortesAtuais, novoCorte],
      salas: salasAtuais,
      logs: [novoLog, ...logsAtuais].slice(0, 200),
    };

    const { error: errSave } = await supabase
      .from('amicia_data')
      .upsert({ user_id: 'salas-corte', payload: novoPayload }, { onConflict: 'user_id' });
    if (errSave) return { ok: false, error: 'falha ao salvar salas-corte: ' + errSave.message };

    return { ok: true, corte_id: corteId };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

// ── Parse seguro de body (quando vem stringificado) ──
export function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body); } catch { return {}; }
}
