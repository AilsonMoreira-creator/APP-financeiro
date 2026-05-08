/**
 * lojas-analisar-estilo.js — Análise textual do estilo de uma vendedora
 *
 * Pega ultimas N edicoes (default 20) e manda pra Claude gerar:
 *   - Texto livre descritivo (parágrafo natural)
 *   - Estruturado (tom, saudacoes, tratamentos, padrões de edição, etc)
 *
 * Salva em lojas_config chave 'analise_estilo.<vendedora_id>'.
 * Auth: admin only.
 *
 * Sessao Ailson 07/05/2026.
 */
import { supabase, validarUsuario, setCors, ehAdminLojas, chamarClaude, calcularCustoBRL, gastoMesAtualBRL, getIaConfig } from './_lojas-helpers.js';

const MIN_EDICOES = 5;
const MAX_EDICOES = 30;

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });

  // Auth: admin only
  const auth = await validarUsuario(req);
  if (!auth.ok) return res.status(auth.status || 403).json({ error: auth.error });
  if (!auth.isAdmin) return res.status(403).json({ error: 'Apenas admin pode analisar estilo' });

  const { vendedora_id, limite_edicoes } = req.body || {};
  if (!vendedora_id) return res.status(400).json({ error: 'vendedora_id obrigatorio' });

  const limite = Math.min(MAX_EDICOES, Math.max(MIN_EDICOES, parseInt(limite_edicoes) || 20));

  // 1. Carrega vendedora
  const { data: vendedora, error: vendErr } = await supabase
    .from('lojas_vendedoras')
    .select('id, nome, loja')
    .eq('id', vendedora_id)
    .maybeSingle();
  if (vendErr || !vendedora) {
    return res.status(404).json({ error: 'Vendedora não encontrada' });
  }

  // 2. Carrega edicoes
  const { data: edicoes, error: edErr } = await supabase
    .from('lojas_edicoes_mensagens')
    .select('texto_original, texto_editado, criado_em')
    .eq('vendedora_id', vendedora_id)
    .order('criado_em', { ascending: false })
    .limit(limite);
  if (edErr) return res.status(500).json({ error: edErr.message });

  if (!edicoes || edicoes.length < MIN_EDICOES) {
    return res.status(400).json({
      error: `Vendedora tem só ${edicoes?.length || 0} edicao(oes). Minimo ${MIN_EDICOES} pra analise confiavel.`,
      qtd_edicoes_atual: edicoes?.length || 0,
      minimo_necessario: MIN_EDICOES,
    });
  }

  // 3. Estatisticas rapidas dos contadores existentes
  const { data: estilo } = await supabase
    .from('lojas_estilo_vendedora')
    .select('*')
    .eq('vendedora_id', vendedora_id)
    .maybeSingle();

  // 4. Verifica orcamento Anthropic (esse endpoint custa ~R$0.05-0.10)
  const orcamentoMensal = Number(await getIaConfig('orcamento_mensal_brl', 80));
  const gastoAtual = await gastoMesAtualBRL();
  if (gastoAtual >= orcamentoMensal) {
    return res.status(429).json({
      error: 'Orcamento mensal Anthropic excedido',
      gasto_atual: gastoAtual,
      orcamento: orcamentoMensal,
    });
  }

  // 5. Monta prompt pra Claude
  const exemplosFormatados = edicoes.map((e, i) => {
    return `--- Exemplo ${i + 1} (${e.criado_em.slice(0, 10)}) ---\n` +
           `IA gerou:\n${e.texto_original}\n\n` +
           `${vendedora.nome} editou pra:\n${e.texto_editado}\n`;
  }).join('\n');

  const systemPrompt = `Voce eh um analista de comunicacao especializado em vendas no atacado de moda feminina. Sua tarefa eh analisar o ESTILO de uma vendedora baseando-se em mensagens que ela editou (vs versoes que a IA havia gerado).

Foque no QUE ELA MUDA, nao no que mantem. Exemplo: se IA gerou "Olá querida" e ela mudou pra "Oii linda", o padrao dela eh substituir saudacoes formais por informais.

Identifique:
1. Tom geral (calorosa, direta, formal, divertida, profissional, intimista)
2. Saudacoes iniciais e finais que ela prefere
3. Tratamentos (querida, linda, amor, mozão, princesa, etc)
4. Emojis recorrentes
5. Padroes de edicao (o que ela tipicamente ADICIONA e REMOVE)
6. Comprimento medio (curtas/medias/longas)
7. Caracteristicas linguisticas (uso de "vc", abreviacoes, exclamacoes, perguntas)

Responda em JSON com este shape:
{
  "texto_livre": "Paragrafo descritivo natural (2-4 frases) que resume o estilo dela. Tom de quem esta apresentando uma colega.",
  "estruturado": {
    "tom_geral": "string curta — 3-5 palavras",
    "saudacoes_iniciais": ["array de strings, max 5 — extraidas das edicoes"],
    "saudacoes_finais": ["array, max 5"],
    "tratamentos": ["array, max 5"],
    "emojis_frequentes": ["array de emojis, max 8"],
    "padroes_de_edicao": {
      "adiciona": ["coisas que ela tipicamente adiciona — array, max 5 itens curtos"],
      "remove": ["coisas que ela tipicamente remove — max 5"]
    },
    "comprimento_medio": "curta | media | longa",
    "linguagem": ["caracteristicas linguisticas — max 4"]
  }
}

Responda APENAS o JSON, sem markdown nem explicacao.`;

  const userPrompt = `Analise o estilo de comunicacao da vendedora ${vendedora.nome} (loja ${vendedora.loja}) baseado em ${edicoes.length} edicoes recentes:

${exemplosFormatados}

${estilo ? `\nEla ja tem ${estilo.qtd_edicoes} edicoes acumuladas no perfil dela.` : ''}

Responda APENAS o JSON conforme schema do system prompt.`;

  // 6. Chama Claude
  const inicio = Date.now();
  const modelo = 'claude-sonnet-4-6';
  let resposta;
  try {
    resposta = await chamarClaude({
      modelo,
      systemBlocks: [{ type: 'text', text: systemPrompt }],
      messages: [{ role: 'user', content: userPrompt }],
      max_tokens: 2000,
      temperature: 0.3, // baixo pra ser mais consistente/factual
      timeoutMs: 60000,
    });
  } catch (e) {
    return res.status(500).json({ error: 'Falha Claude: ' + (e.message || e) });
  }

  // 7. Parse JSON da resposta
  const textoIA = resposta.content?.[0]?.text || '';
  let analise;
  try {
    // Remove possivel cerca markdown
    const jsonStr = textoIA.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
    analise = JSON.parse(jsonStr);
  } catch (e) {
    return res.status(500).json({
      error: 'Resposta Claude nao foi JSON valido',
      raw: textoIA.slice(0, 500),
    });
  }

  // 8. Calcula custo
  const custoBRL = await calcularCustoBRL({
    modelo,
    input_tokens: resposta.usage?.input_tokens || 0,
    output_tokens: resposta.usage?.output_tokens || 0,
    cache_read_input_tokens: resposta.usage?.cache_read_input_tokens || 0,
    cache_creation_input_tokens: resposta.usage?.cache_creation_input_tokens || 0,
  });

  // 9. Salva em lojas_config
  const payload = {
    ...analise,
    geradoEm: new Date().toISOString(),
    qtd_edicoes_analisadas: edicoes.length,
    custo_brl: custoBRL,
    duracao_ms: Date.now() - inicio,
    modelo,
  };

  await supabase
    .from('lojas_config')
    .upsert({
      chave: `analise_estilo.${vendedora_id}`,
      valor: payload,
    }, { onConflict: 'chave' });

  return res.json({
    ok: true,
    vendedora: { id: vendedora.id, nome: vendedora.nome, loja: vendedora.loja },
    analise: payload,
  });
}
