// ============================================================================
// MELUNI — ações do fluxo de devolução (por peça). POST.
// body: { id, acao, operador, isAdmin, ...payload }
// acoes: avisar_etiqueta | marcar_recebido | conferir | estornar |
//        avisar_estorno | cancelar | arquivar
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
      case 'estornar': {
        const valor = b.estorno_valor != null && b.estorno_valor !== '' ? Number(b.estorno_valor) : null;
        const desc = b.estorno_desconto_libere != null && b.estorno_desconto_libere !== '' ? Number(b.estorno_desconto_libere) : null;
        const forma = ['pix', 'cartao', 'credito'].includes(b.estorno_forma) ? b.estorno_forma : null;
        if (valor == null || !forma) return res.status(400).json({ ok: false, erro: 'estorno_valor e estorno_forma (pix|cartao|credito) obrigatorios' });
        patch = {
          estorno_valor: valor,
          estorno_desconto_libere: desc,
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

    const { error } = await supabase.from('meluni_devolucoes').update(patch).eq('id', id);
    if (error) throw new Error(error.message);

    // relê da view pra devolver fluxo_status atualizado
    const { data: row } = await supabase.from('vw_meluni_devolucoes').select('*').eq('id', id).maybeSingle();
    return res.json({ ok: true, devolucao: row || null });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: e?.message || String(e) });
  }
}
