// ============================================================================
// MELUNI — ações do fluxo de devolução (por peça). POST.
// body: { id, acao, operador, isAdmin, ...payload }
// acoes: avisar_etiqueta | marcar_recebido | conferir | salvar_estorno |
//        estornar | avisar_estorno | cancelar | arquivar
// Carimba _em (now) e _por (operador) em cada passo. Devolve a linha atualizada
// já relida da view (fluxo_status recalculado). Ailson 15/06/2026.
// ============================================================================
import { supabase } from './_bling-helpers.js';
import { enviarTemplateLara } from './_meluni-whats-meta.js';
import { cfgMeluni } from './_meluni-whats-helpers.js';

// forma/etapa -> chave da spec em meluni_config.lara_template_devolucao.templates
const SPEC_KEY = { etiqueta: 'instrucoes', pix: 'estorno_pix', cartao: 'estorno_cartao', credito: 'estorno_credito' };

// valor BR ("108,11" / "1.234,56") ou US ("108.11") -> número (ou null). NaN nunca vai pro numeric.
function parseValorBR(s) {
  if (s == null || s === '') return null;
  if (typeof s === 'number') return Number.isFinite(s) ? s : null;
  let t = String(s).trim();
  if (t === '') return null;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function telBR(t) {
  const d = String(t || '').replace(/\D/g, '');
  return (d.length >= 10 && d.length <= 11 && !d.startsWith('55')) ? '55' + d : d;
}
function primeiroNome(n) {
  const p = String(n || '').trim().split(/\s+/)[0] || '';
  return p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : null;
}
// valor em reais aceitando vírgula decimal BR ("119,90" / "R$ 1.199,90" / "119.90").
// Sem isso, Number("119,90") = NaN e o valor do estorno salvava como null. Ailson 25/06/2026.
function parseValorBR(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v).trim().replace(/[^\d.,-]/g, '');
  if (!s) return null;
  if (s.includes(',') && s.includes('.')) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.'); // 1.199,90
    else s = s.replace(/,/g, '');                                                              // 1,199.90
  } else if (s.includes(',')) {
    s = s.replace(',', '.');                                                                   // 119,90
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
async function nomeTpl(specKey) {
  const spec = await cfgMeluni('lara_template_devolucao', null);
  return spec?.templates?.[specKey]?.name || null;
}
async function acharOuCriarConversa(telefone, nome) {
  const { data: ex } = await supabase.from('meluni_conversas').select('id')
    .eq('canal', 'whatsapp').eq('telefone', telefone)
    .order('ultima_msg_em', { ascending: false }).limit(1).maybeSingle();
  if (ex?.id) return ex.id;
  const { data: nova } = await supabase.from('meluni_conversas').insert({
    canal: 'whatsapp', telefone, externo_id: telefone, nome_cliente: nome || null,
    origem: 'devolucao', etapa: 'conversando',
    ultima_msg_direcao: 'saida', ultima_msg_em: new Date().toISOString(),
  }).select('id').single();
  return nova?.id || null;
}

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
        const valor = parseValorBR(b.estorno_valor);
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
        const valor = parseValorBR(b.estorno_valor);
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
      case 'concluir_manual': {
        // Marca TODAS as etapas como concluidas SEM enviar mensagem (pros clientes
        // que ja receberam a msg durante o teste). So preenche os marcos vazios,
        // sem sobrescrever timestamps reais. NAO dispara WhatsApp. Ailson 22/06/2026.
        const { data: cur } = await supabase.from('vw_meluni_devolucoes').select('*').eq('id', id).maybeSingle();
        patch = {};
        if (!cur?.etiqueta_avisado_em) { patch.etiqueta_avisado_em = agora; patch.etiqueta_avisado_por = operador; }
        if (!cur?.recebido_em && !cur?.recebido_efetivo) patch.recebido_em = agora;
        if (!cur?.conferido) { patch.conferido = true; patch.conferido_em = agora; patch.conferido_por = operador; }
        if (!cur?.estornado_em) { patch.estornado_em = agora; patch.estornado_por = operador; }
        if (!cur?.cliente_avisado_em) { patch.cliente_avisado_em = agora; patch.cliente_avisado_por = operador; }
        break;
      }
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
      case 'mover_etapa': {
        // Move manual de etapa. Carimba a ENTRADA da etapa escolhida = agora e
        // limpa os marcos posteriores -> a view recalcula fluxo_status pra essa
        // etapa e fluxo_desde = agora, entao o prazo ZERA ao chegar na etapa.
        // Nao dispara WhatsApp. Ailson 24/06/2026.
        const etapa = (b.etapa || '').toString();
        const limparEstorno = { estornado_em: null, estornado_por: null };
        const limparAviso = { cliente_avisado_em: null, cliente_avisado_por: null };
        if (etapa === 'etiqueta') {
          patch = {
            etiqueta_avisado_em: agora, etiqueta_avisado_por: operador,
            recebido_em: null, conferido: false, conferido_em: null, conferido_por: null,
            ...limparEstorno, ...limparAviso,
          };
        } else if (etapa === 'recebida') {
          patch = {
            recebido_em: agora,
            conferido: false, conferido_em: null, conferido_por: null,
            ...limparEstorno, ...limparAviso,
          };
        } else if (etapa === 'pagamento') {
          patch = {
            conferido: true, conferido_em: agora, conferido_por: operador,
            ...limparEstorno, ...limparAviso,
          };
        } else if (etapa === 'estorno') {
          patch = {
            estornado_em: agora, estornado_por: operador,
            ...limparAviso,
          };
        } else {
          return res.status(400).json({ ok: false, erro: 'etapa invalida (use etiqueta|recebida|pagamento|estorno)' });
        }
        break;
      }
      default:
        return res.status(400).json({ ok: false, erro: `acao desconhecida: ${acao}` });
    }

    // ── envio do WhatsApp (template) pras ações de aviso ──
    let envio = null;
    if (acao === 'avisar_etiqueta' || acao === 'avisar_estorno') {
      let dev = (await supabase.from('meluni_devolucoes')
        .select('nome, telefone, estorno_forma').eq('convertr_id', id).limit(1)).data?.[0];
      if (!dev) dev = (await supabase.from('meluni_devolucoes')
        .select('nome, telefone, estorno_forma').eq('id', id).maybeSingle()).data;

      const tel = telBR(dev?.telefone);
      const pn = primeiroNome(dev?.nome);
      if (!tel) return res.status(400).json({ ok: false, erro: 'cliente sem telefone cadastrado' });
      if (!pn) return res.status(400).json({ ok: false, erro: 'cliente sem nome cadastrado' });

      const chave = acao === 'avisar_etiqueta' ? 'etiqueta' : dev?.estorno_forma;
      const specKey = SPEC_KEY[chave];
      if (!specKey) return res.status(400).json({ ok: false, erro: 'defina a forma de estorno (pix, cartão ou crédito) antes de avisar' });
      const tplName = await nomeTpl(specKey);
      if (!tplName) return res.status(400).json({ ok: false, erro: `template não configurado pra ${specKey}` });

      try {
        const r = await enviarTemplateLara(tel, tplName, [pn]);
        const metaMsgId = r?.messages?.[0]?.id || null;
        envio = { ok: true, template: tplName, meta_message_id: metaMsgId };
        const convId = await acharOuCriarConversa(tel, pn);
        if (convId) {
          await supabase.from('meluni_mensagens').insert({
            conversa_id: convId, direcao: 'saida', autor: `devolucao:${operador}`,
            tipo_midia: 'template', template_usado: tplName,
            texto: `[devolução] ${chave}`, meta_message_id: metaMsgId, enviada_em: agora,
          });
          await supabase.from('meluni_conversas').update({
            ultima_msg_direcao: 'saida', ultima_msg_em: agora, responder_em: null,
          }).eq('id', convId);
        }
      } catch (e) {
        return res.status(502).json({ ok: false, erro: `falha ao enviar WhatsApp: ${e?.message || e}` });
      }
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
    return res.json({ ok: true, devolucao: row || null, envio });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: e?.message || String(e) });
  }
}
