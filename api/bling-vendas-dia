// /api/bling-vendas-dia.js
// Busca pedidos de UM dia para UMA conta, com itens detalhados
// Parser extrai REF, cor, tamanho da DESCRIÇÃO (SKU codes são hashes aleatórios)

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

function parseCanal(loja) {
  const nome = (loja?.descricao || loja?.nome || "Desconhecido").trim();
  const l = nome.toLowerCase();
  if (l.includes("mercado livre")||l.includes("mercadolivre")) return { geral:"Mercado Livre", detalhe: l.includes("full")||l.includes("fulfillment")?"ML Full":"ML Clássico" };
  if (l.includes("shopee")) return { geral:"Shopee", detalhe:"Shopee" };
  if (l.includes("shein")||l.includes("neli")) return { geral:"Shein", detalhe:"Shein" };
  if (l.includes("tiktok")||l.includes("tik tok")) return { geral:"TikTok", detalhe:"TikTok" };
  if (l.includes("magalu")||l.includes("magazine")) return { geral:"Magalu", detalhe:"Magalu" };
  if (l.includes("meluni")||l.includes("nuvemshop")||l.includes("nuvem")) return { geral:"Meluni", detalhe:"Meluni" };
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
      const url=`https://api.bling.com.br/Api/v3/pedidos/vendas?situacaoId=9&dataInicio=${data}&dataFim=${data}&pagina=${pagina}&limite=100`;
      const resp=await fetch(url,{headers:{"Authorization":"Bearer "+access_token,"Accept":"application/json"}});
      if (!resp.ok) break;
      const d=await resp.json();
      if (!d.data||d.data.length===0) break;
      pedidoIds.push(...d.data.map(p=>p.id));
      if (d.data.length<100) break;
      pagina++;
    }
    if (pedidoIds.length===0) return res.json({ok:true,data,totalPedidos:0,canais:{}});

    // 2. Detalhe de cada pedido
    const porCanal={};
    const debug=[];

    for (const pid of pedidoIds) {
      await new Promise(r=>setTimeout(r,350));
      try {
        const dr=await fetch(`https://api.bling.com.br/Api/v3/pedidos/vendas/${pid}`,{headers:{"Authorization":"Bearer "+access_token,"Accept":"application/json"}});
        if (!dr.ok) continue;
        const det=await dr.json();
        const ped=det.data||det;
        const canal=parseCanal(ped.loja);
        const ck=canal.geral;

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
    return res.json({ok:true,data,totalPedidos:pedidoIds.length,canais:porCanal,_debug:debug});
  } catch(e) { return res.status(500).json({erro:"Erro: "+e.message}); }
}
