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
        const parseTs = v => (v && v !== '0' && v.length >= 10) ? v : null;

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
    const BATCH = 500;
    const leadIdMap = new Map(); // convertr_customer_id → uuid do lead
    for (let i = 0; i < leadsParaUpsert.length; i += BATCH) {
      const batch = leadsParaUpsert.slice(i, i + BATCH);
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

          // Lead precisa existir (vai estar no leadIdMap)
          const leadId = leadIdMap.get(cCustId);
          if (!leadId) {
            stats.carrinhos_skipped_lead_nao_encontrado++;
            continue;
          }

          const itemsHtml = col(row, carrinhosHM, 'items') || '';
          const itemsParsed = parseItemsHtml(itemsHtml);

          const parseTs = v => (v && v.length >= 10) ? v : null;

          eventosParaUpsert.push({
            convertr_uuid: cUuid,
            convertr_id: cId,
            lead_id: leadId,
            created_at_convertr: parseTs(col(row, carrinhosHM, 'created_at')),
            updated_at_convertr: parseTs(col(row, carrinhosHM, 'updated_at')),
            items_count: itemsCount,
            subtotal,
            total,
            // Trunca HTML pra não estourar limite de coluna (5KB é generoso)
            items_html_raw: itemsHtml.length > 5000 ? itemsHtml.substring(0, 5000) : itemsHtml,
            items_parsed: itemsParsed,
            planilha_origem: origem,
          });
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
