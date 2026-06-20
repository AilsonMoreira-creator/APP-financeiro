// ============================================================================
// /api/meluni-email-mkt-lara — a Lara escreve o e-mail de recuperação.
// POST { brief, cupom?, cupom_validade?, nome_exemplo? }
//   -> { ok, assunto, titulo, corpo }   (sempre editável no front)
// Usa chamarClaude (claude-sonnet-4-6). Voz Meluni B2C, sem gatilhos de spam.
// Ailson 20/06/2026.
// ============================================================================
import { chamarClaude } from './_lojas-helpers.js';

const SYSTEM = `Vc é a Lara, copywriter de e-mail da Meluni (moda feminina, consumidora final / B2C).
Escreve um e-mail curto de recuperação de carrinho abandonado.

VOZ E REGRAS (obrigatórias):
- Português BR, informal e acolhedor. Use sempre "vc" (nunca "você").
- Foco em linho e alfaiataria. Não enfatize viscolinho.
- Consumidora final: NUNCA fale em "grade", "atacado", "separar grade" ou revenda.
- PROIBIDO usar estas palavras: incrível, imperdível, sensacional, caprichada, saudade, perfil.
- PROIBIDO usar (gatilho de spam): promoção, só hoje, grátis, free, desconto, oferta relâmpago.
- Sem travessão (—). Sem o emoji 💛. Outros emojis: no máximo 1, só se couber natural.
- Personalize com {{nome}} no assunto e no começo do corpo (será trocado pelo nome real; pode vir vazio, então a frase precisa funcionar sem o nome também).

ASSUNTO:
- Até ~40 caracteres (aparece no mobile). Verbo no imperativo, desperta curiosidade.

CORPO:
- Curto: 2 a 4 frases curtas (até ~70 palavras). Valor antes de vender.
- Um único caminho: voltar pro carrinho/site. Não escreva botão nem link (o botão é separado).
- Se houver cupom, comunique a vantagem de 10% PELO CUPOM sem usar a palavra "desconto"
  (ex: "10% no cupom VOLTE10", "essa condição", "essa vantagem"). Urgência honesta pela validade.

TÍTULO:
- Uma linha de abertura dentro do e-mail (pode repassar a ideia do assunto, com mais respiro).

Responda SOMENTE com JSON válido, sem markdown, sem cercas de código:
{"assunto":"...","titulo":"...","corpo":"..."}`;

function parseJson(texto) {
  let t = String(texto || '').trim();
  t = t.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const i = t.indexOf('{'), j = t.lastIndexOf('}');
  if (i >= 0 && j > i) t = t.slice(i, j + 1);
  try { return JSON.parse(t); } catch { return null; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, erro: 'use POST' });

  const { brief, cupom, cupom_validade, nome_exemplo } = req.body || {};
  if (!brief || !String(brief).trim()) {
    return res.status(400).json({ ok: false, erro: 'descreva o que vc quer no e-mail (brief)' });
  }

  const partes = [`Pedido do Ailson: ${String(brief).trim()}`];
  if (cupom) partes.push(`Cupom a citar: ${cupom} (10% no carrinho)${cupom_validade ? `, válido por ${cupom_validade}` : ''}.`);
  if (nome_exemplo) partes.push(`Exemplo de nome (só pra calibrar o tom): ${nome_exemplo}.`);
  partes.push('Lembre: use {{nome}} como placeholder e devolva só o JSON.');

  try {
    const cl = await chamarClaude({
      modelo: 'claude-sonnet-4-6',
      systemBlocks: SYSTEM,
      messages: [{ role: 'user', content: partes.join('\n') }],
      max_tokens: 700,
      temperature: 0.7,
    });
    if (!cl.ok) return res.status(502).json({ ok: false, erro: cl.erro || 'falha na Lara' });

    const j = parseJson(cl.texto);
    if (j && (j.assunto || j.corpo || j.titulo)) {
      return res.json({
        ok: true,
        assunto: String(j.assunto || '').trim(),
        titulo: String(j.titulo || '').trim(),
        corpo: String(j.corpo || '').trim(),
      });
    }
    // fallback: não veio JSON — joga o texto no corpo pra Ailson editar
    return res.json({ ok: true, assunto: '', titulo: '', corpo: String(cl.texto || '').trim() });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: String(e?.message || e) });
  }
}
