import { useState, useEffect } from 'react';
import { supabase } from './supabase.js';

// CalcMetaAdsAmicia — Análise das campanhas Meta Ads da conta de CONVERSÕES
// da Amícia (site B2B amicialoja.com.br). Irmã da tela do Meluni: mesmas
// colunas, filtros e criativos, MAIS a coluna Carrinhos (add_to_cart do pixel,
// objetivo da campanha de retargeting) e o funil com as VENDAS REAIS do CRM
// da Sofia (lojas_whats_conversas, etapa vendeu). Ailson 27/08/2026.
// ═══════════════════════════════════════════════════════════════════════════
const CalcMetaAdsAmicia=({onVoltar,mobile})=>{
  const META_ACCOUNT='626487585630124'; // Amícia conversões (site B2B)
  const [periodo,setPeriodo]=useState('7d'); // '7d' | 'mes_atual' | 'mes_passado'
  const [ocultarPausadas,setOcultarPausadas]=useState(true);
  const [dados,setDados]=useState(null);
  const [dadosAnt,setDadosAnt]=useState(null);
  const [dadosAds,setDadosAds]=useState(null); // level=ad (criativos do período)
  const [expandidas,setExpandidas]=useState(()=>new Set()); // campanhas expandidas (mostram criativos)
  const [verTodosCriativos,setVerTodosCriativos]=useState(false);
  const [ordemCriativos,setOrdemCriativos]=useState('vendas'); // 'vendas' | 'roas'
  const [loading,setLoading]=useState(false);
  const [erro,setErro]=useState(null);
  const [ultimaAtt,setUltimaAtt]=useState(null);
  const [tickAgora,setTickAgora]=useState(Date.now());
  const [blingVendas,setBlingVendas]=useState(null); // {pedidos, receita} reais Meluni = Bling conta lumia / canal Outros (só atendidas)
  const [ga4,setGa4]=useState(null); // novos x recorrentes (GA4 property Meluni)
  const sbUrl=import.meta.env.VITE_SUPABASE_URL||localStorage.getItem("sb_url")||"";
  // Mostrar/ocultar colunas (persistente por aparelho). Default: tudo visível.
  const [colVis,setColVis]=useState(()=>{try{return JSON.parse(localStorage.getItem('calc_amicia_cols_v1')||'{}')||{};}catch(_){return{};}});
  useEffect(()=>{try{localStorage.setItem('calc_amicia_cols_v1',JSON.stringify(colVis));}catch(_){}},[colVis]);
  const [menuCols,setMenuCols]=useState(false);
  const vis=(k)=>colVis[k]!==false;
  const toggleCol=(k)=>setColVis(p=>({...p,[k]:p[k]===false}));
  const COLUNAS=[['gasto','Gasto'],['impressoes','Visualizações'],['acessos','Acessos'],['custo','Custo/acesso'],['cpclink','CPC link'],['carrinhos','Carrinhos'],['compras','Compras'],['conv','Conv%'],['cpa','CPA'],['vendas','Vendas (criativos)'],['roas','ROAS']];

  // "há X min" atualiza sozinho sem novo fetch
  useEffect(()=>{
    const t=setInterval(()=>setTickAgora(Date.now()),30000);
    return()=>clearInterval(t);
  },[]);

  const fmtIso=(d)=>d.toISOString().slice(0,10);
  const calcJanela=(p)=>{
    const hoje=new Date();
    if(p==='7d'){const s=new Date(hoje);s.setDate(s.getDate()-6);return{since:fmtIso(s),until:fmtIso(hoje)};}
    if(p==='mes_atual'){const s=new Date(hoje.getFullYear(),hoje.getMonth(),1);return{since:fmtIso(s),until:fmtIso(hoje)};}
    if(p==='mes_passado'){const s=new Date(hoje.getFullYear(),hoje.getMonth()-1,1);const u=new Date(hoje.getFullYear(),hoje.getMonth(),0);return{since:fmtIso(s),until:fmtIso(u)};}
    return{since:'',until:''};
  };
  const calcJanelaAnt=(p)=>{
    const{since,until}=calcJanela(p);
    if(!since)return{since:'',until:''};
    const s=new Date(since),u=new Date(until);
    const dias=Math.floor((u-s)/86400000)+1;
    const uAnt=new Date(s);uAnt.setDate(uAnt.getDate()-1);
    const sAnt=new Date(uAnt);sAnt.setDate(sAnt.getDate()-(dias-1));
    return{since:fmtIso(sAnt),until:fmtIso(uAnt)};
  };

  const carregar=async()=>{
    setLoading(true);setErro(null);
    try{
      const{since,until}=calcJanela(periodo);
      const{since:sA,until:uA}=calcJanelaAnt(periodo);
      const base=`/api/meta-ads-analise?account=${META_ACCOUNT}&level=campaign`;
      const baseAd=`/api/meta-ads-analise?account=${META_ACCOUNT}&level=ad`;
      const[r1,r2,r3]=await Promise.all([
        fetch(`${base}&since=${since}&until=${until}`).then(r=>r.json()),
        fetch(`${base}&since=${sA}&until=${uA}`).then(r=>r.json()),
        fetch(`${baseAd}&since=${since}&until=${until}`).then(r=>r.json()),
      ]);
      if(!r1.ok){throw new Error(r1.error||r1.meta_error?.message||'Erro Meta API');}
      setDados(r1);
      setDadosAnt(r2.ok?r2:null);
      setDadosAds(r3.ok?r3:null);
      setUltimaAtt(new Date());
      // Vendas REAIS da Amícia no período = CRM da Sofia (conversas marcadas
      // como vendeu, com o valor da venda casada). Fonte da verdade do B2B.
      try{
        const{data:bv}=await supabase.from('lojas_whats_conversas')
          .select('vendeu_valor')
          .eq('etapa','vendeu')
          .gte('vendeu_em',`${since}T00:00:00-03:00`)
          .lte('vendeu_em',`${until}T23:59:59-03:00`);
        const pedidos=(bv||[]).length;
        const receita=(bv||[]).reduce((s,r)=>s+(parseFloat(r.vendeu_valor)||0),0);
        setBlingVendas({pedidos,receita});
      }catch(_){setBlingVendas(null);}
      // GA4: a property do site B2B ainda nao esta ligada aqui — quando tiver,
      // basta repetir a chamada do Meluni com o id da property da Amicia.
      setGa4(null);
    }catch(e){
      setErro(e.message||'Erro ao carregar');
    }finally{
      setLoading(false);
    }
  };

  useEffect(()=>{carregar();/* eslint-disable-next-line react-hooks/exhaustive-deps */},[periodo]);

  const findAction=(arr,type)=>{
    if(!arr)return 0;
    const a=arr.find(x=>x.action_type===type);
    return a?parseFloat(a.value)||0:0;
  };
  const extrair=(c)=>{
    const lpv=findAction(c.actions,'landing_page_view');
    const compras=findAction(c.actions,'omni_purchase');
    const gasto=parseFloat(c.spend)||0;
    const impressoes=parseFloat(c.impressions)||0;
    const cliques=findAction(c.actions,'link_click')||parseFloat(c.clicks)||0;
    const carrinhos=findAction(c.actions,'omni_add_to_cart')||findAction(c.actions,'add_to_cart');
    const vendas=findAction(c.action_values,'omni_purchase');
    return{
      id:c.ad_id||c.campaign_id,
      campanhaId:c.campaign_id,
      nome:c.ad_name||c.campaign_name,
      status:c.ad_effective_status||c.effective_status||c.status,
      gasto,
      acessos:lpv,
      cpc:lpv>0?gasto/lpv:0,
      cpcLink:cliques>0?gasto/cliques:0,
      compras,
      conv:lpv>0?(compras/lpv)*100:0,
      cpa:compras>0?gasto/compras:0,
      impressoes,
      cliques,
      carrinhos,
      vendas,
      roas:gasto>0?vendas/gasto:0,
      creativeThumb:c.creative_thumb||null,
    };
  };

  // delta retorna {valor, cor}. bomSobe=true → verde se sobe (compras/conv); false → verde se cai (gasto/cpc/cpa).
  const delta=(atual,ant,bomSobe)=>{
    if(ant==null||ant===0){if(atual===0)return null;return{valor:'novo',cor:'#8a9aa4'};}
    const pct=((atual-ant)/ant)*100;
    if(Math.abs(pct)<1)return{valor:'~0%',cor:'#8a9aa4'};
    const sobe=pct>0;
    const bom=(sobe===bomSobe);
    return{valor:`${sobe?'↑':'↓'}${Math.abs(pct).toFixed(0)}%`,cor:bom?'#27ae60':'#c0392b'};
  };

  const linhas=(dados?.data||[]).map(extrair);
  const linhasAntMap={};
  (dadosAnt?.data||[]).forEach(c=>{linhasAntMap[c.campaign_id]=extrair(c);});
  const linhasFiltradas=linhas.filter(l=>{
    if(ocultarPausadas&&l.status!=='ACTIVE')return false;
    return true;
  }).sort((a,b)=>b.gasto-a.gasto);

  const totals=linhasFiltradas.reduce((acc,l)=>({
    gasto:acc.gasto+l.gasto,acessos:acc.acessos+l.acessos,compras:acc.compras+l.compras,
    vendas:acc.vendas+l.vendas,impressoes:acc.impressoes+l.impressoes,cliques:acc.cliques+l.cliques,carrinhos:acc.carrinhos+l.carrinhos,
  }),{gasto:0,acessos:0,compras:0,vendas:0,impressoes:0,cliques:0,carrinhos:0});
  const totalCpc=totals.acessos>0?totals.gasto/totals.acessos:0;
  const totalCpcLink=totals.cliques>0?totals.gasto/totals.cliques:0;
  const totalConv=totals.acessos>0?(totals.compras/totals.acessos)*100:0;
  const totalCpa=totals.compras>0?totals.gasto/totals.compras:0;
  const totalRoas=totals.gasto>0?totals.vendas/totals.gasto:0;

  // Totais período anterior (mesmas campanhas visíveis) pra Δ% do TOTAL
  const totalsAnt=Object.values(linhasAntMap)
    .filter(l=>!ocultarPausadas||l.status==='ACTIVE')
    .reduce((acc,l)=>({gasto:acc.gasto+l.gasto,acessos:acc.acessos+l.acessos,compras:acc.compras+l.compras,cliques:acc.cliques+l.cliques,carrinhos:acc.carrinhos+l.carrinhos}),{gasto:0,acessos:0,compras:0,cliques:0,carrinhos:0});
  const totalCpcAnt=totalsAnt.acessos>0?totalsAnt.gasto/totalsAnt.acessos:0;
  const totalCpcLinkAnt=totalsAnt.cliques>0?totalsAnt.gasto/totalsAnt.cliques:0;
  const totalConvAnt=totalsAnt.acessos>0?(totalsAnt.compras/totalsAnt.acessos)*100:0;
  const totalCpaAnt=totalsAnt.compras>0?totalsAnt.gasto/totalsAnt.compras:0;

  // Criativos (level=ad) do período: "ativos" = tiveram entrega (impressão/gasto) no período.
  const criativos=(dadosAds?.data||[]).map(extrair).filter(a=>a.impressoes>0||a.gasto>0);
  const adsPorCampanha={};
  criativos.forEach(a=>{(adsPorCampanha[a.campanhaId]=adsPorCampanha[a.campanhaId]||[]).push(a);});
  Object.values(adsPorCampanha).forEach(arr=>arr.sort((x,y)=>y.gasto-x.gasto));
  // Ativos primeiro (Ailson 30/07/2026), depois o criterio escolhido
  const criativosOrdenados=[...criativos].sort((a,b)=>{
    const pa=a.status==='ACTIVE'?0:1, pb=b.status==='ACTIVE'?0:1;
    if(pa!==pb)return pa-pb;
    return ordemCriativos==='roas'?b.roas-a.roas:b.vendas-a.vendas;
  });
  // Tag ativo/inativo do criativo (sem status = sem tag, nao chuta)
  const tagAtivo=(s)=>{
    if(!s)return null;
    const on=s==='ACTIVE';
    return<span style={{fontSize:9,fontWeight:700,padding:'1px 7px',borderRadius:8,flexShrink:0,
      background:on?'#e3f6ea':'#fdeaea',color:on?'#1f8a4c':'#c0392b',
      border:`1px solid ${on?'#bce5cc':'#f3c1c1'}`}}>{on?'ativo':'inativo'}</span>;
  };
  const toggleExpand=(id)=>setExpandidas(prev=>{const n=new Set(prev);n.has(id)?n.delete(id):n.add(id);return n;});

  const haMin=ultimaAtt?Math.floor((tickAgora-ultimaAtt.getTime())/60000):0;
  const haTxt=haMin<1?'agora':haMin===1?'há 1 min':`há ${haMin} min`;

  const fmtR=(v)=>v.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
  const fmtI=(v)=>Math.round(v).toLocaleString('pt-BR');
  // ROAS por faixa: >=2 verde (saudável), 1-2 âmbar (fino), <1 vermelho (perde), 0/— neutro
  const corRoas=(r)=>r>=2?'#1f8a4c':r>=1?'#c77d11':r>0?'#c0392b':'#a89f94';
  const calFont="Calibri,'Segoe UI',Arial,sans-serif";
  const roasCell=(r)=><span style={{color:corRoas(r),fontWeight:700}}>{r>0?`${r.toFixed(2)}x`:'—'}</span>;
  // REF do nome do criativo: prefere 'ref_NNNN', senão 1º número de 4 dígitos (2277,2601,2700...). Ignora seq tipo 'ad_01_'.
  const refDoCriativo=(nome)=>{const s=String(nome||'');const m=s.match(/ref[_-]?(\d{3,5})/i)||s.match(/(?:^|[_\s])(\d{4})(?:[_\s]|$)/);return m?m[1]:null;};

  const btnPer=(p,label)=>(
    <button key={p} onClick={()=>setPeriodo(p)} style={{
      background:periodo===p?'#2c3e50':'#fff',color:periodo===p?'#fff':'#2c3e50',
      border:'1px solid #e8e2da',borderRadius:6,padding:'6px 12px',
      fontSize:12,cursor:'pointer',fontFamily:'Georgia,serif',fontWeight:600
    }}>{label}</button>
  );

  const statusBadge=(s)=>{
    if(s==='ACTIVE')return<span title="Ativa" style={{fontSize:14}}>🟢</span>;
    if(s==='PAUSED'||s==='CAMPAIGN_PAUSED')return<span title="Pausada" style={{fontSize:14}}>⏸️</span>;
    return<span title={s} style={{fontSize:14}}>⚠️</span>;
  };

  const tdNum={padding:'8px 10px',textAlign:'right',color:'#2c3e50',fontFamily:'Calibri,\'Segoe UI\',Arial,sans-serif',fontSize:13};
  const td={padding:'8px 10px',color:'#2c3e50',fontSize:12};
  const th={padding:'10px 10px',fontWeight:600,fontFamily:'Georgia,serif',fontSize:11,letterSpacing:0.3,textTransform:'uppercase',position:'sticky',top:0,zIndex:1,background:'#2c3e50'};

  const cellNum=(num,d)=>(
    <td style={tdNum}>
      <div>{num}</div>
      {d&&<div style={{fontSize:10,color:d.cor,marginTop:2,fontFamily:'Georgia,serif'}}>{d.valor}</div>}
    </td>
  );

  return(
    <div style={{background:'#f7f4f0',minHeight:'100%',padding:mobile?12:20,fontFamily:'Georgia,serif'}}>
      <div style={{maxWidth:1200,margin:'0 auto'}}>
        {/* Header */}
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:18,flexWrap:'wrap',gap:10}}>
          <div style={{display:'flex',alignItems:'center',gap:12}}>
            <button onClick={onVoltar} style={{background:'#fff',border:'1px solid #e8e2da',borderRadius:8,padding:'7px 14px',cursor:'pointer',fontSize:13,color:'#4a7fa5',fontFamily:'Georgia,serif'}}>← Voltar</button>
            <div>
              <div style={{fontSize:10,color:'#a89f94',letterSpacing:2,textTransform:'uppercase'}}>Calculadora · Meta Ads</div>
              <div style={{fontSize:mobile?18:22,fontWeight:700,color:'#2c3e50'}}>📈 Meta Ads Meluni</div>
            </div>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            <span style={{fontSize:11,color:'#8a9aa4',fontStyle:'italic'}}>
              {loading?'⏳ Atualizando...':ultimaAtt?`🕐 Atualizado ${haTxt}`:''}
            </span>
            <button onClick={carregar} disabled={loading} title="Atualizar agora (ignora cache de 5min)" style={{background:'#fff',border:'1px solid #e8e2da',borderRadius:6,padding:'6px 12px',cursor:loading?'not-allowed':'pointer',fontSize:14,color:'#4a7fa5',fontFamily:'Georgia,serif',opacity:loading?0.5:1}}>↻</button>
          </div>
        </div>

        {/* Filtros */}
        <div style={{background:'#fff',border:'1px solid #e8e2da',borderRadius:8,padding:12,marginBottom:14,display:'flex',gap:10,flexWrap:'wrap',alignItems:'center'}}>
          <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>{btnPer('7d','7 dias')}{btnPer('mes_atual','Mês atual')}{btnPer('mes_passado','Mês passado')}</div>
          <div style={{height:24,width:1,background:'#e8e2da'}}/>
          <label style={{display:'flex',alignItems:'center',gap:6,cursor:'pointer',fontSize:12,color:'#2c3e50'}}>
            <input type="checkbox" checked={ocultarPausadas} onChange={e=>setOcultarPausadas(e.target.checked)}/> Ocultar pausadas
          </label>
          <div style={{position:'relative',marginLeft:'auto'}}>
            <button onClick={()=>setMenuCols(v=>!v)} style={{background:menuCols?'#2c3e50':'#fff',color:menuCols?'#fff':'#2c3e50',border:'1px solid #e8e2da',borderRadius:6,padding:'6px 10px',fontSize:12,cursor:'pointer',fontFamily:'Georgia,serif'}}>⋮ Colunas</button>
            {menuCols&&(<>
              <div onClick={()=>setMenuCols(false)} style={{position:'fixed',inset:0,zIndex:10}}/>
              <div style={{position:'absolute',right:0,top:'calc(100% + 6px)',zIndex:11,background:'#fff',border:'1px solid #e8e2da',borderRadius:8,boxShadow:'0 6px 24px rgba(0,0,0,0.15)',padding:8,minWidth:180}}>
                <div style={{fontSize:10,color:'#a89f94',textTransform:'uppercase',letterSpacing:0.5,padding:'2px 6px 6px'}}>Mostrar colunas</div>
                {COLUNAS.map(([k,label])=>(
                  <label key={k} style={{display:'flex',alignItems:'center',gap:8,padding:'5px 6px',fontSize:12,color:'#2c3e50',cursor:'pointer'}}>
                    <input type="checkbox" checked={vis(k)} onChange={()=>toggleCol(k)}/> {label}
                  </label>
                ))}
              </div>
            </>)}
          </div>
        </div>

        {erro&&(
          <div style={{background:'#fdf0ed',border:'1px solid #c0392b',color:'#c0392b',padding:12,borderRadius:8,marginBottom:14,fontSize:12}}>
            ⚠ {erro}
          </div>
        )}

        {/* Tabela */}
        <div style={{background:'#fff',border:'1px solid #e8e2da',borderRadius:8,overflowX:'auto'}}>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:12,minWidth:820}}>
            <thead>
              <tr style={{background:'#2c3e50',color:'#f7f4f0'}}>
                <th style={{...th,textAlign:'center',width:40}}></th>
                <th style={{...th,textAlign:'left'}}>Campanha</th>
                {vis('gasto')&&<th style={{...th,textAlign:'right'}}>Gasto</th>}
                {vis('impressoes')&&<th style={{...th,textAlign:'right'}}>Visualizações</th>}
                {vis('acessos')&&<th style={{...th,textAlign:'right'}}>Acessos</th>}
                {vis('custo')&&<th style={{...th,textAlign:'right'}}>Custo/acesso</th>}
                {vis('cpclink')&&<th style={{...th,textAlign:'right'}}>CPC link</th>}
                {vis('carrinhos')&&<th style={{...th,textAlign:'right'}}>Carrinhos</th>}
                {vis('compras')&&<th style={{...th,textAlign:'right'}}>Compras</th>}
                {vis('conv')&&<th style={{...th,textAlign:'right'}}>Conv%</th>}
                {vis('cpa')&&<th style={{...th,textAlign:'right'}}>CPA</th>}
                {vis('roas')&&<th style={{...th,textAlign:'right'}}>ROAS</th>}
              </tr>
            </thead>
            <tbody>
              {loading&&!dados&&(
                <tr><td colSpan={11} style={{padding:24,textAlign:'center',color:'#a89f94',fontStyle:'italic'}}>Carregando dados Meta Ads...</td></tr>
              )}
              {!loading&&linhasFiltradas.length===0&&!erro&&(
                <tr><td colSpan={11} style={{padding:24,textAlign:'center',color:'#a89f94',fontStyle:'italic'}}>
                  {ocultarPausadas?'Nenhuma campanha ativa no período. Desmarque "Ocultar pausadas" pra ver todas.':'Nenhuma campanha no período.'}
                </td></tr>
              )}
              {linhasFiltradas.map((l,idx)=>{
                const ant=linhasAntMap[l.id];
                const ads=adsPorCampanha[l.id]||[];
                const aberta=expandidas.has(l.id);
                const rows=[
                  <tr key={l.id} style={{borderBottom:'1px solid #f0ebe4',background:idx%2?'#faf8f5':'#fff'}}>
                    <td style={{padding:'8px 4px',textAlign:'center'}}>{statusBadge(l.status)}</td>
                    <td style={{...td,fontSize:13,maxWidth:280,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={l.nome}>
                      {ads.length>0
                        ?<span onClick={()=>toggleExpand(l.id)} style={{cursor:'pointer',color:'#4a7fa5',marginRight:6,userSelect:'none',fontWeight:700}}>{aberta?'▾':'▸'}</span>
                        :<span style={{marginRight:6,color:'#cfc7bd'}}>·</span>}
                      {l.nome}{ads.length>0&&<span style={{fontSize:10,color:'#a89f94',marginLeft:6}}>({ads.length})</span>}
                    </td>
                    {vis('gasto')&&cellNum(`R$ ${fmtR(l.gasto)}`,ant?delta(l.gasto,ant.gasto,false):null)}
                    {vis('impressoes')&&cellNum(fmtI(l.impressoes))}
                    {vis('acessos')&&cellNum(fmtI(l.acessos),ant?delta(l.acessos,ant.acessos,true):null)}
                    {vis('custo')&&cellNum(`R$ ${fmtR(l.cpc)}`,ant?delta(l.cpc,ant.cpc,false):null)}
                    {vis('cpclink')&&cellNum(`R$ ${fmtR(l.cpcLink)}`,ant?delta(l.cpcLink,ant.cpcLink,false):null)}
                    {vis('carrinhos')&&cellNum(fmtI(l.carrinhos),ant?delta(l.carrinhos,ant.carrinhos,true):null)}
                    {vis('compras')&&cellNum(fmtI(l.compras),ant?delta(l.compras,ant.compras,true):null)}
                    {vis('conv')&&cellNum(`${l.conv.toFixed(2)}%`,ant?delta(l.conv,ant.conv,true):null)}
                    {vis('cpa')&&cellNum(l.cpa>0?`R$ ${fmtR(l.cpa)}`:'—',ant&&l.cpa>0&&ant.cpa>0?delta(l.cpa,ant.cpa,false):null)}
                    {vis('roas')&&cellNum(roasCell(l.roas))}
                  </tr>
                ];
                if(aberta)ads.forEach(a=>rows.push(
                  <tr key={a.id} style={{borderBottom:'1px solid #f0ebe4',background:'#f3eee7'}}>
                    <td></td>
                    <td style={{...td,paddingLeft:24,maxWidth:280,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',color:'#6b7b86'}} title={a.nome}>↳ {a.nome}</td>
                    {vis('gasto')&&cellNum(`R$ ${fmtR(a.gasto)}`)}
                    {vis('impressoes')&&cellNum(fmtI(a.impressoes))}
                    {vis('acessos')&&cellNum(fmtI(a.acessos))}
                    {vis('custo')&&cellNum(`R$ ${fmtR(a.cpc)}`)}
                    {vis('cpclink')&&cellNum(`R$ ${fmtR(a.cpcLink)}`)}
                    {vis('carrinhos')&&cellNum(fmtI(a.carrinhos))}
                    {vis('compras')&&cellNum(fmtI(a.compras))}
                    {vis('conv')&&cellNum(`${a.conv.toFixed(2)}%`)}
                    {vis('cpa')&&cellNum(a.cpa>0?`R$ ${fmtR(a.cpa)}`:'—')}
                    {vis('roas')&&cellNum(roasCell(a.roas))}
                  </tr>
                ));
                return rows;
              })}
            </tbody>
            {linhasFiltradas.length>0&&(
              <tfoot>
                <tr style={{background:'#f7f4f0',borderTop:'2px solid #2c3e50'}}>
                  <td style={{padding:'10px 4px'}}></td>
                  <td style={{...td,fontWeight:700}}>TOTAL ({linhasFiltradas.length})</td>
                  {vis('gasto')&&cellNum(<b>R$ {fmtR(totals.gasto)}</b>,totalsAnt.gasto>0?delta(totals.gasto,totalsAnt.gasto,false):null)}
                  {vis('impressoes')&&cellNum(<b>{fmtI(totals.impressoes)}</b>)}
                  {vis('acessos')&&cellNum(<b>{fmtI(totals.acessos)}</b>,totalsAnt.acessos>0?delta(totals.acessos,totalsAnt.acessos,true):null)}
                  {vis('custo')&&cellNum(<b>R$ {fmtR(totalCpc)}</b>,totalCpcAnt>0?delta(totalCpc,totalCpcAnt,false):null)}
                  {vis('cpclink')&&cellNum(<b>R$ {fmtR(totalCpcLink)}</b>,totalCpcLinkAnt>0?delta(totalCpcLink,totalCpcLinkAnt,false):null)}
                  {vis('carrinhos')&&cellNum(<b>{fmtI(totals.carrinhos)}</b>,totalsAnt.carrinhos>0?delta(totals.carrinhos,totalsAnt.carrinhos,true):null)}
                  {vis('compras')&&cellNum(<b>{fmtI(totals.compras)}</b>,totalsAnt.compras>0?delta(totals.compras,totalsAnt.compras,true):null)}
                  {vis('conv')&&cellNum(<b>{totalConv.toFixed(2)}%</b>,totalConvAnt>0?delta(totalConv,totalConvAnt,true):null)}
                  {vis('cpa')&&cellNum(<b>{totalCpa>0?`R$ ${fmtR(totalCpa)}`:'—'}</b>,totalCpaAnt>0&&totalCpa>0?delta(totalCpa,totalCpaAnt,false):null)}
                  {vis('roas')&&cellNum(<b>{roasCell(totalRoas)}</b>)}
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        {/* Ver todos os criativos ativos no período (ordenável) */}
        <div style={{marginTop:14}}>
          <button onClick={()=>setVerTodosCriativos(v=>!v)} style={{background:'#fff',border:'1px solid #e8e2da',borderRadius:8,padding:'8px 14px',cursor:'pointer',fontSize:12,color:'#4a7fa5',fontFamily:'Georgia,serif',fontWeight:600}}>
            {verTodosCriativos?'▾':'▸'} Ver todos os criativos ({criativos.length})
          </button>
          {verTodosCriativos&&(
            <div style={{marginTop:10,background:'#fff',border:'1px solid #e8e2da',borderRadius:8,overflowX:'auto'}}>
              <div style={{display:'flex',gap:6,padding:'10px 12px',borderBottom:'1px solid #f0ebe4',alignItems:'center',flexWrap:'wrap'}}>
                <span style={{fontSize:11,color:'#8a9aa4'}}>Ordenar por:</span>
                <button onClick={()=>setOrdemCriativos('vendas')} style={{background:ordemCriativos==='vendas'?'#2c3e50':'#fff',color:ordemCriativos==='vendas'?'#fff':'#2c3e50',border:'1px solid #e8e2da',borderRadius:6,padding:'4px 10px',fontSize:11,cursor:'pointer',fontFamily:'Georgia,serif'}}>Maiores vendas</button>
                <button onClick={()=>setOrdemCriativos('roas')} style={{background:ordemCriativos==='roas'?'#2c3e50':'#fff',color:ordemCriativos==='roas'?'#fff':'#2c3e50',border:'1px solid #e8e2da',borderRadius:6,padding:'4px 10px',fontSize:11,cursor:'pointer',fontFamily:'Georgia,serif'}}>Maior ROAS</button>
              </div>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:12,minWidth:720}}>
                <thead><tr style={{background:'#4a7fa5',color:'#fff'}}>
                  <th style={{...th,background:'#4a7fa5',textAlign:'left'}}>Criativo</th>
                  {vis('gasto')&&<th style={{...th,background:'#4a7fa5',textAlign:'right'}}>Gasto</th>}
                  {vis('impressoes')&&<th style={{...th,background:'#4a7fa5',textAlign:'right'}}>Visualizações</th>}
                  {vis('carrinhos')&&<th style={{...th,background:'#4a7fa5',textAlign:'right'}}>Carrinhos</th>}
                  {vis('compras')&&<th style={{...th,background:'#4a7fa5',textAlign:'right'}}>Compras</th>}
                  {vis('vendas')&&<th style={{...th,background:'#4a7fa5',textAlign:'right'}}>Vendas</th>}
                  {vis('roas')&&<th style={{...th,background:'#4a7fa5',textAlign:'right'}}>ROAS</th>}
                </tr></thead>
                <tbody>
                  {criativosOrdenados.map((a,idx)=>{const ref=refDoCriativo(a.nome);return(
                    <tr key={a.id} style={{borderBottom:'1px solid #f0ebe4',background:idx%2?'#faf8f5':'#fff'}}>
                      <td style={{...td,maxWidth:340}} title={a.nome}>
                        <div style={{display:'flex',alignItems:'center',gap:8}}>
                          {a.creativeThumb
                            ?<><img src={a.creativeThumb} alt="" referrerPolicy="no-referrer" onError={(e)=>{e.target.style.display='none';const ph=e.target.nextSibling;if(ph)ph.style.display='flex';}} style={{width:34,height:44,objectFit:'cover',borderRadius:4,border:'1px solid #e8e2da',flexShrink:0}}/><div style={{width:34,height:44,borderRadius:4,background:'#f0ebe3',display:'none',alignItems:'center',justifyContent:'center',border:'1px solid #e8e2da',flexShrink:0}}><span style={{fontSize:11,opacity:0.35}}>🎬</span></div></>
                            :ref
                              ?<><FotoProd sbUrl={sbUrl} refProd={ref} onZoom={null}/><div style={{width:34,height:44,borderRadius:4,background:'#f0ebe3',display:'none',alignItems:'center',justifyContent:'center',border:'1px solid #e8e2da',flexShrink:0}}><span style={{fontSize:12,opacity:0.3}}>📷</span></div></>
                              :<div style={{width:34,height:44,borderRadius:4,background:'#f0ebe3',display:'flex',alignItems:'center',justifyContent:'center',border:'1px solid #e8e2da',flexShrink:0}}><span style={{fontSize:11,opacity:0.35}}>🎬</span></div>}
                          <span style={{flex:1,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{a.nome}</span>
                          {tagAtivo(a.status)}
                        </div>
                      </td>
                      {vis('gasto')&&<td style={tdNum}>R$ {fmtR(a.gasto)}</td>}
                      {vis('impressoes')&&<td style={tdNum}>{fmtI(a.impressoes)}</td>}
                      {vis('carrinhos')&&<td style={tdNum}>{fmtI(a.carrinhos)}</td>}
                      {vis('compras')&&<td style={tdNum}>{fmtI(a.compras)}</td>}
                      {vis('vendas')&&<td style={tdNum}>R$ {fmtR(a.vendas)}</td>}
                      {vis('roas')&&<td style={tdNum}>{roasCell(a.roas)}</td>}
                    </tr>
                  );})}
                  {criativosOrdenados.length===0&&<tr><td colSpan={6} style={{padding:20,textAlign:'center',color:'#a89f94',fontStyle:'italic'}}>Nenhum criativo com entrega no período.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Funil do período */}
        {linhasFiltradas.length>0&&(()=>{
          const comprasReais=blingVendas?blingVendas.pedidos:totals.compras;       // CRM Sofia (fallback Meta se o CRM não carregou)
          const receitaReal=blingVendas?blingVendas.receita:totals.vendas;
          const etapas=[
            {nome:'Visualizações',valor:totals.impressoes,cor:'#2c3e50',sub:null},
            {nome:'Cliques',valor:totals.cliques,cor:'#3a5f80',sub:null},
            {nome:'Carrinhos',valor:totals.carrinhos,cor:'#4a7fa5',sub:'pixel Meta'},
            {nome:'Vendas',valor:comprasReais,cor:'#1f8a4c',sub:`R$ ${fmtR(receitaReal)} · CRM Sofia`},
          ];
          const larguras=[100,74,52,34]; // taper fixo: impressões achatariam o resto se fosse por valor
          const convCliquesCompra=totals.cliques>0?(comprasReais/totals.cliques)*100:0;
          const calFont='Calibri,\'Segoe UI\',Arial,sans-serif';
          return(
            <div style={{marginTop:18,background:'#fff',border:'1px solid #e8e2da',borderRadius:8,padding:'18px 16px'}}>
              <div style={{fontSize:13,fontWeight:700,color:'#2c3e50',marginBottom:14}}>Funil do período</div>
              <div style={{display:'flex',flexDirection:'column',alignItems:'center'}}>
                {etapas.map((e,i)=>{
                  const conv=i>0&&etapas[i-1].valor>0?(e.valor/etapas[i-1].valor)*100:null;
                  return(
                    <div key={e.nome} style={{width:'100%',display:'flex',flexDirection:'column',alignItems:'center'}}>
                      {conv!=null&&<div style={{fontSize:10,color:'#8a9aa4',margin:'4px 0'}}>↓ {conv.toFixed(1)}%</div>}
                      <div style={{width:`${larguras[i]}%`,minWidth:150,background:e.cor,color:'#fff',borderRadius:8,padding:'12px 14px',textAlign:'center',boxShadow:'0 1px 3px rgba(0,0,0,0.12)'}}>
                        <div style={{fontSize:11,opacity:0.85,letterSpacing:0.3}}>{e.nome}</div>
                        <div style={{fontSize:20,fontWeight:700,fontFamily:calFont,lineHeight:1.1}}>{fmtI(e.valor)}</div>
                        {e.sub&&<div style={{fontSize:9.5,opacity:0.82,marginTop:2}}>{e.sub}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{marginTop:16,textAlign:'center',background:'#f0f6f1',border:'1px solid #cfe6d6',borderRadius:8,padding:'9px 12px',color:'#1f6b40',fontSize:12}}>
                <b style={{fontFamily:calFont,fontSize:15}}>{convCliquesCompra.toFixed(2)}%</b> dos cliques viraram venda <span style={{color:'#6b9a7e'}}>· venda real do CRM Sofia</span>
              </div>
            </div>
          );
        })()}

        {ga4&&ga4.length>0&&(()=>{
          const norm=(s)=>String(s||'').toLowerCase();
          const pick=(pred)=>ga4.find(r=>pred(norm(r.newVsReturning)))||{};
          const mk=(rotulo,r,cor)=>{
            const ss=r.sessions||0,co=r.ecommercePurchases||0,rev=r.purchaseRevenue||0;
            return {rotulo,ss,co,rev,cv:ss>0?(co/ss)*100:0,cor};
          };
          const L=[
            mk('Novos',pick(s=>s.startsWith('new')),'#4a7fa5'),
            mk('Recorrentes',pick(s=>s.startsWith('return')),'#1f8a4c'),
          ].filter(x=>x.ss>0||x.co>0);
          if(L.length===0)return null;
          return(
            <div style={{marginTop:18,background:'#fff',border:'1px solid #e8e2da',borderRadius:8,padding:16}}>
              <div style={{fontSize:13,fontWeight:700,color:'#2c3e50'}}>Novos x Recorrentes <span style={{fontSize:10,color:'#a89f94',fontWeight:400}}>· GA4 · site Meluni</span></div>
              <div style={{fontSize:11,color:'#8a9aa4',margin:'4px 0 12px'}}>cv% = compras ÷ sessões. Quem volta costuma converter melhor.</div>
              <div style={{display:'grid',gridTemplateColumns:mobile?'1fr':'1fr 1fr',gap:10}}>
                {L.map(x=>(
                  <div key={x.rotulo} style={{border:'1px solid #e8e2da',borderLeft:`4px solid ${x.cor}`,borderRadius:8,padding:'10px 12px'}}>
                    <div style={{fontSize:12,fontWeight:700,color:'#2c3e50',marginBottom:8}}>{x.rotulo}</div>
                    <div style={{display:'flex',gap:16,flexWrap:'wrap',fontFamily:calFont}}>
                      <div><div style={{fontSize:9,color:'#a89f94',textTransform:'uppercase',letterSpacing:0.3}}>Sessões</div><div style={{fontSize:17,fontWeight:700,color:'#2c3e50'}}>{fmtI(x.ss)}</div></div>
                      <div><div style={{fontSize:9,color:'#a89f94',textTransform:'uppercase',letterSpacing:0.3}}>Compras</div><div style={{fontSize:17,fontWeight:700,color:'#2c3e50'}}>{fmtI(x.co)}</div></div>
                      <div><div style={{fontSize:9,color:'#a89f94',textTransform:'uppercase',letterSpacing:0.3}}>cv%</div><div style={{fontSize:17,fontWeight:700,color:x.cor}}>{x.cv.toFixed(2)}%</div></div>
                      <div><div style={{fontSize:9,color:'#a89f94',textTransform:'uppercase',letterSpacing:0.3}}>Receita</div><div style={{fontSize:15,fontWeight:700,color:'#2c3e50'}}>R$ {fmtR(x.rev)}</div></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        <div style={{marginTop:10,fontSize:10,color:'#a89f94',textAlign:'center',fontStyle:'italic'}}>
          Conta: Amícia conversões (site B2B) · Tabela e ROAS = Meta · Carrinhos = add_to_cart do pixel · Vendas/receita do funil = CRM da Sofia (etapa vendeu) · Cache 5min · Δ% vs período anterior de mesma duração
        </div>
      </div>
    </div>
  );
};

export default CalcMetaAdsAmicia;
