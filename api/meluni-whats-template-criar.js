// ============================================================================
// /api/meluni-whats-template-criar — cria os 2 templates de carrinho abandonado
// (meluni_carrinho_leve e meluni_carrinho_elegante) na WABA da Lara.
// ----------------------------------------------------------------------------
// Lê a spec de meluni_config -> chave 'lara_templates_carrinho' e faz POST de
// cada um em /<WABA>/message_templates (Graph v21.0, Bearer META_WA_ACCESS_TOKEN).
// Uso manual: GET/POST com ?force=1. Idempotente do lado da Meta: recriar com o
// mesmo nome retorna erro (capturado por template, não derruba o outro).
// Ailson 16/06/2026.
// ============================================================================
import { cfgMeluni } from './_meluni-whats-helpers.js';

const GRAPH = 'https://graph.facebook.com/v21.0';
const WABA = process.env.META_WA_WABA_ID_LARA || '912339361863904';
const APP_ID = process.env.META_WA_APP_ID || '1862054317831156'; // app "claude" (resumable upload do sample do header)

function montarComponents(t, headerHandle) {
  const comps = [];
  if (headerHandle) {
    comps.push({ type: 'HEADER', format: 'IMAGE', example: { header_handle: [headerHandle] } });
  }
  comps.push({
    type: 'BODY',
    text: t.body,
    ...(Array.isArray(t.exemplo) && t.exemplo.length ? { example: { body_text: [t.exemplo] } } : {}),
  });
  if (t.botao?.url) {
    comps.push({ type: 'BUTTONS', buttons: [{ type: 'URL', text: t.botao.text || 'Abrir', url: t.botao.url }] });
  }
  return comps;
}

// Sobe a imagem de amostra do header (resumable upload no app) e devolve o
// header_handle, exigido pra criar template com HEADER IMAGE. Ailson 23/06/2026.
async function subirSampleHeader(sampleUrl, token) {
  const imgR = await fetch(sampleUrl);
  if (!imgR.ok) throw new Error(`baixar sample_url (HTTP ${imgR.status})`);
  const bytes = Buffer.from(await imgR.arrayBuffer());
  const mime = imgR.headers.get('content-type') || 'image/png';
  const fname = (sampleUrl.split('?')[0].split('/').pop()) || 'sample.png';

  // 1. inicia a sessao de upload
  const startR = await fetch(
    `${GRAPH}/${APP_ID}/uploads?file_name=${encodeURIComponent(fname)}&file_length=${bytes.length}&file_type=${encodeURIComponent(mime)}`,
    { method: 'POST', headers: { Authorization: `Bearer ${token}` } },
  );
  const startTxt = await startR.text();
  let startJ = null; try { startJ = startTxt ? JSON.parse(startTxt) : null; } catch { /* */ }
  if (!startR.ok || !startJ?.id) throw new Error('upload start: ' + startTxt);

  // 2. envia os bytes (offset 0) -> { h: handle }
  const upR = await fetch(`${GRAPH}/${startJ.id}`, {
    method: 'POST',
    headers: { Authorization: `OAuth ${token}`, file_offset: '0', 'Content-Type': mime },
    body: bytes,
  });
  const upTxt = await upR.text();
  let upJ = null; try { upJ = upTxt ? JSON.parse(upTxt) : null; } catch { /* */ }
  if (!upR.ok || !upJ?.h) throw new Error('upload bytes: ' + upTxt);
  return upJ.h;
}

async function criarUm(t, idiomaPadrao, categoriaPadrao) {
  const token = process.env.META_WA_ACCESS_TOKEN;
  let headerHandle = null;
  if (t.header?.format === 'IMAGE' && t.header?.sample_url) {
    headerHandle = await subirSampleHeader(t.header.sample_url, token);
  }
  const payload = {
    name: t.name,
    language: t.language || idiomaPadrao || 'pt_BR',
    category: t.category || categoriaPadrao || 'MARKETING',
    components: montarComponents(t, headerHandle),
  };
  const r = await fetch(`${GRAPH}/${WABA}/message_templates`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const txt = await r.text();
  let j = null; try { j = txt ? JSON.parse(txt) : null; } catch { /* */ }
  return {
    name: t.name,
    ok: r.ok,
    http: r.status,
    id: j?.id || null,
    status: j?.status || null,
    category: j?.category || null,
    erro: r.ok ? null : (j?.error?.error_user_msg || j?.error?.message || txt),
    erro_detalhe: r.ok ? undefined : (j?.error || undefined),
  };
}

export default async function handler(req, res) {
  if (req.query?.force !== '1') {
    return res.status(403).json({ erro: 'Use ?force=1 pra criar os templates.' });
  }
  if (!process.env.META_WA_ACCESS_TOKEN) {
    return res.status(500).json({ erro: 'META_WA_ACCESS_TOKEN ausente' });
  }
  const chaveCfg = req.query?.cfg || 'lara_templates_carrinho';
  const spec = await cfgMeluni(chaveCfg, null);
  const tpls = spec?.templates;
  if (!tpls) return res.status(404).json({ erro: `spec ${chaveCfg} nao encontrada no meluni_config` });

  const todas = Object.keys(tpls).filter(k => tpls[k]?.name && tpls[k]?.body);
  const only = (req.query?.only || '').split(',').map(s => s.trim()).filter(Boolean);
  const alvos = only.length ? todas.filter(k => only.includes(k)) : todas;
  if (!alvos.length) return res.status(404).json({ erro: 'nenhuma versao alvo', disponiveis: todas });
  const resultados = [];
  for (const k of alvos) {
    try {
      resultados.push({ versao: k, ...(await criarUm(tpls[k], spec.idioma, spec.categoria)) });
    } catch (e) {
      resultados.push({ versao: k, name: tpls[k]?.name, ok: false, erro: String(e?.message || e) });
    }
  }
  return res.status(200).json({ ok: resultados.every(r => r.ok), waba: WABA, resultados });
}
