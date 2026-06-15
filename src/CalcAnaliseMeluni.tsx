import { useState, useEffect, useRef } from 'react';
import { supabase } from './supabase.js';

// helpers de custo/lucro espelhados do App.tsx (constantes de taxa estaveis)
const CALC_GERAIS={imposto:11,custoFixo:5};
const CALC_LMIN=10;const CALC_LBOM=14;
const CALC_PLATS={
  mercadolivre:{nome:"Mercado Livre",cor:"#FFE600",ct:"#2D3277",taxas:[{l:"Comissão",t:"pct",v:14},{l:"Ads",t:"pct",v:6},{l:"Descontos",t:"pct",v:2}],fretes:[{ate:78.99,f:6},{ate:9999,f:16}]},
  shopee:{nome:"Shopee",cor:"#EE4D2D",ct:"#fff",taxas:[{l:"Afiliados",t:"pct",v:3}],faixas:[{lb:"até R$79,99",ate:79.99,cp:20,cf:4},{lb:"R$80-99,99",ate:99.99,cp:14,cf:16},{lb:"R$100-139",ate:139,cp:14,cf:20}]},
  shein:{nome:"Shein",cor:"#000",ct:"#fff",taxas:[{l:"Comissão",t:"pct",v:20},{l:"Descontos",t:"pct",v:2},{l:"Frete",t:"fix",v:6}]},
  tiktok:{nome:"TikTok Shop",cor:"#010101",ct:"#fff",taxas:[{l:"Comissão",t:"pct",v:14},{l:"Afiliados",t:"pct",v:7},{l:"Frete",t:"fix",v:4}]},
  meluni:{nome:"Meluni",cor:"#fff",ct:"#000",bd:"#000",taxas:[{l:"Cartão/Antifraude",t:"pct",v:8},{l:"Converter",t:"pct",v:2},{l:"Cupons",t:"pct",v:7},{l:"Frete",t:"fix",v:15},{l:"Plataforma",t:"fix",v:5}]},
};
const CALC_ORDEM=["mercadolivre","shopee","shein","tiktok","meluni"];
const CALC_CK=[["tecido","Tecido"],["forro","Forro"],["oficina","Oficina Costura"],["passadoria","Passadoria"],["ziper","Zíper"],["botao","Botão/Caseado"],["aviamentos","Aviamentos"],["modelista","Modelista/Piloteiro"],["salaCorte","Sala de Corte"]];
const calcCusto=p=>CALC_CK.reduce((s,[k])=>s+parseFloat(p[k]||0),0);
const calcTermo=l=>{if(l==null||isNaN(l))return"#e0d8d0";if(l<8)return"#c0392b";if(l<10)return"#e67e22";if(l<14)return"#27ae60";return"#1a7a40";};
const calcFmt=v=>isNaN(v)||v==null?"—":Number(v).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
const calcPreco=(id,c,la,opts={})=>{
  const r=CALC_PLATS[id];
  if(id==="shopee"){for(const f of r.faixas){const af=r.taxas[0].v;const tp=(f.cp+af+CALC_GERAIS.imposto)/100;const dn=1-tp;if(dn<=0)continue;const p=(la+c+f.cf+CALC_GERAIS.custoFixo)/dn;const mn=r.faixas.indexOf(f)===0?0:r.faixas[r.faixas.indexOf(f)-1].ate;if(p>mn-0.01&&p<=f.ate+0.5){return{p:Math.round(p*100)/100,l:Math.round((p-p*tp-f.cf-CALC_GERAIS.custoFixo-c)*100)/100,fx:f.lb};}}const f=r.faixas[2];const af=r.taxas[0].v;const tp=(f.cp+af+CALC_GERAIS.imposto)/100;const p=(la+c+f.cf+CALC_GERAIS.custoFixo)/(1-tp);return{p:Math.round(p*100)/100,l:Math.round((p-p*tp-f.cf-CALC_GERAIS.custoFixo-c)*100)/100,fx:f.lb};}
  if(id==="mercadolivre"){const pp=r.taxas.reduce((s,t)=>t.t==="pct"?s+t.v:s,0);const tp=(pp+CALC_GERAIS.imposto)/100;for(const ff of r.fretes){const p=(la+c+ff.f+CALC_GERAIS.custoFixo)/(1-tp);if(p<=ff.ate+0.5)return{p:Math.round(p*100)/100,l:Math.round((p-p*tp-ff.f-CALC_GERAIS.custoFixo-c)*100)/100,fr:ff.f};}const ff=r.fretes[1];const p=(la+c+ff.f+CALC_GERAIS.custoFixo)/(1-r.taxas.reduce((s,t)=>t.t==="pct"?s+t.v:s,0)/100-CALC_GERAIS.imposto/100);return{p:Math.round(p*100)/100,l:Math.round((p*(1-(r.taxas.reduce((s,t)=>t.t==="pct"?s+t.v:s,0)+CALC_GERAIS.imposto)/100)-ff.f-CALC_GERAIS.custoFixo-c)*100)/100,fr:ff.f};}
  // Meluni v2: filtrar frete se opts.semFrete=true (frete grátis desativado p/ vendedor)
  const taxasUsadas=(id==="meluni"&&opts.semFrete)?r.taxas.filter(t=>!(t.l==="Frete"&&t.t==="fix")):r.taxas;
  const pp=taxasUsadas.reduce((s,t)=>t.t==="pct"?s+t.v:s,0);const fx=taxasUsadas.reduce((s,t)=>t.t==="fix"?s+t.v:s,0);const tp=(pp+CALC_GERAIS.imposto)/100;const p=(la+c+fx+CALC_GERAIS.custoFixo)/(1-tp);return{p:Math.round(p*100)/100,l:Math.round((p-p*tp-fx-CALC_GERAIS.custoFixo-c)*100)/100};
};
const calcLucroReal=(id,c,pr,opts={})=>{const p=parseFloat(pr);if(!p)return null;const r=CALC_PLATS[id];let tp=CALC_GERAIS.imposto/100,fx=CALC_GERAIS.custoFixo;if(id==="shopee"){const f=r.faixas.find(f=>p<=f.ate)||r.faixas[2];tp+=(f.cp+r.taxas[0].v)/100;fx+=f.cf;}else if(id==="mercadolivre"){tp+=r.taxas.reduce((s,t)=>t.t==="pct"?s+t.v:s,0)/100;const ff=r.fretes.find(f=>p<=f.ate)||r.fretes[1];fx+=ff.f;}else{const taxasUsadas=(id==="meluni"&&opts.semFrete)?r.taxas.filter(t=>!(t.l==="Frete"&&t.t==="fix")):r.taxas;tp+=taxasUsadas.reduce((s,t)=>t.t==="pct"?s+t.v:s,0)/100;fx+=taxasUsadas.reduce((s,t)=>t.t==="fix"?s+t.v:s,0);}return Math.round((p-p*tp-fx-c)*100)/100;};

export const CalcAnaliseMeluni=({prods,prs,roasMeluniGlobal,setRoasMeluniGlobal,freteSubsidiado,setFreteSubsidiado,state,setState,onVoltar,mobile})=>{
  // Helper de focus: seleciona tudo ao focar (fix do "zero não sai")
  const onFocusSel=(e)=>e.target.select();

  // === Histórico Meluni Meta Ads (Ailson 17/05/2026) ===
  // Agora lê/escreve em meluni_meta_ads_historico (tabela dedicada).
  // O array state.historicoMeluni no JSONB ficou deprecated — não é mais usado.
  // Motivo: outro chat de análise Meta Ads vai popular direto via SQL upsert,
  // sem precisar mexer no payload calc-meluni (que é multi-user sensível).
  const hojeIso=new Date().toISOString().slice(0,10);
  const [modalHist,setModalHist]=useState(null);
  const [historicoDb,setHistoricoDb]=useState([]);
  const [histLoading,setHistLoading]=useState(false);

  const carregarHistorico=async()=>{
    setHistLoading(true);
    try{
      const{data,error}=await supabase.from('meluni_meta_ads_historico').select('*').order('data',{ascending:true});
      if(error)console.warn('historico meluni erro:',error.message);
      else setHistoricoDb(data||[]);
    }catch(e){console.warn('historico meluni exception:',e?.message);}
    setHistLoading(false);
  };
  useEffect(()=>{carregarHistorico();},[]);

  const abrirModalNovo=()=>setModalHist({id:null,data:hojeIso,cpc:'',conv:''});
  const abrirModalEditar=(reg)=>setModalHist({id:reg.id,data:reg.data,cpc:String(reg.cpc||''),conv:String(reg.conv||'')});
  const fecharModal=()=>setModalHist(null);
  const salvarRegistro=async()=>{
    if(!modalHist)return;
    const cpc=parseFloat(modalHist.cpc);
    const conv=modalHist.conv?parseFloat(modalHist.conv):null;
    if(!modalHist.data||isNaN(cpc)||cpc<=0){
      alert('Preencha data e CPC (obrigatórios). Conv é opcional.');return;
    }
    const row={
      data:modalHist.data,cpc,
      conv:(conv!==null&&!isNaN(conv)&&conv>0)?conv:null,
      ticket:null, // ticket vem do campo global dadosReais.ticketReal, não por linha
      fonte:'manual',
    };
    try{
      const{error}=await supabase.from('meluni_meta_ads_historico').upsert(row,{onConflict:'data'});
      if(error){alert('Erro ao salvar: '+error.message);return;}
      await carregarHistorico();
      fecharModal();
    }catch(e){alert('Erro: '+(e?.message||''));}
  };
  const removerRegistro=async(id)=>{
    if(!window.confirm('Excluir esse registro?'))return;
    try{
      const{error}=await supabase.from('meluni_meta_ads_historico').delete().eq('id',id);
      if(error){alert('Erro: '+error.message);return;}
      await carregarHistorico();
    }catch(e){alert('Erro: '+(e?.message||''));}
  };

  // === Puxar dados reais automaticos — 30 dias (Ailson 06/06/2026) ===
  // Ticket medio POR PEDIDO = vendas Meluni (canal "Outros" no Bling, somando as 3
  // contas) dos ultimos 30 dias: bruto / pedidos. CPC e conversao = tabela
  // meluni_meta_ads_historico dos ultimos 30 dias, PONDERADO (soma gasto / soma
  // cliques; soma compras / soma cliques * 100). Os 3 campos continuam editaveis.
  // NAO mexe na "media de valor por peca" (ticketMedio) — e outro conceito.
  const [puxandoReais,setPuxandoReais]=useState(false);
  const [reaisMsg,setReaisMsg]=useState(null);
  const puxarDadosReais=async()=>{
    setPuxandoReais(true);setReaisMsg(null);
    const limite=new Date(Date.now()-30*86400000).toISOString().slice(0,10);
    let cpcCalc=null,convCalc=null,ticketCalc=null;const avisos=[];
    // 1) CPC + conversao da Meta (meluni_meta_ads_historico, ultimos 30d)
    try{
      const recs=(historicoDb||[]).filter(r=>r.data&&r.data>=limite);
      let g=0,cl=0,cp=0;const cpcs=[],convs=[];
      for(const r of recs){
        if(r.cliques>0){g+=Number(r.gasto)||0;cl+=r.cliques;cp+=Number(r.compras)||0;}
        if(r.cpc>0)cpcs.push(Number(r.cpc));
        if(r.conv!=null&&Number(r.conv)>0)convs.push(Number(r.conv));
      }
      if(cl>0){cpcCalc=g/cl;if(cp>0)convCalc=(cp/cl)*100;}
      if(cpcCalc==null&&cpcs.length)cpcCalc=cpcs.reduce((a,b)=>a+b,0)/cpcs.length; // fallback media simples
      if(convCalc==null&&convs.length)convCalc=convs.reduce((a,b)=>a+b,0)/convs.length;
      if(cpcCalc==null&&convCalc==null)avisos.push('sem dados Meta no período');
    }catch(e){avisos.push('erro Meta');}
    // 2) Ticket medio por pedido (vendas Bling canal Outros = Meluni, ultimos 30d)
    try{
      const resp=await fetch('/api/bling-vendas-cache',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({data_inicio:limite,data_fim:hojeIso})});
      const result=await resp.json();
      if(result&&result.ok&&result.vendas){
        const CONTAS=['exitus','lumia','muniam'];let bruto=0,pedidos=0;
        for(const mk in result.vendas){const mes=result.vendas[mk];if(!mes||mes._vazio)continue;
          for(const dk in mes){const dia=mes[dk];if(!dia||dia._vazio)continue;
            for(const conta of CONTAS){const canais=dia[conta];if(!canais)continue;
              const cd=canais['Outros'];if(cd){bruto+=Number(cd.bruto)||0;pedidos+=Number(cd.pedidos)||0;}}}}
        if(pedidos>0)ticketCalc=bruto/pedidos; else avisos.push('sem pedidos Meluni no período');
      }else avisos.push('Bling indisponível');
    }catch(e){avisos.push('erro Bling');}
    // 3) Aplica nos campos (continuam editaveis)
    const r2=v=>Math.round(v*100)/100;
    setState(p=>({...p,dadosReais:{...p.dadosReais,
      ...(cpcCalc!=null?{cpc:r2(cpcCalc)}:{}),
      ...(convCalc!=null?{conv:r2(convCalc)}:{}),
      ...(ticketCalc!=null?{ticketReal:r2(ticketCalc)}:{}),
    }}));
    const fmtR=v=>v==null?'—':'R$ '+v.toFixed(2).replace('.',',');
    setReaisMsg(`Atualizado (30 dias): CPC ${fmtR(cpcCalc)} · conv ${convCalc!=null?convCalc.toFixed(2)+'%':'—'} · ticket ${fmtR(ticketCalc)}${avisos.length?' — '+avisos.join('; '):''}`);
    setPuxandoReais(false);
  };

  // Histórico ordenado ASC por data (gráfico mostra evolução temporal)
  const historicoOrdenado=historicoDb;
  // Mais recente primeiro pra tabela
  const historicoTabela=historicoOrdenado.slice().reverse();
  // Opts pra cálculos respeitando frete subsidiado
  const optsMeluni=freteSubsidiado?{}:{semFrete:true};
  // Helpers de cálculo
  const meluniProds=prods.filter(p=>p.marca==='Meluni');
  const margensTodas=meluniProds.map(p=>{
    const c=calcCusto(p);
    const ps=prs[`${p.ref}|meluni`];
    if(ps){const lr=calcLucroReal('meluni',c,ps,optsMeluni);return lr;}
    const r=calcPreco('meluni',c,CALC_LBOM,optsMeluni);return r?.l;
  }).filter(v=>typeof v==='number'&&!isNaN(v));
  const precos=meluniProds.map(p=>{
    const ps=prs[`${p.ref}|meluni`];
    if(ps)return parseFloat(ps);
    const r=calcPreco('meluni',calcCusto(p),CALC_LBOM,optsMeluni);return r?.p;
  }).filter(v=>typeof v==='number'&&!isNaN(v));
  // Margem média = top 20 maiores margens (proxy p/ "produtos mais vendidos" enquanto não há dados de venda)
  const margensTop=margensTodas.slice().sort((a,b)=>b-a).slice(0,20);
  const margemMedia=margensTop.length?margensTop.reduce((a,b)=>a+b,0)/margensTop.length:0;
  const ticketMedio=precos.length?precos.reduce((a,b)=>a+b,0)/precos.length:0;

  // Ticket pedido editável; peças auto-derivada (= ticket_pedido / ticket_medio_produto)
  const ticketPed=state.dadosReais.ticketReal||(ticketMedio*1.33); // default = ticket médio × 1,33 peças
  const pecasPed=ticketMedio>0?ticketPed/ticketMedio:1;
  const margemUnit=margemMedia+(state.aumentoMargem||0);

  // Cálculos do simulador
  const meta=parseFloat(state.metaVendas)||0;
  const pedidos=ticketPed>0?meta/ticketPed:0;
  const produtos=pedidos*pecasPed;
  const margemTotal=produtos*margemUnit;
  const roasBE=margemTotal>0?meta/margemTotal:0;

  // Cálculo do "conversão min p/ ROAS 5"
  const cpcRef=state.dadosReais.cpc||1.20;
  const visitasROAS5=(meta/5)/cpcRef;
  const convMin=visitasROAS5>0?(pedidos/visitasROAS5)*100:0;

  // Helpers de formatação
  const fmt=v=>'R$ '+(isNaN(v)||v==null?'—':Math.round(v).toLocaleString('pt-BR'));
  const fmtDec=v=>'R$ '+(isNaN(v)||v==null?'—':v.toFixed(2).replace('.',','));
  const fmtN=v=>isNaN(v)||v==null?'—':Math.round(v).toLocaleString('pt-BR');

  // Helpers do histórico
  const formatarDataBR=(iso)=>{if(!iso||!iso.includes('-'))return iso||'—';const [y,m,d]=iso.split('-');return `${d}/${m}/${y}`;};
  const getTendencia=(serie,subirEhBom=true)=>{
    if(serie.length<2)return{dir:'—',cor:'#8a9aa4',pct:0};
    const u=serie[serie.length-1],pn=serie[serie.length-2];
    if(pn===0)return{dir:'—',cor:'#8a9aa4',pct:0};
    const pct=((u-pn)/pn)*100;
    if(Math.abs(pct)<0.5)return{dir:'→',cor:'#8a9aa4',pct:0};
    const subiu=pct>0;
    return{dir:subiu?'↑':'↓',cor:(subiu===subirEhBom)?'#1a7a40':'#9a2828',pct:Math.abs(pct)};
  };
  const renderMiniChart=(serie,color)=>{
    if(serie.length<2)return<div style={{height:60,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,color:"#a89f94",fontStyle:"italic"}}>Mín. 2 registros</div>;
    const W=200,H=60,PAD=6;
    const min=Math.min(...serie),max=Math.max(...serie);
    const range=max-min||1;
    const pts=serie.map((v,i)=>{
      const x=PAD+(serie.length===1?W/2:(i/(serie.length-1))*(W-PAD*2));
      const y=H-PAD-((v-min)/range)*(H-PAD*2);
      return [x,y];
    });
    const path=pts.map((p,i)=>(i===0?'M':'L')+p[0].toFixed(1)+','+p[1].toFixed(1)).join(' ');
    return(
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{display:'block'}}>
        <path d={path} fill="none" stroke={color} strokeWidth="2"/>
        {pts.map(([x,y],i)=><circle key={i} cx={x} cy={y} r="2.5" fill={color}/>)}
      </svg>
    );
  };

  // Séries para gráficos (ordem cronológica)
  const serieCpc=historicoOrdenado.map(r=>r.cpc).filter(v=>v!=null);
  const serieConv=historicoOrdenado.map(r=>r.conv).filter(v=>v!=null);
  const tendCpc=getTendencia(serieCpc,false); // CPC subir = ruim
  const tendConv=getTendencia(serieConv,true); // Conv subir = bom

  // Lucro líquido médio dos cards (visualização do impacto do ROAS global)
  const lucroLiqMedio=margemMedia-(ticketMedio>0&&roasMeluniGlobal>0?ticketMedio/roasMeluniGlobal:0);

  return(
    <div style={{background:"#f7f4f0",minHeight:"100%",padding:mobile?12:20,fontFamily:"Georgia,serif"}}>
      <div style={{maxWidth:1100,margin:"0 auto"}}>
        {/* Header */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:18,flexWrap:"wrap",gap:10}}>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <button onClick={onVoltar} style={{background:"#fff",border:"1px solid #e8e2da",borderRadius:8,padding:"7px 14px",cursor:"pointer",fontSize:13,color:"#4a7fa5",fontFamily:"Georgia,serif"}}>← Voltar</button>
            <div>
              <div style={{fontSize:10,color:"#a89f94",letterSpacing:2,textTransform:"uppercase"}}>Calculadora · Meluni</div>
              <div style={{fontSize:mobile?18:22,fontWeight:700,color:"#2c3e50"}}>🎯 Análise de Cenários</div>
            </div>
          </div>
          <div style={{fontSize:11,color:"#8a9aa4",fontStyle:"italic"}}>{meluniProds.length} produto(s) Meluni cadastrado(s)</div>
        </div>

        {/* Bloco DADOS REAIS DO PERÍODO — Ailson 10/05/2026: só header escuro */}
        <div style={{background:"#fff",borderRadius:8,marginBottom:20,border:"1px solid #e8e2da",overflow:"hidden"}}>
          <div style={{background:"#2c3e50",color:"#f7f4f0",padding:"12px 16px"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap"}}>
              <div style={{fontSize:14,fontWeight:700,display:"flex",alignItems:"center",gap:8}}>📥 Dados reais do período (últimos 30 dias)</div>
              <button onClick={puxarDadosReais} disabled={puxandoReais} style={{background:puxandoReais?"#5a6b7a":"#4a7fa5",color:"#fff",border:"none",borderRadius:6,padding:"7px 14px",fontSize:13,fontWeight:700,cursor:puxandoReais?"wait":"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>{puxandoReais?"Puxando…":"↻ Puxar dados reais (30 dias)"}</button>
            </div>
            <div style={{fontSize:11,opacity:0.75,marginTop:3,fontStyle:"italic"}}>Ticket do Bling (canal Meluni) · CPC e conversão do Meta Ads. Pode editar depois.</div>
            {reaisMsg&&<div style={{fontSize:11,marginTop:6,background:"rgba(255,255,255,0.12)",borderRadius:4,padding:"5px 8px"}}>{reaisMsg}</div>}
          </div>
          <div style={{padding:"16px 18px"}}>
            <div style={{display:"grid",gridTemplateColumns:mobile?"1fr":"1fr 1fr 1fr",gap:14}}>
              <div>
                <div style={{fontSize:10,textTransform:"uppercase",letterSpacing:0.5,color:"#8a9aa4",marginBottom:4,fontWeight:600}}>CPC médio (R$)</div>
                <input type="number" value={state.dadosReais.cpc} step={0.10} min={0.10} onFocus={onFocusSel} onChange={e=>setState(p=>({...p,dadosReais:{...p.dadosReais,cpc:parseFloat(e.target.value)||0}}))} style={{width:"100%",padding:"8px 10px",fontFamily:"Calibri,'Segoe UI',Arial,sans-serif",fontSize:15,border:"1px solid #c8d8e4",borderRadius:4,background:"#fff",color:"#2c3e50",fontWeight:700,outline:"none",boxSizing:"border-box"}}/>
                <div style={{fontSize:10,color:"#8a9aa4",marginTop:3,fontStyle:"italic"}}>Meta Ads → "CPC (link)"</div>
              </div>
              <div>
                <div style={{fontSize:10,textTransform:"uppercase",letterSpacing:0.5,color:"#8a9aa4",marginBottom:4,fontWeight:600}}>Conversão site (%)</div>
                <input type="number" value={state.dadosReais.conv} step={0.1} min={0.1} max={10} onFocus={onFocusSel} onChange={e=>setState(p=>({...p,dadosReais:{...p.dadosReais,conv:parseFloat(e.target.value)||0}}))} style={{width:"100%",padding:"8px 10px",fontFamily:"Calibri,'Segoe UI',Arial,sans-serif",fontSize:15,border:"1px solid #c8d8e4",borderRadius:4,background:"#fff",color:"#2c3e50",fontWeight:700,outline:"none",boxSizing:"border-box"}}/>
                <div style={{fontSize:10,color:"#8a9aa4",marginTop:3,fontStyle:"italic"}}>GA4 ou: pedidos ÷ visitas × 100</div>
              </div>
              <div>
                <div style={{fontSize:10,textTransform:"uppercase",letterSpacing:0.5,color:"#8a9aa4",marginBottom:4,fontWeight:600}}>Período analisado</div>
                <select value={state.dadosReais.periodo} onChange={e=>setState(p=>({...p,dadosReais:{...p.dadosReais,periodo:parseInt(e.target.value)||30}}))} style={{width:"100%",padding:"8px 10px",fontFamily:"Calibri,'Segoe UI',Arial,sans-serif",fontSize:15,border:"1px solid #c8d8e4",borderRadius:4,background:"#fff",color:"#2c3e50",fontWeight:700,outline:"none",boxSizing:"border-box"}}>
                  <option value={7}>Últimos 7 dias</option>
                  <option value={30}>Últimos 30 dias</option>
                  <option value={60}>Últimos 60 dias</option>
                  <option value={90}>Últimos 90 dias</option>
                </select>
                <div style={{fontSize:10,color:"#8a9aa4",marginTop:3,fontStyle:"italic"}}>Apenas referência</div>
              </div>
            </div>
            <details style={{marginTop:14,paddingTop:12,borderTop:"1px solid #e8e2da"}} open>
              <summary style={{cursor:"pointer",fontSize:13,color:"#4a7fa5",fontWeight:600}}>▸ Ticket médio por pedido (peças auto-calculadas)</summary>
              <div style={{display:"grid",gridTemplateColumns:mobile?"1fr":"1fr 1fr",gap:12,marginTop:10}}>
                <div>
                  <div style={{fontSize:10,color:"#8a9aa4",marginBottom:4,fontWeight:600}}>Ticket médio por pedido (R$)</div>
                  <input type="number" value={state.dadosReais.ticketReal||''} placeholder={`usa default: ${fmt(ticketMedio*1.33)}`} min={0} onFocus={onFocusSel} onChange={e=>{const v=parseFloat(e.target.value);setState(p=>({...p,dadosReais:{...p.dadosReais,ticketReal:isNaN(v)||v<=0?null:v}}));}} style={{width:"100%",padding:"8px 10px",fontFamily:"Calibri,'Segoe UI',Arial,sans-serif",fontSize:14,border:"1px solid #c8d8e4",borderRadius:4,background:"#fff",color:"#2c3e50",fontWeight:700,outline:"none",boxSizing:"border-box"}}/>
                  <div style={{fontSize:10,color:"#8a9aa4",marginTop:3,fontStyle:"italic"}}>Vazio = ticket médio × 1,33 peças (default)</div>
                </div>
                <div>
                  <div style={{fontSize:10,color:"#8a9aa4",marginBottom:4,fontWeight:600}}>Peças por pedido (auto)</div>
                  <div style={{padding:"8px 10px",fontFamily:"Calibri,'Segoe UI',Arial,sans-serif",fontSize:14,border:"1px dashed #c8d8e4",borderRadius:4,background:"#f7f4f0",color:"#2c3e50",fontWeight:700,boxSizing:"border-box"}}>{pecasPed.toFixed(2)}</div>
                  <div style={{fontSize:10,color:"#8a9aa4",marginTop:3,fontStyle:"italic"}}>= ticket pedido ÷ ticket médio produto ({fmt(ticketMedio)})</div>
                </div>
              </div>
            </details>
          </div>
        </div>

        {/* RESUMO MELUNI — ROAS Global + Margens + Frete */}
        <div style={{background:"#fff",borderRadius:10,padding:16,border:"1px solid #e8e2da",marginBottom:20}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14,flexWrap:"wrap",gap:10}}>
            <div style={{fontSize:14,fontWeight:700,color:"#2c3e50"}}>💰 Resumo Meluni ({meluniProds.length} produto(s) Meluni · margem média das top {margensTop.length})</div>
            <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",background:freteSubsidiado?"#fff8e7":"#e8f5ec",padding:"6px 12px",borderRadius:6,border:freteSubsidiado?"1px solid #f0d9b5":"1px solid #b8dfc8"}}>
              <input type="checkbox" checked={freteSubsidiado} onChange={e=>setFreteSubsidiado(e.target.checked)} style={{cursor:"pointer",accentColor:freteSubsidiado?"#b87333":"#1a7a40"}}/>
              <span style={{fontSize:12,fontWeight:600,color:freteSubsidiado?"#6b3a13":"#1a7a40"}}>🚚 Frete subsidiado {freteSubsidiado?"(ATIVO, -R$15/produto)":"(DESATIVADO, cliente paga)"}</span>
            </label>
          </div>
          <div style={{display:"grid",gridTemplateColumns:mobile?"1fr 1fr":"repeat(4,1fr)",gap:10}}>
            <div style={{background:"#f7f4f0",padding:12,borderRadius:6,border:"1px solid #e8e2da"}}>
              <div style={{fontSize:10,color:"#8a9aa4",textTransform:"uppercase",letterSpacing:0.5,marginBottom:4}}>Ticket médio produto</div>
              <div style={{fontFamily:"Calibri,'Segoe UI',Arial,sans-serif",fontSize:18,fontWeight:700,color:"#2c3e50"}}>{fmt(ticketMedio)}</div>
            </div>
            <div style={{background:"#fff8e7",padding:12,borderRadius:6,border:"1px solid #f0d9b5",borderLeft:"3px solid #b87333"}}>
              <div style={{fontSize:10,color:"#6b3a13",textTransform:"uppercase",letterSpacing:0.5,marginBottom:4}}>Margem média (top {margensTop.length})</div>
              <div style={{fontFamily:"Calibri,'Segoe UI',Arial,sans-serif",fontSize:18,fontWeight:700,color:"#6b3a13"}}>{fmt(margemMedia)}</div>
            </div>
            <div style={{background:"#edf4fb",padding:12,borderRadius:6,border:"1px solid #c8dff0",display:"flex",flexDirection:"column",justifyContent:"space-between"}}>
              <div style={{fontSize:10,color:"#4a7fa5",textTransform:"uppercase",letterSpacing:0.5,marginBottom:4}}>🌐 ROAS Global Meluni</div>
              <input type="number" value={roasMeluniGlobal} step={0.1} min={1} max={20} onFocus={onFocusSel} onChange={e=>setRoasMeluniGlobal(e.target.value)} style={{width:"100%",border:"1px solid #4a7fa5",borderRadius:4,padding:"4px 8px",fontFamily:"Calibri,'Segoe UI',Arial,sans-serif",fontSize:16,fontWeight:700,color:"#4a7fa5",textAlign:"center",background:"#fff",outline:"none",boxSizing:"border-box"}}/>
              <div style={{fontSize:10,color:"#8a9aa4",marginTop:3,fontStyle:"italic",lineHeight:1.3}}>Reflete em todos cards · reseta manuais</div>
            </div>
            <div style={{background:lucroLiqMedio>=0?"#e8f5ec":"#fae8e8",padding:12,borderRadius:6,border:lucroLiqMedio>=0?"1px solid #b8dfc8":"1px solid #f0c8c8"}}>
              <div style={{fontSize:10,color:lucroLiqMedio>=0?"#1a7a40":"#9a2828",textTransform:"uppercase",letterSpacing:0.5,marginBottom:4}}>Lucro líq médio</div>
              <div style={{fontFamily:"Calibri,'Segoe UI',Arial,sans-serif",fontSize:18,fontWeight:700,color:lucroLiqMedio>=0?"#1a7a40":"#9a2828"}}>{(lucroLiqMedio>=0?'+':'')+fmt(lucroLiqMedio).replace('R$ ','R$ ')}</div>
            </div>
          </div>
        </div>

        {/* SIMULADOR DE 5 CENÁRIOS */}
        <div style={{background:"#fff",borderRadius:10,padding:16,border:"1px solid #e8e2da",marginBottom:20}}>
          <div style={{fontSize:15,fontWeight:700,color:"#2c3e50",marginBottom:14,paddingBottom:8,borderBottom:"1px solid #e8e2da"}}>📈 Simulador de 5 Cenários</div>
          <div style={{display:"grid",gridTemplateColumns:mobile?"1fr":"180px 220px 1fr",gap:14,marginBottom:16,padding:12,background:"#f7f4f0",borderRadius:6,border:"1px solid #e8e2da",alignItems:"start"}}>
            <div>
              <div style={{fontSize:10,color:"#8a9aa4",textTransform:"uppercase",letterSpacing:0.5,marginBottom:4}}>🎯 Meta de vendas (R$)</div>
              <input type="number" value={state.metaVendas} step={1000} min={1000} onFocus={onFocusSel} onChange={e=>setState(p=>({...p,metaVendas:parseFloat(e.target.value)||0}))} style={{width:"100%",padding:"7px 9px",fontFamily:"Calibri,'Segoe UI',Arial,sans-serif",fontSize:14,border:"1px solid #e8e2da",borderRadius:3,background:"#fff",color:"#2c3e50",fontWeight:700,outline:"none",boxSizing:"border-box"}}/>
            </div>
            <div>
              <div style={{fontSize:10,color:"#8a9aa4",textTransform:"uppercase",letterSpacing:0.5,marginBottom:4}}>🧪 Simular aumento margem (R$/produto)</div>
              <input type="number" value={state.aumentoMargem} step={1} min={0} onFocus={onFocusSel} onChange={e=>setState(p=>({...p,aumentoMargem:parseFloat(e.target.value)||0}))} style={{width:"100%",padding:"7px 9px",fontFamily:"Calibri,'Segoe UI',Arial,sans-serif",fontSize:14,border:"1px solid #e8e2da",borderRadius:3,background:"#fff",color:"#2c3e50",fontWeight:700,outline:"none",boxSizing:"border-box"}}/>
              <div style={{fontSize:10,color:"#4a7fa5",marginTop:3,fontStyle:"italic",lineHeight:1.3}}>"E se eu subir preço, reduzir CMV ou negociar frete?"</div>
            </div>
            <div style={{background:"#fff",padding:12,borderRadius:6,border:"1.5px solid #4a7fa5"}}>
              <div style={{fontSize:10,color:"#4a7fa5",textTransform:"uppercase",letterSpacing:0.5,marginBottom:6,fontWeight:700}}>📦 Resumo da meta</div>
              <div style={{fontSize:12,color:"#2c3e50",lineHeight:1.6}}>
                <div><span style={{color:"#8a9aa4"}}>Pedidos:</span> <strong style={{fontSize:14,color:"#4a7fa5"}}>{fmtN(pedidos)}</strong></div>
                <div><span style={{color:"#8a9aa4"}}>Produtos:</span> <strong style={{fontSize:14,color:"#4a7fa5"}}>{fmtN(produtos)}</strong></div>
                <div><span style={{color:"#8a9aa4"}}>Ticket médio pedido:</span> <strong style={{fontSize:14,color:"#4a7fa5"}}>{fmt(ticketPed)}</strong></div>
                <div><span style={{color:"#8a9aa4"}}>Margem unit:</span> <strong style={{fontSize:14,color:"#4a7fa5"}}>{fmt(margemUnit)}</strong></div>
              </div>
            </div>
          </div>

          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:13,minWidth:mobile?600:"auto"}}>
              <thead style={{background:"#2c3e50",color:"#fff"}}>
                <tr>
                  {[
                    {label:'Cenário',align:'left'},
                    {label:'Conv.',align:'center'},
                    {label:'CPC',align:'center'},
                    {label:'Visitas',align:'right'},
                    {label:'Gasto Ads',align:'right'},
                    {label:'ROAS',align:'right'},
                    {label:'Lucro líq.',align:'right'},
                    {label:'Status',align:'center'},
                  ].map(h=>(
                    <th key={h.label} style={{padding:"10px 8px",textAlign:h.align as any,fontWeight:400,fontSize:11,textTransform:"uppercase",letterSpacing:0.5}}>{h.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {state.cenarios.map((cen,idx)=>{
                  const conv=cen.conv/100;
                  const visitas=conv>0?pedidos/conv:0;
                  const adSpend=visitas*cen.cpc;
                  const roasResult=adSpend>0?meta/adSpend:0;
                  const lucro=margemTotal-adSpend;
                  let st,stCor,stBg;
                  if(lucro>margemTotal*0.3){st='Lucro forte';stCor='#1a7a40';stBg='#d4ecd9';}
                  else if(lucro>0){st='Lucro baixo';stCor='#8a6d0e';stBg='#fdf3cf';}
                  else if(lucro>-margemTotal*0.3){st='Atenção';stCor='#7a3e15';stBg='#fde2cc';}
                  else {st='Prejuízo';stCor='#9a2828';stBg='#fcd5d5';}
                  return(
                    <tr key={cen.id} style={{borderTop:"1px solid #e8e2da"}}>
                      <td style={{padding:"10px 8px",fontWeight:700,color:"#2c3e50",textAlign:"left"}}>{cen.nome}</td>
                      <td style={{padding:"10px 8px",textAlign:"center"}}>
                        <input type="number" value={cen.conv} step={0.1} min={0.1} max={10} onFocus={onFocusSel} onChange={e=>{const v=parseFloat(e.target.value)||0;setState(p=>({...p,cenarios:p.cenarios.map((c,i)=>i===idx?{...c,conv:v}:c)}));}} style={{width:60,border:"1px solid #ddd",background:"#fafafa",padding:"3px 5px",fontFamily:"Calibri,'Segoe UI',Arial,sans-serif",fontSize:12,textAlign:"right",borderRadius:2,outline:"none"}}/>
                      </td>
                      <td style={{padding:"10px 8px",textAlign:"center"}}>
                        <input type="number" value={cen.cpc} step={0.1} min={0.1} onFocus={onFocusSel} onChange={e=>{const v=parseFloat(e.target.value)||0;setState(p=>({...p,cenarios:p.cenarios.map((c,i)=>i===idx?{...c,cpc:v}:c)}));}} style={{width:60,border:"1px solid #ddd",background:"#fafafa",padding:"3px 5px",fontFamily:"Calibri,'Segoe UI',Arial,sans-serif",fontSize:12,textAlign:"right",borderRadius:2,outline:"none"}}/>
                      </td>
                      <td style={{padding:"10px 8px",fontFamily:"Calibri,'Segoe UI',Arial,sans-serif",textAlign:"right"}}>{fmtN(visitas)}</td>
                      <td style={{padding:"10px 8px",fontFamily:"Calibri,'Segoe UI',Arial,sans-serif",textAlign:"right"}}>{fmt(adSpend)}</td>
                      <td style={{padding:"10px 8px",fontFamily:"Calibri,'Segoe UI',Arial,sans-serif",textAlign:"right"}}>{roasResult.toFixed(2)}</td>
                      <td style={{padding:"10px 8px",fontFamily:"Calibri,'Segoe UI',Arial,sans-serif",textAlign:"right",fontWeight:700,color:lucro>=0?"#1a7a40":"#9a2828"}}>{lucro>=0?'+':''}{fmt(lucro)}</td>
                      <td style={{padding:"10px 8px",textAlign:"center"}}>
                        <span style={{display:"inline-block",padding:"3px 8px",borderRadius:10,fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:0.5,background:stBg,color:stCor}}>{st}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{display:"grid",gridTemplateColumns:mobile?"1fr 1fr":"repeat(4,1fr)",gap:10,marginTop:14,padding:12,background:"#2c3e50",color:"#f7f4f0",borderRadius:6}}>
            {[['Margem bruta/produto',fmt(margemUnit)],['Margem total disponível',fmt(margemTotal)],['ROAS break-even',roasBE.toFixed(2)],['Conv min p/ ROAS 5',convMin.toFixed(1)+'%']].map(([l,v])=>(
              <div key={l} style={{textAlign:"center"}}>
                <div style={{fontFamily:"Calibri,'Segoe UI',Arial,sans-serif",fontSize:18,fontWeight:700}}>{v}</div>
                <div style={{fontSize:10,opacity:0.8,textTransform:"uppercase",letterSpacing:0.5,marginTop:2}}>{l}</div>
              </div>
            ))}
          </div>

          <div style={{marginTop:12,padding:12,background:"#fff5e6",border:"1px solid #f0d9b5",borderRadius:4,fontSize:12,color:"#6b3a13"}}>
            <strong style={{color:"#c25a25"}}>Como ler:</strong> cada linha é uma combinação realista de conversão + CPC. Edite os valores cinza pra ajustar. <strong>Verde</strong> = lucro &gt; 30% margem. <strong>Amarelo</strong> = lucro positivo. <strong>Laranja "Atenção"</strong> = quase break-even. <strong>Vermelho</strong> = prejuízo.
          </div>
        </div>

        {/* HISTÓRICO + GRÁFICOS — substituiu Engenharia Reversa */}
        <div style={{background:"#fff",borderRadius:10,padding:16,border:"1px solid #e8e2da"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14,paddingBottom:8,borderBottom:"1px solid #e8e2da",flexWrap:"wrap",gap:10}}>
            <div style={{fontSize:15,fontWeight:700,color:"#2c3e50"}}>📈 Histórico — CPC · Conversão · Ticket</div>
            <div style={{display:"flex",gap:6}}>
              <button onClick={carregarHistorico} disabled={histLoading} style={{background:"#fff",color:"#4a7fa5",border:"1px solid #4a7fa5",borderRadius:6,padding:"8px 12px",fontSize:13,cursor:histLoading?"wait":"pointer",fontFamily:"Georgia,serif",opacity:histLoading?0.6:1}} title="Recarregar do banco">{histLoading?"⏳":"🔄"}</button>
              <button onClick={abrirModalNovo} style={{background:"#2c3e50",color:"#fff",border:"none",borderRadius:6,padding:"8px 14px",fontSize:13,cursor:"pointer",fontFamily:"Georgia,serif",fontWeight:600}}>+ Adicionar registro</button>
            </div>
          </div>

          {/* 3 mini-gráficos */}
          {historicoOrdenado.length>0?(
            <div style={{display:"grid",gridTemplateColumns:mobile?"1fr":"repeat(2,1fr)",gap:12,marginBottom:18}}>
              {[
                {label:'CPC médio',color:'#4a7fa5',serie:serieCpc,tend:tendCpc,fmtV:v=>fmtDec(v)},
                {label:'Conversão',color:'#1a7a40',serie:serieConv,tend:tendConv,fmtV:v=>v.toFixed(2)+'%'}
              ].map(k=>{
                const ultimoValor=k.serie.length>0?k.serie[k.serie.length-1]:0;
                return(
                  <div key={k.label} style={{background:"#f7f4f0",borderRadius:6,padding:12,border:"1px solid #e8e2da"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:6}}>
                      <div style={{fontSize:11,color:"#8a9aa4",textTransform:"uppercase",letterSpacing:0.5}}>{k.label}</div>
                      <div style={{fontSize:11,color:k.tend.cor,fontWeight:700}}>{k.tend.dir}{k.tend.pct>0?` ${k.tend.pct.toFixed(1)}%`:''}</div>
                    </div>
                    <div style={{fontFamily:"Calibri,'Segoe UI',Arial,sans-serif",fontSize:22,fontWeight:700,color:k.color,marginBottom:4}}>{k.fmtV(ultimoValor)}</div>
                    {renderMiniChart(k.serie,k.color)}
                  </div>
                );
              })}
            </div>
          ):(
            <div style={{padding:30,textAlign:"center",color:"#a89f94",fontSize:13,fontStyle:"italic",background:"#f7f4f0",borderRadius:6,marginBottom:14}}>
              Nenhum registro ainda. Clique em "+ Adicionar registro" pra começar.
            </div>
          )}

          {/* Tabela de registros */}
          {historicoTabela.length>0&&(
            <div style={{borderTop:"1px solid #e8e2da",paddingTop:14}}>
              <div style={{fontSize:12,fontWeight:700,color:"#2c3e50",marginBottom:10,textTransform:"uppercase",letterSpacing:0.5}}>📋 Registros ({historicoTabela.length})</div>
              {mobile?(
                <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  {historicoTabela.map(r=>(
                    <div key={r.id} style={{background:"#f7f4f0",borderRadius:6,padding:10,border:"1px solid #e8e2da",display:"flex",justifyContent:"space-between",alignItems:"center",gap:10}}>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:12,fontWeight:700,color:"#2c3e50",marginBottom:3}}>{formatarDataBR(r.data)}</div>
                        <div style={{display:"flex",gap:10,fontSize:11,color:"#6b7c8a",flexWrap:"wrap"}}>
                          <span>CPC: <strong style={{color:'#4a7fa5',fontFamily:"Calibri,'Segoe UI',Arial,sans-serif"}}>{fmtDec(r.cpc)}</strong></span>
                          <span>Conv: <strong style={{color:'#1a7a40',fontFamily:"Calibri,'Segoe UI',Arial,sans-serif"}}>{r.conv!=null?Number(r.conv).toFixed(2)+'%':'—'}</strong></span>
                        </div>
                      </div>
                      <div style={{display:"flex",gap:6,flexShrink:0}}>
                        <button onClick={()=>abrirModalEditar(r)} style={{background:"none",border:"1px solid #c8d8e4",borderRadius:4,padding:"4px 8px",cursor:"pointer",color:"#4a7fa5",fontSize:13}}>✏</button>
                        <button onClick={()=>removerRegistro(r.id)} style={{background:"none",border:"1px solid #f0c8c8",borderRadius:4,padding:"4px 8px",cursor:"pointer",color:"#c0392b",fontSize:15}}>×</button>
                      </div>
                    </div>
                  ))}
                </div>
              ):(
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
                  <thead style={{background:"#f7f4f0"}}>
                    <tr>
                      {['Data','CPC','Conversão','Ações'].map((h,i)=>(
                        <th key={h} style={{padding:"8px 12px",textAlign:i===3?'center':'left',fontSize:10,fontWeight:600,color:"#8a9aa4",textTransform:"uppercase",letterSpacing:0.5,borderBottom:"1px solid #e8e2da"}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {historicoTabela.map(r=>(
                      <tr key={r.id} style={{borderBottom:"1px solid #f0ebe4"}}>
                        <td style={{padding:"8px 12px",color:"#2c3e50",fontWeight:600}}>{formatarDataBR(r.data)}</td>
                        <td style={{padding:"8px 12px",fontFamily:"Calibri,'Segoe UI',Arial,sans-serif",color:'#4a7fa5',fontWeight:700}}>{fmtDec(r.cpc)}</td>
                        <td style={{padding:"8px 12px",fontFamily:"Calibri,'Segoe UI',Arial,sans-serif",color:'#1a7a40',fontWeight:700}}>{r.conv!=null?Number(r.conv).toFixed(2)+'%':<span style={{color:'#c0b8b0'}}>—</span>}</td>
                        <td style={{padding:"8px 12px",textAlign:"center"}}>
                          <button onClick={()=>abrirModalEditar(r)} style={{background:"none",border:"none",cursor:"pointer",color:"#4a7fa5",fontSize:15,marginRight:10}}>✏</button>
                          <button onClick={()=>removerRegistro(r.id)} style={{background:"none",border:"none",cursor:"pointer",color:"#c0392b",fontSize:17}}>×</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* Placeholder Insights IA */}
          <div style={{marginTop:18,padding:14,background:"#f0ece6",borderRadius:6,border:"1px dashed #c8c0b4"}}>
            <div style={{fontSize:13,fontWeight:700,color:"#2c3e50",marginBottom:4}}>🤖 Insights inteligentes (em breve)</div>
            <div style={{fontSize:12,color:"#8a9aa4",fontStyle:"italic",lineHeight:1.5}}>
              Quando vc tiver pelo menos 4 registros, vou analisar tendências, identificar saturação de audiência, sugerir investimento ideal e comparar com benchmark do setor.
            </div>
          </div>
        </div>

        {/* MODAL de cadastro/edição de registro */}
        {modalHist&&(
          <div onClick={fecharModal} style={{position:"fixed",inset:0,background:"rgba(44,62,80,0.55)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16}}>
            <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:10,padding:20,maxWidth:420,width:"100%",boxShadow:"0 10px 40px rgba(0,0,0,0.3)",fontFamily:"Georgia,serif"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14,paddingBottom:10,borderBottom:"1px solid #e8e2da"}}>
                <div style={{fontSize:16,fontWeight:700,color:"#2c3e50"}}>{modalHist.id?'✏ Editar registro':'+ Novo registro'}</div>
                <button onClick={fecharModal} style={{background:"none",border:"none",cursor:"pointer",fontSize:22,color:"#8a9aa4",lineHeight:1}}>✕</button>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:12}}>
                <div>
                  <div style={{fontSize:11,color:"#8a9aa4",textTransform:"uppercase",letterSpacing:0.5,marginBottom:4}}>📅 Data</div>
                  <input type="date" value={modalHist.data} onChange={e=>setModalHist(p=>({...p,data:e.target.value}))} style={{width:"100%",padding:"8px 10px",fontFamily:"Calibri,'Segoe UI',Arial,sans-serif",fontSize:15,border:"1px solid #c8d8e4",borderRadius:4,outline:"none",fontWeight:700,color:"#2c3e50"}}/>
                </div>
                <div>
                  <div style={{fontSize:11,color:"#8a9aa4",textTransform:"uppercase",letterSpacing:0.5,marginBottom:4}}>CPC médio (R$)</div>
                  <input type="number" step={0.01} min={0.01} value={modalHist.cpc} placeholder="ex: 1,20" onFocus={onFocusSel} onChange={e=>setModalHist(p=>({...p,cpc:e.target.value}))} style={{width:"100%",padding:"8px 10px",fontFamily:"Calibri,'Segoe UI',Arial,sans-serif",fontSize:15,border:"1px solid #c8d8e4",borderRadius:4,outline:"none",fontWeight:700,color:'#2c3e50',boxSizing:"border-box"}}/>
                </div>
                <div>
                  <div style={{fontSize:11,color:"#8a9aa4",textTransform:"uppercase",letterSpacing:0.5,marginBottom:4}}>Conversão (%)</div>
                  <input type="number" step={0.1} min={0.1} max={20} value={modalHist.conv} placeholder="ex: 1,0" onFocus={onFocusSel} onChange={e=>setModalHist(p=>({...p,conv:e.target.value}))} style={{width:"100%",padding:"8px 10px",fontFamily:"Calibri,'Segoe UI',Arial,sans-serif",fontSize:15,border:"1px solid #c8d8e4",borderRadius:4,outline:"none",fontWeight:700,color:'#2c3e50',boxSizing:"border-box"}}/>
                </div>
              </div>
              <div style={{marginTop:10,padding:"8px 12px",background:"#f7f4f0",borderRadius:4,fontSize:11,color:"#8a9aa4"}}>
                ℹ️ Ticket médio vem do campo "Dados reais" da análise (atualmente {state.dadosReais.ticketReal?`R$ ${state.dadosReais.ticketReal}`:"sem valor — usa default"}). Não é por dia.
              </div>
              <div style={{display:"flex",gap:8,marginTop:18}}>
                <button onClick={fecharModal} style={{flex:1,background:"#fff",border:"1px solid #c8d8e4",borderRadius:6,padding:"10px 14px",cursor:"pointer",fontFamily:"Georgia,serif",fontSize:14,color:"#8a9aa4"}}>Cancelar</button>
                <button onClick={salvarRegistro} style={{flex:2,background:"#2c3e50",color:"#fff",border:"none",borderRadius:6,padding:"10px 14px",cursor:"pointer",fontFamily:"Georgia,serif",fontWeight:600,fontSize:14}}>💾 Salvar</button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};

// ── wrapper Meluni: carrega prods/prs + estado da analise do amicia_data
//    user_id 'calc-meluni' e persiste com MERGE (nao atropela produtos/regras).
//    Mesma fonte da calculadora -> as duas telas ficam sincronizadas.
export default function MeluniAnalise({ onVoltar, mobile }) {
  const [prods, setProds] = useState([]);
  const [prs, setPrs] = useState({});
  const [roasMeluniGlobal, setRoasGlobalState] = useState(10);
  const [freteSub, setFreteSubState] = useState(true);
  const [analiseState, setAnaliseStateRaw] = useState({
    metaVendas:100000, aumentoMargem:0, pecasPorPedido:1.33,
    cenarios:[
      {id:'pessimista',nome:'\u{1F534} Pessimista',conv:0.5,cpc:1.80},
      {id:'conservador',nome:'\u{1F7E0} Conservador',conv:0.8,cpc:1.50},
      {id:'realista',nome:'\u{1F7E1} Realista',conv:1.0,cpc:1.20},
      {id:'otimista',nome:'\u{1F7E2} Otimista',conv:1.2,cpc:1.00},
      {id:'best',nome:'\u{1F31F} Best case',conv:1.3,cpc:0.80}
    ],
    dadosReais:{cpc:1.20,conv:1.0,periodo:30,ticketReal:null,pecasReal:null},
    historicoMeluni:[]
  });
  const prodsRef = useRef([]); const prsRef = useRef({});
  const roasRef = useRef(10); const analiseRef = useRef(null);
  const freteRef = useRef(true); const manualRef = useRef({});

  useEffect(() => {
    if (!supabase) return;
    supabase.from('amicia_data').select('payload').eq('user_id','calc-meluni').single()
      .then(({data}) => {
        const p = data && data.payload; if (!p) return;
        if (p.prods) { setProds(p.prods); prodsRef.current = p.prods; }
        if (p.prs) { setPrs(p.prs); prsRef.current = p.prs; }
        if (typeof p.roasMeluniGlobal === 'number') { setRoasGlobalState(p.roasMeluniGlobal); roasRef.current = p.roasMeluniGlobal; }
        if (p.roasMeluniManual && typeof p.roasMeluniManual === 'object') { manualRef.current = p.roasMeluniManual; }
        if (p.analiseMeluniState && typeof p.analiseMeluniState === 'object') { setAnaliseStateRaw(prev => ({...prev, ...p.analiseMeluniState})); analiseRef.current = {...p.analiseMeluniState}; }
        if (typeof p.meluniFreteSubsidiado === 'boolean') { setFreteSubState(p.meluniFreteSubsidiado); freteRef.current = p.meluniFreteSubsidiado; }
      }).catch(() => {});
  }, []);

  const salvar = async () => {
    if (!supabase) return;
    try {
      const {data} = await supabase.from('amicia_data').select('payload').eq('user_id','calc-meluni').single();
      const remoto = (data && data.payload) || {};
      const novoPayload = {
        ...remoto,
        roasMeluniGlobal: roasRef.current,
        roasMeluniManual: manualRef.current,
        analiseMeluniState: analiseRef.current || analiseState,
        meluniFreteSubsidiado: freteRef.current,
      };
      await supabase.from('amicia_data').upsert({user_id:'calc-meluni', payload:novoPayload}, {onConflict:'user_id'});
    } catch (e) { /* silencioso */ }
  };

  const setRoasMeluniGlobal = (novo) => { const v = parseFloat(novo) || 1; roasRef.current = v; manualRef.current = {}; setRoasGlobalState(v); salvar(); };
  const setFreteSubsidiado = (v) => { freteRef.current = !!v; setFreteSubState(!!v); salvar(); };
  const setState = (updater) => {
    setAnaliseStateRaw(prev => {
      const novo = typeof updater === 'function' ? updater(prev) : updater;
      analiseRef.current = novo;
      clearTimeout(window.__meluniSaveT2);
      window.__meluniSaveT2 = setTimeout(salvar, 500);
      return novo;
    });
  };

  return <CalcAnaliseMeluni prods={prods} prs={prs} roasMeluniGlobal={roasMeluniGlobal} setRoasMeluniGlobal={setRoasMeluniGlobal} freteSubsidiado={freteSub} setFreteSubsidiado={setFreteSubsidiado} state={analiseState} setState={setState} onVoltar={onVoltar} mobile={mobile} />;
}
