// ═══════════════════════════════════════════════════════════════════════════
// clientes-reativar-kpi.js — contador do card "Reativar Clientes" na home
// ═══════════════════════════════════════════════════════════════════════════
// Conta clientes em "conversando" na régua de reativação (inativo) cuja ÚLTIMA
// mensagem foi do CLIENTE (esperando resposta da vendedora). Se vier ?vendedora
// filtra só os cards dela (vínculo pela última venda). Admin (sem vendedora) vê
// o total. (Ailson 12/06/2026)
// ═══════════════════════════════════════════════════════════════════════════
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    const vendedoraId = req.query.vendedora || null;

    // 1. clientes em fase 'conversando' na régua inativo
    const { data: fases, error } = await supabase.rpc('fn_clientes_sofia_fases', { p_regua: 'inativo' });
    if (error) throw error;
    let conversando = (fases || []).filter(f => f.fase === 'conversando');
    if (conversando.length === 0) return res.status(200).json({ naoRespondidas: 0 });

    // 2. filtra "não respondida": última mensagem da conversa = entrada (cliente)
    const convIds = conversando.map(c => c.conversa_id).filter(Boolean);
    const naoResp = new Set();
    for (let i = 0; i < convIds.length; i += 200) {
      const bloco = convIds.slice(i, i + 200);
      const { data: msgs } = await supabase
        .from('lojas_whats_mensagens')
        .select('conversa_id, direcao, enviada_em')
        .in('conversa_id', bloco)
        .order('enviada_em', { ascending: false });
      // primeira (mais recente) de cada conversa
      const vista = new Set();
      for (const m of (msgs || [])) {
        if (vista.has(m.conversa_id)) continue;
        vista.add(m.conversa_id);
        if (m.direcao === 'entrada') naoResp.add(m.conversa_id);
      }
    }
    let alvo = conversando.filter(c => naoResp.has(c.conversa_id));

    // 3. filtro por vendedora (última venda)
    if (vendedoraId) {
      const ids = alvo.map(c => c.cliente_id);
      const donoMap = new Map();
      for (let i = 0; i < ids.length; i += 200) {
        const { data: vendas } = await supabase.from('lojas_vendas')
          .select('cliente_id, vendedora_id, data_venda, created_at')
          .in('cliente_id', ids.slice(i, i + 200))
          .not('vendedora_id', 'is', null)
          .order('data_venda', { ascending: false }).order('created_at', { ascending: false });
        for (const v of (vendas || [])) if (!donoMap.has(v.cliente_id)) donoMap.set(v.cliente_id, v.vendedora_id);
      }
      alvo = alvo.filter(c => String(donoMap.get(c.cliente_id)) === String(vendedoraId));
    }

    return res.status(200).json({ naoRespondidas: alvo.length });
  } catch (e) {
    console.error('[clientes-reativar-kpi]', e.message);
    return res.status(200).json({ naoRespondidas: 0, erro: e.message });
  }
}
