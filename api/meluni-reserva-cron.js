// /api/meluni-reserva-cron — alerta de RESERVA DE ESTOQUE (Ailson 07/07/2026).
// Pra cada telefone com a tag 'reserva_estoque' (ref + desde) ainda nao alertado,
// checa se um corte Meluni daquela ref foi ENTREGUE depois da reserva e ja faz
// >= 3 dias (folga de passadoria). Se sim, marca reserva_alerta_em e avisa por push.
// Fonte dos cortes: amicia_data user_id='ailson_cortes', payload.cortes
// (marca Meluni, entregue=true, dataEntrega DD/MM/YYYY). NAO cruza vendas.
// ?dry=1 = previa (nao grava nem envia). Roda 1x/dia.
import { supabase } from './_bling-helpers.js';
import { enviarPushSAC } from './_push-helpers.js';

const DIAS_FOLGA = 3;

// DD/MM/YYYY -> Date (UTC meia-noite). null se invalido.
function parseBR(s) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s || '').trim());
  if (!m) return null;
  const d = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  return isNaN(d.getTime()) ? null : d;
}
const diaUTC = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const normRef = (r) => String(r || '').replace(/^0+/, '') || '0';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const ua = req.headers['user-agent'] || '';
  const ehCron = ua.startsWith('vercel-cron') || req.headers['x-vercel-cron'] !== undefined;
  const force = req.query?.force === '1';
  const dry = req.query?.dry === '1';
  if (!ehCron && !force && !dry) return res.status(403).json({ erro: 'cron only (use ?dry=1 pra previa)' });

  try {
    // 1. cortes Meluni entregues -> mapa ref -> [datas de entrega]
    const { data: cortesRow } = await supabase.from('amicia_data')
      .select('payload').eq('user_id', 'ailson_cortes').maybeSingle();
    const cortes = Array.isArray(cortesRow?.payload?.cortes) ? cortesRow.payload.cortes : [];
    const entregasPorRef = {};
    for (const c of cortes) {
      if (String(c?.marca || '').toLowerCase() !== 'meluni') continue;
      if (String(c?.entregue) !== 'true') continue;
      const dt = parseBR(c?.dataEntrega);
      if (!dt) continue;
      const ref = normRef(c?.ref);
      (entregasPorRef[ref] = entregasPorRef[ref] || []).push(dt);
    }

    // 2. vinculos com reserva pendente (ainda sem alerta)
    const { data: vincs } = await supabase.from('meluni_tags_vinculos')
      .select('telefone, tags, reserva_alerta_em')
      .is('reserva_alerta_em', null)
      .contains('tags', JSON.stringify([{ id: 'reserva_estoque' }]));

    const hoje = diaUTC(new Date());
    const alertados = [];
    for (const v of (vincs || [])) {
      const tag = (v.tags || []).find(t => t.id === 'reserva_estoque');
      if (!tag?.ref || !tag?.desde) continue;              // reserva sem ref/desde nao entra
      const ref = normRef(tag.ref);
      const desdeDia = diaUTC(new Date(tag.desde));
      const entregas = (entregasPorRef[ref] || []).filter(d => d >= desdeDia);
      if (!entregas.length) continue;                       // nada chegou depois da reserva
      const primeira = entregas.reduce((a, b) => (a < b ? a : b)); // 1a chegada apos reservar
      const dias = Math.floor((hoje - primeira) / 86400000);
      if (dias < DIAS_FOLGA) continue;                      // ainda na folga de passadoria
      alertados.push({ telefone: v.telefone, ref, entregue_em: primeira.toISOString().slice(0, 10), dias });
    }

    if (dry) return res.status(200).json({ dryRun: true, candidatos: alertados.length, alertados });

    // 3. marca o alerta e avisa (push agregado)
    for (const a of alertados) {
      await supabase.from('meluni_tags_vinculos')
        .update({ reserva_alerta_em: new Date().toISOString() })
        .eq('telefone', a.telefone);
    }
    if (alertados.length) {
      const refs = [...new Set(alertados.map(a => a.ref))];
      await enviarPushSAC({
        titulo: '📦 Reserva chegou',
        mensagem: alertados.length === 1
          ? `A ${refs[0]} chegou. Avisa a cliente que reservou.`
          : `${alertados.length} reservas chegaram (refs ${refs.join(', ')}). Avisa as clientes.`,
        url: '/?modulo=meluni',
        tag: 'meluni-reserva',
      }).catch(() => {});
    }
    return res.status(200).json({ ok: true, alertados: alertados.length, refs: [...new Set(alertados.map(a => a.ref))] });
  } catch (e) {
    console.error('[meluni-reserva-cron]', e?.message || e);
    return res.status(500).json({ ok: false, erro: e?.message || String(e) });
  }
}
