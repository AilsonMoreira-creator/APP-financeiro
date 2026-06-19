// ============================================================================
// MELUNI — lista do inbox SAC (WhatsApp da Lara + Direct Insta). GET.
// query: ?aba=conversando|follow_up|arquivo
// Buckets: arquivo = resolvido OU frio (>3d sem msg); follow_up = acompanhar=true;
// conversando = o resto ativo. Anexa preview da última msg + flag de não-lida.
// Ailson 16/06/2026.
// ============================================================================
import { supabase } from './_meluni-whats-helpers.js';

const DIAS_FRIO = 3;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const aba = req.query.aba || 'conversando';
  try {
    const { data: convs, error } = await supabase.from('meluni_conversas')
      .select('id, telefone, nome_cliente, cliente_id, canal, externo_id, origem, etapa, acompanhar, prioridade, resolvido_em, ultima_msg_em, ultima_msg_direcao, visto_em')
      .in('canal', ['whatsapp', 'direct_insta', 'email'])
      .order('ultima_msg_em', { ascending: false, nullsFirst: false })
      .limit(300);
    if (error) throw error;

    const agora = Date.now();
    const frioMs = DIAS_FRIO * 86400000;
    const bucketDe = (c) => {
      const arquivado = !!c.resolvido_em || (c.ultima_msg_em && (agora - new Date(c.ultima_msg_em).getTime()) > frioMs);
      if (arquivado) return 'arquivo';
      if (c.acompanhar) return 'follow_up';
      return 'conversando';
    };

    // "precisa de ação" = última msg é da cliente (entrada) E ainda não foi vista.
    // Abrir a conversa grava visto_em; resposta que não pede ação some do badge.
    const precisaAcao = (c) => c.ultima_msg_direcao === 'entrada'
      && (!c.visto_em || new Date(c.ultima_msg_em) > new Date(c.visto_em));

    // SAC = dúvidas do site + Direct do Insta. Não mostra carrinho (aba Carrinho)
    // nem cliente (disparo da carteira vive na aba Clientes).
    const filtradas = (convs || []).filter(c => c.origem !== 'carrinho' && c.origem !== 'cliente' && bucketDe(c) === aba);

    // preview da última mensagem de cada conversa filtrada
    const ids = filtradas.map(c => c.id);
    const previews = {};
    if (ids.length) {
      const { data: msgs } = await supabase.from('meluni_mensagens')
        .select('conversa_id, texto, tipo_midia, enviada_em')
        .in('conversa_id', ids)
        .order('enviada_em', { ascending: false })
        .limit(ids.length * 4);
      for (const m of (msgs || [])) {
        if (!previews[m.conversa_id]) {
          previews[m.conversa_id] = (m.texto || (m.tipo_midia && m.tipo_midia !== 'text' ? `[${m.tipo_midia}]` : '')) || '';
        }
      }
    }

    const lista = filtradas.map(c => ({
      ...c,
      preview: previews[c.id] || '',
      unread: precisaAcao(c),
    }));
    // prioridade (estrela) primeiro; dentro disso mantém ordem por ultima_msg_em
    lista.sort((a, b) => (b.prioridade ? 1 : 0) - (a.prioridade ? 1 : 0));

    // contadores das abas (badge) = só o que PRECISA DE AÇÃO (não-lido); exclui carrinho e cliente.
    const cont = { conversando: 0, follow_up: 0, arquivo: 0 };
    for (const c of (convs || [])) { if (c.origem === 'carrinho' || c.origem === 'cliente') continue; if (precisaAcao(c)) cont[bucketDe(c)]++; }

    return res.json({ ok: true, conversas: lista, contadores: cont });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: e?.message || String(e) });
  }
}
