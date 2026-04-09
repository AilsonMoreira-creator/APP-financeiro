// /api/bling-vendas-dia.js v3
// DIAGNÓSTICO: loga estrutura do primeiro pedido pra encontrar campo do canal

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

function parseCanal(ped) {
  // Tenta múltiplos campos onde o canal pode estar
  const loja = ped.loja || {};
  const canal = ped.canal || {};
  
  // Tenta: loja.descricao, loja.nome, canal.descricao, canal.nome, 
  // ped.tipoVenda, ped.numeroPedidoLoja, ped.observacoes
  const nome = (
    loja.descricao || loja.nome || 
    canal.descricao || canal.nome ||
    (typeof ped.loja === "string" ? ped.loja : "") ||
    (typeof ped.canal === "string" ? ped.canal : "") ||
    ""
  ).trim();
  
  if (!nome) return { geral: "Desconhecido", detalhe: "Desconhecido" };
  
  const l = nome.toLowerCase();
  if (l.includes("mercado livre")||l.includes("mercadolivre")||l.includes("meli")) {
    const isFull = l.includes("full")||l.includes("fulfillment")||l.includes("flex");
    return { geral:"Mercado Livre", detalhe: isFull?"ML Full":"ML Clássico" };
  }
  if (l.includes("shopee")) return { geral:"Shopee", detalhe:"Shopee" };
  if (l.includes("shein")||l.includes("neli")) return { geral:"Shein", detalhe:"Shein" };
  if (l.includes("tiktok")||l.includes("tik tok")||l.includes("tik-tok")) return { geral:"TikTok", detalhe:"TikTok" };
  if (l.includes("magalu")||l.includes("magazine luiza")||l.includes("magazineluiza")) return { geral:"Magalu", detalhe:"Magalu" };
  if (l.includes("meluni")||l.includes("nuvemshop")||l.includes("nuvem")||l.includes("loja virtual")) return { geral:"Meluni", detalhe:"Meluni" };
  if (l.includes("amazon")) return { geral:"Amazon", detalhe:"Amazon" };
  return { geral:nome, detalhe:nome };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Methods","POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type");
  if (req.method==="OPTIONS") return res.status(200).end();
  if (req.method!=="POST") return res.status(405).json({erro:"Use POST"});

  try {
    const { access_token, data } = req.body;
    if (!access_token||!data) return res.status(400).json({erro:"Faltam access_token ou data"});

    // 1. Lista pedidos do dia
    let pedidoIds=[], pagina=1;
    while (true) {
      const url=`https://api.bling.com.br/Api/v3/pedidos/vendas?situacaoId=9&dataInicial=${data}&dataFinal=${data}&dataInicio=${data}&dataFim=${data}&pagina=${pagina}&limite=100`;
      const resp=await fetch(url,{headers:{"Authorization":"Bearer "+access_token,"Accept":"application/json"}});
      if (!resp.ok) break;
      const d=await resp.json();
      if (!d.data||d.data.length===0) break;
      d.data.forEach(p=>{if(!p.data||p.data.startsWith(data))pedidoIds.push(p.id);});
      if (d.data.length<100) break;
      pagina++;
    }
    if (pedidoIds.length===0) return res.json({ok:true,data,totalPedidos:0,canais:{}});

    // 2. Detalhe de cada pedido
    const porCanal={};
    const debug=[];
    const canaisRaw = new Set();
    let primeiroPedidoRaw = null; // DIAGNÓSTICO: estrutura completa do primeiro pedido

    for (const pid of pedidoIds) {
      await new Promise(r=>setTimeout(r,350));
      try {
        const dr=await fetch(`https://api.bling.com.br/Api/v3/pedidos/vendas/${pid}`,{headers:{"Authorization":"Bearer "+access_token,"Accept":"application/json"}});
        if (!dr.ok) continue;
        const det=await dr.json();
        const ped=det.data||det;
        
        // DIAGNÓSTICO: salva estrutura do primeiro pedido (sem itens pra não ficar enorme)
        if (!primeiroPedidoRaw) {
          primeiroPedidoRaw = {};
          // Copia todos os campos exceto itens
          for (const key of Object.keys(ped)) {
            if (key === "itens") primeiroPedidoRaw.itens = `[${(ped.itens||[]).length} itens]`;
            else primeiroPedidoRaw[key] = ped[key];
          }
        }
        
        if (ped.data && !ped.data.startsWith(data)) continue;
        
        const canal = parseCanal(ped);
        const ck = canal.geral;
        
        canaisRaw.add(JSON.stringify({loja:ped.loja, canal:ped.canal, numeroPedidoLoja:ped.numeroPedidoLoja}));

        if (!porCanal[ck]) porCanal[ck]={pedidos:0,bruto:0,frete:0,itens:0,subcanais:{},produtos:{}};
        const cc=porCanal[ck];
        cc.pedidos++;
        cc.bruto+=parseFloat(ped.totalProdutos||0);
        cc.frete+=Math.max(0,parseFloat(ped.total||0)-parseFloat(ped.totalProdutos||0));
        if (!cc.subcanais[canal.detalhe]) cc.subcanais[canal.detalhe]={pedidos:0,bruto:0};
        cc.subcanais[canal.detalhe].pedidos++;
        cc.subcanais[canal.detalhe].bruto+=parseFloat(ped.totalProdutos||0);

        for (const item of (ped.itens||[])) {
          const p=parseDescricao(item.descricao);
          if (debug.length<5) debug.push({desc:item.descricao,codigo:item.codigo,parsed:p});
          const ref=p.ref||"SEM-REF";
          const qtd=parseInt(item.quantidade)||1;
          const valor=parseFloat(item.valor)||0;
          cc.itens+=qtd;
          if (ref==="SEM-REF") continue;
          if (!cc.produtos[ref]) cc.produtos[ref]={ref,desc:p.descLimpa,qtd:0,valor:0,tam:{},cor:{}};
          const prod=cc.produtos[ref];
          prod.qtd+=qtd; prod.valor+=valor*qtd;
          if (p.tamanho) prod.tam[p.tamanho]=(prod.tam[p.tamanho]||0)+qtd;
          if (p.cor) prod.cor[p.cor]=(prod.cor[p.cor]||0)+qtd;
        }
      } catch(e){/* skip */}
    }

    for (const ck in porCanal) porCanal[ck].produtos=Object.values(porCanal[ck].produtos).sort((a,b)=>b.qtd-a.qtd);
    
    return res.json({
      ok:true, data, totalPedidos:pedidoIds.length, canais:porCanal,
      _debug:debug,
      _canaisRaw: [...canaisRaw],
      _primeiroPedido: primeiroPedidoRaw // estrutura completa do primeiro pedido
    });
  } catch(e) { return res.status(500).json({erro:"Erro: "+e.message}); }
}
