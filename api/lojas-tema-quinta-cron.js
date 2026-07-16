// ═══════════════════════════════════════════════════════════════════════════
// /api/lojas-tema-quinta-cron
// ═══════════════════════════════════════════════════════════════════════════
// Cron Vercel quinta 10:00 UTC (07:00 BRT). Gera o "Tema da quinta": uma
// edição curta sobre tendência / dica de abordagem / melhores práticas, em tom
// amigável e com brincadeiras pra descontrair. 1 tema por semana, igual pra
// todas as vendedoras (estilo newsletter interna). Vendedora vê num card no
// app (quinta-feira) + recebe push avisando.
// Ailson 11/06/2026.
// ═══════════════════════════════════════════════════════════════════════════

import { supabase, setCors } from './_lojas-helpers.js';
import { enviarPush } from './_push-helpers.js';

export const config = { maxDuration: 120 };

function segundaDaSemana(d = new Date()) {
  const brt = new Date(d.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const dia = brt.getDay(); // 0=dom
  const diff = dia === 0 ? -6 : 1 - dia;
  brt.setDate(brt.getDate() + diff);
  return brt.toISOString().slice(0, 10);
}

export default async function handler(req, res) {
  setCors(res);
  const userAgent = req.headers['user-agent'] || '';
  const ehCron = userAgent.startsWith('vercel-cron') || req.headers['x-vercel-cron'] !== undefined;
  const ehAdmin = req.headers['x-user'] === 'ailson';
  if (!ehCron && !ehAdmin) {
    return res.status(403).json({ error: 'Apenas cron Vercel ou admin' });
  }

  const semana = segundaDaSemana();

  // Idempotência: já tem tema dessa semana? (cron rodou 2x / re-deploy)
  const { data: existente } = await supabase
    .from('lojas_temas_quinta')
    .select('id, titulo')
    .eq('semana_inicio', semana)
    .maybeSingle();
  if (existente && !req.query?.forcar) {
    return res.json({ ok: true, ja_existia: true, titulo: existente.titulo });
  }

  // MÉTODO NOVO (Ailson 16/07/2026): em vez de gerar com IA toda semana (que
  // travava e repetia), consumimos a próxima leitura PRONTA da fila
  // (lojas_temas_quinta_fila, abastecida manualmente). Puxa a de menor ordem
  // ainda não usada, publica na semana e marca como usada. Quando a fila
  // esvaziar, é só abastecer de novo — o cron avisa nos logs.
  const { data: proxima } = await supabase
    .from('lojas_temas_quinta_fila')
    .select('id, categoria, emoji, titulo, conteudo')
    .is('usada_em', null)
    .order('ordem', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!proxima) {
    console.warn('[tema-quinta] FILA VAZIA — abastecer lojas_temas_quinta_fila');
    return res.status(200).json({ ok: false, motivo: 'fila_vazia', dica: 'abastecer lojas_temas_quinta_fila com novas leituras' });
  }

  const categoria = { id: proxima.categoria };
  const titulo = String(proxima.titulo || '').slice(0, 120);
  const conteudo = String(proxima.conteudo || '');
  const emoji = String(proxima.emoji || '💡').slice(0, 4);

  const { error: errSalvar } = await supabase
    .from('lojas_temas_quinta')
    .upsert({
      semana_inicio: semana,
      categoria: categoria.id,
      titulo, conteudo, emoji,
      modelo_ia: 'fila',
      gerado_em: new Date().toISOString(),
    }, { onConflict: 'semana_inicio' });
  if (errSalvar) {
    return res.status(500).json({ error: errSalvar.message });
  }

  // Marca a leitura como usada (some da fila). Se falhar, o tema já foi
  // publicado — na pior hipótese o cron re-publica a mesma na próxima, mas a
  // idempotência por semana_inicio evita duplicar na mesma semana.
  await supabase
    .from('lojas_temas_quinta_fila')
    .update({ usada_em: new Date().toISOString(), semana_usada: semana })
    .eq('id', proxima.id);

  // Push avisando as vendedoras (best effort)
  let pushes = 0;
  try {
    const { data: vendedoras } = await supabase
      .from('lojas_vendedoras')
      .select('id, nome, push_subscription')
      .eq('ativa', true)
      .not('push_subscription', 'is', null);
    for (const v of (vendedoras || [])) {
      const r = await enviarPush({
        vendedora: v,
        tipo: 'tema_quinta',
        titulo: `${emoji} Tema da quinta`,
        mensagem: `${titulo} — abre o app pra ler, é rapidinho!`,
        url: '/',
      });
      if (r?.ok) pushes++;
    }
  } catch (e) {
    console.warn('[tema-quinta] push falhou:', e?.message);
  }

  return res.json({ ok: true, semana, categoria: categoria.id, titulo, pushes });
}
