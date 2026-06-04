// ═══════════════════════════════════════════════════════════════════════════
// cor-hex.js — Infere o hex (#rrggbb) de uma cor pelo NOME. Ailson 04/06/2026.
// Usado pra preencher a "bolinha" automaticamente ao criar uma cor manual nos
// modulos de corte (Oficina/Detalhes do corte e Sala de Cortes/Nova ordem).
//
//   GET ?nome=Marsala  →  { hex: '#7b3f44', fonte: 'mapa' | 'ia' }
//
// Estrategia: dicionario local de cores de moda PT (instantaneo, gratis). Se o
// nome nao estiver no mapa, cai pro Claude (infere o tom). Se nada der, null.
// ═══════════════════════════════════════════════════════════════════════════

import { setCors } from './_ordens-corte-helpers.js';
import { chamarClaude } from './_lojas-helpers.js';

const norm = (s) => (s || '')
  .toLowerCase().trim()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '');  // tira acento

// Dicionario de cores de moda PT-BR (cobre a grande maioria dos nomes usados).
const MAPA = {
  'preto': '#1a1a1a', 'branco': '#f4f4f2', 'off white': '#f0ebe0', 'cru': '#efe6d3',
  'gelo': '#eef2f3', 'bege': '#d4c4a4', 'bege claro': '#ebdcc0', 'nude': '#e8c8b0',
  'areia': '#d9c2a3', 'creme': '#ebe2cc', 'caramelo': '#a8743b', 'camel': '#c19a6b',
  'marrom': '#5c3a20', 'marrom escuro': '#3d2418', 'chocolate': '#4a2c1a', 'cafe': '#4b3621',
  'terracota': '#b5651d', 'telha': '#9e4638', 'ferrugem': '#8b4513', 'tijolo': '#9c4a3c',
  'mostarda': '#c9a227', 'amarelo': '#f2c200', 'ouro': '#d4af37', 'dourado': '#c9a227',
  'laranja': '#e8731f', 'coral': '#f08060', 'salmao': '#f4a896', 'pessego': '#f5c4a1',
  'rosa': '#e89bb0', 'rose': '#c98a8a', 'pink': '#e84a8a', 'magenta': '#c0398a',
  'vermelho': '#c0392b', 'vinho': '#5c1a2e', 'bordo': '#5e1620', 'marsala': '#7b3f44',
  'figo': '#6b3a4c', 'uva': '#5a2a4a', 'roxo': '#6a3d8f', 'lilas': '#b39ddb',
  'lavanda': '#c5b3e0', 'violeta': '#7a4ba0',
  'azul': '#2a5db0', 'azul marinho': '#1c2e4a', 'marinho': '#1c2e4a', 'azul claro': '#a8c8e0',
  'azul serenity': '#91a8d0', 'azul bebe': '#b8d4e8', 'azul royal': '#2747a8', 'azul jeans': '#3b5b78',
  'petroleo': '#1f5460', 'turquesa': '#30b3a8', 'tiffany': '#81d8d0', 'azul piscina': '#4fb6c4',
  'verde': '#2e7d4f', 'verde militar': '#4a5d3a', 'verde musgo': '#5a5e2d', 'verde oliva': '#6b6e2a',
  'oliva': '#808000', 'verde salvia': '#87a96b', 'salvia': '#87a96b', 'verde agua': '#a8d8c8',
  'verde bandeira': '#1c6b3c', 'verde limao': '#b6d94c', 'verde esmeralda': '#1f7a5a',
  'cinza': '#888888', 'cinza claro': '#c8c8c8', 'cinza escuro': '#555555', 'chumbo': '#4a4f54',
  'grafite': '#3a3f44', 'prata': '#c0c0c0', 'mocaccino': '#8c7361', 'mescla': '#9a9a96',
};

function doMapa(nome) {
  const n = norm(nome);
  if (MAPA[n]) return MAPA[n];
  // tenta por palavra-chave (ex: "verde abacate" -> verde) pra nao falhar feio
  const tokens = n.split(/\s+/);
  for (const base of ['verde', 'azul', 'rosa', 'vermelho', 'marrom', 'cinza', 'amarelo', 'roxo', 'laranja']) {
    if (tokens.includes(base) && MAPA[base]) return MAPA[base];
  }
  return null;
}

async function doIA(nome) {
  try {
    const cl = await chamarClaude({
      modelo: 'claude-sonnet-4-6',
      systemBlocks: [{ type: 'text', text: 'Voce recebe o nome de uma cor (portugues, contexto moda feminina). Responda APENAS o codigo hexadecimal no formato #rrggbb que melhor representa essa cor. Nada alem do hex. Sem explicacao, sem aspas.' }],
      messages: [{ role: 'user', content: String(nome).slice(0, 60) }],
      max_tokens: 16,
      temperature: 0,
      timeoutMs: 12000,
    });
    if (!cl.ok) return null;
    const m = (cl.texto || '').match(/#[0-9a-fA-F]{6}/);
    return m ? m[0].toLowerCase() : null;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    const nome = (req.query?.nome || '').toString().trim();
    if (!nome) return res.status(400).json({ error: 'nome obrigatorio' });

    const doMapaHex = doMapa(nome);
    if (doMapaHex) return res.json({ hex: doMapaHex, fonte: 'mapa' });

    const iaHex = await doIA(nome);
    if (iaHex) return res.json({ hex: iaHex, fonte: 'ia' });

    return res.json({ hex: null, fonte: 'nenhuma' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
