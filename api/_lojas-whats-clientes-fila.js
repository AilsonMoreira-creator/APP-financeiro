// ═══════════════════════════════════════════════════════════════════════════
// _lojas-whats-clientes-fila.js — worker da fila de envio em massa (Clientes)
// ═══════════════════════════════════════════════════════════════════════════
// processarFila(limite): pega até `limite` itens 'pendente', envia o HSM e
// atualiza o status. Usado pelo cron e pelo enqueue (primeiro lote inline).
// Mantém a etapa da conversa (feedback/inativo) — não vai pro funil do Sofia.
// ═══════════════════════════════════════════════════════════════════════════

import { supabase, normalizarTelefone } from './_lojas-whats-helpers.js';
import { enviarTemplate } from './_lojas-whats-meta-client.js';
import { primeiroNome as primeiroNomeProprio } from './_lojas-whats-helpers.js';

function montarVars(declaradas, valorPorChave) {
  const arr = [];
  for (const v of (Array.isArray(declaradas) ? declaradas : [])) {
    const k = String(v?.nome ?? '');
    arr.push(valorPorChave[k] !== undefined ? valorPorChave[k] : '');
  }
  return arr;
}

export async function processarFila(limite = 40) {
  // 1. candidatos pendentes
  const { data: cand } = await supabase
    .from('clientes_sofia_fila')
    .select('id, cliente_id, etapa, template_name')
    .eq('status', 'pendente')
    .order('criado_em', { ascending: true })
    .limit(limite);

  if (!cand || cand.length === 0) {
    return { processados: 0, enviados: 0, erros: 0, restantes: 0 };
  }

  // 2. claim (evita disparo duplo se cron e enqueue rodarem juntos)
  const ids = cand.map(c => c.id);
  const { data: claimed } = await supabase
    .from('clientes_sofia_fila')
    .update({ status: 'processando' })
    .in('id', ids)
    .eq('status', 'pendente')
    .select('id, cliente_id, etapa, template_name');

  const itens = claimed || [];
  const tplCache = new Map();
  let enviados = 0, erros = 0;
  const agora = () => new Date().toISOString();

  for (const item of itens) {
    try {
      // template (cache por nome)
      let tpl = tplCache.get(item.template_name);
      if (tpl === undefined) {
        const { data } = await supabase
          .from('lojas_whats_templates')
          .select('name, language, variables, ativo, body_text')
          .eq('name', item.template_name)
          .maybeSingle();
        tpl = (data && data.ativo) ? data : null;
        tplCache.set(item.template_name, tpl);
      }
      if (!tpl) {
        await marcarErro(item.id, `template_${item.template_name}_inexistente`);
        erros++; continue;
      }

      // cliente
      const { data: cli } = await supabase
        .from('lojas_clientes')
        .select('telefone_principal, razao_social, comprador_nome')
        .eq('id', item.cliente_id)
        .maybeSingle();
      if (!cli) { await marcarErro(item.id, 'cliente_nao_encontrado'); erros++; continue; }
      const tel = normalizarTelefone(cli.telefone_principal);
      if (!tel) { await marcarErro(item.id, 'telefone_invalido'); erros++; continue; }
      const nome = cli.razao_social || cli.comprador_nome || null;

      // acha/cria conversa (mantém etapa do módulo)
      let conversaId;
      const { data: existentes } = await supabase
        .from('lojas_whats_conversas')
        .select('id, etapa')
        .eq('cliente_id', item.cliente_id)
        .not('etapa', 'in', '(vendeu,perdida)')
        .order('atualizado_em', { ascending: false })
        .limit(1);
      if (existentes && existentes.length > 0) {
        conversaId = existentes[0].id;
        // FIX 11/06/2026 (Ailson): conversa REUSADA ficava com a etapa antiga e
        // com sugestões pendentes de outro contexto (ex: Lucimara tinha pendente
        // o script de "visita ao site" dentro da conversa que virou feedback).
        // Agora: atualiza a etapa pro fluxo do módulo e descarta pendentes velhas.
        if (existentes[0].etapa !== item.etapa) {
          await supabase.from('lojas_whats_conversas')
            .update({ etapa: item.etapa, atualizado_em: agora() })
            .eq('id', conversaId);
        }
        await supabase.from('lojas_whats_sugestoes')
          .update({ status: 'descartada', atualizada_em: agora() })
          .eq('conversa_id', conversaId)
          .eq('status', 'pendente');
      } else {
        const { data: nova, error: eN } = await supabase
          .from('lojas_whats_conversas')
          .insert({ cliente_id: item.cliente_id, telefone: tel, nome_cliente: nome, etapa: item.etapa })
          .select('id').single();
        if (eN) { await marcarErro(item.id, eN.message); erros++; continue; }
        conversaId = nova.id;
      }

      // envia HSM
      // Nome SEMPRE com inicial maiúscula (LUCIMARA → Lucimara). Ailson 11/06/2026.
      const primeiroNome = primeiroNomeProprio(nome || 'cliente');
      const vars = montarVars(tpl.variables, { '1': primeiroNome });
      let metaResp, metaMsgId;
      try {
        metaResp = await enviarTemplate(tel, tpl.name, vars, tpl.language || 'pt_BR');
        metaMsgId = metaResp?.messages?.[0]?.id || null;
      } catch (e) {
        await marcarErro(item.id, 'meta_falhou: ' + e.message);
        erros++; continue;
      }

      // grava msg + marca enviada (sem mudar etapa)
      // FIX 11/06/2026 (Ailson): texto era null → bolha VAZIA no chat da Tamara.
      // Agora renderiza o body_text do template com as vars e grava.
      let textoRenderizado = String(tpl.body_text || '');
      for (const [k, v] of Object.entries(vars)) {
        textoRenderizado = textoRenderizado.replaceAll(`{{${k}}}`, v);
      }
      const ts = agora();
      await supabase.from('lojas_whats_mensagens').insert({
        conversa_id: conversaId, direcao: 'saida', autor: 'sofia_ia', enviada_modo: 'aprovada', enviada_login: null,
        tipo_midia: 'template', texto: textoRenderizado || null,
        template_name: tpl.name, template_vars: { '1': primeiroNome },
        meta_message_id: metaMsgId, status: 'enviando', meta_response: metaResp, enviada_em: ts,
      });
      await supabase.from('lojas_whats_conversas').update({
        primeira_msg_enviada_em: ts, ultima_atividade_em: ts,
        ultima_msg_direcao: 'saida', atualizado_em: ts,
      }).eq('id', conversaId);

      await supabase.from('clientes_sofia_fila').update({
        status: 'enviado', conversa_id: conversaId, meta_message_id: metaMsgId, processado_em: ts,
      }).eq('id', item.id);
      enviados++;
    } catch (e) {
      await marcarErro(item.id, e.message);
      erros++;
    }
  }

  const { count: restantes } = await supabase
    .from('clientes_sofia_fila')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pendente');

  return { processados: itens.length, enviados, erros, restantes: restantes || 0 };
}

async function marcarErro(id, erro) {
  await supabase.from('clientes_sofia_fila').update({
    status: 'erro', erro: String(erro || '').slice(0, 500), processado_em: new Date().toISOString(),
  }).eq('id', id);
}
