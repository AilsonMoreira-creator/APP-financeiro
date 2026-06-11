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

import { supabase, chamarClaude, getLojasConfig, setCors } from './_lojas-helpers.js';
import { enviarPush } from './_push-helpers.js';

export const config = { maxDuration: 120 };

// Categorias rotacionadas semana a semana (a IA recebe a categoria do turno
// e os últimos títulos pra nunca repetir assunto).
const CATEGORIAS = [
  { id: 'tendencia',       label: 'Tendência de moda feminina (atacado)' },
  { id: 'abordagem',       label: 'Dica de abordagem de cliente no WhatsApp' },
  { id: 'pos_venda',       label: 'Pós-venda e fidelização de lojista' },
  { id: 'mix_vitrine',     label: 'Mix de produtos e vitrine da lojista' },
  { id: 'negociacao',      label: 'Negociação e fechamento no atacado' },
  { id: 'reativacao',      label: 'Como reativar cliente sumida' },
  { id: 'fotos_conteudo',  label: 'Fotos e conteúdo que vendem no WhatsApp' },
  { id: 'organizacao',     label: 'Organização da rotina de vendas' },
];

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

  // Últimos 8 temas (anti-repetição) + categoria do turno (rotação)
  const { data: anteriores } = await supabase
    .from('lojas_temas_quinta')
    .select('categoria, titulo')
    .order('semana_inicio', { ascending: false })
    .limit(8);
  const usadas = (anteriores || []).map(t => t.categoria);
  const categoria = CATEGORIAS.find(c => !usadas.slice(0, 4).includes(c.id)) || CATEGORIAS[0];

  const modeloIA = await getLojasConfig('modelo_ia', 'claude-sonnet-4-6');
  let titulo = null, conteudo = null, emoji = '💡';
  try {
    const resp = await chamarClaude({
      model: modeloIA,
      max_tokens: 900,
      system: `Você escreve o "Tema da quinta" — uma mini-edição semanal pras vendedoras das lojas físicas do Grupo Amícia (moda feminina ATACADO, São Paulo — Brás e Bom Retiro). As leitoras vendem pra LOJISTAS (revendedoras), não pra consumidora final.

TOM: amiga experiente do balcão. Brasileiro descontraído, "vc", frases curtas. Inclua 1-2 brincadeiras leves pra descontrair (humor de loja: cafezinho, cabide, cliente que "vai pensar"). SEM ser piegas, SEM jargão de coach.

PROIBIDO: as palavras "incrível", "imperdível", "sensacional", travessão (—) e o emoji 💛.

FORMATO DA RESPOSTA (JSON puro, sem markdown):
{"emoji": "1 emoji que resume o tema", "titulo": "título curto e chamativo (máx 45 chars)", "conteudo": "texto de 150-220 palavras, parágrafos curtos separados por \\n\\n, terminando com 1 desafio prático da semana (algo que ela consegue fazer hoje mesmo)"}`,
      messages: [{
        role: 'user',
        content: `Categoria desta semana: ${categoria.label}.

Títulos já usados (NÃO repita o assunto): ${(anteriores || []).map(t => t.titulo).join(' · ') || 'nenhum ainda'}.

Contexto da casa: peças fortes são linho, viscolinho e alfaiataria; clientes lojistas compram pelo WhatsApp, na loja física e pelo catálogo vesti; a IA do app sugere 7 clientes por dia pra cada vendedora abordar.

Escreva o Tema da quinta.`,
      }],
    });
    const texto = resp?.content?.find(b => b?.type === 'text')?.text?.trim() || '';
    const parsed = JSON.parse(texto.replace(/```json|```/g, '').trim());
    titulo = String(parsed.titulo || '').slice(0, 60);
    conteudo = String(parsed.conteudo || '');
    emoji = String(parsed.emoji || '💡').slice(0, 4);
  } catch (e) {
    console.error('[tema-quinta] erro Claude:', e?.message);
  }
  if (!titulo || !conteudo) {
    return res.status(500).json({ error: 'IA não retornou tema válido' });
  }

  const { error: errSalvar } = await supabase
    .from('lojas_temas_quinta')
    .upsert({
      semana_inicio: semana,
      categoria: categoria.id,
      titulo, conteudo, emoji,
      modelo_ia: modeloIA,
      gerado_em: new Date().toISOString(),
    }, { onConflict: 'semana_inicio' });
  if (errSalvar) {
    return res.status(500).json({ error: errSalvar.message });
  }

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
