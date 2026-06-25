// ============================================================================
// MELUNI — leitura dos carrinhos RECUPERÁVEIS (cards, via service-role).
// Lê de vw_meluni_carrinhos, que já aplica as regras: só carrinho com PEÇAS
// (>=1) e com TELEFONE. A view também marca is_cliente (telefone/email bate
// com um comprador). Carrinho sem peça ou sem contato nem aparece.
// Query: status (default processando), limite (default 60), offset (0).
// Junta nome/whatsapp do cliente vinculado. Ailson 15/06/2026.
// ============================================================================
import { supabase } from './_bling-helpers.js';
import { chaveTel } from './_meluni-tel.js';
import { telefonesConvertidos, pendenciaCarrinho } from './_meluni-pendencias-core.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const q = req.query || {};
  const status = q.status || 'processando';
  const limite = Math.min(200, parseInt(q.limite || '60', 10) || 60);
  const offset = Math.max(0, parseInt(q.offset || '0', 10) || 0);
  const dias = q.dias !== undefined ? (parseInt(q.dias, 10) || 0) : 30; // default: só últimos 30 dias; dias=0 = todos

  try {
    let query = supabase.from('vw_meluni_carrinhos')
      .select('id,cliente_id,nome,telefone,email,valor,itens,data_carrinho,status,planilha_ref,n_itens,is_cliente,enviado_em,segundo_envio_em,ultima_interacao_em,convertido_em', { count: 'exact' })
      .eq('status', status);
    if (dias > 0) query = query.gte('data_carrinho', new Date(Date.now() - dias * 86400000).toISOString());
    const { data, count, error } = await query
      .order('data_carrinho', { ascending: false, nullsFirst: false })
      .range(offset, offset + limite - 1);
    if (error) throw new Error(error.message);
    let lista = data || [];

    // enriquece com nome/whatsapp do cliente vinculado (quando houver)
    const ids = [...new Set(lista.map(c => c.cliente_id).filter(Boolean))];
    if (ids.length) {
      const { data: cls } = await supabase.from('meluni_clientes').select('id,nome,whatsapp').in('id', ids);
      const m = new Map((cls || []).map(c => [c.id, c]));
      lista = lista.map(c => {
        const cl = c.cliente_id ? m.get(c.cliente_id) : null;
        return { ...c, cliente_nome: cl?.nome || null, cliente_whatsapp: cl?.whatsapp || null };
      });
    }

    // carrinhos já convertidos (cliente comprou) não pingam mais o badge de recuperação.
    // Regra centralizada em _meluni-pendencias-core — a MESMA que o badge das abas
    // (meluni-pendencias) usa, pra os dois nunca divergirem. Ailson 24/06/2026.
    const convTel = await telefonesConvertidos(supabase);

    // conversa sem resposta (origem carrinho, última msg "in")
    const { data: convsPend } = await supabase.from('meluni_conversas')
      .select('cliente_id, telefone, etapa, visto_em, ultima_msg_em')
      .eq('origem', 'carrinho')
      .in('ultima_msg_direcao', ['in', 'entrada']);
    const pendCli = new Set(), pendTel = new Set();
    const unread = {};
    for (const c of (convsPend || [])) {
      if (!pendenciaCarrinho(c, convTel)) continue;   // não-vista E não é quem já comprou
      const k = chaveTel(c.telefone);
      if (c.cliente_id) pendCli.add(c.cliente_id);
      if (k) pendTel.add(k);
      const et = c.etapa || 'conversando';
      unread[et] = (unread[et] || 0) + 1;
    }
    lista = lista.map(c => {
      const k = chaveTel(c.cliente_whatsapp || c.telefone || '');
      const pend = (c.cliente_id && pendCli.has(c.cliente_id)) || (k && pendTel.has(k));
      return { ...c, conversa_pendente: !!pend };
    });

    // SKU -> ref + descrição (mesmo caminho do módulo Bling vendas: ml_sku_ref_map)
    const skus = [...new Set(
      lista.flatMap(c => Array.isArray(c.itens) ? c.itens.map(i => i?.sku).filter(Boolean) : [])
    )];
    if (skus.length) {
      const mapaSku = new Map();
      for (let i = 0; i < skus.length; i += 300) {
        const { data: rows } = await supabase.from('ml_sku_ref_map')
          .select('sku, ref, desc_limpa').in('sku', skus.slice(i, i + 300));
        for (const r of (rows || [])) mapaSku.set(r.sku, r);
      }
      lista = lista.map(c => {
        if (!Array.isArray(c.itens)) return c;
        const itens = c.itens.map(it => {
          const r = it?.sku ? mapaSku.get(it.sku) : null;
          return { ...it, ref: r?.ref || it.ref || null, descricao: r?.desc_limpa || it.descricao || null };
        });
        return { ...c, itens };
      });
    }

    return res.json({ ok: true, total: count ?? lista.length, offset, limite, unread, carrinhos: lista });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: e?.message || String(e) });
  }
}
