/**
 * lojas-aviso-falta-whatsapp-cron.js
 *
 * Cron SEMANAL toda segunda 08:30 BRT (11:30 UTC). Pra cada vendedora
 * com 5+ clientes ATIVOS sem WhatsApp OU 10+ em ATENÇÃO sem WhatsApp,
 * cria 1 aviso humorado pedindo pra preencher.
 *
 * Chama lojas_aviso_falta_whatsapp_disparar() que faz toda logica em
 * SQL. Idempotente (anti-dup por vendedora+semana, 6 dias).
 *
 * FLAG PRA PAUSAR SEM DEPLOY:
 *   Le lojas_config 'aviso_falta_whatsapp_ativo'. Se false, nao dispara
 *   e retorna ok com motivo='pausado_via_config'. Pra reativar, setar
 *   true no lojas_config.
 *
 * Plano Ailson 20/05/2026:
 *   - Roda segunda 26/05 (vendedoras veem na semana)
 *   - Depois ele decide se mantem ou pausa via config flag
 *
 * Schedule vercel.json: "30 11 * * 1"
 */
import { supabase, setCors, getLojasConfig } from './_lojas-helpers.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Use GET ou POST' });
  }

  const tInicio = Date.now();

  try {
    // Checa flag pausa antes de qualquer trabalho
    const ativo = await getLojasConfig('aviso_falta_whatsapp_ativo', true);
    // Aceita true, 'true', 1 - qualquer "truthy" do banco como ativo
    const flagAtivo = ativo === true || ativo === 'true' || ativo === 1;

    if (!flagAtivo) {
      return res.status(200).json({
        ok: true,
        motivo: 'pausado_via_config',
        flag_aviso_falta_whatsapp_ativo: ativo,
        nota: 'Setar lojas_config.aviso_falta_whatsapp_ativo=true pra reativar',
      });
    }

    const { data, error } = await supabase
      .rpc('lojas_aviso_falta_whatsapp_disparar')
      .maybeSingle();
    if (error) throw error;

    return res.status(200).json({
      ok: true,
      duracao_ms: Date.now() - tInicio,
      avisos_criados: data?.avisos_criados || 0,
      vendedoras_atingidas: data?.vendedoras_atingidas || 0,
      vendedoras_puladas: data?.vendedoras_puladas || 0,
    });
  } catch (err) {
    console.error('[lojas-aviso-falta-whatsapp-cron]', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
