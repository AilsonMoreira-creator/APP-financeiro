// ═══════════════════════════════════════════════════════════════════════════
// lojas-whats-refs-indicar.js — Indicação MANUAL de refs pela assistente
// ═══════════════════════════════════════════════════════════════════════════
// Quando a Sofia erra/não acha o modelo na foto da cliente, a assistente abre o
// modal no chat e digita as refs certas (até 5). Aqui a gente manda UMA mensagem
// por ref: foto de cores (arara, cor real) com as cores e tamanhos disponíveis
// na legenda. Se a ref não tiver foto de cores, manda só o texto (continua como
// hoje). Ailson 28/06/2026.
//
// POST /api/lojas-whats-refs-indicar  body { conversa_id, refs: ["3213", ...] }
// ═══════════════════════════════════════════════════════════════════════════

import { supabase, setCors, log, logErro } from './_lojas-whats-helpers.js';
import { enviarTexto } from './_lojas-whats-meta-client.js';
import { enviarMidiaSofia } from './_lojas-whats-midia-sender.js';

const ORDEM_TAM = { PP: 0, P: 1, M: 2, G: 3, GG: 4, G1: 5, G2: 6, G3: 7 };
const MAX_REFS = 5;

function normRef(r) {
  return String(r || '').replace(/\D/g, '').replace(/^0+/, '') || '';
}

// Monta as linhas "Cor: P, M, G" da ref a partir do estoque fino (disponivel>0).
function linhasCoresTams(grade, refN) {
  const cores = new Map();
  for (const r of grade) {
    if (normRef(r.ref) !== refN) continue;
    if (!cores.has(r.cor)) cores.set(r.cor, new Set());
    cores.get(r.cor).add(r.tam);
  }
  if (!cores.size) return null;
  return [...cores.entries()]
    .sort((a, b) => String(a[0]).localeCompare(String(b[0]), 'pt'))
    .map(([cor, tams]) => {
      const ts = [...tams].sort(
        (x, y) => (ORDEM_TAM[String(x).toUpperCase()] ?? 9) - (ORDEM_TAM[String(y).toUpperCase()] ?? 9)
      );
      return `${cor}: ${ts.join(', ')}`;
    });
}

function montarCaption(refDisplay, linhas) {
  if (linhas && linhas.length) {
    return `Ref ${refDisplay}, a gente tem nessas cores e tamanhos:\n\n${linhas.join('\n')}`;
  }
  // Sem grade do dia: ainda assim manda a foto com uma fala leve.
  return `Ref ${refDisplay}, já confirmo as cores e os tamanhos pra vc.`;
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const { conversa_id, refs } = req.body || {};
  if (!conversa_id) return res.status(400).json({ error: 'conversa_id_required' });
  if (!Array.isArray(refs) || !refs.length) return res.status(400).json({ error: 'refs_required' });

  // Normaliza, tira duplicadas e vazias, limita a 5.
  const refsNorm = [...new Set(refs.map(normRef).filter(Boolean))].slice(0, MAX_REFS);
  if (!refsNorm.length) return res.status(400).json({ error: 'refs_invalidas' });

  // Conversa (telefone)
  const { data: conv, error: errConv } = await supabase
    .from('lojas_whats_conversas')
    .select('id, telefone')
    .eq('id', conversa_id)
    .maybeSingle();
  if (errConv || !conv) return res.status(404).json({ error: 'conversa_nao_encontrada' });

  // Estoque fino (1 leitura) + fotos de cores (1 leitura), casados por ref normalizada.
  const [{ data: grade }, { data: midiasCores }] = await Promise.all([
    supabase.from('lojas_estoque_grade').select('ref, cor, tam').gt('disponivel', 0),
    supabase.from('lojas_whats_midias')
      .select('id, tipo, ref, nome_arquivo, storage_path, mime_type, descricao')
      .in('tipo', ['cores', 'foto']).eq('ativa', true),
  ]);
  // Prioriza foto de cores (arara). Se a ref nao tiver cores, usa a foto do
  // produto como fallback pra sempre ir uma imagem (Ailson 03/07/2026).
  const coresPorRef = new Map();
  const fotoPorRef = new Map();
  for (const m of midiasCores || []) {
    const rn = normRef(m.ref);
    if (!rn || !m.storage_path) continue;
    if (m.tipo === 'cores') { if (!coresPorRef.has(rn)) coresPorRef.set(rn, m); }
    else if (m.tipo === 'foto') { if (!fotoPorRef.has(rn)) fotoPorRef.set(rn, m); }
  }

  const agora = new Date().toISOString();
  let enviadas = 0;
  const semFotoCores = [];
  const falhas = [];

  for (const refN of refsNorm) {
    const linhas = linhasCoresTams(grade || [], refN);
    const caption = montarCaption(refN, linhas);
    const midiaCores = coresPorRef.get(refN) || fotoPorRef.get(refN) || null;

    try {
      if (midiaCores) {
        const r = await enviarMidiaSofia({
          telefone: conv.telefone,
          midia: midiaCores,
          caption,
          conversaId: conv.id,
          mensagemId: null,
          decididaPor: 'assistente',
        });
        if (!r.ok) { falhas.push(refN); continue; }
        const { data: pub } = supabase.storage.from('sofia-midias').getPublicUrl(midiaCores.storage_path);
        await supabase.from('lojas_whats_mensagens').insert({
          conversa_id: conv.id, direcao: 'saida', autor: 'assistente',
          tipo_midia: 'image', texto: caption, midia_url: pub?.publicUrl || null,
          meta_message_id: r.message_id || null, status: 'enviando', enviada_em: new Date().toISOString(),
        });
      } else {
        // Sem foto de cores -> manda só o texto (continua como hoje).
        semFotoCores.push(refN);
        const r = await enviarTexto(conv.telefone, caption);
        await supabase.from('lojas_whats_mensagens').insert({
          conversa_id: conv.id, direcao: 'saida', autor: 'assistente',
          tipo_midia: 'text', texto: caption,
          meta_message_id: r?.messages?.[0]?.id || null, status: 'enviando', enviada_em: new Date().toISOString(),
        });
      }
      enviadas++;
      await new Promise(res2 => setTimeout(res2, 600)); // ordem + rate-limit suave
    } catch (e) {
      logErro('refs-indicar/envio', e);
      falhas.push(refN);
    }
  }

  // Registra na conversa pra histórico + pra IA saber que já foi confirmado
  // (não re-identificar na próxima msg da cliente).
  try {
    await supabase.from('lojas_whats_conversas')
      .update({ refs_indicadas: refsNorm, refs_indicadas_em: agora, ultima_atividade_em: agora, atualizado_em: agora })
      .eq('id', conv.id);
  } catch (e) { logErro('refs-indicar/update-conversa', e); }

  log('refs-indicar', `conversa=${conv.id} refs=${refsNorm.join(',')} enviadas=${enviadas} sem_cores=${semFotoCores.length} falhas=${falhas.length}`);
  return res.status(200).json({ ok: true, enviadas, refs: refsNorm, sem_foto_cores: semFotoCores, falhas });
}
