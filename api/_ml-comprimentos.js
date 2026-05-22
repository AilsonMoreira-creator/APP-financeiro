// ═══════════════════════════════════════════════════════════════════════════
// _ml-comprimentos.js — Tabela de COMPRIMENTO POR REF + helpers
// ═══════════════════════════════════════════════════════════════════════════
// Cliente do ML pergunta muito comprimento das pecas. Antes IA respondia
// generico ('modelo tem 1,68m, da pra ter boa noção'). Agora: IA olha o REF
// do anuncio + consulta esta tabela. Se tem -> da medida especifica. Se nao
// especificou tamanho -> da o M (default da grade).
//
// Compartilhado entre:
//   - api/ml-ai.js     (geracao de sugestao on-demand pelo admin)
//   - api/ml-webhook.js (auto-resposta via webhook ML)
//
// Pra ADICIONAR REF nova: insere no objeto TABELA_COMPRIMENTOS abaixo.
// REFs sao normalizadas (sem zeros a esquerda).
// Ailson 21/05/2026 — primeira tabela com 42 produtos.
// ═══════════════════════════════════════════════════════════════════════════

import { supabase } from './_ml-helpers.js';

export const TABELA_COMPRIMENTOS = {
  '376':  { P: 67, M: 68, G: 69, GG: 70 },
  '395':  { P: 67, M: 68, G: 69, GG: 70 },
  '1108': { P: 80, M: 81, G: 82, GG: 83 },
  '1628': { P: 38, M: 39, G: 40, GG: 41 },
  '2114': { P: 41, M: 42, G: 43 },
  '2277': { P: 74, M: 75, G: 76, GG: 77 },
  '2358': { P: 76, M: 77, G: 78, GG: 79 },
  '2361': { PP: 70, P: 71, M: 72, G: 73, GG: 74 },
  '2410': { P: 73, M: 74, G: 75, GG: 76 },
  '2502': { P: 70, M: 71, G: 72, GG: 73 },
  '2534': { P: 79, M: 80, G: 81, GG: 82 },
  '2553': { P: 79, M: 80, G: 81, GG: 82 },
  '2592': { P: 70, M: 71, G: 72, GG: 73 },
  '2600': { P: 113, M: 114, G: 115, GG: 116 },
  '2601': { P: 115, M: 116, G: 117, GG: 118 },
  '2638': { P: 70, M: 71, G: 72, GG: 73 },
  '2655': { P: 84, M: 85, G: 86, GG: 87 },
  '2671': { P: 55, M: 56, G: 57, GG: 58 },
  '2700': { P: 151, M: 152, G: 153, GG: 154 },
  '2708': { P: 128, M: 129, G: 130, GG: 131 },
  '2723': { P: 89, M: 90, G: 91, GG: 92 },
  '2733': { P: 79, M: 80, G: 81, GG: 82 },
  '2773': { '106': 123, '110': 124, '114': 125 },
  '2776': { '46': 79, '48': 80, '50': 81 },
  '2782': { P: 124, M: 125, G: 126, GG: 127 },
  '2790': { P: 114, M: 115, G: 116, GG: 117 },
  '2798': { P: 108, M: 109, G: 110, GG: 111 },
  '2807': { P: 35, M: 36, G: 37, GG: 38 },
  '2820': { G1: 45, G2: 46, G3: 47 },
  '2822': { '92': 117, '96': 118, '100': 119 },
  '2823': { G1: 156, G2: 157, G3: 158 },
  '2832': { P: 131, M: 132, G: 133, GG: 134 },
  '2851': { P: 117, M: 118, G: 119, GG: 120 },
  '2864': { P: 110, M: 111, G: 112, GG: 113 },
  '2881': { P: 149, M: 150, G: 151, GG: 152 },
  '2891': { P: 115, M: 116, G: 117, GG: 118 },
  '2902': { P: 79, M: 80, G: 81, GG: 82 },
  '2927': { P: 117, M: 118, G: 119, GG: 120 },
  '2934': { G1: 112, G2: 113, G3: 114 },
  '3150': { P: 89, M: 90, G: 91, GG: 92 },
  '5':    { P: 55, M: 56, G: 57, GG: 58 },  // referencia "005" normalizada
  '3186': { P: 70, M: 71, G: 72, GG: 73 },
};

/**
 * Extrai REF normalizada de uma string de seller_custom_field do ML.
 * Estrategia em camadas:
 *   1) Match direto por regex (REF clara no scf: '2708', 'z02708', '(2782)/preto')
 *   2) Lookup em ml_scf_ref_map (formato real 'z23041476303' nao tem REF nos digitos)
 * Retorna REF normalizada (sem zeros a esquerda) que bate na TABELA_COMPRIMENTOS,
 * ou null se nao encontrar.
 */
export async function refFromAnuncio(scf) {
  if (!scf) return null;
  const s = String(scf).trim();
  // Camada 1: regex direto
  const candidatos = (s.match(/\d+/g) || []).map(d => d.replace(/^0+/, '') || '0');
  for (const c of candidatos) {
    if (TABELA_COMPRIMENTOS[c]) return c;
  }
  // Camada 2: lookup no mapping (scf formato z23041476303 -> ref real)
  try {
    const { data: row } = await supabase
      .from('ml_scf_ref_map')
      .select('ref')
      .eq('scf', s)
      .maybeSingle();
    if (row?.ref) {
      const refNorm = String(row.ref).replace(/^0+/, '') || '0';
      if (TABELA_COMPRIMENTOS[refNorm]) return refNorm;
    }
  } catch (e) {
    console.warn('[ml-comprimentos] lookup scf_ref_map falhou:', e?.message);
  }
  return null;
}

/**
 * Gera o bloco de texto pra injetar no itemContext, ou null se nao bate.
 * Retorna algo como:
 *   COMPRIMENTO POR TAMANHO (tabela oficial):
 *     P: 124cm
 *     M: 125cm
 *     ...
 */
export async function gerarBlocoComprimento(scf) {
  const ref = await refFromAnuncio(scf);
  if (!ref || !TABELA_COMPRIMENTOS[ref]) return null;
  const t = TABELA_COMPRIMENTOS[ref];
  const linhas = Object.entries(t).map(([tam, cm]) => `  ${tam}: ${cm}cm`).join('\n');
  return `\n\nCOMPRIMENTO POR TAMANHO (tabela oficial):\n${linhas}`;
}

/**
 * Bloco de regras pra injetar no system prompt. Usado tanto por ml-ai como
 * por ml-webhook pra manter regras alinhadas. Substitui as 2 regras antigas
 * (COMPRIMENTO EM CM SEM INFO + SAIA LINHO MIDI).
 */
export const REGRAS_COMPRIMENTO_PROMPT = `COMPRIMENTO (Ailson 21/05/2026): Se o contexto tem bloco "COMPRIMENTO POR TAMANHO" → USE essa tabela como fonte oficial. Regras de uso:
  1. Cliente perguntou COM tamanho específico ("o GG tem quantos cm?", "qual o comprimento do P?") → responde APENAS o tamanho perguntado: "O GG tem XXcm de comprimento". Pode complementar com "A modelo da foto tem 1,68m, dá pra ter uma boa noção pelas imagens" SE fizer sentido visual.
  2. Cliente perguntou SEM tamanho específico ("qual o comprimento?", "tem quantos cm?") → responde o tamanho M (default da grade P/M/G/GG) ou o do MEIO se a grade for diferente (ex: G2 pra plus, 110 pra grade 106/110/114, 48 pra 46/48/50): "Tem XXcm de comprimento no tamanho M. Os outros tamanhos variam ~1cm entre cada. A modelo da foto tem 1,68m, dá pra ter uma boa noção pelas imagens!"
  3. Cliente perguntou comprimento DE TODOS os tamanhos → lista tudo: "P: 74cm, M: 75cm, G: 76cm, GG: 77cm".
SEM TABELA: Se NÃO veio bloco "COMPRIMENTO POR TAMANHO" no contexto e cliente pergunta cm de comprimento → NÃO invente cm E NÃO diga "entre em contato pelo anúncio" (canal não existe na pré-venda do ML). Ofereça referência visual: "Infelizmente o comprimento em cm não está no anúncio. Como referência, a modelo da foto tem 1,68m de altura — dá pra ter uma boa noção pelas imagens!"
SAIA LINHO MIDI sem tabela: título com "saia"+"linho" e cliente pergunta comprimento → "Nossas saias midi de linho têm em média 75cm de comprimento, podendo variar um pouco por modelo e tamanho. A modelo da foto tem 1,68m de altura e a saia fica um pouco abaixo do joelho."`;
