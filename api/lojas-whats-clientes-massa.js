// ═══════════════════════════════════════════════════════════════════════════
// /api/lojas-whats-clientes-massa — preparar mensagem em massa (módulo Clientes)
// ═══════════════════════════════════════════════════════════════════════════
// POST { cliente_ids: [...], etapa: 'feedback'|'inativo', template_name }
//
// Pra cada cliente selecionado:
//   1. acha/cria conversa zerada (etapa própria do módulo)
//   2. cria uma sugestão 'primeira_mensagem' PENDENTE com o template escolhido
//      (renderizada com o 1º nome / qtd, conforme as vars que o template declara)
//
// As mensagens caem na fila APROVAR — daí o envio HSM sai pelo caminho já testado
// (lojas-whats-aprovar → Meta). NÃO dispara WhatsApp direto aqui (segurança:
// até 491 clientes; e não há template de feedback/inativo aprovado ainda).
//
// Retorna { preparados, pulados, erros, total }.
// ═══════════════════════════════════════════════════════════════════════════

import { supabase, normalizarTelefone } from './_lojas-whats-helpers.js';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

const ETAPAS_OK = ['feedback', 'inativo'];
const LIMITE = 500; // trava de segurança

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  try {
    const { cliente_ids, etapa, template_name } = req.body || {};
    if (!Array.isArray(cliente_ids) || cliente_ids.length === 0) {
      return res.status(400).json({ error: 'cliente_ids_obrigatorio' });
    }
    if (cliente_ids.length > LIMITE) {
      return res.status(400).json({ error: `limite_${LIMITE}_excedido` });
    }
    const etapaFinal = ETAPAS_OK.includes(etapa) ? etapa : 'feedback';
    if (!template_name) return res.status(400).json({ error: 'template_name_obrigatorio' });

    // Carrega template (precisa estar ativo)
    const { data: tpl } = await supabase
      .from('lojas_whats_templates')
      .select('name, body_text, language, variables')
      .eq('name', template_name)
      .eq('ativo', true)
      .maybeSingle();
    if (!tpl) return res.status(400).json({ error: 'template_invalido_ou_inativo' });
    const declaradas = Array.isArray(tpl.variables) ? tpl.variables : [];

    let preparados = 0, pulados = 0;
    const erros = [];

    for (const clienteId of cliente_ids) {
      try {
        // 1) cadastro do cliente
        const { data: cli } = await supabase
          .from('lojas_clientes')
          .select('telefone_principal, razao_social, comprador_nome')
          .eq('id', clienteId)
          .maybeSingle();
        if (!cli) { erros.push({ clienteId, erro: 'cliente_nao_encontrado' }); continue; }
        const tel = normalizarTelefone(cli.telefone_principal);
        if (!tel) { erros.push({ clienteId, erro: 'telefone_invalido' }); continue; }
        const nome = cli.razao_social || cli.comprador_nome || null;

        // 2) acha/cria conversa não-terminal
        let conversaId;
        const { data: existentes } = await supabase
          .from('lojas_whats_conversas')
          .select('id')
          .eq('cliente_id', clienteId)
          .not('etapa', 'in', '(vendeu,perdida)')
          .order('atualizado_em', { ascending: false })
          .limit(1);
        if (existentes && existentes.length > 0) {
          conversaId = existentes[0].id;
        } else {
          const { data: nova, error: eN } = await supabase
            .from('lojas_whats_conversas')
            .insert({ cliente_id: clienteId, telefone: tel, nome_cliente: nome, etapa: etapaFinal })
            .select('id').single();
          if (eN) { erros.push({ clienteId, erro: eN.message }); continue; }
          conversaId = nova.id;
        }

        // já tem sugestão pendente? pula (evita duplicar)
        const { data: pend } = await supabase
          .from('lojas_whats_sugestoes')
          .select('id')
          .eq('conversa_id', conversaId)
          .eq('status', 'pendente')
          .limit(1);
        if (pend && pend.length > 0) { pulados++; continue; }

        // 3) monta vars só com as chaves declaradas + renderiza texto
        const primeiroNome = (nome || 'cliente').split(' ')[0];
        const valorPorChave = { '1': primeiroNome };
        const vars = {};
        for (const v of declaradas) {
          const k = String(v?.nome ?? '');
          if (k && valorPorChave[k] !== undefined) vars[k] = valorPorChave[k];
        }
        let textoProposto = tpl.body_text;
        for (const [k, val] of Object.entries(vars)) {
          textoProposto = textoProposto.replaceAll(`{{${k}}}`, val);
        }

        const { error: eS } = await supabase
          .from('lojas_whats_sugestoes')
          .insert({
            conversa_id: conversaId,
            tipo: 'primeira_mensagem',
            template_name: tpl.name,
            template_vars: vars,
            texto_proposto: textoProposto,
            status: 'pendente',
            motivo_proposta: `clientes_massa_${etapaFinal}`,
          });
        if (eS) { erros.push({ clienteId, erro: eS.message }); continue; }
        preparados++;
      } catch (e) {
        erros.push({ clienteId, erro: e.message });
      }
    }

    return res.status(200).json({
      ok: true, preparados, pulados, erros, total: cliente_ids.length,
    });
  } catch (e) {
    console.error('[lojas-whats-clientes-massa]', e.message);
    return res.status(500).json({ error: e.message });
  }
}
