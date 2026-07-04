// ═══════════════════════════════════════════════════════════════════════════
// lojas-whats-templates-catalogo.js — Catálogo de templates HSM da Sofia
// ═══════════════════════════════════════════════════════════════════════════
//
// Alimenta a pasta "Templates" da aba Mídias (subpastas Curadoria, Novidades,
// Dicas rápidas e Ativos hoje) e o seletor de template do disparo em massa da
// aba Perdida. A ideia (Ailson 04/07/2026): com vários templates em produção,
// precisa de um lugar que mostre DE FORMA REAL como o cliente recebe cada um
// (criativo + corpo + botões), em que fluxo é usado e POR QUE existe.
//
// Nos templates de conteúdo (curadoria/novidades/dicas), o corpo fica aprovado
// na Meta e o CRIATIVO (imagem do header) é passado no envio — então trocar o
// criativo aqui não exige reaprovação: o disparo lê criativo_url na hora.
//
//   GET                        → { pastas: { curadoria:[], novidades:[], dicas_rapidas:[], ativos:[] } }
//   PATCH { name, porque?, fluxo?, body_text? (só rascunho) }
//   POST  multipart { arquivo, name }  → sobe criativo (imagem ≤2MB) e grava criativo_url
//
// Ailson 04/07/2026
// ═══════════════════════════════════════════════════════════════════════════

import { supabase, setCors } from './_lojas-whats-helpers.js';
import { Buffer } from 'node:buffer';

export const config = { api: { bodyParser: false } };

const BUCKET = 'sofia-midias';
const MAX_CRIATIVO = 2 * 1024 * 1024;
const MIMES_OK = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const CAMPOS = 'name, language, category, body_text, botoes, header, status, ativo, pasta, porque, fluxo, criativo_url, criativo_atualizado_em, atualizado_em';

async function lerBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

// Parser multipart mínimo (mesmo padrão do lojas-whats-midia-upload)
function parseMultipart(buf, boundary) {
  const sep = Buffer.from(`--${boundary}`);
  const partes = [];
  let ini = buf.indexOf(sep);
  while (ini !== -1) {
    const fim = buf.indexOf(sep, ini + sep.length);
    if (fim === -1) break;
    partes.push(buf.subarray(ini + sep.length, fim));
    ini = fim;
  }
  const out = {};
  for (const p of partes) {
    const headFim = p.indexOf('\r\n\r\n');
    if (headFim === -1) continue;
    const head = p.subarray(0, headFim).toString();
    const corpo = p.subarray(headFim + 4, p.length - 2); // tira \r\n final
    const nomeM = head.match(/name="([^"]+)"/);
    if (!nomeM) continue;
    const arquivoM = head.match(/filename="([^"]*)"/);
    const mimeM = head.match(/Content-Type:\s*([^\r\n]+)/i);
    if (arquivoM) out[nomeM[1]] = { filename: arquivoM[1], mime: (mimeM?.[1] || '').trim(), data: corpo };
    else out[nomeM[1]] = corpo.toString().trim();
  }
  return out;
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // ── GET: catálogo organizado por pasta ────────────────────────────────
    if (req.method === 'GET') {
      const { data, error } = await supabase.from('lojas_whats_templates')
        .select(CAMPOS)
        .order('criado_em', { ascending: false });
      if (error) return res.status(500).json({ ok: false, erro: error.message });
      const todos = data || [];
      const pastas = {
        curadoria:     todos.filter(t => t.pasta === 'curadoria'),
        novidades:     todos.filter(t => t.pasta === 'novidades'),
        dicas_rapidas: todos.filter(t => t.pasta === 'dicas_rapidas'),
        ativos:        todos.filter(t => t.ativo === true && t.status === 'aprovado'),
      };
      return res.status(200).json({ ok: true, pastas });
    }

    // ── PATCH: editar documentação (porque/fluxo) e corpo enquanto rascunho ─
    if (req.method === 'PATCH') {
      const body = JSON.parse((await lerBody(req)).toString() || '{}');
      const { name } = body;
      if (!name) return res.status(400).json({ ok: false, erro: 'name obrigatorio' });
      const { data: tpl } = await supabase.from('lojas_whats_templates')
        .select('name, status').eq('name', name).maybeSingle();
      if (!tpl) return res.status(404).json({ ok: false, erro: 'template nao encontrado' });
      const upd = { atualizado_em: new Date().toISOString() };
      if (typeof body.porque === 'string') upd.porque = body.porque;
      if (typeof body.fluxo === 'string') upd.fluxo = body.fluxo;
      // corpo só edita enquanto rascunho (depois de aprovado na Meta é imutável)
      if (typeof body.body_text === 'string') {
        if (tpl.status !== 'rascunho') return res.status(400).json({ ok: false, erro: 'corpo aprovado na Meta nao pode ser editado' });
        upd.body_text = body.body_text;
      }
      const { data: novo, error } = await supabase.from('lojas_whats_templates')
        .update(upd).eq('name', name).select(CAMPOS).single();
      if (error) return res.status(500).json({ ok: false, erro: error.message });
      return res.status(200).json({ ok: true, template: novo });
    }

    // ── POST: upload de criativo (imagem do header) ───────────────────────
    if (req.method === 'POST') {
      const ct = req.headers['content-type'] || '';
      const bM = ct.match(/boundary=([^;]+)/);
      if (!bM) return res.status(400).json({ ok: false, erro: 'multipart/form-data esperado' });
      const buf = await lerBody(req);
      const campos = parseMultipart(buf, bM[1]);
      const name = campos.name;
      const arq = campos.arquivo;
      if (!name || !arq?.data?.length) return res.status(400).json({ ok: false, erro: 'name e arquivo obrigatorios' });
      if (!MIMES_OK.includes(arq.mime)) return res.status(400).json({ ok: false, erro: `tipo ${arq.mime} nao aceito (jpeg/png/webp)` });
      if (arq.data.length > MAX_CRIATIVO) return res.status(400).json({ ok: false, erro: 'criativo acima de 2MB' });

      const { data: tpl } = await supabase.from('lojas_whats_templates')
        .select('name').eq('name', name).maybeSingle();
      if (!tpl) return res.status(404).json({ ok: false, erro: 'template nao encontrado' });

      const ext = arq.mime.includes('png') ? 'png' : arq.mime.includes('webp') ? 'webp' : 'jpg';
      const path = `templates/${name}.${ext}`;
      const { error: upErr } = await supabase.storage.from(BUCKET)
        .upload(path, arq.data, { contentType: arq.mime, upsert: true });
      if (upErr) return res.status(500).json({ ok: false, erro: upErr.message });
      const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
      // cache-buster: o path é fixo por template, a URL muda pelo ?v=
      const url = `${pub.publicUrl}?v=${Date.now()}`;
      const agora = new Date().toISOString();
      const { data: novo, error } = await supabase.from('lojas_whats_templates')
        .update({ criativo_url: url, criativo_atualizado_em: agora, atualizado_em: agora })
        .eq('name', name).select(CAMPOS).single();
      if (error) return res.status(500).json({ ok: false, erro: error.message });
      return res.status(200).json({ ok: true, template: novo });
    }

    return res.status(405).json({ ok: false, erro: 'use GET, PATCH ou POST' });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: e.message });
  }
}
