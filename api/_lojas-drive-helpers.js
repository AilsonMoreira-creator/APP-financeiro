/**
 * _lojas-drive-helpers.js — Helpers da importação Drive do módulo Lojas (Parte 5).
 *
 * Responsabilidades:
 *   - Token OAuth do Google (refresh → access)
 *   - Listar arquivos da pasta do Drive
 *   - Baixar conteúdo de CSV / PDF
 *   - Parser de CSV (TAB-separated, formato Miré/Futura)
 *   - Parser de números/datas no formato BR
 *   - Roteador: detectar tipo de arquivo pelo nome
 *
 * Padrão técnico:
 *   - fetch direto (sem googleapis SDK — pesado e não é necessário)
 *   - Suporta UTF-8 e ISO-8859-1 (alguns sistemas legados exportam ISO)
 *   - Decimal BR ("1.927,00") + Data BR ("dd/mm/aaaa")
 *
 * Variáveis de ambiente esperadas (já configuradas no Vercel):
 *   - GOOGLE_CLIENT_ID
 *   - GOOGLE_CLIENT_SECRET
 *   - GOOGLE_REFRESH_TOKEN
 *   - GOOGLE_DRIVE_FOLDER_ID
 */

// ═══════════════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════════════

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_DRIVE_API = 'https://www.googleapis.com/drive/v3';

// Cache em memória do access_token (válido por 1h, mas re-pegamos sempre que
// a Edge Function "acorda" porque cada invocação pode ser num container novo)
let _tokenCache = { value: null, expiresAt: 0 };

// ═══════════════════════════════════════════════════════════════════════════
// AUTENTICAÇÃO GOOGLE OAUTH (refresh → access token)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Obtém access_token novo via refresh_token.
 * Cacheia em memória pelo TTL informado pelo Google (-60s de margem).
 */
export async function getGoogleAccessToken() {
  const now = Date.now();
  if (_tokenCache.value && _tokenCache.expiresAt > now + 60_000) {
    return _tokenCache.value;
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET ou GOOGLE_REFRESH_TOKEN não configurados no Vercel');
  }

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });

  const r = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!r.ok) {
    const err = await r.text().catch(() => '');
    throw new Error(`Google OAuth refresh falhou (${r.status}): ${err}`);
  }

  const data = await r.json();
  if (!data.access_token) {
    throw new Error(`Resposta OAuth sem access_token: ${JSON.stringify(data)}`);
  }

  // expires_in é em segundos
  _tokenCache = {
    value: data.access_token,
    expiresAt: now + (data.expires_in || 3600) * 1000,
  };

  return data.access_token;
}

// ═══════════════════════════════════════════════════════════════════════════
// LISTAR ARQUIVOS DA PASTA
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Lista arquivos de uma pasta do Drive (recursivamente em 1 nível: pega arquivos
 * direto na pasta + arquivos nas sub-pastas dela).
 *
 * Retorna array de { id, name, mimeType, parents, modifiedTime, parentName }.
 *
 * @param {string} folderId - ID da pasta raiz
 * @param {object} opts - { includeSubfolders: bool } (default true)
 */
export async function listarArquivosDrive(folderId, opts = {}) {
  const { includeSubfolders = true } = opts;
  const token = await getGoogleAccessToken();

  // 1) Lista arquivos direto na pasta raiz
  const arquivosRaiz = await _listarConteudoPasta(folderId, token);
  let resultado = arquivosRaiz.filter(f => !f.isFolder).map(f => ({
    ...f, parentName: 'raiz',
  }));

  if (!includeSubfolders) return resultado;

  // 2) Pra cada subpasta, lista o conteúdo dela também
  const subpastas = arquivosRaiz.filter(f => f.isFolder);
  for (const sp of subpastas) {
    const filhos = await _listarConteudoPasta(sp.id, token);
    const arquivos = filhos
      .filter(f => !f.isFolder)
      .map(f => ({ ...f, parentName: sp.name }));
    resultado = resultado.concat(arquivos);
  }

  return resultado;
}

async function _listarConteudoPasta(folderId, token) {
  const fields = 'files(id,name,mimeType,parents,modifiedTime)';
  // Drive query: parents in folderId AND not trashed
  const q = `'${folderId}' in parents and trashed = false`;
  const url = `${GOOGLE_DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent(fields)}&pageSize=1000`;

  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!r.ok) {
    const err = await r.text().catch(() => '');
    throw new Error(`Drive list falhou (${r.status}) pra pasta ${folderId}: ${err}`);
  }

  const data = await r.json();
  const files = data.files || [];

  return files.map(f => ({
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    modifiedTime: f.modifiedTime,
    isFolder: f.mimeType === 'application/vnd.google-apps.folder',
  }));
}

// ═══════════════════════════════════════════════════════════════════════════
// BAIXAR ARQUIVO
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Baixa o conteúdo de um arquivo do Drive.
 * Pra CSV/TXT retorna string. Pra PDF retorna Buffer (Uint8Array).
 *
 * @param {string} fileId
 * @param {object} opts - { encoding: 'utf-8' | 'binary' }
 */
export async function baixarArquivoDrive(fileId, opts = {}) {
  const { encoding = 'utf-8' } = opts;
  const token = await getGoogleAccessToken();
  const url = `${GOOGLE_DRIVE_API}/files/${fileId}?alt=media`;

  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!r.ok) {
    const err = await r.text().catch(() => '');
    throw new Error(`Drive download falhou (${r.status}) pra arquivo ${fileId}: ${err}`);
  }

  if (encoding === 'binary') {
    const ab = await r.arrayBuffer();
    return new Uint8Array(ab);
  }

  // Texto: tenta UTF-8, mas se vier ISO-8859-1 (sistemas BR antigos),
  // detecta e converte
  const ab = await r.arrayBuffer();
  return _decodificarTexto(ab);
}

/**
 * Decodifica buffer de texto detectando encoding.
 * Tenta UTF-8 primeiro; se vir caracteres "?" ou "Ã" repetidos, fallback ISO-8859-1.
 */
function _decodificarTexto(arrayBuffer) {
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(arrayBuffer);
  // Heurística: se vê "Ã" suspeito (mojibake típico de UTF-8 lido como ISO),
  // ainda é UTF-8 ok. Se vê "?" no lugar de acentos, é ISO sendo lido como UTF-8 falho.
  // Aqui simplificamos: tenta fatal=true, se falhar usa ISO.
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(arrayBuffer);
  } catch {
    return new TextDecoder('iso-8859-1').decode(arrayBuffer);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PARSERS DE FORMATO BR
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Parseia número no formato BR: "1.927,00" → 1927.00
 * Aceita também formato simples "1927.00" ou "1927".
 * Retorna null pra entradas inválidas.
 */
export function parseNumeroBR(valor) {
  if (valor === null || valor === undefined) return null;
  const s = String(valor).trim();
  if (!s) return null;

  // Detecta formato: tem vírgula como decimal?
  const temVirgula = s.includes(',');
  const temPonto = s.includes('.');

  let normalizado = s;
  if (temVirgula && temPonto) {
    // formato BR: "1.927,00" → "1927.00"
    normalizado = s.replace(/\./g, '').replace(',', '.');
  } else if (temVirgula) {
    // só vírgula: "1927,00" ou "0,5" → "1927.00"
    normalizado = s.replace(',', '.');
  }
  // só ponto: pode ser "1927.00" (já decimal) ou "1.927" (milhar BR)
  // Caso ambíguo "1.927": se vier 3 dígitos depois do ponto, é milhar
  else if (temPonto && /^\d{1,3}\.\d{3}$/.test(s)) {
    normalizado = s.replace('.', '');
  }

  const n = Number(normalizado);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parseia data BR "dd/mm/aaaa" → "yyyy-mm-dd" (formato ISO pra Postgres).
 * Aceita também "dd/mm/aa" (assume 20aa).
 * Retorna null pra inválidos.
 */
export function parseDataBR(valor) {
  if (!valor) return null;
  const s = String(valor).trim();
  if (!s) return null;

  // Formato dd/mm/aaaa ou dd/mm/aa
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    let [, dd, mm, aaaa] = m;
    dd = dd.padStart(2, '0');
    mm = mm.padStart(2, '0');
    if (aaaa.length === 2) aaaa = '20' + aaaa;
    return `${aaaa}-${mm}-${dd}`;
  }

  // Já em formato ISO?
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  return null;
}

/**
 * Limpa string: trim + collapsa espaços + remove BOM/zero-width chars.
 * Retorna null se ficar vazio.
 */
export function limparTexto(valor) {
  if (valor === null || valor === undefined) return null;
  const s = String(valor)
    .replace(/^\uFEFF/, '')          // BOM
    .replace(/[\u200B-\u200D]/g, '') // zero-width
    .replace(/\s+/g, ' ')
    .trim();
  return s || null;
}

/**
 * Remove pontuação de CNPJ/CPF: "29.941.283/0001-58" → "29941283000158"
 */
export function normalizarDocumento(doc) {
  if (!doc) return null;
  const limpo = String(doc).replace(/\D/g, '');
  return limpo || null;
}

/**
 * Detecta se documento é CPF (11) ou CNPJ (14).
 */
export function tipoDocumento(doc) {
  const limpo = normalizarDocumento(doc);
  if (!limpo) return null;
  if (limpo.length === 14) return 'cnpj';
  if (limpo.length === 11) return 'cpf';
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// PARSER DE CSV (TAB-separated)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Parser de CSV simples que assume:
 *   - Separador: TAB (padrão Miré/Futura) — pode ser configurado
 *   - 1ª linha é cabeçalho
 *   - Sem aspas (Miré exporta sem)
 *
 * Retorna array de objetos com chaves do header.
 *
 * @param {string} conteudo - texto bruto do CSV
 * @param {object} opts - { separador, pular_linhas }
 */
export function parseCSV(conteudo, opts = {}) {
  const { separador = '\t', pular_linhas = 0 } = opts;
  if (!conteudo) return [];

  // Normaliza line endings (CRLF, CR, LF)
  const texto = conteudo.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const linhas = texto.split('\n').filter(l => l.length > 0);

  if (linhas.length <= pular_linhas) return [];

  // Pula linhas iniciais (algumas exportações têm título)
  const linhasUteis = linhas.slice(pular_linhas);
  const cabecalho = linhasUteis[0].split(separador).map(c => c.trim());
  const linhasDados = linhasUteis.slice(1);

  return linhasDados
    .map(linha => {
      // Linha vazia ou só com separadores: ignora
      if (!linha.trim()) return null;
      const valores = linha.split(separador);
      const obj = {};
      cabecalho.forEach((coluna, i) => {
        obj[coluna] = (valores[i] !== undefined ? valores[i] : '').trim();
      });
      return obj;
    })
    .filter(Boolean);
}

// ═══════════════════════════════════════════════════════════════════════════
// ROTEADOR: DETECTAR TIPO DE ARQUIVO PELO NOME
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Identifica o tipo de arquivo (e a loja, quando aplicável) baseado no nome
 * e na pasta-mãe. Retorna { tipo, loja }.
 *
 * Tipos:
 *   - 'cadastro_clientes_futura'      (geral, sem loja)
 *   - 'vendas_clientes_st' / '_br'    (agregado por cliente)
 *   - 'vendas_historico_st' / '_br'   (histórico de pedidos)
 *   - 'vendas_semanal_st' / '_br'     (atualizações semanais)
 *   - 'produtos_semanal'              (catálogo)
 *   - 'sacola_st' / '_br'             (PDF de pedidos em espera)
 *
 * Retorna null se não conseguir identificar.
 */
export function detectarTipoArquivo(nomeArquivo, parentName = '') {
  if (!nomeArquivo) return null;
  const n = nomeArquivo.toLowerCase();
  const p = (parentName || '').toLowerCase();

  // PDF de sacola
  if (n.endsWith('.pdf') && /pedidos?[-_ ]espera|sacola/i.test(n)) {
    if (/_st_|_st\./i.test(n) || /silva.?teles/i.test(p)) {
      return { tipo: 'sacola_st', loja: 'Silva Teles' };
    }
    if (/_br_|_br\./i.test(n) || /bom.?retiro/i.test(p)) {
      return { tipo: 'sacola_br', loja: 'Bom Retiro' };
    }
    return null;
  }

  // CSV de cadastro Futura (pode estar na raiz ou em _CARGA_INICIAL/Geral_Inicial)
  if (/cadastro.*clientes.*futura/i.test(n)) {
    return { tipo: 'cadastro_clientes_futura', loja: null };
  }

  // CSV de produtos (semanal) — fica na pasta Produtos/
  if (/produtos[-_]\d{2}/i.test(n) || /produtos\.csv$/i.test(n)) {
    return { tipo: 'produtos_semanal', loja: null };
  }

  // CSV de vendas — pode ser histórico, agregado de clientes ou semanal
  // Distingue pelo nome
  const ehST = /_st_|_st\./i.test(n) || /silva.?teles/i.test(p);
  const ehBR = /_br_|_br\./i.test(n) || /bom.?retiro/i.test(p);
  const loja = ehST ? 'Silva Teles' : (ehBR ? 'Bom Retiro' : null);

  if (!loja) return null;
  const sufixo = ehST ? '_st' : '_br';

  if (/relatorio[-_]vendas[-_]clientes/i.test(n)) {
    return { tipo: `vendas_clientes${sufixo}`, loja };
  }
  if (/relatorio[-_]vendas.*historico/i.test(n)) {
    return { tipo: `vendas_historico${sufixo}`, loja };
  }
  // Fallback: arquivo na pasta Silva_Teles/ ou Bom_Retiro/ que não deu match
  // específico, assume "vendas semanal"
  if (/silva.?teles|bom.?retiro/i.test(p) && !/_inicial/i.test(p)) {
    return { tipo: `vendas_semanal${sufixo}`, loja };
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER DE LOG DE IMPORTAÇÃO
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Cria registro em lojas_importacoes (status: iniciada) e retorna o id.
 * Use no início do processamento de cada arquivo.
 */
export async function criarLogImportacao(supabase, dados) {
  const { data, error } = await supabase
    .from('lojas_importacoes')
    .insert({
      nome_arquivo: dados.nome_arquivo,
      tipo_arquivo: dados.tipo_arquivo,
      loja: dados.loja || null,
      drive_file_id: dados.drive_file_id || null,
      status: 'iniciada',
      iniciada_por: dados.iniciada_por || 'cron',
    })
    .select('id')
    .single();

  if (error) {
    console.error('[lojas-drive] erro criando log de importação:', error);
    return null;
  }
  return data.id;
}

/**
 * Atualiza log de importação (sucesso ou erro).
 */
export async function finalizarLogImportacao(supabase, importacaoId, dados) {
  if (!importacaoId) return;

  const tInicio = dados.iniciada_em || Date.now();
  const duracao_ms = Date.now() - new Date(tInicio).getTime();

  const update = {
    status: dados.status,
    registros_total: dados.registros_total || 0,
    registros_inseridos: dados.registros_inseridos || 0,
    registros_atualizados: dados.registros_atualizados || 0,
    registros_ignorados: dados.registros_ignorados || 0,
    detalhes_ignorados: dados.detalhes_ignorados || null,
    erro: dados.erro || null,
    finalizada_em: new Date().toISOString(),
    duracao_ms,
  };

  const { error } = await supabase
    .from('lojas_importacoes')
    .update(update)
    .eq('id', importacaoId);

  if (error) {
    console.error('[lojas-drive] erro atualizando log:', error);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CORS (mesmo padrão dos outros endpoints)
// ═══════════════════════════════════════════════════════════════════════════

export function setCorsDrive(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-User');
}
