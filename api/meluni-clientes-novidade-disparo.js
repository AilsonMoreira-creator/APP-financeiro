// Disparo de NOVIDADE (aba Clientes da Lara) — manda um template aprovado com
// FOTO no topo + "Oi {nome}" + botão de link, pros clientes selecionados.
// Lê a spec de meluni_config (chave default 'lara_templates_novidade'); o
// template precisa estar APROVADO na Meta (criado via /api/meluni-whats-template-criar).
//
// É MANUAL (humano seleciona e clica). Teto por chamada e idempotência por nome
// de template (não manda a MESMA novidade 2x pro mesmo cliente) evitam duplo envio.
//
// POST { ids: [clienteId, ...], cfg?: 'lara_templates_novidade', versao?: 'moletinho' }
import { supabase, cfgMeluni } from './_meluni-whats-helpers.js';
import { enviarTemplateLara } from './_meluni-whats-meta.js';

const ETAPAS_FECHADAS = ['conversao', 'ganho', 'perdido'];
const MAX_POR_CHAMADA = 30;

const soDigitos = (s) => String(s || '').replace(/\D/g, '');
function canonTel(s) { let d = soDigitos(s); if (d.length >= 12 && d.startsWith('55')) d = d.slice(2); return d; }
function primeiroNome(nome) {
  const t = String(nome || '').trim().split(/\s+/)[0] || '';
  return t ? t.charAt(0).toUpperCase() + t.slice(1).toLowerCase() : '';
}
function renderTpl(body, params) {
  let s = String(body || '');
  params.forEach((p, i) => { s = s.split('{{' + (i + 1) + '}}').join(String(p)); });
  return s;
}

async function acharOuCriarConversaCliente(tel, nome, clienteId) {
  const { data: ex } = await supabase.from('meluni_conversas').select('id, etapa, cliente_id')
    .eq('canal', 'whatsapp').eq('telefone', tel)
    .order('ultima_msg_em', { ascending: false }).limit(1).maybeSingle();
  if (ex?.id) {
    if (clienteId && !ex.cliente_id) await supabase.from('meluni_conversas').update({ cliente_id: clienteId }).eq('id', ex.id);
    return ex;
  }
  const { data: nova } = await supabase.from('meluni_conversas').insert({
    canal: 'whatsapp', telefone: tel, externo_id: tel, nome_cliente: nome || null,
    cliente_id: clienteId || null, origem: 'cliente', etapa: 'enviados',
    ultima_msg_direcao: 'saida', ultima_msg_em: new Date().toISOString(),
  }).select('id, etapa, cliente_id').single();
  return nova || null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, erro: 'use POST' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  let ids = Array.isArray(body?.ids) ? body.ids.filter(Boolean) : [];
  if (!ids.length) return res.status(400).json({ ok: false, erro: 'sem ids' });
  const cortado = ids.length > MAX_POR_CHAMADA;
  if (cortado) ids = ids.slice(0, MAX_POR_CHAMADA);

  const chaveCfg = body?.cfg || 'lara_templates_novidade';
  const spec = (await cfgMeluni(chaveCfg, null));
  const tpls = spec?.templates || {};
  const versao = body?.versao || Object.keys(tpls)[0];
  const tpl = versao ? tpls[versao] : null;
  if (!tpl?.name || !tpl?.body) return res.status(400).json({ ok: false, erro: `template ${chaveCfg}/${versao || '?'} nao configurado` });
  const headerImage = tpl.header?.format === 'IMAGE' ? tpl.header?.sample_url : null;
  const lang = spec.idioma || tpl.language || 'pt_BR';

  const { data: clientes } = await supabase.from('meluni_clientes')
    .select('id, nome, telefone, whatsapp, bloqueado').in('id', ids);
  const mapC = new Map((clientes || []).map(c => [c.id, c]));

  let enviados = 0, pulados = 0, erros = 0;
  const detalhe = [];

  for (const id of ids) {
    const c = mapC.get(id);
    try {
      if (!c) { pulados++; detalhe.push({ id, status: 'nao_encontrado' }); continue; }
      if (c.bloqueado) { pulados++; detalhe.push({ id, status: 'bloqueado' }); continue; }
      const tel = canonTel(c.whatsapp || c.telefone);
      if (!tel || tel.length < 10) { pulados++; detalhe.push({ id, status: 'sem_telefone' }); continue; }
      const nome = primeiroNome(c.nome);
      if (!nome) { pulados++; detalhe.push({ id, status: 'sem_nome' }); continue; }

      const conv = await acharOuCriarConversaCliente(tel, c.nome, c.id);
      if (conv && ETAPAS_FECHADAS.includes(conv.etapa)) { pulados++; detalhe.push({ id, status: 'conversa_fechada' }); continue; }

      // idempotência: não manda a MESMA novidade (mesmo template) 2x pro mesmo cliente
      if (conv?.id) {
        const { data: jaMsg } = await supabase.from('meluni_mensagens')
          .select('id').eq('conversa_id', conv.id).eq('template_usado', tpl.name).limit(1).maybeSingle();
        if (jaMsg) { pulados++; detalhe.push({ id, status: 'ja_recebeu_novidade' }); continue; }
      }

      const r = await enviarTemplateLara('55' + tel, tpl.name, [nome], { language: lang, headerImage });
      const metaMsgId = r?.messages?.[0]?.id || null;
      const nowIso = new Date().toISOString();

      if (conv?.id) {
        await supabase.from('meluni_mensagens').insert({
          conversa_id: conv.id, direcao: 'saida', autor: 'lara_clientes',
          tipo_midia: 'template', template_usado: tpl.name,
          texto: renderTpl(tpl.body, [nome]),
          meta_message_id: metaMsgId, enviada_em: nowIso,
        });
        await supabase.from('meluni_conversas').update({
          etapa: 'enviados', ultima_msg_direcao: 'saida', ultima_msg_em: nowIso, responder_em: null,
        }).eq('id', conv.id);
      }
      enviados++; detalhe.push({ id, status: 'enviado', meta_message_id: metaMsgId });
    } catch (e) {
      erros++; detalhe.push({ id, status: 'erro', erro: String(e?.message || e) });
    }
  }

  return res.status(200).json({ ok: true, enviados, pulados, erros, total: ids.length, cortado, max: MAX_POR_CHAMADA, template: tpl.name, detalhe });
}
