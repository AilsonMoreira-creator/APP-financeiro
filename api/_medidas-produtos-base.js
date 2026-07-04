// ============================================================================
// BASE ROBUSTA de produtos + medidas: tecidos, cores, TABELA de medidas,
// traducao numero->letra (44->GG etc.) e cores sazonais.
// Base da LARA (meluni-whats-ia.js). Copiada do SAC (ml-ai.js) em 04/07/2026.
// O SAC segue com a copia dele inline e INTOCADO; edite ESTE arquivo so pra Lara.
// ============================================================================
export const BASE_MEDIDAS_PRODUTOS = `TECIDOS (só fale composição se perguntarem):
• Linho/Viscolinho: tecido nobre, fibras naturais, pouco encolhimento. Composição: linho com viscose.
• Linho com Elastano: linho + 3% elastano, mais flexibilidade. Anúncio menciona "elastano".
• Verona: alfaiataria leve, bastante movimento, se ajusta ao corpo, leve elastano.
• Tricoline: tecido nobre de algodão.
• Suplex Poliamida: bastante elastano, mais respirável. Anúncio menciona "poliamida".
• Suplex (sem poliamida): poliéster com elastano.
FORRO: só diga se tem ou não. NUNCA composição.
CORES da loja: Preto, Bege, Natural, Figo, Marrom, Marrom Escuro, Azul Marinho, Vinho, Verde, Terracota, Rose, Off White, Cappuccino, Areia — são CORES, não tamanhos.
TABELA PADRÃO (medidas corporais cm): P(38,veste 36-38) B88-92 C70-75 Q96-102 | M(40) B92-96 C76-79 Q102-106 | G(42) B96-100 C80-83 Q106-110 | GG(44) B100-104 C84-86 Q110-114 | Plus: G1(46) B110 C92 Q124 | G2(48) B114 C96 Q128 | G3(50) B118 C100 Q132. Se anúncio tem tabela própria, use a do anúncio. Medidas em tamanhos diferentes → MAIOR + "costureira ajusta".
TRADUÇÃO NÚMERO→LETRA: 36→P (folgado, P ideal é 38), 38→P, 40→M, 42→G, 44→GG, 46→G1, 48→G2, 50→G3 (ideal), 52→G3 mas pode apertar levemente (pedir medidas). EX: "M veste 42?" → "M atende até 40, pra 42 o ideal é o G! Veste sim." "P veste 36?" → "Veste sim, pode ficar levemente folgado, P ideal é o 38." "G3 veste 50?" → "Sim! G3 é exatamente pro 50." "G3 veste 52?" → "Atende, pode apertar levemente — me passa busto/cintura/quadril pra confirmar."
BODY: fechamento na parte de baixo = COLCHETES/fechos, NUNCA "botão de pressão".
CORES SAZONAIS: cores escuras (vinho, marrom, preto, verde militar, bege, natural, terracota, cappuccino) = atemporais. Cores de VERÃO (azul claro, azul bebê, verde água) = ate julho, ai troca colecao (NAO afirme que volta). Cores de FIM DE ANO (off white, branco, amarelo, vermelho) = a partir outubro. Pergunta "vai voltar?" → "É cor de verão, em julho começa troca de coleção, pode não voltar nessa temporada. Próximo verão tem chance de voltar! Olha as outras cores nos anúncios." Off white/branco/amarelo/vermelho fora de out-dez → "Cor que trabalhamos mais perto do fim de ano, a partir de outubro!"`;
