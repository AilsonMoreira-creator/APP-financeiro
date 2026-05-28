// ═══════════════════════════════════════════════════════════════════════════
// /api/lojas-whats-debug-template — TEMPORARIO (Ailson 27/05/2026)
// ═══════════════════════════════════════════════════════════════════════════
// Endpoint de DEBUG para identificar por que Meta rejeita visita_site_amicia_v1.
// Recebe conversa_id por query string e tenta enviar o template, retornando
// SEM mascarar tudo que a Meta devolveu (sucesso ou erro).
//
// GET /api/lojas-whats-debug-template?conversa_id=701e235b-...
//
// REMOVER apos diagnostico.
// ═══════════════════════════════════════════════════════════════════════════

import { supabase, setCors } from './_lojas-whats-helpers.js';
import { enviarTemplate, listarTemplates, submeterTemplate } from './_lojas-whats-meta-client.js';
import { gerarContextoHandoff } from './_lojas-whats-handoff-ia.js';

const META_GRAPH_API = 'https://graph.facebook.com/v21.0';

async function metaFetchRaw(path) {
  const res = await fetch(`${META_GRAPH_API}${path}`, {
    headers: { Authorization: `Bearer ${process.env.META_WA_ACCESS_TOKEN}` },
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_) {}
  return { status: res.status, json, raw: text };
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  // action=regen_handoff&conversa_id=X → testa o caminho Sonnet de geracao de
  // contexto de handoff e atualiza o handoff 'aguardando' dessa conversa.
  // Verificacao do fix 72cf30d (Haiku->Sonnet). REMOVER apos confirmar.
  if (req.query?.action === 'regen_handoff') {
    const conversaId = req.query?.conversa_id;
    if (!conversaId) return res.status(400).json({ error: 'conversa_id_obrigatorio' });
    // Replica o nucleo do gerarContextoHandoff e retorna o texto CRU do Claude
    // + se o JSON.parse funciona — pra achar onde quebra. TEMP.
    let diag = {};
    try {
      const { chamarClaude } = await import('./_lojas-helpers.js');
      const { data: conv } = await supabase
        .from('lojas_whats_conversas')
        .select('id, nome_cliente, telefone, tipo_documento, etapa, qtd_pecas, valor_carrinho, gatilhos_detectados, carrinho_id')
        .eq('id', conversaId).maybeSingle();
      const { data: msgs } = await supabase
        .from('lojas_whats_mensagens')
        .select('direcao, autor, texto, enviada_em')
        .eq('conversa_id', conversaId).not('texto', 'is', null)
        .order('enviada_em', { ascending: false }).limit(10);
      const hist = (msgs || []).reverse().map(m => {
        const quem = m.direcao === 'entrada' ? 'CLIENTE' : (m.autor === 'sofia_ia' ? 'SOFIA' : 'ASSISTENTE');
        return `${quem}: ${(m.texto || '').slice(0, 300)}`;
      }).join('\n');
      const prompt = `Analise essa conversa e devolva SO um JSON valido (sem markdown, sem texto fora do JSON):\n{"resumo_conversa":"2-3 frases","modelos_interesse":["item"],"mensagem_sugerida":"mensagem pra vendedora assumir, cite [VENDEDORA] e pecas reais"}\n\nCLIENTE: ${conv?.nome_cliente}\nHISTORICO:\n"""\n${hist}\n"""`;
      const cl = await chamarClaude({ modelo: 'claude-sonnet-4-6', messages: [{ role: 'user', content: prompt }], max_tokens: 600, temperature: 0.3 });
      let parseOk = false, parseErro = null;
      const txt = (cl.texto || '').replace(/```json|```/g, '').trim();
      try { JSON.parse(txt); parseOk = true; } catch (e) { parseErro = e.message; }
      diag = { conv_achou: !!conv, n_msgs: (msgs || []).length, hist_len: hist.length, cl_ok: cl.ok, cl_erro: cl.erro || null, parseOk, parseErro, texto_cru: (cl.texto || '').slice(0, 500) };
    } catch (e) {
      diag = { throw: e.message || String(e) };
    }
    return res.status(200).json({ ok: true, diag });
  }

  // action=submit_3 → submete os 3 templates faltantes na WABA configurada
  // Le do banco lojas_whats_templates, manda pra Meta via submeterTemplate,
  // persiste meta_template_id + status retornado. Idempotente: se template
  // ja tem meta_template_id, pula.
  if (req.query?.action === 'submit_3') {
    const NOMES = [
      'visita_site_amicia_v1',
      'carrinho_abandonado_site_amicia_v2',
      'followup_catalogo_24h_v1',
    ];
    const resultados = [];
    for (const nome of NOMES) {
      const { data: tpl, error: errSel } = await supabase
        .from('lojas_whats_templates')
        .select('*')
        .eq('name', nome)
        .maybeSingle();
      if (errSel || !tpl) {
        resultados.push({ nome, ok: false, erro: 'nao_encontrado_no_banco' });
        continue;
      }
      if (tpl.meta_template_id) {
        resultados.push({
          nome, ok: false, pulou: true,
          motivo: 'ja_tem_meta_template_id',
          meta_template_id: tpl.meta_template_id,
        });
        continue;
      }
      try {
        const resp = await submeterTemplate(tpl);
        // Persiste id + status retornado pela Meta
        const novoStatus = (resp.status || 'PENDING').toLowerCase() === 'approved'
          ? 'aprovado'
          : (resp.status || 'PENDING').toLowerCase();
        await supabase
          .from('lojas_whats_templates')
          .update({
            meta_template_id: resp.id || null,
            status: novoStatus,
            atualizado_em: new Date().toISOString(),
          })
          .eq('name', nome);
        resultados.push({
          nome, ok: true,
          meta_template_id: resp.id,
          status_meta: resp.status,
        });
      } catch (e) {
        resultados.push({
          nome, ok: false,
          erro: e.message,
          metaResponse: e.metaResponse || null,
        });
      }
    }
    return res.status(200).json({ ok: true, resultados });
  }
  if (req.query?.action === 'waba_info') {
    return res.status(200).json({
      meta_waba_id: process.env.META_WA_WABA_ID
        ? `...${String(process.env.META_WA_WABA_ID).slice(-6)}`
        : null,
      meta_phone_id: process.env.META_WA_PHONE_ID
        ? `...${String(process.env.META_WA_PHONE_ID).slice(-6)}`
        : null,
      meta_token_present: !!process.env.META_WA_ACCESS_TOKEN,
    });
  }

  // action=waba_detalhe → busca nome+business da WABA configurada,
  // e lista as outras WABAs visiveis pelo token (pra identificar
  // se templates foram submetidos em outra conta)
  if (req.query?.action === 'waba_detalhe') {
    const out = {};
    // 1. Detalhe da WABA configurada
    const r1 = await metaFetchRaw(
      `/${process.env.META_WA_WABA_ID}?fields=id,name,owner_business_info,business_verification_status,country,timezone_id`
    );
    out.waba_configurada = r1.json || r1.raw;
    // 2. Lista todos os businesses do user/system-user
    const r2 = await metaFetchRaw(`/me?fields=id,name`);
    out.token_owner = r2.json || r2.raw;
    // 3. WABAs owned por businesses
    const r3 = await metaFetchRaw(
      `/me/businesses?fields=id,name,owned_whatsapp_business_accounts{id,name}&limit=20`
    );
    out.businesses_e_wabas = r3.json || r3.raw;
    return res.status(200).json(out);
  }

  // action=consultar_nome&name=X → busca por nome ESPECIFICO (qualquer status/language)
  if (req.query?.action === 'consultar_nome') {
    const name = req.query?.name;
    if (!name) return res.status(400).json({ error: 'name_obrigatorio' });
    const r = await metaFetchRaw(
      `/${process.env.META_WA_WABA_ID}/message_templates?name=${encodeURIComponent(name)}&fields=name,language,status,category,id,quality_score,rejected_reason,components`
    );
    return res.status(200).json({ status_http: r.status, body: r.json || r.raw });
  }

  // action=list_meta_full → lista todos templates (paginado, qualquer status)
  if (req.query?.action === 'list_meta_full') {
    const tudo = [];
    let url = `/${process.env.META_WA_WABA_ID}/message_templates?limit=100&fields=name,language,status,category,id`;
    for (let i = 0; i < 10; i++) {
      const r = await metaFetchRaw(url);
      if (!r.json?.data) break;
      tudo.push(...r.json.data);
      const next = r.json?.paging?.next;
      if (!next) break;
      // extrai path da url completa (graph.facebook.com/v21.0/...)
      const m = next.match(/graph\.facebook\.com\/v\d+\.\d+(\/.*)/);
      if (!m) break;
      url = m[1];
    }
    const porStatus = {};
    for (const t of tudo) {
      porStatus[t.status] = (porStatus[t.status] || 0) + 1;
    }
    return res.status(200).json({
      total: tudo.length,
      por_status: porStatus,
      templates: tudo.map(t => ({
        name: t.name, language: t.language, status: t.status, category: t.category, id: t.id,
      })),
    });
  }

  // action=list_meta → lista APPROVED only (rapido)
  if (req.query?.action === 'list_meta') {
    try {
      const tpls = await listarTemplates();
      const resumo = tpls.map(t => ({
        name: t.name, language: t.language, status: t.status, category: t.category, id: t.id,
      }));
      return res.status(200).json({ ok: true, total: tpls.length, templates: resumo });
    } catch (e) {
      return res.status(200).json({ ok: false, erro: e.message, metaResponse: e.metaResponse || null });
    }
  }

  const conversa_id = req.query?.conversa_id;
  if (!conversa_id) return res.status(400).json({ error: 'conversa_id_ou_action_obrigatorio' });

  try {
    const { data: conv } = await supabase
      .from('lojas_whats_conversas')
      .select('id, telefone, nome_cliente, qtd_pecas')
      .eq('id', conversa_id)
      .maybeSingle();
    if (!conv) return res.status(404).json({ error: 'conversa_nao_encontrada' });

    const templateName = req.query?.template || 'visita_site_amicia_v1';
    const { data: tpl } = await supabase
      .from('lojas_whats_templates')
      .select('name, body_text, language, variables, status, ativo, botoes, meta_template_id, category')
      .eq('name', templateName)
      .maybeSingle();
    if (!tpl) return res.status(404).json({ error: 'template_nao_encontrado', templateName });

    const primeiroNome = (conv.nome_cliente || 'cliente').split(' ')[0];
    const valorPorChave = { '1': primeiroNome, '2': String(conv.qtd_pecas || 0) };
    const declaradas = Array.isArray(tpl.variables) ? tpl.variables : [];
    const vars = [];
    for (const v of declaradas) {
      const k = String(v?.nome ?? '');
      if (k && valorPorChave[k] !== undefined) vars.push(valorPorChave[k]);
    }

    const ctx = {
      conv: {
        id: conv.id,
        telefone: conv.telefone,
        nome_cliente: conv.nome_cliente,
        qtd_pecas: conv.qtd_pecas,
      },
      template_summary: {
        name: tpl.name,
        language: tpl.language,
        status: tpl.status,
        ativo: tpl.ativo,
        category: tpl.category,
        meta_template_id: tpl.meta_template_id,
        variables_declared: declaradas,
        botoes: tpl.botoes,
      },
      vars_que_serao_enviadas: vars,
      meta_phone_id: process.env.META_WA_PHONE_ID ? '[set]' : '[MISSING]',
      meta_token_present: !!process.env.META_WA_ACCESS_TOKEN,
    };

    try {
      const resp = await enviarTemplate(conv.telefone, tpl.name, vars, tpl.language || 'pt_BR');
      return res.status(200).json({
        ok: true,
        sucesso: true,
        contexto: ctx,
        meta_response: resp,
      });
    } catch (e) {
      return res.status(200).json({
        ok: true,
        sucesso: false,
        contexto: ctx,
        erro: {
          message: e.message,
          status: e.status,
          metaResponse: e.metaResponse || null,
          stack: (e.stack || '').split('\n').slice(0, 5),
        },
      });
    }
  } catch (e) {
    return res.status(500).json({ error: e.message, stack: (e.stack || '').split('\n').slice(0, 5) });
  }
}
