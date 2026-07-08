// /api/meluni-novidade-cron — dispara a NOVIDADE (template foto+nome+botão) pra
// todos os clientes com última compra há >= 7 dias. ONE-SHOT: roda diário às
// 10:00 BRT (13:00 UTC) mas só DISPARA no dia-alvo e uma única vez (guarda em
// meluni_config -> 'novidade_cron'). ?dry=1 mostra a prévia (qtd) sem enviar.
// Ailson 23/06/2026.
import { supabase, cfgMeluni, setCfgMeluni } from './_meluni-whats-helpers.js';
import { selecionarElegiveis, dispararNovidadeParaIds } from './_meluni-novidade-core.js';
import { telefonesCongelados } from './_meluni-tags-core.js';

function hojeBRT() { return new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10); }

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const ua = req.headers['user-agent'] || '';
  const ehCron = ua.startsWith('vercel-cron') || req.headers['x-vercel-cron'] !== undefined;
  const force = req.query?.force === '1';
  const dry = req.query?.dry === '1';
  if (!ehCron && !force && !dry) return res.status(403).json({ erro: 'cron only (use ?dry=1 pra previa)' });

  const conf = (await cfgMeluni('novidade_cron', null)) || {};
  const hoje = hojeBRT();
  const cfgKey = conf.cfg || 'lara_templates_novidade';
  const versao = conf.versao || null;
  const max = Number(conf.max_por_run || 500);

  // Prévia: não envia nada, só conta os elegíveis.
  if (dry) {
    const ids = await selecionarElegiveis({ dias: 7, max });
    return res.status(200).json({
      dryRun: true, hoje, data_alvo: conf.data_alvo || null,
      ativo: !!conf.ativo, ja_disparou_em: conf.ja_disparou_em || null, elegiveis: ids.length,
    });
  }

  if (!conf.ativo) return res.status(200).json({ skip: 'inativo', hoje });
  if (conf.data_alvo && hoje !== conf.data_alvo) return res.status(200).json({ skip: 'fora_da_data', hoje, data_alvo: conf.data_alvo });
  if (conf.ja_disparou_em) return res.status(200).json({ skip: 'ja_disparou', ja_disparou_em: conf.ja_disparou_em });

  const ids = await selecionarElegiveis({ dias: 7, max });
  if (!ids.length) {
    await setCfgMeluni('novidade_cron', { ...conf, ja_disparou_em: new Date().toISOString(), resultado: { enviados: 0, pulados: 0, erros: 0, total: 0 } });
    return res.status(200).json({ ok: true, hoje, enviados: 0, total: 0, obs: 'nenhum elegivel' });
  }

  const congelados = await telefonesCongelados(supabase); // Atencao congela
  const r = await dispararNovidadeParaIds(ids, { cfg: cfgKey, versao, maxPorChamada: ids.length, congelados });
  await setCfgMeluni('novidade_cron', {
    ...conf,
    ja_disparou_em: new Date().toISOString(),
    resultado: { enviados: r.enviados, pulados: r.pulados, erros: r.erros, total: r.total, template: r.template },
  });

  return res.status(200).json({
    ok: true, hoje, template: r.template,
    enviados: r.enviados, pulados: r.pulados, erros: r.erros, total: r.total,
  });
}
