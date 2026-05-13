/**
 * site-amicia-drive-importar.js — Importação automática do Drive
 *
 * POST (com auth de cron OU admin)
 *
 * Fluxo:
 *   1. Encontra subpasta "Site Amicia" dentro de GOOGLE_DRIVE_FOLDER_ID
 *      (= pasta principal lojas_app)
 *   2. Lista arquivos da subpasta
 *   3. Identifica arquivos clientes_X e carrinhos_X por prefixo
 *      (case insensitive, separadores e data flexíveis)
 *   4. Pareia clientes ↔ carrinhos pela tag (resto do nome após prefixo,
 *      normalizado: só dígitos)
 *   5. Pra cada par/solo NOVO (md5 não está em site_amicia_importacoes):
 *      a. Baixa CSVs do Drive
 *      b. Chama POST /api/lojas-leads-importar com X-User=amicia-admin
 *      c. Registra resultado em site_amicia_importacoes
 *
 * Tolerante a falhas: erro num par não impede outros pares de processarem.
 *
 * Auth:
 *   - Cron Vercel (user-agent vercel-cron)
 *   - Admin global via X-User
 *   - ?force=1 (DEBUG only, qualquer admin)
 *
 * Sessão Ailson 12/05/2026 — Onda 5 (Cron Drive).
 */
import {
  listarArquivosDrive, baixarArquivoDrive, getGoogleAccessToken,
} from './_lojas-drive-helpers.js';
import { supabase, validarUsuario, setCors } from './_lojas-helpers.js';

const NOME_SUBPASTA = 'Site Amicia';  // pasta dentro de lojas_app

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Encontra subpasta por nome (case insensitive) dentro de uma pasta pai.
 * Retorna { id, name } ou null se não achar.
 */
async function encontrarSubpasta(folderIdPai, nomeAlvo) {
  const token = await getGoogleAccessToken();
  const q = `'${folderIdPai}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=200`;

  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`Drive list pastas falhou (${r.status}): ${t}`);
  }
  const data = await r.json();
  const alvoNorm = nomeAlvo.toLowerCase().replace(/\s+/g, ' ').trim();
  const match = (data.files || []).find(f =>
    f.name.toLowerCase().replace(/\s+/g, ' ').trim() === alvoNorm
  );
  return match || null;
}

/**
 * Identifica tipo do arquivo pelo nome.
 * Retorna 'clientes' | 'carrinhos' | null
 */
function identificarTipo(nomeArquivo) {
  const nome = nomeArquivo.toLowerCase().trim();
  if (nome.startsWith('clientes')) return 'clientes';
  if (nome.startsWith('carrinhos')) return 'carrinhos';
  return null;
}

/**
 * Extrai "tag" do nome — tudo que vem depois do prefixo, normalizado.
 * Usada pra parear clientes_X com carrinhos_X.
 *
 * Exemplos:
 *   "Clientes-12-05-2026.csv"       → "12052026"
 *   "carrinhos_12-05-26.csv"        → "120526"
 *   "Carrinhos 12_05_2026.csv"      → "12052026"
 *   "Clientes12052026.csv"          → "12052026"
 *   "clientes.csv"                  → ""  (solo, sem tag)
 *
 * Pareia "12052026" com "12052026" (mesma data exportada em formatos diferentes).
 * NÃO pareia "120526" com "12052026" — preciso confirmar com Ailson se quero
 * mais flexibilidade (ex: aceitar prefix match).
 */
function extrairTag(nomeArquivo) {
  let s = nomeArquivo.toLowerCase().trim();
  // Remove extensão
  s = s.replace(/\.(csv|xlsx?)$/i, '');
  // Remove prefixo
  s = s.replace(/^(clientes|carrinhos)/i, '');
  // Remove separadores e espaços, mantém só alfanum
  return s.replace(/[\s\-_\.]/g, '');
}

/**
 * Pareia clientes ↔ carrinhos pela tag. Retorna array de:
 *   { tag, clientes: file | null, carrinhos: file | null }
 */
function parearArquivos(arquivos) {
  const pares = new Map();  // tag → { clientes, carrinhos }
  
  for (const f of arquivos) {
    const tipo = identificarTipo(f.name);
    if (!tipo) continue;
    
    const tag = extrairTag(f.name);
    if (!pares.has(tag)) pares.set(tag, { tag, clientes: null, carrinhos: null });
    pares.get(tag)[tipo] = f;
  }
  
  return Array.from(pares.values());
}

/**
 * Processa um par (ou solo clientes) — baixa CSVs e chama o importer.
 */
async function processarPar(par, baseUrl, fonte = 'cron') {
  const { tag, clientes, carrinhos } = par;
  
  if (!clientes) {
    // Carrinhos sem clientes — não importa (precisa de leads como base)
    return {
      tag, skip: true, motivo: 'sem_arquivo_clientes',
    };
  }
  
  // Check dedup: já importou esse md5?
  const { data: existing } = await supabase
    .from('site_amicia_importacoes')
    .select('id, concluido_em, stats')
    .eq('file_md5_clientes', clientes.md5Checksum)
    .eq('file_md5_carrinhos', carrinhos?.md5Checksum || '')
    .maybeSingle();
  
  if (existing) {
    return {
      tag, skip: true, motivo: 'ja_importado',
      existing_id: existing.id,
      stats_anterior: existing.stats,
    };
  }
  
  // Registra início (idempotente — se falhar no meio, fica com erro setado)
  const { data: registro, error: errInsert } = await supabase
    .from('site_amicia_importacoes')
    .insert({
      tag,
      file_id_clientes: clientes.id,
      file_md5_clientes: clientes.md5Checksum,
      file_nome_clientes: clientes.name,
      file_id_carrinhos: carrinhos?.id || null,
      file_md5_carrinhos: carrinhos?.md5Checksum || null,
      file_nome_carrinhos: carrinhos?.name || null,
      fonte,
    })
    .select('id')
    .single();
  
  if (errInsert) {
    // Provavelmente conflict — outro processo já registrou. Pula.
    if (errInsert.code === '23505') {
      return { tag, skip: true, motivo: 'race_condition_dedup' };
    }
    throw errInsert;
  }
  
  try {
    // Baixa os CSVs (text)
    const clientesCsv = await baixarArquivoDrive(clientes.id);
    const carrinhosCsv = carrinhos ? await baixarArquivoDrive(carrinhos.id) : null;
    
    // Chama o importer interno (X-User admin pra passar pela auth)
    const r = await fetch(`${baseUrl}/api/lojas-leads-importar`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-User': 'amicia-admin',
      },
      body: JSON.stringify({
        clientes_csv: clientesCsv,
        carrinhos_csv: carrinhosCsv,
        planilha_origem: `drive:${clientes.name}` + (carrinhos ? `+${carrinhos.name}` : ''),
      }),
    });
    
    const json = await r.json();
    
    if (!r.ok || !json.ok) {
      const erroMsg = json.error || `HTTP ${r.status}`;
      // Marca como erro
      await supabase
        .from('site_amicia_importacoes')
        .update({ erro: erroMsg, concluido_em: new Date().toISOString() })
        .eq('id', registro.id);
      return { tag, ok: false, erro: erroMsg };
    }
    
    // Sucesso — atualiza com stats
    await supabase
      .from('site_amicia_importacoes')
      .update({
        stats: json.stats || {},
        concluido_em: new Date().toISOString(),
      })
      .eq('id', registro.id);
    
    return {
      tag, ok: true,
      clientes_processados: json.stats?.clientes_processados || 0,
      carrinhos_inseridos: json.stats?.carrinhos_inseridos || 0,
      stats: json.stats,
    };
  } catch (e) {
    // Marca erro e propaga (mas não trava outros pares)
    await supabase
      .from('site_amicia_importacoes')
      .update({ erro: e.message, concluido_em: new Date().toISOString() })
      .eq('id', registro.id);
    return { tag, ok: false, erro: e.message };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════
export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  
  // Auth: cron Vercel, admin via X-User, ou ?force=1 com admin
  const userAgent = req.headers['user-agent'] || '';
  const ehCron = userAgent.startsWith('vercel-cron') || !!req.headers['x-vercel-cron'];
  
  let fonte = 'cron';
  
  if (!ehCron) {
    const auth = await validarUsuario(req);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
    if (!auth.isAdmin) return res.status(403).json({ error: 'Apenas admin pode disparar' });
    fonte = 'manual';
  }
  
  const tInicio = Date.now();
  const baseUrl = `https://${req.headers.host}`;
  
  try {
    // 1. Validar env
    const folderRaiz = process.env.GOOGLE_DRIVE_FOLDER_ID;
    if (!folderRaiz) {
      return res.status(500).json({ error: 'GOOGLE_DRIVE_FOLDER_ID não configurado' });
    }
    
    // 2. Encontrar subpasta "Site Amicia"
    const subpasta = await encontrarSubpasta(folderRaiz, NOME_SUBPASTA);
    if (!subpasta) {
      return res.status(404).json({
        error: `Subpasta "${NOME_SUBPASTA}" não encontrada em lojas_app no Drive`,
        dica: 'Crie a pasta exatamente com esse nome dentro de lojas_app',
      });
    }
    
    // 3. Listar arquivos da subpasta (sem descer mais — arquivos planos)
    const arquivos = await listarArquivosDrive(subpasta.id, {
      maxDepth: 1, includeSubfolders: false,
    });
    
    // 4. Filtrar só CSVs e identificar tipo
    const candidatos = arquivos.filter(f => {
      if (!identificarTipo(f.name)) return false;
      // Exige md5 (não vai funcionar pra Google Sheets)
      if (!f.md5Checksum) return false;
      return true;
    });
    
    // 5. Parear
    const pares = parearArquivos(candidatos);
    
    // 6. Processar cada par
    const resultados = [];
    for (const par of pares) {
      try {
        const r = await processarPar(par, baseUrl, fonte);
        resultados.push(r);
      } catch (e) {
        resultados.push({ tag: par.tag, ok: false, erro: e.message });
      }
    }
    
    // 7. Resumo
    const novos = resultados.filter(r => r.ok);
    const skipped = resultados.filter(r => r.skip);
    const erros = resultados.filter(r => !r.ok && !r.skip);
    
    return res.json({
      ok: true,
      fonte,
      duracao_ms: Date.now() - tInicio,
      subpasta: subpasta.name,
      pares_totais: pares.length,
      pares_processados: novos.length,
      pares_skipped: skipped.length,
      pares_com_erro: erros.length,
      detalhes: resultados,
    });
  } catch (e) {
    console.error('[site-amicia-drive-importar] erro:', e);
    return res.status(500).json({
      error: e.message || 'Erro interno',
      duracao_ms: Date.now() - tInicio,
    });
  }
}
