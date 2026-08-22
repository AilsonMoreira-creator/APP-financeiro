// /api/egress-suspeitos-diag — one-off: pra cada tabela publicada no
// realtime, conta linhas ESCRITAS HOJE e estima o tamanho medio da linha.
// eventos_hoje x tamanho = egress por sessao aberta que assina a tabela.
import { supabase } from './_ml-helpers.js';

const TABS = ['salas_corte_espelho','oficinas_cortes_espelho','lojas_sugestoes_diarias','lojas_pedidos_sacola','lojas_whats_mensagens',
  'lojas_whats_conversas','lojas_whats_sugestoes','lojas_importacoes',
  'clientes_sofia_bloqueios','ordens_corte','oficinas_caseado','oficinas_passadoria',
  'wms_pedidos','lojas_clientes_kpis','ml_conversations','ml_messages'];
const COLS_TS = ['atualizado_em','updated_at','criado_em','created_at','data'];

export default async function handler(req, res) {
  const hoje = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
  const saida = [];
  for (const t of TABS) {
    try {
      const { data: um, error } = await supabase.from(t).select('*').limit(1);
      if (error) { saida.push({ tabela: t, erro: error.message.slice(0, 50) }); continue; }
      if (!um?.length) { saida.push({ tabela: t, vazia: true }); continue; }
      const kb = Math.round(JSON.stringify(um[0]).length / 1024 * 10) / 10;
      const colTs = COLS_TS.find(c => c in um[0]);
      let hojeCount = null;
      if (colTs) {
        const { count } = await supabase.from(t).select('*', { count: 'exact', head: true }).gte(colTs, hoje);
        hojeCount = count ?? null;
      }
      const { count: total } = await supabase.from(t).select('*', { count: 'exact', head: true });
      saida.push({ tabela: t, kb_por_linha: kb, col_ts: colTs || null, escritas_hoje: hojeCount, total, mb_por_sessao: hojeCount ? Math.round(hojeCount * kb / 1024 * 10) / 10 : null });
    } catch (e) { saida.push({ tabela: t, erro: String(e?.message || e).slice(0, 50) }); }
  }
  saida.sort((a, b) => (b.mb_por_sessao || 0) - (a.mb_por_sessao || 0));
  return res.status(200).json({ hoje, tabelas: saida });
}
