// ═══════════════════════════════════════════════════════════════════════════
// /api/lojas-whats-ia-disparar-manual
// ═══════════════════════════════════════════════════════════════════════════
// Tamara clica no botao "robo" no chat e pede pra Sofia gerar uma sugestao
// AGORA, sem esperar o ritmo automatico (ex: catalogo 6h, follow_up vencendo).
//
// Logica:
// - Verifica ultima msg do cliente:
//   - <24h (dentro da janela WhatsApp): chama IA normal → gera msg livre
//     como sugestao pendente (Tamara aprova como sempre)
//   - >=24h (fora da janela): Sofia escolhe template automaticamente
//     (followup_catalogo_24h_v1 | carrinho_abandonado_site_amicia_v2 |
//     visita_site_amicia_v1) e cria sugestao pendente. Tamara aprova
//     no fluxo normal — sem modal de templates tecnicos.
//
// POST { conversa_id }
// Resposta:
//   { ok, modo: 'livre' }            ← IA gerou msg livre
//   { ok, modo: 'sugestao_criada' }  ← Sofia escolheu template + criou sugestao
//
// Ailson 27/05/2026 (refator: trocou modo:'template' por sugestao_criada)
// ═══════════════════════════════════════════════════════════════════════════

import { supabase, setCors, logErro } from './_lojas-whats-helpers.js';

const JANELA_24H_MS = 24 * 60 * 60 * 1000;

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  try {
    const { conversa_id } = req.body || {};
    if (!conversa_id) return res.status(400).json({ error: 'conversa_id_obrigatorio' });

    // 1. Pega ultima msg do cliente pra detectar janela 24h
    const { data: ultimaBuyer } = await supabase
      .from('lojas_whats_mensagens')
      .select('enviada_em')
      .eq('conversa_id', conversa_id)
      .eq('direcao', 'entrada')
      .order('enviada_em', { ascending: false })
      .limit(1)
      .maybeSingle();

    const dentroJanela = ultimaBuyer &&
      (Date.now() - new Date(ultimaBuyer.enviada_em).getTime()) < JANELA_24H_MS;

    if (dentroJanela) {
      // DENTRO da janela: aciona IA pra gerar sugestao livre
      // (chama endpoint interno pra reusar toda logica de processarConversa)
      const host = req.headers?.host || process.env.VERCEL_URL;
      const proto = host?.includes('localhost') ? 'http' : 'https';
      const r = await fetch(`${proto}://${host}/api/lojas-whats-ia`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversa_id }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        return res.status(502).json({
          error: 'ia_falhou',
          detalhe: data.error || `HTTP ${r.status}`,
        });
      }
      return res.status(200).json({
        ok: true, modo: 'livre', detalhe: data,
      });
    }

    // FORA da janela: Sofia escolhe template automaticamente baseado em contexto
    // e cria uma sugestao pendente — Tamara aprova na aba "Aprovar" como sempre.
    // (Ailson 27/05/2026 — substituiu o modal de templates tecnicos)
    const { data: conv } = await supabase
      .from('lojas_whats_conversas')
      .select('id, telefone, nome_cliente, qtd_pecas, catalogo_enviado_em')
      .eq('id', conversa_id)
      .maybeSingle();
    if (!conv) return res.status(404).json({ error: 'conversa_nao_encontrada' });

    // Regra de escolha:
    //  catalogo enviado <48h → followup_catalogo_24h_v1
    //  qtd_pecas >= 1       → carrinho_abandonado_site_amicia_v2
    //  else (so visitou)    → visita_site_amicia_v1
    const agora48h = new Date(Date.now() - 48 * 60 * 60 * 1000);
    let templateName;
    if (conv.catalogo_enviado_em && new Date(conv.catalogo_enviado_em) > agora48h) {
      templateName = 'followup_catalogo_24h_v1';
    } else if (Number(conv.qtd_pecas || 0) >= 1) {
      templateName = 'carrinho_abandonado_site_amicia_v2';
    } else {
      templateName = 'visita_site_amicia_v1';
    }

    const { data: tpl } = await supabase
      .from('lojas_whats_templates')
      .select('name, body_text, language, variables')
      .eq('name', templateName)
      .eq('ativo', true)
      .maybeSingle();
    if (!tpl) return res.status(500).json({ error: `template ${templateName} nao encontrado` });

    // Monta vars APENAS com as chaves que o template declara em tpl.variables.
    // Importante: enviar parameter a mais pra Meta = template rejeitado.
    // Ex: visita_site_amicia_v1 tem so [{nome:'1'}] → vars = {'1': nome}
    //     carrinho_abandonado_site_amicia_v2 tem [{nome:'1'},{nome:'2'}] → +qtd
    const primeiroNome = (conv.nome_cliente || 'cliente').split(' ')[0];
    const valorPorChave = {
      '1': primeiroNome,
      '2': String(conv.qtd_pecas || 0),
    };
    const declaradas = Array.isArray(tpl.variables) ? tpl.variables : [];
    const vars = {};
    for (const v of declaradas) {
      const k = String(v?.nome ?? '');
      if (k && valorPorChave[k] !== undefined) vars[k] = valorPorChave[k];
    }

    // Renderiza texto_proposto pra UI
    let textoProposto = tpl.body_text;
    for (const [k, v] of Object.entries(vars)) {
      textoProposto = textoProposto.replaceAll(`{{${k}}}`, v);
    }

    // Cria sugestao pendente
    const { data: sug, error: errSug } = await supabase
      .from('lojas_whats_sugestoes')
      .insert({
        conversa_id,
        tipo: 'primeira_mensagem',
        template_name: tpl.name,
        template_vars: vars,
        texto_proposto: textoProposto,
        status: 'pendente',
        motivo_proposta: 'tamara_pediu_sofia_gerar',
      })
      .select()
      .single();
    if (errSug) throw errSug;

    // Move conversa pra etapa 'aprovar' (se nao estiver)
    await supabase
      .from('lojas_whats_conversas')
      .update({ etapa: 'aprovar', atualizado_em: new Date().toISOString() })
      .eq('id', conversa_id);

    return res.status(200).json({
      ok: true,
      modo: 'sugestao_criada',
      template: tpl.name,
      sugestao_id: sug.id,
    });
  } catch (e) {
    logErro('ia-disparar-manual', e);
    return res.status(500).json({ error: e.message });
  }
}
