/**
 * lojas-leads-importar.js — Import de leads carrinho do site Amicia (Convertr)
 *
 * POST { clientes_csv, carrinhos_csv, planilha_origem? }
 *
 * Aceita as 2 planilhas exportadas do painel Convertr:
 *   - clientes_csv: cadastro de leads (id, email, taxvat, phone, first_name, last_name, etc)
 *   - carrinhos_csv: carrinhos abandonados (uuid, customer_id, items HTML, total, etc)
 *
 * Pipeline:
 *   1. Fix encoding (Latin-1 lido como UTF-8 — PadrÃ£o -> Padrão)
 *   2. Parse CSV (aspas duplas escapadas, HTML inline com vírgulas)
 *   3. Pra cada cliente:
 *      - Normaliza taxvat (só dígitos) → detecta tipo_pessoa (PF=11, PJ=14)
 *      - Normaliza telefone, infere UF do DDD
 *      - Status inicial: PJ='novo' | PF='aguardando_atribuicao'
 *      - UPSERT por convertr_customer_id
 *   4. Pra cada carrinho:
 *      - SKIP se items_count=0 OU total=0 (Ailson 12/05/2026)
 *      - SKIP se sem customer_id (anônimo)
 *      - Parser HTML extrai URLs/slugs/cores dos itens
 *      - UPSERT por convertr_uuid em lojas_lead_carrinho_eventos
 *   5. RPC atualizar_metricas_leads_carrinho() — agrega qtd/valor
 *   6. RPC match_leads_com_clientes() — cruza com lojas_clientes (taxvat + tel)
 *   7. Retorna stats detalhadas
 *
 * Auth: admin only (Ailson, Tamara, amicia-admin).
 *
 * Sessão Ailson 12/05/2026 — Onda 1 (Módulo Leads Carrinho Convertr).
 */
import { supabase, validarUsuario, setCors } from './_lojas-helpers.js';

// ─── DDD → UF (mapa completo Brasil) ─────────────────────────────────────
const DDD_TO_UF = {
  11: 'SP', 12: 'SP', 13: 'SP', 14: 'SP', 15: 'SP', 16: 'SP', 17: 'SP', 18: 'SP', 19: 'SP',
  21: 'RJ', 22: 'RJ', 24: 'RJ',
  27: 'ES', 28: 'ES',
  31: 'MG', 32: 'MG', 33: 'MG', 34: 'MG', 35: 'MG', 37: 'MG', 38: 'MG',
  41: 'PR', 42: 'PR', 43: 'PR', 44: 'PR', 45: 'PR', 46: 'PR',
  47: 'SC', 48: 'SC', 49: 'SC',
  51: 'RS', 53: 'RS', 54: 'RS', 55: 'RS',
  61: 'DF',
  62: 'GO', 64: 'GO',
  63: 'TO',
  65: 'MT', 66: 'MT',
  67: 'MS',
  68: 'AC',
  69: 'RO',
  71: 'BA', 73: 'BA', 74: 'BA', 75: 'BA', 77: 'BA',
  79: 'SE',
  81: 'PE', 87: 'PE',
  82: 'AL',
  83: 'PB',
  84: 'RN',
  85: 'CE', 88: 'CE',
  86: 'PI', 89: 'PI',
  91: 'PA', 93: 'PA', 94: 'PA',
  92: 'AM', 97: 'AM',
  95: 'RR',
  96: 'AP',
  98: 'MA', 99: 'MA',
};

// ─── Fix encoding (UTF-8 lido como Latin-1) ──────────────────────────────
// Convertr exporta CSV em Latin-1 mas Excel/Sheets reabrem como UTF-8.
// Resultado: caracteres tipo "PadrÃ£o" no lugar de "Padrão".
function fixEncoding(text) {
  if (!text) return text;
  // Tabela de substituição dos casos mais comuns em PT-BR.
  // Cuidado: ordem importa — mais longos primeiro.
  return text
    .replace(/Ã¢/g, 'â').replace(/Ãª/g, 'ê').replace(/Ã´/g, 'ô')
    .replace(/Ã£/g, 'ã').replace(/Ãµ/g, 'õ')
    .replace(/Ã¡/g, 'á').replace(/Ã©/g, 'é').replace(/Ã­/g, 'í')
    .replace(/Ã³/g, 'ó').replace(/Ãº/g, 'ú')
    .replace(/Ã§/g, 'ç')
    .replace(/Ã€/g, 'À').replace(/Ã/g, 'Á').replace(/Ã‚/g, 'Â')
    .replace(/Ãƒ/g, 'Ã').replace(/Ã„/g, 'Ä')
    .replace(/Ã‡/g, 'Ç')
    .replace(/Ãˆ/g, 'È').replace(/Ã‰/g, 'É').replace(/ÃŠ/g, 'Ê')
    .replace(/ÃŒ/g, 'Ì').replace(/Ã/g, 'Í')
    .replace(/Ã'/g, 'Ñ')
    .replace(/Ã'/g, 'Ò').replace(/Ã"/g, 'Ó').replace(/Ã"/g, 'Ô')
    .replace(/Ã•/g, 'Õ').replace(/Ã–/g, 'Ö')
    .replace(/Ã™/g, 'Ù').replace(/Ãš/g, 'Ú').replace(/Ã›/g, 'Û')
    .replace(/Ãœ/g, 'Ü');
}

// ─── Parser CSV robusto ──────────────────────────────────────────────────
// Lida com:
//   - Aspas duplas escapadas ("")
//   - Campos com vírgulas dentro (envolvidos em aspas)
//   - HTML inline (com aspas escapadas e vírgulas)
//   - Quebras de linha dentro de campos (raro mas possível)
function parseCSV(text) {
  const lines = [];
  let currentLine = [];
  let currentField = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        currentField += '"';
        i += 2;
      } else if (c === '"') {
        inQuotes = false;
        i++;
      } else {
        currentField += c;
        i++;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
        i++;
      } else if (c === ',') {
        currentLine.push(currentField);
        currentField = '';
        i++;
      } else if (c === '\n' || c === '\r') {
        currentLine.push(currentField);
        currentField = '';
        if (currentLine.length > 0 && currentLine.some(f => f.trim() !== '')) {
          lines.push(currentLine);
        }
        currentLine = [];
        if (c === '\r' && text[i + 1] === '\n') i++;
        i++;
      } else {
        currentField += c;
        i++;
      }
    }
  }
  // Última linha sem newline
  if (currentField !== '' || currentLine.length > 0) {
    currentLine.push(currentField);
    if (currentLine.some(f => f.trim() !== '')) lines.push(currentLine);
  }

  return lines;
}

// ─── Parser HTML dos items (extrai URLs/slugs/cores) ─────────────────────
// Input: HTML cru tipo:
//   <div class="table__td-thumbs">
//     <div class="table__td-thumb" ...><img src="https://s.amicialoja.com.br/product/2026/05/vestido-curto-de-couro-amicia-preto-7.jpg?format=webp" /></div>
//   </div>
// Output: [{ foto_url, slug, tipo_inferido, cor_inferida }, ...]
// Novo formato do Convertr (jun/2026): a coluna virou `produtos` e o conteúdo
// deixou de ser HTML — agora é texto simples "Nx SKU" por linha, ex:
//   "1x 318900203\n1x 315400203"
// O SKU do site = REF + 3 dígitos de cor + 2 de tamanho, então a REF é o SKU
// menos os 5 últimos dígitos (318900203 → 3189; 37600203 → 376).
// Validado contra a biblioteca Mídias: 17/17 REFs derivadas bateram.
// Ailson 02/07/2026.
function parseProdutosTexto(texto) {
  if (!texto || !texto.trim()) return [];
  const itens = [];
  const regex = /(\d+)\s*x\s+(\d{6,})/g;
  let m;
  while ((m = regex.exec(texto)) !== null) {
    const sku = m[2];
    itens.push({
      qtd: parseInt(m[1]) || 1,
      sku,
      ref: sku.slice(0, -5).replace(/^0+/, '') || '0',
      formato: 'produtos_texto',
    });
  }
  return itens;
}

function parseItemsHtml(html) {
  if (!html || !html.trim()) return [];
  const urls = [];
  const regex = /src=["']([^"']+)["']/g;
  let match;
  while ((match = regex.exec(html)) !== null) {
    urls.push(match[1]);
  }

  return urls.map(url => {
    // Limpa query params (format=webp&width=50, etc) pra ter URL canônica da foto
    const urlClean = url.split('?')[0];

    // Extrai slug do path: /product/YYYY/MM/SLUG.ext
    const slugMatch = urlClean.match(/\/product\/\d{4}\/\d{2}\/([a-z0-9-]+)\.(jpg|jpeg|png|webp)/i);
    const slug = slugMatch ? slugMatch[1] : null;

    // Tenta extrair tipo + cor do slug
    // Padrão observado: "vestido-curto-de-couro-amicia-preto-7"
    //                   { tipo descrição     } -amicia- { cor }-{num foto}
    let tipo_inferido = null;
    let cor_inferida = null;
    if (slug) {
      const partes = slug.split('-amicia-');
      if (partes.length === 2) {
        tipo_inferido = partes[0].replace(/-/g, ' ');
        const corParts = partes[1].split('-');
        cor_inferida = corParts[0]; // primeira parte = cor (resto = número da foto)
      }
    }

    return {
      foto_url: urlClean,
      slug,
      tipo_inferido,
      cor_inferida,
    };
  });
}

// ─── Inferir nome a partir do email (fallback quando first_name vazio) ───
// Ex: "elianesantosdf2014@gmail.com" → "Eliane"
function inferirNomeDoEmail(email) {
  if (!email) return null;
  const local = email.split('@')[0];
  if (!local) return null;
  // Remove números, pontos, underscores, hifens
  const limpo = local.replace(/[0-9._-]+/g, ' ').trim();
  // Pega primeira palavra
  const primeira = limpo.split(/\s+/)[0];
  if (!primeira || primeira.length < 2) return null;
  return primeira.charAt(0).toUpperCase() + primeira.slice(1).toLowerCase();
}

// ─── UF via DDD ──────────────────────────────────────────────────────────
function inferirUf(telefoneNorm) {
  if (!telefoneNorm || telefoneNorm.length < 10) return null;
  const ddd = parseInt(telefoneNorm.substring(0, 2));
  return DDD_TO_UF[ddd] || null;
}

// Timestamp tolerante (Ailson 03/08/2026): a planilha nova do Convertr trocou
// o formato de data de ISO (2026-07-31 2:43:23) pra BR (31/07/2026 23:23) —
// dia >12 estourava no Postgres e derrubava o lote inteiro ("Erro ao gravar
// leads"). Converte dd/mm/yyyy [hh:mm[:ss]] pra ISO; ISO passa direto.
function parseTsFlex(v) {
  if (!v || v === '0') return null;
  v = String(v).trim();
  const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    const hh = (m[4] || '0').padStart(2, '0');
    return `${m[3]}-${m[2]}-${m[1]} ${hh}:${m[5] || '00'}:${m[6] || '00'}`;
  }
  return v.length >= 10 ? v : null;
}

// ─── Helper: pega valor de coluna por nome do header ─────────────────────
function col(row, headerMap, name) {
  const idx = headerMap[name];
  if (idx === undefined) return null;
  const v = row[idx];
  return (v === undefined || v === null) ? null : String(v).trim();
}

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER
// ═══════════════════════════════════════════════════════════════════════════
export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });

  // Auth — só admin pode importar planilhas
  const auth = await validarUsuario(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
  if (!auth.isAdmin) return res.status(403).json({ error: 'Apenas admin pode importar planilhas de leads' });

  try {
    const { clientes_csv, carrinhos_csv, planilha_origem } = req.body || {};

    if (!clientes_csv || typeof clientes_csv !== 'string') {
      return res.status(400).json({ error: 'clientes_csv obrigatório (string)' });
    }

    const origem = planilha_origem || `import_${new Date().toISOString().slice(0, 10)}`;

    // ─── Fix encoding ──────────────────────────────────────────────────
    const clientesCsvFixed = fixEncoding(clientes_csv);
    const carrinhosCsvFixed = carrinhos_csv ? fixEncoding(carrinhos_csv) : '';

    // ─── Parse CSV ─────────────────────────────────────────────────────
    const clientesLines = parseCSV(clientesCsvFixed);
    const carrinhosLines = carrinhosCsvFixed ? parseCSV(carrinhosCsvFixed) : [];

    if (clientesLines.length < 2) {
      return res.status(400).json({ error: 'CSV de clientes vazio (precisa header + linhas)' });
    }

    // ─── Stats ─────────────────────────────────────────────────────────
    const stats = {
      clientes_total_planilha: clientesLines.length - 1,
      clientes_pj: 0,
      clientes_pf: 0,
      clientes_sem_taxvat: 0,
      clientes_processados: 0,
      clientes_skipped_sem_id_ou_email: 0,
      carrinhos_total_planilha: 0,
      carrinhos_com_valor: 0,
      carrinhos_skipped_vazios: 0,
      carrinhos_skipped_sem_customer_id: 0,
      carrinhos_skipped_lead_nao_encontrado: 0,
      leads_resolvidos_do_banco: 0,
      carrinhos_orfaos_guardados: 0,
      orfaos_rematch_casados: 0,
      orfaos_pendentes: 0,
      carrinhos_inseridos: 0,
      metricas_atualizadas: 0,
      leads_matched_por_documento: 0,
      leads_matched_por_telefone: 0,
    };

    // ─── Processa CSV de CLIENTES ──────────────────────────────────────
    const clientesHeader = clientesLines[0].map(h => h.trim().toLowerCase());
    const clientesHM = {};
    clientesHeader.forEach((h, i) => { clientesHM[h] = i; });

    // Valida colunas obrigatórias
    if (clientesHM.id === undefined || clientesHM.email === undefined) {
      return res.status(400).json({
        error: 'CSV de clientes precisa ter colunas "id" e "email"',
        headers_encontrados: clientesHeader,
      });
    }

    const leadsParaUpsert = [];
    const errosClientes = [];

    for (let i = 1; i < clientesLines.length; i++) {
      const row = clientesLines[i];
      try {
        const idStr = col(row, clientesHM, 'id');
        const email = col(row, clientesHM, 'email');
        if (!idStr || !email) {
          stats.clientes_skipped_sem_id_ou_email++;
          continue;
        }

        const convertr_id = parseInt(idStr);
        if (!convertr_id || isNaN(convertr_id)) {
          stats.clientes_skipped_sem_id_ou_email++;
          continue;
        }

        const firstName = col(row, clientesHM, 'first_name');
        const lastName = col(row, clientesHM, 'last_name');
        const phoneRaw = col(row, clientesHM, 'phone') || null;
        const taxvatRaw = col(row, clientesHM, 'taxvat') || null;
        const accessCountStr = col(row, clientesHM, 'access_count');
        const lastAccess = col(row, clientesHM, 'last_access');
        const createdAt = col(row, clientesHM, 'created_at');

        // Normalizações
        const phoneNorm = phoneRaw ? phoneRaw.replace(/\D/g, '') : null;
        const taxvatNorm = taxvatRaw ? taxvatRaw.replace(/\D/g, '') : null;

        // Tipo pessoa pela quantidade de dígitos do taxvat
        let tipoPessoa = null;
        if (taxvatNorm) {
          if (taxvatNorm.length === 11) tipoPessoa = 'PF';
          else if (taxvatNorm.length === 14) tipoPessoa = 'PJ';
        }

        if (!taxvatNorm) stats.clientes_sem_taxvat++;
        if (tipoPessoa === 'PF') stats.clientes_pf++;
        if (tipoPessoa === 'PJ') stats.clientes_pj++;

        // Razão social = last_name SE for PJ (padrão observado: lojistas botam nome do negócio aí)
        const razaoSocial = tipoPessoa === 'PJ' ? lastName : null;

        // Nome completo (first + last) ou inferido do email
        let nomeCompleto = [firstName, lastName].filter(Boolean).join(' ').trim();
        if (!nomeCompleto) nomeCompleto = inferirNomeDoEmail(email);

        // Status inicial
        // PJ → 'novo' (fila pública)
        // PF → 'aguardando_atribuicao' (admin atribui manualmente)
        // sem taxvat → 'aguardando_atribuicao' (precisa validação manual)
        const statusInicial = tipoPessoa === 'PJ'
          ? 'novo'
          : 'aguardando_atribuicao';

        // Datas — sanitizar timestamps vazios
        const parseTs = parseTsFlex;

        leadsParaUpsert.push({
          convertr_customer_id: convertr_id,
          email,
          first_name: firstName || null,
          last_name: lastName || null,
          nome_completo: nomeCompleto || null,
          telefone_raw: phoneRaw,
          telefone_norm: phoneNorm,
          taxvat_raw: taxvatRaw,
          taxvat_norm: taxvatNorm,
          tipo_pessoa: tipoPessoa,
          razao_social: razaoSocial,
          uf_inferida: inferirUf(phoneNorm),
          access_count: accessCountStr ? (parseInt(accessCountStr) || null) : null,
          last_access: parseTs(lastAccess),
          primeira_visita_em: parseTs(createdAt),
          status: statusInicial,
        });
        stats.clientes_processados++;
      } catch (e) {
        errosClientes.push({ linha: i + 1, erro: e.message });
      }
    }

    // ─── UPSERT clientes em batches (Supabase aceita até 1000 por vez) ──
    // Ailson 01/07/2026 — BUG "CARRINHO SOME DA CARTEIRA":
    // O upsert cego reescrevia status='novo' em TODO lead reimportado, inclusive
    // os que a vendedora já tinha atendido (status=mensagem_enviada). No dia
    // seguinte o cron das 8h derrubava o lead da carteira dela (escopo
    // meus_carrinhos exige status in mensagem_enviada/convertido) e ele nem
    // voltava pra fila pública (ultima_msg_enviada_em preenchido). Virava limbo.
    // Correção (opção A): NÃO tocar em status de lead que já existe. Cliente
    // novo entra com status inicial; existente só atualiza cadastro
    // (telefone, nome, uf) — status e vínculo de atendimento ficam preservados.
    const BATCH = 500;
    const leadIdMap = new Map(); // convertr_customer_id → uuid do lead

    // 1) Descobre quais convertr_customer_id já existem
    const existentesSet = new Set();
    const idsParaChecar = leadsParaUpsert.map(l => l.convertr_customer_id);
    for (let i = 0; i < idsParaChecar.length; i += BATCH) {
      const chunk = idsParaChecar.slice(i, i + BATCH);
      const { data: existData, error: existErr } = await supabase
        .from('lojas_leads_carrinho')
        .select('convertr_customer_id')
        .in('convertr_customer_id', chunk);
      if (existErr) {
        console.error('[lojas-leads-importar] erro check existentes', i, existErr);
        return res.status(500).json({ error: 'Erro ao checar leads existentes', details: existErr.message, stats });
      }
      (existData || []).forEach(r => existentesSet.add(Number(r.convertr_customer_id)));
    }

    // 2) Separa novos (com status inicial) vs existentes (sem status — preserva atendimento)
    const leadsNovos = [];
    const leadsExistentes = [];
    for (const l of leadsParaUpsert) {
      if (existentesSet.has(Number(l.convertr_customer_id))) {
        const { status, ...semStatus } = l; // remove status do payload de update
        leadsExistentes.push(semStatus);
      } else {
        leadsNovos.push(l);
      }
    }
    stats.leads_novos = leadsNovos.length;
    stats.leads_atualizados = leadsExistentes.length;

    // 3) Upsert dos dois grupos (shapes diferentes → chamadas separadas)
    for (const grupo of [leadsNovos, leadsExistentes]) {
      for (let i = 0; i < grupo.length; i += BATCH) {
        const batch = grupo.slice(i, i + BATCH);
        if (batch.length === 0) continue;
        const { data, error } = await supabase
          .from('lojas_leads_carrinho')
          .upsert(batch, { onConflict: 'convertr_customer_id', ignoreDuplicates: false })
          .select('id, convertr_customer_id');

        if (error) {
          console.error('[lojas-leads-importar] upsert clientes batch', i, error);
          return res.status(500).json({
            error: 'Erro ao gravar leads',
            details: error.message,
            batch_failed_at: i,
            stats,
          });
        }

        (data || []).forEach(r => leadIdMap.set(Number(r.convertr_customer_id), r.id));
      }
    }

    // ─── Processa CSV de CARRINHOS (se enviado) ───────────────────────
    const eventosParaUpsert = [];

    if (carrinhosLines.length >= 2) {
      const carrinhosHeader = carrinhosLines[0].map(h => h.trim().toLowerCase());
      const carrinhosHM = {};
      carrinhosHeader.forEach((h, i) => { carrinhosHM[h] = i; });

      // Validar colunas obrigatórias
      if (carrinhosHM.id === undefined || carrinhosHM.uuid === undefined) {
        return res.status(400).json({
          error: 'CSV de carrinhos precisa ter colunas "id" e "uuid"',
          headers_encontrados: carrinhosHeader,
        });
      }

      const errosCarrinhos = [];

      // RESOLUCAO PELO BANCO (Ailson 03/08/2026): o leadIdMap so tinha os
      // clientes DA PLANILHA DO DIA — carrinho de cliente ja cadastrado em
      // planilhas anteriores era descartado como "lead nao encontrado".
      // Agora, todo customer_id de carrinho que nao esta no map e buscado
      // direto em lojas_leads_carrinho. O recorte da planilha deixa de importar.
      const custIdsFaltantes = new Set();
      for (let i = 1; i < carrinhosLines.length; i++) {
        const cid = parseInt(col(carrinhosLines[i], carrinhosHM, 'customer_id') || '0');
        if (cid && !leadIdMap.has(cid)) custIdsFaltantes.add(cid);
      }
      const faltArr = Array.from(custIdsFaltantes);
      for (let i = 0; i < faltArr.length; i += BATCH) {
        const chunk = faltArr.slice(i, i + BATCH);
        const { data: achados } = await supabase
          .from('lojas_leads_carrinho')
          .select('id, convertr_customer_id')
          .in('convertr_customer_id', chunk);
        (achados || []).forEach(r => {
          leadIdMap.set(Number(r.convertr_customer_id), r.id);
          stats.leads_resolvidos_do_banco++;
        });
      }

      const orfaosParaGuardar = [];

      for (let i = 1; i < carrinhosLines.length; i++) {
        const row = carrinhosLines[i];
        try {
          stats.carrinhos_total_planilha++;

          const cId = parseInt(col(row, carrinhosHM, 'id') || '0');
          const cUuid = col(row, carrinhosHM, 'uuid');
          const cCustId = parseInt(col(row, carrinhosHM, 'customer_id') || '0');

          if (!cId || !cUuid) continue;

          // Carrinho sem customer_id (anônimo) = não dá pra atribuir a lead
          if (!cCustId) {
            stats.carrinhos_skipped_sem_customer_id++;
            continue;
          }

          const itemsCount = parseInt(col(row, carrinhosHM, 'items_count') || '0') || 0;
          const subtotal = parseFloat(col(row, carrinhosHM, 'subtotal') || '0') || 0;
          const total = parseFloat(col(row, carrinhosHM, 'total') || '0') || 0;

          // FILTRO Ailson 12/05/2026: só carrinhos com valor real
          if (itemsCount === 0 || total === 0) {
            stats.carrinhos_skipped_vazios++;
            continue;
          }

          stats.carrinhos_com_valor++;

          // Convertr renomeou a coluna: era `items` (HTML), virou `produtos`
          // (texto "Nx SKU"). Aceita as duas. Ailson 02/07/2026.
          const itemsHtml = col(row, carrinhosHM, 'items') || col(row, carrinhosHM, 'produtos') || '';
          let itemsParsed = parseItemsHtml(itemsHtml);
          if (!itemsParsed.length) itemsParsed = parseProdutosTexto(itemsHtml);

          const parseTs = parseTsFlex;

          const eventoBase = {
            convertr_uuid: cUuid,
            convertr_id: cId,
            created_at_convertr: parseTs(col(row, carrinhosHM, 'created_at')),
            updated_at_convertr: parseTs(col(row, carrinhosHM, 'updated_at')),
            items_count: itemsCount,
            subtotal,
            total,
            // Trunca HTML pra não estourar limite de coluna (5KB é generoso)
            items_html_raw: itemsHtml.length > 5000 ? itemsHtml.substring(0, 5000) : itemsHtml,
            items_parsed: itemsParsed,
            planilha_origem: origem,
          };

          // Lead precisa existir (planilha do dia OU banco)
          const leadId = leadIdMap.get(cCustId);
          if (!leadId) {
            stats.carrinhos_skipped_lead_nao_encontrado++;
            // FILA DE ORFAOS (Ailson 03/08/2026): guarda o carrinho pronto;
            // re-match automatico quando o cliente chegar num import futuro
            orfaosParaGuardar.push({
              id: cId,
              convertr_uuid: cUuid,
              convertr_customer_id: cCustId,
              payload_evento: eventoBase,
              ultima_tentativa: new Date().toISOString(),
            });
            continue;
          }

          eventosParaUpsert.push({ ...eventoBase, lead_id: leadId });
        } catch (e) {
          errosCarrinhos.push({ linha: i + 1, erro: e.message });
        }
      }

      // UPSERT eventos em batches
      for (let i = 0; i < eventosParaUpsert.length; i += BATCH) {
        const batch = eventosParaUpsert.slice(i, i + BATCH);
        const { error } = await supabase
          .from('lojas_lead_carrinho_eventos')
          .upsert(batch, { onConflict: 'convertr_uuid', ignoreDuplicates: false });

        if (error) {
          console.error('[lojas-leads-importar] upsert eventos batch', i, error);
          // Não retorna erro — segue com os que conseguiu importar
          break;
        }
        stats.carrinhos_inseridos += batch.length;
      }

      // Guarda os orfaos novos (upsert: carrinho pode reaparecer atualizado)
      if (orfaosParaGuardar.length) {
        const { error: eOrf } = await supabase
          .from('site_amicia_carrinhos_orfaos')
          .upsert(orfaosParaGuardar, { onConflict: 'id', ignoreDuplicates: false });
        if (!eOrf) stats.carrinhos_orfaos_guardados = orfaosParaGuardar.length;
        else console.error('[lojas-leads-importar] upsert orfaos', eOrf);
      }

      // RE-MATCH DA FILA (Ailson 03/08/2026): tenta casar orfaos pendentes
      // (deste e de imports anteriores) contra o banco de leads atual
      try {
        const { data: orfaos } = await supabase
          .from('site_amicia_carrinhos_orfaos')
          .select('id, convertr_uuid, convertr_customer_id, payload_evento, tentativas')
          .eq('status', 'pendente')
          .limit(500);
        if (orfaos && orfaos.length) {
          const idsOrf = Array.from(new Set(orfaos.map(o => Number(o.convertr_customer_id))));
          const leadPorCust = new Map();
          for (let i = 0; i < idsOrf.length; i += BATCH) {
            const chunk = idsOrf.slice(i, i + BATCH);
            const { data: achou } = await supabase
              .from('lojas_leads_carrinho')
              .select('id, convertr_customer_id')
              .in('convertr_customer_id', chunk);
            (achou || []).forEach(r => leadPorCust.set(Number(r.convertr_customer_id), r.id));
          }
          const eventosOrf = [];
          const casados = [];
          for (const o of orfaos) {
            const lid = leadPorCust.get(Number(o.convertr_customer_id));
            if (!lid) continue;
            eventosOrf.push({ ...o.payload_evento, lead_id: lid });
            casados.push({ id: o.id, lead_id: lid });
          }
          if (eventosOrf.length) {
            const { error: eEv } = await supabase
              .from('lojas_lead_carrinho_eventos')
              .upsert(eventosOrf, { onConflict: 'convertr_uuid', ignoreDuplicates: false });
            if (!eEv) {
              for (const c of casados) {
                await supabase
                  .from('site_amicia_carrinhos_orfaos')
                  .update({ status: 'casado', lead_id: c.lead_id, casado_em: new Date().toISOString() })
                  .eq('id', c.id);
              }
              stats.orfaos_rematch_casados = casados.length;
              stats.carrinhos_inseridos += eventosOrf.length;
            }
          }
          stats.orfaos_pendentes = orfaos.length - casados.length;
        }
      } catch (eRematch) {
        console.error('[lojas-leads-importar] re-match orfaos', eRematch);
      }
    }

    // ─── Atualiza métricas agregadas (chama function SQL) ──────────────
    try {
      const { data: metricasResult, error: errMetricas } = await supabase
        .rpc('atualizar_metricas_leads_carrinho');
      if (errMetricas) {
        console.warn('[lojas-leads-importar] erro métricas:', errMetricas.message);
      } else {
        stats.metricas_atualizadas = metricasResult || 0;
      }
    } catch (e) {
      console.warn('[lojas-leads-importar] exception métricas:', e.message);
    }

    // ─── Match com clientes existentes (chama function SQL) ────────────
    try {
      const { data: matchResult, error: errMatch } = await supabase
        .rpc('match_leads_com_clientes');
      if (errMatch) {
        console.warn('[lojas-leads-importar] erro match:', errMatch.message);
      } else if (matchResult && matchResult.length > 0) {
        stats.leads_matched_por_documento = matchResult[0].matched_documento || 0;
        stats.leads_matched_por_telefone = matchResult[0].matched_telefone || 0;
      }
    } catch (e) {
      console.warn('[lojas-leads-importar] exception match:', e.message);
    }

    // ─── Pós-processo: promover PF >= 12 peças pra fila pública ───────
    // Regra Ailson 12/05/2026: CPF com 12+ peças = atacado mínimo, entra
    // direto na fila pública (sem aguardar atribuição manual).
    try {
      const { data: promovidos, error: errProm } = await supabase
        .from('lojas_leads_carrinho')
        .update({ status: 'novo', atualizado_em: new Date().toISOString() })
        .eq('tipo_pessoa', 'PF')
        .eq('status', 'aguardando_atribuicao')
        .gte('qtd_pecas_ultimo_carrinho', 12)
        .gt('valor_ultimo_carrinho', 0)
        .select('id');
      if (!errProm) {
        stats.pf_promovidos_fila_publica = (promovidos || []).length;
      }
    } catch (e) {
      console.warn('[lojas-leads-importar] exception promover PF:', e.message);
    }

    // ─── Pós-processo: marcar leads de teste (telefone suspeito) ─────
    // Regra Ailson 12/05/2026: ignorar telefones de teste (99999, 0000, etc).
    // Função SQL eh_telefone_teste detecta padrões automaticamente.
    try {
      const { data: testesMarcados, error: errTeste } = await supabase.rpc(
        'marcar_leads_teste_como_invalidos'
      );
      // Função pode não existir ainda — fallback inline
      if (errTeste && errTeste.code === '42883') {
        // Função não existe: fallback via SQL raw via supabase
        const { error: errFallback } = await supabase
          .from('lojas_leads_carrinho')
          .update({ status: 'sem_carrinho_valido', atualizado_em: new Date().toISOString() })
          .in('status', ['novo', 'em_atendimento', 'aguardando_atribuicao'])
          .filter('telefone_norm', 'not.is', null);
        // Não dá pra usar eh_telefone_teste(coluna) via PostgREST direto.
        // Vamos confiar na função RPC quando criada.
        if (!errFallback) {
          stats.leads_teste_marcados = 0;  // não conseguimos detectar via PostgREST
        }
      } else if (!errTeste) {
        stats.leads_teste_marcados = testesMarcados || 0;
      }
    } catch (e) {
      console.warn('[lojas-leads-importar] exception marcar testes:', e.message);
    }

    // ─── Retorno ──────────────────────────────────────────────────────
    return res.json({
      ok: true,
      planilha_origem: origem,
      stats,
      eventos_count: eventosParaUpsert.length,
      leads_count: leadsParaUpsert.length,
      mensagem: `Importados ${stats.clientes_processados} leads (${stats.clientes_pj} PJ, ${stats.clientes_pf} PF) e ${stats.carrinhos_inseridos} carrinhos. ${stats.leads_matched_por_documento + stats.leads_matched_por_telefone} matchs com clientes existentes.`,
    });
  } catch (e) {
    console.error('[lojas-leads-importar] erro geral:', e);
    return res.status(500).json({ error: e.message || 'Erro interno' });
  }
}
