/**
 * meluni-tags.js — Tags transversais da Meluni (Ailson 07/07/2026).
 *
 * Espelha o lojas-whats-tags.js do Sofia, mas na Meluni a tag e por TELEFONE
 * (chaveTel canonica), nao por linha: marca numa aba (Clientes/Carrinho/SAC)
 * e aparece nas tres. Defs em meluni_tags, vinculo em meluni_tags_vinculos.
 * O front da Meluni nao tem supabase client -> tudo passa por aqui (service role).
 *
 *   GET                                          -> lista defs
 *   POST   {id, nome, cor, congela_auto}         -> cria def custom
 *   DELETE {id}                                  -> exclui def nao-fixa (limpa dos vinculos)
 *   PATCH  {telefone, tags, reserva_alerta_em?}  -> grava tags no telefone canonico
 */
import { supabase } from './_meluni-whats-helpers.js';
import { chaveTel } from './_meluni-tel.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const { data, error } = await supabase.from('meluni_tags')
        .select('*').order('ordem').order('criada_em');
      if (error) throw error;
      return res.status(200).json({ ok: true, tags: data || [] });
    }

    if (req.method === 'POST') {
      const { id, nome, cor, congela_auto } = req.body || {};
      if (!id || !nome || !cor) return res.status(400).json({ ok: false, erro: 'id, nome e cor obrigatórios' });
      const { error } = await supabase.from('meluni_tags').insert({
        id: String(id).slice(0, 30), nome: String(nome).slice(0, 40), cor,
        congela_auto: !!congela_auto, requer_ref: false, fixa: false, ordem: 100,
      });
      if (error) return res.status(400).json({ ok: false, erro: error.message });
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ ok: false, erro: 'id obrigatório' });
      const { data: def } = await supabase.from('meluni_tags').select('fixa').eq('id', id).single();
      if (!def) return res.status(404).json({ ok: false, erro: 'tag não existe' });
      if (def.fixa) return res.status(400).json({ ok: false, erro: 'tag fixa não pode ser excluída' });
      await supabase.from('meluni_tags').delete().eq('id', id);
      // Limpa a tag dos vinculos que a usam (senao vira chip fantasma)
      const { data: usam } = await supabase.from('meluni_tags_vinculos')
        .select('telefone, tags').contains('tags', JSON.stringify([{ id }])).limit(5000);
      for (const v of (usam || [])) {
        const novas = (v.tags || []).filter(t => t.id !== id);
        await supabase.from('meluni_tags_vinculos')
          .update({ tags: novas, atualizado_em: new Date().toISOString() })
          .eq('telefone', v.telefone);
      }
      return res.status(200).json({ ok: true, limpas: (usam || []).length });
    }

    if (req.method === 'PATCH') {
      const { telefone, tags, reserva_alerta_em } = req.body || {};
      const chave = chaveTel(telefone);
      if (!chave || !Array.isArray(tags)) {
        return res.status(400).json({ ok: false, erro: 'telefone válido e tags (array) obrigatórios' });
      }
      const limpas = tags
        .filter(t => t && typeof t.id === 'string')
        .slice(0, 6)
        .map(t => {
          const o = { id: t.id.slice(0, 30) };
          if (t.ref) {
            o.ref = String(t.ref).slice(0, 12);
            // carimbo a criacao da reserva: base do alerta de 3 dias (so conta corte
            // entregue depois disso). Preserva em re-saves; cria no 1o save.
            o.desde = t.desde || new Date().toISOString();
          }
          return o;
        });
      // Colunas omitidas nao sao tocadas no update do upsert: so mexo em
      // reserva_alerta_em quando o front pede pra limpar (removeu a tag reserva).
      const row = { telefone: chave, tags: limpas, atualizado_em: new Date().toISOString() };
      if (reserva_alerta_em === null) row.reserva_alerta_em = null;
      const { error } = await supabase.from('meluni_tags_vinculos')
        .upsert(row, { onConflict: 'telefone' });
      if (error) return res.status(400).json({ ok: false, erro: error.message });
      return res.status(200).json({ ok: true, telefone: chave });
    }

    return res.status(405).json({ ok: false, erro: 'método não suportado' });
  } catch (e) {
    console.error('[meluni-tags]', e?.message);
    return res.status(500).json({ ok: false, erro: e?.message });
  }
}
