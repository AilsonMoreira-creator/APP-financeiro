/**
 * _bling-helpers.js — Funções compartilhadas entre serverless Bling
 * Prefixo _ = Vercel não expõe como endpoint
 */
import './_upsert-dedupe.js';
import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ── JWT do Bling (migracao obrigatoria ate 15/10/2026) ──────────────────────
// Doc oficial (developer.bling.com.br/migracao-jwt): mandar o header
// `enable-jwt: 1` no POST /oauth/token (inclusive no refresh) faz o Bling
// devolver token JWT em vez de opaco; e o MESMO header tem que ir em TODA
// requisicao autenticada dali em diante. Sem o header, continua opaco.
//
// Como as chamadas ao Bling estao espalhadas em ~50 arquivos (todos importam
// este helper), o header e injetado num unico ponto: um embrulho do fetch
// global que so age em api.bling.com.br, e SO quando o Bearer ja e JWT.
// O que decide o formato do token e o /oauth/token: la o header vai pra conta
// ligada em saude_config.bling_jwt_contas ("muniam" -> so ela; "*" -> todas).
let _jwtContas = null; let _jwtLidoEm = 0;
async function jwtContas() {
  if (_jwtContas && Date.now() - _jwtLidoEm < 60000) return _jwtContas;
  try {
    const { data } = await supabase.from('saude_config').select('valor').eq('chave', 'bling_jwt_contas').maybeSingle();
    _jwtContas = String(data?.valor || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  } catch { _jwtContas = _jwtContas || []; }
  _jwtLidoEm = Date.now();
  return _jwtContas;
}
export async function jwtLigadoPara(conta) {
  const l = await jwtContas();
  return l.includes('*') || l.includes(String(conta || '').toLowerCase());
}
if (typeof globalThis.fetch === 'function' && !globalThis.__blingJwtWrap) {
  const fetchOriginal = globalThis.fetch.bind(globalThis);
  globalThis.__blingJwtWrap = true;
  globalThis.fetch = async (input, init) => {
    try {
      const url = typeof input === 'string' ? input : (input?.url || '');
      if (/^https:\/\/api\.bling\.com\.br/i.test(url)) {   // so a API; o /oauth/token decide por conta
        // PROVADO no diag de 19/09: mandar enable-jwt com token OPACO da 401
        // invalid_token. Entao o header segue o TOKEN, nao uma lista: vai se (e
        // so se) o Bearer for JWT ("eyJ…"). Assim cada conta migra no seu tempo
        // e as que ainda estao opacas nao sao afetadas.
        const h = new Headers((init && init.headers) || (typeof input !== 'string' ? input.headers : undefined) || {});
        const auth = h.get('authorization') || '';
        const ehJwt = /^Bearer\s+eyJ/i.test(auth);
        if (ehJwt && !h.has('enable-jwt')) { init = init ? { ...init } : {}; h.set('enable-jwt', '1'); init.headers = h; }
      }
    } catch { /* nunca atrapalha a chamada */ }
    return fetchOriginal(input, init);
  };
}

// ── Parse descrição do item → ref, tamanho, cor, estoque ──
export function parseDescricao(descricao) {
  const r = { ref: "", tamanho: "", cor: "", estoque: "", descLimpa: "" };
  if (!descricao) return r;
  const refM = descricao.match(/\(ref\.?\s*(\d{3,5})\)/i);
  if (refM) r.ref = refM[1];
  // Fallback (Ailson 21/07/2026): cadastro novo vem "(03150)" SEM a palavra
  // "ref" — o vestido couro 3150 vendeu 249 pcs e sumia do ranking por isso.
  if (!r.ref) { const m = descricao.match(/\((0*\d{3,5})\)/); if (m) r.ref = m[1]; }
  const estM = descricao.match(/\(([A-H])\)/);
  if (estM) r.estoque = estM[1];
  const corM = descricao.match(/Cor:([^;]+)/i);
  if (corM) r.cor = corM[1].trim().split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
  const tamM = descricao.match(/Tamanho:([A-Z0-9]+)/i);
  if (tamM) r.tamanho = tamM[1].toUpperCase();
  r.descLimpa = descricao
    .replace(/\(ref\.?\s*\d{3,5}\)/gi, "")
    .replace(/\(0*\d{3,5}\)/g, "")
    .replace(/\([A-H]\)/g, "")
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
// 21/09: 4 retentativas (1, 2, 4, 8 s) e cada 429 fica registrado em app_erros
// (modulo 'bling-429') pra enxergar o historico — segunda 21/09 o preparo do lote
// das 07:50 tropecou no limite e a Sthefany viu erro as 08:00.
export async function blingFetch(url, headers, { maxRetries = 4, baseDelay = 1000 } = {}) {
  let tentativas429 = 0;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const resp = await fetch(url, { headers });

    if (resp.status === 429) {
      tentativas429++;
      const wait = baseDelay * Math.pow(2, attempt); // 1s, 2s, 4s, 8s
      console.log(`[bling] 429 rate limit, aguardando ${wait}ms (tentativa ${attempt + 1}/${maxRetries + 1})`);
      await new Promise(r => setTimeout(r, wait));
      continue;
    }
    if (tentativas429) registrar429(url, tentativas429, true);
    return resp;
  }
  registrar429(url, tentativas429, false);
  return { ok: false, status: 429, json: async () => ({ error: 'Rate limit persistente' }) };
}
function registrar429(url, n, recuperou) {
  try {
    const caminho = String(url).replace(/^https:\/\/api\.bling\.com\.br\/Api\/v3/, '').replace(/[?#].*$/, '').replace(/\/\d+/g, '/{id}');
    supabase.from('app_erros').insert({ modulo: 'bling-429', assinatura: 'bling-429:' + caminho, mensagem: `Bling 429 em ${caminho} — ${n} espera(s)${recuperou ? ', recuperou' : ', DESISTIU'}`, usuario: 'servidor' }).then(() => {}, () => {});
  } catch { /* nunca atrapalha */ }
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

  // ── DISJUNTOR (19/09, pedido dele): nunca ficar em loop tentando renovar ──
  // Cada falha aumenta a espera: 1 falha = 2 min, 2 = 5, 3 = 15, 4+ = 60 min.
  // Dentro da janela, quem chamar recebe erro na hora, SEM bater no Bling.
  // Um sucesso zera tudo. Reversao manual: zerar refresh_falhas na tabela.
  const falhas = Number(tokenData.refresh_falhas) || 0;
  if (falhas > 0 && tokenData.refresh_falhou_em) {
    const esperaMin = falhas >= 4 ? 60 : falhas === 3 ? 15 : falhas === 2 ? 5 : 2;
    const liberaEm = new Date(tokenData.refresh_falhou_em).getTime() + esperaMin * 60000;
    if (Date.now() < liberaEm) {
      const faltam = Math.ceil((liberaEm - Date.now()) / 60000);
      throw new Error(`token ${conta} expirado e a renovacao falhou ${falhas}x (${String(tokenData.refresh_erro || '').slice(0, 80)}); nova tentativa em ${faltam} min`);
    }
  }
  const registrarFalha = async (msg) => {
    try { await supabase.from('bling_tokens').update({ refresh_falhas: falhas + 1, refresh_falhou_em: new Date().toISOString(), refresh_erro: String(msg).slice(0, 200) }).eq('conta', conta); } catch {}
  };

  // 19/09 (fase de protecao): credenciais vivem em bling_credenciais (tabela
  // fechada). O payload bling-creds fica so como fallback ate ser apagado.
  let credsData = null, credsErr = null;
  const { data: credRow } = await supabase.from('bling_credenciais').select('client_id, client_secret').eq('conta', conta).maybeSingle();
  if (credRow?.client_id && credRow?.client_secret) {
    credsData = { payload: { [conta]: { id: credRow.client_id, secret: credRow.client_secret } } };
  } else {
    ({ data: credsData, error: credsErr } = await supabase.from('amicia_data').select('payload').eq('user_id', 'bling-creds').maybeSingle());
  }

  if (credsErr || !credsData?.payload) {
    throw new Error(`token ${conta} expirado e sem credenciais cadastradas pra renovar. Cadastre no modulo Bling.`);
  }

  if (!credsData.payload[conta]?.id || !credsData.payload[conta]?.secret) {
    throw new Error(`token ${conta} expirado e creds incompletas (sem client_id/secret)`);
  }

  const creds = credsData.payload[conta];

  // Renova
  console.log(`[bling-cron] renovando token ${conta}...`);
  const basic = Buffer.from(creds.id + ":" + creds.secret).toString("base64");
  const body = "grant_type=refresh_token&refresh_token=" + encodeURIComponent(tokenData.refresh_token);

  // JWT (ate 15/10): so pra conta ligada em saude_config.bling_jwt_contas
  const hdrRefresh = { "Authorization": "Basic " + basic, "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" };
  if (await jwtLigadoPara(conta)) hdrRefresh['enable-jwt'] = '1';
  const resp = await fetch("https://www.bling.com.br/Api/v3/oauth/token", { method: "POST", headers: hdrRefresh, body });

  if (!resp.ok) {
    const errBody = await resp.text().catch(() => '');
    await registrarFalha(`HTTP ${resp.status}: ${errBody.slice(0, 120)}`);
    throw new Error(`refresh HTTP ${resp.status} para ${conta}: ${errBody.slice(0, 200)}`);
  }

  const d = await resp.json();
  if (!d.access_token) {
    await registrarFalha('sem access_token na resposta');
    throw new Error(`refresh ${conta} retornou sem access_token: ${JSON.stringify(d).slice(0, 200)}`);
  }

  // Salva novo token
  await supabase.from('bling_tokens').upsert({
    conta,
    access_token: d.access_token,
    refresh_token: d.refresh_token || tokenData.refresh_token,
    expires_at: new Date(Date.now() + (d.expires_in || 21600) * 1000).toISOString(),
    refresh_falhas: 0, refresh_falhou_em: null, refresh_erro: null,   // sucesso zera o disjuntor
  }, { onConflict: 'conta' });

  console.log(`[bling-cron] ✓ token ${conta} renovado`);
  return d.access_token;
}

// Normatizacao de cores (Ailson 21/07/2026): cores que na pratica sao a MESMA
// viram uma so no estoque. Aplicar ANTES do normCor/cor_label nos syncs.
//   azul bebe -> Azul Claro  ·  offwhite -> Branco
// (a camisa tricoline ja e cadastrada como Branco, entao nao precisa de excecao)
// Sinônimos ditados pelo Ailson (14/08): a mesma cor é escrita de jeitos
// diferentes entre as 3 contas do Bling e entre os canais. O que vale é o
// SKU, então a comparação tem que ignorar hífen/acento/caixa e tratar essas
// grafias como a MESMA cor. ATENÇÃO: "Marrom Mescla" é cor própria e NÃO
// entra no grupo do Marrom.
const SINONIMOS_COR = {
  offwhite: 'branco',
  branco: 'branco',
  azulbebe: 'azulclaro',
  azulclaro: 'azulclaro',
  azulmarinho: 'azulmarinho',
  rosabebe: 'rosaclaro',
  rosaclaro: 'rosaclaro',
  // "Rosa" só existe na paleta da ordem de corte; no Bling é sempre
  // "Rosa Claro" (conferido 14/08: nenhum SKU com Rosa puro)
  rosa: 'rosaclaro',
  marromescuro: 'marrom',
  marrom: 'marrom',
  // 14/09 (ordem dele): "Verde Sálvia Escuro" (com/sem acento) é a mesma cor
  // que "Verde Sálvia" — a principal é Verde Sálvia
  verdesalviaescuro: 'verdesalvia',
  verdesalvia: 'verdesalvia',
  // 18/09: no Bling também aparece SEM o "Verde" — "Sálvia Escuro" / "Salvia".
  // (o acento já cai na normalização; aqui é a grafia curta.)
  salviaescuro: 'verdesalvia',
  salvia: 'verdesalvia',
};

const ROTULO_COR = {
  branco: 'Branco',
  azulclaro: 'Azul Claro',
  azulmarinho: 'Azul Marinho',
  rosaclaro: 'Rosa Claro',
  marrom: 'Marrom',
  verdesalvia: 'Verde Sálvia',
};

/** Chave de COMPARAÇÃO de cor: sem acento, sem hífen/espaço, com sinônimos. */
export function chaveCor(cor) {
  const n = String(cor || '').toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
  return SINONIMOS_COR[n] || n;
}

/** Nome de EXIBIÇÃO da cor (uma grafia só por grupo). */
export function canonizarCor(cor) {
  const k = chaveCor(cor);
  return ROTULO_COR[k] || cor;
}
