/**
 * EtiquetaTemplate.jsx — Editor de template de etiqueta (rolo 100mm).
 *
 * Props:
 *   - sample: { desc, ref, cor, tam, gtin }  (pré-preenche o preview)
 *   - onClose: () => void
 *
 * Salva/lê o layout padrão na tabela public.etiqueta_layouts (padrao=true).
 * EAN-13 desenhado vetorial (próprio). PDF via jspdf carregado sob demanda (CDN).
 */
import { useState, useEffect, useMemo, useRef } from 'react';
import { supabase } from './supabase.js';

const SERIF = "Georgia,serif";
const C = { navy:"#2c3e50", blue:"#4a7fa5", muted:"#8a9aa4", muted2:"#6b7c8a", edge:"#c8d8e4", sand:"#e8e2da", soft:"#edf4fb", panel:"#fcfaf7", bg:"#f7f4f0" };

const DEFAULT_LAYOUT = { rollW:100, cols:2, mLeft:0, gapC:0, gapR:2, lw:50, lh:30, fs:7, lat:2 };
const PREPOS = new Set(['com','de','da','do','e','para','a','o','as','os','em','no','na']);

// ── EAN-13 (próprio) ──────────────────────────────────────────────
const L_=['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011'];
const G_=['0100111','0110011','0011011','0100001','0011101','0111001','0000101','0010001','0001001','0010111'];
const R_=['1110010','1100110','1101100','1000010','1011100','1001110','1010000','1000100','1001000','1110100'];
const PAR=['LLLLLL','LLGLGG','LLGGLG','LLGGGL','LGLLGG','LGGLLG','LGGGLL','LGLGLG','LGLGGL','LGGLGL'];
function ean13Check(d12){ let s=0; for(let i=0;i<12;i++) s+=(+d12[i])*(i%2?3:1); return String((10-s%10)%10); }
function gtinFromRef(ref){ const r=String(ref||'0').replace(/^0+/,'')||'0'; const base='2'+r.padStart(5,'0')+'000001'; return base+ean13Check(base); }
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
  return `data:image/svg+xml;utf8,${svg.replace(/#/g,'%23').replace(/</g,'%3C').replace(/>/g,'%3E')}`;
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

  const gtin = /^\d{13}$/.test(smp.gtin) ? smp.gtin : gtinFromRef(smp.ref);
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
      const { jsPDF } = await loadJsPDF();
      const pdf=new jsPDF({unit:'mm',format:[rollW,lh],orientation:rollW>lh?'landscape':'portrait'});
      const fsEff=fs*1.15, lineMm=fsEff*0.3528*1.25;
      const pages=Math.min(vizRows,20);
      for(let p=0;p<pages;p++){
        if(p>0) pdf.addPage([rollW,lh], rollW>lh?'landscape':'portrait');
        for(let c=0;c<cols;c++){
          const cx=mLeft+c*(lw+gapC); if(cx+lw>rollW+0.5) continue;
          const ix=cx+lat, iy=0.8;
          pdf.setTextColor(20,20,20); pdf.setFontSize(fsEff); pdf.setFont('helvetica','bold');
          const l1=wrapTitulo(pdf,dCur,rTxt,lw-2*lat);
          l1.forEach((ln,i)=>pdf.text(ln, ix, iy+i*lineMm+lineMm*0.8));
          const nL1=l1.length;
          pdf.setFont('helvetica','normal');
          pdf.text(t2, cx+lw/2, iy+nL1*lineMm+lineMm*0.8, {align:'center'});
          if(bits){
            const bcY=iy+(nL1+1)*lineMm+0.5;
            const fullH=Math.max(4,(lh-0.8)-bcY); const bcH=fullH*0.85;
            const bw=(lw-2*lat)/bits.length; const yTop=bcY+(fullH-bcH)/2;
            pdf.setFillColor(17,17,17);
            for(let i=0;i<bits.length;i++) if(bits[i]==='1') pdf.rect(ix+i*bw, yTop, bw, bcH, 'F');
          }
        }
      }
      pdf.save(`etiqueta_rolo${rollW}_${lw}x${lh}.pdf`);
    }catch(e){ setMsg('Falha ao gerar PDF'); setTimeout(()=>setMsg(''),2500); }
  }

  const inp={border:`1px solid ${C.edge}`,borderRadius:6,padding:'7px 9px',fontSize:14,fontFamily:SERIF,color:C.navy,background:'#fff',width:'100%',boxSizing:'border-box',outline:'none'};
  const lblS={fontSize:11,color:C.muted2,display:'block',marginBottom:3};
  const card={border:`1px solid ${C.edge}`,borderRadius:12,padding:'10px 12px 12px',background:C.panel,marginBottom:12};
  const leg={color:C.blue,fontSize:10,textTransform:'uppercase',letterSpacing:2,fontWeight:700,marginBottom:6};
  const grid2={display:'grid',gridTemplateColumns:'1fr 1fr',gap:10};
  const Field=({label,children})=>(<div><label style={lblS}>{label}</label>{children}</div>);
  const N=({k,step})=>(<input type="number" value={lay[k]} step={step||0.5} onChange={set(k)} style={inp}/>);

  // labels do preview
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
    <div onClick={onClose} style={{position:'fixed',inset:0,background:'rgba(44,62,80,0.55)',display:'flex',alignItems:'flex-start',justifyContent:'center',padding:'28px 14px',zIndex:200,overflowY:'auto',backdropFilter:'blur(3px)'}}>
      <div onClick={e=>e.stopPropagation()} style={{background:C.bg,border:`1px solid ${C.edge}`,borderRadius:14,width:'100%',maxWidth:760,fontFamily:SERIF,color:C.navy,boxShadow:'0 18px 50px rgba(0,0,0,0.25)',overflow:'hidden'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'14px 18px',borderBottom:`1px solid ${C.sand}`,background:C.panel}}>
          <div>
            <div style={{fontSize:10,color:C.blue,letterSpacing:2,textTransform:'uppercase',fontWeight:700}}>Criar template</div>
            <div style={{fontSize:16,fontWeight:600,marginTop:2}}>Etiqueta — rolo 100mm</div>
          </div>
          <span onClick={onClose} style={{fontSize:22,color:C.muted,cursor:'pointer',padding:6,lineHeight:1}}>×</span>
        </div>

        <div style={{padding:16}}>
          <div style={card}>
            <div style={leg}>Rolo</div>
            <div style={grid2}>
              <Field label="Largura do rolo (mm)"><N k="rollW" step={1}/></Field>
              <Field label="Linhas no preview"><input type="number" value={vizRows} step={1} onChange={e=>setVizRows(parseInt(e.target.value)||1)} style={inp}/></Field>
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
            <div style={{marginBottom:8}}><label style={lblS}>Descrição</label><textarea value={smp.desc} onChange={setS('desc')} style={{...inp,minHeight:44,resize:'vertical',lineHeight:1.3}}/></div>
            <div style={grid2}>
              <Field label="Ref"><input value={smp.ref} onChange={setS('ref')} style={inp}/></Field>
              <Field label="GTIN (13 díg)"><input value={smp.gtin} onChange={setS('gtin')} placeholder={gtin} style={inp}/></Field>
              <Field label="Cor"><input value={smp.cor} onChange={setS('cor')} style={inp}/></Field>
              <Field label="Tamanho"><input value={smp.tam} onChange={setS('tam')} style={inp}/></Field>
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
          {msg && <div style={{marginTop:8,fontSize:12,color:msg.includes('✓')?'#27ae60':'#c0392b',textAlign:'center'}}>{msg}</div>}
          <div style={{marginTop:10,fontSize:11.5,color:C.muted2,lineHeight:1.5}}>O fundo riscado é a área fora do rolo (largura {rollW}mm). As linhas são só pra visualizar — no rolo a altura é contínua. Prova real = PDF impresso a 100%, medir com régua e ajustar.</div>
        </div>
      </div>
    </div>
  );
}
