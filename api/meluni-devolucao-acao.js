// ============================================================================
// MELUNI — ações do fluxo de devolução (por peça). POST.
// body: { id, acao, operador, isAdmin, ...payload }
// acoes: avisar_etiqueta | marcar_recebido | conferir | salvar_estorno |
//        estornar | avisar_estorno | cancelar | arquivar
// Carimba _em (now) e _por (operador) em cada passo. Devolve a linha atualizada
// já relida da view (fluxo_status recalculado). Ailson 15/06/2026.
// ============================================================================
import { supabase } from './_bling-helpers.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, erro: 'use POST' });

  const b = req.body || {};
  const id = b.id;
  const acao = b.acao;
  const operador = (b.operador || '').toString().slice(0, 60) || 'sistema';
  const agora = new Date().toISOString();
  if (!id || !acao) return res.status(400).json({ ok: false, erro: 'id e acao obrigatorios' });

  try {
    let patch = {};
    switch (acao) {
      case 'avisar_etiqueta':
        patch = { etiqueta_avisado_em: agora, etiqueta_avisado_por: operador };
        break;
      case 'marcar_recebido':
        patch = { recebido_em: agora };
        break;
      case 'conferir':
        patch = { conferido: true, conferido_em: agora, conferido_por: operador };
        break;
      case 'salvar_estorno': {
        // a assistente preenche e SALVA (não marca como pago). Sem estornado_em.
        const valor = b.estorno_valor != null && b.estorno_valor !== '' ? Number(b.estorno_valor) : null;
        const forma = ['pix', 'cartao', 'credito'].includes(b.estorno_forma) ? b.estorno_forma : null;
        patch = {
          estorno_valor: valor,
          estorno_forma: forma,
          estorno_pix_chave: forma === 'pix' ? (b.estorno_pix_chave || null) : null,
        };
        break;
      }
      case 'estornar': {
        // confirmação do pagamento (Ailson paga e confirma). Carimba estornado_em.
        const valor = b.estorno_valor != null && b.estorno_valor !== '' ? Number(b.estorno_valor) : null;
        const forma = ['pix', 'cartao', 'credito'].includes(b.estorno_forma) ? b.estorno_forma : null;
        if (valor == null || !forma) return res.status(400).json({ ok: false, erro: 'estorno_valor e estorno_forma (pix|cartao|credito) obrigatorios' });
        patch = {
          estorno_valor: valor,
          estorno_forma: forma,
          estorno_pix_chave: forma === 'pix' ? (b.estorno_pix_chave || null) : null,
          estornado_em: agora,
          estornado_por: operador,
        };
        break;
      }
      case 'avisar_estorno':
        patch = { cliente_avisado_em: agora, cliente_avisado_por: operador };
        break;
      case 'cancelar': {
        const motivo = (b.motivo || '').toString().trim();
        if (!motivo) return res.status(400).json({ ok: false, erro: 'motivo obrigatorio' });
        patch = { cancelada: true, cancelada_motivo: motivo.slice(0, 500), cancelada_em: agora, cancelada_por: operador };
        break;
      }
      case 'arquivar':
        if (b.isAdmin !== true) return res.status(403).json({ ok: false, erro: 'somente admin pode arquivar' });
        patch = { arquivada: true, arquivada_em: agora, arquivada_por: operador };
        break;
      default:
        return res.status(400).json({ ok: false, erro: `acao desconhecida: ${acao}` });
    }

    // o card agora é por PEDIDO (id = convertr_id do grupo). Carimba TODAS as
    // peças do mesmo retorno. Fallback por id (caso raro de convertr_id nulo).
    const upd = await supabase.from('meluni_devolucoes').update(patch).eq('convertr_id', id).select('id');
    if (upd.error) throw new Error(upd.error.message);
    if (!upd.data || upd.data.length === 0) {
      const upd2 = await supabase.from('meluni_devolucoes').update(patch).eq('id', id);
      if (upd2.error) throw new Error(upd2.error.message);
    }

    // relê da view (agrupada) pra devolver fluxo_status atualizado
    const { data: row } = await supabase.from('vw_meluni_devolucoes').select('*').eq('id', id).maybeSingle();
    return res.json({ ok: true, devolucao: row || null });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: e?.message || String(e) });
  }
}
