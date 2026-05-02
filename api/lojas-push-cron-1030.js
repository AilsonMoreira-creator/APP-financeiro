// ═══════════════════════════════════════════════════════════════════════════
// /api/lojas-push-cron-1030
// ═══════════════════════════════════════════════════════════════════════════
// Cron Vercel seg-sex 10:30 BRT. Envia lembrete pras vendedoras que ainda
// nao abriram o app hoje.
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

  // Hoje BRT (UTC-3)
  const hojeBRT = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const inicioHojeBRT = new Date(hojeBRT.getFullYear(), hojeBRT.getMonth(), hojeBRT.getDate(), 0, 0, 0);
  // Converte de volta pra UTC pra comparar com timestamps do banco
  const inicioHojeUTC = new Date(inicioHojeBRT.getTime() + 3 * 60 * 60 * 1000).toISOString();

  // Busca vendedoras ativas com push ativado que NAO abriram hoje
  const { data: candidatas, error } = await supabase
    .from('lojas_vendedoras')
    .select('id, nome, push_subscription, ultimo_acesso_em')
    .eq('ativa', true)
    .eq('is_placeholder', false)
    .not('push_subscription', 'is', null);

  if (error) {
    console.error('[cron-1030] erro buscar vendedoras:', error);
    return res.status(500).json({ error: 'erro buscar vendedoras', detalhe: error.message });
  }

  const naoAbriramHoje = (candidatas || []).filter(v => {
    if (!v.ultimo_acesso_em) return true;
    return v.ultimo_acesso_em < inicioHojeUTC;
  });

  // Verifica se ja recebeu push hoje (idempotencia se cron rodar 2x)
  const { data: jaEnviadosHoje } = await supabase
    .from('lojas_push_log')
    .select('vendedora_id')
    .eq('tipo', 'lembrete_1030')
    .eq('sucesso', true)
    .gte('enviado_em', inicioHojeUTC);

  const jaRecebidoSet = new Set((jaEnviadosHoje || []).map(r => r.vendedora_id));
  const enviarPara = naoAbriramHoje.filter(v => !jaRecebidoSet.has(v.id));

  // Dispara em sequencia (volume baixo, 5 vendedoras)
  const resultados = [];
  for (const vendedora of enviarPara) {
    const mensagem = escolherMensagem(vendedora.nome);
    const r = await enviarPush({
      vendedora,
      tipo: 'lembrete_1030',
      titulo: 'Amícia',
      mensagem,
      url: '/',
    });
    resultados.push({ vendedora_id: vendedora.id, nome: vendedora.nome, ...r });
  }

  return res.json({
    ok: true,
    candidatas: candidatas?.length || 0,
    nao_abriram: naoAbriramHoje.length,
    enviados: enviarPara.length,
    pulados_ja_enviados: naoAbriramHoje.length - enviarPara.length,
    resultados,
  });
}
