// ═══════════════════════════════════════════════════════════════════════════
// /api/folha-aplicar-vales-cron
// ═══════════════════════════════════════════════════════════════════════════
//
// Cron mensal — dia 20 às 06:00 BRT (= 09:00 UTC)
// vercel.json: { "path": "/api/folha-aplicar-vales-cron", "schedule": "0 9 20 * *" }
//
// Pra cada funcionario ATIVO em folha-pagamento que tem regra vale_pago > 0:
//   1. Acha a linha dele em payload.auxDataPorMes[mesAtual]['Funcionários']
//      (case-insensitive em nome vs nome_planilha)
//   2. Atualiza coluna 'vale' com o valor configurado
//   3. Marca em vales_aplicados[`${func_id}|${competencia}`] pra ser idempotente
//
// Manual: GET /api/folha-aplicar-vales-cron?user=ailson[&competencia=2026-05]
//
// Sessão Ailson 09/05/2026
// ═══════════════════════════════════════════════════════════════════════════
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const ADMINS = ['ailson', 'amicia-admin', 'admin', 'tamara'];

function competenciaCorrente() {
  // Em BRT (UTC-3)
  const agora = new Date();
  const brt = new Date(agora.getTime() - 3 * 3600 * 1000);
  return `${brt.getUTCFullYear()}-${String(brt.getUTCMonth() + 1).padStart(2, '0')}`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Auth: cron Vercel OU admin manual
  const user = req.query.user || '';
  const userAgent = req.headers['user-agent'] || '';
  const ehCron = userAgent.startsWith('vercel-cron');
  const ehAdmin = ADMINS.includes(user);
  if (!ehCron && !ehAdmin) {
    return res.status(403).json({ error: 'Auth: cron ou ?user=ailson' });
  }

  const competencia = req.query.competencia || competenciaCorrente();
  if (!/^\d{4}-\d{2}$/.test(competencia)) {
    return res.status(400).json({ error: 'competencia formato YYYY-MM' });
  }
  const [, mesStr] = competencia.split('-');
  const mes = parseInt(mesStr, 10);

  try {
    // 1. Carrega payload da folha
    const { data: folha, error: errF } = await supabase
      .from('amicia_data')
      .select('payload')
      .eq('user_id', 'folha-pagamento')
      .maybeSingle();
    if (errF) throw new Error('folha: ' + errF.message);
    if (!folha?.payload?.funcionarios?.length) {
      return res.json({ ok: true, msg: 'Nenhum funcionario cadastrado em folha-pagamento', stats: { total: 0 } });
    }
    const folhaPayload = folha.payload;
    const funcionarios = folhaPayload.funcionarios.filter(f => f.ativo);
    const regras = folhaPayload.regras || {};
    const valesAplicados = folhaPayload.vales_aplicados || {};

    // 2. Carrega payload financeiro (amicia-admin)
    const { data: fin, error: errFin } = await supabase
      .from('amicia_data')
      .select('payload')
      .eq('user_id', 'amicia-admin')
      .maybeSingle();
    if (errFin) throw new Error('amicia-admin: ' + errFin.message);
    if (!fin?.payload) {
      return res.status(404).json({ error: 'Payload financeiro nao encontrado' });
    }
    const finPayload = fin.payload;
    finPayload.auxDataPorMes = finPayload.auxDataPorMes || {};
    if (!finPayload.auxDataPorMes[mes]) finPayload.auxDataPorMes[mes] = {};
    if (!finPayload.auxDataPorMes[mes]['Funcionários']) finPayload.auxDataPorMes[mes]['Funcionários'] = [];
    const linhasPlanilha = finPayload.auxDataPorMes[mes]['Funcionários'];

    // 3. Pra cada funcionario com vale_pago > 0
    const stats = { total: funcionarios.length, aplicados: 0, ja_aplicados: 0, sem_vale: 0, nao_encontrados: 0 };
    const detalhe = [];

    for (const f of funcionarios) {
      const valeRegra = (regras[f.id] || []).find(r => r.tipo === 'vale_pago' && r.ativo);
      const valeValor = Number(valeRegra?.config?.valor || 0);

      if (valeValor <= 0) {
        stats.sem_vale++;
        detalhe.push({ func: f.nome_display, acao: 'sem_vale' });
        continue;
      }

      const chaveAplicado = `${f.id}|${competencia}`;
      if (valesAplicados[chaveAplicado]) {
        stats.ja_aplicados++;
        detalhe.push({ func: f.nome_display, acao: 'ja_aplicado', vale: valeValor, em: valesAplicados[chaveAplicado] });
        continue;
      }

      // Acha linha case-insensitive
      const alvo = (f.nome_planilha || f.nome_display).trim().toLowerCase();
      const linha = linhasPlanilha.find(r => String(r.nome || '').trim().toLowerCase() === alvo);
      if (!linha) {
        stats.nao_encontrados++;
        detalhe.push({ func: f.nome_display, nome_planilha: f.nome_planilha, acao: 'nao_encontrado_planilha' });
        continue;
      }

      // Aplica
      const valeAtual = parseFloat(linha.vale || 0);
      linha.vale = valeValor.toFixed(2);
      valesAplicados[chaveAplicado] = new Date().toISOString();
      stats.aplicados++;
      detalhe.push({
        func: f.nome_display, nome_planilha: linha.nome,
        acao: 'aplicado', vale_anterior: valeAtual, vale_novo: valeValor,
      });
    }

    // 4. Persiste mudancas
    if (stats.aplicados > 0) {
      // Atualiza payload financeiro com novos vales
      const { error: errU1 } = await supabase
        .from('amicia_data')
        .update({ payload: finPayload, updated_at: new Date().toISOString() })
        .eq('user_id', 'amicia-admin');
      if (errU1) throw new Error('update amicia-admin: ' + errU1.message);

      // Atualiza folha-pagamento com vales_aplicados
      folhaPayload.vales_aplicados = valesAplicados;
      const { error: errU2 } = await supabase
        .from('amicia_data')
        .update({ payload: folhaPayload, updated_at: new Date().toISOString() })
        .eq('user_id', 'folha-pagamento');
      if (errU2) throw new Error('update folha-pagamento: ' + errU2.message);
    }

    return res.json({
      ok: true,
      competencia, mes,
      executado_em: new Date().toISOString(),
      iniciada_por: ehCron ? 'cron' : user,
      stats, detalhe,
    });
  } catch (e) {
    console.error('[folha-aplicar-vales-cron] erro:', e?.message);
    return res.status(500).json({ error: e?.message || 'Erro' });
  }
}
