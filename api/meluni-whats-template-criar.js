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

function montarComponents(t) {
  const comps = [{
    type: 'BODY',
    text: t.body,
    ...(Array.isArray(t.exemplo) && t.exemplo.length ? { example: { body_text: [t.exemplo] } } : {}),
  }];
  if (t.botao?.url) {
    comps.push({ type: 'BUTTONS', buttons: [{ type: 'URL', text: t.botao.text || 'Abrir', url: t.botao.url }] });
  }
  return comps;
}

async function criarUm(t, idiomaPadrao, categoriaPadrao) {
  const payload = {
    name: t.name,
    language: t.language || idiomaPadrao || 'pt_BR',
    category: t.category || categoriaPadrao || 'MARKETING',
    components: montarComponents(t),
  };
  const r = await fetch(`${GRAPH}/${WABA}/message_templates`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.META_WA_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
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
    erro: r.ok ? null : (j?.error?.message || txt),
  };
}

export default async function handler(req, res) {
  if (req.query?.force !== '1') {
    return res.status(403).json({ erro: 'Use ?force=1 pra criar os templates.' });
  }
  if (!process.env.META_WA_ACCESS_TOKEN) {
    return res.status(500).json({ erro: 'META_WA_ACCESS_TOKEN ausente' });
  }
  const spec = await cfgMeluni('lara_templates_carrinho', null);
  const tpls = spec?.templates;
  if (!tpls) return res.status(404).json({ erro: 'spec lara_templates_carrinho nao encontrada no meluni_config' });

  const alvos = ['leve', 'elegante'].filter(k => tpls[k]?.name && tpls[k]?.body);
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
