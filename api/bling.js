// api/bling.js — Vercel Serverless Function
// Busca pedidos "Atendido" do dia na API Bling V3 para 3 tokens (Exitus, Lumia, Muniam)

export default async function handler(req, res) {
  // Permite chamadas do próprio app no Vercel
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ erro: "Método não permitido" });

  const { tokens, devolucao = 10 } = req.body;

  if (!tokens || !tokens.exitus) {
    return res.status(400).json({ erro: "Tokens não informados" });
  }

  // Data de hoje no formato esperado pelo Bling: YYYY-MM-DD
  const hoje = new Date();
  const dataHoje = hoje.toISOString().slice(0, 10);

  const marcas = ["exitus", "lumia", "muniam"];
  const resultados = {};
  let totalBruto = 0;
  let totalPedidos = 0;
  const erros = [];

  for (const marca of marcas) {
    const token = tokens[marca];
    if (!token) {
      resultados[marca] = { valor: 0, pedidos: 0, erro: "Token não configurado" };
      continue;
    }

    try {
      // Bling V3 — busca pedidos com filtro de data e situação "Atendido" (situacaoId=9)
      let pagina = 1;
      let valorMarca = 0;
      let pedidosMarca = 0;
      let continuar = true;

      while (continuar) {
        const url = `https://api.bling.com.br/Api/v3/pedidos/vendas?pagina=${pagina}&limite=100&dataInicial=${dataHoje}&dataFinal=${dataHoje}&situacaoId=9`;

        const resp = await fetch(url, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
          },
        });

        if (!resp.ok) {
          const errBody = await resp.text();
          erros.push(`${marca}: HTTP ${resp.status} — ${errBody.slice(0, 100)}`);
          continuar = false;
          break;
        }

        const data = await resp.json();
        const pedidos = data?.data || [];

        for (const pedido of pedidos) {
          const valor = parseFloat(pedido.totalVenda || pedido.total || 0);
          valorMarca += valor;
          pedidosMarca++;
        }

        // Bling retorna até 100 por página — se veio menos, acabou
        if (pedidos.length < 100) {
          continuar = false;
        } else {
          pagina++;
        }
      }

      resultados[marca] = { valor: valorMarca, pedidos: pedidosMarca };
      totalBruto += valorMarca;
      totalPedidos += pedidosMarca;
    } catch (e) {
      erros.push(`${marca}: ${e.message}`);
      resultados[marca] = { valor: 0, pedidos: 0, erro: e.message };
    }
  }

  // Aplica desconto de devolução
  const pctDevolucao = parseFloat(devolucao) / 100;
  const totalLiquido = Math.round(totalBruto * (1 - pctDevolucao));

  return res.status(200).json({
    data: dataHoje,
    totalBruto: Math.round(totalBruto * 100) / 100,
    totalLiquido,
    pctDevolucao: devolucao,
    totalPedidos,
    resultados,
    erros: erros.length > 0 ? erros : null,
  });
}
