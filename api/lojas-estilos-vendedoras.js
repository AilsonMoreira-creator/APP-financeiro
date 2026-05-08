/**
 * lojas-estilos-vendedoras.js — Lista perfil de estilo de TODAS vendedoras
 *
 * Usado pelo painel admin pra mostrar:
 *   - qtd edicoes acumuladas
 *   - ultima edicao
 *   - tem analise gerada? (e quando)
 *   - aprende com qual vendedora? (referencia viva)
 *   - eh referencia de alguem?
 *
 * Auth: admin only.
 *
 * Sessao Ailson 07/05/2026.
 */
import { supabase, validarUsuario, setCors } from './_lojas-helpers.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Use GET' });

  const auth = await validarUsuario(req);
  if (!auth.ok) return res.status(auth.status || 403).json({ error: auth.error });
  if (!auth.isAdmin) return res.status(403).json({ error: 'Apenas admin' });

  // 1. Vendedoras ativas
  const { data: vendedoras } = await supabase
    .from('lojas_vendedoras')
    .select('id, nome, loja')
    .eq('ativa', true)
    .order('nome');

  if (!vendedoras?.length) return res.json({ vendedoras: [] });

  // 2. Estilos agregados
  const { data: estilos } = await supabase
    .from('lojas_estilo_vendedora')
    .select('*');
  const estiloMap = new Map((estilos || []).map(e => [e.vendedora_id, e]));

  // 3. Configs (analises e aprende_com) — pega tudo de uma vez
  const { data: configs } = await supabase
    .from('lojas_config')
    .select('chave, valor')
    .or(`chave.like.analise_estilo.%,chave.like.aprende_com.%`);

  const analiseMap = new Map();
  const aprendeMap = new Map(); // vendedora_id -> referencia_id
  for (const c of configs || []) {
    if (c.chave.startsWith('analise_estilo.')) {
      const vid = c.chave.replace('analise_estilo.', '');
      analiseMap.set(vid, c.valor);
    } else if (c.chave.startsWith('aprende_com.')) {
      const vid = c.chave.replace('aprende_com.', '');
      if (c.valor) aprendeMap.set(vid, c.valor);
    }
  }

  // 4. Quem é referência? (alguém aprende dela)
  const ehReferenciaSet = new Set([...aprendeMap.values()].filter(Boolean));

  // 5. Monta resposta
  const resposta = vendedoras.map(v => {
    const estilo = estiloMap.get(v.id);
    const analise = analiseMap.get(v.id);
    const aprendeCom = aprendeMap.get(v.id);
    const ehRef = ehReferenciaSet.has(v.id);

    // Aprendizes da vendedora (se for referencia)
    const aprendizes = [...aprendeMap.entries()]
      .filter(([_, refId]) => refId === v.id)
      .map(([vid]) => {
        const ven = vendedoras.find(x => x.id === vid);
        return ven ? { id: ven.id, nome: ven.nome, loja: ven.loja } : null;
      })
      .filter(Boolean);

    return {
      id: v.id,
      nome: v.nome,
      loja: v.loja,
      qtd_edicoes: estilo?.qtd_edicoes || 0,
      ultima_edicao_em: estilo?.ultima_edicao_em || null,
      tem_analise: !!analise,
      analise_em: analise?.geradoEm || null,
      analise: analise || null, // payload completo (texto_livre + estruturado + meta)
      aprende_com: aprendeCom || null, // id da referencia
      eh_referencia: ehRef,
      aprendizes, // quem aprende dessa vendedora
    };
  });

  return res.json({ vendedoras: resposta });
}
