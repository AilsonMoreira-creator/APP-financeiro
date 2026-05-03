// ═══════════════════════════════════════════════════════════════════════════
// /api/lojas-push-cron-1400
// ═══════════════════════════════════════════════════════════════════════════
// Cron Vercel seg-sex 14:00 BRT. Retry — quem nao abriu desde o lembrete
// das 10:30 recebe segundo push.
// ═══════════════════════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js';
import { enviarPush, escolherMensagem, checarAuthCron } from './_push-helpers.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  if (!checarAuthCron(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Hoje BRT
  const hojeBRT = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const inicioHojeBRT = new Date(hojeBRT.getFullYear(), hojeBRT.getMonth(), hojeBRT.getDate(), 0, 0, 0);
  const inicioHojeUTC = new Date(inicioHojeBRT.getTime() + 3 * 60 * 60 * 1000).toISOString();

  // 1. Busca quem recebeu lembrete_1030 hoje com sucesso
  const { data: receberam1030 } = await supabase
    .from('lojas_push_log')
    .select('vendedora_id')
    .eq('tipo', 'lembrete_1030')
    .eq('sucesso', true)
    .gte('enviado_em', inicioHojeUTC);

  const receberam1030Set = new Set((receberam1030 || []).map(r => r.vendedora_id));

  if (receberam1030Set.size === 0) {
    return res.json({ ok: true, motivo: 'ninguem recebeu 10:30 hoje, nada pra retentar' });
  }

  // 2. Busca quem ja recebeu o retry (evita duplo)
  const { data: jaRetentaram } = await supabase
    .from('lojas_push_log')
    .select('vendedora_id')
    .eq('tipo', 'lembrete_1400')
    .eq('sucesso', true)
    .gte('enviado_em', inicioHojeUTC);

  const jaRetentadoSet = new Set((jaRetentaram || []).map(r => r.vendedora_id));

  // 3. Busca dados completos das que receberam 10:30 e nao abriram E nao retentaram
  const { data: vendedoras } = await supabase
    .from('lojas_vendedoras')
    .select('id, nome, push_subscription, ultimo_acesso_em')
    .in('id', Array.from(receberam1030Set))
    .not('push_subscription', 'is', null);

  const enviarPara = (vendedoras || []).filter(v => {
    if (jaRetentadoSet.has(v.id)) return false;
    // Se abriu desde 10:30, pula
    if (v.ultimo_acesso_em && v.ultimo_acesso_em >= inicioHojeUTC) return false;
    return true;
  });

  const resultados = [];
  for (const vendedora of enviarPara) {
    const mensagem = escolherMensagem(vendedora.nome);
    const r = await enviarPush({
      vendedora,
      tipo: 'lembrete_1400',
      titulo: 'Amícia',
      mensagem,
      url: '/',
    });
    resultados.push({ vendedora_id: vendedora.id, nome: vendedora.nome, ...r });
  }

  return res.json({
    ok: true,
    receberam_1030: receberam1030Set.size,
    enviados_retry: enviarPara.length,
    resultados,
  });
}
