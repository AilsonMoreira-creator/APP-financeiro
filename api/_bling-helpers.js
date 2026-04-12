/**
 * _bling-helpers.js — Funções compartilhadas entre serverless Bling
 * Prefixo _ = Vercel não expõe como endpoint
 */
import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ── Parse descrição do item → ref, tamanho, cor, estoque ──
export function parseDescricao(descricao) {
  const r = { ref: "", tamanho: "", cor: "", estoque: "", descLimpa: "" };
  if (!descricao) return r;
  const refM = descricao.match(/\(ref\.?\s*(\d{3,5})\)/i);
  if (refM) r.ref = refM[1];
  const estM = descricao.match(/\(([A-E])\)/);
  if (estM) r.estoque = estM[1];
  const corM = descricao.match(/Cor:([^;]+)/i);
  if (corM) r.cor = corM[1].trim().split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
  const tamM = descricao.match(/Tamanho:([A-Z0-9]+)/i);
  if (tamM) r.tamanho = tamM[1].toUpperCase();
  r.descLimpa = descricao
    .replace(/\(ref\.?\s*\d{3,5}\)/gi, "")
    .replace(/\([A-E]\)/g, "")
    .replace(/Cor:[^;]+/gi, "")
    .replace(/;?\s*Tamanho:[A-Z0-9]+/gi, "")
    .replace(/\s+/g, " ")
    .replace(/[;\s]+$/, "")
    .trim();
  return r;
}

// ── Parse canal de venda ──
// Detecta canal a partir de múltiplas fontes do pedido Bling v3
// Prioridade: loja_id > CNPJ intermediador > lojaNome > numeroPedidoLoja > contato
export function parseCanal(lojaNome, extra = {}) {
  const { intermediador, numeroPedidoLoja, contato, lojaId } = extra;

  // ── Mapa por loja_id (mais específico, detecta ML Full) ──
  const LOJA_ID_MAP = {
    // ML
    '204878671': { geral: 'Mercado Livre', detalhe: 'ML Clássico' },  // Exitus
    '205327796': { geral: 'Mercado Livre', detalhe: 'ML Full' },      // Exitus Full
    '204502328': { geral: 'Mercado Livre', detalhe: 'ML Clássico' },  // Lumia
    '205458753': { geral: 'Mercado Livre', detalhe: 'ML Clássico' },  // Muniam
    // Shopee
    '205061743': { geral: 'Shopee', detalhe: 'Shopee' },   // Exitus
    '204479688': { geral: 'Shopee', detalhe: 'Shopee' },   // Lumia
    '205458491': { geral: 'Shopee', detalhe: 'Shopee' },   // Muniam
    // Shein
    '204524257': { geral: 'Shein', detalhe: 'Shein' },     // Exitus
    '204436508': { geral: 'Shein', detalhe: 'Shein' },     // Lumia
    '205462849': { geral: 'Shein', detalhe: 'Shein' },     // Muniam
    // TikTok
    '205414310': { geral: 'TikTok', detalhe: 'TikTok' },   // Exitus
    // Magalu
    '205657137': { geral: 'Magalu', detalhe: 'Magalu' },   // Lumia
  };

  // ── 0. loja_id (mais confiável — mapa fixo das integrações) ──
  if (lojaId && LOJA_ID_MAP[String(lojaId)]) {
    return LOJA_ID_MAP[String(lojaId)];
  }

  // ── 1. intermediador CNPJ (fallback) ──
  if (intermediador) {
    const cnpj = (intermediador.cnpj || '').replace(/\D/g, '');
    const nomeUser = (intermediador.nomeUsuario || '').toLowerCase();

    // ── Fallback por CNPJ do intermediador ──
    const CNPJ_MAP = {
      '03007331000141': { geral: 'Mercado Livre', detalhe: 'Mercado Livre' },
      '35635824000112': { geral: 'Shopee', detalhe: 'Shopee' },
      '45814425000172': { geral: 'Shein', detalhe: 'Shein' },
      '47960950000121': { geral: 'Magalu', detalhe: 'Magalu' },
      '27415911000136': { geral: 'TikTok', detalhe: 'TikTok' },
    };
    if (cnpj && CNPJ_MAP[cnpj]) return CNPJ_MAP[cnpj];
    // Fallback: nome do intermediador
    const found = detectFromText(nomeUser);
    if (found) return found;
  }

  // ── 2. lojaNome (do endpoint de detalhe ou listagem) ──
  if (lojaNome) {
    const found = detectFromText(lojaNome.toLowerCase().trim());
    if (found) return found;
  }

  // ── 3. numeroPedidoLoja (padrão do marketplace) ──
  if (numeroPedidoLoja) {
    const num = String(numeroPedidoLoja).trim();
    // ML: números longos (11+ dígitos) que começam com 2000+
    if (/^\d{11,}$/.test(num) && num.startsWith('2')) return { geral: 'Mercado Livre', detalhe: 'Mercado Livre' };
    // Shopee: formato específico com letras e números
    if (/^[A-Z0-9]{15,}$/.test(num) && !num.startsWith('2')) return { geral: 'Shopee', detalhe: 'Shopee' };
  }

  // ── 4. contato.nome como última tentativa ──
  if (contato) {
    const cn = (typeof contato === 'string' ? contato : contato.nome || '').toLowerCase();
    const found = detectFromText(cn);
    if (found) return found;
  }

  return { geral: "Outros", detalhe: "Outros" };
}

// Detecta canal a partir de texto genérico
function detectFromText(text) {
  if (!text) return null;
  if (text.includes("mercado livre") || text.includes("mercadolivre") || text.includes("meli") || text.includes("mercado envios") || text.includes("meliuz")) {
    const isFull = text.includes("full") || text.includes("fulfillment") || text.includes("flex");
    return { geral: "Mercado Livre", detalhe: isFull ? "ML Full" : "ML Clássico" };
  }
  if (text.includes("shopee")) return { geral: "Shopee", detalhe: "Shopee" };
  if (text.includes("shein") || text.includes("neli")) return { geral: "Shein", detalhe: "Shein" };
  if (text.includes("tiktok") || text.includes("tik tok")) return { geral: "TikTok", detalhe: "TikTok" };
  if (text.includes("magalu") || text.includes("magazine luiza")) return { geral: "Magalu", detalhe: "Magalu" };
  if (text.includes("meluni") || text.includes("nuvemshop") || text.includes("nuvem")) return { geral: "Meluni", detalhe: "Meluni" };
  if (text.includes("amazon")) return { geral: "Amazon", detalhe: "Amazon" };
  return null;
}

// ── Fetch com retry e backoff para 429 ──
export async function blingFetch(url, headers, { maxRetries = 3, baseDelay = 1000 } = {}) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const resp = await fetch(url, { headers });

    if (resp.status === 429) {
      const wait = baseDelay * Math.pow(2, attempt); // 1s, 2s, 4s
      console.log(`[bling] 429 rate limit, aguardando ${wait}ms (tentativa ${attempt + 1}/${maxRetries + 1})`);
      await new Promise(r => setTimeout(r, wait));
      continue;
    }

    return resp;
  }
  // Esgotou retries
  return { ok: false, status: 429, json: async () => ({ error: 'Rate limit persistente' }) };
}

// ── Refresh token Bling ──
export async function refreshBlingToken(conta) {
  // Busca token atual
  const { data: tokenData, error: tokenErr } = await supabase
    .from('bling_tokens')
    .select('*')
    .eq('conta', conta)
    .single();

  if (tokenErr || !tokenData) {
    throw new Error(`sem registro em bling_tokens para ${conta}: ${tokenErr?.message || 'não encontrado'}`);
  }

  // Se token ainda é válido, usa direto (não precisa de creds)
  const expirado = !tokenData.expires_at || new Date(tokenData.expires_at) < new Date();
  if (!expirado && tokenData.access_token) {
    return tokenData.access_token;
  }

  // Token expirado — precisa das creds pra renovar
  if (!tokenData.refresh_token) {
    throw new Error(`bling_tokens.${conta} token expirado e sem refresh_token`);
  }

  const { data: credsData, error: credsErr } = await supabase
    .from('amicia_data')
    .select('payload')
    .eq('user_id', 'bling-creds')
    .maybeSingle();

  if (credsErr || !credsData?.payload) {
    throw new Error(`token ${conta} expirado e sem creds no Supabase pra renovar. Abra Config no app pra salvar as creds.`);
  }

  if (!credsData.payload[conta]?.id || !credsData.payload[conta]?.secret) {
    throw new Error(`token ${conta} expirado e creds incompletas (sem client_id/secret)`);
  }

  const creds = credsData.payload[conta];

  // Renova
  console.log(`[bling-cron] renovando token ${conta}...`);
  const basic = Buffer.from(creds.id + ":" + creds.secret).toString("base64");
  const body = "grant_type=refresh_token&refresh_token=" + encodeURIComponent(tokenData.refresh_token);

  const resp = await fetch("https://www.bling.com.br/Api/v3/oauth/token", {
    method: "POST",
    headers: {
      "Authorization": "Basic " + basic,
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json"
    },
    body
  });

  if (!resp.ok) {
    const errBody = await resp.text().catch(() => '');
    throw new Error(`refresh HTTP ${resp.status} para ${conta}: ${errBody.slice(0, 200)}`);
  }

  const d = await resp.json();
  if (!d.access_token) {
    throw new Error(`refresh ${conta} retornou sem access_token: ${JSON.stringify(d).slice(0, 200)}`);
  }

  // Salva novo token
  await supabase.from('bling_tokens').upsert({
    conta,
    access_token: d.access_token,
    refresh_token: d.refresh_token || tokenData.refresh_token,
    expires_at: new Date(Date.now() + (d.expires_in || 21600) * 1000).toISOString()
  }, { onConflict: 'conta' });

  console.log(`[bling-cron] ✓ token ${conta} renovado`);
  return d.access_token;
}
