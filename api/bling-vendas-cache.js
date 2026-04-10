/**
 * bling-vendas-cache.js — Lê vendas detalhadas do cache Supabase
 * Retorna dados agregados no formato que o frontend espera
 * Substitui bling-vendas-dia.js (que batia no rate limit)
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ erro: "Use POST" });

  try {
    const { data_inicio, data_fim } = req.body;
    if (!data_inicio) return res.status(400).json({ erro: "Falta data_inicio" });

    const fim = data_fim || data_inicio;

    // Busca todos os pedidos cacheados no período
    const { data: pedidos, error } = await supabase
      .from('bling_vendas_detalhe')
      .select('*')
      .gte('data_pedido', data_inicio)
      .lte('data_pedido', fim)
      .order('data_pedido', { ascending: true });

    if (error) {
      console.error("[bling-cache] erro query:", error);
      return res.status(500).json({ erro: error.message });
    }

    // Agrega no formato: { mesKey: { diaKey: { conta: { canal: {...} } } } }
    const resultado = {};

    for (const p of (pedidos || [])) {
      const mesKey = p.data_pedido.slice(0, 7);   // "2026-04"
      const diaKey = p.data_pedido.slice(8, 10);   // "10"
      const conta = p.conta;
      const canalGeral = p.canal_geral || "Outros";
      const canalDetalhe = p.canal_detalhe || "Outros";

      if (!resultado[mesKey]) resultado[mesKey] = {};
      if (!resultado[mesKey][diaKey]) resultado[mesKey][diaKey] = {};
      if (!resultado[mesKey][diaKey][conta]) resultado[mesKey][diaKey][conta] = {};

      const contaData = resultado[mesKey][diaKey][conta];
      if (!contaData[canalGeral]) {
        contaData[canalGeral] = {
          pedidos: 0,
          bruto: 0,
          frete: 0,
          itens: 0,
          subcanais: {},
          produtos: {}
        };
      }

      const cc = contaData[canalGeral];
      cc.pedidos++;
      cc.bruto += parseFloat(p.total_produtos || 0);
      cc.frete += Math.max(0, parseFloat(p.total_pedido || 0) - parseFloat(p.total_produtos || 0));

      // Subcanais
      if (!cc.subcanais[canalDetalhe]) cc.subcanais[canalDetalhe] = { pedidos: 0, bruto: 0 };
      cc.subcanais[canalDetalhe].pedidos++;
      cc.subcanais[canalDetalhe].bruto += parseFloat(p.total_produtos || 0);

      // Itens / Produtos
      const itens = p.itens || [];
      for (const item of itens) {
        const ref = item.ref || "SEM-REF";
        const qtd = parseInt(item.quantidade) || 1;
        const valor = parseFloat(item.valor) || 0;
        cc.itens += qtd;

        if (ref === "SEM-REF") continue;
        if (!cc.produtos[ref]) {
          cc.produtos[ref] = { ref, desc: item.descLimpa || "", qtd: 0, valor: 0, tam: {}, cor: {} };
        }
        const prod = cc.produtos[ref];
        prod.qtd += qtd;
        prod.valor += valor * qtd;
        if (item.tamanho) prod.tam[item.tamanho] = (prod.tam[item.tamanho] || 0) + qtd;
        if (item.cor) prod.cor[item.cor] = (prod.cor[item.cor] || 0) + qtd;
      }
    }

    // Converte produtos de objeto pra array ordenado (como o frontend espera)
    for (const mesKey in resultado) {
      for (const diaKey in resultado[mesKey]) {
        for (const conta in resultado[mesKey][diaKey]) {
          for (const canal in resultado[mesKey][diaKey][conta]) {
            const cc = resultado[mesKey][diaKey][conta][canal];
            cc.produtos = Object.values(cc.produtos).sort((a, b) => b.qtd - a.qtd);
          }
        }
      }
    }

    // Total bruto geral (pra o frontend usar no lançamento)
    let totalBruto = 0;
    for (const p of (pedidos || [])) {
      totalBruto += parseFloat(p.total_produtos || 0);
    }

    return res.json({
      ok: true,
      data_inicio,
      data_fim: fim,
      totalPedidos: (pedidos || []).length,
      totalBruto,
      vendas: resultado
    });

  } catch (e) {
    console.error("[bling-cache] erro:", e);
    return res.status(500).json({ erro: e.message });
  }
}
