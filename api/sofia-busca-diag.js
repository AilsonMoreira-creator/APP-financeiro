// /api/sofia-busca-diag — one-off: rastreia um cliente em TODAS as bases
// (Sofia, sacolas, leads, importacoes, cadastros) por nome, documento e
// telefone. ?nome= &doc=72449160000 &fone=11999999999
import { supabase } from './_lojas-whats-helpers.js';

const TABELAS = [
  'lojas_whats_capi_eventos',
  'lojas_whats_conversas', 'lojas_pedidos_sacola', 'lojas_leads_carrinho',
  'lojas_importacoes', 'lojas_clientes_kpis', 'clientes_sofia',
  'clientes_sofia_cadastro', 'clientes_sofia_dados', 'lojas_clientes',
];

export default async function handler(req, res) {
  if (req.query?.capi === '1') {
    const { data } = await supabase.from('lojas_whats_capi_eventos')
      .select('*').order('created_at', { ascending: false }).limit(3);
    return res.status(200).json({ eventos: data || [] });
  }
  const nome = String(req.query?.nome || '').trim();
  const doc = String(req.query?.doc || '').replace(/\D/g, '');
  const fone = String(req.query?.fone || '').replace(/\D/g, '');
  if (!nome && !doc && !fone) return res.status(400).json({ erro: 'passa ?nome= e/ou ?doc= e/ou ?fone=' });
  const docFmt = doc.length === 11 ? `${doc.slice(0,3)}.${doc.slice(3,6)}.${doc.slice(6,9)}-${doc.slice(9)}` : null;
  const saida = {};
  for (const t of TABELAS) {
    try {
      const { data: um, error: e1 } = await supabase.from(t).select('*').limit(1);
      if (e1) { saida[t] = { erro: e1.message.slice(0, 60) }; continue; }
      const cols = Object.keys(um?.[0] || {});
      if (!cols.length) { saida[t] = { vazia: true }; continue; }
      const alvoNome = cols.filter(c => /nome|cliente(?!_id)/i.test(c) && !/id$/i.test(c));
      const alvoDoc = cols.filter(c => /cpf|cnpj|doc/i.test(c));
      const alvoFone = cols.filter(c => /fone|telefone|celular|whats/i.test(c));
      const ors = [];
      if (nome) alvoNome.forEach(c => ors.push(`${c}.ilike.%${nome}%`));
      if (doc) alvoDoc.forEach(c => { ors.push(`${c}.ilike.%${doc}%`); if (docFmt) ors.push(`${c}.ilike.%${docFmt}%`); });
      if (fone && fone.length >= 8) alvoFone.forEach(c => ors.push(`${c}.ilike.%${fone.slice(-8)}%`));
      if (!ors.length) { saida[t] = { sem_colunas_alvo: cols.slice(0, 12) }; continue; }
      const { data: hits, error: e2 } = await supabase.from(t).select('*').or(ors.join(',')).limit(5);
      if (e2) { saida[t] = { erro: e2.message.slice(0, 60) }; continue; }
      saida[t] = hits?.length ? hits : 0;
    } catch (e) { saida[t] = { erro: String(e?.message || e).slice(0, 60) }; }
  }
  return res.status(200).json(saida);
}
