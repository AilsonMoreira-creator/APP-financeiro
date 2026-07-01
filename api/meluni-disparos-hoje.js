// meluni-disparos-hoje.js — contagem de disparos de HOJE (fuso BRT) por tipo,
// pros contadores das abas do modo Meluni: clientes (lara_clientes) e
// carrinhos (lara_carrinho). Leitura leve (count head), sem payload.
import { supabase } from './_meluni-whats-helpers.js';

// inicio do dia de hoje no fuso BRT (UTC-3), em ISO UTC (00:00 BRT = 03:00 UTC)
function inicioHojeBRT() {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  return `${ymd}T03:00:00.000Z`;
}

async function contar(autor, desde) {
  const { count } = await supabase.from('meluni_mensagens')
    .select('id', { count: 'exact', head: true })
    .eq('direcao', 'saida').eq('autor', autor).gte('enviada_em', desde);
  return count || 0;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    const desde = inicioHojeBRT();
    const [clientes, carrinho] = await Promise.all([
      contar('lara_clientes', desde),
      contar('lara_carrinho', desde),
    ]);
    return res.status(200).json({ ok: true, clientes, carrinho });
  } catch (e) {
    return res.status(200).json({ ok: false, erro: String(e?.message || e), clientes: 0, carrinho: 0 });
  }
}
