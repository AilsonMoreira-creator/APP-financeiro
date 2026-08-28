// ============================================================================
// MELUNI — disparo em massa na aba PERDIDOS do carrinho (Ailson 07/08/2026).
//
// O carrinho perdido é quem levou o 1º disparo, levou o 2º depois de 24h e não
// interagiu. Em vez de morrer ali, ele pode receber os MESMOS templates de
// campanha da aba Clientes (meluni_config: lara_templates_novidade).
//
// POST { ids: [carrinhoId...], versao?: 'preview_verao', cfg?, dry?: true }
// GET  ?dry=1&versao=&ids=id1,id2  → teste, não envia nada
//
// Guardas: só status 'perdida' e origem 'carrinho'; telefone obrigatório;
// congelados (tag Atenção); ANTI-COLISÃO 48h (não empilha mensagem); conversa
// fechada; dedupe por nome de template (ninguém recebe a mesma campanha 2x);
// máximo 30 por chamada.
// ============================================================================
import { supabase, telefonesComCampanhaRecente } from './_meluni-whats-helpers.js';
import { enviarTemplateLara } from './_meluni-whats-meta.js';
import { resolverPrimeiroNome } from './_meluni-carrinho-resumo.js';
import { acharConversaWhats } from './_meluni-tel.js';
import { telefonesCongelados } from './_meluni-tags-core.js';
import { carregarTplNovidade, primeiroNome } from './_meluni-novidade-core.js';

export const config = { maxDuration: 300 };

const ETAPAS_FECHADAS = ['vendeu', 'perdida', 'resolvido', 'ganho', 'perdido'];
const MAX_POR_CHAMADA = 30;

function renderTpl(body, params) {
  let s = String(body || '');
  params.forEach((p, i) => { s = s.split('{{' + (i + 1) + '}}').join(String(p)); });
  return s;
}

async function acharOuCriarConversa(telefone, nome) {
  const ex = await acharConversaWhats(supabase, telefone);
  if (ex?.id) return ex;
  const { data: nova } = await supabase.from('meluni_conversas').insert({
    canal: 'whatsapp', telefone, externo_id: telefone, nome_cliente: nome || null,
    origem: 'carrinho', etapa: 'enviados',
    ultima_msg_direcao: 'saida', ultima_msg_em: new Date().toISOString(),
  }).select('id, etapa').single();
  return nova || null;
}

async function disparar(ids, { cfg, versao, dry = false }) {
  const alvo = ids.slice(0, MAX_POR_CHAMADA);
  const cortado = ids.length > MAX_POR_CHAMADA;

  const conf = await carregarTplNovidade(cfg, versao);
  if (!conf) return { ok: false, erro: `template ${cfg || 'lara_templates_novidade'}/${versao || '?'} não configurado ou arquivado` };
  const { tpl, lang, headerImage } = conf;

  const { data: cards, error } = await supabase.from('meluni_carrinhos')
    .select('id, nome, telefone, dados_extra, status, origem')
    .in('id', alvo).eq('status', 'perdida').eq('origem', 'carrinho')
    .not('telefone', 'is', null);
  if (error) return { ok: false, erro: error.message };

  const congelados = await telefonesCongelados(supabase).catch(() => new Set());
  const campanhaRecente = await telefonesComCampanhaRecente(48).catch(() => new Set());

  let enviados = 0, pulados = 0, erros = 0;
  const detalhe = [];

  for (const c of (cards || [])) {
    try {
      const tel = String(c.telefone || '');
      const semDDI = tel.replace(/^55/, '');
      if (congelados?.has?.(tel)) { pulados++; detalhe.push({ id: c.id, status: 'atencao' }); continue; }
      if (campanhaRecente.has(tel) || campanhaRecente.has(semDDI) || campanhaRecente.has('55' + semDDI)) {
        pulados++; detalhe.push({ id: c.id, status: 'campanha_48h' }); continue;
      }

      const conv = await acharOuCriarConversa(tel, c.nome);
      if (conv && ETAPAS_FECHADAS.includes(conv.etapa) && conv.etapa !== 'perdida') {
        pulados++; detalhe.push({ id: c.id, status: 'conversa_fechada' }); continue;
      }
      if (conv?.id) {
        const { data: jaMsg } = await supabase.from('meluni_mensagens')
          .select('id').eq('conversa_id', conv.id).eq('template_usado', tpl.name).limit(1).maybeSingle();
        if (jaMsg) { pulados++; detalhe.push({ id: c.id, status: 'ja_recebeu' }); continue; }
      }

      const nome = primeiroNome(await resolverPrimeiroNome(tel, c.nome).catch(() => c.nome)) || 'cliente';
      // 28/08: template SEM variavel (ex.: a variante sem nome da campanha) nao
      // pode receber parametro — a Meta devolve 132000 e o envio morre.
      const nVars = (String(tpl.body || '').match(/\{\{\d+\}\}/g) || []).length;
      const params = nVars ? [nome] : [];

      if (dry) { enviados++; detalhe.push({ id: c.id, status: 'enviaria', tel, nome, vars: nVars }); continue; }

      const r = await enviarTemplateLara(tel, tpl.name, params, { language: lang, headerImage });
      const metaId = r?.messages?.[0]?.id || null;
      const agora = new Date().toISOString();

      if (conv?.id) {
        await supabase.from('meluni_mensagens').insert({
          conversa_id: conv.id, direcao: 'saida', autor: 'lara_perdidos',
          tipo_midia: 'template', template_usado: tpl.name,
          texto: renderTpl(tpl.body, params), midia_url: headerImage || null,
          botao: tpl.botao?.url ? { text: tpl.botao.text || 'Ver no site', url: tpl.botao.url } : null,
          meta_message_id: metaId, enviada_em: agora,
        });
        await supabase.from('meluni_conversas').update({
          etapa: 'enviados', ultima_msg_direcao: 'saida', ultima_msg_em: agora, responder_em: null,
        }).eq('id', conv.id);
      }
      // carimba no card sem tirar ele de Perdidos (a etapa de origem continua
      // valendo; quem responder volta pra Conversando pelo fluxo normal)
      await supabase.from('meluni_carrinhos').update({
        dados_extra: { ...(c.dados_extra || {}), campanha_perdidos_em: agora, campanha_perdidos_template: tpl.name },
      }).eq('id', c.id);

      enviados++; detalhe.push({ id: c.id, status: 'enviado' });
    } catch (e) {
      erros++; detalhe.push({ id: c.id, status: 'erro', erro: String(e?.message || e) });
    }
  }

  return { ok: true, dry, enviados, pulados, erros, total: (cards || []).length, cortado, max: MAX_POR_CHAMADA, template: tpl.name, detalhe };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    if (req.query?.dry !== '1') return res.status(405).json({ ok: false, erro: 'GET só com ?dry=1' });
    const ids = String(req.query?.ids || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!ids.length) return res.status(400).json({ ok: false, erro: 'passe ?ids=id1,id2' });
    const r = await disparar(ids, { cfg: req.query?.cfg, versao: req.query?.versao, dry: true });
    return res.status(r.ok ? 200 : 400).json(r);
  }

  if (req.method !== 'POST') return res.status(405).json({ ok: false, erro: 'use POST' });
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const ids = Array.isArray(body?.ids) ? body.ids.filter(Boolean) : [];
  if (!ids.length) return res.status(400).json({ ok: false, erro: 'sem ids' });

  const r = await disparar(ids, { cfg: body?.cfg, versao: body?.versao, dry: body?.dry === true });
  return res.status(r.ok ? 200 : 400).json(r);
}
