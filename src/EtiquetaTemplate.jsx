/**
 * EtiquetaTemplate.jsx — Etiquetas (rolo 100mm).
 *   - EtiquetaTemplate (default): editor de template + salvar padrão + PDF de prova.
 *   - EtiquetaGerar (named): puxa SKUs reais do gtin_map e gera PDF em lote.
 * EAN-13 vetorial próprio. jspdf carregado sob demanda (CDN).
 *
 * Tabela: public.etiqueta_layouts (padrao=true = template ativo).
 */
import { useState, useEffect, useMemo, useRef } from 'react';
import { supabase } from './supabase.js';

const SERIF = "Georgia,serif";
const C = { navy:"#2c3e50", blue:"#4a7fa5", muted:"#8a9aa4", muted2:"#6b7c8a", edge:"#c8d8e4", sand:"#e8e2da", soft:"#edf4fb", panel:"#fcfaf7", bg:"#f7f4f0", green:"#27ae60", red:"#c0392b" };
const DEFAULT_LAYOUT = { rollW:100, cols:2, mLeft:0, gapC:0, gapR:2, lw:50, lh:30, fs:7, lat:2 };
const PREPOS = new Set(['com','de','da','do','e','para','a','o','as','os','em','no','na']);
const inpStyle={border:`1px solid ${C.edge}`,borderRadius:6,padding:'7px 9px',fontSize:14,fontFamily:SERIF,color:C.navy,background:'#fff',width:'100%',boxSizing:'border-box',outline:'none'};

// ── EAN-13 (próprio) ──────────────────────────────────────────────
const L_=['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011'];
const G_=['0100111','0110011','0011011','0100001','0011101','0111001','0000101','0010001','0001001','0010111'];
const R_=['1110010','1100110','1101100','1000010','1011100','1001110','1010000','1000100','1001000','1110100'];
const PAR=['LLLLLL','LLGLGG','LLGGLG','LLGGGL','LGLLGG','LGGLLG','LGGGLL','LGLGLG','LGLGGL','LGGLGL'];
function ean13Check(d12){ let s=0; for(let i=0;i<12;i++) s+=(+d12[i])*(i%2?3:1); return String((10-s%10)%10); }
function gtinFromRef(ref){ const r=String(ref||'0').replace(/^0+/,'')||'0'; const base='2'+r.padStart(5,'0')+'000001'; return base+ean13Check(base); }
function gtinOK(g){ return /^\d{13}$/.test(g); }
function ean13Bits(code){
  const c=String(code||'').replace(/\D/g,''); if(c.length!==13) return null;
  const f=+c[0], left=c.slice(1,7), right=c.slice(7);
  const par=PAR[f]; let b='101';
  for(let i=0;i<6;i++) b+=(par[i]==='L'?L_:G_)[+left[i]];
  b+='01010';
  for(let i=0;i<6;i++) b+=R_[+right[i]];
  return b+'101';
}
function bitsToSvgUrl(bits){
  if(!bits) return null;
  let r=''; for(let i=0;i<bits.length;i++) if(bits[i]==='1') r+=`<rect x='${i}' y='0' width='1' height='10' fill='%23111'/>`;
  const svg=`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${bits.length} 10' preserveAspectRatio='none'>${r}</svg>`;
  return `data:image/svg+xml;utf8,${svg.replace(/</g,'%3C').replace(/>/g,'%3E')}`;
}

// ── texto ─────────────────────────────────────────────────────────
function descCurta(desc){
  const p=(desc||'').trim().split(/\s+/).filter(w=>w&&!PREPOS.has(w.toLowerCase()));
  return p.slice(0,4).join(' ');
}
function refTxt(ref){ const r=String(ref||'').trim(); return r?`(Ref ${r})`:''; }
function wrapTitulo(pdf,desc,ref,maxW){
  const words=(desc||'').split(/\s+/).filter(Boolean);
  const lines=[]; let cur='';
  const place=(tok)=>{ const t=cur?cur+' '+tok:tok; if(pdf.getTextWidth(t)<=maxW){cur=t;} else { if(cur)lines.push(cur); cur=tok; } };
  words.forEach(place); if(ref) place(ref); if(cur) lines.push(cur);
  return lines.length?lines:[''];
}

function loadJsPDF(){
  if(window.jspdf) return Promise.resolve(window.jspdf);
  return new Promise((res,rej)=>{
    const s=document.createElement('script');
    s.src='https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    s.onload=()=>res(window.jspdf); s.onerror=rej; document.head.appendChild(s);
  });
}

// ── desenho de UMA etiqueta no PDF (compartilhado) ────────────────
function desenharLabel(pdf, lay, cx, item){
  const { lw, lh, lat, fs } = lay;
  const fsEff=fs*1.15, lineMm=fsEff*0.3528*1.25;
  const ix=cx+lat, iy=0.8;
  const dCur=descCurta(item.desc), rTxt=refTxt(item.ref);
  const t2=`${(item.cor||'').toUpperCase()} · ${(item.tam||'').toUpperCase()}`;
  pdf.setTextColor(20,20,20); pdf.setFontSize(fsEff); pdf.setFont('helvetica','bold');
  const l1=wrapTitulo(pdf,dCur,rTxt,lw-2*lat);
  l1.forEach((ln,i)=>pdf.text(ln, ix, iy+i*lineMm+lineMm*0.8));
  const nL1=l1.length;
  pdf.setFont('helvetica','normal');
  pdf.text(t2, cx+lw/2, iy+nL1*lineMm+lineMm*0.8, {align:'center'});
  const bits=ean13Bits(gtinOK(item.gtin)?item.gtin:gtinFromRef(item.ref));
  if(bits){
    const bcY=iy+(nL1+1)*lineMm+0.5;
    const fullH=Math.max(4,(lh-0.8)-bcY); const bcH=fullH*0.85;
    const bw=(lw-2*lat)/bits.length; const yTop=bcY+(fullH-bcH)/2;
    pdf.setFillColor(17,17,17);
    for(let i=0;i<bits.length;i++) if(bits[i]==='1') pdf.rect(ix+i*bw, yTop, bw, bcH, 'F');
  }
}

// ── monta PDF de uma lista de etiquetas (1 página = 1 linha do rolo) ──
async function gerarPdfLote(lay, items){
  const { jsPDF } = await loadJsPDF();
  const { rollW, lh, cols, mLeft, gapC, lw } = lay;
  const pdf=new jsPDF({unit:'mm',format:[rollW,lh],orientation:rollW>lh?'landscape':'portrait'});
  const perRow=Math.max(1,Math.round(cols));
  let first=true;
  for(let i=0;i<items.length;i+=perRow){
    if(!first) pdf.addPage([rollW,lh], rollW>lh?'landscape':'portrait');
    first=false;
    items.slice(i,i+perRow).forEach((it,c)=>{
      const cx=mLeft+c*(lw+gapC); if(cx+lw>rollW+0.5) return;
      desenharLabel(pdf, lay, cx, it);
    });
  }
  return pdf;
}

// ══════════════════════════════════════════════════════════════════
// EDITOR DE TEMPLATE
// ══════════════════════════════════════════════════════════════════
export default function EtiquetaTemplate({ sample, onClose }){
  const [lay,setLay]=useState(DEFAULT_LAYOUT);
  const [vizRows,setVizRows]=useState(6);
  const [smp,setSmp]=useState(()=>({
    desc: sample?.desc || 'Saia Midi de Linho com Pala Detalhada Bolsos',
    ref:  sample?.ref  || '02655',
    cor:  sample?.cor  || 'AMARELO',
    tam:  sample?.tam  || 'P',
    gtin: sample?.gtin || '',
  }));
  const [layoutId,setLayoutId]=useState(null);
  const [salvando,setSalvando]=useState(false);
  const [msg,setMsg]=useState('');
  const wrapRef=useRef(null);
  const [cw,setCw]=useState(340);

  useEffect(()=>{ (async()=>{
    try{
      const {data}=await supabase.from('etiqueta_layouts').select('id,params').eq('padrao',true).order('atualizado_em',{ascending:false}).limit(1);
      if(data&&data[0]){ setLayoutId(data[0].id); setLay({...DEFAULT_LAYOUT,...(data[0].params||{})}); }
    }catch(e){}
  })(); },[]);

  useEffect(()=>{
    const el=wrapRef.current; if(!el||typeof ResizeObserver==='undefined') return;
    const ro=new ResizeObserver(()=>setCw(el.clientWidth||340)); ro.observe(el); setCw(el.clientWidth||340);
    return ()=>ro.disconnect();
  },[]);

  const set=(k)=>(e)=>setLay(p=>({...p,[k]:parseFloat(e.target.value)||0}));
  const setS=(k)=>(e)=>setSmp(p=>({...p,[k]:e.target.value}));

  const gtin = gtinOK(smp.gtin) ? smp.gtin : gtinFromRef(smp.ref);
  const bits = useMemo(()=>ean13Bits(gtin),[gtin]);
  const bcUrl = useMemo(()=>bitsToSvgUrl(bits),[bits]);
  const dCur = descCurta(smp.desc), rTxt = refTxt(smp.ref);
  const t2 = `${(smp.cor||'').toUpperCase()} · ${(smp.tam||'').toUpperCase()}`;

  const { rollW, cols, mLeft, gapC, gapR, lw, lh, fs, lat } = lay;
  const scale = Math.max(1.2, (cw-20)/(rollW||100));
  const fontPx = fs*0.3528*scale*1.15;
  const totalH = vizRows*lh + (vizRows-1)*gapR;
  const porLinha = Math.max(0, Math.floor((rollW-mLeft+gapC)/(lw+gapC || 1)));

  async function salvarPadrao(){
    setSalvando(true); setMsg('');
    try{
      await supabase.from('etiqueta_layouts').update({padrao:false}).eq('padrao',true);
      if(layoutId){
        await supabase.from('etiqueta_layouts').update({params:lay,padrao:true,atualizado_em:new Date().toISOString()}).eq('id',layoutId);
      }else{
        const {data}=await supabase.from('etiqueta_layouts').insert({nome:'Padrão',params:lay,padrao:true}).select('id').single();
        if(data) setLayoutId(data.id);
      }
      setMsg('Salvo como padrão ✓');
    }catch(e){ setMsg('Erro ao salvar'); }
    setSalvando(false); setTimeout(()=>setMsg(''),2500);
  }

  async function baixarPDF(){
    try{
      const item={desc:smp.desc,ref:smp.ref,cor:smp.cor,tam:smp.tam,gtin};
      const perRow=Math.max(1,Math.round(cols));
      const n=Math.min(vizRows,20)*perRow; const items=[]; for(let i=0;i<n;i++) items.push(item);
      const pdf=await gerarPdfLote(lay, items);
      pdf.save(`etiqueta_rolo${rollW}_${lw}x${lh}.pdf`);
    }catch(e){ setMsg('Falha ao gerar PDF'); setTimeout(()=>setMsg(''),2500); }
  }

  const lblS={fontSize:11,color:C.muted2,display:'block',marginBottom:3};
  const card={border:`1px solid ${C.edge}`,borderRadius:12,padding:'10px 12px 12px',background:C.panel,marginBottom:12};
  const leg={color:C.blue,fontSize:10,textTransform:'uppercase',letterSpacing:2,fontWeight:700,marginBottom:6};
  const grid2={display:'grid',gridTemplateColumns:'1fr 1fr',gap:10};
  const Field=({label,children})=>(<div><label style={lblS}>{label}</label>{children}</div>);
  const N=({k,step})=>(<input type="number" value={lay[k]} step={step||0.5} onChange={set(k)} style={inpStyle}/>);

  const labels=[];
  for(let r=0;r<Math.max(1,Math.round(vizRows));r++){
    for(let c=0;c<Math.max(1,Math.round(cols));c++){
      const x=mLeft+c*(lw+gapC), y=r*(lh+gapR);
      if(x+lw>rollW+0.5) continue;
      labels.push(
        <div key={`${r}-${c}`} style={{position:'absolute',left:x*scale,top:y*scale,width:lw*scale,height:lh*scale,border:'1px dashed #c0b8b0',background:'#fff',color:C.navy,overflow:'hidden',padding:`${0.8*scale}px ${lat*scale}px`,boxSizing:'border-box',display:'flex',flexDirection:'column'}}>
          <div style={{fontSize:fontPx,fontWeight:700,lineHeight:1.05,textAlign:'left'}}>{dCur} {rTxt && <span style={{whiteSpace:'nowrap'}}>{rTxt}</span>}</div>
          <div style={{fontSize:fontPx,fontWeight:600,lineHeight:1.05,textAlign:'center',marginTop:scale}}>{t2}</div>
          <div style={{flex:1,minHeight:0,display:'flex',alignItems:'center',justifyContent:'center',marginTop:1}}>
            {bcUrl && <img src={bcUrl} alt="" style={{width:'100%',height:'85%'}}/>}
          </div>
        </div>
      );
    }
  }

  return (
    <div onClick={onClose} style={{position:'fixed',inset:0,background:'rgba(44,62,80,0.55)',display:'flex',alignItems:'flex-start',justifyContent:'center',padding:'28px 14px',zIndex:210,overflowY:'auto',backdropFilter:'blur(3px)'}}>
      <div onClick={e=>e.stopPropagation()} style={{background:C.bg,border:`1px solid ${C.edge}`,borderRadius:14,width:'100%',maxWidth:760,fontFamily:SERIF,color:C.navy,boxShadow:'0 18px 50px rgba(0,0,0,0.25)',overflow:'hidden'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'14px 18px',borderBottom:`1px solid ${C.sand}`,background:C.panel}}>
          <div>
            <div style={{fontSize:10,color:C.blue,letterSpacing:2,textTransform:'uppercase',fontWeight:700}}>Criar template</div>
            <div style={{fontSize:16,fontWeight:600,marginTop:2}}>Etiqueta — rolo {rollW}mm</div>
          </div>
          <span onClick={onClose} style={{fontSize:22,color:C.muted,cursor:'pointer',padding:6,lineHeight:1}}>×</span>
        </div>

        <div style={{padding:16}}>
          <div style={card}>
            <div style={leg}>Rolo</div>
            <div style={grid2}>
              <Field label="Largura do rolo (mm)"><N k="rollW" step={1}/></Field>
              <Field label="Linhas no preview"><input type="number" value={vizRows} step={1} onChange={e=>setVizRows(parseInt(e.target.value)||1)} style={inpStyle}/></Field>
            </div>
          </div>
          <div style={card}>
            <div style={leg}>Grade</div>
            <div style={grid2}>
              <Field label="Colunas"><N k="cols" step={1}/></Field>
              <Field label="Margem esquerda (mm)"><N k="mLeft"/></Field>
              <Field label="Gap colunas (mm)"><N k="gapC"/></Field>
              <Field label="Gap linhas (mm)"><N k="gapR"/></Field>
            </div>
          </div>
          <div style={card}>
            <div style={leg}>Etiqueta</div>
            <div style={grid2}>
              <Field label="Largura (mm)"><N k="lw"/></Field>
              <Field label="Altura (mm)"><N k="lh"/></Field>
              <Field label="Fonte texto (pt)"><N k="fs"/></Field>
              <Field label="Espaço lateral (mm)"><N k="lat"/></Field>
            </div>
          </div>
          <div style={card}>
            <div style={leg}>Conteúdo de exemplo</div>
            <div style={{marginBottom:8}}><label style={lblS}>Descrição</label><textarea value={smp.desc} onChange={setS('desc')} style={{...inpStyle,minHeight:44,resize:'vertical',lineHeight:1.3}}/></div>
            <div style={grid2}>
              <Field label="Ref"><input value={smp.ref} onChange={setS('ref')} style={inpStyle}/></Field>
              <Field label="GTIN (13 díg)"><input value={smp.gtin} onChange={setS('gtin')} placeholder={gtin} style={inpStyle}/></Field>
              <Field label="Cor"><input value={smp.cor} onChange={setS('cor')} style={inpStyle}/></Field>
              <Field label="Tamanho"><input value={smp.tam} onChange={setS('tam')} style={inpStyle}/></Field>
            </div>
          </div>

          <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:8}}>
            <div style={{fontSize:11,color:C.muted2,fontWeight:600}}>Pré-visualização do rolo</div>
            <div style={{fontSize:11,color:C.muted}}>{rollW}mm · {lw}×{lh}mm · {cols} por linha (cabe {porLinha})</div>
          </div>
          <div ref={wrapRef} style={{overflow:'auto',maxHeight:'46vh',display:'flex',justifyContent:'center',padding:10,background:'repeating-linear-gradient(45deg,#ece7df,#ece7df 8px,#f3efe8 8px,#f3efe8 16px)',border:`1px solid ${C.sand}`,borderRadius:8}}>
            <div style={{position:'relative',background:'#fff',width:rollW*scale,height:totalH*scale,boxShadow:'0 6px 22px rgba(44,62,80,.18)'}}>{labels}</div>
          </div>

          <div style={{display:'flex',gap:8,marginTop:14,alignItems:'center',flexWrap:'wrap'}}>
            <button onClick={salvarPadrao} disabled={salvando} style={{flex:1,minWidth:160,background:C.blue,color:'#fff',border:0,borderRadius:9,padding:12,fontFamily:SERIF,fontWeight:700,fontSize:14,cursor:'pointer',opacity:salvando?0.6:1}}>{salvando?'salvando…':'Salvar como padrão'}</button>
            <button onClick={baixarPDF} style={{flex:1,minWidth:160,background:'#fff',color:C.navy,border:`1px solid ${C.edge}`,borderRadius:9,padding:12,fontFamily:SERIF,fontWeight:700,fontSize:14,cursor:'pointer'}}>Baixar PDF tamanho real</button>
          </div>
          {msg && <div style={{marginTop:8,fontSize:12,color:msg.includes('✓')?C.green:C.red,textAlign:'center'}}>{msg}</div>}
          <div style={{marginTop:10,fontSize:11.5,color:C.muted2,lineHeight:1.5}}>O fundo riscado é a área fora do rolo (largura {rollW}mm). As linhas são só pra visualizar — no rolo a altura é contínua. Prova real = PDF impresso a 100%, medir e ajustar.</div>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// GERAR ETIQUETAS (lote, SKUs reais do gtin_map)
// ══════════════════════════════════════════════════════════════════
export function EtiquetaGerar({ sample, onClose }){
  const refDisp = sample?.ref ?? '';
  const refNorm = String(refDisp||'').replace(/^0+/,'') || '0';
  const desc = sample?.desc || '';
  const [lay,setLay]=useState(undefined); // undefined=carregando, null=sem template
  const [skus,setSkus]=useState([]);      // [{sku,gtin,cor,tam,qty}]
  const [loading,setLoading]=useState(true);
  const [tplOpen,setTplOpen]=useState(false);
  const [gerando,setGerando]=useState(false);
  const [msg,setMsg]=useState('');

  async function carregar(){
    setLoading(true);
    try{
      const {data:lrow}=await supabase.from('etiqueta_layouts').select('params').eq('padrao',true).order('atualizado_em',{ascending:false}).limit(1);
      setLay(lrow&&lrow[0] ? {...DEFAULT_LAYOUT,...(lrow[0].params||{})} : null);
      const {data}=await supabase.from('gtin_map').select('sku,gtin,cor,tam').eq('ref',refNorm).order('cor').order('tam');
      setSkus((data||[]).map(r=>({...r,qty:1})));
    }catch(e){ setLay(null); }
    setLoading(false);
  }
  useEffect(()=>{ carregar(); /* eslint-disable-next-line */ },[refNorm]);

  const total = skus.reduce((s,r)=>s+(r.qty||0),0);
  const setQty=(i,v)=>setSkus(p=>p.map((r,j)=>j===i?{...r,qty:Math.max(0,parseInt(v)||0)}:r));
  const setTodos=(v)=>{ const n=Math.max(0,parseInt(v)||0); setSkus(p=>p.map(r=>({...r,qty:n}))); };

  async function gerar(){
    if(!lay){ setMsg('Defina um template primeiro'); return; }
    const items=[];
    skus.forEach(r=>{ const q=r.qty||0; for(let k=0;k<q;k++) items.push({desc,ref:refDisp,cor:r.cor,tam:r.tam,gtin:r.gtin}); });
    if(!items.length){ setMsg('Defina ao menos 1 cópia'); setTimeout(()=>setMsg(''),2200); return; }
    setGerando(true); setMsg('');
    try{ const pdf=await gerarPdfLote(lay, items); pdf.save(`etiquetas_ref${refNorm}.pdf`); }
    catch(e){ setMsg('Falha ao gerar PDF'); }
    setGerando(false);
  }

  const th={background:C.blue,color:'#fff',fontSize:9,fontWeight:700,textTransform:'uppercase',letterSpacing:0.4,padding:'7px 10px',textAlign:'left'};
  const td={padding:'6px 10px',borderBottom:`1px solid ${C.sand}`,color:C.navy};

  return (
    <div onClick={onClose} style={{position:'fixed',inset:0,background:'rgba(44,62,80,0.55)',display:'flex',alignItems:'flex-start',justifyContent:'center',padding:'28px 14px',zIndex:200,overflowY:'auto',backdropFilter:'blur(3px)'}}>
      <div onClick={e=>e.stopPropagation()} style={{background:C.bg,border:`1px solid ${C.edge}`,borderRadius:14,width:'100%',maxWidth:620,fontFamily:SERIF,color:C.navy,boxShadow:'0 18px 50px rgba(0,0,0,0.25)',overflow:'hidden'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'14px 18px',borderBottom:`1px solid ${C.sand}`,background:C.panel,gap:10}}>
          <div>
            <div style={{fontSize:10,color:C.blue,letterSpacing:2,textTransform:'uppercase',fontWeight:700}}>Gerar etiquetas</div>
            <div style={{fontSize:16,fontWeight:600,marginTop:2}}>REF {refDisp} · {descCurta(desc)||'(sem descrição)'}</div>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <button onClick={()=>setTplOpen(true)} style={{background:'#fff',color:C.navy,border:`1px solid ${C.edge}`,borderRadius:8,padding:'7px 11px',fontSize:12,fontWeight:700,fontFamily:SERIF,cursor:'pointer',whiteSpace:'nowrap'}}>criar template</button>
            <span onClick={onClose} style={{fontSize:22,color:C.muted,cursor:'pointer',padding:6,lineHeight:1}}>×</span>
          </div>
        </div>

        <div style={{padding:16}}>
          {loading ? <div style={{color:C.muted2,fontSize:13,padding:'20px 0',textAlign:'center'}}>carregando…</div> :
           lay===null ? <div style={{background:'#fff8e8',border:'1px solid #f0d080',color:'#8a6500',borderRadius:10,padding:'14px 16px',fontSize:13,lineHeight:1.5}}>Nenhum template salvo ainda. Clique em <b>criar template</b> no topo, ajuste o layout e salve como padrão.</div> :
           skus.length===0 ? <div style={{background:'#fff8e8',border:'1px solid #f0d080',color:'#8a6500',borderRadius:10,padding:'14px 16px',fontSize:13,lineHeight:1.5}}>Essa ref ainda não tem código de barras gerado (gtin_map). Gere os GTINs dessa ref antes de imprimir.</div> :
           <>
            <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:10,flexWrap:'wrap'}}>
              <div style={{fontSize:12,color:C.muted2}}>{skus.length} variações com código</div>
              <div style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:6}}>
                <span style={{fontSize:12,color:C.muted2}}>qtd geral</span>
                <input type="number" min={0} defaultValue={1} onChange={e=>setTodos(e.target.value)} style={{...inpStyle,width:64}}/>
              </div>
            </div>
            <div style={{overflowX:'auto',border:`1px solid ${C.sand}`,borderRadius:8,maxHeight:'42vh'}}>
              <table style={{width:'100%',borderCollapse:'separate',borderSpacing:0,fontSize:12}}>
                <thead><tr><th style={th}>Cor</th><th style={th}>Tam</th><th style={{...th,textAlign:'right'}}>Cópias</th></tr></thead>
                <tbody>
                  {skus.map((r,i)=>(
                    <tr key={r.sku||i} style={{background:i%2?'#faf8f5':'#fff'}}>
                      <td style={{...td,fontWeight:600}}>{r.cor||'—'}</td>
                      <td style={{...td,fontFamily:"Calibri,'Segoe UI',Arial,sans-serif",fontWeight:700,color:C.blue}}>{r.tam||'—'}</td>
                      <td style={{...td,textAlign:'right'}}><input type="number" min={0} value={r.qty} onChange={e=>setQty(i,e.target.value)} style={{...inpStyle,width:64,textAlign:'right',padding:'5px 7px'}}/></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{display:'flex',alignItems:'center',gap:10,marginTop:14,flexWrap:'wrap'}}>
              <div style={{fontSize:13,color:C.navy}}>Total: <b style={{fontFamily:"Calibri,'Segoe UI',Arial,sans-serif",fontSize:18}}>{total}</b> etiqueta{total===1?'':'s'}</div>
              <button onClick={gerar} disabled={gerando||!total} style={{marginLeft:'auto',background:C.blue,color:'#fff',border:0,borderRadius:9,padding:'12px 22px',fontFamily:SERIF,fontWeight:700,fontSize:14,cursor:'pointer',opacity:(gerando||!total)?0.6:1}}>{gerando?'gerando…':'Gerar PDF'}</button>
            </div>
            {msg && <div style={{marginTop:8,fontSize:12,color:msg.includes('✓')?C.green:C.red,textAlign:'center'}}>{msg}</div>}
            <div style={{marginTop:10,fontSize:11.5,color:C.muted2,lineHeight:1.5}}>Usa o template salvo como padrão. Cada página do PDF = uma linha do rolo. Imprime a 100%.</div>
           </>}
        </div>
      </div>

      {tplOpen && <EtiquetaTemplate sample={{desc,ref:refDisp,cor:skus[0]?.cor,tam:skus[0]?.tam,gtin:skus[0]?.gtin}} onClose={()=>{ setTplOpen(false); carregar(); }}/>}
    </div>
  );
}
