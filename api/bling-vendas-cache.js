/**
 * bling-vendas-cache.js — Lê vendas via RPCs do Supabase (agregação no banco)
 * 
 * ANTES: puxava 15000+ linhas e agregava no servidor (~2s, 5MB)
 * AGORA: 2 RPCs retornam ~300 linhas já agregadas (~100ms, 20KB)
 * 
 * RPCs usadas:
 * - fn_vendas_resumo: vendas por dia/conta/canal
 * - fn_vendas_produtos: itens por ref/cor/tamanho
 * - fn_vendas_total: contagem total
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

    // 3 RPCs em paralelo — muito mais rápido que puxar todas as linhas
    const [resumoRes, produtosRes, totalRes] = await Promise.all([
      supabase.rpc('fn_vendas_resumo', { p_data_inicio: data_inicio, p_data_fim: fim }),
      supabase.rpc('fn_vendas_produtos', { p_data_inicio: data_inicio, p_data_fim: fim }),
      supabase.rpc('fn_vendas_total', { p_data_inicio: data_inicio, p_data_fim: fim }),
    ]);

    if (resumoRes.error) {
      console.error("[bling-cache] RPC resumo error:", resumoRes.error);
      return res.status(500).json({ erro: resumoRes.error.message });
    }

    const resumo = resumoRes.data || [];
    const produtos = produtosRes.data || [];
    const totais = totalRes.data?.[0] || { total_pedidos: 0, total_bruto: 0 };

    // Montar estrutura que o frontend espera: { mesKey: { diaKey: { conta: { canal: {...} } } } }
    const resultado = {};

    // 1. Resumo por dia/conta/canal
    for (const r of resumo) {
      const ds = r.data_pedido; // "2026-04-10"
      const mesKey = ds.slice(0, 7);
      const diaKey = ds.slice(8, 10);
      const conta = r.conta;
      const canalGeral = r.canal_geral;

      if (!resultado[mesKey]) resultado[mesKey] = {};
      if (!resultado[mesKey][diaKey]) resultado[mesKey][diaKey] = {};
      if (!resultado[mesKey][diaKey][conta]) resultado[mesKey][diaKey][conta] = {};

      const contaData = resultado[mesKey][diaKey][conta];
      if (!contaData[canalGeral]) {
        contaData[canalGeral] = { pedidos: 0, bruto: 0, frete: 0, itens: 0, subcanais: {}, produtos: [] };
      }

      const cc = contaData[canalGeral];
      cc.pedidos += parseInt(r.pedidos) || 0;
      cc.bruto += parseFloat(r.bruto) || 0;
      cc.frete += parseFloat(r.frete) || 0;
      cc.itens += parseInt(r.total_itens) || 0;

      // Subcanais
      const canalDetalhe = r.canal_detalhe;
      if (!cc.subcanais[canalDetalhe]) cc.subcanais[canalDetalhe] = { pedidos: 0, bruto: 0 };
      cc.subcanais[canalDetalhe].pedidos += parseInt(r.pedidos) || 0;
      cc.subcanais[canalDetalhe].bruto += parseFloat(r.bruto) || 0;
    }

    // 2. Produtos — distribuir por dia/conta/canal
    for (const p of produtos) {
      const ds = p.data_pedido;
      const mesKey = ds.slice(0, 7);
      const diaKey = ds.slice(8, 10);
      const conta = p.conta;
      const canal = p.canal_geral;
      const qtd = parseInt(p.qtd) || 0;
      const valor = parseFloat(p.valor) || 0;

      // Garante que a estrutura existe
      if (!resultado[mesKey]) resultado[mesKey] = {};
      if (!resultado[mesKey][diaKey]) resultado[mesKey][diaKey] = {};
      if (!resultado[mesKey][diaKey][conta]) resultado[mesKey][diaKey][conta] = {};
      if (!resultado[mesKey][diaKey][conta][canal]) {
        resultado[mesKey][diaKey][conta][canal] = { pedidos: 0, bruto: 0, frete: 0, itens: 0, subcanais: {}, produtos: [] };
      }

      const cc = resultado[mesKey][diaKey][conta][canal];
      const existing = cc.produtos.find(x => x.ref === p.ref);
      if (existing) {
        existing.qtd += qtd;
        existing.valor += valor;
        if (p.tamanho) existing.tam[p.tamanho] = (existing.tam[p.tamanho] || 0) + qtd;
        if (p.cor) existing.cor[p.cor] = (existing.cor[p.cor] || 0) + qtd;
      } else {
        const tam = {}; if (p.tamanho) tam[p.tamanho] = qtd;
        const cor = {}; if (p.cor) cor[p.cor] = qtd;
        cc.produtos.push({ ref: p.ref, desc: p.desc_limpa || '', qtd, valor, tam, cor });
      }
    }

    // Ordenar produtos por qtd desc
    for (const mesKey in resultado) {
      for (const diaKey in resultado[mesKey]) {
        for (const conta in resultado[mesKey][diaKey]) {
          for (const canal in resultado[mesKey][diaKey][conta]) {
            resultado[mesKey][diaKey][conta][canal].produtos.sort((a, b) => b.qtd - a.qtd);
          }
        }
      }
    }

    return res.json({
      ok: true,
      data_inicio,
      data_fim: fim,
      totalPedidos: parseInt(totais.total_pedidos) || 0,
      totalBruto: parseFloat(totais.total_bruto) || 0,
      vendas: resultado,
    });

  } catch (e) {
    console.error("[bling-cache] erro:", e);
    return res.status(500).json({ erro: e.message });
  }
}
