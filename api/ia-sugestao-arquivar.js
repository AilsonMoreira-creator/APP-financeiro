/**
 * ia-sugestao-arquivar.js - Sprint 6.8
 *
 * Arquiva uma sugestao de corte (OS Amicia TabProducao) quando o usuario
 * clica num dos botoes OK / Nao / Aguardando tecido / Aguardar demanda.
 *
 * POST /api/ia-sugestao-arquivar
 *   Header: X-User: <usuario admin>
 *   Body:
 *     {
 *       "ref": "2927",
 *       "tipo_arquivo": "ok_sala_sem_matriz" | "nao" |
 *                       "aguardando_tecido_3d" | "aguardando_tecido_7d" |
 *                       "aguardando_tecido_15d" | "aguardar_demanda" |
 *                       "sim_gerou_ordem",
 *       "tipo_corte_no_arquivo": "tradicional" | "balanceamento" (opcional),
 *       "motivo": "texto livre" (opcional)
 *     }
 *
 * Calcula retorna_em baseado no tipo_arquivo:
 *   ok_sala_sem_matriz   -> agora + 3 dias (mais: expira quando ref sai
 *                           de sala_sem_matriz - tratado na view via
 *                           join condicional)
 *   nao                  -> agora + 10 dias
 *   aguardando_tecido_3d -> agora + 3 dias
 *   aguardando_tecido_7d -> agora + 7 dias
 *   aguardando_tecido_15d -> agora + 15 dias
 *   aguardar_demanda     -> NULL (indefinido - view filtra pelo tipo_corte)
 *   sim_gerou_ordem      -> NULL permanente (nao reaparece)
 */

import { validarAdmin, setCors, supabase } from './_ia-helpers.js';

const DIAS_POR_TIPO = {
  ok_sala_sem_matriz:     3,
  nao:                    10,
  aguardando_tecido_3d:   3,
  aguardando_tecido_7d:   7,
  aguardando_tecido_15d:  15,
};

const TIPOS_VALIDOS = [
  'ok_sala_sem_matriz',
  'nao',
  'aguardando_tecido_3d',
  'aguardando_tecido_7d',
  'aguardando_tecido_15d',
  'aguardar_demanda',
  'sim_gerou_ordem',
];

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const admin = await validarAdmin(req);
  if (!admin.ok) return res.status(admin.status).json({ error: admin.error });

  const { ref, tipo_arquivo, tipo_corte_no_arquivo, motivo } = req.body || {};

  // Validacoes basicas
  if (!ref || typeof ref !== 'string') {
    return res.status(400).json({ error: 'ref e obrigatoria (string)' });
  }
  if (!TIPOS_VALIDOS.includes(tipo_arquivo)) {
    return res.status(400).json({
      error: `tipo_arquivo invalido: ${tipo_arquivo}`,
      validos: TIPOS_VALIDOS,
    });
  }

  // Calcula retorna_em
  let retornaEm = null;
  if (DIAS_POR_TIPO[tipo_arquivo]) {
    const d = new Date();
    d.setDate(d.getDate() + DIAS_POR_TIPO[tipo_arquivo]);
    retornaEm = d.toISOString();
  }
  // aguardar_demanda e sim_gerou_ordem -> retorna_em = null (indefinido)

  // Normaliza ref (remove zeros a esquerda)
  const refNorm = String(ref).replace(/^0+/, '');

  try {
    const { data, error } = await supabase
      .from('ia_sugestoes_arquivadas')
      .insert({
        ref: refNorm,
        tipo_arquivo,
        tipo_corte_no_arquivo: tipo_corte_no_arquivo || null,
        retorna_em: retornaEm,
        arquivado_por: admin.usuario || 'ailson',
        motivo: motivo || null,
      })
      .select()
      .single();

    if (error) {
      console.error('[ia-sugestao-arquivar]', error);
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({
      ok: true,
      arquivo_id: data.id,
      ref: refNorm,
      tipo_arquivo,
      retorna_em: retornaEm,
      msg: retornaEm
        ? `Ref ${refNorm} arquivada ate ${retornaEm.slice(0, 10)}`
        : `Ref ${refNorm} arquivada (sem data de retorno)`,
    });
  } catch (e) {
    console.error('[ia-sugestao-arquivar] Exception:', e);
    return res.status(500).json({ error: e.message || 'Erro interno' });
  }
}
