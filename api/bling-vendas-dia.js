// /api/bling-vendas-dia.js v6
// Processa em CHUNKS de 80 pedidos (~28s) pra não estourar timeout Vercel (60s)
// Cliente chama múltiplas vezes com skip=0, skip=80, skip=160... até temMais=false

function parseDescricao(descricao) {
  const r = { ref: "", tamanho: "", cor: "", estoque: "", descLimpa: "" };
  if (!descricao) return r;
  const refM = descricao.match(/\(ref\.?\s*(\d{3,5})\)/i);
  if (refM) r.ref = refM[1];
  const estM = descricao.match(/\(([A-E])\)/);
  if (estM) r.estoque = estM[1];
  const corM = descricao.match(/Cor:([^;]+)/i);
  if (corM) r.cor = corM[1].trim().split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
  const tamM = descricao.match(/Tamanho:([A-Z0-9]+)/i);
  if (tamM) r.tamanho = tamM[1].toUpperCase();
  r.descLimpa = descricao.replace(/\(ref\.?\s*\d{3,5}\)/gi,"").replace(/\([A-E]\)/g,"").replace(/Cor:[^;]+/gi,"").replace(/;?\s*Tamanho:[A-Z0-9]+/gi,"").replace(/\s+/g," ").replace(/[;\s]+$/,"").trim();
  return r;
}

function parseCanal(nome) {
  if (!nome) return { geral: "Outros", detalhe: "Outros" };
  const l = nome.toLowerCase().trim();
  if (!l) return { geral: "Outros", detalhe: "Outros" };
  if (l.includes("mercado livre")||l.includes("mercadolivre")||l.includes("meli")) {
    const isFull = l.includes("full")||l.includes("fulfillment")||l.includes("flex");
    return { geral:"Mercado Livre", detalhe: isFull?"ML Full":"ML Clássico" };
  }
  if (l.includes("shopee")) return { geral:"Shopee", detalhe:"Shopee" };
  if (l.includes("shein")||l.includes("neli")) return { geral:"Shein", detalhe:"Shein" };
  if (l.includes("tiktok")||l.includes("tik tok")) return { geral:"TikTok", detalhe:"TikTok" };
  if (l.includes("magalu")||l.includes("magazine")) return { geral:"Magalu", detalhe:"Magalu" };
  if (l.includes("meluni")||l.includes("nuvemshop")||l.includes("nuvem")) return { geral:"Meluni", detalhe:"Meluni" };
  if (l.includes("amazon")) return { geral:"Amazon", detalhe:"Amazon" };
  if (l.includes("ideris")) return { geral:"Outros", detalhe:"Ideris" };
  return { geral: nome.trim(), detalhe: nome.trim() };
}

const CHUNK_SIZE = 80; // ~28s a 350ms/pedido (seguro pro timeout de 60s)

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Methods","POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type");
  if (req.method==="OPTIONS") return res.status(200).end();
  if (req.method!=="POST") return res.status(405).json({erro:"Use POST"});

  try {
    const { access_token, data, skip = 0, pedidoIds: passedIds, lojaNames: passedLojas } = req.body;
    if (!access_token||!data) return res.status(400).json({erro:"Faltam access_token ou data"});

    const headers = {"Authorization":"Bearer "+access_token,"Accept":"application/json"};
    let allPedidoIds = passedIds || null;
    let lojaNames = passedLojas || {};
    const canaisRaw = new Set();

    // ── Se é a primeira chamada (skip=0 e sem IDs), lista tudo ──────
    if (!allPedidoIds) {
      allPedidoIds = [];
      lojaNames = {};

      // Busca mapa de lojas
      try {
        const lojasResp = await fetch("https://api.bling.com.br/Api/v3/lojas?limite=100", { headers });
        if (lojasResp.ok) {
          const lojasData = await lojasResp.json();
          const lojaMap = {};
          for (const loja of (lojasData.data || [])) lojaMap[loja.id] = loja.descricao || loja.nome || "";
          // Busca lista de pedidos
          let pagina = 1;
          while (true) {
            const url = `https://api.bling.com.br/Api/v3/pedidos/vendas?situacaoId=9&dataInicial=${data}&dataFinal=${data}&dataInicio=${data}&dataFim=${data}&pagina=${pagina}&limite=100`;
            const resp = await fetch(url, { headers });
            if (!resp.ok) break;
            const d = await resp.json();
            if (!d.data||d.data.length===0) break;
            for (const p of d.data) {
              if (p.data && !p.data.startsWith(data)) continue;
              const lojaObj = p.loja || {};
              let nome = lojaObj.descricao || lojaObj.nome || "";
              if (!nome && lojaObj.id && lojaMap[lojaObj.id]) nome = lojaMap[lojaObj.id];
              allPedidoIds.push(p.id);
              lojaNames[p.id] = nome;
              canaisRaw.add(nome || `id:${lojaObj.id||"?"}`);
            }
            if (d.data.length < 100) break;
            pagina++;
          }
        }
      } catch(e) { /* */ }

      if (allPedidoIds.length === 0) return res.json({ok:true,data,totalPedidos:0,canais:{},temMais:false});
    }

    // ── Processa chunk de pedidos ────────────────────────────────────
    const chunk = allPedidoIds.slice(skip, skip + CHUNK_SIZE);
    const temMais = (skip + CHUNK_SIZE) < allPedidoIds.length;
    const porCanal = {};
    const debug = [];

    for (const pid of chunk) {
      await new Promise(r=>setTimeout(r,350));
      try {
        const dr = await fetch(`https://api.bling.com.br/Api/v3/pedidos/vendas/${pid}`, { headers });
        if (!dr.ok) continue;
        const det = await dr.json();
        const ped = det.data||det;
        if (ped.data && !ped.data.startsWith(data)) continue;

        const canal = parseCanal(lojaNames[pid] || "");
        const ck = canal.geral;

        if (!porCanal[ck]) porCanal[ck]={pedidos:0,bruto:0,frete:0,itens:0,subcanais:{},produtos:{}};
        const cc = porCanal[ck];
        cc.pedidos++;
        cc.bruto += parseFloat(ped.totalProdutos||0);
        cc.frete += Math.max(0, parseFloat(ped.total||0) - parseFloat(ped.totalProdutos||0));
        if (!cc.subcanais[canal.detalhe]) cc.subcanais[canal.detalhe]={pedidos:0,bruto:0};
        cc.subcanais[canal.detalhe].pedidos++;
        cc.subcanais[canal.detalhe].bruto += parseFloat(ped.totalProdutos||0);

        for (const item of (ped.itens||[])) {
          const p = parseDescricao(item.descricao);
          if (debug.length<5) debug.push({desc:item.descricao,codigo:item.codigo,parsed:p});
          const ref = p.ref||"SEM-REF";
          const qtd = parseInt(item.quantidade)||1;
          const valor = parseFloat(item.valor)||0;
          cc.itens += qtd;
          if (ref==="SEM-REF") continue;
          if (!cc.produtos[ref]) cc.produtos[ref]={ref,desc:p.descLimpa,qtd:0,valor:0,tam:{},cor:{}};
          const prod = cc.produtos[ref];
          prod.qtd += qtd;
          prod.valor += valor*qtd;
          if (p.tamanho) prod.tam[p.tamanho]=(prod.tam[p.tamanho]||0)+qtd;
          if (p.cor) prod.cor[p.cor]=(prod.cor[p.cor]||0)+qtd;
        }
      } catch(e){/* skip */}
    }

    for (const ck in porCanal) porCanal[ck].produtos = Object.values(porCanal[ck].produtos).sort((a,b)=>b.qtd-a.qtd);

    return res.json({
      ok: true, data,
      totalPedidos: allPedidoIds.length,
      processados: Math.min(skip + CHUNK_SIZE, allPedidoIds.length),
      canais: porCanal,
      temMais,
      nextSkip: temMais ? skip + CHUNK_SIZE : null,
      // Passa IDs e lojas pro cliente reenviar na próxima chamada
      pedidoIds: temMais ? allPedidoIds : undefined,
      lojaNames: temMais ? lojaNames : undefined,
      _debug: skip === 0 ? debug : undefined,
      _canaisRaw: skip === 0 ? [...canaisRaw] : undefined
    });
  } catch(e) { return res.status(500).json({erro:"Erro: "+e.message}); }
}
