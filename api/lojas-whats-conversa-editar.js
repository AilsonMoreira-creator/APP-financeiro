// ═══════════════════════════════════════════════════════════════════════════
// lojas-whats-conversa-editar.js — Edita campos do card de lead
// ═══════════════════════════════════════════════════════════════════════════
//
// Assistente edita via UI:
//   - prioridade: 0 (normal) | 1 (prioritario) — sobe pro topo da etapa
//   - etapa: muda etapa do funil (livre, A da decisao 6)
//   - observacao_para_sofia: dica que entra no system prompt da Sofia
//   - observacao_assistente: anotacao privada (so assistente ve)
//   - prefere_site: true quando cliente disse "prefiro comprar pelo site"
//
// POST body: { conversa_id, campos: {prioridade?, etapa?, observacao_para_sofia?, ...}, usuario? }
//
// Ailson 26/05/2026
// ═══════════════════════════════════════════════════════════════════════════

import { supabase, setCors } from './_lojas-whats-helpers.js';

const CAMPOS_PERMITIDOS = new Set([
  'prioridade',
  'etapa',
  'follow_up_dias',
  'observacao_para_sofia',
  'observacao_assistente',
  'prefere_site',
  'catalogo_followup_pausado',
]);

const ETAPAS_VALIDAS = new Set([
  'processando','aprovar','enviada','conversando','quente','atendida','vendeu','perdida','follow_up','varejo',
]);

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST esperado' });

  try {
    const { conversa_id, campos, usuario } = req.body || {};
    if (!conversa_id) return res.status(400).json({ error: 'conversa_id obrigatorio' });
    if (!campos || typeof campos !== 'object') {
      return res.status(400).json({ error: 'campos obrigatorio (object)' });
    }

    const upd = { atualizado_em: new Date().toISOString() };
    const agora = new Date().toISOString();

    for (const [k, v] of Object.entries(campos)) {
      if (!CAMPOS_PERMITIDOS.has(k)) continue;

      if (k === 'prioridade') {
        // Apos cleanup de 26/05/2026, coluna canonica eh lead_prioritario (bool).
        // Aceita int (0/1) ou bool por compat com calls antigas.
        upd.lead_prioritario = (v === true || v === 1 || v === '1');
        continue;
      }
      if (k === 'etapa') {
        if (!ETAPAS_VALIDAS.has(v)) {
          return res.status(400).json({ error: `etapa invalida: ${v}` });
        }
        upd.etapa = v;
        // Mover pra 'vendeu' pelo modal precisa carimbar vendeu_em (senao a
        // venda some dos blocos que filtram por data — caso dos 5 cards sem
        // data em 05/07/2026). So preenche se ainda estiver null, preservando
        // data ja gravada pelo cron-capi-match. Ailson 05/07/2026.
        if (v === 'vendeu') {
          const { data: atual } = await supabase.from('lojas_whats_conversas')
            .select('vendeu_em').eq('id', conversa_id).maybeSingle();
          if (!atual?.vendeu_em) upd.vendeu_em = agora;
        }
        // NAO seta follow_up_vence_em aqui. Padrao ao mover pra follow_up =
        // NULL (nao envia nada, fica parado aguardando decisao manual). O
        // agendamento e feito pelo card via follow_up_dias (1d/3d/Nd) ou fica
        // NULL ("nao enviar por enquanto"). Ailson 01/06/2026.
        continue;
      }
      if (k === 'follow_up_dias') {
        // Agenda (ou nao) a retomada do follow-up.
        //   numero > 0  -> follow_up_vence_em = now + N dias (cron-followup
        //                  gera retomada quando vencer)
        //   null/0/etc  -> follow_up_vence_em = null (nao dispara nada)
        // Cap de sanidade em 365 dias. Ailson 01/06/2026.
        const n = Number(v);
        if (Number.isFinite(n) && n > 0) {
          const dias = Math.min(Math.floor(n), 365);
          upd.follow_up_vence_em = new Date(Date.now() + dias * 86400000).toISOString();
        } else {
          upd.follow_up_vence_em = null;
        }
        continue;
      }
      if (k === 'observacao_para_sofia') {
        upd.observacao_para_sofia = v || null;
        upd.obs_sofia_definida_em = v ? agora : null;
        upd.obs_sofia_definida_por = v ? (usuario || 'assistente') : null;
        continue;
      }
      if (k === 'observacao_assistente') {
        upd.observacao_assistente = v || null;
        continue;
      }
      if (k === 'prefere_site') {
        // Coluna canonica eh cliente_indicou_site (criada antes na sessao)
        upd.cliente_indicou_site = !!v;
        upd.cliente_indicou_site_em = v ? agora : null;
        continue;
      }
      if (k === 'catalogo_followup_pausado') {
        // Desmarcar/reativar o relogio de follow-up do catalogo (6h/24h). Ailson 29/05/2026.
        upd.catalogo_followup_pausado = !!v;
        continue;
      }
    }

    // Default do modal Editar lead: mover pra follow_up SEM informar dias =
    // "nao enviar por enquanto" (vence_em = null). O ajuste fino de 1d/3d/Nd
    // e feito depois pelo card. Ailson 01/06/2026.
    if (upd.etapa === 'follow_up' && !('follow_up_dias' in campos)) {
      upd.follow_up_vence_em = null;
    }

    const { data, error } = await supabase
      .from('lojas_whats_conversas')
      .update(upd)
      .eq('id', conversa_id)
      .select('id, etapa, lead_prioritario, observacao_para_sofia, observacao_assistente, cliente_indicou_site, obs_sofia_definida_em, follow_up_vence_em')
      .single();
    if (error) return res.status(500).json({ error: error.message });

    return res.json({ ok: true, conversa: data });
  } catch (e) {
    console.error('[conversa-editar] exception:', e);
    return res.status(500).json({ error: e.message });
  }
}
