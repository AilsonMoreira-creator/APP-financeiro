// ═══════════════════════════════════════════════════════════════════════════
// /api/whats-teste-disparo — DISPARO DE TESTE (Ailson 28/08/2026)
// ---------------------------------------------------------------------------
// Manda um template aprovado pro proprio numero dele, pra ver como a cliente
// vai receber ANTES de soltar pra base. Serve as duas marcas:
//   marca=lara   -> WABA da Lara  (modulo Meluni, tela Treinar Lara)
//   marca=sofia  -> WABA da Sofia (modulo Sofia, tela Config)
//
//   GET  ?marca=lara|sofia            -> lista os templates APROVADOS da WABA
//   POST { marca, template, telefone?, nome? } -> envia UM template de teste
//
// NAO grava em conversa nem em historico: e teste, nao pode sujar o CRM nem
// mexer na etapa de ninguem. So envia e devolve o resultado da Meta.
// ═══════════════════════════════════════════════════════════════════════════
import { enviarTemplateLara } from './_meluni-whats-meta.js';
import { enviarTemplate } from './_lojas-whats-meta-client.js';

const GRAPH = 'https://graph.facebook.com/v21.0';
export const TEL_TESTE_PADRAO = '11947233547';

function saudacaoBRT() {
  const h = (new Date().getUTCHours() + 21) % 24;
  if (h >= 5 && h < 12) return 'Bom dia';
  if (h >= 12 && h < 18) return 'Boa tarde';
  return 'Boa noite';
}

// So digito, com o 55 na frente (a Meta exige E.164 sem o +).
function normalizarTel(t) {
  const so = String(t || '').replace(/\D/g, '');
  if (!so) return null;
  const sem55 = so.startsWith('55') ? so.slice(2) : so;
  if (sem55.length < 10 || sem55.length > 11) return null;
  return '55' + sem55;
}

function wabaDe(marca) {
  return marca === 'sofia'
    ? process.env.META_WA_WABA_ID
    : (process.env.META_WA_WABA_ID_LARA || '912339361863904');
}

// Conta as variaveis do corpo pra montar os parametros na ordem certa.
function varsDoBody(components) {
  const body = (components || []).find(c => c.type === 'BODY');
  const n = (String(body?.text || '').match(/\{\{\d+\}\}/g) || []).length;
  return { n, texto: body?.text || '' };
}
function headerImagemDe(components) {
  const h = (components || []).find(c => c.type === 'HEADER');
  if (h?.format !== 'IMAGE') return null;
  return h?.example?.header_handle?.[0] || null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const token = process.env.META_WA_ACCESS_TOKEN;
  if (!token) return res.status(500).json({ ok: false, erro: 'META_WA_ACCESS_TOKEN ausente' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const marca = String((req.method === 'POST' ? body?.marca : req.query?.marca) || 'lara').toLowerCase();
  if (!['lara', 'sofia'].includes(marca)) return res.status(400).json({ ok: false, erro: 'marca invalida (lara|sofia)' });

  const waba = wabaDe(marca);
  if (!waba) return res.status(500).json({ ok: false, erro: `WABA da ${marca} nao configurada` });

  try {
    // ── GET: lista os aprovados pra tela montar o seletor ──
    if (req.method === 'GET') {
      const url = `${GRAPH}/${waba}/message_templates?fields=name,status,category,language,components&limit=200`;
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const txt = await r.text();
      let j = null; try { j = txt ? JSON.parse(txt) : null; } catch { /* */ }
      if (!r.ok) return res.status(r.status).json({ ok: false, erro: j?.error?.message || txt });
      const templates = (j?.data || [])
        .filter(t => t.status === 'APPROVED')
        .map(t => {
          const { n, texto } = varsDoBody(t.components);
          return {
            name: t.name, categoria: t.category, idioma: t.language,
            variaveis: n, tem_imagem: !!headerImagemDe(t.components),
            preview: texto,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
      return res.status(200).json({ ok: true, marca, telefone_padrao: TEL_TESTE_PADRAO, templates });
    }

    if (req.method !== 'POST') return res.status(405).json({ ok: false, erro: 'use GET ou POST' });

    // ── POST: envia o teste ──
    const nomeTeste = String(body?.nome || 'Ailson').trim() || 'Ailson';
    const tel = normalizarTel(body?.telefone || TEL_TESTE_PADRAO);
    if (!tel) return res.status(400).json({ ok: false, erro: 'telefone invalido (use DDD + numero)' });
    const nome = String(body?.template || '').trim();
    if (!nome) return res.status(400).json({ ok: false, erro: 'escolha um template' });

    // Busca o template NA META pra saber quantas variaveis mandar e se tem
    // header de imagem — errar a contagem devolve 132000 e o teste some.
    const rT = await fetch(
      `${GRAPH}/${waba}/message_templates?name=${encodeURIComponent(nome)}&fields=name,status,language,components&limit=5`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const txtT = await rT.text();
    let jT = null; try { jT = txtT ? JSON.parse(txtT) : null; } catch { /* */ }
    const tpl = (jT?.data || []).find(t => t.name === nome && t.status === 'APPROVED');
    if (!tpl) return res.status(404).json({ ok: false, erro: 'template nao encontrado ou nao aprovado', template: nome });

    const { n: nVars } = varsDoBody(tpl.components);
    // 1 var = nome. 2 vars = saudacao + nome (padrao dos HSM da Sofia).
    // 3+ = repete o nome nas sobras so pra render do teste nao quebrar.
    let params = [];
    if (nVars === 1) params = [nomeTeste];
    else if (nVars === 2) params = [saudacaoBRT(), nomeTeste];
    else if (nVars > 2) params = [saudacaoBRT(), nomeTeste, ...Array(nVars - 2).fill('teste')];

    const headerImage = headerImagemDe(tpl.components);
    const lang = tpl.language || 'pt_BR';

    const r = marca === 'lara'
      ? await enviarTemplateLara(tel, nome, params, { language: lang, headerImage })
      : await enviarTemplate(tel, nome, params, lang, headerImage ? { headerImage } : {});

    return res.status(200).json({
      ok: true, marca, template: nome, telefone: tel, nome_usado: nomeTeste,
      variaveis: nVars, params, com_imagem: !!headerImage,
      meta_message_id: r?.messages?.[0]?.id || null,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: String(e?.message || e) });
  }
}
