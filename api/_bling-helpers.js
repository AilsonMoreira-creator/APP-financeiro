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
export function parseCanal(nome) {
  if (!nome) return { geral: "Outros", detalhe: "Outros" };
  const l = nome.toLowerCase().trim();
  if (!l) return { geral: "Outros", detalhe: "Outros" };
  if (l.includes("mercado livre") || l.includes("mercadolivre") || l.includes("meli")) {
    const isFull = l.includes("full") || l.includes("fulfillment") || l.includes("flex");
    return { geral: "Mercado Livre", detalhe: isFull ? "ML Full" : "ML Clássico" };
  }
  if (l.includes("shopee")) return { geral: "Shopee", detalhe: "Shopee" };
  if (l.includes("shein") || l.includes("neli")) return { geral: "Shein", detalhe: "Shein" };
  if (l.includes("tiktok") || l.includes("tik tok")) return { geral: "TikTok", detalhe: "TikTok" };
  if (l.includes("magalu") || l.includes("magazine")) return { geral: "Magalu", detalhe: "Magalu" };
  if (l.includes("meluni") || l.includes("nuvemshop") || l.includes("nuvem")) return { geral: "Meluni", detalhe: "Meluni" };
  if (l.includes("amazon")) return { geral: "Amazon", detalhe: "Amazon" };
  if (l.includes("ideris")) return { geral: "Outros", detalhe: "Ideris" };
  return { geral: nome.trim(), detalhe: nome.trim() };
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
  // Busca creds do amicia_data
  const { data: credsData } = await supabase
    .from('amicia_data')
    .select('payload')
    .eq('user_id', 'bling-creds')
    .single();

  if (!credsData?.payload?.[conta]?.id || !credsData?.payload?.[conta]?.secret) {
    console.log(`[bling-cron] sem creds para ${conta}`);
    return null;
  }

  const creds = credsData.payload[conta];

  // Busca token atual
  const { data: tokenData } = await supabase
    .from('bling_tokens')
    .select('*')
    .eq('conta', conta)
    .single();

  if (!tokenData?.refresh_token) {
    console.log(`[bling-cron] sem refresh_token para ${conta}`);
    return null;
  }

  // Verifica se precisa renovar
  const expirado = !tokenData.expires_at || new Date(tokenData.expires_at) < new Date();
  if (!expirado && tokenData.access_token) {
    return tokenData.access_token;
  }

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
    console.error(`[bling-cron] refresh falhou para ${conta}: ${resp.status}`);
    return null;
  }

  const d = await resp.json();
  if (!d.access_token) return null;

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
