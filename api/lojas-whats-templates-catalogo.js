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

import { supabase, setCors, getConfig, saveConfig } from './_lojas-whats-helpers.js';
import { Buffer } from 'node:buffer';

export const config = { api: { bodyParser: false } };

const BUCKET = 'sofia-midias';
const MAX_CRIATIVO = 2 * 1024 * 1024;
const MIMES_OK = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const CAMPOS = 'name, language, category, body_text, botoes, header, status, ativo, oculto, pasta, porque, fluxo, criativo_url, criativo_atualizado_em, atualizado_em';

// Resolve o criativo que SAI DE VERDADE no envio: prioridade criativo_url
// (trocável na tela); senão header.sample_ref -> mídia ativa -> storage.
// Mesma lógica do cron-disparo2 (Ailson 19/08/2026).
async function criativoEmUso(t) {
  if (t.criativo_url) return t.criativo_url;
  if (t.header?.format !== 'IMAGE' || !t.header?.sample_ref) return null;
  const refRaw = String(t.header.sample_ref);
  const refNorm = refRaw.replace(/^0+/, '') || '0';
  const variantes = [...new Set([refNorm, refNorm.padStart(4, '0'), refNorm.padStart(5, '0'), refRaw])];
  const { data: midia } = await supabase.from('lojas_whats_midias')
    .select('storage_path').eq('tipo', 'foto').eq('ativa', true)
    .in('ref', variantes).limit(1).maybeSingle();
  if (!midia?.storage_path) return null;
  const { data: pub } = supabase.storage.from('sofia-midias').getPublicUrl(midia.storage_path);
  return pub?.publicUrl || null;
}

async function lerBody(req) {
  // Runtime do Vercel pode ja ter consumido o stream e deixado o corpo em
  // req.body (Buffer/string) — sem isso o multipart chega VAZIO e o upload
  // falha silencioso. Ailson 23/07/2026.
  if (req.body != null) {
    if (Buffer.isBuffer(req.body) && req.body.length) return req.body;
    if (typeof req.body === 'string' && req.body.length) return Buffer.from(req.body, 'latin1');
  }
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

      // último uso real de cada template (max enviada_em das mensagens de saída)
      const usoDe = {};
      try {
        const { data: usos } = await supabase.rpc('fn_templates_ultimo_uso');
        (usos || []).forEach(u => { usoDe[u.template_name] = u.ultimo_uso; });
      } catch { /* view/fn ausente: segue sem último uso */ }

      // criativo que sai de verdade no envio (em paralelo, só nos com header IMAGE)
      await Promise.all(todos.map(async (t) => {
        t.ultimo_uso = usoDe[t.name] || null;
        t.criativo_em_uso_url = await criativoEmUso(t);
      }));

      // fluxos automáticos e qual template cada um usa hoje
      const d2tpl = await getConfig('sofia_disparo2_template', 'tendencias_verao27_v1');
      const d2on = (await getConfig('sofia_disparo2_ativo', true)) !== false;
      const fluxos = {
        primeiro_disparo: { rotulo: '1º disparo do carrinho', template: 'carrinho_abandonado_site_amicia_img_v2', ligado: true, fixo: true, obs: 'cai pra versão texto se a foto falhar' },
        disparo2: { rotulo: '2º disparo do carrinho (24h sem resposta)', template: d2tpl, ligado: d2on, fixo: false },
        followup_catalogo: { rotulo: 'Follow-up catálogo 24h', template: 'followup_catalogo_24h_v1', ligado: true, fixo: true },
        pesquisa_motivo: { rotulo: 'Pesquisa de motivo (perdidas)', template: 'sofia_pesquisa_motivo_v2', ligado: true, fixo: true },
      };

      const pastas = {
        curadoria:     todos.filter(t => t.pasta === 'curadoria'),
        novidades:     todos.filter(t => t.pasta === 'novidades'),
        dicas_rapidas: todos.filter(t => t.pasta === 'dicas_rapidas'),
        tendencias:    todos.filter(t => t.pasta === 'tendencias'),
        ativos:        todos.filter(t => t.ativo === true && t.status === 'aprovado'),
      };
      return res.status(200).json({ ok: true, pastas, todos, fluxos });
    }

    // ── PATCH: documentação, ativo/oculto e troca do fluxo do 2º disparo ────
    if (req.method === 'PATCH') {
      const body = JSON.parse((await lerBody(req)).toString() || '{}');

      // troca do fluxo do 2º disparo (Ailson 19/08/2026): valida antes de gravar
      if (body.fluxo_disparo2) {
        const { template, ligado } = body.fluxo_disparo2;
        if (typeof template === 'string' && template) {
          const { data: alvo } = await supabase.from('lojas_whats_templates')
            .select('name, status, ativo, oculto').eq('name', template).maybeSingle();
          if (!alvo) return res.status(404).json({ ok: false, erro: 'template nao encontrado' });
          if (alvo.status !== 'aprovado' || !alvo.ativo || alvo.oculto) {
            return res.status(400).json({ ok: false, erro: 'so template aprovado, ativo e visivel pode assumir o fluxo' });
          }
          await saveConfig('sofia_disparo2_template', template, 'template do 2º disparo do carrinho (tela Templates)');
        }
        if (typeof ligado === 'boolean') {
          await saveConfig('sofia_disparo2_ativo', ligado, 'liga/desliga do 2º disparo do carrinho (tela Templates)');
        }
        return res.status(200).json({ ok: true });
      }

      const { name } = body;
      if (!name) return res.status(400).json({ ok: false, erro: 'name obrigatorio' });
      const { data: tpl } = await supabase.from('lojas_whats_templates')
        .select('name, status').eq('name', name).maybeSingle();
      if (!tpl) return res.status(404).json({ ok: false, erro: 'template nao encontrado' });
      const upd = { atualizado_em: new Date().toISOString() };
      if (typeof body.porque === 'string') upd.porque = body.porque;
      if (typeof body.fluxo === 'string') upd.fluxo = body.fluxo;
      if (typeof body.ativo === 'boolean') upd.ativo = body.ativo;
      if (typeof body.oculto === 'boolean') upd.oculto = body.oculto;
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
      const boundary = bM[1].trim().replace(/^"|"$/g, '');   // aspas quebravam o parser (23/07/2026)
      const buf = await lerBody(req);
      const campos = parseMultipart(buf, boundary);
      console.log(`[templates-catalogo] POST body=${buf.length}b campos=${Object.keys(campos).join(',')} arquivo=${campos.arquivo?.data?.length||0}b`);
      // Diagnostico persistente (23/07/2026): upload falhava sem pista — cada
      // tentativa fica em amicia_data user_id='debug-criativo-upload'.
      await supabase.from('amicia_data').upsert({ user_id: 'debug-criativo-upload', payload: {
        ts: new Date().toISOString(), ct, body_bytes: buf.length,
        campos: Object.keys(campos), arquivo_bytes: campos.arquivo?.data?.length || 0,
        arquivo_mime: campos.arquivo?.mime || null, name: campos.name || null,
      } }, { onConflict: 'user_id' });
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
