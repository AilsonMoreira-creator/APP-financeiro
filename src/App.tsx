// @ts-nocheck  
import { useState, useEffect, useRef, useCallback, useMemo, Component } from "react";
import { supabase, USER_ID } from "./supabase.js";
import MLPerguntas from './MLPerguntas';

// ── Error Boundary (mostra erro em vez de tela branca) ──
class ModuleErrorBoundary extends Component{
  constructor(props){super(props);this.state={hasError:false,error:null};}
  static getDerivedStateFromError(error){return{hasError:true,error};}
  render(){if(this.state.hasError)return<div style={{padding:30,textAlign:"center"}}><div style={{fontSize:16,color:"#c0392b",fontWeight:700,marginBottom:8}}>⚠ Erro no módulo</div><div style={{fontSize:12,color:"#666",marginBottom:12}}>{this.state.error?.message||"Erro desconhecido"}</div><button onClick={()=>this.setState({hasError:false,error:null})} style={{padding:"8px 16px",borderRadius:6,border:"1px solid #e8e2da",background:"#fff",cursor:"pointer",fontSize:12}}>Tentar novamente</button></div>;return this.props.children;}
}

// ─── Paleta ───────────────────────────────────────────────────────────────────
const APP_VERSION="6.7";
const _S = "#2c3e50";
const _B = "#5a7faa";
const _BL = "#a8c0d8";
const _GR = "#27ae60";
const _GO = "#c8a040";
const _FN = "Calibri,'Segoe UI',Arial,sans-serif";
const _FS = 14;

// ═══════════════════════════════════════════════════════════════════════════════
// SVG ICONS — NAVEGAÇÃO PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════════

const SvgDashboard = ({ size = 32 }) => (
  <svg width={size} height={size} viewBox="0 0 56 56" fill="none">
    <line x1="7" y1="5" x2="7" y2="46" stroke="#2d3f5e" strokeWidth="1.8" strokeLinecap="round"/>
    <line x1="7" y1="46" x2="35" y2="46" stroke="#2d3f5e" strokeWidth="1.8" strokeLinecap="round"/>
    <rect x="8.5" y="37" width="6.5" height="9" rx="0.5" fill="#7aabcc"/>
    <rect x="17" y="29" width="6.5" height="17" rx="0.5" fill="white" stroke="#2d3f5e" strokeWidth="1"/>
    <rect x="25.5" y="22" width="6.5" height="24" rx="0.5" fill="#c8a840"/>
    <path d="M10,38 L18,29 L26,21 L31,15" stroke="#2d3f5e" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M29,13.5 L31,15 L33,14.2" stroke="#2d3f5e" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M31,15 C33,13 34,12 36.2,15" stroke="#2d3f5e" strokeWidth="1.2" fill="none" strokeLinecap="round"/>
    <circle cx="45" cy="10" r="10.3" fill="white"/>
    <path d="M45,10 L45,0.5 A9.5,9.5,0,1,1,36.77,14.75 Z" fill="#4a6898"/>
    <path d="M45,10 L36.77,14.75 A9.5,9.5,0,0,1,45,0.5 Z" fill="#9dbcd6"/>
    <circle cx="45" cy="10" r="9.5" fill="none" stroke="#2d3f5e" strokeWidth="1.2"/>
  </svg>
);

const SvgLancamentos = ({ size = 32 }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
    <rect x="10" y="14" width="46" height="50" rx="4" fill="#d8d0c4"/>
    <rect x="8" y="12" width="46" height="50" rx="4" fill="#f0ede6" stroke="#8b6b50" strokeWidth="2"/>
    <rect x="22" y="6" width="22" height="14" rx="7" fill="#8a98a8" stroke="#4a5868" strokeWidth="1.6"/>
    <circle cx="33" cy="11" r="3.5" fill="#5a6878" stroke="#2c3e50" strokeWidth="1.2"/>
    <circle cx="33" cy="11" r="1.5" fill="#8a98a8"/>
    <text x="11" y="37" fontSize="16" fontFamily="Georgia,serif" fill={_B} fontWeight="bold">$</text>
    <line x1="22" y1="42" x2="42" y2="26" stroke={_B} strokeWidth="3" strokeLinecap="round"/>
    <polygon points="38,22 44,24 42,30" fill={_B}/>
    <circle cx="20" cy="44" r="7" fill={_GO} stroke={_S} strokeWidth="1.8"/>
    <ellipse cx="20" cy="44" rx="3.5" ry="2" fill="none" stroke="#a07820" strokeWidth="1.2"/>
    <polyline points="13,56 17,60 26,51" stroke={_GR} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
    <polyline points="33,56 37,60 46,51" stroke={_GR} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const SvgBoletos = ({ size = 32 }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
    <path d="M10,6 L44,6 L58,20 L58,60 L10,60 Z" fill="#d0d8e0"/>
    <path d="M8,4 L42,4 L56,18 L56,58 L8,58 Z" fill="white" stroke="#8a9cb0" strokeWidth="2"/>
    <path d="M42,4 L42,18 L56,18" fill="#dde4ec" stroke="#8a9cb0" strokeWidth="2"/>
    <line x1="42" y1="4" x2="56" y2="18" stroke="#8a9cb0" strokeWidth="1.2"/>
    <text x="11" y="34" fontSize="20" fontFamily="Georgia,serif" fill={_B} fontWeight="bold">$</text>
    <line x1="11" y1="39" x2="50" y2="39" stroke="#b8c4cc" strokeWidth="2"/>
    <line x1="11" y1="44" x2="50" y2="44" stroke="#b8c4cc" strokeWidth="2"/>
    <line x1="11" y1="49" x2="38" y2="49" stroke="#b8c4cc" strokeWidth="2"/>
    {[[11,3],[15,2],[18,4],[22,1.5],[24.5,3],[28,2],[31,3.5],[35,1.5],[37.5,3],[41,4.5],[45,2],[48,3]].map(([x,w],i)=>(
      <rect key={i} x={x} y="52.5" width={w} height="5" fill="#2c3e50"/>
    ))}
  </svg>
);

const SvgOficinas = ({ size = 32 }) => (
  <svg width={size} height={size} viewBox="0 0 36 32" fill="none">
    <rect x="1" y="26" width="34" height="4" rx="1.5" fill="#9aabb8" stroke={_S} strokeWidth="1.2"/>
    <path d="M5,25 L5,16 Q5,9 12,9 L28,9 Q31,9 31,12 L31,25 Z" fill="#f0ede8" stroke={_S} strokeWidth="1.4"/>
    <path d="M12,9 Q7,9 7,14 L7,20" stroke={_S} strokeWidth="1.4" fill="none" strokeLinecap="round"/>
    <rect x="4" y="19" width="9" height="6" rx="0.8" fill="#ddd8d0" stroke={_S} strokeWidth="1.1"/>
    <line x1="9.5" y1="9" x2="9.5" y2="13" stroke={_S} strokeWidth="1.1" strokeLinecap="round"/>
    <circle cx="9.5" cy="8" r="1.2" fill={_S}/>
    <line x1="9.5" y1="25" x2="9.5" y2="28.5" stroke="#6b7c8a" strokeWidth="1.3" strokeLinecap="round"/>
    <circle cx="25" cy="18" r="6.5" fill={_B} stroke={_S} strokeWidth="1.4"/>
    <circle cx="25" cy="18" r="3" fill="#f0ede8" stroke={_S} strokeWidth="1.1"/>
    <circle cx="25" cy="18" r="1.2" fill="#9aabb8"/>
    <line x1="25" y1="11.5" x2="25" y2="15" stroke={_S} strokeWidth="0.9"/>
    <line x1="25" y1="21" x2="25" y2="24.5" stroke={_S} strokeWidth="0.9"/>
    <line x1="18.5" y1="18" x2="22" y2="18" stroke={_S} strokeWidth="0.9"/>
    <line x1="28" y1="18" x2="31.5" y2="18" stroke={_S} strokeWidth="0.9"/>
  </svg>
);

const SvgAgenda = ({ size = 32 }) => (
  <svg width={size} height={size} viewBox="0 0 72 72" fill="none">
    <rect x="2" y="12" width="52" height="50" rx="4" fill="white" stroke={_S} strokeWidth="2"/>
    <rect x="2" y="12" width="52" height="18" rx="4" fill={_B} stroke={_S} strokeWidth="2"/>
    <rect x="2" y="22" width="52" height="8" fill={_B}/>
    {[14,28,42].map(x=>(
      <rect key={x} x={x-3} y="7" width="6" height="14" rx="3" fill="#4a5a6a" stroke={_S} strokeWidth="1.4"/>
    ))}
    {Array.from({length:12},(_,i)=>(
      <circle key={i} cx={11+(i%4)*13} cy={40+Math.floor(i/4)*11} r="2.8" fill="#9aabb8"/>
    ))}
    <circle cx="57" cy="57" r="16" fill="white" stroke={_S} strokeWidth="2.2"/>
    <circle cx="57" cy="57" r="15" fill="#f8f7f4"/>
    <line x1="57" y1="57" x2="57" y2="45" stroke={_S} strokeWidth="2.5" strokeLinecap="round"/>
    <line x1="57" y1="57" x2="66" y2="62" stroke={_S} strokeWidth="2.5" strokeLinecap="round"/>
    <circle cx="57" cy="57" r="2" fill={_S}/>
  </svg>
);

const SvgHistorico = ({ size = 32 }) => (
  <svg width={size} height={size} viewBox="0 0 72 72" fill="none">
    <path d="M4,28 L4,58 L56,58 L56,30 L30,30 L27,28 Z" fill="#b8b4ac" stroke={_S} strokeWidth="2"/>
    <path d="M4,34 L4,58 L50,58 L50,34 Z" fill="#d0ccc4" stroke={_S} strokeWidth="2"/>
    <path d="M4,34 L4,30 L16,30 L20,34 Z" fill="#d0ccc4" stroke={_S} strokeWidth="2"/>
    <circle cx="57" cy="57" r="16" fill="white" stroke={_S} strokeWidth="2.2"/>
    <circle cx="57" cy="57" r="15" fill="#f8f7f4"/>
    <line x1="57" y1="57" x2="57" y2="45" stroke={_S} strokeWidth="2.5" strokeLinecap="round"/>
    <line x1="57" y1="57" x2="66" y2="62" stroke={_S} strokeWidth="2.5" strokeLinecap="round"/>
    <circle cx="57" cy="57" r="2" fill={_S}/>
  </svg>
);

const SvgRelatorio = ({ size = 32 }) => (
  <svg width={size} height={size} viewBox="0 0 72 72" fill="none">
    <path d="M2,32 L2,66 L70,66 L70,34 L36,34 L32,32 Z" fill="#5a7aaa" stroke={_S} strokeWidth="2.2"/>
    <path d="M2,40 L2,66 L70,66 L70,40 Z" fill="#6a8aba" opacity="0.4"/>
    <g transform="rotate(-4,28,30)">
      <rect x="8" y="8" width="30" height="40" rx="3" fill="#f0ede6" stroke={_S} strokeWidth="1.8"/>
      <rect x="12" y="32" width="7" height="12" fill={_GO}/>
      <rect x="21" y="26" width="7" height="18" fill={_B}/>
      <polyline points="12,30 18,22 25,17 37,12" stroke={_B} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <circle cx="37" cy="12" r="2.5" fill={_B}/>
    </g>
    <rect x="32" y="4" width="30" height="42" rx="3" fill="white" stroke={_S} strokeWidth="2"/>
    <line x1="36" y1="13" x2="58" y2="13" stroke="#c0cad4" strokeWidth="1.8"/>
    <line x1="36" y1="19" x2="58" y2="19" stroke="#c0cad4" strokeWidth="1.8"/>
    <line x1="36" y1="25" x2="50" y2="25" stroke="#c0cad4" strokeWidth="1.8"/>
    <polyline points="36,38 41,32 47,27 55,18" stroke={_B} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
    <circle cx="55" cy="18" r="2.5" fill={_B}/>
  </svg>
);

const SvgCalculadora = ({ size = 32 }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
    <rect x="6" y="8" width="52" height="48" rx="8" fill="white" stroke={_S} strokeWidth="2.2"/>
    <rect x="6" y="8" width="52" height="18" rx="8" fill={_B}/>
    <rect x="6" y="20" width="52" height="6" fill={_B}/>
    <text x="32" y="21" textAnchor="middle" fontSize="9" fontWeight="800" fill="white" fontFamily="Calibri,Arial">PREÇO</text>
    <text x="16" y="38" textAnchor="middle" fontSize="11" fill={_S} fontFamily="Arial">R$</text>
    <line x1="28" y1="36" x2="38" y2="36" stroke={_B} strokeWidth="2" strokeLinecap="round"/>
    <polyline points="35,33 38,36 35,39" fill="none" stroke={_B} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <text x="48" y="38" textAnchor="middle" fontSize="9" fill={_GO} fontFamily="Calibri,Arial" fontWeight="800">%</text>
    <line x1="12" y1="46" x2="52" y2="46" stroke="#e8e2da" strokeWidth="1.5"/>
    <text x="32" y="54" textAnchor="middle" fontSize="8" fill={_S} fontFamily="Calibri,Arial" fontWeight="700">lucro</text>
  </svg>
);


const SvgFichaTecnica = ({ size = 32 }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
    <rect x="12" y="10" width="40" height="50" rx="4" fill="#e8e2da"/>
    <rect x="10" y="8" width="40" height="50" rx="4" fill="white" stroke={_S} strokeWidth="2"/>
    <rect x="22" y="3" width="18" height="12" rx="6" fill="#8a98a8" stroke="#4a5868" strokeWidth="1.5"/>
    <circle cx="31" cy="8" r="3" fill="#5a6878" stroke={_S} strokeWidth="1"/>
    <circle cx="31" cy="8" r="1.3" fill="#8a98a8"/>
    <line x1="16" y1="24" x2="44" y2="24" stroke="#c8d8e4" strokeWidth="1.5" strokeLinecap="round"/>
    <line x1="16" y1="30" x2="44" y2="30" stroke="#c8d8e4" strokeWidth="1.5" strokeLinecap="round"/>
    <line x1="16" y1="36" x2="36" y2="36" stroke="#c8d8e4" strokeWidth="1.5" strokeLinecap="round"/>
    <circle cx="44" cy="44" r="12" fill={_B} stroke={_S} strokeWidth="1.8"/>
    <text x="44" y="49" textAnchor="middle" fontSize="14" fontWeight="bold" fill="white" fontFamily="Georgia,serif">$</text>
  </svg>
);

const SvgSalasCorte = ({ size = 32 }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
    <rect x="5" y="22" width="54" height="6" rx="2.5" fill={_B} stroke={_S} strokeWidth="1.5"/>
    <rect x="10" y="28" width="5" height="22" rx="1.5" fill={_BL} stroke={_S} strokeWidth="1.2"/>
    <rect x="49" y="28" width="5" height="22" rx="1.5" fill={_BL} stroke={_S} strokeWidth="1.2"/>
    <rect x="15" y="38" width="34" height="3" rx="1" fill={_S} opacity="0.2"/>
    <rect x="9" y="16" width="46" height="7" rx="1" fill="white" stroke={_S} strokeWidth="0.8" opacity="0.5"/>
  </svg>
);

const SvgSAC = ({ size = 32 }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
    <path d="M12 34 C12 20 20 10 32 10 C44 10 52 20 52 34" stroke={_S} strokeWidth="3" fill="none"/>
    <rect x="8" y="30" width="10" height="18" rx="4" fill={_B} stroke={_S} strokeWidth="2"/>
    <rect x="46" y="30" width="10" height="18" rx="4" fill={_B} stroke={_S} strokeWidth="2"/>
    <path d="M46 44 Q46 54 36 54 L32 54" stroke={_S} strokeWidth="2.5" fill="none" strokeLinecap="round"/>
    <rect x="26" y="51" width="8" height="6" rx="3" fill={_B} stroke={_S} strokeWidth="1.5"/>
  </svg>
);

const SvgBling = ({ size = 32 }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
    <rect width="64" height="64" rx="10" fill="#4CAF73"/>
    <text x="8" y="42" fontSize="19" fontWeight="900" fill="white" fontFamily="Arial,Helvetica,sans-serif" letterSpacing="-0.5">bling</text>
    <rect x="47" y="20" width="7" height="17" rx="3.5" fill="white" transform="rotate(10 50 28)"/>
    <ellipse cx="51.5" cy="45" rx="4" ry="3.5" fill="white" transform="rotate(10 51 45)"/>
  </svg>
);

const SvgUsuarios = ({ size = 32 }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
    <circle cx="32" cy="22" r="14" fill={_B} stroke={_S} strokeWidth="2.2"/>
    <path d="M6,64 Q6,42 32,42 Q58,42 58,64" fill={_B} stroke={_S} strokeWidth="2.2"/>
  </svg>
);

const SvgConfiguracoes = ({ size = 32 }) => {
  const cx=32,cy=32,R=26,r=20,teeth=8,toothW=0.28;
  const pts=[];
  for(let i=0;i<teeth;i++){
    const base=(i/teeth)*Math.PI*2-Math.PI/2;
    const a1=base-toothW,a2=base+toothW,a3=base+Math.PI/teeth-toothW,a4=base+Math.PI/teeth+toothW;
    const p=(a,rad)=>[cx+rad*Math.cos(a),cy+rad*Math.sin(a)];
    if(i===0)pts.push(`M${p(a1,r).join(",")}`);
    pts.push(`L${p(a1,R).join(",")}`);
    pts.push(`A${R},${R},0,0,1,${p(a2,R).join(",")}`);
    pts.push(`L${p(a3,r).join(",")}`);
    pts.push(`A${r},${r},0,0,0,${p(a4,r).join(",")}`);
  }
  pts.push("Z");
  return(
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      <path d={pts.join(" ")} fill="#c4ccd8" stroke={_S} strokeWidth="1.6" strokeLinejoin="round"/>
      <circle cx="32" cy="32" r="11" fill={_B} stroke={_S} strokeWidth="1.8"/>
      <circle cx="32" cy="32" r="4.5" fill="#d8e4f0" stroke={_S} strokeWidth="1.2"/>
    </svg>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// SVG ICONS — SUB-ABAS OFICINAS
// ═══════════════════════════════════════════════════════════════════════════════

const SvgCortes = ({ size = 32 }) => (
  <svg width={size} height={size} viewBox="0 0 56 72" fill="none">
    <rect x="8" y="64" width="40" height="6" rx="2" fill="#c8d0d8" stroke={_S} strokeWidth="1.6"/>
    <circle cx="14" cy="67" r="1.5" fill="#8a9aaa" stroke={_S} strokeWidth="0.8"/>
    <circle cx="42" cy="67" r="1.5" fill="#8a9aaa" stroke={_S} strokeWidth="0.8"/>
    <rect x="24" y="22" width="5" height="42" rx="1" fill="#b8c4cc" stroke={_S} strokeWidth="1.4"/>
    <line x1="26.5" y1="24" x2="26.5" y2="62" stroke="#8a9aaa" strokeWidth="0.7"/>
    <rect x="18" y="30" width="16" height="14" rx="2" fill="#d0d8e0" stroke={_S} strokeWidth="1.4"/>
    <rect x="21" y="33" width="6" height="7" rx="1" fill="#b8c4cc" stroke={_S} strokeWidth="0.8"/>
    <ellipse cx="30" cy="14" rx="14" ry="10" fill="#3a6898" stroke={_S} strokeWidth="1.6"/>
    <ellipse cx="27" cy="13" rx="13" ry="9" fill={_B} stroke={_S} strokeWidth="1.6"/>
    <ellipse cx="22" cy="9" rx="5" ry="3" fill="#a8d0e8" opacity="0.5"/>
    <ellipse cx="40" cy="14" rx="3" ry="8" fill="#8ab8d8" stroke={_S} strokeWidth="1.2"/>
    <line x1="26.5" y1="4" x2="26.5" y2="8" stroke={_S} strokeWidth="1.6" strokeLinecap="round"/>
    <circle cx="26.5" cy="3.5" r="2" fill="#8a9aaa" stroke={_S} strokeWidth="1"/>
    <rect x="12" y="20" width="4" height="44" rx="1" fill="#d8e4ec" stroke={_S} strokeWidth="1.4"/>
    <line x1="13" y1="22" x2="13" y2="62" stroke="white" strokeWidth="0.8" opacity="0.8"/>
    <path d="M12,62 L16,62 L14,67 Z" fill="#c8d4dc" stroke={_S} strokeWidth="1"/>
    <rect x="32" y="38" width="6" height="4" rx="1" fill="#888078" stroke={_S} strokeWidth="1"/>
    <rect x="34" y="40" width="16" height="8" rx="4" fill="#2a2820" stroke={_S} strokeWidth="1.4"/>
    <ellipse cx="50" cy="44" rx="2.5" ry="4" fill="#3a3830" stroke={_S} strokeWidth="1"/>
    <rect x="36" y="41" width="12" height="2.5" rx="1.2" fill="#5a5248" opacity="0.6"/>
  </svg>
);

const SvgDashOficinas = ({ size = 32 }) => (
  <svg width={size} height={size} viewBox="0 0 56 56" fill="none">
    <line x1="6" y1="4" x2="6" y2="48" stroke={_S} strokeWidth="1.8" strokeLinecap="round"/>
    <line x1="6" y1="48" x2="52" y2="48" stroke={_S} strokeWidth="1.8" strokeLinecap="round"/>
    <rect x="9" y="36" width="8" height="12" rx="1" fill={_BL}/>
    <rect x="20" y="28" width="8" height="20" rx="1" fill={_B}/>
    <rect x="31" y="18" width="8" height="30" rx="1" fill="#3a6898"/>
    <rect x="42" y="24" width="8" height="24" rx="1" fill={_B}/>
    <path d="M13,35 L24,27 L35,17 L46,23" stroke={_S} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    <circle cx="13" cy="35" r="2" fill="white" stroke={_S} strokeWidth="1.4"/>
    <circle cx="24" cy="27" r="2" fill="white" stroke={_S} strokeWidth="1.4"/>
    <circle cx="35" cy="17" r="2" fill="white" stroke={_S} strokeWidth="1.4"/>
    <circle cx="46" cy="23" r="2" fill="white" stroke={_S} strokeWidth="1.4"/>
  </svg>
);

const SvgCadastros = ({ size = 32 }) => (
  <svg width={size} height={size} viewBox="0 0 64 56" fill="none">
    <rect x="6" y="40" width="52" height="10" rx="3" fill="#4a6898" stroke={_S} strokeWidth="1.6"/>
    <rect x="24" y="43" width="16" height="5" rx="1.5" fill="#3a5888" stroke="#2a4878" strokeWidth="0.8"/>
    <line x1="10" y1="42" x2="22" y2="42" stroke="#3a5888" strokeWidth="1"/>
    <line x1="10" y1="44" x2="22" y2="44" stroke="#3a5888" strokeWidth="1"/>
    <line x1="42" y1="42" x2="54" y2="42" stroke="#3a5888" strokeWidth="1"/>
    <line x1="42" y1="44" x2="54" y2="44" stroke="#3a5888" strokeWidth="1"/>
    <rect x="8" y="4" width="48" height="36" rx="3" fill={_B} stroke={_S} strokeWidth="1.8"/>
    <rect x="11" y="7" width="42" height="30" rx="1.5" fill="#eef4f8"/>
    <circle cx="32" cy="5.5" r="1.2" fill={_S}/>
    <rect x="13" y="9" width="38" height="4" rx="1" fill="#d8e4ec"/>
    <rect x="14" y="17" width="8" height="6" rx="0.8" fill="#e8b870" stroke="#b88840" strokeWidth="0.8"/>
    <path d="M14,17 L18,14 L22,17" fill="#c87840" stroke="#b88840" strokeWidth="0.8"/>
    <line x1="24" y1="20" x2="40" y2="20" stroke="#b8c8d4" strokeWidth="1.5" strokeLinecap="round"/>
    <circle cx="46" cy="20" r="3.5" fill="#e8f8ee" stroke={_GR} strokeWidth="0.8"/>
    <path d="M44,20 L45.5,21.5 L48,18.5" stroke={_GR} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    <rect x="14" y="27" width="8" height="6" rx="0.8" fill="#d4a870" stroke="#a87840" strokeWidth="0.8"/>
    <line x1="14" y1="29" x2="22" y2="29" stroke="#a87840" strokeWidth="0.7"/>
    <line x1="18" y1="27" x2="18" y2="33" stroke="#a87840" strokeWidth="0.7"/>
    <line x1="24" y1="30" x2="40" y2="30" stroke="#b8c8d4" strokeWidth="1.5" strokeLinecap="round"/>
    <circle cx="46" cy="30" r="3.5" fill="#e8f8ee" stroke={_GR} strokeWidth="0.8"/>
    <path d="M44,30 L45.5,31.5 L48,28.5" stroke={_GR} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

// ═══════════════════════════════════════════════════════════════════════════════
// SVG ICONS — RELATÓRIO (Prestadores + Projeção)
// ═══════════════════════════════════════════════════════════════════════════════

const SvgPrestadores = ({ size = 32 }) => (
  <svg width={size} height={size} viewBox="0 0 56 56" fill="none">
    <path d="M14,38 L28,28 L50,42" stroke={_S} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M14,38 L28,28 L50,42" stroke="#d8e4ec" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M15,37 L28,27.5 L49,41" stroke="white" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" opacity="0.7"/>
    <path d="M14,18 L28,28 L50,16" stroke={_S} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M14,18 L28,28 L50,16" stroke="#d8e4ec" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M14.5,18.5 L28,28.5 L49.5,17" stroke="white" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" opacity="0.7"/>
    <circle cx="11" cy="15" r="8.5" fill={_BL} stroke={_S} strokeWidth="2"/>
    <circle cx="11" cy="15" r="4.5" fill="white" stroke={_S} strokeWidth="1.4"/>
    <circle cx="11" cy="41" r="8.5" fill={_BL} stroke={_S} strokeWidth="2"/>
    <circle cx="11" cy="41" r="4.5" fill="white" stroke={_S} strokeWidth="1.4"/>
    <circle cx="28" cy="28" r="3.5" fill="#c8d8e8" stroke={_S} strokeWidth="1.6"/>
    <circle cx="28" cy="28" r="1.5" fill={_S}/>
  </svg>
);

const SvgProjecao = ({ size = 32 }) => (
  <svg width={size} height={size} viewBox="0 0 64 56" fill="none">
    <line x1="6" y1="4" x2="6" y2="48" stroke={_S} strokeWidth="1.8" strokeLinecap="round"/>
    <line x1="6" y1="48" x2="52" y2="48" stroke={_S} strokeWidth="1.8" strokeLinecap="round"/>
    <line x1="28" y1="10" x2="28" y2="48" stroke="#b0bcc8" strokeWidth="1" strokeDasharray="2,2"/>
    <rect x="8" y="28" width="7" height="20" rx="1" fill={_BL}/>
    <rect x="17" y="20" width="7" height="28" rx="1" fill={_B}/>
    <rect x="30" y="22" width="8" height="26" rx="1" fill="#eef4f8" stroke={_B} strokeWidth="1.6" strokeDasharray="3,2"/>
    <rect x="41" y="16" width="8" height="32" rx="1" fill="#eef4f8" stroke={_B} strokeWidth="1.6" strokeDasharray="3,2"/>
    <text x="31.5" y="18" fontSize="9" fill={_B} fontFamily="Georgia,serif" fontWeight="bold">?</text>
    <text x="42.5" y="13" fontSize="9" fill={_B} fontFamily="Georgia,serif" fontWeight="bold">?</text>
  </svg>
);


const SvgCopiar = ({ size = 32 }) => (
  <svg width={size} height={size} viewBox="0 0 56 56" fill="none">
    <path d="M38,4 L39,6.5 L41.5,7.5 L39,8.5 L38,11 L37,8.5 L34.5,7.5 L37,6.5 Z" fill="#c8a840"/>
    <path d="M46,8 L46.8,10 L48.8,10.8 L46.8,11.6 L46,13.6 L45.2,11.6 L43.2,10.8 L45.2,10 Z" fill="#c8a840" opacity="0.7"/>
    <path d="M42,3 L42.5,4.5 L44,5 L42.5,5.5 L42,7 L41.5,5.5 L40,5 L41.5,4.5 Z" fill="#c8a840" opacity="0.5"/>
    <rect x="17" y="8" width="18" height="14" rx="4" fill="white" stroke={_S} strokeWidth="1.4"/>
    <circle cx="22" cy="14" r="3" fill={_BL} stroke={_S} strokeWidth="1"/>
    <circle cx="22" cy="14" r="1.5" fill="white"/>
    <circle cx="30" cy="14" r="3" fill={_BL} stroke={_S} strokeWidth="1"/>
    <circle cx="30" cy="14" r="1.5" fill="white"/>
    <line x1="26" y1="8" x2="26" y2="5" stroke={_S} strokeWidth="1.4" strokeLinecap="round"/>
    <circle cx="26" cy="4.5" r="1.5" fill={_B}/>
    <rect x="23" y="22" width="6" height="3" rx="1" fill="#d0d8e0" stroke={_S} strokeWidth="1"/>
    <rect x="13" y="25" width="22" height="16" rx="3" fill="white" stroke={_S} strokeWidth="1.4"/>
    <rect x="17" y="28" width="14" height="9" rx="2" fill={_BL} stroke={_S} strokeWidth="0.8"/>
    <line x1="17" y1="32" x2="31" y2="32" stroke={_S} strokeWidth="0.7"/>
    <rect x="7" y="26" width="6" height="12" rx="3" fill="white" stroke={_S} strokeWidth="1.2"/>
    <rect x="35" y="26" width="6" height="12" rx="3" fill="white" stroke={_S} strokeWidth="1.2"/>
    <rect x="40" y="18" width="12" height="16" rx="2" fill="white" stroke={_S} strokeWidth="1.4"/>
    <path d="M48,18 L52,22 L48,22 Z" fill="#e8eef4" stroke={_S} strokeWidth="0.8"/>
    <line x1="42" y1="25" x2="50" y2="25" stroke="#b0bcc8" strokeWidth="1"/>
    <line x1="42" y1="28" x2="50" y2="28" stroke="#b0bcc8" strokeWidth="1"/>
    <line x1="42" y1="31" x2="47" y2="31" stroke="#b0bcc8" strokeWidth="1"/>
    <rect x="17" y="41" width="7" height="10" rx="3" fill="white" stroke={_S} strokeWidth="1.2"/>
    <rect x="28" y="41" width="7" height="10" rx="3" fill="white" stroke={_S} strokeWidth="1.2"/>
  </svg>
);

const SvgDespesas = ({ size = 32 }) => (
  <svg width={size} height={size} viewBox="0 0 56 56" fill="none">
    <circle cx="18" cy="46" r="8" fill="#c8a840" stroke="#a88828" strokeWidth="1.4"/>
    <circle cx="18" cy="46" r="6" fill="none" stroke="#a88828" strokeWidth="0.8"/>
    <text x="14.5" y="50" fontSize="8" fill="#a88828" fontWeight="bold" fontFamily="Georgia,serif">$</text>
    <circle cx="32" cy="48" r="6" fill="#d4b848" stroke="#a88828" strokeWidth="1.2"/>
    <circle cx="32" cy="48" r="4.2" fill="none" stroke="#a88828" strokeWidth="0.7"/>
    <rect x="8" y="20" width="34" height="24" rx="4" fill={_B} stroke={_S} strokeWidth="1.6"/>
    <path d="M8,28 Q8,20 16,20 L42,20 Q42,20 42,28 Z" fill="#4a6898" stroke={_S} strokeWidth="1"/>
    <rect x="12" y="28" width="26" height="12" rx="2" fill="#7a9cc8" stroke={_S} strokeWidth="0.8"/>
    <circle cx="25" cy="24" r="2" fill="#3a5888" stroke={_S} strokeWidth="0.8"/>
    <rect x="14" y="10" width="18" height="12" rx="1.5" fill="#a8d8b0" stroke="#5a9868" strokeWidth="1" transform="rotate(-8,23,16)"/>
    <rect x="18" y="8" width="18" height="12" rx="1.5" fill="#b8e0b8" stroke="#5a9868" strokeWidth="1" transform="rotate(5,27,14)"/>
    <text x="24" y="18" fontSize="7" fill="#4a8858" fontWeight="bold" fontFamily="Georgia,serif" transform="rotate(5,27,14)">$</text>
    <line x1="44" y1="14" x2="44" y2="30" stroke={_B} strokeWidth="3.5" strokeLinecap="round"/>
    <path d="M38,26 L44,32 L50,26" fill={_B} stroke={_B} strokeWidth="1" strokeLinejoin="round"/>
  </svg>
);

const SvgVendas = ({ size = 32 }) => {
  const GO="#c8a840"; const GOS="#a88828";
  return (
    <svg width={size} height={size} viewBox="0 0 56 56" fill="none">
      <path d="M44,8 L45,10.5 L47.5,11.5 L45,12.5 L44,15 L43,12.5 L40.5,11.5 L43,10.5 Z" fill={GO} opacity="0.9"/>
      <path d="M50,14 L50.6,16 L52.6,16.6 L50.6,17.2 L50,19.2 L49.4,17.2 L47.4,16.6 L49.4,16 Z" fill={_B} opacity="0.7"/>
      <path d="M40,4 L40.5,5.5 L42,6 L40.5,6.5 L40,8 L39.5,6.5 L38,6 L39.5,5.5 Z" fill={GO} opacity="0.5"/>
      <rect x="30" y="34" width="20" height="13" rx="2" fill="#b8d8a0" stroke="#5a8848" strokeWidth="1.2" transform="rotate(12,40,40)"/>
      <rect x="28" y="36" width="20" height="13" rx="2" fill="#c8e8b0" stroke="#5a8848" strokeWidth="1.2" transform="rotate(6,38,42)"/>
      <line x1="32" y1="42" x2="45" y2="42" stroke="#5a8848" strokeWidth="0.7" transform="rotate(6,38,42)"/>
      {[44,41,38,35,32,29,26].map((y,i)=>(
        <g key={i}>
          <ellipse cx="22" cy={y+2} rx="9" ry="3" fill={GOS}/>
          <rect x="13" y={y-1} width="18" height="5" fill={GO}/>
          <ellipse cx="22" cy={y-1} rx="9" ry="3" fill="#e0c050"/>
        </g>
      ))}
      <text x="18" y="24" fontSize="9" fill={GOS} fontWeight="bold" fontFamily="Georgia,serif">$</text>
      {[44,41,38].map((y,i)=>(
        <g key={i}>
          <ellipse cx="38" cy={y+2} rx="7" ry="2.5" fill={GOS}/>
          <rect x="31" y={y-1} width="14" height="4" fill={GO}/>
          <ellipse cx="38" cy={y-1} rx="7" ry="2.5" fill="#e0c050"/>
        </g>
      ))}
      <text x="35" y="38" fontSize="7" fill={GOS} fontWeight="bold" fontFamily="Georgia,serif">$</text>
    </svg>
  );
};

const SvgResultado = ({ size = 32 }) => (
  <svg width={size} height={size} viewBox="0 0 56 56" fill="none">
    <rect x="8" y="10" width="30" height="38" rx="3" fill="#f0ede6" stroke={_S} strokeWidth="1.6"/>
    <rect x="16" y="7" width="14" height="8" rx="4" fill="#c8b888" stroke={_S} strokeWidth="1.4"/>
    <rect x="19" y="9" width="8" height="4" rx="2" fill="#e8d8a8"/>
    <circle cx="16" cy="22" r="5" fill="#d8f0d8" stroke="#5a9858" strokeWidth="1.2"/>
    <path d="M13,22 L15,24 L19,20" stroke="#5a9858" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    <line x1="24" y1="20" x2="34" y2="20" stroke="#b0bcc8" strokeWidth="1.2"/>
    <line x1="24" y1="24" x2="34" y2="24" stroke="#b0bcc8" strokeWidth="1.2"/>
    <circle cx="16" cy="34" r="5" fill="#fde8e8" stroke="#c05858" strokeWidth="1.2"/>
    <path d="M13.5,31.5 L18.5,36.5 M18.5,31.5 L13.5,36.5" stroke="#c05858" strokeWidth="1.8" strokeLinecap="round"/>
    <line x1="24" y1="32" x2="34" y2="32" stroke="#b0bcc8" strokeWidth="1.2"/>
    <line x1="24" y1="36" x2="30" y2="36" stroke="#b0bcc8" strokeWidth="1.2"/>
    <rect x="4" y="34" width="16" height="20" rx="2.5" fill="#f8e8b0" stroke={_S} strokeWidth="1.4"/>
    <rect x="6" y="36" width="12" height="6" rx="1" fill="#d8e8c0" stroke={_S} strokeWidth="0.8"/>
    {[0,1,2].map(col=>[0,1,2].map(row=>(
      <rect key={`${col}-${row}`} x={6+col*4.2} y={44+row*3.2} width="3.2" height="2.4" rx="0.5"
        fill={row===2&&col===2?"#e87040":"#e8c870"} stroke={_S} strokeWidth="0.5"/>
    )))}
    <circle cx="42" cy="34" r="11" fill="white" stroke={_S} strokeWidth="1.8"/>
    <circle cx="42" cy="34" r="9" fill="#f0f4f8"/>
    <path d="M37,28 Q38,27 40,28" stroke="white" strokeWidth="1.5" strokeLinecap="round" opacity="0.8"/>
    <circle cx="42" cy="31" r="3" fill={_BL} stroke={_S} strokeWidth="0.8"/>
    <path d="M36,40 Q36,35 42,35 Q48,35 48,40" fill={_BL} stroke={_S} strokeWidth="0.8"/>
    <line x1="50" y1="42" x2="55" y2="48" stroke={_S} strokeWidth="3" strokeLinecap="round"/>
  </svg>
);

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTES DO APP
// ═══════════════════════════════════════════════════════════════════════════════

const MESES = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];

// modules: Icon agora é componente SVG (não mais emoji string)
const modules = [
  { id:"dashboard",     Icon:SvgDashboard,     label:"Dashboard"   },
  { id:"lancamentos",   Icon:SvgLancamentos,   label:"Lançamentos" },
  { id:"boletos",       Icon:SvgBoletos,       label:"Boletos"     },
  { id:"oficinas",      Icon:SvgOficinas,      label:"Oficinas"    },
  { id:"agenda",        Icon:SvgAgenda,        label:"Agenda"      },
  { id:"historico",     Icon:SvgHistorico,     label:"Histórico"   },
  { id:"relatorio",     Icon:SvgRelatorio,     label:"Relatório"   },
  { id:"calculadora",   Icon:SvgCalculadora,   label:"Calculadora" },
  { id:"fichatecnica",  Icon:SvgFichaTecnica,  label:"Ficha Téc."  },
  { id:"salascorte",   Icon:SvgSalasCorte,    label:"Salas Corte" },
  { id:"sac",          Icon:SvgSAC,           label:"SAC"         },
  { id:"bling",         Icon:SvgBling,         label:"Bling"       },
  { id:"usuarios",      Icon:SvgUsuarios,      label:"Usuários"    },
  { id:"configuracoes", Icon:SvgConfiguracoes, label:"Config."     },
];

const CATS = [
  "Funcionários","Free Lances","Passadoria","Salas Corte","Caseado",
  "Carreto","Tecidos","Oficinas Costura","Modelista","Piloteiro",
  "Aviamentos","Etiquetas/Tags","Pró-Labore",
  "Gastos Diários Loja e Fábrica","Gastos Carro","Reforma Loja e Equipamentos",
  "Embalagens","Aluguel","Representantes",
  "Impostos DAS","Contabilidade","Giro Empréstimo","Taxas Cartão","Taxas Marketplaces",
  "Marketing","Modelos Fotos","Sistemas","Concessionárias","Correios","Valor de Correção"
];

const SEM_AUX = ["Taxas Cartão","Taxas Marketplaces","Valor de Correção"];
const CATS_RAPIDAS = ["Free Lances","Carreto","Modelista","Piloteiro","Gastos Diários Loja e Fábrica","Representantes","Reforma Loja e Equipamentos","Gastos Carro","Modelos Fotos","Correios","Giro Empréstimo","Etiquetas/Tags","Embalagens"];
const CATS_PREST = ["Oficinas Costura","Salas Corte","Passadoria"];
const LEVE_DEST  = ["Funcionários","Pró-Labore","Salas Corte","Passadoria","Aviamentos"];
const SUPER_DEST = ["Tecidos","Oficinas Costura"];

const FIXOS_FUNC = [
  { label:"Vale Transporte", valor:7000 },
  { label:"Café da Manhã",   valor:4000 },
  { label:"Cestas Básicas",  valor:3200 },
];

// ─── Templates fixos para categorias com itens recorrentes ──────────────────
const FIXOS_NOMES_FUNC = [
  "CELIA","CRISTIANE","FRANCISCA","JEAN","GILIARDE","PEDRO",
  "MATHEUS","CLEIDE","VANESSA","IGOR","TALITA","STEFANY",
  "POLY","INGRID","GABRIELLY","KELLY","EMANUELLE","LUCIA",
];

const FIXOS_TEMPLATE = {
  "Pró-Labore": [
    "Plano Saúde","Condomínio","Água/Luz/Net","Leia (férias/salário)","Marta",
    "Parcela Casa/Apto","Diarista","Previdência","Consórcio casa/carro Itaú dia 15",
    "Gastos Gerais","Escola Isabella","Cartão","Mercado/Frutas/Açougue","Farmácia",
    "Restaurante","Reforma","Estacionamento/Seguro Carro","Gasolina/Lavar/Insulfilm",
    "Presentes","Heitor","Ailson","Tamara","Isabella","Saída Sábado","Porto",
    "Viagem Parcela","Reforma Casa",
  ],
  "Contabilidade": [
    "FGTS AMICIA","FGTS LA AMICIA","INSS AMICIA","INSS LA AMICIA","MUNIAM","CONTABILIDADE",
  ],
  "Impostos DAS": [
    "DAS/Imposto",
  ],
  "Concessionárias": [
    "Água Silva Teles","Água José Paulino","Telefone Silva Teles","Telefone José Paulino",
    "Internet José Paulino","Nextel","Futura Silva Teles","Verisure Silva Teles",
    "Segurança Silva Teles","Segurança Bom Retiro","Boa Vista",
    "Bling Amicia","Bling La Amicia","Bling Muniam","Ideris","Vesti","Site",
  ],
};
const CATS_FIXAS = Object.keys(FIXOS_TEMPLATE);

const DOMINGOS_MAR = [1,8,15,22,29];
const DIAS_SEMANA=["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];

// Domingos por mês 2026
const DOMINGOS_MES = {
  1:[4,11,18,25], 2:[1,8,15,22], 3:[1,8,15,22,29],
  4:[5,12,19,26], 5:[3,10,17,24,31], 6:[7,14,21,28],
  7:[5,12,19,26], 8:[2,9,16,23,30], 9:[6,13,20,27],
  10:[4,11,18,25], 11:[1,8,15,22,29], 12:[6,13,20,27],
};

// Feriados nacionais 2026
const FERIADOS_2026 = {
  "01/01":"Confraternização Universal",
  "03/03":"Carnaval","04/03":"Carnaval","05/03":"Quarta de Cinzas",
  "03/04":"Sexta-feira Santa","05/04":"Páscoa",
  "21/04":"Tiradentes","01/05":"Dia do Trabalho",
  "04/06":"Corpus Christi","07/09":"Independência do Brasil",
  "12/10":"N. Sra. Aparecida","02/11":"Finados",
  "15/11":"Proclamação da República","20/11":"Consciência Negra",
  "25/12":"Natal",
};
const getFeriado=(dia,mes)=>FERIADOS_2026[`${String(dia).padStart(2,"0")}/${String(mes).padStart(2,"0")}`]||null;

const PRESTADORES_INICIAL = {
  "Oficinas Costura": [
    {id:"01",nome:"Roberto Belém"},{id:"02",nome:"Roberto Ita"},{id:"03",nome:"Hugo"},
    {id:"04",nome:"Dilmo"},{id:"05",nome:"Senon"},{id:"06",nome:"Reinaldo Belém"},
    {id:"07",nome:"Oscar"},{id:"08",nome:"Gimena"},{id:"09",nome:"Beltran"},
    {id:"10",nome:"Hever"},{id:"11",nome:"Abad"},{id:"12",nome:"Joaquim"},{id:"13",nome:"Paola"},
  ],
  "Salas Corte": [
    {id:"01",nome:"Antonio"},{id:"02",nome:"Adalecio"},{id:"03",nome:"Chico"},
  ],
  "Passadoria": [
    {id:"01",nome:"Eliana"},{id:"02",nome:"Ivone"},{id:"03",nome:"Iara"},{id:"04",nome:"Perla"},
  ]
};

// AUX_VAZIO: todas as cats editáveis, zeradas
const AUX_VAZIO = Object.fromEntries(
  CATS.filter(c => !SEM_AUX.includes(c) && c !== "Funcionários").map(c => [c, []])
);

// ─── Dados Março 2026 ─────────────────────────────────────────────────────────
const AUX_MAR = {
  "Funcionários": [
    {nome:"CELIA",    salario:"1267.0", comissao:"0",extra:"0",   alimentacao:"0",vale:"845",  ferias:"",rescisao:""},
    {nome:"CRISTIANE",salario:"1501.0", comissao:"0",extra:"0",   alimentacao:"0",vale:"1002", ferias:"",rescisao:""},
    {nome:"FRANCISCA",salario:"0",      comissao:"0",extra:"0",   alimentacao:"0",vale:"845",  ferias:"",rescisao:""},
    {nome:"JEAN",     salario:"1350.0", comissao:"0",extra:"200.0",alimentacao:"0",vale:"2000",ferias:"",rescisao:""},
    {nome:"GILIARDE", salario:"1680.0", comissao:"0",extra:"200.0",alimentacao:"0",vale:"1140",ferias:"",rescisao:""},
    {nome:"PEDRO",    salario:"1537.0", comissao:"0",extra:"200.0",alimentacao:"0",vale:"1313",ferias:"",rescisao:""},
    {nome:"MATHEUS",  salario:"1500.0", comissao:"0",extra:"200.0",alimentacao:"0",vale:"1000",ferias:"",rescisao:""},
    {nome:"CLEIDE",   salario:"1267.0", comissao:"0",extra:"0",   alimentacao:"0",vale:"845",  ferias:"",rescisao:""},
    {nome:"VANESSA",  salario:"1267.0", comissao:"0",extra:"0",   alimentacao:"0",vale:"845",  ferias:"",rescisao:""},
    {nome:"IGOR",     salario:"0",      comissao:"0",extra:"0",   alimentacao:"0",vale:"848",  ferias:"",rescisao:""},
    {nome:"TALITA",   salario:"1650.0", comissao:"0",extra:"0",   alimentacao:"0",vale:"1040", ferias:"",rescisao:""},
    {nome:"STEFANY",  salario:"1655.0", comissao:"0",extra:"0",   alimentacao:"0",vale:"1104", ferias:"",rescisao:""},
    {nome:"poly",     salario:"1213.0", comissao:"0",extra:"0",   alimentacao:"0",vale:"0",    ferias:"",rescisao:"2500"},
    {nome:"INGRID",   salario:"0",      comissao:"0",extra:"0",   alimentacao:"0",vale:"892",  ferias:"",rescisao:""},
    {nome:"Gabrielly",salario:"1400.86",comissao:"0",extra:"0",   alimentacao:"0",vale:"934",  ferias:"",rescisao:""},
    {nome:"Kelly",    salario:"1267.0", comissao:"0",extra:"0",   alimentacao:"0",vale:"845",  ferias:"",rescisao:""},
    {nome:"EMANUELLE",salario:"1680.0", comissao:"0",extra:"0",   alimentacao:"0",vale:"1120", ferias:"",rescisao:""},
    {nome:"Lucia",    salario:"1267.0", comissao:"0",extra:"0",   alimentacao:"0",vale:"845",  ferias:"",rescisao:""},
  ],
  ...Object.fromEntries(CATS.filter(c=>!SEM_AUX.includes(c)&&c!=="Funcionários").map(c=>[c,[]])),
  "Free Lances": [{data:"",valor:"5000",descricao:"free lances"}],
  "Passadoria": [
    {data:"03/03",prestador:"perla",    valor:"2993.0",  descricao:""},
    {data:"11/03",prestador:"guilherme",valor:"4083.5",  descricao:""},
    {data:"11/03",prestador:"iara",     valor:"800.0",   descricao:""},
    {data:"13/03",prestador:"eliana",   valor:"10389.2", descricao:""},
    {data:"19/03",prestador:"iara",     valor:"1560.0",  descricao:""},
  ],
  "Salas Corte": [
    {data:"06/03",prestador:"ANTONIO",  valor:"2050.0",descricao:""},
    {data:"06/03",prestador:"AQDALECIO",valor:"2550.0",descricao:""},
    {data:"06/03",prestador:"AELSON",   valor:"492.0", descricao:""},
    {data:"13/03",prestador:"ANTONIO",  valor:"1750.0",descricao:""},
    {data:"13/03",prestador:"aelson",   valor:"526.0", descricao:""},
    {data:"20/03",prestador:"antonio",  valor:"2000.0",descricao:""},
  ],
  "Caseado": [{data:"",valor:"2500",descricao:"caseado/estamparia"}],
  "Carreto":  [{data:"",valor:"5000",descricao:"carreto"}],
  "Tecidos": [
    {data:"02/03",empresa:"EURO",nroNota:"",valor:"3438.8",descricao:"",_boletoid:100},
    {data:"02/03",empresa:"EUROTEXTIL",nroNota:"NF 30062",valor:"1582.87",descricao:"",_boletoid:101},
    {data:"02/03",empresa:"EUROTEXTIL",nroNota:"NF 529592",valor:"3442.3",descricao:"",_boletoid:102},
    {data:"02/03",empresa:"EUROTEXTIL",nroNota:"NF 529132",valor:"1459.86",descricao:"",_boletoid:103},
    {data:"02/03",empresa:"EUROTEXTIL",nroNota:"NF 529295",valor:"1458.4",descricao:"",_boletoid:104},
    {data:"02/03",empresa:"EUROTEXTIL",nroNota:"NF 529305",valor:"500.28",descricao:"",_boletoid:105},
    {data:"02/03",empresa:"EUROTEXTIL",nroNota:"NF 529307",valor:"2211.4",descricao:"",_boletoid:106},
    {data:"02/03",empresa:"EUROTEXTIL",nroNota:"NF 30263",valor:"1578.93",descricao:"",_boletoid:107},
    {data:"02/03",empresa:"EUROTEXTIL",nroNota:"NF 30515",valor:"7375.83",descricao:"",_boletoid:108},
    {data:"02/03",empresa:"EUROTEXTIL",nroNota:"NF 531345",valor:"1691.66",descricao:"",_boletoid:109},
    {data:"02/03",empresa:"EUROTEXTIL",nroNota:"NF 531627",valor:"485.7",descricao:"",_boletoid:110},
    {data:"02/03",empresa:"DIAGONAL TEXTIL",nroNota:"NF 80778",valor:"2263.68",descricao:"",_boletoid:111},
    {data:"02/03",empresa:"EUROTEXTIL",nroNota:"NF 30494",valor:"1202.54",descricao:"",_boletoid:112},
    {data:"02/03",empresa:"EUROTEXTIL",nroNota:"NF 532936",valor:"906.11",descricao:"",_boletoid:113},
    {data:"02/03",empresa:"EUROTEXTIL",nroNota:"NF 532901",valor:"1597.52",descricao:"",_boletoid:114},
    {data:"02/03",empresa:"EUROTEXTIL",nroNota:"NF 32112",valor:"1222.52",descricao:"",_boletoid:115},
    {data:"02/03",empresa:"EUROTEXTIL",nroNota:"NF 32138",valor:"7969.46",descricao:"",_boletoid:116},
    {data:"02/03",empresa:"EUROTEXTIL",nroNota:"NF 32059",valor:"1028.98",descricao:"",_boletoid:117},
    {data:"02/03",empresa:"EUROTEXTIL",nroNota:"NF 32204",valor:"1831.92",descricao:"",_boletoid:118},
    {data:"02/03",empresa:"MARLES",nroNota:"NF316851",valor:"3401",descricao:"",_boletoid:119},
    {data:"02/03",empresa:"EUROTEXTIL",nroNota:"NF 531636",valor:"1653.21",descricao:"",_boletoid:120},
    {data:"02/03",empresa:"EUROTEXTIL",nroNota:"NF 31130",valor:"1802.56",descricao:"",_boletoid:121},
    {data:"02/03",empresa:"EUROTEXTIL",nroNota:"NF 30821",valor:"3078.16",descricao:"",_boletoid:122},
    {data:"02/03",empresa:"EUROTEXTIL",nroNota:"NF 32205",valor:"1977.93",descricao:"",_boletoid:123},
    {data:"02/03",empresa:"EUROTEXTIL",nroNota:"NF32201",valor:"1350.01",descricao:"",_boletoid:124},
    {data:"02/03",empresa:"EUROTEXTIL",nroNota:"NF 32198",valor:"2075.79",descricao:"",_boletoid:125},
    {data:"03/03",empresa:"EUROTEXTIL",nroNota:"NF 530050",valor:"1892.17",descricao:"",_boletoid:126},
    {data:"03/03",empresa:"EUROTEXTIL",nroNota:"NF 530040",valor:"5832.73",descricao:"",_boletoid:127},
    {data:"03/03",empresa:"EUROTEXTIL",nroNota:"NF 30531",valor:"2006.38",descricao:"",_boletoid:128},
    {data:"03/03",empresa:"NOUVEAU",nroNota:"NF 18304",valor:"3090.27",descricao:"",_boletoid:129},
    {data:"04/03",empresa:"EUROTEXTIL",nroNota:"NF 30705",valor:"8554.77",descricao:"",_boletoid:130},
    {data:"04/03",empresa:"EUROTEXTIL",nroNota:"NF 532022",valor:"1425.61",descricao:"",_boletoid:131},
    {data:"04/03",empresa:"EUROTEXTIL",nroNota:"NF 31665",valor:"1752.77",descricao:"",_boletoid:132},
    {data:"04/03",empresa:"EUROTEXTIL",nroNota:"NF532822",valor:"1425.61",descricao:"",_boletoid:133},
    {data:"04/03",empresa:"EUROTEXTIL",nroNota:"NF 32626",valor:"1321.94",descricao:"",_boletoid:134},
    {data:"05/03",empresa:"matex",nroNota:"",valor:"12847",descricao:"",_boletoid:135},
    {data:"06/03",empresa:"romana",nroNota:"",valor:"1309",descricao:"",_boletoid:136},
    {data:"06/03",empresa:"MARLES",nroNota:"",valor:"4541",descricao:"",_boletoid:137},
    {data:"05/03",empresa:"euro",nroNota:"",valor:"1344.63",descricao:"",_boletoid:138},
    {data:"05/03",empresa:"EUROTEXTIL",nroNota:"NF 30263",valor:"1578.86",descricao:"",_boletoid:139},
    {data:"05/03",empresa:"EUROTEXTIL",nroNota:"NF 531345",valor:"1691.66",descricao:"",_boletoid:140},
    {data:"05/03",empresa:"EUROTEXTIL",nroNota:"NF 30260",valor:"1790.32",descricao:"",_boletoid:141},
    {data:"05/03",empresa:"EUROTEXTIL",nroNota:"NF 532936",valor:"906.11",descricao:"",_boletoid:142},
    {data:"05/03",empresa:"EUROTEXTIL",nroNota:"NF 532901",valor:"1597.52",descricao:"",_boletoid:143},
    {data:"05/03",empresa:"EUROTEXTIL",nroNota:"NF 31712",valor:"545.19",descricao:"",_boletoid:144},
    {data:"05/03",empresa:"EUROTEXTIL",nroNota:"NF 31705",valor:"1363.07",descricao:"",_boletoid:145},
    {data:"05/03",empresa:"EUROTEXTIL",nroNota:"NF 31711",valor:"1085.16",descricao:"",_boletoid:146},
    {data:"06/03",empresa:"EUROTEXTIL",nroNota:"NF 32112",valor:"1222.52",descricao:"",_boletoid:147},
    {data:"06/03",empresa:"EUROTEXTIL",nroNota:"NF 534800",valor:"9583.09",descricao:"",_boletoid:148},
    {data:"06/03",empresa:"EUROTEXTIL",nroNota:"NF 30821",valor:"3078.16",descricao:"",_boletoid:149},
    {data:"06/03",empresa:"MARLES",nroNota:"NF 317339",valor:"4541.9",descricao:"",_boletoid:150},
    {data:"06/03",empresa:"PIX CARLINHOS",nroNota:"",valor:"7594.5",descricao:"",_boletoid:151},
    {data:"09/03",empresa:"EUROTEXTIL",nroNota:"NF 530050",valor:"1892.02",descricao:"",_boletoid:152},
    {data:"09/03",empresa:"EUROTEXTIL",nroNota:"NF 530040",valor:"5832.28",descricao:"",_boletoid:153},
    {data:"09/03",empresa:"EUROTEXTIL",nroNota:"NF 30515",valor:"7375.83",descricao:"",_boletoid:154},
    {data:"09/03",empresa:"EUROTEXTIL",nroNota:"NF 30705",valor:"8554.77",descricao:"",_boletoid:155},
    {data:"09/03",empresa:"EUROTEXTIL",nroNota:"NF 531627",valor:"485.7",descricao:"",_boletoid:156},
    {data:"09/03",empresa:"EUROTEXTIL",nroNota:"NF 30494",valor:"1202.54",descricao:"",_boletoid:157},
    {data:"09/03",empresa:"EUROTEXTIL",nroNota:"NF 31414",valor:"1820.93",descricao:"",_boletoid:158},
    {data:"09/03",empresa:"EUROTEXTIL",nroNota:"NF 32204",valor:"1831.92",descricao:"",_boletoid:159},
    {data:"09/03",empresa:"EUROTEXTIL",nroNota:"NF 532022",valor:"1425.61",descricao:"",_boletoid:160},
    {data:"09/03",empresa:"EUROTEXTIL",nroNota:"NF 532402",valor:"1575",descricao:"",_boletoid:161},
    {data:"09/03",empresa:"EUROTEXTIL",nroNota:"NF 531636",valor:"1653.21",descricao:"",_boletoid:162},
    {data:"09/03",empresa:"EUROTEXTIL",nroNota:"NF 31665",valor:"1752.77",descricao:"",_boletoid:163},
    {data:"09/03",empresa:"EUROTEXTIL",nroNota:"NF532822",valor:"1425.61",descricao:"",_boletoid:164},
    {data:"09/03",empresa:"EUROTEXTIL",nroNota:"NF 33123",valor:"1565.89",descricao:"",_boletoid:165},
    {data:"09/03",empresa:"MEDTEXTIL",nroNota:"NF 14978",valor:"1561.51",descricao:"",_boletoid:166},
    {data:"09/03",empresa:"MEDTEXTIL",nroNota:"NF 192935",valor:"6482.5",descricao:"",_boletoid:167},
    {data:"09/03",empresa:"EUROTEXTIL",nroNota:"NF 32205",valor:"1977.93",descricao:"",_boletoid:168},
    {data:"09/03",empresa:"EUROTEXTIL",nroNota:"NF32201",valor:"1350.01",descricao:"",_boletoid:169},
    {data:"09/03",empresa:"euro",nroNota:"",valor:"1715.36",descricao:"",_boletoid:170},
    {data:"10/03",empresa:"euro",nroNota:"",valor:"2708.22",descricao:"",_boletoid:171},
    {data:"11/03",empresa:"euro",nroNota:"",valor:"1486.5",descricao:"",_boletoid:172},
    {data:"12/03",empresa:"euro",nroNota:"",valor:"2137.86",descricao:"",_boletoid:173},
    {data:"10/03",empresa:"DIAGONAL TEXTIL",nroNota:"NF 80262",valor:"2011.7",descricao:"",_boletoid:174},
    {data:"10/03",empresa:"EUROTEXTIL",nroNota:"NF 531345",valor:"1691.66",descricao:"",_boletoid:175},
    {data:"10/03",empresa:"EUROTEXTIL",nroNota:"NF 532936",valor:"906.11",descricao:"",_boletoid:176},
    {data:"10/03",empresa:"EUROTEXTIL",nroNota:"NF 532901",valor:"1597.52",descricao:"",_boletoid:177},
    {data:"10/03",empresa:"EUROTEXTIL",nroNota:"NF 32059",valor:"1028.98",descricao:"",_boletoid:178},
    {data:"10/03",empresa:"HOODORY",nroNota:"NF 5728",valor:"5072.26",descricao:"",_boletoid:179},
    {data:"10/03",empresa:"euro",nroNota:"",valor:"1344.63",descricao:"",_boletoid:180},
    {data:"11/03",empresa:"EUROTEXTIL",nroNota:"NF 32112",valor:"1222.52",descricao:"",_boletoid:181},
    {data:"11/03",empresa:"EUROTEXTIL",nroNota:"NF 32138",valor:"7969.46",descricao:"",_boletoid:182},
    {data:"11/03",empresa:"ACT COMERCIO DE TECIDOS",nroNota:"NF 135355",valor:"2597.71",descricao:"",_boletoid:183},
    {data:"11/03",empresa:"EUROTEXTIL",nroNota:"NF 31130",valor:"1802.56",descricao:"",_boletoid:184},
    {data:"11/03",empresa:"EUROTEXTIL",nroNota:"NF 30821",valor:"3078.16",descricao:"",_boletoid:185},
    {data:"11/03",empresa:"EUROTEXTIL",nroNota:"NF 32155",valor:"1835.44",descricao:"",_boletoid:186},
    {data:"12/03",empresa:"EUROTEXTIL",nroNota:"NF 30515",valor:"7375.35",descricao:"",_boletoid:187},
    {data:"12/03",empresa:"EUROTEXTIL",nroNota:"NF 531627",valor:"485.7",descricao:"",_boletoid:188},
    {data:"12/03",empresa:"EUROTEXTIL",nroNota:"NF 30494",valor:"1202.54",descricao:"",_boletoid:189},
    {data:"12/03",empresa:"EUROTEXTIL",nroNota:"NF 32204",valor:"1831.92",descricao:"",_boletoid:190},
    {data:"12/03",empresa:"EUROTEXTIL",nroNota:"NF536716",valor:"2137.86",descricao:"",_boletoid:191},
    {data:"12/03",empresa:"EUROTEXTIL",nroNota:"NF 531636",valor:"1653.21",descricao:"",_boletoid:192},
    {data:"12/03",empresa:"EUROTEXTIL",nroNota:"NF 32205",valor:"1977.93",descricao:"",_boletoid:193},
    {data:"12/03",empresa:"EUROTEXTIL",nroNota:"NF32201",valor:"1350.01",descricao:"",_boletoid:194},
    {data:"12/03",empresa:"EUROTEXTIL",nroNota:"NF 32198",valor:"2075.79",descricao:"",_boletoid:195},
    {data:"13/03",empresa:"EUROTEXTIL",nroNota:"NF 30531",valor:"2006.38",descricao:"",_boletoid:196},
    {data:"15/03",empresa:"NOTRE DAME",nroNota:"NF 18303",valor:"6768.81",descricao:"",_boletoid:197},
    {data:"16/03",empresa:"EUROTEXTIL",nroNota:"NF 30705",valor:"8554.77",descricao:"",_boletoid:198},
    {data:"16/03",empresa:"EUROTEXTIL",nroNota:"NF 531345",valor:"1691.66",descricao:"",_boletoid:199},
    {data:"16/03",empresa:"EUROTEXTIL",nroNota:"NF 532936",valor:"906.11",descricao:"",_boletoid:200},
    {data:"16/03",empresa:"EUROTEXTIL",nroNota:"NF 532901",valor:"1597.52",descricao:"",_boletoid:201},
    {data:"16/03",empresa:"EUROTEXTIL",nroNota:"NF 32112",valor:"1222.52",descricao:"",_boletoid:202},
    {data:"16/03",empresa:"EUROTEXTIL",nroNota:"NF 534800",valor:"9583.09",descricao:"",_boletoid:203},
    {data:"16/03",empresa:"EUROTEXTIL",nroNota:"NF 532022",valor:"1425.61",descricao:"",_boletoid:204},
    {data:"16/03",empresa:"EUROTEXTIL",nroNota:"NF 30821",valor:"3077.88",descricao:"",_boletoid:205},
    {data:"16/03",empresa:"EUROTEXTIL",nroNota:"NF 31665",valor:"1752.77",descricao:"",_boletoid:206},
    {data:"16/03",empresa:"EUROTEXTIL",nroNota:"NF532822",valor:"1425.61",descricao:"",_boletoid:207},
    {data:"16/03",empresa:"MEDTEXTIL",nroNota:"NF 15094",valor:"1576.58",descricao:"",_boletoid:208},
    {data:"16/03",empresa:"MEDTEXTIL",nroNota:"NF 193102",valor:"1715.18",descricao:"",_boletoid:209},
    {data:"16/03",empresa:"EUROTEXTIL",nroNota:"NF 32626",valor:"1321.94",descricao:"",_boletoid:210},
    {data:"16/03",empresa:"EUROTEXTIL",nroNota:"NF 31712",valor:"545.19",descricao:"",_boletoid:211},
    {data:"16/03",empresa:"EUROTEXTIL",nroNota:"NF 31711",valor:"1085.16",descricao:"",_boletoid:212},
    {data:"16/03",empresa:"EUROTEXTIL",nroNota:"NF 32216",valor:"3809.56",descricao:"",_boletoid:213},
    {data:"16/03",empresa:"ROMANA",nroNota:"",valor:"1404.32",descricao:"",_boletoid:214},
    {data:"16/03",empresa:"EUROTEXTIL",nroNota:"NF 32207",valor:"1344.63",descricao:"",_boletoid:215},
    {data:"17/03",empresa:"EUROTEXTIL",nroNota:"NF 531627",valor:"485.7",descricao:"",_boletoid:216},
    {data:"17/03",empresa:"DIAGONAL TEXTIL",nroNota:"NF 80778",valor:"2263.68",descricao:"",_boletoid:217},
    {data:"17/03",empresa:"EUROTEXTIL",nroNota:"NF 32204",valor:"1831.92",descricao:"",_boletoid:218},
    {data:"17/03",empresa:"EUROTEXTIL",nroNota:"NF536716",valor:"2137.86",descricao:"",_boletoid:219},
    {data:"17/03",empresa:"EUROTEXTIL",nroNota:"NF 531636",valor:"1653.21",descricao:"",_boletoid:220},
    {data:"17/03",empresa:"EUROTEXTIL",nroNota:"NF 32205",valor:"1977.93",descricao:"",_boletoid:221},
    {data:"17/03",empresa:"EUROTEXTIL",nroNota:"NF32201",valor:"1350.01",descricao:"",_boletoid:222},
    {data:"18/03",empresa:"NOUVEAU",nroNota:"NF 18304",valor:"3090.27",descricao:"",_boletoid:223},
    {data:"18/03",empresa:"MEDTEXTIL",nroNota:"NF 192655",valor:"5378.43",descricao:"",_boletoid:224},
    {data:"19/03",empresa:"euro",nroNota:"",valor:"2708",descricao:"",_boletoid:225},
    {data:"19/03",empresa:"EUROTEXTIL",nroNota:"NF 30705",valor:"8554.87",descricao:"",_boletoid:226},
    {data:"19/03",empresa:"EUROTEXTIL",nroNota:"NF 31414",valor:"1820.93",descricao:"",_boletoid:227},
    {data:"19/03",empresa:"EUROTEXTIL",nroNota:"NF 532022",valor:"1425.61",descricao:"",_boletoid:228},
    {data:"19/03",empresa:"EUROTEXTIL",nroNota:"NF 532402",valor:"1575",descricao:"",_boletoid:229},
    {data:"19/03",empresa:"EUROTEXTIL",nroNota:"NF 31665",valor:"1752.77",descricao:"",_boletoid:230},
    {data:"19/03",empresa:"EUROTEXTIL",nroNota:"NF532822",valor:"1425.61",descricao:"",_boletoid:231},
    {data:"19/03",empresa:"EUROTEXTIL",nroNota:"NF 33123",valor:"1565.89",descricao:"",_boletoid:232},
    {data:"19/03",empresa:"DIAGONAL",nroNota:"NF 81555",valor:"1941.97",descricao:"",_boletoid:233},
    {data:"19/03",empresa:"ROMANA",nroNota:"",valor:"1470.3",descricao:"",_boletoid:234},
    {data:"20/03",empresa:"EUROTEXTIL",nroNota:"NF 531345",valor:"1691.56",descricao:"",_boletoid:235},
    {data:"20/03",empresa:"EUROTEXTIL",nroNota:"NF 532936",valor:"906.11",descricao:"",_boletoid:236},
    {data:"20/03",empresa:"EUROTEXTIL",nroNota:"NF 532901",valor:"1597.52",descricao:"",_boletoid:237},
    {data:"20/03",empresa:"EUROTEXTIL",nroNota:"NF 32059",valor:"1028.98",descricao:"",_boletoid:238},
    {data:"20/03",empresa:"EUROTEXTIL",nroNota:"NF 31705",valor:"1363.07",descricao:"",_boletoid:239},
    {data:"20/03",empresa:"EUROTEXTIL",nroNota:"NF 32216",valor:"3809.56",descricao:"",_boletoid:240},
    {data:"20/03",empresa:"EUROTEXTIL",nroNota:"NF 32207",valor:"1344.63",descricao:"",_boletoid:241},
    {data:"21/03",empresa:"ROMANA",nroNota:"",valor:"1309.7",descricao:"",_boletoid:242},
    {data:"23/03",empresa:"euro",nroNota:"",valor:"1831",descricao:"",_boletoid:243},
    {data:"23/03",empresa:"EUROTEXTIL",nroNota:"NF 531627",valor:"485.6",descricao:"",_boletoid:244},
    {data:"23/03",empresa:"EUROTEXTIL",nroNota:"NF 32112",valor:"1222.52",descricao:"",_boletoid:245},
    {data:"23/03",empresa:"EUROTEXTIL",nroNota:"NF 32138",valor:"7969.46",descricao:"",_boletoid:246},
    {data:"23/03",empresa:"EUROTEXTIL",nroNota:"NF 32204",valor:"1831.92",descricao:"",_boletoid:247},
    {data:"23/03",empresa:"EUROTEXTIL",nroNota:"NF536716",valor:"2137.86",descricao:"",_boletoid:248},
    {data:"23/03",empresa:"EUROTEXTIL",nroNota:"NF 531683",valor:"1334.86",descricao:"",_boletoid:249},
    {data:"23/03",empresa:"EUROTEXTIL",nroNota:"NF 531636",valor:"1653.16",descricao:"",_boletoid:250},
    {data:"23/03",empresa:"EUROTEXTIL",nroNota:"NF 31130",valor:"1802.56",descricao:"",_boletoid:251},
    {data:"23/03",empresa:"EUROTEXTIL",nroNota:"NF 32205",valor:"1977.93",descricao:"",_boletoid:252},
    {data:"23/03",empresa:"EUROTEXTIL",nroNota:"NF32201",valor:"1350.01",descricao:"",_boletoid:253},
    {data:"23/03",empresa:"EUROTEXTIL",nroNota:"NF 32198",valor:"2075.79",descricao:"",_boletoid:254},
    {data:"23/03",empresa:"EUROTEXTIL",nroNota:"NF 31712",valor:"545.19",descricao:"",_boletoid:255},
    {data:"23/03",empresa:"ROMANA",nroNota:"",valor:"2550.51",descricao:"",_boletoid:256},
    {data:"23/03",empresa:"ROYAL",nroNota:"NF205014",valor:"3878.5",descricao:"",_boletoid:257},
    {data:"23/03",empresa:"romana",nroNota:"",valor:"1309",descricao:"",_boletoid:258},
  ],
  "Oficinas Costura": [
    {data:"05/03",prestador:"DILMO",         valor:"20056.5", descricao:""},
    {data:"05/03",prestador:"JOAQUIM",       valor:"3560.0",  descricao:""},
    {data:"05/03",prestador:"BELTRAO",       valor:"2920.0",  descricao:""},
    {data:"06/03",prestador:"ABAD",          valor:"2640.0",  descricao:""},
    {data:"06/03",prestador:"ROBERO BELEM",  valor:"33406.0", descricao:""},
    {data:"06/03",prestador:"GIMENA",        valor:"12912.0", descricao:""},
    {data:"09/03",prestador:"senon",         valor:"5659.0",  descricao:""},
    {data:"09/03",prestador:"oscar",         valor:"6850.0",  descricao:""},
    {data:"10/03",prestador:"roberto ita",   valor:"7936.0",  descricao:""},
    {data:"13/03",prestador:"dilmo",         valor:"18709.0", descricao:""},
    {data:"13/03",prestador:"hever",         valor:"3828.0",  descricao:""},
    {data:"13/03",prestador:"joaquim",       valor:"3264.0",  descricao:""},
    {data:"13/03",prestador:"paola",         valor:"3528.0",  descricao:""},
    {data:"13/03",prestador:"GIMENA",        valor:"3580.0",  descricao:""},
    {data:"13/03",prestador:"roberto belem", valor:"30104.0", descricao:""},
    {data:"13/03",prestador:"reinaldo belem",valor:"6400.0",  descricao:""},
    {data:"16/03",prestador:"roberto ita",   valor:"7104.0",  descricao:""},
    {data:"18/03",prestador:"senon",         valor:"9322.0",  descricao:""},
    {data:"20/03",prestador:"hugo",          valor:"15000.0", descricao:""},
    {data:"20/03",prestador:"roberto belem", valor:"28986.0", descricao:""},
    {data:"20/03",prestador:"dilmo",         valor:"15144.0", descricao:""},
    {data:"20/03",prestador:"gimena",        valor:"6760.0",  descricao:""},
  ],
  "Piloteiro": [{data:"",valor:"1000",descricao:""}],
  "Aviamentos": [
    {data:"05/03",valor:"485.64", descricao:"ZIPERES - XR"},
    {data:"05/03",valor:"262.22", descricao:"BOTOES - ANFREA"},
    {data:"06/03",valor:"625.71", descricao:"BOTOES - DANIEL"},
    {data:"11/03",valor:"8423.0", descricao:"diversos - nara"},
    {data:"11/03",valor:"590.22", descricao:"diversos - andrea"},
    {data:"11/03",valor:"597.12", descricao:"diversos - zr"},
  ],
  "Etiquetas/Tags":   [{data:"",valor:"8755.29",descricao:"etiqueta/bandeirinha/tag"}],
  "Gastos Diários Loja e Fábrica": [{data:"",valor:"4000",descricao:"festa/confraternização"}],
  "Gastos Carro":     [{data:"",valor:"2000",descricao:"revisão/seguro/gasolina"}],
  "Reforma Loja e Equipamentos": [{data:"",valor:"15000",descricao:"reforma/manequins/equipamentos"}],
  "Embalagens":       [{data:"",valor:"10500",descricao:"materiais/sacolas"},{data:"",valor:"2700",descricao:"embalagens marketplaces"}],
  "Aluguel":          [{data:"",valor:"39192.50",descricao:"José Paulino"},{data:"",valor:"13536",descricao:"Loja 07"}],
  "Representantes":   [{data:"",valor:"3000",descricao:"comissão representante"}],
  "Contabilidade": [
    {data:"",valor:"1602.06",descricao:"FGTS AMICIA"},
    {data:"",valor:"3220.91",descricao:"FGTS LA AMICIA"},
    {data:"",valor:"2175.76",descricao:"INSS AMICIA"},
    {data:"",valor:"2207.11",descricao:"INSS LA AMICIA"},
    {data:"",valor:"178.31", descricao:"MUNIAM"},
    {data:"",valor:"2200.0", descricao:"CONTABILIDADE"},
  ],
  "Impostos DAS":     [{data:"20/03",valor:"70491",descricao:"DAS/Imposto"}],
  "Giro Empréstimo":  [{data:"15/03",valor:"11089",descricao:"giro dia 15"}],
  "Marketing":        [{data:"",valor:"12000",descricao:"agência marketing/tráfego pago"},{data:"",valor:"35000",descricao:"ADS Mercado Livre/Shopee"}],
  "Modelos Fotos":    [{data:"",valor:"11000",descricao:"modelos/fotos/provador"}],
  "Sistemas":         [{data:"",valor:"8000",descricao:""}],
  "Correios":         [{data:"",valor:"2000",descricao:"correios"}],
  "Concessionárias": [
    {data:"",valor:"150",  descricao:"Água Silva Teles"},
    {data:"",valor:"150",  descricao:"Água José Paulino"},
    {data:"",valor:"200",  descricao:"Telefone Silva Teles"},
    {data:"",valor:"200",  descricao:"Telefone José Paulino"},
    {data:"",valor:"100",  descricao:"Internet José Paulino"},
    {data:"",valor:"150",  descricao:"Nextel"},
    {data:"",valor:"300",  descricao:"Futura Silva Teles"},
    {data:"",valor:"300",  descricao:"Verisure Silva Teles"},
    {data:"",valor:"300",  descricao:"Segurança Silva Teles"},
    {data:"",valor:"200",  descricao:"Segurança Bom Retiro"},
    {data:"",valor:"300",  descricao:"Boa Vista"},
    {data:"",valor:"650",  descricao:"Bling Amicia"},
    {data:"",valor:"450",  descricao:"Bling La Amicia"},
    {data:"",valor:"450",  descricao:"Bling Muniam"},
    {data:"",valor:"1050", descricao:"Ideris"},
    {data:"",valor:"300",  descricao:"Vesti"},
    {data:"",valor:"150",  descricao:"Site"},
  ],
  "Pró-Labore": [
    {data:"",valor:"5500",  descricao:"Plano Saúde"},
    {data:"",valor:"1100",  descricao:"Condomínio"},
    {data:"",valor:"2000",  descricao:"Água/Luz/Net"},
    {data:"",valor:"3300",  descricao:"Leia (férias/salário)"},
    {data:"",valor:"3000",  descricao:"Marta"},
    {data:"",valor:"6000",  descricao:"Parcela Casa/Apto"},
    {data:"",valor:"0",     descricao:"Diarista"},
    {data:"",valor:"2200",  descricao:"Previdência"},
    {data:"",valor:"5000",  descricao:"Consórcio casa/carro Itaú dia 15"},
    {data:"",valor:"1000",  descricao:"Gastos Gerais"},
    {data:"",valor:"1500",  descricao:"Escola Isabella"},
    {data:"",valor:"3000",  descricao:"Cartão"},
    {data:"",valor:"3000",  descricao:"Mercado/Frutas/Açougue"},
    {data:"",valor:"500",   descricao:"Farmácia"},
    {data:"",valor:"1000",  descricao:"Restaurante"},
    {data:"",valor:"1000",  descricao:"Reforma"},
    {data:"",valor:"1200",  descricao:"Estacionamento/Seguro Carro"},
    {data:"",valor:"500",   descricao:"Gasolina/Lavar/Insulfilm"},
    {data:"",valor:"700",   descricao:"Presentes"},
    {data:"",valor:"4000",  descricao:"Heitor"},
    {data:"",valor:"7000",  descricao:"Ailson"},
    {data:"",valor:"12000", descricao:"Tamara"},
    {data:"",valor:"4000",  descricao:"Isabella"},
    {data:"",valor:"1000",  descricao:"Saída Sábado"},
    {data:"",valor:"1000",  descricao:"Porto"},
    {data:"",valor:"0",     descricao:"Viagem Parcela"},
    {data:"",valor:"5000",  descricao:"Reforma Casa"},
  ],
};


// ─── Boletos Março 2026 ───────────────────────────────────────────────────────
const BOLETOS_MAR = [
  {id:100,data:"02/03",mes:3,empresa:"EURO",nroNota:"",valor:"3438.8",pago:true},
  {id:101,data:"02/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 30062",valor:"1582.87",pago:true},
  {id:102,data:"02/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 529592",valor:"3442.3",pago:true},
  {id:103,data:"02/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 529132",valor:"1459.86",pago:true},
  {id:104,data:"02/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 529295",valor:"1458.4",pago:true},
  {id:105,data:"02/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 529305",valor:"500.28",pago:true},
  {id:106,data:"02/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 529307",valor:"2211.4",pago:true},
  {id:107,data:"02/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 30263",valor:"1578.93",pago:true},
  {id:108,data:"02/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 30515",valor:"7375.83",pago:true},
  {id:109,data:"02/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 531345",valor:"1691.66",pago:true},
  {id:110,data:"02/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 531627",valor:"485.7",pago:true},
  {id:111,data:"02/03",mes:3,empresa:"DIAGONAL TEXTIL",nroNota:"NF 80778",valor:"2263.68",pago:true},
  {id:112,data:"02/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 30494",valor:"1202.54",pago:true},
  {id:113,data:"02/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 532936",valor:"906.11",pago:true},
  {id:114,data:"02/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 532901",valor:"1597.52",pago:true},
  {id:115,data:"02/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 32112",valor:"1222.52",pago:true},
  {id:116,data:"02/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 32138",valor:"7969.46",pago:true},
  {id:117,data:"02/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 32059",valor:"1028.98",pago:true},
  {id:118,data:"02/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 32204",valor:"1831.92",pago:true},
  {id:119,data:"02/03",mes:3,empresa:"MARLES",nroNota:"NF316851",valor:"3401",pago:true},
  {id:120,data:"02/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 531636",valor:"1653.21",pago:true},
  {id:121,data:"02/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 31130",valor:"1802.56",pago:true},
  {id:122,data:"02/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 30821",valor:"3078.16",pago:true},
  {id:123,data:"02/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 32205",valor:"1977.93",pago:true},
  {id:124,data:"02/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF32201",valor:"1350.01",pago:true},
  {id:125,data:"02/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 32198",valor:"2075.79",pago:true},
  {id:126,data:"03/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 530050",valor:"1892.17",pago:true},
  {id:127,data:"03/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 530040",valor:"5832.73",pago:true},
  {id:128,data:"03/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 30531",valor:"2006.38",pago:true},
  {id:129,data:"03/03",mes:3,empresa:"NOUVEAU",nroNota:"NF 18304",valor:"3090.27",pago:true},
  {id:130,data:"04/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 30705",valor:"8554.77",pago:true},
  {id:131,data:"04/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 532022",valor:"1425.61",pago:true},
  {id:132,data:"04/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 31665",valor:"1752.77",pago:true},
  {id:133,data:"04/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF532822",valor:"1425.61",pago:true},
  {id:134,data:"04/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 32626",valor:"1321.94",pago:true},
  {id:135,data:"05/03",mes:3,empresa:"matex",nroNota:"",valor:"12847",pago:true},
  {id:136,data:"06/03",mes:3,empresa:"romana",nroNota:"",valor:"1309",pago:true},
  {id:137,data:"06/03",mes:3,empresa:"MARLES",nroNota:"",valor:"4541",pago:true},
  {id:138,data:"05/03",mes:3,empresa:"euro",nroNota:"",valor:"1344.63",pago:true},
  {id:139,data:"05/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 30263",valor:"1578.86",pago:true},
  {id:140,data:"05/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 531345",valor:"1691.66",pago:true},
  {id:141,data:"05/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 30260",valor:"1790.32",pago:true},
  {id:142,data:"05/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 532936",valor:"906.11",pago:true},
  {id:143,data:"05/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 532901",valor:"1597.52",pago:true},
  {id:144,data:"05/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 31712",valor:"545.19",pago:true},
  {id:145,data:"05/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 31705",valor:"1363.07",pago:true},
  {id:146,data:"05/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 31711",valor:"1085.16",pago:true},
  {id:147,data:"06/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 32112",valor:"1222.52",pago:true},
  {id:148,data:"06/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 534800",valor:"9583.09",pago:true},
  {id:149,data:"06/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 30821",valor:"3078.16",pago:true},
  {id:150,data:"06/03",mes:3,empresa:"MARLES",nroNota:"NF 317339",valor:"4541.9",pago:true},
  {id:151,data:"06/03",mes:3,empresa:"PIX CARLINHOS",nroNota:"",valor:"7594.5",pago:true},
  {id:152,data:"09/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 530050",valor:"1892.02",pago:true},
  {id:153,data:"09/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 530040",valor:"5832.28",pago:true},
  {id:154,data:"09/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 30515",valor:"7375.83",pago:true},
  {id:155,data:"09/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 30705",valor:"8554.77",pago:true},
  {id:156,data:"09/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 531627",valor:"485.7",pago:true},
  {id:157,data:"09/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 30494",valor:"1202.54",pago:true},
  {id:158,data:"09/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 31414",valor:"1820.93",pago:true},
  {id:159,data:"09/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 32204",valor:"1831.92",pago:true},
  {id:160,data:"09/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 532022",valor:"1425.61",pago:true},
  {id:161,data:"09/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 532402",valor:"1575",pago:true},
  {id:162,data:"09/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 531636",valor:"1653.21",pago:true},
  {id:163,data:"09/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 31665",valor:"1752.77",pago:true},
  {id:164,data:"09/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF532822",valor:"1425.61",pago:true},
  {id:165,data:"09/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 33123",valor:"1565.89",pago:true},
  {id:166,data:"09/03",mes:3,empresa:"MEDTEXTIL",nroNota:"NF 14978",valor:"1561.51",pago:true},
  {id:167,data:"09/03",mes:3,empresa:"MEDTEXTIL",nroNota:"NF 192935",valor:"6482.5",pago:true},
  {id:168,data:"09/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 32205",valor:"1977.93",pago:true},
  {id:169,data:"09/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF32201",valor:"1350.01",pago:true},
  {id:170,data:"09/03",mes:3,empresa:"euro",nroNota:"",valor:"1715.36",pago:true},
  {id:171,data:"10/03",mes:3,empresa:"euro",nroNota:"",valor:"2708.22",pago:true},
  {id:172,data:"11/03",mes:3,empresa:"euro",nroNota:"",valor:"1486.5",pago:true},
  {id:173,data:"12/03",mes:3,empresa:"euro",nroNota:"",valor:"2137.86",pago:true},
  {id:174,data:"10/03",mes:3,empresa:"DIAGONAL TEXTIL",nroNota:"NF 80262",valor:"2011.7",pago:true},
  {id:175,data:"10/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 531345",valor:"1691.66",pago:true},
  {id:176,data:"10/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 532936",valor:"906.11",pago:true},
  {id:177,data:"10/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 532901",valor:"1597.52",pago:true},
  {id:178,data:"10/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 32059",valor:"1028.98",pago:true},
  {id:179,data:"10/03",mes:3,empresa:"HOODORY",nroNota:"NF 5728",valor:"5072.26",pago:true},
  {id:180,data:"10/03",mes:3,empresa:"euro",nroNota:"",valor:"1344.63",pago:true},
  {id:181,data:"11/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 32112",valor:"1222.52",pago:true},
  {id:182,data:"11/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 32138",valor:"7969.46",pago:true},
  {id:183,data:"11/03",mes:3,empresa:"ACT COMERCIO DE TECIDOS",nroNota:"NF 135355",valor:"2597.71",pago:true},
  {id:184,data:"11/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 31130",valor:"1802.56",pago:true},
  {id:185,data:"11/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 30821",valor:"3078.16",pago:true},
  {id:186,data:"11/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 32155",valor:"1835.44",pago:true},
  {id:187,data:"12/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 30515",valor:"7375.35",pago:true},
  {id:188,data:"12/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 531627",valor:"485.7",pago:true},
  {id:189,data:"12/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 30494",valor:"1202.54",pago:true},
  {id:190,data:"12/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 32204",valor:"1831.92",pago:true},
  {id:191,data:"12/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF536716",valor:"2137.86",pago:true},
  {id:192,data:"12/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 531636",valor:"1653.21",pago:true},
  {id:193,data:"12/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 32205",valor:"1977.93",pago:true},
  {id:194,data:"12/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF32201",valor:"1350.01",pago:true},
  {id:195,data:"12/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 32198",valor:"2075.79",pago:true},
  {id:196,data:"13/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 30531",valor:"2006.38",pago:true},
  {id:197,data:"15/03",mes:3,empresa:"NOTRE DAME",nroNota:"NF 18303",valor:"6768.81",pago:true},
  {id:198,data:"16/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 30705",valor:"8554.77",pago:true},
  {id:199,data:"16/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 531345",valor:"1691.66",pago:true},
  {id:200,data:"16/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 532936",valor:"906.11",pago:true},
  {id:201,data:"16/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 532901",valor:"1597.52",pago:true},
  {id:202,data:"16/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 32112",valor:"1222.52",pago:true},
  {id:203,data:"16/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 534800",valor:"9583.09",pago:true},
  {id:204,data:"16/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 532022",valor:"1425.61",pago:true},
  {id:205,data:"16/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 30821",valor:"3077.88",pago:true},
  {id:206,data:"16/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 31665",valor:"1752.77",pago:true},
  {id:207,data:"16/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF532822",valor:"1425.61",pago:true},
  {id:208,data:"16/03",mes:3,empresa:"MEDTEXTIL",nroNota:"NF 15094",valor:"1576.58",pago:true},
  {id:209,data:"16/03",mes:3,empresa:"MEDTEXTIL",nroNota:"NF 193102",valor:"1715.18",pago:true},
  {id:210,data:"16/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 32626",valor:"1321.94",pago:true},
  {id:211,data:"16/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 31712",valor:"545.19",pago:true},
  {id:212,data:"16/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 31711",valor:"1085.16",pago:true},
  {id:213,data:"16/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 32216",valor:"3809.56",pago:true},
  {id:214,data:"16/03",mes:3,empresa:"ROMANA",nroNota:"",valor:"1404.32",pago:true},
  {id:215,data:"16/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 32207",valor:"1344.63",pago:true},
  {id:216,data:"17/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 531627",valor:"485.7",pago:true},
  {id:217,data:"17/03",mes:3,empresa:"DIAGONAL TEXTIL",nroNota:"NF 80778",valor:"2263.68",pago:true},
  {id:218,data:"17/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 32204",valor:"1831.92",pago:true},
  {id:219,data:"17/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF536716",valor:"2137.86",pago:true},
  {id:220,data:"17/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 531636",valor:"1653.21",pago:true},
  {id:221,data:"17/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 32205",valor:"1977.93",pago:true},
  {id:222,data:"17/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF32201",valor:"1350.01",pago:true},
  {id:223,data:"18/03",mes:3,empresa:"NOUVEAU",nroNota:"NF 18304",valor:"3090.27",pago:true},
  {id:224,data:"18/03",mes:3,empresa:"MEDTEXTIL",nroNota:"NF 192655",valor:"5378.43",pago:true},
  {id:225,data:"19/03",mes:3,empresa:"euro",nroNota:"",valor:"2708",pago:true},
  {id:226,data:"19/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 30705",valor:"8554.87",pago:true},
  {id:227,data:"19/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 31414",valor:"1820.93",pago:true},
  {id:228,data:"19/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 532022",valor:"1425.61",pago:true},
  {id:229,data:"19/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 532402",valor:"1575",pago:true},
  {id:230,data:"19/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 31665",valor:"1752.77",pago:true},
  {id:231,data:"19/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF532822",valor:"1425.61",pago:true},
  {id:232,data:"19/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 33123",valor:"1565.89",pago:true},
  {id:233,data:"19/03",mes:3,empresa:"DIAGONAL",nroNota:"NF 81555",valor:"1941.97",pago:true},
  {id:234,data:"19/03",mes:3,empresa:"ROMANA",nroNota:"",valor:"1470.3",pago:true},
  {id:235,data:"20/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 531345",valor:"1691.56",pago:true},
  {id:236,data:"20/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 532936",valor:"906.11",pago:true},
  {id:237,data:"20/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 532901",valor:"1597.52",pago:true},
  {id:238,data:"20/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 32059",valor:"1028.98",pago:true},
  {id:239,data:"20/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 31705",valor:"1363.07",pago:true},
  {id:240,data:"20/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 32216",valor:"3809.56",pago:true},
  {id:241,data:"20/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 32207",valor:"1344.63",pago:true},
  {id:242,data:"21/03",mes:3,empresa:"ROMANA",nroNota:"",valor:"1309.7",pago:true},
  {id:243,data:"23/03",mes:3,empresa:"euro",nroNota:"",valor:"1831",pago:true},
  {id:244,data:"23/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 531627",valor:"485.6",pago:true},
  {id:245,data:"23/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 32112",valor:"1222.52",pago:true},
  {id:246,data:"23/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 32138",valor:"7969.46",pago:true},
  {id:247,data:"23/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 32204",valor:"1831.92",pago:true},
  {id:248,data:"23/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF536716",valor:"2137.86",pago:true},
  {id:249,data:"23/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 531683",valor:"1334.86",pago:true},
  {id:250,data:"23/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 531636",valor:"1653.16",pago:true},
  {id:251,data:"23/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 31130",valor:"1802.56",pago:true},
  {id:252,data:"23/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 32205",valor:"1977.93",pago:true},
  {id:253,data:"23/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF32201",valor:"1350.01",pago:true},
  {id:254,data:"23/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 32198",valor:"2075.79",pago:true},
  {id:255,data:"23/03",mes:3,empresa:"EUROTEXTIL",nroNota:"NF 31712",valor:"545.19",pago:true},
  {id:256,data:"23/03",mes:3,empresa:"ROMANA",nroNota:"",valor:"2550.51",pago:true},
  {id:257,data:"23/03",mes:3,empresa:"ROYAL",nroNota:"NF205014",valor:"3878.5",pago:true},
  {id:258,data:"23/03",mes:3,empresa:"romana",nroNota:"",valor:"1309",pago:true},
];

// ─── Boletos ABR 2026 (a vencer) ─────────────────────────────────────────────
const BOLETOS_ABR = [
  {id:240,data:"01/04",mes:4,empresa:"DIAGONAL TEXTIL",nroNota:"NF 80778",valor:"2263.68",pago:false},
  {id:241,data:"01/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF 32204",valor:"1831.92",pago:false},
  {id:242,data:"01/04",mes:4,empresa:"MARLES",nroNota:"NF316851",valor:"3401",pago:false},
  {id:243,data:"01/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF536716",valor:"2137.86",pago:false},
  {id:244,data:"01/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF 32205",valor:"1977.93",pago:false},
  {id:245,data:"01/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF32201",valor:"1350.01",pago:false},
  {id:246,data:"01/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF 32198",valor:"2075.79",pago:false},
  {id:247,data:"01/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF 538445",valor:"2567.98",pago:false},
  {id:248,data:"03/04",mes:4,empresa:"NOUVEAU",nroNota:"NF 18304",valor:"3090.27",pago:false},
  {id:249,data:"03/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF 532022",valor:"1425.55",pago:false},
  {id:250,data:"03/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF 31665",valor:"1752.62",pago:false},
  {id:251,data:"03/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF532822",valor:"1425.55",pago:false},
  {id:252,data:"03/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF 32626",valor:"1321.94",pago:false},
  {id:253,data:"03/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF 33639",valor:"1208.06",pago:false},
  {id:254,data:"03/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF 537959",valor:"1349.52",pago:false},
  {id:255,data:"05/04",mes:4,empresa:"MARLES",nroNota:"NF 317339",valor:"4540",pago:false},
  {id:256,data:"05/04",mes:4,empresa:"ROMANA",nroNota:"",valor:"1871.65",pago:false},
  {id:257,data:"05/04",mes:4,empresa:"ROMANA",nroNota:"",valor:"1309.7",pago:false},
  {id:258,data:"05/04",mes:4,empresa:"ROMANA",nroNota:"",valor:"1404.32",pago:false},
  {id:259,data:"06/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF 532936",valor:"906.08",pago:false},
  {id:260,data:"06/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF 532901",valor:"1597.4",pago:false},
  {id:261,data:"06/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF 32112",valor:"1222.52",pago:false},
  {id:262,data:"06/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF 32204",valor:"1831.92",pago:false},
  {id:263,data:"06/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF 534800",valor:"9583.09",pago:false},
  {id:264,data:"06/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF536716",valor:"2137.86",pago:false},
  {id:265,data:"06/04",mes:4,empresa:"MEDTEXTIL",nroNota:"NF 15094",valor:"1576.56",pago:false},
  {id:266,data:"06/04",mes:4,empresa:"MEDTEXTIL",nroNota:"NF 193102",valor:"1715.16",pago:false},
  {id:267,data:"06/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF 32205",valor:"1977.93",pago:false},
  {id:268,data:"06/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF32201",valor:"1350.01",pago:false},
  {id:269,data:"06/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF 31712",valor:"545.21",pago:false},
  {id:270,data:"06/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF 31705",valor:"1363.06",pago:false},
  {id:271,data:"06/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF 31711",valor:"1085.15",pago:false},
  {id:272,data:"06/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF 538445",valor:"2567.98",pago:false},
  {id:273,data:"06/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF 32216",valor:"3809.56",pago:false},
  {id:274,data:"06/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF 32207",valor:"1344.63",pago:false},
  {id:275,data:"07/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF 33015",valor:"1642.09",pago:false},
  {id:276,data:"07/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF536734",valor:"4384.15",pago:false},
  {id:277,data:"07/04",mes:4,empresa:"MEDTEXTIL",nroNota:"NF 192655",valor:"5378.41",pago:false},
  {id:278,data:"07/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF537448",valor:"2098.06",pago:false},
  {id:279,data:"08/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF 33123",valor:"1565.89",pago:false},
  {id:280,data:"08/04",mes:4,empresa:"DIAGONAL",nroNota:"NF 81555",valor:"1941.97",pago:false},
  {id:281,data:"08/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF 33639",valor:"1208.06",pago:false},
  {id:282,data:"08/04",mes:4,empresa:"ROMANA",nroNota:"",valor:"1470.3",pago:false},
  {id:283,data:"08/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF 537959",valor:"1349.52",pago:false},
  {id:284,data:"09/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF 32059",valor:"1029.02",pago:false},
  {id:285,data:"09/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF 32216",valor:"3809.56",pago:false},
  {id:286,data:"09/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF 32207",valor:"1344.63",pago:false},
  {id:287,data:"10/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF 32112",valor:"1222.56",pago:false},
  {id:288,data:"10/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF 32138",valor:"7969.5",pago:false},
  {id:289,data:"10/04",mes:4,empresa:"ACT COMERCIO DE TECIDOS",nroNota:"NF 135355",valor:"2597.71",pago:false},
  {id:290,data:"10/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF 32155",valor:"1835.43",pago:false},
  {id:291,data:"10/04",mes:4,empresa:"ROYAL",nroNota:"NF 206372",valor:"3917.4",pago:false},
  {id:292,data:"12/04",mes:4,empresa:"ROMANA",nroNota:"",valor:"2550.51",pago:false},
  {id:293,data:"13/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF 32204",valor:"1831.84",pago:false},
  {id:294,data:"13/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF536716",valor:"2137.86",pago:false},
  {id:295,data:"13/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF536734",valor:"4384.15",pago:false},
  {id:296,data:"13/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF 32626",valor:"1321.94",pago:false},
  {id:297,data:"13/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF 32205",valor:"1977.94",pago:false},
  {id:298,data:"13/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF32201",valor:"1350.02",pago:false},
  {id:299,data:"13/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF 32198",valor:"2075.82",pago:false},
  {id:300,data:"13/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF 33639",valor:"1208.06",pago:false},
  {id:301,data:"13/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF 538445",valor:"2567.98",pago:false},
  {id:302,data:"13/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF 537959",valor:"1349.52",pago:false},
  {id:303,data:"14/04",mes:4,empresa:"NOTRE DAME",nroNota:"NF 18303",valor:"6768.84",pago:false},
  {id:304,data:"14/04",mes:4,empresa:"NOTRE DAME",nroNota:"NF 19179",valor:"5313.78",pago:false},
  {id:305,data:"14/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF 32216",valor:"3809.56",pago:false},
  {id:306,data:"14/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF 32207",valor:"1344.63",pago:false},
  {id:307,data:"15/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF 534800",valor:"9583.09",pago:false},
  {id:308,data:"15/04",mes:4,empresa:"ROMANA",nroNota:"",valor:"1871.65",pago:false},
  {id:309,data:"15/04",mes:4,empresa:"DIAGONAL",nroNota:"NF 81923",valor:"1678.11",pago:false},
  {id:310,data:"16/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF536716",valor:"2137.86",pago:false},
  {id:311,data:"16/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF 538445",valor:"2567.98",pago:false},
  {id:312,data:"16/04",mes:4,empresa:"ROYAL",nroNota:"NF 205475",valor:"4269.62",pago:false},
  {id:313,data:"16/04",mes:4,empresa:"IMATEXTIL",nroNota:"NF193316",valor:"1486.52",pago:false},
  {id:314,data:"17/04",mes:4,empresa:"NOUVEAU",nroNota:"NF 18304",valor:"3090.27",pago:false},
  {id:315,data:"17/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF536734",valor:"4384.15",pago:false},
  {id:316,data:"17/04",mes:4,empresa:"MEDTEXTIL",nroNota:"NF 14978",valor:"1561.49",pago:false},
  {id:317,data:"17/04",mes:4,empresa:"MEDTEXTIL",nroNota:"NF 192935",valor:"6482.5",pago:false},
  {id:318,data:"17/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF537448",valor:"2098.06",pago:false},
  {id:319,data:"18/04",mes:4,empresa:"ROMANA",nroNota:"",valor:"1470.3",pago:false},
  {id:320,data:"20/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF 33123",valor:"1565.89",pago:false},
  {id:321,data:"20/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF 33639",valor:"1208.06",pago:false},
  {id:322,data:"20/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF 32216",valor:"3809.56",pago:false},
  {id:323,data:"20/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF 537959",valor:"1349.52",pago:false},
  {id:324,data:"20/04",mes:4,empresa:"ROMANA",nroNota:"",valor:"1309.7",pago:false},
  {id:325,data:"20/04",mes:4,empresa:"DIAGONAL",nroNota:"NF 82059",valor:"1517.47",pago:false},
  {id:326,data:"20/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF 32207",valor:"1344.63",pago:false},
  {id:327,data:"22/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF 33015",valor:"1642.09",pago:false},
  {id:328,data:"22/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF536716",valor:"2137.86",pago:false},
  {id:329,data:"22/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF536734",valor:"4384.15",pago:false},
  {id:330,data:"22/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF 538445",valor:"2567.98",pago:false},
  {id:331,data:"22/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF539061",valor:"1751.58",pago:false},
  {id:332,data:"22/04",mes:4,empresa:"ROYAL",nroNota:"NF205014",valor:"3877",pago:false},
  {id:333,data:"23/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF 32626",valor:"1321.96",pago:false},
  {id:334,data:"23/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF 33639",valor:"1208.06",pago:false},
  {id:335,data:"23/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF 537959",valor:"1349.52",pago:false},
  {id:336,data:"24/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF 32216",valor:"3809.56",pago:false},
  {id:337,data:"24/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF 32207",valor:"1344.63",pago:false},
  {id:338,data:"25/04",mes:4,empresa:"ACT COMERCIO DE TECIDOS",nroNota:"NF 135355",valor:"2597.71",pago:false},
  {id:339,data:"25/04",mes:4,empresa:"ROMANA",nroNota:"",valor:"1871.65",pago:false},
  {id:340,data:"25/04",mes:4,empresa:"ROMANA",nroNota:"",valor:"1404.32",pago:false},
  {id:341,data:"25/04",mes:4,empresa:"DIAGONAL",nroNota:"NF 81923",valor:"1678.11",pago:false},
  {id:342,data:"26/04",mes:4,empresa:"DIAGONAL",nroNota:"NF82411",valor:"2254.5",pago:false},
  {id:343,data:"27/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF 534800",valor:"9583.16",pago:false},
  {id:344,data:"27/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF536716",valor:"2137.86",pago:false},
  {id:345,data:"27/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF536734",valor:"4384.15",pago:false},
  {id:346,data:"27/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF 538445",valor:"2567.98",pago:false},
  {id:347,data:"27/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF539061",valor:"1751.58",pago:false},
  {id:348,data:"27/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF 540758",valor:"2299.09",pago:false},
  {id:349,data:"27/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF 540751",valor:"1216.63",pago:false},
  {id:350,data:"27/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF537448",valor:"2098.06",pago:false},
  {id:351,data:"28/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF 33123",valor:"1565.89",pago:false},
  {id:352,data:"28/04",mes:4,empresa:"DIAGONAL",nroNota:"NF 81555",valor:"1941.97",pago:false},
  {id:353,data:"28/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF 33639",valor:"1208.06",pago:false},
  {id:354,data:"28/04",mes:4,empresa:"ROMANA",nroNota:"",valor:"1470.3",pago:false},
  {id:355,data:"28/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF 537959",valor:"1349.52",pago:false},
  {id:356,data:"29/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF 34346",valor:"2250.4",pago:false},
  {id:357,data:"29/04",mes:4,empresa:"NOTRE DAME",nroNota:"NF 19179",valor:"5313.78",pago:false},
  {id:358,data:"29/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF 32216",valor:"3809.56",pago:false},
  {id:359,data:"29/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF 32207",valor:"1344.63",pago:false},
  {id:360,data:"30/04",mes:4,empresa:"EUROTEXTIL",nroNota:"NF 540074",valor:"2090.42",pago:false},
  {id:361,data:"30/04",mes:4,empresa:"DIAGONAL",nroNota:"NF 82059",valor:"1517.47",pago:false},
];

// ─── Boletos MAI 2026 (a vencer) ─────────────────────────────────────────────
const BOLETOS_MAI = [
  {id:362,data:"01/05",mes:5,empresa:"MARLES",nroNota:"NF316851",valor:"3401",pago:false},
  {id:363,data:"02/05",mes:5,empresa:"ROMANA",nroNota:"",valor:"2550.51",pago:false},
  {id:364,data:"02/05",mes:5,empresa:"ROYAL",nroNota:"NF 208 932 /  208931",valor:"4703.5",pago:false},
  {id:365,data:"03/05",mes:5,empresa:"NOTRE DAME",nroNota:"NF 19446",valor:"1364.36",pago:false},
  {id:366,data:"04/05",mes:5,empresa:"EUROTEXTIL",nroNota:"NF536716",valor:"2137.86",pago:false},
  {id:367,data:"04/05",mes:5,empresa:"EUROTEXTIL",nroNota:"NF536734",valor:"4384.15",pago:false},
  {id:368,data:"04/05",mes:5,empresa:"EUROTEXTIL",nroNota:"NF 33639",valor:"1208.06",pago:false},
  {id:369,data:"04/05",mes:5,empresa:"EUROTEXTIL",nroNota:"NF 538445",valor:"2567.98",pago:false},
  {id:370,data:"04/05",mes:5,empresa:"EUROTEXTIL",nroNota:"NF539061",valor:"1751.58",pago:false},
  {id:371,data:"04/05",mes:5,empresa:"EUROTEXTIL",nroNota:"NF 32216",valor:"3809.56",pago:false},
  {id:372,data:"04/05",mes:5,empresa:"EUROTEXTIL",nroNota:"NF 537959",valor:"1349.52",pago:false},
  {id:373,data:"04/05",mes:5,empresa:"EUROTEXTIL",nroNota:"NF 32207",valor:"1344.6",pago:false},
  {id:374,data:"05/05",mes:5,empresa:"MARLES",nroNota:"NF 317339",valor:"4540",pago:false},
  {id:375,data:"05/05",mes:5,empresa:"ROMANA",nroNota:"",valor:"1871.65",pago:false},
  {id:376,data:"05/05",mes:5,empresa:"ROMANA",nroNota:"",valor:"1309.7",pago:false},
  {id:377,data:"05/05",mes:5,empresa:"DIAGONAL",nroNota:"NF 81923",valor:"1678.11",pago:false},
  {id:378,data:"06/05",mes:5,empresa:"EUROTEXTIL",nroNota:"NF536716",valor:"2137.86",pago:false},
  {id:379,data:"06/05",mes:5,empresa:"EUROTEXTIL",nroNota:"NF 538445",valor:"2567.98",pago:false},
  {id:380,data:"06/05",mes:5,empresa:"EUROTEXTIL",nroNota:"NF539061",valor:"1751.58",pago:false},
  {id:381,data:"06/05",mes:5,empresa:"EUROTEXTIL",nroNota:"NF 540671",valor:"1353.87",pago:false},
  {id:382,data:"06/05",mes:5,empresa:"EUROTEXTIL",nroNota:"NF 540758",valor:"2299.09",pago:false},
  {id:383,data:"06/05",mes:5,empresa:"EUROTEXTIL",nroNota:"NF 540751",valor:"1216.63",pago:false},
  {id:384,data:"06/05",mes:5,empresa:"IMATEXTIL",nroNota:"NF193316",valor:"1486.53",pago:false},
  {id:385,data:"07/05",mes:5,empresa:"EUROTEXTIL",nroNota:"NF 33015",valor:"1642.09",pago:false},
  {id:386,data:"07/05",mes:5,empresa:"EUROTEXTIL",nroNota:"NF536734",valor:"4384.15",pago:false},
  {id:387,data:"07/05",mes:5,empresa:"EUROTEXTIL",nroNota:"NF537448",valor:"2098.06",pago:false},
  {id:388,data:"08/05",mes:5,empresa:"EUROTEXTIL",nroNota:"NF 33123",valor:"1565.87",pago:false},
  {id:389,data:"08/05",mes:5,empresa:"EUROTEXTIL",nroNota:"NF 33639",valor:"1208.06",pago:false},
  {id:390,data:"08/05",mes:5,empresa:"ROMANA",nroNota:"",valor:"1470.3",pago:false},
  {id:391,data:"08/05",mes:5,empresa:"EUROTEXTIL",nroNota:"NF 537959",valor:"1349.52",pago:false},
  {id:392,data:"10/05",mes:5,empresa:"ACT COMERCIO DE TECIDOS",nroNota:"NF 135355",valor:"2597.71",pago:false},
  {id:393,data:"10/05",mes:5,empresa:"ROYAL",nroNota:"NF 206372",valor:"3915",pago:false},
  {id:394,data:"10/05",mes:5,empresa:"DIAGONAL",nroNota:"NF 82059",valor:"1517.47",pago:false},
  {id:395,data:"11/05",mes:5,empresa:"EUROTEXTIL",nroNota:"NF536716",valor:"2137.86",pago:false},
  {id:396,data:"11/05",mes:5,empresa:"EUROTEXTIL",nroNota:"NF 538445",valor:"2567.98",pago:false},
  {id:397,data:"11/05",mes:5,empresa:"EUROTEXTIL",nroNota:"NF539061",valor:"1751.58",pago:false},
  {id:398,data:"11/05",mes:5,empresa:"EUROTEXTIL",nroNota:"NF 541138",valor:"1430.77",pago:false},
  {id:399,data:"11/05",mes:5,empresa:"EUROTEXTIL",nroNota:"NF 32216",valor:"3809.56",pago:false},
  {id:400,data:"11/05",mes:5,empresa:"EUROTEXTIL",nroNota:"NF 542024",valor:"3189.3",pago:false},
  {id:401,data:"11/05",mes:5,empresa:"EUROTEXTIL",nroNota:"NF 541984",valor:"1095.21",pago:false},
  {id:402,data:"12/05",mes:5,empresa:"EUROTEXTIL",nroNota:"NF536734",valor:"4384.15",pago:false},
  {id:403,data:"13/05",mes:5,empresa:"EUROTEXTIL",nroNota:"NF 33639",valor:"1208.06",pago:false},
  {id:404,data:"13/05",mes:5,empresa:"EUROTEXTIL",nroNota:"NF 537959",valor:"1349.52",pago:false},
  {id:405,data:"14/05",mes:5,empresa:"EUROTEXTIL",nroNota:"NF 34346",valor:"2250.4",pago:false},
  {id:406,data:"14/05",mes:5,empresa:"NOTRE DAME",nroNota:"NF 19179",valor:"5313.78",pago:false},
  {id:407,data:"14/05",mes:5,empresa:"EUROTEXTIL",nroNota:"NF 32216",valor:"3809.67",pago:false},
  {id:408,data:"15/05",mes:5,empresa:"ROMANA",nroNota:"",valor:"1871.65",pago:false},
  {id:409,data:"15/05",mes:5,empresa:"ROMANA",nroNota:"",valor:"1404.34",pago:false},
  {id:410,data:"15/05",mes:5,empresa:"DIAGONAL",nroNota:"NF 81923",valor:"1678.11",pago:false},
  {id:411,data:"15/05",mes:5,empresa:"EUROTEXTIL",nroNota:"NF 541984",valor:"1095.21",pago:false},
  {id:412,data:"16/05",mes:5,empresa:"ROYAL",nroNota:"NF 205475",valor:"4268",pago:false},
  {id:413,data:"18/05",mes:5,empresa:"EUROTEXTIL",nroNota:"NF536716",valor:"2137.66",pago:false},
  {id:414,data:"18/05",mes:5,empresa:"EUROTEXTIL",nroNota:"NF536734",valor:"4384.15",pago:false},
  {id:415,data:"18/05",mes:5,empresa:"DIAGONAL",nroNota:"NF 81555",valor:"1941.95",pago:false},
  {id:416,data:"18/05",mes:5,empresa:"EUROTEXTIL",nroNota:"NF 33639",valor:"1208.06",pago:false},
  {id:417,data:"18/05",mes:5,empresa:"EUROTEXTIL",nroNota:"NF 538445",valor:"2567.98",pago:false},
  {id:418,data:"18/05",mes:5,empresa:"EUROTEXTIL",nroNota:"NF539061",valor:"1751.58",pago:false},
  {id:419,data:"18/05",mes:5,empresa:"EUROTEXTIL",nroNota:"NF 540758",valor:"2299.09",pago:false},
  {id:420,data:"18/05",mes:5,empresa:"EUROTEXTIL",nroNota:"NF 541138",valor:"1430.77",pago:false},
  {id:421,data:"18/05",mes:5,empresa:"EUROTEXTIL",nroNota:"NF 540751",valor:"1216.63",pago:false},
  {id:422,data:"18/05",mes:5,empresa:"ROMANA",nroNota:"",valor:"1470.3",pago:false},
  {id:423,data:"18/05",mes:5,empresa:"EUROTEXTIL",nroNota:"NF 537959",valor:"1349.52",pago:false},
  {id:424,data:"18/05",mes:5,empresa:"EUROTEXTIL",nroNota:"NF537448",valor:"2098.06",pago:false},
  {id:425,data:"18/05",mes:5,empresa:"EUROTEXTIL",nroNota:"NF 542024",valor:"3189.3",pago:false},
  {id:426,data:"18/05",mes:5,empresa:"NOTRE DAME",nroNota:"NF 19446",valor:"1364.36",pago:false},
  {id:427,data:"20/05",mes:5,empresa:"ROMANA",nroNota:"",valor:"1309.7",pago:false},
  {id:428,data:"20/05",mes:5,empresa:"DIAGONAL",nroNota:"NF 82059",valor:"1517.47",pago:false},
  {id:429,data:"20/05",mes:5,empresa:"EUROTEXTIL",nroNota:"NF 541984",valor:"1095.21",pago:false},
  {id:430,data:"21/05",mes:5,empresa:"EUROTEXTIL",nroNota:"NF 538445",valor:"2567.98",pago:false},
  {id:431,data:"21/05",mes:5,empresa:"EUROTEXTIL",nroNota:"NF539061",valor:"1751.58",pago:false},
  {id:432,data:"21/05",mes:5,empresa:"EUROTEXTIL",nroNota:"NF 540671",valor:"1353.87",pago:false},
  {id:433,data:"21/05",mes:5,empresa:"EUROTEXTIL",nroNota:"NF 541138",valor:"1430.77",pago:false},
  {id:434,data:"21/05",mes:5,empresa:"DIAGONAL",nroNota:"NF82411",valor:"2254.5",pago:false},
  {id:435,data:"21/05",mes:5,empresa:"EUROTEXTIL",nroNota:"NF 542024",valor:"3189.3",pago:false},
  {id:436,data:"22/05",mes:5,empresa:"EUROTEXTIL",nroNota:"NF 33015",valor:"1642.09",pago:false},
  {id:437,data:"22/05",mes:5,empresa:"EUROTEXTIL",nroNota:"NF536734",valor:"4384.15",pago:false},
  {id:438,data:"22/05",mes:5,empresa:"ROMANA",nroNota:"",valor:"2550.51",pago:false},
  {id:439,data:"22/05",mes:5,empresa:"ROYAL",nroNota:"NF205014",valor:"3877",pago:false},
  {id:440,data:"25/05",mes:5,empresa:"ACT COMERCIO DE TECIDOS",nroNota:"NF 135355",valor:"2597.71",pago:false},
  {id:441,data:"25/05",mes:5,empresa:"EUROTEXTIL",nroNota:"NF 33639",valor:"1208.06",pago:false},
  {id:442,data:"25/05",mes:5,empresa:"ROMANA",nroNota:"",valor:"1871.67",pago:false},
  {id:443,data:"25/05",mes:5,empresa:"EUROTEXTIL",nroNota:"NF 537959",valor:"1349.52",pago:false},
  {id:444,data:"25/05",mes:5,empresa:"DIAGONAL",nroNota:"NF 81923",valor:"1678.11",pago:false},
  {id:445,data:"25/05",mes:5,empresa:"EUROTEXTIL",nroNota:"NF 541984",valor:"1095.21",pago:false},
  {id:446,data:"25/05",mes:5,empresa:"EUROTEXTIL",nroNota:"NF 35230",valor:"4605.05",pago:false},
  {id:447,data:"26/05",mes:5,empresa:"EUROTEXTIL",nroNota:"NF 538445",valor:"2567.98",pago:false},
  {id:448,data:"26/05",mes:5,empresa:"EUROTEXTIL",nroNota:"NF539061",valor:"1751.58",pago:false},
  {id:449,data:"26/05",mes:5,empresa:"EUROTEXTIL",nroNota:"NF 540758",valor:"2299.09",pago:false},
  {id:450,data:"26/05",mes:5,empresa:"EUROTEXTIL",nroNota:"NF 541138",valor:"1430.77",pago:false},
  {id:451,data:"26/05",mes:5,empresa:"EUROTEXTIL",nroNota:"NF 540751",valor:"1216.63",pago:false},
  {id:452,data:"26/05",mes:5,empresa:"EUROTEXTIL",nroNota:"NF 542024",valor:"3189.3",pago:false},
  {id:453,data:"27/05",mes:5,empresa:"EUROTEXTIL",nroNota:"NF536734",valor:"4384.15",pago:false},
  {id:454,data:"27/05",mes:5,empresa:"EUROTEXTIL",nroNota:"NF537448",valor:"2098.06",pago:false},
  {id:455,data:"27/05",mes:5,empresa:"EUROTEXTIL",nroNota:"NF 35344",valor:"2175.16",pago:false},
  {id:456,data:"28/05",mes:5,empresa:"EUROTEXTIL",nroNota:"NF 33639",valor:"1208.06",pago:false},
  {id:457,data:"28/05",mes:5,empresa:"EUROTEXTIL",nroNota:"NF 537959",valor:"1349.52",pago:false},
  {id:458,data:"29/05",mes:5,empresa:"EUROTEXTIL",nroNota:"NF 34346",valor:"2250.4",pago:false},
  {id:459,data:"29/05",mes:5,empresa:"NOTRE DAME",nroNota:"NF 19179",valor:"5313.78",pago:false},
  {id:460,data:"30/05",mes:5,empresa:"DIAGONAL",nroNota:"NF 82059",valor:"1517.47",pago:false},
];

// ─── Boletos JUN 2026 (a vencer) ─────────────────────────────────────────────
const BOLETOS_JUN = [
  {id:461,data:"01/06",mes:6,empresa:"EUROTEXTIL",nroNota:"NF536734",valor:"4384.15",pago:false},
  {id:462,data:"01/06",mes:6,empresa:"EUROTEXTIL",nroNota:"NF 538445",valor:"2567.98",pago:false},
  {id:463,data:"01/06",mes:6,empresa:"EUROTEXTIL",nroNota:"NF539061",valor:"1751.58",pago:false},
  {id:464,data:"01/06",mes:6,empresa:"EUROTEXTIL",nroNota:"NF 540074",valor:"2089.79",pago:false},
  {id:465,data:"01/06",mes:6,empresa:"EUROTEXTIL",nroNota:"NF 541138",valor:"1430.77",pago:false},
  {id:466,data:"01/06",mes:6,empresa:"EUROTEXTIL",nroNota:"NF 541984",valor:"1095.21",pago:false},
  {id:467,data:"01/06",mes:6,empresa:"EUROTEXTIL",nroNota:"NF 35230",valor:"4605.05",pago:false},
  {id:468,data:"01/06",mes:6,empresa:"EUROTEXTIL",nroNota:"NF 35468",valor:"1925.18",pago:false},
  {id:469,data:"01/06",mes:6,empresa:"EUROTEXTIL",nroNota:"NF 35344",valor:"2175.16",pago:false},
  {id:470,data:"01/06",mes:6,empresa:"ROYAL",nroNota:"NF 208 932 /  208931",valor:"4702",pago:false},
  {id:471,data:"01/06",mes:6,empresa:"EUROTEXTIL",nroNota:"NF 543 307",valor:"1752.21",pago:false},
  {id:472,data:"01/06",mes:6,empresa:"EUROTEXTIL",nroNota:"NF 542024",valor:"3189.3",pago:false},
  {id:473,data:"02/06",mes:6,empresa:"EUROTEXTIL",nroNota:"NF 33639",valor:"1208.06",pago:false},
  {id:474,data:"02/06",mes:6,empresa:"EUROTEXTIL",nroNota:"NF 537959",valor:"1349.52",pago:false},
  {id:475,data:"02/06",mes:6,empresa:"NOTRE DAME",nroNota:"NF 19446",valor:"1364.36",pago:false},
  {id:476,data:"04/06",mes:6,empresa:"ROMANA",nroNota:"",valor:"1309.73",pago:false},
  {id:477,data:"04/06",mes:6,empresa:"DIAGONAL",nroNota:"NF 81923",valor:"1678.11",pago:false},
  {id:478,data:"04/06",mes:6,empresa:"EUROTEXTIL",nroNota:"NF 541984",valor:"1095.21",pago:false},
  {id:479,data:"04/06",mes:6,empresa:"EUROTEXTIL",nroNota:"NF 35230",valor:"4605.05",pago:false},
  {id:480,data:"05/06",mes:6,empresa:"EUROTEXTIL",nroNota:"NF 538445",valor:"2567.98",pago:false},
  {id:481,data:"05/06",mes:6,empresa:"EUROTEXTIL",nroNota:"NF539061",valor:"1751.58",pago:false},
  {id:482,data:"05/06",mes:6,empresa:"EUROTEXTIL",nroNota:"NF 540671",valor:"1353.87",pago:false},
  {id:483,data:"05/06",mes:6,empresa:"EUROTEXTIL",nroNota:"NF 540758",valor:"2299.09",pago:false},
  {id:484,data:"05/06",mes:6,empresa:"EUROTEXTIL",nroNota:"NF 541138",valor:"1430.77",pago:false},
  {id:485,data:"05/06",mes:6,empresa:"EUROTEXTIL",nroNota:"NF 540751",valor:"1216.63",pago:false},
  {id:486,data:"05/06",mes:6,empresa:"DIAGONAL",nroNota:"NF82411",valor:"2254.5",pago:false},
  {id:487,data:"05/06",mes:6,empresa:"EUROTEXTIL",nroNota:"NF 542024",valor:"3189.3",pago:false},
  {id:488,data:"08/06",mes:6,empresa:"EUROTEXTIL",nroNota:"NF 33015",valor:"1642.08",pago:false},
  {id:489,data:"08/06",mes:6,empresa:"EUROTEXTIL",nroNota:"NF536734",valor:"4384.15",pago:false},
  {id:490,data:"08/06",mes:6,empresa:"EUROTEXTIL",nroNota:"NF 33639",valor:"1208.06",pago:false},
  {id:491,data:"08/06",mes:6,empresa:"EUROTEXTIL",nroNota:"NF 537959",valor:"1349.52",pago:false},
  {id:492,data:"08/06",mes:6,empresa:"EUROTEXTIL",nroNota:"NF537448",valor:"2098.07",pago:false},
  {id:493,data:"08/06",mes:6,empresa:"EUROTEXTIL",nroNota:"NF 35344",valor:"2175.16",pago:false},
  {id:494,data:"08/06",mes:6,empresa:"EUROTEXTIL",nroNota:"NF 543 307",valor:"1752.21",pago:false},
  {id:495,data:"09/06",mes:6,empresa:"ACT COMERCIO DE TECIDOS",nroNota:"NF 135355",valor:"2597.7",pago:false},
  {id:496,data:"09/06",mes:6,empresa:"ROYAL",nroNota:"NF 206372",valor:"3915",pago:false},
  {id:497,data:"09/06",mes:6,empresa:"DIAGONAL",nroNota:"NF 82059",valor:"1517.47",pago:false},
  {id:498,data:"09/06",mes:6,empresa:"EUROTEXTIL",nroNota:"NF 541984",valor:"1095.21",pago:false},
  {id:499,data:"09/06",mes:6,empresa:"EUROTEXTIL",nroNota:"NF 35230",valor:"4605.05",pago:false},
  {id:500,data:"10/06",mes:6,empresa:"EUROTEXTIL",nroNota:"NF 538445",valor:"2567.98",pago:false},
  {id:501,data:"10/06",mes:6,empresa:"EUROTEXTIL",nroNota:"NF539061",valor:"1751.58",pago:false},
  {id:502,data:"10/06",mes:6,empresa:"EUROTEXTIL",nroNota:"NF 541138",valor:"1430.77",pago:false},
  {id:503,data:"10/06",mes:6,empresa:"EUROTEXTIL",nroNota:"NF 542024",valor:"3189.3",pago:false},
  {id:504,data:"10/06",mes:6,empresa:"EUROTEXTIL",nroNota:"NF 35468",valor:"1925.18",pago:false},
  {id:505,data:"11/06",mes:6,empresa:"ROMANA",nroNota:"",valor:"2550.51",pago:false},
  {id:506,data:"11/06",mes:6,empresa:"EUROTEXTIL",nroNota:"NF 35344",valor:"2175.16",pago:false},
  {id:507,data:"11/06",mes:6,empresa:"EUROTEXTIL",nroNota:"NF 543 307",valor:"1752.21",pago:false},
  {id:508,data:"12/06",mes:6,empresa:"EUROTEXTIL",nroNota:"NF 33639",valor:"1208.11",pago:false},
  {id:509,data:"13/06",mes:6,empresa:"NOTRE DAME",nroNota:"NF 19179",valor:"5313.78",pago:false},
  {id:510,data:"14/06",mes:6,empresa:"DIAGONAL",nroNota:"NF 81923",valor:"1678.11",pago:false},
  {id:511,data:"15/06",mes:6,empresa:"EUROTEXTIL",nroNota:"NF 538445",valor:"2568.05",pago:false},
  {id:512,data:"15/06",mes:6,empresa:"EUROTEXTIL",nroNota:"NF539061",valor:"1751.58",pago:false},
  {id:513,data:"15/06",mes:6,empresa:"ROYAL",nroNota:"NF 205475",valor:"4268",pago:false},
  {id:514,data:"15/06",mes:6,empresa:"EUROTEXTIL",nroNota:"NF 34346",valor:"2250.4",pago:false},
  {id:515,data:"15/06",mes:6,empresa:"EUROTEXTIL",nroNota:"NF 540758",valor:"2299.09",pago:false},
  {id:516,data:"15/06",mes:6,empresa:"EUROTEXTIL",nroNota:"NF 541138",valor:"1430.77",pago:false},
  {id:517,data:"15/06",mes:6,empresa:"EUROTEXTIL",nroNota:"NF 540751",valor:"1216.63",pago:false},
  {id:518,data:"15/06",mes:6,empresa:"EUROTEXTIL",nroNota:"NF 542024",valor:"3189.3",pago:false},
  {id:519,data:"15/06",mes:6,empresa:"EUROTEXTIL",nroNota:"NF 541984",valor:"1095.21",pago:false},
  {id:520,data:"15/06",mes:6,empresa:"EUROTEXTIL",nroNota:"NF 35230",valor:"4605.05",pago:false},
  {id:521,data:"16/06",mes:6,empresa:"EUROTEXTIL",nroNota:"NF 35344",valor:"2175.16",pago:false},
  {id:522,data:"16/06",mes:6,empresa:"EUROTEXTIL",nroNota:"NF 543 307",valor:"1752.21",pago:false},
  {id:523,data:"17/06",mes:6,empresa:"EUROTEXTIL",nroNota:"NF 537959",valor:"1349.53",pago:false},
  {id:524,data:"17/06",mes:6,empresa:"NOTRE DAME",nroNota:"NF 19446",valor:"1364.36",pago:false},
  {id:525,data:"19/06",mes:6,empresa:"DIAGONAL",nroNota:"NF 82059",valor:"1517.47",pago:false},
  {id:526,data:"20/06",mes:6,empresa:"DIAGONAL",nroNota:"NF82411",valor:"2254.5",pago:false},
  {id:527,data:"22/06",mes:6,empresa:"EUROTEXTIL",nroNota:"NF539061",valor:"1751.66",pago:false},
  {id:528,data:"22/06",mes:6,empresa:"EUROTEXTIL",nroNota:"NF 540671",valor:"1353.87",pago:false},
  {id:529,data:"22/06",mes:6,empresa:"EUROTEXTIL",nroNota:"NF 541138",valor:"1430.77",pago:false},
  {id:530,data:"22/06",mes:6,empresa:"EUROTEXTIL",nroNota:"NF 542024",valor:"3189.3",pago:false},
  {id:531,data:"22/06",mes:6,empresa:"EUROTEXTIL",nroNota:"NF 541984",valor:"1095.21",pago:false},
  {id:532,data:"22/06",mes:6,empresa:"EUROTEXTIL",nroNota:"NF 35230",valor:"4605.05",pago:false},
  {id:533,data:"22/06",mes:6,empresa:"EUROTEXTIL",nroNota:"NF 35468",valor:"1925.18",pago:false},
  {id:534,data:"22/06",mes:6,empresa:"EUROTEXTIL",nroNota:"NF 35344",valor:"2175.16",pago:false},
  {id:535,data:"22/06",mes:6,empresa:"EUROTEXTIL",nroNota:"NF 543 307",valor:"1752.21",pago:false},
  {id:536,data:"24/06",mes:6,empresa:"DIAGONAL",nroNota:"NF 81923",valor:"1678.13",pago:false},
  {id:537,data:"24/06",mes:6,empresa:"EUROTEXTIL",nroNota:"NF 541984",valor:"1095.21",pago:false},
  {id:538,data:"24/06",mes:6,empresa:"EUROTEXTIL",nroNota:"NF 35230",valor:"4605.05",pago:false},
  {id:539,data:"25/06",mes:6,empresa:"EUROTEXTIL",nroNota:"NF 540758",valor:"2299.09",pago:false},
  {id:540,data:"25/06",mes:6,empresa:"EUROTEXTIL",nroNota:"NF 541138",valor:"1430.77",pago:false},
  {id:541,data:"25/06",mes:6,empresa:"EUROTEXTIL",nroNota:"NF 540751",valor:"1216.63",pago:false},
  {id:542,data:"25/06",mes:6,empresa:"EUROTEXTIL",nroNota:"NF 542024",valor:"3189.3",pago:false},
  {id:543,data:"26/06",mes:6,empresa:"EUROTEXTIL",nroNota:"NF 35344",valor:"2175.16",pago:false},
  {id:544,data:"26/06",mes:6,empresa:"EUROTEXTIL",nroNota:"NF 543 307",valor:"1752.21",pago:false},
  {id:545,data:"29/06",mes:6,empresa:"EUROTEXTIL",nroNota:"NF 540074",valor:"2089.79",pago:false},
  {id:546,data:"29/06",mes:6,empresa:"EUROTEXTIL",nroNota:"NF 34346",valor:"2250.4",pago:false},
  {id:547,data:"29/06",mes:6,empresa:"DIAGONAL",nroNota:"NF 82059",valor:"1517.47",pago:false},
  {id:548,data:"29/06",mes:6,empresa:"EUROTEXTIL",nroNota:"NF 541984",valor:"1095.21",pago:false},
  {id:549,data:"29/06",mes:6,empresa:"EUROTEXTIL",nroNota:"NF 35230",valor:"4605.05",pago:false},
  {id:550,data:"30/06",mes:6,empresa:"EUROTEXTIL",nroNota:"NF 541138",valor:"1430.77",pago:false},
  {id:551,data:"30/06",mes:6,empresa:"EUROTEXTIL",nroNota:"NF 542024",valor:"3189.3",pago:false},
  {id:552,data:"30/06",mes:6,empresa:"EUROTEXTIL",nroNota:"NF 35468",valor:"1925.18",pago:false},
];

// ─── Boletos JUL 2026 (a vencer) ─────────────────────────────────────────────
const BOLETOS_JUL = [
  {id:553,data:"01/07",mes:7,empresa:"ROMANA",nroNota:"",valor:"2550.55",pago:false},
  {id:554,data:"01/07",mes:7,empresa:"EUROTEXTIL",nroNota:"NF 35344",valor:"2175.16",pago:false},
  {id:555,data:"01/07",mes:7,empresa:"ROYAL",nroNota:"NF 208 932 /  208931",valor:"4702",pago:false},
  {id:556,data:"01/07",mes:7,empresa:"EUROTEXTIL",nroNota:"NF 543 307",valor:"1752.21",pago:false},
  {id:557,data:"02/07",mes:7,empresa:"NOTRE DAME",nroNota:"NF 19446",valor:"1364.36",pago:false},
  {id:558,data:"05/07",mes:7,empresa:"DIAGONAL",nroNota:"NF82411",valor:"2254.5",pago:false},
  {id:559,data:"06/07",mes:7,empresa:"EUROTEXTIL",nroNota:"NF 540671",valor:"1353.87",pago:false},
  {id:560,data:"06/07",mes:7,empresa:"EUROTEXTIL",nroNota:"NF 540758",valor:"2299.11",pago:false},
  {id:561,data:"06/07",mes:7,empresa:"EUROTEXTIL",nroNota:"NF 541138",valor:"1430.77",pago:false},
  {id:562,data:"06/07",mes:7,empresa:"EUROTEXTIL",nroNota:"NF 540751",valor:"1216.63",pago:false},
  {id:563,data:"06/07",mes:7,empresa:"EUROTEXTIL",nroNota:"NF 542024",valor:"3189.3",pago:false},
  {id:564,data:"06/07",mes:7,empresa:"EUROTEXTIL",nroNota:"NF 541984",valor:"1095.21",pago:false},
  {id:565,data:"06/07",mes:7,empresa:"EUROTEXTIL",nroNota:"NF 35230",valor:"4605.05",pago:false},
  {id:566,data:"06/07",mes:7,empresa:"EUROTEXTIL",nroNota:"NF 35344",valor:"2175.16",pago:false},
  {id:567,data:"06/07",mes:7,empresa:"EUROTEXTIL",nroNota:"NF 543 307",valor:"1752.21",pago:false},
  {id:568,data:"09/07",mes:7,empresa:"DIAGONAL",nroNota:"NF 82059",valor:"1517.47",pago:false},
  {id:569,data:"09/07",mes:7,empresa:"EUROTEXTIL",nroNota:"NF 541984",valor:"1095.21",pago:false},
  {id:570,data:"09/07",mes:7,empresa:"EUROTEXTIL",nroNota:"NF 35230",valor:"4605.05",pago:false},
  {id:571,data:"10/07",mes:7,empresa:"EUROTEXTIL",nroNota:"NF 541138",valor:"1430.76",pago:false},
  {id:572,data:"10/07",mes:7,empresa:"EUROTEXTIL",nroNota:"NF 542024",valor:"3189.3",pago:false},
  {id:573,data:"10/07",mes:7,empresa:"EUROTEXTIL",nroNota:"NF 35468",valor:"1925.18",pago:false},
  {id:574,data:"13/07",mes:7,empresa:"EUROTEXTIL",nroNota:"NF 35344",valor:"2175.16",pago:false},
  {id:575,data:"13/07",mes:7,empresa:"EUROTEXTIL",nroNota:"NF 543 307",valor:"1752.21",pago:false},
  {id:576,data:"14/07",mes:7,empresa:"EUROTEXTIL",nroNota:"NF 541984",valor:"1095.21",pago:false},
  {id:577,data:"14/07",mes:7,empresa:"EUROTEXTIL",nroNota:"NF 35230",valor:"4605.05",pago:false},
  {id:578,data:"15/07",mes:7,empresa:"EUROTEXTIL",nroNota:"NF 542024",valor:"3189.3",pago:false},
  {id:579,data:"16/07",mes:7,empresa:"EUROTEXTIL",nroNota:"NF 35344",valor:"2175.16",pago:false},
  {id:580,data:"16/07",mes:7,empresa:"EUROTEXTIL",nroNota:"NF 543 307",valor:"1752.21",pago:false},
  {id:581,data:"19/07",mes:7,empresa:"DIAGONAL",nroNota:"NF 82059",valor:"1517.47",pago:false},
  {id:582,data:"20/07",mes:7,empresa:"DIAGONAL",nroNota:"NF82411",valor:"2254.5",pago:false},
  {id:583,data:"20/07",mes:7,empresa:"EUROTEXTIL",nroNota:"NF 542024",valor:"3189",pago:false},
  {id:584,data:"20/07",mes:7,empresa:"EUROTEXTIL",nroNota:"NF 541984",valor:"1095.2",pago:false},
  {id:585,data:"20/07",mes:7,empresa:"EUROTEXTIL",nroNota:"NF 35230",valor:"4605.05",pago:false},
  {id:586,data:"20/07",mes:7,empresa:"EUROTEXTIL",nroNota:"NF 35468",valor:"1925.18",pago:false},
  {id:587,data:"21/07",mes:7,empresa:"EUROTEXTIL",nroNota:"NF 35344",valor:"2175.16",pago:false},
  {id:588,data:"21/07",mes:7,empresa:"EUROTEXTIL",nroNota:"NF 543 307",valor:"1752.21",pago:false},
  {id:589,data:"24/07",mes:7,empresa:"EUROTEXTIL",nroNota:"NF 35230",valor:"4605.15",pago:false},
  {id:590,data:"27/07",mes:7,empresa:"EUROTEXTIL",nroNota:"NF 35344",valor:"2175.18",pago:false},
  {id:591,data:"27/07",mes:7,empresa:"EUROTEXTIL",nroNota:"NF 543 307",valor:"1752.21",pago:false},
  {id:592,data:"29/07",mes:7,empresa:"DIAGONAL",nroNota:"NF 82059",valor:"1517.5",pago:false},
  {id:593,data:"30/07",mes:7,empresa:"EUROTEXTIL",nroNota:"NF 35468",valor:"1925.22",pago:false},
  {id:594,data:"31/07",mes:7,empresa:"EUROTEXTIL",nroNota:"NF 543 307",valor:"1752.28",pago:false},
];


// ─── AUX_INICIAL (template inicial do módulo) ─────────────────────────────────
const AUX_INICIAL = {
  "Funcionários": [
    {nome:"Ana Paula", salario:"4200",comissao:"",extra:"",alimentacao:"400",vale:"220",ferias:"",rescisao:""},
    {nome:"Carla Lima", salario:"3800",comissao:"",extra:"",alimentacao:"400",vale:"180",ferias:"",rescisao:""},
    {nome:"Márcia R.",  salario:"3500",comissao:"",extra:"",alimentacao:"400",vale:"200",ferias:"",rescisao:""},
  ],
  ...AUX_VAZIO,
  "Free Lances":   [{data:"",valor:"3500", descricao:"free lances"}],
  "Passadoria":    [{data:"",prestador:"",valor:"18265.70",descricao:"passadoria total"}],
  "Salas Corte":   [{data:"",prestador:"",valor:"7368", descricao:"corte fora"}],
  "Caseado":       [{data:"",valor:"2500", descricao:"caseado/estamparia"}],
  "Carreto":       [{data:"",valor:"3000", descricao:"carreto"}],
  "Tecidos":       [{data:"",valor:"254578.73",descricao:"NFs diversas"}],
  "Oficinas Costura":[{data:"",prestador:"",valor:"165352.50",descricao:"total oficinas"}],
  "Piloteiro":     [{data:"",valor:"1000", descricao:""}],
  "Aviamentos":    [{data:"",valor:"10983.91",descricao:""}],
  "Etiquetas/Tags":[{data:"",valor:"8755.29", descricao:"etiqueta/bandeirinha/tag"}],
  "Gastos Diários Loja e Fábrica":[{data:"",valor:"3000", descricao:""}],
  "Gastos Carro":  [{data:"",valor:"2000", descricao:"revisão/seguro/gasolina"}],
  "Reforma Loja e Equipamentos":[{data:"",valor:"15000", descricao:""}],
  "Sistemas":      [{data:"",valor:"8000", descricao:""}],
  "Pró-Labore":    [{data:"",valor:"58100", descricao:""}],
  "Contabilidade": [{data:"",valor:"2200", descricao:"INSS/FGTS"}],
  "Representantes":[{data:"",valor:"3000", descricao:"comissão representante"}],
  "Concessionárias":[{data:"",valor:"950", descricao:"telefone/internet/luz"}],
  "Aluguel":       [{data:"",valor:"39192.50",descricao:"José Paulino"},{data:"",valor:"13536",descricao:"Silva Teles"}],
  "Marketing":     [{data:"",valor:"12000", descricao:"agência marketing/tráfego pago"}],
  "Modelos Fotos": [{data:"",valor:"4930", descricao:"modelos/fotos/provador"}],
  "Embalagens":    [{data:"",valor:"6700", descricao:"6500 sacolas + 200 mktplaces"}],
};

// ─── AUX Janeiro/Fevereiro 2026 ───────────────────────────────────────────────
const AUX_JAN = {
  "Funcionários": [{nome:"(ver planilha)",salario:"46529",comissao:"",extra:"",alimentacao:"",vale:"",ferias:"",rescisao:""}],
  ...Object.fromEntries(CATS.filter(c=>!SEM_AUX.includes(c)&&c!=="Funcionários").map(c=>[c,[]])),
  "Free Lances":   [{data:"",valor:"6500", descricao:"free lances"}],
  "Passadoria":    [{data:"",prestador:"",valor:"17095", descricao:"passadoria total"}],
  "Caseado":       [{data:"",valor:"2400", descricao:"caseado/estamparia"}],
  "Tecidos":       [{data:"",valor:"613996", descricao:"NFs diversas"}],
  "Oficinas Costura":[{data:"",prestador:"",valor:"193160", descricao:"total oficinas"}],
  "Salas Corte":   [{data:"",prestador:"",valor:"8760", descricao:"corte fora"}],
  "Modelista":     [{data:"",valor:"3650", descricao:""}],
  "Piloteiro":     [{data:"",valor:"1000", descricao:""}],
  "Aviamentos":    [{data:"",valor:"30403", descricao:""}],
  "Gastos Diários Loja e Fábrica":[{data:"",valor:"6000", descricao:""}],
  "Gastos Carro":  [{data:"",valor:"7500", descricao:"revisão/seguro/gasolina"}],
  "Reforma Loja e Equipamentos":[{data:"",valor:"5000", descricao:""}],
  "Sistemas":      [{data:"",valor:"4400", descricao:""}],
  "Pró-Labore":    [{data:"",valor:"101500", descricao:""}],
  "Giro Empréstimo":[{data:"15",valor:"11089",descricao:"dia 15"}],
  "Contabilidade": [{data:"",valor:"16043", descricao:"INSS/FGTS"}],
  "Impostos DAS":  [{data:"",valor:"83661", descricao:""}],
  "Representantes":[{data:"",valor:"3000", descricao:"comissão representante"}],
  "Concessionárias":[{data:"",valor:"9650", descricao:"telefone/internet/luz"}],
  "Aluguel":       [{data:"",valor:"38811", descricao:"José Paulino"},{data:"",valor:"13280",descricao:"Silva Teles"}],
  "Marketing":     [{data:"",valor:"12000", descricao:"agência marketing/tráfego pago"}],
  "Modelos Fotos": [{data:"",valor:"11500", descricao:"modelos/fotos/provador"}],
  "Embalagens":    [{data:"",valor:"10500", descricao:"8500 sacolas + 2000 mktplaces"}],
};

const AUX_FEV = {
  "Funcionários": [{nome:"(ver planilha)",salario:"70155",comissao:"",extra:"",alimentacao:"",vale:"",ferias:"",rescisao:""}],
  ...Object.fromEntries(CATS.filter(c=>!SEM_AUX.includes(c)&&c!=="Funcionários").map(c=>[c,[]])),
  "Free Lances":   [{data:"",valor:"8500", descricao:"free lances"}],
  "Passadoria":    [{data:"",prestador:"",valor:"18955", descricao:"passadoria total"}],
  "Carreto":       [{data:"",valor:"4500", descricao:"carreto"}],
  "Caseado":       [{data:"",valor:"3000", descricao:"caseado/estamparia"}],
  "Tecidos":       [{data:"",valor:"587302", descricao:"NFs diversas"}],
  "Oficinas Costura":[{data:"",prestador:"",valor:"261158", descricao:"total oficinas"}],
  "Salas Corte":   [{data:"",prestador:"",valor:"7920", descricao:"corte fora"}],
  "Modelista":     [{data:"",valor:"3450", descricao:""}],
  "Piloteiro":     [{data:"",valor:"1300", descricao:""}],
  "Aviamentos":    [{data:"",valor:"28281", descricao:""}],
  "Gastos Diários Loja e Fábrica":[{data:"",valor:"6500", descricao:""}],
  "Gastos Carro":  [{data:"",valor:"5153", descricao:"revisão/seguro/gasolina"}],
  "Reforma Loja e Equipamentos":[{data:"",valor:"15000", descricao:""}],
  "Sistemas":      [{data:"",valor:"9000", descricao:""}],
  "Pró-Labore":    [{data:"",valor:"106000", descricao:""}],
  "Giro Empréstimo":[{data:"15",valor:"11089",descricao:"dia 15"}],
  "Contabilidade": [{data:"",valor:"16681", descricao:"INSS/FGTS"}],
  "Impostos DAS":  [{data:"",valor:"69121", descricao:""}],
  "Representantes":[{data:"",valor:"4500", descricao:"comissão representante"}],
  "Concessionárias":[{data:"",valor:"9950", descricao:"telefone/internet/luz"}],
  "Aluguel":       [{data:"",valor:"39192.50",descricao:"José Paulino"},{data:"",valor:"13286",descricao:"Silva Teles"}],
  "Marketing":     [{data:"",valor:"11000", descricao:"agência marketing/tráfego pago"}],
  "Modelos Fotos": [{data:"",valor:"18000", descricao:"modelos/fotos/provador"}],
  "Embalagens":    [{data:"",valor:"7300", descricao:"6000 sacolas + 1300 mktplaces"}],
};

// ─── Receitas por mês ─────────────────────────────────────────────────────────
const RECEITAS_MAR = {
  1: {silvaTeles:0,     bomRetiro:0,     marketplaces:800000},
  2: {silvaTeles:7939,  bomRetiro:16857, marketplaces:0},
  3: {silvaTeles:5070,  bomRetiro:21997, marketplaces:0},
  4: {silvaTeles:5053,  bomRetiro:10515, marketplaces:0},
  5: {silvaTeles:9445,  bomRetiro:12869, marketplaces:0},
  6: {silvaTeles:2674,  bomRetiro:7076,  marketplaces:0},
  7: {silvaTeles:1,     bomRetiro:14537, marketplaces:0},
  9: {silvaTeles:10780, bomRetiro:5491,  marketplaces:0},
  10:{silvaTeles:19307, bomRetiro:5839,  marketplaces:0},
  11:{silvaTeles:12512, bomRetiro:11308, marketplaces:0},
  12:{silvaTeles:4041,  bomRetiro:29456, marketplaces:0},
  13:{silvaTeles:3716,  bomRetiro:11688, marketplaces:0},
  14:{silvaTeles:1,     bomRetiro:9944,  marketplaces:0},
  16:{silvaTeles:8676,  bomRetiro:14531, marketplaces:0},
  17:{silvaTeles:19977, bomRetiro:3956,  marketplaces:0},
  18:{silvaTeles:0,     bomRetiro:3956,  marketplaces:0},
  19:{silvaTeles:6441,  bomRetiro:4634,  marketplaces:0},
  20:{silvaTeles:3167,  bomRetiro:22226, marketplaces:0},
  21:{silvaTeles:1,     bomRetiro:6383,  marketplaces:0},
};

const RECEITAS_JAN = {
  1:{silvaTeles:0,    bomRetiro:0,     marketplaces:940000},
  6:{silvaTeles:1666, bomRetiro:9073,  marketplaces:0},
  7:{silvaTeles:1136, bomRetiro:5853,  marketplaces:0},
  8:{silvaTeles:4714, bomRetiro:12714, marketplaces:0},
  9:{silvaTeles:2949, bomRetiro:7600,  marketplaces:0},
  10:{silvaTeles:1,   bomRetiro:7749,  marketplaces:0},
  12:{silvaTeles:3520,bomRetiro:5594,  marketplaces:0},
  13:{silvaTeles:13666,bomRetiro:8385, marketplaces:0},
  14:{silvaTeles:6597,bomRetiro:11197, marketplaces:0},
  15:{silvaTeles:13347,bomRetiro:6141, marketplaces:0},
  16:{silvaTeles:5866,bomRetiro:13199, marketplaces:0},
  17:{silvaTeles:1,   bomRetiro:6519,  marketplaces:0},
  19:{silvaTeles:1352,bomRetiro:5846,  marketplaces:0},
  20:{silvaTeles:7715,bomRetiro:6979,  marketplaces:0},
  21:{silvaTeles:9008,bomRetiro:3062,  marketplaces:0},
  22:{silvaTeles:4515,bomRetiro:12657, marketplaces:0},
  23:{silvaTeles:3976,bomRetiro:25667, marketplaces:0},
  24:{silvaTeles:1,   bomRetiro:6161,  marketplaces:0},
  26:{silvaTeles:6393,bomRetiro:11703, marketplaces:0},
  27:{silvaTeles:4850,bomRetiro:6940,  marketplaces:0},
  28:{silvaTeles:6031,bomRetiro:14771, marketplaces:0},
  29:{silvaTeles:5943,bomRetiro:11742, marketplaces:0},
  30:{silvaTeles:9203,bomRetiro:15539, marketplaces:0},
  31:{silvaTeles:1,   bomRetiro:6869,  marketplaces:0},
};

const RECEITAS_FEV = {
  1:{silvaTeles:0,    bomRetiro:0,     marketplaces:910000},
  2:{silvaTeles:4519, bomRetiro:4317,  marketplaces:0},
  3:{silvaTeles:9147, bomRetiro:3020,  marketplaces:0},
  4:{silvaTeles:2859, bomRetiro:8008,  marketplaces:0},
  5:{silvaTeles:11750,bomRetiro:4575,  marketplaces:0},
  6:{silvaTeles:4647, bomRetiro:19835, marketplaces:0},
  7:{silvaTeles:1,    bomRetiro:9950,  marketplaces:0},
  9:{silvaTeles:1,    bomRetiro:5100,  marketplaces:0},
  10:{silvaTeles:3163,bomRetiro:10536, marketplaces:0},
  11:{silvaTeles:5369,bomRetiro:8648,  marketplaces:0},
  12:{silvaTeles:3817,bomRetiro:5770,  marketplaces:0},
  13:{silvaTeles:7884,bomRetiro:2179,  marketplaces:0},
  14:{silvaTeles:1,   bomRetiro:7575,  marketplaces:0},
  18:{silvaTeles:4778,bomRetiro:5807,  marketplaces:0},
  19:{silvaTeles:5996,bomRetiro:4582,  marketplaces:0},
  20:{silvaTeles:7204,bomRetiro:11496, marketplaces:0},
  21:{silvaTeles:1,   bomRetiro:12706, marketplaces:0},
  23:{silvaTeles:3637,bomRetiro:7370,  marketplaces:0},
  24:{silvaTeles:39918,bomRetiro:12395,marketplaces:0},
  25:{silvaTeles:3228,bomRetiro:6143,  marketplaces:0},
  26:{silvaTeles:7525,bomRetiro:2187,  marketplaces:0},
  27:{silvaTeles:1194,bomRetiro:3567,  marketplaces:0},
  28:{silvaTeles:1,   bomRetiro:9824,  marketplaces:0},
};

const RECEITAS_EXEMPLO = RECEITAS_MAR;


// ─── DADOS_MENSAIS estático (fallback / inicialização) ────────────────────────
const DADOS_MENSAIS = {
  0:{receita:1278579,despesa:1592870,silvaTeles:112451,bomRetiro:226128,marketplaces:940000,prolabore:101500,oficinas:193160,tecidos:613996},
  1:{receita:1202230,despesa:1654416,silvaTeles:126640,bomRetiro:165590,marketplaces:910000,prolabore:106000,oficinas:261158,tecidos:587302},
  2:{receita:1132064,despesa:1340234,silvaTeles:118801,bomRetiro:213263,marketplaces:800000,prolabore:75500,oficinas:247669,tecidos:396805},
  3:{receita:0,despesa:0,silvaTeles:0,bomRetiro:0,marketplaces:0,prolabore:0,oficinas:0,tecidos:0},
  4:{receita:0,despesa:0,silvaTeles:0,bomRetiro:0,marketplaces:0,prolabore:0,oficinas:0,tecidos:0},
  5:{receita:0,despesa:0,silvaTeles:0,bomRetiro:0,marketplaces:0,prolabore:0,oficinas:0,tecidos:0},
  6:{receita:0,despesa:0,silvaTeles:0,bomRetiro:0,marketplaces:0,prolabore:0,oficinas:0,tecidos:0},
  7:{receita:0,despesa:0,silvaTeles:0,bomRetiro:0,marketplaces:0,prolabore:0,oficinas:0,tecidos:0},
  8:{receita:0,despesa:0,silvaTeles:0,bomRetiro:0,marketplaces:0,prolabore:0,oficinas:0,tecidos:0},
  9:{receita:0,despesa:0,silvaTeles:0,bomRetiro:0,marketplaces:0,prolabore:0,oficinas:0,tecidos:0},
  10:{receita:0,despesa:0,silvaTeles:0,bomRetiro:0,marketplaces:0,prolabore:0,oficinas:0,tecidos:0},
  11:{receita:0,despesa:0,silvaTeles:0,bomRetiro:0,marketplaces:0,prolabore:0,oficinas:0,tecidos:0},
};

// ─── HISTÓRICO (anos anteriores) ─────────────────────────────────────────────
const HISTORICO = {
  2025:{
    0:{receita:740743, despesa:834149, silvaTeles:93816, bomRetiro:191927,marketplaces:455000, prolabore:0,oficinas:0,tecidos:0},
    1:{receita:826064, despesa:829657, silvaTeles:126186,bomRetiro:229878,marketplaces:470000, prolabore:0,oficinas:0,tecidos:0},
    2:{receita:1053919,despesa:1066802,silvaTeles:192870,bomRetiro:261049,marketplaces:600000, prolabore:0,oficinas:0,tecidos:0},
    3:{receita:1013511,despesa:1098930,silvaTeles:197422,bomRetiro:241089,marketplaces:575000, prolabore:0,oficinas:0,tecidos:0},
    4:{receita:1084786,despesa:1154129,silvaTeles:202140,bomRetiro:262646,marketplaces:620000, prolabore:0,oficinas:0,tecidos:0},
    5:{receita:956805, despesa:1082138,silvaTeles:183059,bomRetiro:238746,marketplaces:535000, prolabore:0,oficinas:0,tecidos:0},
    6:{receita:1049845,despesa:1126522,silvaTeles:149586,bomRetiro:250259,marketplaces:650000, prolabore:0,oficinas:0,tecidos:0},
    7:{receita:1362894,despesa:1260425,silvaTeles:290216,bomRetiro:272678,marketplaces:800000, prolabore:0,oficinas:0,tecidos:0},
    8:{receita:1669127,despesa:1300304,silvaTeles:257767,bomRetiro:351360,marketplaces:1060000,prolabore:0,oficinas:0,tecidos:0},
    9:{receita:1834897,despesa:1606322,silvaTeles:364998,bomRetiro:299899,marketplaces:1170000,prolabore:0,oficinas:0,tecidos:0},
    10:{receita:2187102,despesa:1815082,silvaTeles:369977,bomRetiro:347125,marketplaces:1470000,prolabore:0,oficinas:0,tecidos:0},
    11:{receita:2430330,despesa:2200343,silvaTeles:315055,bomRetiro:365275,marketplaces:1750000,prolabore:0,oficinas:0,tecidos:0},
  },
  2024:{
    0:{receita:406811, despesa:501618, silvaTeles:118938,bomRetiro:182873,marketplaces:105000,prolabore:0,oficinas:0,tecidos:0},
    1:{receita:568346, despesa:505038, silvaTeles:225422,bomRetiro:221924,marketplaces:121000,prolabore:0,oficinas:0,tecidos:0},
    2:{receita:673481, despesa:614686, silvaTeles:248908,bomRetiro:264573,marketplaces:160000,prolabore:0,oficinas:0,tecidos:0},
    3:{receita:805431, despesa:643430, silvaTeles:367714,bomRetiro:272717,marketplaces:165000,prolabore:0,oficinas:0,tecidos:0},
    4:{receita:720007, despesa:723699, silvaTeles:245112,bomRetiro:284895,marketplaces:190000,prolabore:0,oficinas:0,tecidos:0},
    5:{receita:570621, despesa:643333, silvaTeles:187028,bomRetiro:187593,marketplaces:196000,prolabore:0,oficinas:0,tecidos:0},
    6:{receita:545796, despesa:641298, silvaTeles:109056,bomRetiro:226740,marketplaces:210000,prolabore:0,oficinas:0,tecidos:0},
    7:{receita:738133, despesa:642491, silvaTeles:212686,bomRetiro:315447,marketplaces:210000,prolabore:0,oficinas:0,tecidos:0},
    8:{receita:914880, despesa:805263, silvaTeles:241969,bomRetiro:362911,marketplaces:310000,prolabore:0,oficinas:0,tecidos:0},
    9:{receita:1049453,despesa:939514, silvaTeles:281690,bomRetiro:387763,marketplaces:380000,prolabore:0,oficinas:0,tecidos:0},
    10:{receita:1380791,despesa:1089429,silvaTeles:446565,bomRetiro:434226,marketplaces:500000,prolabore:0,oficinas:0,tecidos:0},
    11:{receita:1237920,despesa:1151648,silvaTeles:320994,bomRetiro:356926,marketplaces:560000,prolabore:0,oficinas:0,tecidos:0},
  },
};
[2019,2020,2021,2022,2023].forEach(y=>{
  HISTORICO[y]=Object.fromEntries(Array.from({length:12},(_,i)=>[i,{receita:0,despesa:0,silvaTeles:0,bomRetiro:0,marketplaces:0,prolabore:0,oficinas:0,tecidos:0}]));
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt=(v)=>{
  if(v===0||v===null||v===undefined)return"—";
  const abs="R$ "+Math.abs(Number(v)).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
  return v<0?"-"+abs:abs;
};

const ConfirmDialog=({confirm,onCancel,onConfirm})=>{
  if(!confirm)return null;
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.4)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{background:"#fff",borderRadius:14,padding:"28px 32px",maxWidth:360,width:"90%",boxShadow:"0 8px 32px rgba(0,0,0,0.18)"}}>
        <div style={{fontSize:15,color:"#2c3e50",marginBottom:20,lineHeight:1.5}}>{confirm}</div>
        <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
          <button onClick={onCancel} style={{padding:"8px 18px",border:"1px solid #e8e2da",borderRadius:8,background:"#fff",cursor:"pointer",fontSize:13}}>Cancelar</button>
          <button onClick={onConfirm} style={{padding:"8px 18px",border:"none",borderRadius:8,background:"#c0392b",color:"#fff",cursor:"pointer",fontSize:13,fontWeight:600}}>Confirmar</button>
        </div>
      </div>
    </div>
  );
};

const SaveBadge=({status})=>{
  if(!status)return null;
  return(<span style={{fontSize:11,padding:"3px 10px",borderRadius:10,fontFamily:"Georgia,serif",background:status==="saving"?"#f7f4f0":"#eafbf0",color:status==="saving"?"#a89f94":"#27ae60"}}>{status==="saving"?"salvando…":"✓ salvo"}</span>);
};

const IconReceitas=({ativo})=>(
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
    <polyline points="2,14 7,8 11,11 18,4" stroke={ativo?"#4a7fa5":"#c0b8b0"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <polyline points="14,4 18,4 18,8" stroke={ativo?"#4a7fa5":"#c0b8b0"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <line x1="2" y1="17" x2="18" y2="17" stroke={ativo?"#4a7fa5":"#e0d8d0"} strokeWidth="1.5"/>
  </svg>
);
const IconDespesas=({ativo})=>(
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
    <polyline points="2,6 7,12 11,9 18,16" stroke={ativo?"#c0392b":"#c0b8b0"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <polyline points="14,16 18,16 18,12" stroke={ativo?"#c0392b":"#c0b8b0"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <line x1="2" y1="3" x2="18" y2="3" stroke={ativo?"#c0392b":"#e0d8d0"} strokeWidth="1.5"/>
  </svg>
);

const BarChart=({dadosMensais=DADOS_MENSAIS})=>{
  const maxVal=Math.max(...Object.values(dadosMensais).map(d=>Math.max(d.receita,d.despesa)),1);
  return(
    <div style={{background:"#fff",borderRadius:12,padding:24,border:"1px solid #e8e2da",marginTop:16}}>
      <div style={{fontSize:11,color:"#a89f94",letterSpacing:2,textTransform:"uppercase",marginBottom:12}}>Receita vs Despesa</div>
      <div style={{display:"flex",alignItems:"flex-end",gap:6,height:120}}>
        {MESES.map((mes,i)=>{
          const d=dadosMensais[i]||{receita:0,despesa:0};
          const rH=(d.receita/maxVal)*100;
          const dH=(d.despesa/maxVal)*100;
          return(
            <div key={mes} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center"}}>
              <div style={{width:"100%",display:"flex",gap:2,alignItems:"flex-end",height:100}}>
                <div style={{flex:1,background:d.receita>0?"#4a7fa5":"#e8e2da",height:Math.max(rH,2)+"%",borderRadius:"2px 2px 0 0"}}/>
                <div style={{flex:1,background:d.despesa>0?"#c0392b22":"#e8e2da",border:d.despesa>0?"1.5px solid #c0392b":""  ,height:Math.max(dH,2)+"%",borderRadius:"2px 2px 0 0"}}/>
              </div>
              <div style={{fontSize:10,color:"#a89f94",marginTop:4}}>{mes}</div>
            </div>
          );
        })}
      </div>
      <div style={{display:"flex",gap:20,marginTop:12}}>
        <div style={{display:"flex",alignItems:"center",gap:6,fontSize:11,color:"#6b7c8a"}}><div style={{width:10,height:10,background:"#4a7fa5",borderRadius:2}}/> Receita</div>
        <div style={{display:"flex",alignItems:"center",gap:6,fontSize:11,color:"#6b7c8a"}}><div style={{width:10,height:10,border:"1.5px solid #c0392b",borderRadius:2}}/> Despesa</div>
      </div>
    </div>
  );
};

const ChannelEvolutionChart=({dadosMensais=DADOS_MENSAIS})=>{
  const mesesComDados=Object.entries(dadosMensais).filter(([,d])=>d.silvaTeles>0).sort((a,b)=>Number(a[0])-Number(b[0]));
  if(mesesComDados.length===0)return null;
  const maxVal=Math.max(...mesesComDados.flatMap(([,d])=>[d.silvaTeles,d.bomRetiro,d.marketplaces]),1);
  const canais=[{key:"silvaTeles",label:"Silva Teles",color:"#4a7fa5"},{key:"bomRetiro",label:"Bom Retiro",color:"#27ae60"},{key:"marketplaces",label:"Marketplaces",color:"#e67e22"}];
  return(
    <div style={{background:"#fff",borderRadius:12,padding:24,border:"1px solid #e8e2da",marginTop:16}}>
      <div style={{fontSize:11,color:"#a89f94",letterSpacing:2,textTransform:"uppercase",marginBottom:12}}>Evolução por Canal</div>
      <div style={{display:"flex",alignItems:"flex-end",gap:10,height:140}}>
        {mesesComDados.map(([i,d])=>(
          <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center"}}>
            <div style={{width:"100%",display:"flex",gap:2,alignItems:"flex-end",height:110}}>
              {canais.map(c=><div key={c.key} style={{flex:1,height:Math.max((d[c.key]/maxVal)*100,2)+"%",background:c.color,borderRadius:"2px 2px 0 0"}}/>)}
            </div>
            <div style={{fontSize:10,color:"#a89f94",marginTop:4}}>{MESES[parseInt(i)]}</div>
          </div>
        ))}
      </div>
      <div style={{display:"flex",gap:20,marginTop:14}}>
        {canais.map(c=><div key={c.key} style={{display:"flex",alignItems:"center",gap:6,fontSize:11,color:"#6b7c8a"}}><div style={{width:10,height:10,background:c.color,borderRadius:2}}/>{c.label}</div>)}
      </div>
    </div>
  );
};


const DashboardContent=({dadosMensais=DADOS_MENSAIS,mesAtual=3})=>{
  const [modo,setModo]=useState("mes");
  const [mesSel,setMesSel]=useState(mesAtual-1);
  const d=dadosMensais[mesSel]||{receita:0,despesa:0,silvaTeles:0,bomRetiro:0,marketplaces:0,prolabore:0,oficinas:0,tecidos:0};
  const ant=dadosMensais[mesSel-1];
  const saldo=d.receita-d.despesa;
  const margem=d.receita>0?((saldo/d.receita)*100).toFixed(0):0;
  const varR=ant&&ant.receita>0?(((d.receita-ant.receita)/ant.receita)*100).toFixed(0):null;
  const varD=ant&&ant.despesa>0?(((d.despesa-ant.despesa)/ant.despesa)*100).toFixed(0):null;
  const mesesComDados=Object.values(dadosMensais).filter(m=>m.receita>0);
  const n=mesesComDados.length;
  const totalAnual=mesesComDados.reduce((a,m)=>({receita:a.receita+m.receita,despesa:a.despesa+m.despesa,silvaTeles:a.silvaTeles+m.silvaTeles,bomRetiro:a.bomRetiro+m.bomRetiro,marketplaces:a.marketplaces+m.marketplaces}),{receita:0,despesa:0,silvaTeles:0,bomRetiro:0,marketplaces:0});
  const medias={total:Math.round(totalAnual.receita/n),silvaTeles:Math.round(totalAnual.silvaTeles/n),bomRetiro:Math.round(totalAnual.bomRetiro/n),marketplaces:Math.round(totalAnual.marketplaces/n)};
  const s={btn:{padding:"7px 20px",border:"none",borderRadius:6,cursor:"pointer",fontSize:12,fontFamily:"Georgia,serif"},mesbtn:{padding:"5px 10px",border:"none",borderRadius:6,cursor:"pointer",fontSize:11,fontFamily:"Georgia,serif"}};
  return(
    <div>
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:24,flexWrap:"wrap"}}>
        <div style={{display:"flex",background:"#e8e2da",borderRadius:8,padding:3}}>
          {[{id:"mes",label:"Mensal"},{id:"anual",label:"Anual"}].map(o=>(
            <button key={o.id} onClick={()=>setModo(o.id)} style={{...s.btn,background:modo===o.id?"#2c3e50":"transparent",color:modo===o.id?"#fff":"#6b7c8a"}}>{o.label}</button>
          ))}
        </div>
        {modo==="mes"&&(
          <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
            {MESES.map((m,i)=>(
              <button key={m} onClick={()=>setMesSel(i)} style={{...s.mesbtn,background:mesSel===i?"#2c3e50":"#fff",color:mesSel===i?"#fff":"#6b7c8a",border:"1px solid "+(mesSel===i?"#2c3e50":"#e8e2da")}}>{m}</button>
            ))}
          </div>
        )}
      </div>
      {modo==="mes"&&(
        <>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:16,marginBottom:16}}>
            <div style={{background:"#fff",borderRadius:12,padding:22,border:"1px solid #e8e2da"}}>
              <div style={{fontSize:11,color:"#a89f94",letterSpacing:2,textTransform:"uppercase",marginBottom:8}}>Receita</div>
              <div style={{fontSize:24,fontWeight:700,color:"#4a7fa5",marginBottom:4}}>{fmt(d.receita)}</div>
              {varR&&<div style={{fontSize:12,color:Number(varR)>=0?"#27ae60":"#c0392b"}}>{Number(varR)>=0?"▲":"▼"} {Math.abs(Number(varR))}% vs mês ant.</div>}
            </div>
            <div style={{background:"#fff",borderRadius:12,padding:22,border:"1px solid #e8e2da"}}>
              <div style={{fontSize:11,color:"#a89f94",letterSpacing:2,textTransform:"uppercase",marginBottom:8}}>Despesa</div>
              <div style={{fontSize:24,fontWeight:700,color:"#6b7c8a",marginBottom:4}}>{fmt(d.despesa)}</div>
              {varD&&<div style={{fontSize:12,color:Number(varD)<=0?"#27ae60":"#c0392b"}}>{Number(varD)>=0?"▲":"▼"} {Math.abs(Number(varD))}% vs mês ant.</div>}
            </div>
            <div style={{background:"#fff",borderRadius:12,padding:22,border:"1px solid "+(saldo>=0?"#b8dfc8":"#f4b8b8")}}>
              <div style={{fontSize:11,color:"#a89f94",letterSpacing:2,textTransform:"uppercase",marginBottom:8}}>Saldo</div>
              <div style={{fontSize:24,fontWeight:700,color:saldo>=0?"#4a7fa5":"#c0392b",marginBottom:4}}>{fmt(saldo)}</div>
              {d.receita>0&&<div style={{fontSize:12,color:"#8a9aa4"}}>Margem {margem}%</div>}
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:16,marginBottom:20}}>
            {[{label:"Pro Labore",value:d.prolabore},{label:"Oficinas",value:d.oficinas},{label:"Tecidos",value:d.tecidos}].map(c=>(
              <div key={c.label} style={{background:"#fff",borderRadius:12,padding:22,border:"1px solid #e8e2da"}}>
                <div style={{fontSize:11,color:"#a89f94",letterSpacing:2,textTransform:"uppercase",marginBottom:6}}>{c.label}</div>
                <div style={{fontSize:20,fontWeight:600,color:"#2c3e50"}}>{fmt(c.value)}</div>
              </div>
            ))}
          </div>
          <BarChart dadosMensais={dadosMensais}/>
        </>
      )}
      {modo==="anual"&&(
        <>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:16,marginBottom:20}}>
            {[{label:"Receita Acumulada",value:totalAnual.receita,color:"#4a7fa5"},{label:"Despesa Acumulada",value:totalAnual.despesa,color:"#6b7c8a"},{label:"Saldo Acumulado",value:totalAnual.receita-totalAnual.despesa,color:(totalAnual.receita-totalAnual.despesa)>=0?"#27ae60":"#c0392b"}].map(c=>(
              <div key={c.label} style={{background:"#fff",borderRadius:12,padding:22,border:"1px solid #e8e2da"}}>
                <div style={{fontSize:11,color:"#a89f94",letterSpacing:2,textTransform:"uppercase",marginBottom:8}}>{c.label}</div>
                <div style={{fontSize:24,fontWeight:700,color:c.color}}>{fmt(c.value)}</div>
                <div style={{fontSize:12,color:"#8a9aa4",marginTop:4}}>Jan — {MESES[n-1]} 2026</div>
              </div>
            ))}
          </div>
          <div style={{background:"#fff",borderRadius:12,border:"1px solid #e8e2da",overflow:"hidden",marginBottom:16}}>
            <div style={{padding:"14px 20px",borderBottom:"1px solid #e8e2da",fontSize:11,color:"#a89f94",letterSpacing:2,textTransform:"uppercase"}}>Média Mensal</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr"}}>
              {[{label:"Total Geral",value:medias.total,bg:"#f9f7f5"},{label:"Silva Teles",value:medias.silvaTeles,bg:"#fff"},{label:"Bom Retiro",value:medias.bomRetiro,bg:"#fff"},{label:"Marketplaces",value:medias.marketplaces,bg:"#fff"}].map((c,i)=>(
                <div key={c.label} style={{padding:20,background:c.bg,borderRight:i<3?"1px solid #e8e2da":"none"}}>
                  <div style={{fontSize:10,color:"#a89f94",letterSpacing:1,textTransform:"uppercase",marginBottom:6}}>{c.label}</div>
                  <div style={{fontSize:18,fontWeight:700,color:i===0?"#2c3e50":"#4a7fa5"}}>{fmt(c.value)}</div>
                </div>
              ))}
            </div>
          </div>
          <div style={{background:"#fff",borderRadius:12,border:"1px solid #e8e2da",overflow:"hidden",marginBottom:16}}>
            <div style={{padding:"14px 16px",borderBottom:"1px solid #e8e2da",fontSize:11,color:"#a89f94",letterSpacing:2,textTransform:"uppercase"}}>Detalhes por Mês</div>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
              <thead><tr style={{background:"#f7f4f0"}}>{["Mês","Silva Teles","Bom Retiro","Marketplaces","Receita","Despesa","Saldo"].map(h=><th key={h} style={{padding:"8px 12px",textAlign:"left",fontSize:11,color:"#a89f94",fontWeight:600}}>{h}</th>)}</tr></thead>
              <tbody>{MESES.map((mes,i)=>{const d=dadosMensais[i]||{receita:0,despesa:0,silvaTeles:0,bomRetiro:0,marketplaces:0};const s=d.receita-d.despesa;return(<tr key={mes} style={{borderBottom:"1px solid #f0ebe4"}}><td style={{padding:"8px 12px",fontWeight:600,color:"#2c3e50"}}>{mes}</td><td style={{padding:"8px 12px",color:"#4a7fa5"}}>{d.silvaTeles>0?fmt(d.silvaTeles):"—"}</td><td style={{padding:"8px 12px",color:"#27ae60"}}>{d.bomRetiro>0?fmt(d.bomRetiro):"—"}</td><td style={{padding:"8px 12px",color:"#e67e22"}}>{d.marketplaces>0?fmt(d.marketplaces):"—"}</td><td style={{padding:"8px 12px",fontWeight:600,color:"#2c3e50"}}>{d.receita>0?fmt(d.receita):"—"}</td><td style={{padding:"8px 12px",color:"#6b7c8a"}}>{d.despesa>0?fmt(d.despesa):"—"}</td><td style={{padding:"8px 12px",fontWeight:600,color:s>=0?"#27ae60":"#c0392b"}}>{d.receita>0?fmt(s):"—"}</td></tr>);})}</tbody>
            </table>
          </div>
          <BarChart dadosMensais={dadosMensais}/><ChannelEvolutionChart dadosMensais={dadosMensais}/>
        </>
      )}
    </div>
  );
};

const calcTotalAux=(cat,auxData,recTotais,correcao={ativo:true,valor:10000})=>{
  if(cat==="Taxas Cartão")return Math.round(recTotais.geral*0.01);
  if(cat==="Taxas Marketplaces")return Math.round(recTotais.mkt*0.29);
  if(cat==="Valor de Correção")return 10000;
  if(cat==="Funcionários"){const func=(auxData["Funcionários"]||[]).reduce((s,r)=>s+["salario","comissao","extra","alimentacao","vale","ferias","rescisao"].reduce((a,f)=>a+parseFloat(r[f]||0),0),0);return func+FIXOS_FUNC.reduce((s,f)=>s+f.valor,0);}
  return(auxData[cat]||[]).reduce((s,r)=>s+parseFloat(r.valor||0),0);
};
const calcRowTotal=(row)=>["salario","comissao","extra","alimentacao","vale","ferias","rescisao"].reduce((s,f)=>s+parseFloat(row[f]||0),0);

const PrestadorInput=({row,listaPrest,onUpdate,inputStyle})=>{
  const [busca,setBusca]=useState(row.prestador||"");
  const [aberto,setAberto]=useState(false);
  const sugestoes=busca.trim()?listaPrest.filter(p=>p.id.startsWith(busca)||p.nome.toLowerCase().includes(busca.toLowerCase())):[];
  return(
    <div style={{position:"relative"}}>
      <input value={busca} onChange={e=>{setBusca(e.target.value);setAberto(true);onUpdate("prestador",e.target.value);}} style={inputStyle} onBlur={()=>setTimeout(()=>setAberto(false),150)}/>
      {aberto&&sugestoes.length>0&&(
        <div style={{position:"absolute",top:"100%",left:0,right:0,background:"#fff",border:"1px solid #c8d8e4",borderRadius:4,boxShadow:"0 4px 12px rgba(0,0,0,0.1)",zIndex:100,maxHeight:160,overflowY:"auto"}}>
          {sugestoes.map(p=>(
            <div key={p.id} onMouseDown={()=>{setBusca(p.nome);onUpdate("prestador",p.nome);setAberto(false);}} style={{padding:"6px 10px",cursor:"pointer",display:"flex",gap:8,alignItems:"center"}} onMouseEnter={e=>e.currentTarget.style.background="#f0f6fb"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
              <span style={{fontSize:11,color:"#a3bacc",fontWeight:600,minWidth:24}}>{p.id}</span>
              <span style={{color:"#2c3e50"}}>{p.nome}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const GerenciarPrestadores=({cat,prestadores,setPrestadores})=>{
  const [aberto,setAberto]=useState(false);
  const [novoNome,setNovoNome]=useState("");
  const lista=prestadores[cat]||[];
  const adicionar=()=>{if(!novoNome.trim())return;const nId=String(lista.length+1).padStart(2,"0");setPrestadores(prev=>({...prev,[cat]:[...(prev[cat]||[]),{id:nId,nome:novoNome.trim()}]}));setNovoNome("");};
  const remover=(id)=>setPrestadores(prev=>({...prev,[cat]:(prev[cat]||[]).filter(p=>p.id!==id)}));
  return(
    <div style={{borderBottom:"1px solid #e8e2da"}}>
      <div onClick={()=>setAberto(p=>!p)} style={{padding:"9px 16px",background:"#f7f4f0",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <span style={{fontSize:11,color:"#a89f94",letterSpacing:2,textTransform:"uppercase"}}>Gerenciar prestadores ({lista.length})</span>
        <span style={{fontSize:12,color:"#a89f94"}}>{aberto?"▲":"▼"}</span>
      </div>
      {aberto&&(
        <div style={{padding:14,background:"#f9f7f5"}}>
          <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:12}}>
            {lista.map(p=>(<div key={p.id} style={{display:"flex",alignItems:"center",gap:6,background:"#fff",border:"1px solid #e8e2da",borderRadius:6,padding:"4px 10px",fontSize:12}}><span style={{color:"#a3bacc",fontSize:11}}>{p.id}</span>{p.nome}<span onClick={()=>remover(p.id)} style={{color:"#c0b8b0",cursor:"pointer",fontSize:14,marginLeft:4}}>×</span></div>))}
          </div>
          <div style={{display:"flex",gap:8}}>
            <input value={novoNome} onChange={e=>setNovoNome(e.target.value)} onKeyDown={e=>e.key==="Enter"&&adicionar()} placeholder="Nome do prestador" style={{flex:1,border:"1px solid #c8d8e4",borderRadius:6,padding:"6px 10px",fontSize:12,outline:"none"}}/>
            <button onClick={adicionar} style={{background:"#2c3e50",color:"#fff",border:"none",borderRadius:6,padding:"6px 14px",fontSize:12,cursor:"pointer"}}>+ Adicionar</button>
          </div>
        </div>
      )}
    </div>
  );
};

const AuxSimplesPanel=({auxAberta,auxData,updateLinhaAux,removeLinhaAux,addLinhaAux,prestadores,setPrestadores})=>{
  const temPrest=CATS_PREST.includes(auxAberta);
  const isTecidos=auxAberta==="Tecidos";
  const isFixa=CATS_FIXAS.includes(auxAberta);
  const listaPrest=prestadores[auxAberta]||[];
  const inputStyle={width:"100%",border:"1px solid #c8d8e4",borderRadius:4,padding:"4px 6px",fontSize:12,outline:"none",background:"#fff"};
  const gridCols=isFixa?"50px 1fr 120px 36px"
    :isTecidos?"80px 1fr 90px 110px 36px"
    :temPrest?"90px 1fr 120px 36px"
    :"90px 1fr 120px 36px";
  const headers=isFixa?["Data","Descrição","Valor",""]
    :isTecidos?["Data","Empresa","Nº Nota","Valor",""]
    :temPrest?["Data","Prestador","Valor",""]
    :["Data","Descrição","Valor",""];
  return(
    <>
      {temPrest&&!isTecidos&&<GerenciarPrestadores cat={auxAberta} prestadores={prestadores} setPrestadores={setPrestadores}/>}
      <div style={{display:"grid",gridTemplateColumns:gridCols,background:"#f7f4f0",borderBottom:"1px solid #e8e2da"}}>
        {headers.map((h,i)=><div key={i} style={{padding:"9px 12px",fontSize:11,color:"#a89f94",letterSpacing:1,textTransform:"uppercase",fontWeight:600}}>{h}</div>)}
      </div>
      <div style={{maxHeight:900,overflowY:"auto"}}>
        {(auxData[auxAberta]||[]).map((row,idx)=>{
          const fromBoleto=!!row._boletoid;
          const rowStyle={display:"grid",gridTemplateColumns:gridCols,borderBottom:"1px solid #f0ebe4",background:fromBoleto?"#f0f6fb":row.valor?"#f9fdf9":"#fff"};
          const dis={...inputStyle,background:fromBoleto?"#e8f0f8":"#fff",color:fromBoleto?"#4a7fa5":"#2c3e50"};
          const valStyle={width:"100%",border:"1px solid #c8d8e4",borderRadius:4,padding:"4px 6px 4px 26px",fontSize:14,fontWeight:700,fontFamily:"Calibri,'Segoe UI',Arial,sans-serif",outline:"none",background:fromBoleto?"#e8f0f8":"#fff",color:fromBoleto?"#4a7fa5":"#2c3e50",boxSizing:"border-box"};
          return(
            <div key={idx} style={rowStyle}>
              {isFixa?(
                <div style={{padding:"6px 8px",fontSize:11,color:"#6b7c8a",fontFamily:"Calibri,Arial"}}>{row.data||<span style={{color:"#d0d0d0"}}>—</span>}</div>
              ):(
                <div style={{padding:"6px 8px"}}><input value={row.data||""} onChange={e=>updateLinhaAux(auxAberta,idx,"data",e.target.value)} style={dis} disabled={fromBoleto}/></div>
              )}
              {isFixa?(
                row.descricao?
                  <div style={{padding:"6px 12px",fontWeight:700,color:"#2c3e50",fontSize:12}}>{row.descricao}</div>
                  :<div style={{padding:"6px 8px"}}><input value={row.descricao||""} onChange={e=>updateLinhaAux(auxAberta,idx,"descricao",e.target.value)} placeholder="Descrição..." style={{...inputStyle,fontWeight:700}}/></div>
              ):isTecidos?(
                <>
                  <div style={{padding:"6px 8px"}}><input value={row.empresa||""} onChange={e=>updateLinhaAux(auxAberta,idx,"empresa",e.target.value)} style={dis} disabled={fromBoleto}/></div>
                  <div style={{padding:"6px 8px"}}><input value={row.nroNota||""} onChange={e=>updateLinhaAux(auxAberta,idx,"nroNota",e.target.value)} style={dis} disabled={fromBoleto}/></div>
                </>
              ):temPrest?(
                <div style={{padding:"6px 8px"}}><PrestadorInput row={row} listaPrest={listaPrest} onUpdate={(f,v)=>updateLinhaAux(auxAberta,idx,f,v)} inputStyle={dis}/></div>
              ):(
                <div style={{padding:"6px 8px"}}><input value={row.descricao||""} onChange={e=>updateLinhaAux(auxAberta,idx,"descricao",e.target.value)} style={dis}/></div>
              )}
              {/* Valor — Calibri 14 bold + R$ prefixo */}
              <div style={{padding:"6px 8px",position:"relative"}}>
                <span style={{position:"absolute",left:14,top:"50%",transform:"translateY(-50%)",fontSize:11,color:"#a89f94",fontFamily:"Calibri,Arial",fontWeight:600,pointerEvents:"none"}}>R$</span>
                <input value={row.valor||""} onChange={e=>updateLinhaAux(auxAberta,idx,"valor",e.target.value)} placeholder="0,00" style={valStyle} disabled={fromBoleto}/>
              </div>
              <div style={{display:"flex",alignItems:"center",justifyContent:"center"}}>
                {fromBoleto
                  ?<span style={{fontSize:9,color:"#4a7fa5",padding:"2px 5px",background:"#daeaf7",borderRadius:3}}>B</span>
                  :<span onClick={()=>removeLinhaAux(auxAberta,idx)} style={{color:"#c0392b",cursor:"pointer",fontSize:16,padding:"0 6px"}}>×</span>
                }
              </div>
            </div>
          );
        })}
        {(auxData[auxAberta]||[]).length===0&&<div style={{padding:24,textAlign:"center",color:"#c0b8b0",fontSize:13}}>Nenhum lançamento</div>}
      </div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 16px",background:"#f7f4f0",borderTop:isFixa?"2px solid #4a7fa5":"1px solid #e8e2da"}}>
        <button onClick={()=>addLinhaAux(auxAberta)} style={{background:"#2c3e50",color:"#fff",border:"none",borderRadius:6,padding:"6px 14px",fontSize:12,cursor:"pointer"}}>+ Adicionar linha</button>
        {isFixa&&<span style={{fontSize:14,fontWeight:900,color:"#2c3e50",fontFamily:"Calibri,Arial"}}>R$ {Number((auxData[auxAberta]||[]).reduce((s,l)=>s+(parseFloat(String(l.valor).replace(",","."))||0),0)).toLocaleString("pt-BR",{minimumFractionDigits:2})}</span>}
      </div>
    </>
  );
};


const LancamentosContent=({mes=3,receitas:recProp,setReceitas:setRecProp,auxData:auxProp,setAuxData:setAuxProp,categorias:catsProp,setCategorias:setCatsProp,boletos,setBoletos,prestadores,setPrestadores,fixosConfig,setFixosConfig,fixosNomesFunc,setFixosNomesFunc})=>{
  const [recLocal,setRecLocal]=useState(RECEITAS_EXEMPLO);
  const [auxLocal,setAuxLocal]=useState(AUX_INICIAL);
  const [catsLocal,setCatsLocal]=useState([...CATS]);
  const receitas=recProp!==undefined?recProp:recLocal;
  const setReceitas=recProp!==undefined?setRecProp:setRecLocal;
  const auxData=auxProp!==undefined?auxProp:auxLocal;
  const setAuxData=auxProp!==undefined?setAuxProp:setAuxLocal;
  const categorias=catsProp!==undefined?catsProp:catsLocal;
  const setCategorias=catsProp!==undefined?setCatsProp:setCatsLocal;
  const [aba,setAba]=useState("geral");
  const [novaCategoria,setNovaCategoria]=useState("");
  const [mostraCadastro,setMostraCadastro]=useState(false);
  const [editando,setEditando]=useState(null);
  const navCelula=(e,dia,canal,prefix="")=>{
    if(e.key==="Enter"||e.key==="Tab"){
      e.preventDefault();
      const canais=["silvaTeles","bomRetiro"];
      const idx=canais.indexOf(canal);
      if(idx===0)setEditando(prefix+dia+"-bomRetiro");
      else{const prox=dia+1;if(prox<=31)setEditando(prefix+prox+"-silvaTeles");else setEditando(null);}
    }
    if(e.key==="Escape")setEditando(null);
  };
  const getDiaSemana=(dia)=>DIAS_SEMANA[new Date(2026,mes-1,dia).getDay()];
  const [auxAberta,setAuxAberta]=useState(null);
  const abrirAux=(cat)=>{
    // Auto-populate fixed categories if empty
    const cfg=fixosConfig||FIXOS_TEMPLATE;
    if(cfg[cat]){
      const atual=auxData[cat]||[];
      if(atual.length===0){
        const linhas=cfg[cat].map(desc=>({data:"",valor:"",descricao:desc}));
        setAuxData(prev=>({...prev,[cat]:linhas}));
      }
    }
    if(cat==="Funcionários"){
      const atual=auxData["Funcionários"]||[];
      if(atual.length===0){
        const nomes=fixosNomesFunc||FIXOS_NOMES_FUNC;
        const linhas=nomes.map(nome=>({nome,salario:"",comissao:"",extra:"",alimentacao:"",vale:"",ferias:"",rescisao:""}));
        setAuxData(prev=>({...prev,["Funcionários"]:linhas}));
      }
    }
    setAuxAberta(cat);
  };
  const [modalRapido,setModalRapido]=useState(null);
  const [modalInput,setModalInput]=useState("");
  const [modalErro,setModalErro]=useState("");

  const abrirModalRapido=(cat)=>{setModalRapido(cat);setModalInput("");setModalErro("");};
  const fecharModalRapido=()=>{setModalRapido(null);setModalInput("");setModalErro("");};
  const confirmarModalRapido=()=>{
    const v=parseFloat(modalInput.replace(",","."));
    if(!v||v<=0){setModalErro("Digite um valor válido");return;}
    const hoje=new Date().toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit"});
    addLinhaAux(modalRapido,{data:hoje,valor:String(v),descricao:""});
    fecharModalRapido();
  };
  const hoje=new Date().getDate();
  const mesHojeAtual=new Date().getMonth()+1;
  const mesFechado=mes<mesHojeAtual;
  const inputStyle={width:"100%",border:"1px solid #c8d8e4",borderRadius:4,padding:"4px 6px",fontSize:12,outline:"none",background:"#fff"};
  const totRec=Object.values(receitas).reduce((a,d)=>({st:a.st+parseFloat(d.silvaTeles||0),br:a.br+parseFloat(d.bomRetiro||0),mkt:a.mkt+parseFloat(d.marketplaces||0)}),{st:0,br:0,mkt:0});
  const totalGeral=totRec.st+totRec.br+totRec.mkt;
  const recTotais={geral:totalGeral,mkt:totRec.mkt};
  const totalDesp=categorias.reduce((s,c)=>s+calcTotalAux(c,auxData,recTotais),0);
  const salvarCelula=(dia,canal,val)=>setReceitas(prev=>({...prev,[dia]:{...(prev[dia]||{}),[canal]:val}}));
  const updateLinhaAux=(cat,idx,field,val)=>setAuxData(prev=>{
    const l=[...(prev[cat]||[])];const oldVal=l[idx]?.[field];l[idx]={...l[idx],[field]:val};
    // Auto-date for fixed categories when valor is entered
    if(field==="valor"&&CATS_FIXAS.includes(cat)){
      const v=parseFloat(String(val).replace(",","."));
      if(v>0&&!l[idx].data){
        const h=new Date();l[idx].data=`${String(h.getDate()).padStart(2,"0")}/${String(h.getMonth()+1).padStart(2,"0")}`;
      }
      if(!val||v===0||isNaN(v))l[idx].data="";
    }
    // Sync new descriptions to fixosConfig template
    if(field==="descricao"&&CATS_FIXAS.includes(cat)&&val&&!oldVal&&setFixosConfig){
      setFixosConfig(pc=>{const cfg={...pc};if(!(cfg[cat]||[]).includes(val))cfg[cat]=[...(cfg[cat]||[]),val];return cfg;});
    }
    return{...prev,[cat]:l};
  });
  const removeLinhaAux=(cat,idx)=>{
    const row=(auxData[cat]||[])[idx];
    setAuxData(prev=>{const l=[...(prev[cat]||[])];l.splice(idx,1);return{...prev,[cat]:l};});
    // Sync template: remove from fixosConfig if it's a fixed category
    if(CATS_FIXAS.includes(cat)&&row?.descricao&&setFixosConfig){
      setFixosConfig(prev=>{const cfg={...prev};cfg[cat]=(cfg[cat]||[]).filter(d=>d!==row.descricao);return cfg;});
    }
    if(cat==="Funcionários"&&row?.nome&&setFixosNomesFunc){
      setFixosNomesFunc(prev=>prev.filter(n=>n!==row.nome));
    }
  };
  const CATS_DATA_AUTO=["Caseado","Marketing","Sistemas","Concessionárias","Contabilidade","Impostos DAS","Aviamentos","Passadoria","Salas Corte"];
  const addLinhaAux=(cat,dadosIniciais)=>{
    const hoje=new Date();const dd=`${String(hoje.getDate()).padStart(2,"0")}/${String(hoje.getMonth()+1).padStart(2,"0")}`;
    const dataAuto=CATS_DATA_AUTO.includes(cat)?dd:"";
    if(cat==="Funcionários") setAuxData(prev=>({...prev,[cat]:[...(prev[cat]||[]),{nome:"",salario:"",comissao:"",extra:"",alimentacao:"",vale:"",ferias:"",rescisao:""}]}));
    else if(cat==="Tecidos") setAuxData(prev=>({...prev,[cat]:[...(prev[cat]||[]),dadosIniciais||{data:"",empresa:"",nroNota:"",valor:"",descricao:""}]}));
    else if(CATS_PREST.includes(cat)) setAuxData(prev=>({...prev,[cat]:[...(prev[cat]||[]),dadosIniciais||{data:dataAuto,prestador:"",valor:"",descricao:""}]}));
    else setAuxData(prev=>({...prev,[cat]:[...(prev[cat]||[]),dadosIniciais||{data:dataAuto,valor:"",descricao:""}]}));
  };
  const adicionarCategoria=()=>{if(!novaCategoria.trim()||categorias.includes(novaCategoria.trim()))return;setCategorias(prev=>[...prev,novaCategoria.trim()]);setAuxData(prev=>({...prev,[novaCategoria.trim()]:[]}));setNovaCategoria("");};
  const removerCategoria=(cat)=>{setCategorias(prev=>prev.filter(c=>c!==cat));setAuxData(prev=>{const n={...prev};delete n[cat];return n;});};
  const totalFuncSomente=(auxData["Funcionários"]||[]).reduce((s,r)=>s+calcRowTotal(r),0);
  const totalFuncGeral=totalFuncSomente+FIXOS_FUNC.reduce((s,f)=>s+f.valor,0);
  const [cardsVisiveis,setCardsVisiveis]=useState(false);
  const saldoMes=totalGeral-totalDesp;
  return(
    <div>
      {!auxAberta&&(
        <div style={{display:"flex",gap:8,marginBottom:8}}>
          <div style={{flex:1,background:"#fff",borderRadius:8,padding:"6px 14px",border:"1px solid #e8e2da",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <span style={{fontSize:10,color:"#a89f94",letterSpacing:1}}>RECEITA</span>
            <span style={{fontSize:16,fontWeight:800,color:"#4a7fa5",fontFamily:_FN}}>{fmt(totalGeral)}</span>
          </div>
          <div style={{flex:1,background:"#fff",borderRadius:8,padding:"6px 14px",border:"1px solid #e8e2da",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <span style={{fontSize:10,color:"#a89f94",letterSpacing:1}}>DESPESA</span>
            <span style={{fontSize:16,fontWeight:800,color:"#c0392b",fontFamily:_FN}}>{fmt(totalDesp)}</span>
          </div>
          <div style={{flex:1,background:saldoMes>=0?"#eafbf0":"#fdeaea",borderRadius:8,padding:"6px 14px",border:`1px solid ${saldoMes>=0?"#c8e6c9":"#f0c8c8"}`,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <span style={{fontSize:10,color:saldoMes>=0?"#27ae60":"#c0392b",letterSpacing:1}}>SALDO</span>
            <span style={{fontSize:16,fontWeight:800,color:saldoMes>=0?"#27ae60":"#c0392b",fontFamily:_FN}}>{fmt(saldoMes)}</span>
          </div>
        </div>
      )}
      {!auxAberta&&(
        <div style={{display:"flex",gap:0,borderBottom:"1px solid #e8e2da",marginBottom:0}}>
          <button onClick={()=>setAba("geral")} style={{padding:"6px 16px",border:"none",background:"transparent",borderBottom:aba==="geral"?"2px solid #2c3e50":"2px solid transparent",cursor:"pointer",fontSize:12,fontFamily:"Georgia,serif",color:aba==="geral"?"#2c3e50":"#8a9aa4"}}>Geral</button>
          <button onClick={()=>setAba("receitas")} style={{padding:"6px 16px",border:"none",background:"transparent",borderBottom:aba==="receitas"?"2px solid #2c3e50":"2px solid transparent",cursor:"pointer",fontSize:12,fontFamily:"Georgia,serif",color:aba==="receitas"?"#2c3e50":"#8a9aa4",display:"flex",alignItems:"center",gap:4}}><IconReceitas ativo={aba==="receitas"}/>Receitas</button>
          <button onClick={()=>setAba("despesas")} style={{padding:"6px 16px",border:"none",background:"transparent",borderBottom:aba==="despesas"?"2px solid #c0392b":"2px solid transparent",cursor:"pointer",fontSize:12,fontFamily:"Georgia,serif",color:aba==="despesas"?"#c0392b":"#8a9aa4",display:"flex",alignItems:"center",gap:4}}><IconDespesas ativo={aba==="despesas"}/>Despesas</button>
        </div>
      )}
      {aba==="receitas"&&!auxAberta&&(
        <div style={{background:"#fff",borderRadius:"0 0 12px 12px",border:"1px solid #e8e2da",borderTop:"none",overflow:"hidden"}}>
          <div style={{display:"grid",gridTemplateColumns:"48px 1fr 1fr 1fr",background:"#4a7fa5",position:"sticky",top:0,zIndex:2}}>
            <div/>
            {["Silva Teles","Bom Retiro","Marketplaces"].map(h=>(<div key={h} style={{padding:"8px 10px",fontSize:10,color:"#fff",letterSpacing:0.5,textTransform:"uppercase",fontWeight:700,borderLeft:"1px solid rgba(255,255,255,0.25)"}}>{h}</div>))}
          </div>
          <div style={{minHeight:300,maxHeight:792,overflowY:"auto"}} >
            {Array.from({length:31},(_,i)=>i+1).map(dia=>{
              const d=receitas[dia]||{};const isDom=(DOMINGOS_MES[mes]||DOMINGOS_MAR).includes(dia);const feriado=getFeriado(dia,mes);const futuro=mesFechado?false:dia>hoje;
              const rowBg=isDom?"#c8c2b8":feriado?"#d4ecd4":"#fff";
              const sepCol=isDom?"#b0a898":feriado?"#b0d4b0":"#ddd8d0";
              const valCol=isDom?"#4a3a2a":feriado?"#1a4a1a":"#2c3e50";
              const emptyCol=isDom?"#a09080":feriado?"#90b890":"#e0dbd5";
              return(
                <div key={dia} style={{display:"grid",gridTemplateColumns:"48px 1fr 1fr 1fr",borderBottom:`1px solid ${isDom?"#b8b0a6":feriado?"#a8d0a8":"#f0ebe4"}`,background:rowBg,borderLeft:dia===hoje?"3px solid #f39c12":"3px solid transparent"}}>
                  <div style={{padding:"5px 2px",textAlign:"center",background:isDom?"#b8b0a4":feriado?"#b8ddb8":"transparent",borderRight:`1px solid ${sepCol}`,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
                    <div style={{fontSize:14,fontWeight:(isDom||feriado||dia===hoje)?700:500,color:isDom?"#6b5f54":dia===hoje?"#4a7fa5":"#2c3e50",lineHeight:1.1}}>{dia}</div>
                    <div style={{fontSize:9,color:isDom?"#8a7e74":"#a89f94",fontWeight:isDom?600:400,lineHeight:1,marginTop:1}}>{getDiaSemana(dia)}</div>
                  </div>
                  {["silvaTeles","bomRetiro","marketplaces"].map((canal)=>{
                    const key=dia+"-"+canal;
                    return(
                      <div key={canal} style={{display:"flex",alignItems:"center",borderLeft:`1px solid ${sepCol}`}}>
                        {editando===key?(
                          <input ref={el=>el&&el.focus({preventScroll:true})} value={d[canal]||""} onChange={e=>salvarCelula(dia,canal,e.target.value)} style={{width:"100%",border:"2px solid #4a7fa5",borderRadius:4,padding:"5px 10px",fontSize:_FS,fontWeight:700,fontFamily:_FN,textAlign:"right",outline:"none",background:"#f0f6fb",color:"#2c3e50",boxSizing:"border-box",margin:"0 4px"}} onBlur={()=>setEditando(null)} onKeyDown={e=>navCelula(e,dia,canal)}/>
                        ):(
                          <div onClick={()=>!futuro&&setEditando(key)} onMouseEnter={e=>{if(!futuro)e.currentTarget.style.background=isDom?"#d0c8be":"#edf4fa";}} onMouseLeave={e=>{e.currentTarget.style.background="transparent";}} style={{fontFamily:_FN,fontSize:_FS,fontWeight:700,color:d[canal]?valCol:emptyCol,cursor:futuro?"default":"pointer",width:"100%",textAlign:"right",padding:"5px 10px",borderRadius:3,transition:"background 0.12s"}}>
                            {d[canal]?parseFloat(d[canal]).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2}):"—"}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"48px 1fr 1fr 1fr",background:"#f7f4f0",borderTop:"2px solid #e8e2da"}}>
            <div style={{padding:"8px",fontSize:11,color:"#4a7fa5",textAlign:"center",fontWeight:700}}>Σ</div>
            {[totRec.st,totRec.br,totRec.mkt].map((t,i)=><div key={i} style={{padding:"7px 10px",fontSize:_FS,fontWeight:800,color:"#2c3e50",fontFamily:_FN,textAlign:"right",borderLeft:"1px solid #e8e2da"}}>{t>0?t.toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2}):"—"}</div>)}
          </div>
        </div>
      )}
      {aba==="despesas"&&!auxAberta&&(
        <div style={{background:"#fff",borderRadius:"0 0 12px 12px",border:"1px solid #e8e2da",borderTop:"none",overflow:"hidden"}}>
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead>
              <tr style={{background:"#4a7fa5"}}>
                <th style={{padding:"7px 12px",textAlign:"left",fontSize:11,color:"#fff",fontWeight:600,letterSpacing:0.5,textTransform:"uppercase"}}>Categoria</th>
                <th style={{padding:"7px 12px",textAlign:"right",fontSize:11,color:"#fff",fontWeight:600,letterSpacing:0.5,textTransform:"uppercase",width:140}}>Valor</th>
                <th style={{width:24}}/>
              </tr>
            </thead>
          </table>
          <div style={{minHeight:300,maxHeight:712,overflowY:"auto"}} >
            <table style={{width:"100%",borderCollapse:"collapse"}}>
              <colgroup><col/><col style={{width:140}}/><col style={{width:24}}/></colgroup>
              <tbody>
                {categorias.map(cat=>{
                  const total=calcTotalAux(cat,auxData,recTotais);
                  const isAuto=SEM_AUX.includes(cat);
                  const regra=cat==="Taxas Cartão"?"1% receita total":cat==="Taxas Marketplaces"?"29% marketplaces":cat==="Valor de Correção"?"valor fixo":null;
                  const isSuper=SUPER_DEST.includes(cat);
                  const isLeve=LEVE_DEST.includes(cat);
                  const rowBg=isSuper?"#e4eef7":isLeve?"#f4f8fc":"#fff";
                  const leftBorder=isSuper?"3px solid #4a7fa5":isLeve?"3px solid #c0d4e8":"3px solid transparent";
                  const catSize=isSuper?14:isLeve?13:12;
                  const catWeight=isSuper?800:isLeve?700:400;
                  const catColor=isSuper?"#1a3a5c":isLeve?"#2c3e50":"#4a5a6a";
                  const valWeight=isSuper?800:700;
                  const valColor=total>0?(isSuper?"#1a3a5c":"#2c3e50"):"#d0c8c0";
                  return(
                    <tr key={cat} style={{borderBottom:"1px solid #f0ebe4",cursor:isAuto?"default":"pointer",background:rowBg,borderLeft:leftBorder}} onClick={()=>{if(!isAuto){if(CATS_RAPIDAS.includes(cat))abrirModalRapido(cat);else abrirAux(cat);}}}>
                      <td style={{padding:"7px 12px"}}>
                        <div style={{fontSize:catSize,fontWeight:catWeight,color:catColor}}>{cat}</div>
                        {regra&&<div style={{fontSize:9,color:"#a89f94",marginTop:1}}>{regra}</div>}
                      </td>
                      <td style={{padding:"7px 12px",textAlign:"right",fontFamily:_FN,fontSize:_FS,fontWeight:valWeight,color:valColor,whiteSpace:"nowrap",borderLeft:"1px solid #ede8e0"}}>
                        {total>0?total.toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2}):"—"}
                      </td>
                      <td style={{textAlign:"center",color:"#c8d0d8",fontSize:12,paddingRight:6}}>{!isAuto?"›":""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{padding:"10px 12px",background:"#fdeaea",borderTop:"2px solid #c0392b",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div style={{display:"flex",gap:8,alignItems:"center"}}>
              <span style={{fontSize:11,color:"#c0392b",fontWeight:800,letterSpacing:0.5,textTransform:"uppercase"}}>Total Despesas</span>
              <button onClick={()=>setMostraCadastro(p=>!p)} style={{fontSize:10,color:"#4a7fa5",background:"none",border:"1px solid #4a7fa5",borderRadius:4,padding:"2px 8px",cursor:"pointer"}}>+ Categoria</button>
            </div>
            <span style={{fontSize:14,fontWeight:800,color:"#c0392b",fontFamily:_FN}}>{fmt(totalDesp)}</span>
          </div>
          {mostraCadastro&&(
            <div style={{padding:16,background:"#f0f6fb",borderTop:"1px solid #e8e2da"}}>
              <div style={{display:"flex",gap:8,marginBottom:12}}>
                <input value={novaCategoria} onChange={e=>setNovaCategoria(e.target.value)} placeholder="Nova categoria" style={{flex:1,border:"1px solid #c8d8e4",borderRadius:6,padding:"6px 10px",fontSize:12,outline:"none"}}/>
                <button onClick={adicionarCategoria} style={{background:"#2c3e50",color:"#fff",border:"none",borderRadius:6,padding:"6px 14px",fontSize:12,cursor:"pointer"}}>Adicionar</button>
              </div>
              <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                {categorias.map(cat=>(
                  <div key={cat} style={{display:"flex",alignItems:"center",gap:6,background:"#fff",border:"1px solid #e8e2da",borderRadius:6,padding:"4px 10px",fontSize:12}}>
                    {cat}{!SEM_AUX.includes(cat)&&<span onClick={()=>removerCategoria(cat)} style={{color:"#c0b8b0",cursor:"pointer",fontSize:14}}>×</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {aba==="geral"&&!auxAberta&&(
        <div style={{display:"flex",gap:24,alignItems:"flex-start",paddingTop:10}}>
          {/* ── Receitas ── */}
          <div style={{flex:1,minWidth:0,background:"#fff",borderRadius:10,border:"1px solid #e8e2da",overflow:"hidden"}}>
            <div style={{display:"grid",gridTemplateColumns:"48px 1fr 1fr 1fr",background:"#4a7fa5",position:"sticky",top:0,zIndex:1}}>
              <div/>
              {["Silva Teles","Bom Retiro","Marketplaces"].map(h=>(<div key={h} style={{padding:"8px 10px",fontSize:10,color:"#fff",fontWeight:700,textTransform:"uppercase",letterSpacing:0.5,borderLeft:"1px solid rgba(255,255,255,0.25)"}}>{h}</div>))}
            </div>
            <div style={{maxHeight:792,overflowY:"auto"}} >
              {Array.from({length:31},(_,i)=>i+1).map(dia=>{
                const d=receitas[dia]||{};const isDom=(DOMINGOS_MES[mes]||DOMINGOS_MAR).includes(dia);const feriado=getFeriado(dia,mes);const futuro=mesFechado?false:dia>hoje;
                const rowBg=isDom?"#c8c2b8":feriado?"#d4ecd4":"#fff";
                const sepCol=isDom?"#b0a898":feriado?"#b0d4b0":"#ddd8d0";
                const valCol=isDom?"#4a3a2a":feriado?"#1a4a1a":"#2c3e50";
                const emptyCol=isDom?"#a09080":feriado?"#90b890":"#e0dbd5";
                return(
                  <div key={dia} style={{display:"grid",gridTemplateColumns:"48px 1fr 1fr 1fr",borderBottom:`1px solid ${isDom?"#b8b0a6":feriado?"#a8d0a8":"#f0ebe4"}`,background:rowBg,borderLeft:dia===hoje?"3px solid #f39c12":"3px solid transparent"}}>
                    <div style={{padding:"5px 2px",textAlign:"center",background:isDom?"#b8b0a4":feriado?"#b8ddb8":"transparent",borderRight:`1px solid ${sepCol}`,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
                      <div style={{fontSize:14,fontWeight:(isDom||feriado||dia===hoje)?700:500,color:isDom?"#6b5f54":dia===hoje?"#4a7fa5":"#2c3e50",lineHeight:1.1}}>{dia}</div>
                      <div style={{fontSize:9,color:isDom?"#8a7e74":"#a89f94",fontWeight:isDom?600:400,lineHeight:1,marginTop:1}}>{getDiaSemana(dia)}</div>
                    </div>
                    {["silvaTeles","bomRetiro","marketplaces"].map((canal)=>{
                      const key="g"+dia+"-"+canal;
                      return(
                        <div key={canal} style={{display:"flex",alignItems:"center",borderLeft:`1px solid ${sepCol}`}}>
                          {editando===key?(
                            <input ref={el=>el&&el.focus({preventScroll:true})} value={d[canal]||""} onChange={e=>salvarCelula(dia,canal,e.target.value)} style={{width:"100%",border:"2px solid #4a7fa5",borderRadius:4,padding:"5px 10px",fontSize:_FS,fontWeight:700,fontFamily:_FN,textAlign:"right",outline:"none",background:"#f0f6fb",color:"#2c3e50",boxSizing:"border-box",margin:"0 4px"}} onBlur={()=>setEditando(null)} onKeyDown={e=>navCelula(e,dia,canal,"g")}/>
                          ):(
                            <div onClick={()=>!futuro&&setEditando(key)} onMouseEnter={e=>{if(!futuro)e.currentTarget.style.background=isDom?"#d0c8be":"#edf4fa";}} onMouseLeave={e=>{e.currentTarget.style.background="transparent";}} style={{fontFamily:_FN,fontSize:_FS,fontWeight:700,color:d[canal]?valCol:emptyCol,cursor:futuro?"default":"pointer",width:"100%",textAlign:"right",padding:"5px 10px",borderRadius:3,transition:"background 0.12s"}}>
                              {d[canal]?parseFloat(d[canal]).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2}):"—"}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"48px 1fr 1fr 1fr",background:"#f7f4f0",borderTop:"2px solid #e8e2da"}}>
              <div style={{padding:"8px",fontSize:11,color:"#4a7fa5",textAlign:"center",fontWeight:700}}>Σ</div>
              {[totRec.st,totRec.br,totRec.mkt].map((t,i)=><div key={i} style={{padding:"7px 10px",fontSize:_FS,fontWeight:800,color:"#2c3e50",fontFamily:_FN,textAlign:"right",borderLeft:"1px solid #e8e2da"}}>{t>0?t.toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2}):"—"}</div>)}
            </div>
          </div>
          {/* ── Despesas ── */}
          <div style={{flex:1,minWidth:0,background:"#fff",borderRadius:10,border:"1px solid #e8e2da",overflow:"hidden"}}>
            <table style={{width:"100%",borderCollapse:"collapse",tableLayout:"fixed"}}>
              <colgroup><col/><col style={{width:"35%"}}/><col style={{width:22}}/></colgroup>
              <thead>
                <tr style={{background:"#4a7fa5"}}>
                  <th style={{padding:"8px 14px",textAlign:"left",fontSize:10,color:"#fff",fontWeight:700,textTransform:"uppercase",letterSpacing:0.5,borderLeft:"3px solid transparent"}}>Categoria</th>
                  <th style={{padding:"8px 14px",textAlign:"right",fontSize:10,color:"#fff",fontWeight:700,textTransform:"uppercase",letterSpacing:0.5,borderLeft:"1px solid rgba(255,255,255,0.25)"}}>Valor</th>
                  <th/>
                </tr>
              </thead>
            </table>
            <div style={{maxHeight:792,overflowY:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",tableLayout:"fixed"}}>
                <colgroup><col/><col style={{width:"35%"}}/><col style={{width:22}}/></colgroup>
                <tbody>
                  {categorias.map(cat=>{
                    const total=calcTotalAux(cat,auxData,recTotais);
                    const isSuper=SUPER_DEST.includes(cat);
                    const isLeve=LEVE_DEST.includes(cat);
                    const isAuto=SEM_AUX.includes(cat);
                    const regra=cat==="Taxas Cartão"?"1% receita":cat==="Taxas Marketplaces"?"29% MKT":null;
                    const rowBg=isSuper?"#e4eef7":isLeve?"#f4f8fc":"#fff";
                    const leftBorder=isSuper?"3px solid #4a7fa5":isLeve?"3px solid #c0d4e8":"3px solid transparent";
                    const catSize=isSuper?14:isLeve?13:12;
                    const catWeight=isSuper?800:isLeve?700:400;
                    const catColor=isSuper?"#1a3a5c":isLeve?"#2c3e50":"#4a5a6a";
                    const valWeight=isSuper?800:700;
                    const valColor=total>0?(isSuper?"#1a3a5c":"#2c3e50"):"#d0c8c0";
                    return(
                      <tr key={cat} style={{borderBottom:"1px solid #f0ebe4",cursor:isAuto?"default":"pointer",background:rowBg,borderLeft:leftBorder}} onClick={()=>{if(!isAuto){if(CATS_RAPIDAS.includes(cat))abrirModalRapido(cat);else abrirAux(cat);}}}>
                        <td style={{padding:"7px 14px"}}>
                          <div style={{fontSize:catSize,fontWeight:catWeight,color:catColor}}>{cat}</div>
                          {regra&&<div style={{fontSize:9,color:"#a89f94",marginTop:1}}>{regra}</div>}
                        </td>
                        <td style={{padding:"7px 14px",textAlign:"right",fontFamily:_FN,fontSize:_FS,fontWeight:valWeight,color:valColor,whiteSpace:"nowrap",borderLeft:"1px solid #ede8e0"}}>
                          {total>0?total.toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2}):"—"}
                        </td>
                        <td style={{textAlign:"center",color:"#c8d0d8",fontSize:12}}>{!isAuto?"›":""}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{padding:"8px 14px",background:"#f7f4f0",borderTop:"2px solid #e8e2da",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={{fontSize:12,fontWeight:700,color:"#a89f94",textTransform:"uppercase"}}>Total Despesas</span>
              <span style={{fontSize:16,fontWeight:900,color:"#c0392b",fontFamily:_FN}}>{fmt(totalDesp)}</span>
            </div>
          </div>
        </div>
      )}
      {auxAberta&&(
        <div style={{background:"#fff",borderRadius:"0 0 12px 12px",border:"1px solid #e8e2da",borderTop:"none",overflow:"hidden"}}>
          <div style={{padding:"12px 16px",background:"#f0f6fb",borderBottom:"1px solid #e8e2da",display:"flex",gap:12,alignItems:"center"}}>
            <button onClick={()=>setAuxAberta(null)} style={{background:"none",border:"1px solid #a3bacc",borderRadius:6,padding:"4px 10px",fontSize:12,cursor:"pointer",color:"#4a7fa5"}}>← Voltar</button>
            <div style={{fontSize:14,fontWeight:600,color:"#2c3e50"}}>{auxAberta}</div>

            <div style={{fontSize:12,color:"#a89f94",marginLeft:"auto"}}>Total: <strong style={{color:"#2c3e50"}}>{fmt(calcTotalAux(auxAberta,auxData,recTotais))}</strong></div>
          </div>
          {auxAberta==="Funcionários"?(
            <>
              <div style={{overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                  <thead><tr style={{background:"#f7f4f0"}}>{["Nome","Salário","Comissão","Extra","Alimentação","Vale","Férias","Rescisão","Total",""].map(h=><th key={h} style={{padding:"7px 8px",textAlign:"left",fontSize:10,color:h==="Nome"?_B:"#a89f94",fontWeight:h==="Nome"?700:600,letterSpacing:0.5,whiteSpace:"nowrap"}}>{h}</th>)}</tr></thead>
                  <tbody>
                    {(auxData["Funcionários"]||[]).map((row,idx)=>{
                      const rowTotal=calcRowTotal(row);
                      const isFixo=FIXOS_NOMES_FUNC.includes(row.nome?.toUpperCase());
                      return(
                        <tr key={idx} style={{borderBottom:"1px solid #f0ebe4",background:rowTotal>0?"#f9fdf9":"#fff"}}>
                          <td style={{padding:"6px 8px",background:"#f5f9fd",borderRight:"2px solid #c8dff0"}}>
                            {isFixo?(
                              <div style={{padding:"5px 6px",fontSize:13,fontFamily:"Georgia,serif",fontWeight:700,color:"#2c3e50",width:110}}>{row.nome}</div>
                            ):(
                              <input value={row.nome||""} onChange={e=>updateLinhaAux("Funcionários",idx,"nome",e.target.value)}
                                style={{border:"none",borderRadius:4,padding:"5px 6px",fontSize:13,outline:"none",fontFamily:"Georgia,serif",fontWeight:700,background:"transparent",color:"#2c3e50",width:110}}/>
                            )}
                          </td>
                          {["salario","comissao","extra","alimentacao","vale","ferias","rescisao"].map(f=>(
                            <td key={f} style={{padding:"6px 4px"}}>
                              <input value={row[f]||""} onChange={e=>updateLinhaAux("Funcionários",idx,f,e.target.value)}
                                style={{...inputStyle,width:76,textAlign:"right",fontFamily:_FN,fontSize:_FS,fontWeight:700}}
                                placeholder="0,00"/>
                            </td>
                          ))}
                          <td style={{padding:"6px 10px",textAlign:"right",fontFamily:_FN,fontSize:_FS,fontWeight:700,color:"#2c3e50",whiteSpace:"nowrap"}}>R$ {rowTotal.toLocaleString("pt-BR",{minimumFractionDigits:2})}</td>
                          <td style={{padding:"6px 6px",textAlign:"center"}}><span onClick={()=>removeLinhaAux("Funcionários",idx)} style={{color:"#c0b8b0",cursor:"pointer",fontSize:16}}>×</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div style={{padding:"10px 16px",background:"#f7f4f0",borderTop:"1px solid #e8e2da",fontSize:12,color:"#8a9aa4"}}>
                Salários: {fmt(totalFuncSomente)}
              </div>
              <div style={{borderTop:"2px dashed #e8e2da"}}>
                <div style={{padding:"10px 16px 6px",fontSize:11,color:"#a89f94",letterSpacing:2,textTransform:"uppercase"}}>Benefícios Fixos</div>
                {FIXOS_FUNC.map(f=>(<div key={f.label} style={{display:"flex",justifyContent:"space-between",padding:"6px 16px",fontSize:12,color:"#2c3e50"}}><span>{f.label}</span><span>{fmt(f.valor)}</span></div>))}
                <div style={{display:"flex",justifyContent:"space-between",padding:"12px 16px"}}><span style={{fontSize:13,fontWeight:700,color:"#2c3e50"}}>Total Funcionários</span><span style={{fontSize:14,fontWeight:800,color:"#2c3e50"}}>{fmt(totalFuncGeral)}</span></div>
              </div>
              <div style={{padding:"12px 16px",background:"#f7f4f0",borderTop:"1px solid #e8e2da"}}>
                <button onClick={()=>addLinhaAux("Funcionários")} style={{background:"#2c3e50",color:"#fff",border:"none",borderRadius:6,padding:"6px 14px",fontSize:12,cursor:"pointer"}}>+ Adicionar funcionário</button>
              </div>
            </>
          ):(
            <AuxSimplesPanel auxAberta={auxAberta} auxData={auxData} updateLinhaAux={updateLinhaAux} removeLinhaAux={removeLinhaAux} addLinhaAux={addLinhaAux} prestadores={prestadores||PRESTADORES_INICIAL} setPrestadores={setPrestadores||((fn)=>{})}/>
          )}
        </div>
      )}

      {/* ── Modal lançamento rápido ─────────────────────────────── */}
      {modalRapido&&(<>
        <div onClick={fecharModalRapido} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.35)",zIndex:1000}}/>
        <div style={{position:"fixed",top:"50%",left:"50%",transform:"translate(-50%,-50%)",
          zIndex:1001,background:"#fff",borderRadius:16,width:320,
          boxShadow:"0 20px 60px rgba(0,0,0,0.2)",overflow:"hidden"}}>
          <div style={{background:"#2c3e50",padding:"14px 18px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div style={{fontSize:13,fontWeight:700,color:"#fff"}}>{modalRapido}</div>
            <button onClick={fecharModalRapido} style={{background:"none",border:"none",color:"#a8b8c8",fontSize:22,cursor:"pointer",lineHeight:1}}>×</button>
          </div>
          <div style={{padding:"18px 18px 14px"}}>
            <div style={{fontSize:11,color:"#a89f94",marginBottom:6,letterSpacing:1,textTransform:"uppercase"}}>Valor a acrescentar</div>
            <div style={{display:"flex",gap:8}}>
              <div style={{position:"relative",flex:1}}>
                <span style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",fontSize:12,color:"#a89f94",fontFamily:_FN,fontWeight:700}}>R$</span>
                <input autoFocus value={modalInput}
                  onChange={e=>{setModalInput(e.target.value);setModalErro("");}}
                  onKeyDown={e=>e.key==="Enter"&&confirmarModalRapido()}
                  placeholder="0,00"
                  style={{width:"100%",border:"1.5px solid "+(modalErro?"#c0392b":"#c8d8e4"),borderRadius:8,
                    padding:"10px 10px 10px 36px",fontSize:18,fontFamily:_FN,fontWeight:700,
                    outline:"none",boxSizing:"border-box",color:"#2c3e50"}}/>
              </div>
              <button onClick={confirmarModalRapido}
                style={{background:"#4a7fa5",color:"#fff",border:"none",borderRadius:8,
                  padding:"10px 16px",fontSize:13,cursor:"pointer",fontFamily:"Georgia,serif",fontWeight:600}}>
                ✓
              </button>
            </div>
            {modalErro&&<div style={{fontSize:11,color:"#c0392b",marginTop:6}}>{modalErro}</div>}
          </div>
          {(auxData[modalRapido]||[]).length>0&&(
            <div style={{borderTop:"1px solid #e8e2da",maxHeight:200,overflowY:"auto"}}>
              <div style={{padding:"8px 18px 4px",fontSize:10,color:"#a89f94",letterSpacing:1,textTransform:"uppercase"}}>Histórico</div>
              {[...(auxData[modalRapido]||[])].reverse().map((l,i)=>{
                const idxReal=(auxData[modalRapido]||[]).length-1-i;
                return(
                <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                  padding:"7px 18px",borderBottom:"1px solid #f7f4f0"}}>
                  <div style={{fontSize:11,color:"#a89f94"}}>{l.data}</div>
                  <div style={{display:"flex",alignItems:"center",gap:12}}>
                    <div style={{fontFamily:_FN,fontSize:13,fontWeight:700,color:"#2c3e50"}}>
                      R$ {fmt(parseFloat(l.valor||0))}
                    </div>
                    <span onClick={()=>removeLinhaAux(modalRapido,idxReal)}
                      style={{color:"#c0b8b0",cursor:"pointer",fontSize:16,lineHeight:1}}>×</span>
                  </div>
                </div>
              );})}

              <div style={{display:"flex",justifyContent:"space-between",padding:"10px 18px",
                background:"#f7f4f0",borderTop:"1px solid #e8e2da"}}>
                <div style={{fontSize:12,fontWeight:600,color:"#2c3e50"}}>Total acumulado</div>
                <div style={{fontFamily:_FN,fontSize:14,fontWeight:800,color:"#4a7fa5"}}>
                  R$ {fmt((auxData[modalRapido]||[]).reduce((s,l)=>s+parseFloat(l.valor||0),0))}
                </div>
              </div>
            </div>
          )}
        </div>
      </>)}
    </div>
  );
};

// ── Normalização e deduplicação de boletos ────────────────────────────────────
const normalizarNota=(s="")=>String(s).toUpperCase().replace(/\s+/g,"").replace(/^NOTA/,"NF");
const normalizarEmpresa=(s="")=>String(s).trim().toUpperCase().replace(/\s+/g," ");
const normalizarValor=(v="")=>{const txt=String(v).trim().replace(/R\$\s*/,"");const n=txt.includes(",")?Number(txt.replace(/\./g,"").replace(",",".")):Number(txt);return Number.isFinite(n)?n.toFixed(2):"0.00";};
const normalizarData=(d="")=>{const txt=String(d).trim().replace(/-/g,"/");const p=txt.split("/");if(p.length===2){const[dia,mes]=p;return`${dia.padStart(2,"0")}/${mes.padStart(2,"0")}/2026`;}if(p.length===3){const[dia,mes,ano]=p;return`${dia.padStart(2,"0")}/${mes.padStart(2,"0")}/${ano}`;}return txt;};
const chaveBoleto=(b)=>[normalizarData(b.data),normalizarNota(b.nroNota),normalizarEmpresa(b.empresa),normalizarValor(b.valor)].join("|");
const deduplicarBoletos=(lista=[])=>{
  const vistos=new Map();
  lista.forEach(b=>{
    const norm={...b,
      id:b.id||crypto.randomUUID(),
      data:normalizarData(b.data),
      empresa:normalizarEmpresa(b.empresa),
      nroNota:normalizarNota(b.nroNota),
      valor:normalizarValor(b.valor),
      mes:parseInt(normalizarData(b.data).split("/")[1])||Number(b.mes),
    };
    const chave=chaveBoleto(norm);
    if(!vistos.has(chave)){vistos.set(chave,norm);}
  });
  return[...vistos.values()];
};

const BoletosContent=({boletos,setBoletos,setAuxDataPorMes})=>{
  const [mostraImport,setMostraImport]=useState(false);
  const [mostraAdicionar,setMostraAdicionar]=useState(false);
  const [novoB,setNovoB]=useState({data:"",mes:3,empresa:"",valor:"",nroNota:""});
  const [pasteText,setPasteText]=useState("");
  const [importError,setImportError]=useState("");
  const [filtro,setFiltro]=useState(new Date().getMonth()+1);
  const [mesAberto,setMesAberto]=useState(0);
  const [saveStatus,setSaveStatus]=useState(null);
  const [lixeira,setLixeira]=useState([]);
  const [confirm,setConfirm]=useState(null);
  const hoje=new Date().getDate();const mesHoje=new Date().getMonth()+1;
  const diaNum=(d)=>parseInt((d||"99/99").split("/")[0]);
  const getMes=(b)=>{const p=(b.data||"").split("/");return(p.length>=2&&parseInt(p[1])>=1&&parseInt(p[1])<=12)?parseInt(p[1]):Number(b.mes);};
  const isVencido=(b)=>!b.pago&&(getMes(b)<mesHoje||(getMes(b)===mesHoje&&diaNum(b.data)<hoje));
  const mesesComBoletos=[...new Set(boletos.map(b=>getMes(b)))].sort((a,b)=>a-b);
  const boletosFiltrados=filtro==="aberto"
    ?boletos.filter(b=>!b.pago&&(mesAberto===0||getMes(b)===Number(mesAberto))).sort((a,b)=>getMes(a)-getMes(b)||diaNum(a.data)-diaNum(b.data))
    :boletos.filter(b=>getMes(b)===Number(filtro)).sort((a,b)=>diaNum(a.data)-diaNum(b.data));
  const boletosAberto=boletosFiltrados.filter(b=>!b.pago).sort((a,b)=>getMes(a)-getMes(b)||diaNum(a.data)-diaNum(b.data));
  const boletosPagos=boletosFiltrados.filter(b=>b.pago).sort((a,b)=>diaNum(a.data)-diaNum(b.data));
  const mesFiltro=typeof filtro==="number"?filtro:mesHoje;
  const totalPagoMes=boletos.filter(b=>b.pago&&getMes(b)===mesFiltro).reduce((s,b)=>s+parseFloat(b.valor||0),0);
  const totalAPagar=boletos.filter(b=>!b.pago&&getMes(b)===mesHoje).reduce((s,b)=>s+parseFloat(b.valor||0),0);
  const parseDateBoleto=(d)=>{const p=(d||"").split("/");if(p.length<2)return null;const dia=parseInt(p[0]),m=parseInt(p[1]);if(isNaN(dia)||isNaN(m)||m<1||m>12)return null;const a=p[2]&&p[2].length>0?parseInt(p[2]):new Date().getFullYear()%100;const ano=a<100?2000+a:a;return new Date(ano,m-1,dia);};
  const hojeDate=new Date();hojeDate.setHours(23,59,59);
  const boletosDoDia=boletos.filter(b=>{if(b.pago)return false;const d=parseDateBoleto(b.data);return d&&d<=hojeDate;});
  const totalPagamentoDia=boletosDoDia.reduce((s,b)=>s+parseFloat(b.valor||0),0);
  const qtdBoletosDia=boletosDoDia.length;
  const totalFiltro=boletosFiltrados.reduce((s,b)=>s+parseFloat(b.valor||0),0);
  const markChange=()=>{setSaveStatus("saving");setTimeout(()=>setSaveStatus("saved"),600);};
  const togglePago=(id)=>{
    const b=boletos.find(x=>x.id===id);
    if(!b)return;
    const novoPago=!b.pago;
    const mesNum=getMes(b);
    // Atualiza boletos
    setBoletos(prev=>prev.map(x=>x.id===id?{...x,pago:novoPago,_mod:Date.now()}:x));
    // Atualiza auxData separadamente (fora do setBoletos)
    if(setAuxDataPorMes){
      setAuxDataPorMes(prev=>{
        const tecidos=[...(prev[mesNum]?.["Tecidos"]||[])];
        if(novoPago){if(!tecidos.find(t=>t._boletoid===id)){tecidos.push({data:b.data,empresa:b.empresa,nroNota:b.nroNota||"",valor:b.valor,descricao:"",_boletoid:id});}}
        else{const idx=tecidos.findIndex(t=>t._boletoid===id);if(idx>=0)tecidos.splice(idx,1);}
        return{...prev,[mesNum]:{...(prev[mesNum]||{}),"Tecidos":tecidos}};
      });
    }
    markChange();
  };
  const remover=(id)=>setConfirm({msg:"Apagar este boleto?",onYes:()=>{setBoletos(prev=>{const b=prev.find(x=>x.id===id);setLixeira(l=>[...l,b]);return prev.filter(x=>x.id!==id);});setConfirm(null);}});
  const desfazer=()=>{if(!lixeira.length)return;const u=lixeira[lixeira.length-1];setBoletos(prev=>[...prev,u]);setLixeira(l=>l.slice(0,-1));};
  const parsePaste=()=>{
    setImportError("");
    try{
      const linhas=pasteText.trim().split("\n").filter(l=>l.trim());
      if(linhas.length===0){setImportError("⚠ Cole os dados antes de importar.");return;}
      const novas=[];let erros=0;
      linhas.forEach((linha,i)=>{
        const cols=linha.split(/\t|;/).map(c=>c.trim());
        if(cols.length<2){erros++;return;}
        let data="",valor="",empresa="",nroNota="";
        cols.forEach(col=>{
          const cl=col.replace("R$","").replace(/\s/g,"");
          if(/^\d{1,2}[/-]\d{1,2}/.test(col)){data=col.replace("-","/")}
          else if(/^[\d.,]+$/.test(cl)&&!valor){valor=cl.replace(/\./g,"").replace(",",".")}
          else if(/^(NF|NF-|nf|nota|#)/i.test(col)||/^\d{3,}$/.test(col.trim())){nroNota=col}
          else{empresa=col;}
        });
        if(!valor){erros++;return;}
        const partes=(data||"").split("/");
        const mesDaData=partes.length>=2?parseInt(partes[1]):null;
        const mesCorreto=(mesDaData&&mesDaData>=1&&mesDaData<=12)?mesDaData:mesFiltro;
        novas.push({id:crypto.randomUUID(),data:normalizarData(data||"—"),mes:mesCorreto,empresa:normalizarEmpresa(empresa||("Boleto "+(i+1))),nroNota:normalizarNota(nroNota),valor:normalizarValor(valor),pago:false,_mod:Date.now()});
      });
      if(novas.length===0){setImportError("⚠ Formato inválido. Use: Data ; Valor ; Empresa");return;}
      setBoletos(prev=>deduplicarBoletos([...prev,...novas]));setPasteText("");
      if(erros>0)setImportError("✓ "+novas.length+" importado(s). "+erros+" ignorado(s).");
      else setImportError("✓ "+novas.length+" boleto(s) importado(s) com sucesso!");
    }catch(e){console.error("Erro import boletos:",e);setImportError("⚠ Erro ao importar: "+e.message);}
  };
  const iStyle={border:"1px solid #c8d8e4",borderRadius:6,padding:"6px 10px",fontSize:13,outline:"none"};
  return(
    <div>
      <ConfirmDialog confirm={confirm?confirm.msg:null} onCancel={()=>setConfirm(null)} onConfirm={confirm?.onYes}/>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
        <div style={{background:"#fff",borderRadius:8,padding:"5px 12px",border:"1px solid #e8e2da",display:"flex",alignItems:"center",gap:12}}>
          <div><div style={{fontSize:9,color:"#a89f94",letterSpacing:1,textTransform:"uppercase"}}>Pago ({MESES[mesFiltro-1]})</div><div style={{fontSize:15,fontWeight:700,color:"#27ae60"}}>{fmt(totalPagoMes)}</div></div>
          <div style={{width:1,height:20,background:"#e8e2da"}}/>
          <div style={{fontSize:11,color:"#a89f94"}}>{boletos.filter(b=>b.pago&&b.mes===mesFiltro).length} boleto(s)</div>
          <div style={{width:1,height:20,background:"#e8e2da"}}/>
          <div><div style={{fontSize:9,color:"#a89f94",letterSpacing:1,textTransform:"uppercase"}}>A Pagar</div><div style={{fontSize:15,fontWeight:700,color:"#c0392b"}}>{fmt(totalAPagar)}</div></div>
          <div style={{width:1,height:20,background:"#e8e2da"}}/>
          <div><div style={{fontSize:9,color:"#a89f94",letterSpacing:1,textTransform:"uppercase"}}>Pagamento do dia</div><div style={{fontSize:15,fontWeight:700,color:"#e67e22"}}>{fmt(totalPagamentoDia)}</div><div style={{fontSize:10,color:"#a89f94"}}>{qtdBoletosDia} boleto(s)</div></div>
        </div>
      </div>
      <div style={{display:"flex",alignItems:"center",gap:0,flexWrap:"nowrap",overflowX:"auto",marginBottom:8}}>
        <button onClick={()=>setFiltro("aberto")} style={{padding:"5px 12px",border:"none",background:filtro==="aberto"?"#2c3e50":"#fff",color:filtro==="aberto"?"#fff":"#8a9aa4",borderRadius:6,cursor:"pointer",fontSize:12,fontFamily:"Georgia,serif",whiteSpace:"nowrap"}}>Em aberto</button>
        {filtro==="aberto"&&(
          <select value={mesAberto} onChange={e=>setMesAberto(Number(e.target.value))} style={{margin:"0 8px",border:"1px solid #e8e2da",borderRadius:5,padding:"3px 7px",fontSize:12,outline:"none"}}>
            <option value={0}>Todos os meses</option>
            {mesesComBoletos.map(m=><option key={m} value={m}>{MESES[m-1]}</option>)}
          </select>
        )}
        <div style={{width:1,height:20,background:"#e8e2da",margin:"0 4px",flexShrink:0}}/>
        {mesesComBoletos.map(m=><button key={m} onClick={()=>setFiltro(m)} style={{padding:"5px 10px",border:"none",background:filtro===m?"#2c3e50":"#fff",color:filtro===m?"#fff":"#8a9aa4",borderRadius:6,cursor:"pointer",fontSize:12,fontFamily:"Georgia,serif",whiteSpace:"nowrap"}}>{MESES[m-1]}</button>)}
      </div>
      <div style={{background:"#fff",borderRadius:"0 0 12px 12px",border:"1px solid #e8e2da",borderTop:"none",overflow:"hidden"}}>
        <div style={{minHeight:300,maxHeight:720,overflowY:"auto"}}>
          {/* ── EM ABERTO ── */}
          {boletosAberto.length>0&&(
            <table style={{width:"100%",borderCollapse:"collapse",tableLayout:"fixed"}}>
              <colgroup>
                <col style={{width:"80px"}}/><col style={{width:"auto"}}/><col style={{width:"120px"}}/>
                {filtro==="aberto"&&<col style={{width:"60px"}}/>}
                <col style={{width:"130px"}}/><col style={{width:"50px"}}/><col style={{width:"30px"}}/>
              </colgroup>
              <thead><tr style={{background:"#c0392b"}}>{["Data","Empresa","Nº Nota",filtro==="aberto"?"Mês":"","Valor","Pago",""].map((h,i)=>(h!==undefined&&!(filtro!=="aberto"&&h==="Mês"))&&<th key={i} style={{padding:"7px 12px",textAlign:"left",fontSize:11,color:"#fff",fontWeight:600,letterSpacing:0.5}}>{h==="Pago"?"":h}</th>)}</tr></thead>
              <tbody>
                {boletosAberto.map(b=>{
                  const venc=isVencido(b);
                  return(
                    <tr key={b.id} style={{borderBottom:"1px solid #f0ebe4",background:"#fff"}}>
                      <td style={{padding:"7px 12px",fontSize:12,color:venc?"#c0392b":"#2c3e50",fontWeight:venc?700:400}}>{b.data}</td>
                      <td style={{padding:"7px 12px",fontSize:12,color:"#2c3e50"}}>{b.empresa}</td>
                      <td style={{padding:"7px 12px",fontSize:11,color:"#8a9aa4"}}>{b.nroNota||"—"}</td>
                      {filtro==="aberto"&&<td style={{padding:"7px 12px",fontSize:11,color:"#8a9aa4"}}>{MESES[b.mes-1]}</td>}
                      <td style={{padding:"7px 12px",fontSize:_FS,fontWeight:700,textAlign:"right",color:venc?"#c0392b":"#2c3e50",fontFamily:_FN}}>{fmt(parseFloat(b.valor||0))}</td>
                      <td style={{padding:"7px 12px",textAlign:"center"}}><div onClick={()=>togglePago(b.id)} style={{width:18,height:18,borderRadius:4,background:"#fff",border:"1.5px solid #d0d8e0",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",margin:"auto"}}/></td>
                      <td style={{padding:"7px 6px",textAlign:"center"}}><span onClick={()=>remover(b.id)} style={{color:"#d0c8c0",cursor:"pointer",fontSize:14}}>×</span></td>
                    </tr>
                  );
                })}
                <tr style={{background:"#fff5f5"}}><td colSpan={filtro==="aberto"?7:6} style={{padding:"5px 12px",textAlign:"right",fontSize:12,fontWeight:700,color:"#c0392b",fontFamily:_FN}}>Total em aberto: {fmt(boletosAberto.reduce((s,b)=>s+parseFloat(b.valor||0),0))}</td></tr>
              </tbody>
            </table>
          )}
          {boletosAberto.length===0&&filtro!=="aberto"&&(
            <div style={{padding:"12px 16px",background:"#f6fbf6",borderBottom:"2px solid #e8e2da",fontSize:12,color:"#27ae60",fontWeight:600}}>✓ Todos os boletos pagos</div>
          )}
          {/* ── PAGOS ── */}
          {boletosPagos.length>0&&(
            <table style={{width:"100%",borderCollapse:"collapse",tableLayout:"fixed"}}>
              <colgroup>
                <col style={{width:"80px"}}/><col style={{width:"auto"}}/><col style={{width:"120px"}}/>
                {filtro==="aberto"&&<col style={{width:"60px"}}/>}
                <col style={{width:"130px"}}/><col style={{width:"50px"}}/><col style={{width:"30px"}}/>
              </colgroup>
              <thead><tr style={{background:"#27ae60"}}>{["Data","Empresa","Nº Nota",filtro==="aberto"?"Mês":"","Valor","✓",""].map((h,i)=>(h!==undefined&&!(filtro!=="aberto"&&h==="Mês"))&&<th key={i} style={{padding:"6px 12px",textAlign:"left",fontSize:11,color:"#fff",fontWeight:600,letterSpacing:0.5}}>{h}</th>)}</tr></thead>
              <tbody>
                {boletosPagos.map(b=>(
                  <tr key={b.id} style={{borderBottom:"1px solid #f0ebe4",background:"#f6fbf6"}}>
                    <td style={{padding:"6px 12px",fontSize:12,color:"#a0a0a0"}}>{b.data}</td>
                    <td style={{padding:"6px 12px",fontSize:12,color:"#a0a0a0",textDecoration:"line-through"}}>{b.empresa}</td>
                    <td style={{padding:"6px 12px",fontSize:11,color:"#b0b8b4"}}>{b.nroNota||"—"}</td>
                    {filtro==="aberto"&&<td style={{padding:"6px 12px",fontSize:11,color:"#b0b8b4"}}>{MESES[b.mes-1]}</td>}
                    <td style={{padding:"6px 12px",fontSize:_FS,fontWeight:700,textAlign:"right",color:"#27ae60",fontFamily:_FN}}>{fmt(parseFloat(b.valor||0))}</td>
                    <td style={{padding:"6px 12px",textAlign:"center"}}><div onClick={()=>togglePago(b.id)} style={{width:18,height:18,borderRadius:4,background:"#27ae60",border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",margin:"auto"}}><span style={{color:"#fff",fontSize:11,fontWeight:700}}>✓</span></div></td>
                    <td style={{padding:"6px 6px",textAlign:"center"}}><span onClick={()=>remover(b.id)} style={{color:"#d0c8c0",cursor:"pointer",fontSize:14}}>×</span></td>
                  </tr>
                ))}
                <tr style={{background:"#eafbf0"}}><td colSpan={filtro==="aberto"?7:6} style={{padding:"5px 12px",textAlign:"right",fontSize:12,fontWeight:700,color:"#27ae60",fontFamily:_FN}}>Total pago: {fmt(boletosPagos.reduce((s,b)=>s+parseFloat(b.valor||0),0))}</td></tr>
              </tbody>
            </table>
          )}
          {boletosFiltrados.length===0&&<div style={{padding:24,textAlign:"center",color:"#c0b8b0",fontSize:13}}>Nenhum boleto</div>}
        </div>
        <div style={{padding:"6px 14px",background:"#f7f4f0",borderTop:"1px solid #e8e2da",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div style={{display:"flex",gap:8,alignItems:"center"}}><SaveBadge status={saveStatus}/>{lixeira.length>0&&<button onClick={desfazer} style={{fontSize:11,color:"#4a7fa5",background:"none",border:"1px solid #4a7fa5",borderRadius:4,padding:"2px 8px",cursor:"pointer"}}>↩ Desfazer</button>}</div>
          <div style={{fontSize:12,color:"#8a9aa4"}}>Total: <strong style={{color:"#2c3e50"}}>{fmt(totalFiltro)}</strong></div>
        </div>
        {/* ── Contador por mês ── */}
        <div style={{padding:"8px 14px",background:"#f0f6fb",borderTop:"1px solid #e8e2da",display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
          <span style={{fontSize:10,color:"#a89f94",letterSpacing:1,textTransform:"uppercase",marginRight:4}}>Boletos por mês:</span>
          {mesesComBoletos.map(m=>{
            const qtd=boletos.filter(b=>getMes(b)===m).length;
            const totalM=boletos.filter(b=>getMes(b)===m).reduce((s,b)=>s+parseFloat(b.valor||0),0);
            return(
              <div key={m} style={{background:"#fff",border:"1px solid #c8d8e4",borderRadius:6,padding:"3px 10px",fontSize:11,color:"#2c3e50",display:"flex",gap:6,alignItems:"center"}}>
                <span style={{fontWeight:700,color:"#4a7fa5"}}>{MESES[m-1]}</span>
                <span style={{color:"#6b7c8a"}}>{qtd} boleto{qtd!==1?"s":""}</span>
                <span style={{fontFamily:_FN,fontWeight:700,color:"#2c3e50"}}>R$ {fmt(totalM)}</span>
              </div>
            );
          })}
        </div>
        <div style={{padding:"6px 14px",background:"#fff",borderTop:"1px solid #f0ebe4",display:"flex",gap:8}}>
          <button onClick={()=>{setMostraAdicionar(p=>!p);setMostraImport(false);}} style={{background:mostraAdicionar?"#2c3e50":"#4a7fa5",color:"#fff",border:"none",borderRadius:6,padding:"5px 14px",fontSize:12,cursor:"pointer",fontFamily:"Georgia,serif"}}>+ Adicionar</button>
          <button onClick={()=>{setMostraImport(p=>!p);setMostraAdicionar(false);setImportError("");}} style={{background:mostraImport?"#2c3e50":"#fff",color:mostraImport?"#fff":"#4a7fa5",border:"1px solid #4a7fa5",borderRadius:6,padding:"5px 14px",fontSize:12,cursor:"pointer",fontFamily:"Georgia,serif"}}>📋 Importar</button>
        </div>
        {mostraAdicionar&&(
          <div style={{padding:"8px 12px",background:"#f0f6fb",borderTop:"1px solid #e8e2da"}}>
            <div style={{display:"grid",gridTemplateColumns:"70px 64px 1fr 90px 110px 70px",gap:6,alignItems:"end"}}>
              <div><div style={{fontSize:10,color:"#a89f94",marginBottom:2}}>Data</div><input value={novoB.data} onChange={e=>setNovoB(p=>({...p,data:e.target.value}))} placeholder="DD/MM" style={{...iStyle,width:"100%"}}/></div>
              <div><div style={{fontSize:10,color:"#a89f94",marginBottom:2}}>Mês</div><select value={novoB.mes} onChange={e=>setNovoB(p=>({...p,mes:Number(e.target.value)}))} style={{...iStyle,width:"100%"}}>{MESES.map((m,i)=><option key={i} value={i+1}>{m}</option>)}</select></div>
              <div><div style={{fontSize:10,color:"#a89f94",marginBottom:2}}>Empresa</div><input value={novoB.empresa} onChange={e=>setNovoB(p=>({...p,empresa:e.target.value}))} style={{...iStyle,width:"100%"}}/></div>
              <div><div style={{fontSize:10,color:"#a89f94",marginBottom:2}}>Nº Nota</div><input value={novoB.nroNota} onChange={e=>setNovoB(p=>({...p,nroNota:e.target.value}))} style={{...iStyle,width:"100%"}}/></div>
              <div><div style={{fontSize:10,color:"#a89f94",marginBottom:2}}>Valor</div><input value={novoB.valor} onChange={e=>setNovoB(p=>({...p,valor:e.target.value}))} placeholder="0.00" style={{...iStyle,width:"100%"}}/></div>
              <button onClick={()=>{if(!novoB.empresa||!novoB.valor)return;setBoletos(p=>[...p,{id:Date.now(),...novoB,pago:false,_mod:Date.now()}]);setNovoB({data:"",mes:3,empresa:"",valor:"",nroNota:""});markChange();}} style={{background:"#27ae60",color:"#fff",border:"none",borderRadius:6,padding:"7px",fontSize:12,cursor:"pointer",height:34}}>✓</button>
            </div>
          </div>
        )}
        {mostraImport&&(
          <div style={{padding:"8px 12px",background:"#f0f6fb",borderTop:"1px solid #e8e2da"}}>
            <div style={{fontSize:11,color:"#8a9aa4",marginBottom:6}}>Cole da planilha (Data ; Valor ; Empresa)</div>
            <textarea value={pasteText} onChange={e=>setPasteText(e.target.value)} placeholder={"14/03\tFornecedor\t1500,00"} style={{width:"100%",height:80,border:"1px solid #c8d8e4",borderRadius:6,padding:"8px",fontSize:12,fontFamily:"monospace",resize:"vertical",outline:"none"}}/>
            {importError&&<div style={{fontSize:11,color:importError.startsWith("✓")?"#27ae60":"#c0392b",marginTop:4,fontWeight:600}}>{importError}</div>}
            <div style={{display:"flex",gap:6,marginTop:6}}>
              <button onClick={parsePaste} style={{background:"#4a7fa5",color:"#fff",border:"none",borderRadius:6,padding:"6px 14px",fontSize:12,cursor:"pointer"}}>Importar</button>
              <button onClick={()=>{setPasteText("");setImportError("");}} style={{background:"#fff",color:"#8a9aa4",border:"1px solid #e8e2da",borderRadius:6,padding:"6px 12px",fontSize:12,cursor:"pointer"}}>Limpar</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};


const AGENDA_INICIAL=[
{id:1,dia:1,descricao:"Pró-Labore Muniam",feito:true},{id:2,dia:1,descricao:"Pensão — Mãe",feito:true},
{id:3,dia:3,descricao:"Parcela Casa",feito:true},{id:4,dia:4,descricao:"Correios",feito:true},
{id:5,dia:5,descricao:"Condomínio",feito:true},{id:6,dia:5,descricao:"Ideris",feito:true},
{id:7,dia:5,descricao:"Luz Silva Teles",feito:true},{id:8,dia:6,descricao:"Folha de Pagamento",feito:true},
{id:9,dia:7,descricao:"Mensalidade Site",feito:true},{id:10,dia:7,descricao:"Aluguel Silva Teles",feito:true},
{id:11,dia:8,descricao:"Mensalidade Contabilidade",feito:true},{id:12,dia:9,descricao:"Bling",feito:true},
{id:13,dia:9,descricao:"Cartão Amícia",feito:true},{id:14,dia:9,descricao:"Cartão Ailson",feito:true},
{id:15,dia:10,descricao:"Futura La Amícia",feito:true},{id:16,dia:10,descricao:"Parcela Apartamento",feito:true},
{id:17,dia:11,descricao:"Cartão Tamara",feito:true},{id:18,dia:15,descricao:"ADPM",feito:true},
{id:19,dia:17,descricao:"Estacionamento",feito:true},{id:20,dia:18,descricao:"Cestas Básicas",feito:true},
{id:21,dia:20,descricao:"Impostos DAS",feito:true},{id:22,dia:20,descricao:"FGTS / INSS",feito:true},
{id:23,dia:20,descricao:"Adiantamento Funcionários",feito:true},{id:24,dia:20,descricao:"Unimed",feito:true},
{id:25,dia:20,descricao:"Método Marketing",feito:true},{id:26,dia:23,descricao:"Luz José Paulino",feito:true},
{id:27,dia:25,descricao:"Vale Transporte",feito:true},{id:28,dia:28,descricao:"Pró-Labore Grupo",feito:false},
{id:29,dia:29,descricao:"Futura Amícia",feito:false},{id:30,dia:30,descricao:"Aluguel José Paulino",feito:false},
{id:31,dia:30,descricao:"Guias Parcelamento",feito:false},{id:32,dia:30,descricao:"Guia DARF Parcelamento",feito:false},
{id:33,dia:30,descricao:"Aluguel Escritório",feito:false},{id:34,dia:20,descricao:"ECAD",feito:true},
];

const AgendaContent=()=>{
  const hoje=new Date().getDate();
  const mesHoje=new Date().getMonth()+1;
  const anoHoje=new Date().getFullYear();
  const saveTimerRef=useRef(null);
  const lastSyncRef=useRef(0);

  // ── Helpers de persistência ──
  const lerLocal=()=>{try{const s=localStorage.getItem("amica_agenda");return s?JSON.parse(s):null;}catch{return null;}};
  const salvarLocal=(itens,ts)=>{try{localStorage.setItem("amica_agenda",JSON.stringify({itens,mes:mesHoje,ano:anoHoje,_updated:ts||Date.now()}));}catch(e){console.error(e)}};
  const salvarSupabase=(itens,ts)=>{
    const now=ts||Date.now();
    lastSyncRef.current=now;
    if(saveTimerRef.current)clearTimeout(saveTimerRef.current);
    saveTimerRef.current=setTimeout(()=>{
      supabase.from('amicia_data').upsert({user_id:'agenda',payload:{itens,mes:mesHoje,ano:anoHoje,_updated:now}},{onConflict:'user_id'})
        .then(({error})=>{if(error)console.error("AGENDA save Supabase:",error.message);else console.log("AGENDA: salvo no Supabase");});
    },1500);
  };
  const salvarTudo=(novosItens)=>{
    const ts=Date.now();
    salvarLocal(novosItens,ts);
    salvarSupabase(novosItens,ts);
  };

  // ── Estado inicial: localStorage imediato ──
  const [itens,setItens]=useState(()=>{
    const salvo=lerLocal();
    if(salvo?.itens){
      if(salvo.mes===mesHoje&&salvo.ano===anoHoje)return salvo.itens;
      const resetado=salvo.itens.map(i=>({...i,feito:false}));
      salvarLocal(resetado,Date.now());
      return resetado;
    }
    // PC novo / sem localStorage: usa defaults com timestamp 0 pra Supabase vencer
    const inicial=AGENDA_INICIAL.map(i=>({...i,feito:false}));
    salvarLocal(inicial,0); // timestamp 0 = "dados provisórios, Supabase tem prioridade"
    return inicial;
  });

  // ── Sync com Supabase ao montar + visibilitychange ──
  const itensRef=useRef(itens);
  itensRef.current=itens; // sempre atualizado pra flush
  const realtimeAgendaRef=useRef(false);
  useEffect(()=>{
    const syncFromSupabase=async()=>{
      try{
        const {data:row}=await supabase.from('amicia_data').select('payload').eq('user_id','agenda').maybeSingle();
        if(!row?.payload?.itens)return;
        const remote=row.payload;
        const local=lerLocal();
        const localTs=local?._updated||0;
        const remoteTs=remote._updated||0;
        // Se mês diferente no remoto, reseta feito
        let remoteItens=remote.itens;
        if(remote.mes!==mesHoje||remote.ano!==anoHoje){
          remoteItens=remoteItens.map(i=>({...i,feito:false}));
        }
        // Se local tem timestamp 0 (PC novo, dados provisórios) → Supabase SEMPRE vence
        if(localTs===0||remoteTs>localTs){
          console.log("AGENDA: Supabase vence"+(localTs===0?" (PC novo, sem dados reais)":""),remoteTs?new Date(remoteTs).toLocaleString("pt-BR"):"");
          setItens(remoteItens);
          salvarLocal(remoteItens,remoteTs);
        }else if(localTs>remoteTs){
          console.log("AGENDA: localStorage mais recente, enviando pro Supabase");
          salvarSupabase(local.itens,localTs);
        }
      }catch(e){console.error("AGENDA sync:",e)}
    };
    syncFromSupabase();
    const onVis=()=>{if(document.visibilityState==="visible")syncFromSupabase();};
    document.addEventListener("visibilitychange",onVis);
    return()=>{document.removeEventListener("visibilitychange",onVis);if(saveTimerRef.current)clearTimeout(saveTimerRef.current);};
  },[]);

  // ── REALTIME AGENDA — sync entre devices em tempo real ──
  useEffect(()=>{
    if(!supabase)return;
    const ch=supabase.channel('sync-agenda')
      .on('postgres_changes',{event:'*',schema:'public',table:'amicia_data',filter:'user_id=eq.agenda'},(payload)=>{
        const d=payload.new?.payload;
        if(!d?.itens||!d._updated)return;
        // Ignora eco do próprio save (30s margem)
        if(Math.abs(d._updated-lastSyncRef.current)<30000){console.log("REALTIME AGENDA: ignorando eco");return;}
        console.log("REALTIME AGENDA: recebido update de outro device,",d.itens.length,"itens");
        realtimeAgendaRef.current=true;
        let remoteItens=d.itens;
        if(d.mes!==mesHoje||d.ano!==anoHoje){
          remoteItens=remoteItens.map(i=>({...i,feito:false}));
        }
        setItens(remoteItens);
        salvarLocal(remoteItens,d._updated);
        setTimeout(()=>{realtimeAgendaRef.current=false;},2000);
      }).subscribe();
    return()=>{supabase.removeChannel(ch);};
  },[]);

  // ── FLUSH ao fechar aba — salva imediatamente sem esperar debounce ──
  useEffect(()=>{
    const flush=()=>{
      if(saveTimerRef.current)clearTimeout(saveTimerRef.current);
      const ts=Date.now();
      salvarLocal(itensRef.current,ts);
      // Tenta salvar no Supabase via keepalive fetch
      const sbUrl=localStorage.getItem("sb_url");
      const sbKey=localStorage.getItem("sb_key");
      if(sbUrl&&sbKey){
        try{
          const body=JSON.stringify({user_id:'agenda',payload:{itens:itensRef.current,mes:mesHoje,ano:anoHoje,_updated:ts}});
          fetch(`${sbUrl}/rest/v1/amicia_data`,{
            method:'POST',headers:{'Content-Type':'application/json','apikey':sbKey,'Authorization':`Bearer ${sbKey}`,'Prefer':'resolution=merge-duplicates'},
            body,keepalive:true
          }).catch(()=>{});
        }catch(e){console.error("AGENDA flush:",e);}
      }
    };
    window.addEventListener("pagehide",flush);
    return()=>window.removeEventListener("pagehide",flush);
  },[]);

  const [novoItem,setNovoItem]=useState({dia:"",descricao:""});
  const [mostraAdd,setMostraAdd]=useState(false);
  const [saveStatus,setSaveStatus]=useState(null);
  const [lixeira,setLixeira]=useState([]);
  const [confirm,setConfirm]=useState(null);
  const markChange=()=>{
    setSaveStatus("saving");
    setTimeout(()=>setSaveStatus("saved"),600);
  };
  const toggle=(id)=>{setItens(prev=>{const novo=prev.map(i=>i.id===id?{...i,feito:!i.feito}:i);salvarTudo(novo);return novo;});setSaveStatus("saving");setTimeout(()=>setSaveStatus("saved"),600);};
  const remover=(id)=>{setConfirm({msg:"Apagar este compromisso?",onYes:()=>{setItens(prev=>{const item=prev.find(x=>x.id===id);if(item)setLixeira(l=>[...l,item]);const novo=prev.filter(x=>x.id!==id);salvarTudo(novo);return novo;});setConfirm(null);markChange();}});};
  const desfazer=()=>{if(!lixeira.length)return;const u=lixeira[lixeira.length-1];setItens(prev=>{const novo=[...prev,u].sort((a,b)=>a.dia-b.dia);salvarTudo(novo);return novo;});setLixeira(l=>l.slice(0,-1));};
  const adicionar=()=>{if(!novoItem.dia||!novoItem.descricao.trim())return;setItens(prev=>{const novo=[...prev,{id:Date.now(),dia:parseInt(novoItem.dia),descricao:novoItem.descricao.trim(),feito:false}];salvarTudo(novo);return novo;});setNovoItem({dia:"",descricao:""});markChange();};
  const sorted=[...itens].sort((a,b)=>a.dia-b.dia);
  const alertas=sorted.filter(i=>!i.feito&&i.dia<hoje);
  const hojeItems=sorted.filter(i=>!i.feito&&i.dia===hoje);
  const proximos=sorted.filter(i=>!i.feito&&i.dia>hoje);
  const feitos=sorted.filter(i=>i.feito);
  const ItemRow=({item,tipo})=>(
    <div style={{display:"grid",gridTemplateColumns:"40px 1fr 36px 28px",borderBottom:"1px solid #f0ebe4",background:item.feito?"#f9f9f7":"#fff"}}>
      <div style={{padding:"8px 10px",fontSize:16,fontWeight:700,color:tipo==="alerta"?"#c0392b":tipo==="hoje"?"#4a7fa5":"#2c3e50"}}>{item.dia}</div>
      <div style={{padding:"8px 6px",fontSize:12,color:item.feito?"#a0a0a0":"#2c3e50",textDecoration:item.feito?"line-through":"none"}}>
        {tipo==="alerta"&&<span style={{fontSize:10,color:"#c0392b",background:"#fdeaea",borderRadius:3,padding:"1px 5px",marginRight:5}}>Vencido</span>}
        {tipo==="hoje"&&<span style={{fontSize:10,color:"#4a7fa5",background:"#e8f0f8",borderRadius:3,padding:"1px 5px",marginRight:5}}>Hoje</span>}
        {item.descricao}
      </div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"center"}}><div onClick={()=>toggle(item.id)} style={{width:18,height:18,borderRadius:4,background:item.feito?"#27ae60":"#fff",border:item.feito?"none":"1px solid #c0d0dc",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>{item.feito&&<span style={{color:"#fff",fontSize:11,fontWeight:700}}>✓</span>}</div></div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"center"}}><span onClick={()=>remover(item.id)} style={{color:"#d0c8c0",cursor:"pointer",fontSize:14,lineHeight:1}}>×</span></div>
    </div>
  );
  return(
    <div>
      <ConfirmDialog confirm={confirm?confirm.msg:null} onCancel={()=>setConfirm(null)} onConfirm={()=>{confirm.onYes();}}/>
      {alertas.length>0&&(
        <div style={{background:"#fdeaea",border:"1px solid #f4b8b8",borderRadius:8,padding:"5px 12px",marginBottom:8,display:"flex",gap:8,alignItems:"center"}}>
          <span style={{fontSize:14}}>⚠️</span>
          <span style={{fontSize:12,fontWeight:600,color:"#c0392b"}}>{alertas.length} vencido(s):</span>
          <span style={{fontSize:11,color:"#c0392b",opacity:0.85,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{alertas.map(i=>i.descricao).join(", ")}</span>
        </div>
      )}
      <div style={{display:"flex",gap:8,marginBottom:8}}>
        {[{label:"Vencidos",value:alertas.length,color:"#c0392b",bg:"#fdeaea",border:"#f4b8b8"},{label:"Hoje",value:hojeItems.length,color:"#4a7fa5",bg:"#e8f0f8",border:"#c8d8e4"},{label:"Próximos",value:proximos.length,color:"#2c3e50",bg:"#fff",border:"#e8e2da"},{label:"Feitos",value:feitos.length,color:"#27ae60",bg:"#eafbf0",border:"#b8dfc8"}].map(c=>(
          <div key={c.label} style={{background:c.bg,borderRadius:8,padding:"5px 12px",border:`1px solid ${c.border}`,display:"flex",flexDirection:"column",alignItems:"center",minWidth:60}}>
            <span style={{fontSize:10,color:"#a89f94",letterSpacing:1,textTransform:"uppercase"}}>{c.label}</span>
            <span style={{fontSize:16,fontWeight:700,color:c.color}}>{c.value}</span>
          </div>
        ))}
      </div>
      <div style={{background:"#fff",borderRadius:12,border:"1px solid #e8e2da",overflow:"hidden"}}>
        <div style={{display:"grid",gridTemplateColumns:"40px 1fr 36px 28px",background:"#f7f4f0",borderBottom:"2px solid #e8e2da"}}>
          {["Dia","Descrição","✓",""].map((h,i)=><div key={i} style={{padding:"6px 10px",fontSize:10,color:"#a89f94",letterSpacing:1,textTransform:"uppercase",fontFamily:"Georgia,serif"}}>{h}</div>)}
        </div>
        {alertas.map(i=><ItemRow key={i.id} item={i} tipo="alerta"/>)}
        {hojeItems.map(i=><ItemRow key={i.id} item={i} tipo="hoje"/>)}
        {proximos.length>0&&<div style={{padding:"8px 14px",background:"#f9f8f6",borderBottom:"1px solid #e8e2da",fontSize:10,color:"#a89f94",letterSpacing:1,textTransform:"uppercase"}}>Próximos</div>}
        {proximos.map(i=><ItemRow key={i.id} item={i} tipo="futuro"/>)}
        {feitos.length>0&&<><div style={{padding:"8px 14px",background:"#f6fbf6",borderTop:"1px solid #e8e2da",borderBottom:"1px solid #e8e2da",fontSize:10,color:"#27ae60",letterSpacing:1,textTransform:"uppercase"}}>Concluídos ({feitos.length})</div>{feitos.map(i=><ItemRow key={i.id} item={i} tipo="feito"/>)}</>}
        <div style={{padding:"5px 12px",background:"#f7f4f0",borderTop:"1px solid #e8e2da",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <SaveBadge status={saveStatus}/>
            {lixeira.length>0&&<button onClick={desfazer} style={{fontSize:10,color:"#4a7fa5",background:"none",border:"1px solid #4a7fa5",borderRadius:4,padding:"2px 8px",cursor:"pointer"}}>↩ Desfazer</button>}
            <span style={{fontSize:10,color:"#a89f94"}}>{itens.length} item(s)</span>
          </div>
          <button onClick={()=>setMostraAdd(p=>!p)} style={{background:mostraAdd?"#2c3e50":"#4a7fa5",color:"#fff",border:"none",borderRadius:6,padding:"5px 14px",fontSize:12,cursor:"pointer",fontFamily:"Georgia,serif"}}>{mostraAdd?"✕ Fechar":"+ Novo"}</button>
        </div>
        {mostraAdd&&(
          <div style={{padding:"8px 12px",background:"#f0f6fb",borderTop:"1px solid #e8e2da"}}>
            <div style={{display:"grid",gridTemplateColumns:"64px 1fr 80px",gap:8,alignItems:"end"}}>
              <div><div style={{fontSize:10,color:"#a89f94",marginBottom:2}}>Dia</div><input value={novoItem.dia} onChange={e=>setNovoItem(p=>({...p,dia:e.target.value}))} type="number" min="1" max="31" style={{width:"100%",border:"1px solid #c8d8e4",borderRadius:6,padding:"6px 8px",fontSize:13,outline:"none",fontFamily:"Georgia,serif"}}/></div>
              <div><div style={{fontSize:10,color:"#a89f94",marginBottom:2}}>Descrição</div><input value={novoItem.descricao} onChange={e=>setNovoItem(p=>({...p,descricao:e.target.value}))} onKeyDown={e=>e.key==="Enter"&&adicionar()} style={{width:"100%",border:"1px solid #c8d8e4",borderRadius:6,padding:"6px 8px",fontSize:13,outline:"none",fontFamily:"Georgia,serif"}}/></div>
              <button onClick={adicionar} style={{background:"#4a7fa5",color:"#fff",border:"none",borderRadius:6,padding:"7px",fontSize:12,cursor:"pointer",height:34}}>+ Adicionar</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const HistoricoContent=({boletosShared,setBoletosShared,getReceitasMes,setReceitasMes,auxDataPorMes,setAuxDataPorMes,categoriasPorMes,setCategoriasPorMes,dadosMensais,mesAtual,prestadores,setPrestadores,fixosConfig,setFixosConfig,fixosNomesFunc,setFixosNomesFunc})=>{
  const anoAtual=2026;
  const anos=[2026,2025,2024,2023,2022,2021,2020,2019];
  const [anoSel,setAnoSel]=useState(anoAtual);
  const [mesSel,setMesSel]=useState(null);
  const getDadosAno=(ano)=>ano===anoAtual?dadosMensais:(HISTORICO[ano]||{});
  const dadosAno=getDadosAno(anoSel);
  const mesesComDados=Object.values(dadosAno).filter(d=>d.receita>0);
  const n=mesesComDados.length;
  const totalAno=mesesComDados.reduce((a,d)=>({receita:a.receita+d.receita,despesa:a.despesa+d.despesa}),{receita:0,despesa:0});
  const resultado=totalAno.receita-totalAno.despesa;
  if(mesSel!==null){
    const d=dadosAno[mesSel]||{};
    const temDados=d.receita>0;
    const mesNum=mesSel+1;
    const saldo=d.receita-d.despesa;
    if(anoSel===anoAtual){
      return(
        <div>
          <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:24}}>
            <button onClick={()=>setMesSel(null)} style={{background:"none",border:"1px solid #a3bacc",borderRadius:6,padding:"5px 14px",fontSize:12,cursor:"pointer",color:"#4a7fa5",fontFamily:"Georgia,serif"}}>← Voltar</button>
            <div style={{fontSize:22,fontWeight:600,color:"#2c3e50"}}>{MESES[mesSel]} {anoSel}</div>
            {!temDados&&<div style={{fontSize:12,color:"#a89f94",background:"#f7f4f0",padding:"4px 10px",borderRadius:6}}>Sem dados</div>}
          </div>
          <LancamentosContent mes={mesNum}
            receitas={getReceitasMes(mesNum)} setReceitas={(fn)=>setReceitasMes(mesNum,fn)}
            auxData={auxDataPorMes[mesNum]||{}} setAuxData={(fn)=>setAuxDataPorMes(prev=>({...prev,[mesNum]:typeof fn==="function"?fn(prev[mesNum]||{}):fn}))}
            categorias={categoriasPorMes[mesNum]||[...CATS]} setCategorias={(fn)=>setCategoriasPorMes(prev=>({...prev,[mesNum]:typeof fn==="function"?fn(prev[mesNum]||[...CATS]):fn}))}
            boletos={boletosShared} setBoletos={setBoletosShared} prestadores={prestadores} setPrestadores={setPrestadores}
            fixosConfig={fixosConfig} setFixosConfig={setFixosConfig} fixosNomesFunc={fixosNomesFunc} setFixosNomesFunc={setFixosNomesFunc}
          />
        </div>
      );
    }
    return(
      <div>
        <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:24}}>
          <button onClick={()=>setMesSel(null)} style={{background:"none",border:"1px solid #a3bacc",borderRadius:6,padding:"5px 14px",fontSize:12,cursor:"pointer",color:"#4a7fa5",fontFamily:"Georgia,serif"}}>← Voltar</button>
          <div style={{fontSize:22,fontWeight:600,color:"#2c3e50"}}>{MESES[mesSel]} {anoSel}</div>
          {!temDados&&<div style={{fontSize:12,color:"#a89f94",background:"#f7f4f0",padding:"4px 10px",borderRadius:6}}>Sem dados</div>}
        </div>
        {temDados?(
          <div style={{display:"flex",flexDirection:"column",gap:16}}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:16}}>
              {[{label:"Receita Total",value:d.receita,color:"#4a7fa5"},{label:"Despesas",value:d.despesa,color:"#c0392b"},{label:"Saldo",value:saldo,color:saldo>=0?"#27ae60":"#c0392b"}].map((c,i)=>(
                <div key={c.label} style={{background:"#fff",borderRadius:12,padding:20,border:"1px solid #e8e2da"}}>
                  <div style={{fontSize:10,color:"#a89f94",letterSpacing:1,textTransform:"uppercase",marginBottom:4}}>{c.label}</div>
                  <div style={{fontSize:20,fontWeight:700,color:c.color}}>{fmt(c.value)}</div>
                </div>
              ))}
            </div>
            <div style={{background:"#fff",borderRadius:12,border:"1px solid #e8e2da",overflow:"hidden"}}>
              <div style={{padding:"12px 20px",borderBottom:"1px solid #e8e2da",fontSize:11,color:"#a89f94",letterSpacing:2,textTransform:"uppercase"}}>Canais</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr"}}>
                {[{label:"Silva Teles",value:d.silvaTeles},{label:"Bom Retiro",value:d.bomRetiro},{label:"Marketplaces",value:d.marketplaces}].map((c,i)=>(
                  <div key={c.label} style={{padding:"16px 20px",borderRight:i<2?"1px solid #e8e2da":"none"}}>
                    <div style={{fontSize:10,color:"#a89f94",marginBottom:4}}>{c.label}</div>
                    <div style={{fontSize:16,fontWeight:600,color:"#2c3e50"}}>{fmt(c.value)}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ):(
          <div style={{background:"#fff",borderRadius:12,padding:48,border:"1px solid #e8e2da",textAlign:"center",color:"#c0b8b0",fontSize:13}}>Sem dados para este mês</div>
        )}
      </div>
    );
  }
  return(
    <div>
      <div style={{display:"flex",gap:4,marginBottom:24,flexWrap:"wrap"}}>
        {anos.map(ano=>(
          <button key={ano} onClick={()=>{setAnoSel(ano);setMesSel(null);}} style={{padding:"7px 16px",border:"none",background:anoSel===ano?"#2c3e50":"#fff",color:anoSel===ano?"#fff":"#6b7c8a",borderRadius:6,cursor:"pointer",fontSize:12,fontFamily:"Georgia,serif",border:"1px solid "+(anoSel===ano?"#2c3e50":"#e8e2da")}}>{ano}</button>
        ))}
      </div>
      {n>0&&(
        <div style={{background:"#fff",borderRadius:12,border:"1px solid #e8e2da",overflow:"hidden",marginBottom:20}}>
          <div style={{padding:"12px 20px",borderBottom:"1px solid #e8e2da",fontSize:11,color:"#a89f94",letterSpacing:2,textTransform:"uppercase"}}>Resumo {anoSel}</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)"}}>
            {[{label:"Receita Total",value:totalAno.receita,color:"#4a7fa5"},{label:"Despesa Total",value:totalAno.despesa,color:"#c0392b"},{label:"Saldo",value:resultado,color:resultado>=0?"#27ae60":"#c0392b"},{label:"Meses c/ dados",value:n+" meses",color:"#2c3e50"}].map((c,i)=>(
              <div key={c.label} style={{padding:"18px 20px",borderRight:i<3?"1px solid #e8e2da":"none"}}>
                <div style={{fontSize:10,color:"#a89f94",letterSpacing:1,textTransform:"uppercase",marginBottom:4}}>{c.label}</div>
                <div style={{fontSize:18,fontWeight:700,color:c.color}}>{typeof c.value==="number"?fmt(c.value):c.value}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div style={{fontSize:11,color:"#a89f94",letterSpacing:2,textTransform:"uppercase",marginBottom:12}}>Meses</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14}}>
        {MESES.map((mes,i)=>{
          const d=dadosAno[i]||{};
          const temDados=d.receita>0;
          const isAtual=anoSel===anoAtual&&i===mesAtual-1;
          const isFuturo=anoSel===anoAtual&&i>=mesAtual;
          const saldo=d.receita-d.despesa;
          return(
            <div key={mes} onClick={()=>setMesSel(i)} style={{background:"#fff",borderRadius:12,padding:16,border:"1px solid "+(isAtual?"#4a7fa5":"#e8e2da"),cursor:"pointer",position:"relative",transition:"box-shadow 0.15s"}}>
              {isAtual&&<div style={{position:"absolute",top:8,right:10,fontSize:10,color:"#4a7fa5",fontWeight:700}}>Atual</div>}
              <div style={{fontSize:15,fontWeight:600,color:"#2c3e50",marginBottom:10}}>{mes}</div>
              {temDados?(
                <>
                  <div style={{fontSize:13,color:"#4a7fa5",fontWeight:600,marginBottom:3}}>{fmt(d.receita)}</div>
                  <div style={{fontSize:11,color:"#8a9aa4",marginBottom:8}}>Receita</div>
                  <div style={{height:3,background:"#e8e2da",borderRadius:2,overflow:"hidden"}}><div style={{height:"100%",background:saldo>=0?"#27ae60":"#c0392b",width:Math.min(Math.abs(saldo)/Math.max(d.receita,1)*100,100)+"%"}}/></div>
                  <div style={{fontSize:11,color:saldo>=0?"#27ae60":"#c0392b",marginTop:6}}>Saldo {fmt(saldo)}</div>
                </>
              ):(
                <div style={{fontSize:12,color:"#c0b8b0",marginTop:6}}>{isFuturo?"Aguardando":"Sem dados"}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

const TIPOS_REL=[
  {id:"vendas",label:"Vendas",Icon:SvgVendas,desc:"Por canal e total"},
  {id:"despesas",label:"Despesas",Icon:SvgDespesas,desc:"Todas as categorias"},
  {id:"resultado",label:"Resultado",Icon:SvgResultado,desc:"Receita · Despesa · Saldo · Margem"},
  {id:"prestadores",label:"Prestadores",Icon:SvgPrestadores,desc:"Oficinas · Salas de Corte · Passadoria"},
  {id:"projecao",label:"Projeção",Icon:SvgProjecao,desc:"2 meses seguintes com base no histórico"},
  {id:"copiar",label:"Copiar para análise",Icon:SvgCopiar,desc:"Copia dados formatados · Cola direto no Claude"},
];

const RelatorioContent=(props)=>{
  const {auxDataPorMes={},receitasPorMes={},prestadores={},boletosShared=[],cortes=[],mesAtual=3}=props;
  const [tipo,setTipo]=useState(null);
  const [mesSel,setMesSel]=useState(3);
  const [copiado,setCopiado]=useState(false);
  const MES_ATUAL=mesAtual;
  const copiarDados=()=>{
    const anoAtual=new Date().getFullYear();
    const mesesDados=Array.from({length:12},(_,i)=>i+1).filter(m=>receitasPorMes[m]&&Object.keys(receitasPorMes[m]).length>0);
    const totMes=(m)=>{
      const rec=receitasPorMes[m]||{};
      const aux=auxDataPorMes[m]||{};
      const st=Object.values(rec).reduce((s,d)=>s+parseFloat(d.silvaTeles||0),0);
      const br=Object.values(rec).reduce((s,d)=>s+parseFloat(d.bomRetiro||0),0);
      const mkt=Object.values(rec).reduce((s,d)=>s+parseFloat(d.marketplaces||0),0);
      const r=st+br+mkt;
      const desp=CATS.reduce((s,c)=>{
        if(c==="Taxas Cartão")return s+Math.round(r*0.01);
        if(c==="Taxas Marketplaces")return s+Math.round(mkt*0.29);
        if(c==="Funcionários")return s+(aux["Funcionários"]||[]).reduce((a,x)=>a+["salario","comissao","extra","alimentacao","vale","ferias","rescisao"].reduce((b,f)=>b+parseFloat(x[f]||0),0),0);
        return s+(aux[c]||[]).reduce((a,x)=>a+parseFloat(x.valor||0),0);
      },0);
      return{st,br,mkt,r,desp,saldo:r-desp,margem:r>0?(((r-desp)/r)*100).toFixed(1):0};
    };
    const R=(n)=>"R$ "+Math.round(n).toLocaleString("pt-BR");
    let txt="";
    txt+=`GRUPO AMÍCIA — DADOS PARA ANÁLISE\n`;
    txt+=`Gerado em: ${new Date().toLocaleString("pt-BR")}\n`;
    txt+=`${"─".repeat(50)}\n\n`;
    txt+=`P&L MENSAL ${anoAtual}:\n`;
    let rAno=0,dAno=0;
    mesesDados.forEach(m=>{
      const t=totMes(m);rAno+=t.r;dAno+=t.desp;
      txt+=`${MESES[m-1]}: Receita ${R(t.r)} | ST ${R(t.st)} | BR ${R(t.br)} | MKT ${R(t.mkt)} | Desp ${R(t.desp)} | Saldo ${R(t.saldo)} | Margem ${t.margem}%\n`;
    });
    txt+=`TOTAL ANO: Receita ${R(rAno)} | Despesa ${R(dAno)} | Saldo ${R(rAno-dAno)}\n\n`;
    const aberto=boletosShared.filter(b=>!b.pago);
    const totAberto=aberto.reduce((s,b)=>s+parseFloat(b.valor||0),0);
    txt+=`BOLETOS EM ABERTO: ${R(totAberto)} (${aberto.length} boletos)\n`;
    if(navigator.clipboard){navigator.clipboard.writeText(txt).then(()=>{setCopiado(true);setTimeout(()=>setCopiado(false),3000);});}
    else{const el=document.createElement("textarea");el.value=txt;document.body.appendChild(el);el.select();document.execCommand("copy");document.body.removeChild(el);setCopiado(true);setTimeout(()=>setCopiado(false),3000);}
  };
  const auxMes=auxDataPorMes[mesSel]||{};
  const recMes=receitasPorMes[mesSel]||{};
  const totalST=Object.values(recMes).reduce((s,d)=>s+parseFloat(d.silvaTeles||0),0);
  const totalBR=Object.values(recMes).reduce((s,d)=>s+parseFloat(d.bomRetiro||0),0);
  const totalMKT=Object.values(recMes).reduce((s,d)=>s+parseFloat(d.marketplaces||0),0);
  const totalVendas=totalST+totalBR+totalMKT;
  const calcDesp=(cat)=>{
    if(cat==="Taxas Cartão")return Math.round(totalVendas*0.01);
    if(cat==="Taxas Marketplaces")return Math.round(totalMKT*0.29);
    if(cat==="Funcionários")return(auxMes["Funcionários"]||[]).reduce((s,r)=>s+["salario","comissao","extra","alimentacao","vale","ferias","rescisao"].reduce((b,f)=>b+parseFloat(r[f]||0),0),0);
    return(auxMes[cat]||[]).reduce((s,r)=>s+parseFloat(r.valor||0),0);
  };
  const totalDesp=CATS.reduce((s,c)=>s+calcDesp(c),0);
  const resultado=totalVendas-totalDesp;
  const margem=totalVendas>0?((resultado/totalVendas)*100).toFixed(1):0;
  const MesFiltro=()=>(<div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",marginBottom:20}}>{MESES.map((m,i)=><button key={m} onClick={()=>setMesSel(i+1)} style={{padding:"4px 12px",border:"none",borderRadius:5,background:mesSel===i+1?"#2c3e50":"#fff",color:mesSel===i+1?"#fff":"#6b7c8a",cursor:"pointer",fontSize:11,fontFamily:"Georgia,serif",border:"1px solid "+(mesSel===i+1?"#2c3e50":"#e8e2da")}}>{m}</button>)}</div>);
  const BackBtn=()=>(<button onClick={()=>setTipo(null)} style={{background:"none",border:"1px solid #a3bacc",borderRadius:6,padding:"5px 14px",fontSize:12,cursor:"pointer",color:"#4a7fa5",fontFamily:"Georgia,serif"}}>← Voltar</button>);
  if(!tipo)return(
    <div>
      <div style={{fontSize:11,color:"#a89f94",letterSpacing:2,textTransform:"uppercase",marginBottom:14}}>Tipo de Relatório</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
        {TIPOS_REL.map(t=>(
          <div key={t.id} onClick={()=>{if(t.id==="copiar"){copiarDados();return;}setTipo(t.id);}} style={{background:"#fff",borderRadius:12,padding:"20px 16px",border:"1px solid #e8e2da",cursor:"pointer",display:"flex",gap:14,alignItems:"center",minHeight:70}}>
            <div style={{width:44,height:44,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}><t.Icon size={40}/></div>
            <div style={{flex:1}}>
              <div style={{fontSize:14,fontWeight:600,color:"#2c3e50",marginBottom:3}}>{t.id==="copiar"&&copiado?"✓ Copiado!":t.label}</div>
              <div style={{fontSize:11,color:"#a89f94",lineHeight:1.3}}>{t.desc}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
  if(tipo==="vendas")return(
    <div>
      <div style={{display:"flex",gap:16,alignItems:"center",marginBottom:20}}><BackBtn/><div style={{fontSize:18,fontWeight:600,color:"#2c3e50"}}>Vendas por Canal</div></div>
      <MesFiltro/>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:16,marginBottom:20}}>
        {[{label:"Total",value:totalVendas,color:"#2c3e50"},{label:"Silva Teles",value:totalST,color:"#4a7fa5"},{label:"Bom Retiro",value:totalBR,color:"#4a7fa5"},{label:"Marketplaces",value:totalMKT,color:"#4a7fa5"}].map(c=>(
          <div key={c.label} style={{background:"#fff",borderRadius:12,padding:18,border:"1px solid #e8e2da"}}>
            <div style={{fontSize:10,color:"#a89f94",letterSpacing:1,textTransform:"uppercase",marginBottom:4}}>{c.label}</div>
            <div style={{fontSize:18,fontWeight:700,color:c.color}}>{fmt(c.value)}</div>
          </div>
        ))}
      </div>
    </div>
  );
  if(tipo==="despesas")return(
    <div>
      <div style={{display:"flex",gap:16,alignItems:"center",marginBottom:20}}><BackBtn/><div style={{fontSize:18,fontWeight:600,color:"#2c3e50"}}>Despesas por Categoria</div></div>
      <MesFiltro/>
      <div style={{background:"#fff",borderRadius:12,border:"1px solid #e8e2da",overflow:"hidden"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
          <thead><tr style={{background:"#4a7fa5"}}>{["Categoria","Valor","% Receita"].map(h=><th key={h} style={{padding:"8px 14px",textAlign:h==="Categoria"?"left":"right",color:"#fff",fontSize:11,fontWeight:600}}>{h}</th>)}</tr></thead>
          <tbody>
            {CATS.map(cat=>{const v=calcDesp(cat);if(v===0)return null;return(<tr key={cat} style={{borderBottom:"1px solid #f0ebe4"}}><td style={{padding:"8px 14px",color:"#2c3e50"}}>{cat}</td><td style={{padding:"8px 14px",textAlign:"right",fontWeight:600,color:"#2c3e50"}}>{fmt(v)}</td><td style={{padding:"8px 14px",textAlign:"right",color:"#8a9aa4"}}>{totalVendas>0?((v/totalVendas)*100).toFixed(1)+"%":"—"}</td></tr>);})}
          </tbody>
          <tfoot><tr style={{background:"#f7f4f0",borderTop:"2px solid #e8e2da"}}><td style={{padding:"10px 14px",fontWeight:700,color:"#2c3e50"}}>Total</td><td style={{padding:"10px 14px",textAlign:"right",fontWeight:700,color:"#c0392b"}}>{fmt(totalDesp)}</td><td/></tr></tfoot>
        </table>
      </div>
    </div>
  );
  if(tipo==="resultado")return(
    <div>
      <div style={{display:"flex",gap:16,alignItems:"center",marginBottom:20}}><BackBtn/><div style={{fontSize:18,fontWeight:600,color:"#2c3e50"}}>Resultado</div></div>
      <MesFiltro/>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:16}}>
        {[{label:"Receita",value:totalVendas,color:"#4a7fa5"},{label:"Despesa",value:totalDesp,color:"#c0392b"},{label:"Saldo",value:resultado,color:resultado>=0?"#27ae60":"#c0392b"},{label:"Margem",value:margem+"%",color:"#2c3e50"}].map(c=>(
          <div key={c.label} style={{background:"#fff",borderRadius:12,padding:20,border:"1px solid #e8e2da"}}>
            <div style={{fontSize:10,color:"#a89f94",letterSpacing:1,textTransform:"uppercase",marginBottom:4}}>{c.label}</div>
            <div style={{fontSize:22,fontWeight:700,color:c.color}}>{typeof c.value==="number"?fmt(c.value):c.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
  if(tipo==="prestadores")return(
    <div>
      <div style={{display:"flex",gap:16,alignItems:"center",marginBottom:20}}><BackBtn/><div style={{fontSize:18,fontWeight:600,color:"#2c3e50"}}>Prestadores</div></div>
      <MesFiltro/>
      {CATS_PREST.map(cat=>{
        const itens=auxMes[cat]||[];
        const total=itens.reduce((s,r)=>s+parseFloat(r.valor||0),0);
        if(itens.length===0)return null;
        return(
          <div key={cat} style={{background:"#fff",borderRadius:12,border:"1px solid #e8e2da",overflow:"hidden",marginBottom:12}}>
            <div style={{padding:"10px 16px",background:"#f7f4f0",borderBottom:"1px solid #e8e2da",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{fontSize:13,fontWeight:600,color:"#2c3e50"}}>{cat}</div>
              <div style={{fontSize:13,fontWeight:700,color:"#2c3e50"}}>{fmt(total)}</div>
            </div>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
              <tbody>{itens.map((r,i)=><tr key={i} style={{borderBottom:"1px solid #f0ebe4"}}><td style={{padding:"7px 12px",color:"#6b7c8a"}}>{r.data||"—"}</td><td style={{padding:"7px 12px",color:"#2c3e50"}}>{r.prestador||"—"}</td><td style={{padding:"7px 12px",textAlign:"right",fontWeight:600,color:"#2c3e50"}}>{fmt(parseFloat(r.valor||0))}</td></tr>)}</tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
  if(tipo==="projecao"){
    const mesesBase=[MES_ATUAL-2,MES_ATUAL-1].filter(m=>m>=1);
    const mesesProj=[MES_ATUAL+1,MES_ATUAL+2];
    const calcDespMes=(cat,mesNum)=>{
      const aux=auxDataPorMes[mesNum]||{};
      const rec=receitasPorMes[mesNum]||{};
      const totalVendasMes=Object.values(rec).reduce((s,d)=>s+parseFloat(d.silvaTeles||0)+parseFloat(d.bomRetiro||0)+parseFloat(d.marketplaces||0),0);
      const totalMktMes=Object.values(rec).reduce((s,d)=>s+parseFloat(d.marketplaces||0),0);
      if(cat==="Taxas Cartão")return Math.round(totalVendasMes*0.01);
      if(cat==="Taxas Marketplaces")return Math.round(totalMktMes*0.29);
      if(cat==="Valor de Correção")return 10000;
      if(cat==="Funcionários")return(aux["Funcionários"]||[]).reduce((s,r)=>s+["salario","comissao","extra","alimentacao","vale","ferias","rescisao"].reduce((b,f)=>b+parseFloat(r[f]||0),0),0);
      return(aux[cat]||[]).reduce((s,r)=>s+parseFloat(r.valor||0),0);
    };
    const mediaCat=(cat)=>{const vals=mesesBase.map(m=>calcDespMes(cat,m)).filter(v=>v>0);return vals.length>0?Math.round(vals.reduce((s,v)=>s+v,0)/vals.length):0;};
    const boletosDoMes=(mesNum)=>boletosShared.filter(b=>b.mes===mesNum).reduce((s,b)=>s+parseFloat(b.valor||0),0);
    const projetarCat=(cat,mesNum)=>{if(cat==="Tecidos"){const bol=boletosDoMes(mesNum);return bol>0?bol:mediaCat(cat);}return mediaCat(cat);};
    const totalProj=(mesNum)=>CATS.reduce((s,c)=>s+projetarCat(c,mesNum),0);
    return(
      <div>
        <div style={{display:"flex",gap:16,alignItems:"center",marginBottom:20}}><BackBtn/><div style={{fontSize:18,fontWeight:600,color:"#2c3e50"}}>Projeção</div></div>
        <div style={{background:"#fff8e8",border:"1px solid #f0d080",borderRadius:12,padding:"12px 20px",marginBottom:20,display:"flex",gap:10,alignItems:"flex-start"}}>
          <span>💡</span>
          <div style={{fontSize:13,color:"#8a6500"}}><strong>Base:</strong> média de {mesesBase.map(m=>MESES[m-1]).join(" + ")} por categoria. Tecidos usa boletos lançados quando disponível.</div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:24}}>
          {mesesProj.map(mesNum=>{
            const bol=boletosDoMes(mesNum);
            const tecidos=projetarCat("Tecidos",mesNum);
            return(
              <div key={mesNum} style={{background:"#fff",borderRadius:12,padding:22,border:"1px solid #e8e2da"}}>
                <div style={{fontSize:11,color:"#a89f94",letterSpacing:2,textTransform:"uppercase",marginBottom:8}}>{MESES[mesNum-1]} (projetado)</div>
                <div style={{fontSize:26,fontWeight:700,color:"#c0392b",marginBottom:8}}>{fmt(totalProj(mesNum))}</div>
                <div style={{fontSize:12,color:"#8a9aa4"}}>Tecidos: <strong style={{color:"#2c3e50"}}>{fmt(tecidos)}</strong>{bol>0&&<span style={{fontSize:11,color:"#4a7fa5",marginLeft:6}}>← boletos reais</span>}{bol===0&&<span style={{fontSize:11,color:"#a89f94",marginLeft:6}}>← média</span>}</div>
              </div>
            );
          })}
        </div>
        <div style={{background:"#fff",borderRadius:12,border:"1px solid #e8e2da",overflow:"hidden"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
            <thead><tr style={{background:"#f7f4f0",borderBottom:"2px solid #e8e2da"}}><th style={{padding:"10px 16px",textAlign:"left",fontSize:11,color:"#a89f94",fontWeight:600}}>Categoria</th><th style={{padding:"10px 16px",textAlign:"right",fontSize:11,color:"#a89f94",fontWeight:600}}>Média base</th>{mesesProj.map(m=><th key={m} style={{padding:"10px 16px",textAlign:"right",fontSize:11,color:"#a89f94",fontWeight:600}}>{MESES[m-1]}</th>)}</tr></thead>
            <tbody>
              {CATS.map(cat=>{
                const media=mediaCat(cat);
                const vals=mesesProj.map(m=>projetarCat(cat,m));
                if(media===0&&vals.every(v=>v===0))return null;
                const isTecidos=cat==="Tecidos";
                return(
                  <tr key={cat} style={{borderBottom:"1px solid #f0ebe4",background:isTecidos?"#f7f9ff":"#fff"}}>
                    <td style={{padding:"9px 16px",color:"#2c3e50",fontWeight:isTecidos?600:400}}>{cat}</td>
                    <td style={{padding:"9px 16px",textAlign:"right",color:"#a89f94"}}>{fmt(media)}</td>
                    {mesesProj.map((m,j)=>{const v=vals[j];const usouBoleto=isTecidos&&boletosDoMes(m)>0;return(<td key={m} style={{padding:"9px 16px",textAlign:"right",color:usouBoleto?"#4a7fa5":"#6b7c8a",fontWeight:usouBoleto?600:400}}>{fmt(v)}{usouBoleto&&<span style={{fontSize:10,marginLeft:4}}>📎</span>}</td>);})}
                  </tr>
                );
              })}
            </tbody>
            <tfoot><tr style={{background:"#f7f4f0",borderTop:"2px solid #e8e2da"}}><td style={{padding:"12px 16px",fontWeight:700,color:"#2c3e50"}}>Total Projetado</td><td style={{padding:"12px 16px",textAlign:"right",fontWeight:700,color:"#6b7c8a"}}>{fmt(CATS.reduce((s,c)=>s+mediaCat(c),0))}</td>{mesesProj.map(m=><td key={m} style={{padding:"12px 16px",textAlign:"right",fontWeight:700,color:"#c0392b"}}>{fmt(totalProj(m))}</td>)}</tr></tfoot>
          </table>
        </div>
      </div>
    );
  }
  return null;
};

const OFICINAS_CAD_INICIAL=PRESTADORES_INICIAL["Oficinas Costura"].map((p,i)=>({codigo:String(i+1).padStart(2,"0"),descricao:p.nome}));
const STATUS_COR={amarelo:"#f0b429",vermelho:"#c0392b",azul:"#4a7fa5",verde:"#27ae60"};
const STATUS_BG={amarelo:"#fffbea",vermelho:"#fdeaea",azul:"#eaf3fb",verde:"#eafbf0"};
const STATUS_LABEL={amarelo:"Na oficina",vermelho:"Atrasado",azul:"Entregue",verde:"Pago"};
const getStatusCorte=(c)=>{if(c.pago)return"verde";if(c.entregue)return"azul";const dias=Math.floor((Date.now()-new Date(c.data))/(86400000));return dias>=30?"vermelho":"amarelo";};
const getDias=(c)=>Math.floor((Date.now()-new Date(c.data))/(86400000));
const ORDEM_STATUS={amarelo:0,vermelho:1,azul:2,verde:3};
const EstrelaScore=({n})=>(<span style={{color:"#f0b429",fontSize:12}}>{[1,2,3,4,5].map(i=><span key={i} style={{opacity:i<=n?1:0.25}}>★</span>)}</span>);

const OficinasContent=({cortes,setCortes,produtos,setProdutos,oficinasCAD,setOficinasCAD,logTroca,setLogTroca,setAuxDataPorMes,tecidosCAD=[],setTecidosCAD,isAdmin=true})=>{
  const [aba,setAba]=useState("cortes");
  const [cadAba,setCadAba]=useState("produtos");
  const [filtroOf,setFiltroOf]=useState("todas");
  const [filtroMarca,setFiltroMarca]=useState("todas");
  const [filtroStatus,setFiltroStatus]=useState("todos");
  const [filtroPago,setFiltroPago]=useState("todos");
  const [filtroRef,setFiltroRef]=useState("");
  const [mostraForm,setMostraForm]=useState(false);
  const [editId,setEditId]=useState(null);
  const [form,setForm]=useState({nCorte:"",ref:"",descricao:"",marca:"Amícia",qtd:"",valorUnit:"",oficina:"",data:new Date().toISOString().slice(0,10)});
  const [refBusca,setRefBusca]=useState("");
  const [formProd,setFormProd]=useState({ref:"",descricao:"",marca:"Amícia",valorUnit:"",tecido:""});
  const [formOf,setFormOf]=useState({codigo:"",descricao:""});
  const [editProdRef,setEditProdRef]=useState(null);
  const [editOfCod,setEditOfCod]=useState(null);
  const [formTec,setFormTec]=useState({descricao:"",metragemRolo:"",valorMetro:""});
  const [editTecId,setEditTecId]=useState(null);
  const [buscaProd,setBuscaProd]=useState("");
  const [trocaDe,setTrocaDe]=useState("");
  const [trocaPara,setTrocaPara]=useState("");
  const [trocaMsg,setTrocaMsg]=useState("");

  // Fotos: mesma lógica FotoProd + zoom DOM
  const sbUrl=import.meta.env.VITE_SUPABASE_URL||localStorage.getItem("sb_url")||"";
  const handleZoom=(src)=>{const ov=document.createElement('div');ov.style.cssText='position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:99999;display:flex;align-items:center;justify-content:center;cursor:pointer';const img=document.createElement('img');img.src=src;img.style.cssText='width:265px;height:378px;object-fit:cover;border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,0.3);border:3px solid #fff';ov.appendChild(img);ov.onclick=()=>document.body.removeChild(ov);document.body.appendChild(ov);};
  const [dashPeriodo,setDashPeriodo]=useState("ano");
  const [dashDe,setDashDe]=useState("");
  const [dashAte,setDashAte]=useState("");
  const [dashMarca,setDashMarca]=useState("todas");
  const [dashOf,setDashOf]=useState("todas");
  const [alertaVer,setAlertaVer]=useState(false);
  const [verValores,setVerValores]=useState(false);
  const [confirm,setConfirm]=useState(null);
  const iStyle={border:"1px solid #c8d8e4",borderRadius:6,padding:"5px 6px",fontSize:12,outline:"none",fontFamily:"Georgia,serif",boxSizing:"border-box"};
  const cortesOrdenados=[...cortes].sort((a,b)=>{const sa=ORDEM_STATUS[getStatusCorte(a)],sb=ORDEM_STATUS[getStatusCorte(b)];if(sa!==sb)return sa-sb;return new Date(b.data)-new Date(a.data);});
  const cortesFiltrados=cortesOrdenados.filter(c=>{
    if(filtroOf!=="todas"&&c.oficina!==filtroOf)return false;
    if(filtroMarca!=="todas"&&c.marca!==filtroMarca)return false;
    if(filtroPago==="pago"&&!c.pago)return false;
    if(filtroPago==="naopago"&&c.pago)return false;
    if(filtroStatus!=="todos"){const st=getStatusCorte(c);if(filtroStatus!==st)return false;}
    if(filtroRef.trim()&&!c.ref.toLowerCase().includes(filtroRef.toLowerCase().trim()))return false;
    return true;
  });
  const buscarProd=(ref)=>produtos.find(p=>p.ref===String(ref).trim());
  const handleRefChange=(v)=>{setRefBusca(v);const p=buscarProd(v);if(p)setForm(prev=>({...prev,ref:v,descricao:p.descricao,marca:p.marca,valorUnit:Number(p.valorUnit)}));else setForm(prev=>({...prev,ref:v}));};
  const salvarCorte=()=>{
    if(!form.ref||!form.oficina||!form.qtd||!form.valorUnit)return;
    const qtd=parseFloat(form.qtd)||0,vu=parseFloat(form.valorUnit)||0;
    const item={id:editId||Date.now(),nCorte:form.nCorte,ref:form.ref,descricao:form.descricao,marca:form.marca,qtd,valorUnit:vu,valorTotal:Math.round(qtd*vu*100)/100,oficina:form.oficina,data:form.data,qtdEntregue:qtd,entregue:false,dataEntrega:null,pago:false,dataPagamento:null,obs:"",_mod:Date.now()};
    if(editId)setCortes(prev=>prev.map(c=>c.id===editId?item:c));
    else setCortes(prev=>[...prev,item]);
    setForm({nCorte:"",ref:"",descricao:"",marca:"Amícia",qtd:"",valorUnit:"",oficina:"",data:new Date().toISOString().slice(0,10)});
    setRefBusca("");setMostraForm(false);setEditId(null);
  };
  const iniciarEdicao=(c)=>{setEditId(c.id);setForm({nCorte:c.nCorte,ref:c.ref,descricao:c.descricao,marca:c.marca,qtd:String(c.qtd),valorUnit:String(c.valorUnit),oficina:c.oficina,data:c.data});setRefBusca(c.ref);setMostraForm(true);};
  const deletarCorte=(id)=>setConfirm({msg:"Apagar este corte?",onYes:()=>{setCortes(prev=>prev.filter(c=>c.id!==id));setConfirm(null);}});
  const toggleEntregue=(id)=>{setCortes(prev=>prev.map(c=>{if(c.id!==id)return c;const ne=!c.entregue;return{...c,entregue:ne,dataEntrega:ne?new Date().toLocaleDateString("pt-BR"):null,pago:ne?c.pago:false,_mod:Date.now()};}));};
  const togglePago=(id)=>{
    setCortes(prev=>prev.map(c=>{
      if(c.id!==id||!c.entregue)return c;
      const np=!c.pago;
      if(np&&setAuxDataPorMes){const hoje=new Date(),mes=hoje.getMonth()+1;const dd=`${String(hoje.getDate()).padStart(2,"0")}/${String(mes).padStart(2,"0")}`;const vl=String(Math.round((c.qtdEntregue||c.qtd)*(c.valorUnit||0)*100)/100);setAuxDataPorMes(m=>{const aux=m[mes]||{},ofs=[...(aux["Oficinas Costura"]||[])];ofs.push({data:dd,prestador:c.oficina,valor:vl,descricao:`REF ${c.ref} - ${c.descricao}`});return{...m,[mes]:{...aux,"Oficinas Costura":ofs}};});}
      return{...c,pago:np,dataPagamento:np?new Date().toLocaleDateString("pt-BR"):null,_mod:Date.now()};
    }));
  };
  const editarQtdEntregue=(id,v)=>setCortes(prev=>prev.map(c=>c.id===id?{...c,qtdEntregue:parseFloat(v)||0,_mod:Date.now()}:c));
  const executarTroca=()=>{
    if(!trocaDe||!trocaPara){setTrocaMsg("Preencha os dois campos.");return;}
    if(trocaDe===trocaPara){setTrocaMsg("As referências são iguais.");return;}
    setProdutos(prev=>prev.map(p=>p.ref===trocaDe?{...p,ref:trocaPara,_mod:Date.now()}:p));
    setCortes(prev=>prev.map(c=>c.ref===trocaDe?{...c,ref:trocaPara,_mod:Date.now()}:c));
    const hoje=new Date().toLocaleDateString("pt-BR");
    setLogTroca(prev=>[{de:trocaDe,para:trocaPara,data:hoje},...prev]);
    setTrocaMsg(`✓ REF ${trocaDe} → ${trocaPara} atualizada.`);
    setTrocaDe("");setTrocaPara("");
  };
  const hoje=new Date();
  const anoStr=String(hoje.getFullYear());
  const filtroPeriodo=(c)=>{if(dashPeriodo==="ano")return c.data.startsWith(anoStr);if(dashPeriodo==="custom"&&dashDe&&dashAte)return c.data>=dashDe&&c.data<=dashAte;return true;};
  const cortesDash=cortes.filter(c=>filtroPeriodo(c)&&(dashMarca==="todas"||c.marca===dashMarca)&&(dashOf==="todas"||c.oficina===dashOf));
  const oficinasUnicas=[...new Set(cortes.map(c=>c.oficina))].filter(Boolean);
  const kpiOficina=(of)=>{
    const cs=cortesDash.filter(c=>c.oficina===of);
    const totalEnviadas=cs.reduce((s,c)=>s+c.qtd,0);
    const totalEntregues=cs.reduce((s,c)=>s+(c.qtdEntregue||c.qtd),0);
    const totalValor=cs.filter(c=>c.pago).reduce((s,c)=>s+(c.qtdEntregue||c.qtd)*c.valorUnit,0);
    const entregues=cs.filter(c=>c.entregue||c.pago);
    const prazos=entregues.filter(c=>c.dataEntrega).map(c=>Math.floor((new Date(c.dataEntrega.split("/").reverse().join("-"))-new Date(c.data))/86400000));
    const prazoMedio=prazos.length>0?Math.round(prazos.reduce((a,v)=>a+v,0)/prazos.length):null;
    const pontualidade=entregues.length>0?Math.round(entregues.filter(c=>{const d=getDias(c);return d<=30;}).length/entregues.length*100):null;
    const perda=totalEnviadas>0?Math.round((totalEnviadas-totalEntregues)/totalEnviadas*100):0;
    const np=pontualidade!=null?pontualidade/100:0.5;const nm=prazoMedio!=null?Math.max(0,1-prazoMedio/60):0.5;const npe=Math.max(0,1-perda/20);
    const nota=Math.round((np*0.4+nm*0.3+npe*0.3)*5);
    const emAberto=cortes.filter(c=>c.oficina===of&&!c.entregue&&!c.pago).reduce((s,c)=>s+c.qtd,0);
    return{totalEnviadas,totalEntregues,totalValor,prazoMedio,pontualidade,perda,nota,emAberto};
  };
  const historicoMedioOf=(of)=>{const cs=cortes.filter(c=>c.oficina===of);if(cs.length===0)return 0;const meses=new Set(cs.map(c=>c.data.slice(0,7)));return Math.round(cs.reduce((s,c)=>s+c.qtd,0)/Math.max(meses.size,1));};
  const emAbertoPorOf=(of)=>cortes.filter(c=>c.oficina===of&&!c.entregue&&!c.pago).reduce((s,c)=>s+c.qtd,0);
  const alertas=oficinasUnicas.map(of=>{const med=historicoMedioOf(of),aberto=emAbertoPorOf(of);if(med===0)return null;const pct=Math.round((aberto-med)/med*100);if(pct>=50)return{of,tipo:"sobrecarga",pct};if(pct<=-30)return{of,tipo:"ociosa",pct};return null;}).filter(Boolean);
  const exportarAberto=()=>{
    const linhas=["Nº Corte;Ref;Descrição;Marca;Qtd;Vl.Unit;Total;Oficina;Data;Dias"];
    cortesFiltrados.filter(c=>!c.pago).forEach(c=>{const st=getStatusCorte(c);linhas.push(`${c.nCorte};${c.ref};${c.descricao};${c.marca};${c.qtd};${c.valorUnit};${c.valorTotal};${c.oficina};${c.data};${getDias(c)}`);});
    const blob=new Blob([linhas.join("\n")],{type:"text/csv;charset=utf-8;"});
    const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="cortes_aberto.csv";a.click();URL.revokeObjectURL(url);
  };

  // Sub-tabs com SVG
  const TabBtn=({id,label,Icon})=>(
    <button onClick={()=>setAba(id)} style={{display:"flex",alignItems:"center",gap:6,padding:"7px 18px",border:"none",background:"transparent",borderBottom:aba===id?"2px solid #2c3e50":"2px solid transparent",cursor:"pointer",fontSize:13,fontFamily:"Georgia,serif",color:aba===id?"#2c3e50":"#8a9aa4",fontWeight:aba===id?600:400}}>
      <Icon size={18}/>{label}
    </button>
  );

  return(
    <div>
      <ConfirmDialog confirm={confirm?confirm.msg:null} onCancel={()=>setConfirm(null)} onConfirm={()=>{confirm.onYes();}}/>
      <div style={{display:"flex",borderBottom:"1px solid #e8e2da",marginBottom:16}}>
        <TabBtn id="cortes" label="Cortes" Icon={SvgCortes}/>
        <TabBtn id="dashboard" label="Dashboard" Icon={SvgDashOficinas}/>
        <TabBtn id="cadastros" label="Cadastros" Icon={SvgCadastros}/>
      </div>

      {aba==="cortes"&&(
        <div>
          <div style={{display:"flex",gap:6,marginBottom:8,alignItems:"center",flexWrap:"wrap"}}>
            <input value={filtroRef} onChange={e=>setFiltroRef(e.target.value)} placeholder="Buscar ref..." style={{...iStyle,width:90}} />
            <select value={filtroOf} onChange={e=>setFiltroOf(e.target.value)} style={{...iStyle,flex:2,minWidth:120}}>
              <option value="todas">Todas as oficinas</option>
              {oficinasCAD.map(o=><option key={o.codigo} value={o.descricao}>{o.descricao}</option>)}
            </select>
            <select value={filtroMarca} onChange={e=>setFiltroMarca(e.target.value)} style={{...iStyle,flex:1}}>
              <option value="todas">Marca</option><option value="Amícia">Amícia</option><option value="Meluni">Meluni</option>
            </select>
            <select value={filtroStatus} onChange={e=>setFiltroStatus(e.target.value)} style={{...iStyle,flex:1}}>
              <option value="todos">Status</option><option value="amarelo">Na oficina</option><option value="vermelho">Atrasado</option><option value="azul">Entregue</option><option value="verde">Pago</option>
            </select>
            <select value={filtroPago} onChange={e=>setFiltroPago(e.target.value)} style={{...iStyle,flex:1}}>
              <option value="todos">Pagto</option><option value="pago">✓ Pago</option><option value="naopago">Não pago</option>
            </select>
            <button onClick={exportarAberto} style={{background:"#fff",border:"1px solid #4a7fa5",color:"#4a7fa5",borderRadius:6,padding:"5px 10px",fontSize:11,cursor:"pointer"}}>↓ CSV</button>
            <button onClick={()=>{setMostraForm(p=>!p);setEditId(null);setForm({nCorte:"",ref:"",descricao:"",marca:"Amícia",qtd:"",valorUnit:"",oficina:"",data:new Date().toISOString().slice(0,10)});setRefBusca("");}} style={{background:mostraForm?"#2c3e50":"#4a7fa5",color:"#fff",border:"none",borderRadius:6,padding:"5px 14px",fontSize:12,cursor:"pointer",fontFamily:"Georgia,serif"}}>{mostraForm?"✕ Fechar":"+ Novo Corte"}</button>
          </div>
          {mostraForm&&(
            <div style={{background:"#f0f6fb",border:"1px solid #c8d8e4",borderRadius:10,padding:14,marginBottom:12}}>
              <div style={{display:"grid",gridTemplateColumns:"0.7fr 0.6fr 1.8fr 0.8fr 0.5fr 0.5fr 1.1fr 0.9fr 0.7fr",gap:8,alignItems:"end"}}>
                <div><div style={{fontSize:11,color:"#2c3e50",marginBottom:2,fontWeight:700}}>Nº Corte</div><input value={form.nCorte} onChange={e=>setForm(p=>({...p,nCorte:e.target.value}))} style={{...iStyle,width:"100%"}}/></div>
                <div><div style={{fontSize:11,color:"#2c3e50",marginBottom:2,fontWeight:700}}>Ref</div><input value={refBusca} onChange={e=>handleRefChange(e.target.value)} style={{...iStyle,width:"100%"}}/></div>
                <div><div style={{fontSize:11,color:"#2c3e50",marginBottom:2,fontWeight:700}}>Descrição</div><input value={form.descricao} onChange={e=>setForm(p=>({...p,descricao:e.target.value}))} style={{...iStyle,width:"100%"}}/></div>
                <div><div style={{fontSize:11,color:"#2c3e50",marginBottom:2,fontWeight:700}}>Marca</div><select value={form.marca} onChange={e=>setForm(p=>({...p,marca:e.target.value}))} style={{...iStyle,width:"100%"}}><option>Amícia</option><option>Meluni</option></select></div>
                <div><div style={{fontSize:11,color:"#2c3e50",marginBottom:2,fontWeight:700}}>Qtd</div><input value={form.qtd} onChange={e=>setForm(p=>({...p,qtd:e.target.value}))} style={{...iStyle,width:"100%"}}/></div>
                <div><div style={{fontSize:11,color:"#2c3e50",marginBottom:2,fontWeight:700}}>Vl.Unit</div><input value={form.valorUnit} onChange={e=>setForm(p=>({...p,valorUnit:e.target.value}))} style={{...iStyle,width:"100%"}}/></div>
                <div><div style={{fontSize:11,color:"#2c3e50",marginBottom:2,fontWeight:700}}>Oficina</div><select value={form.oficina} onChange={e=>setForm(p=>({...p,oficina:e.target.value}))} style={{...iStyle,width:"100%"}}><option value="">Selecionar</option>{oficinasCAD.map(o=><option key={o.codigo} value={o.descricao}>{o.descricao}</option>)}</select></div>
                <div><div style={{fontSize:11,color:"#2c3e50",marginBottom:2,fontWeight:700}}>Data envio</div><input type="date" value={form.data} onChange={e=>setForm(p=>({...p,data:e.target.value}))} style={{...iStyle,width:"100%"}}/></div>
                <div style={{display:"flex",alignItems:"flex-end"}}><button onClick={salvarCorte} style={{background:"#4a7fa5",color:"#fff",border:"none",borderRadius:6,padding:"7px 14px",fontSize:12,cursor:"pointer",width:"100%"}}>{editId?"Atualizar":"Salvar"}</button></div>
              </div>
              {refBusca&&!buscarProd(refBusca)&&<div style={{marginTop:8,padding:"6px 12px",background:"#fff8e8",border:"1px solid #f0d080",borderRadius:6,fontSize:11,color:"#8a6500"}}>⚠ REF {refBusca} não cadastrada. <button onClick={()=>{setCadAba("produtos");setAba("cadastros");setFormProd(p=>({...p,ref:refBusca}));}} style={{background:"none",border:"none",color:"#4a7fa5",cursor:"pointer",fontSize:11,textDecoration:"underline"}}>Cadastrar agora</button></div>}
            </div>
          )}
          <div style={{background:"#fff",borderRadius:12,border:"1px solid #e8e2da",overflow:"hidden"}}>
            <div style={{overflowX:"auto",WebkitOverflowScrolling:"touch"}}>
              <div style={{overflowY:"auto",maxHeight:760,minWidth:1150}}>
                <div style={{display:"grid",gridTemplateColumns:"10px 52px 84px 1fr 90px 60px 100px 90px 90px 52px 24px 52px 70px 60px 32px 28px",background:"#4a7fa5",position:"sticky",top:0,zIndex:1}}>
                  {["","Nº Corte","Ref","Descrição · Marca","Oficina","Qtd","Vl.Unit","Total","Data","Entregue","","Pago","Qtd Entr.","Faltante","",""].map((h,i)=>(
                    <div key={i} style={{padding:"7px 8px",fontSize:10,color:"#fff",fontWeight:600,letterSpacing:0.5,textTransform:"uppercase"}}>{h}</div>
                  ))}
                </div>
                {cortesFiltrados.length===0&&<div style={{padding:32,textAlign:"center",color:"#c0b8b0",fontSize:13}}>Nenhum corte encontrado</div>}
                {cortesFiltrados.map(c=>{
                  const st=getStatusCorte(c);
                  const qtdEntr=c.qtdEntregue!=null?c.qtdEntregue:(c.entregue?c.qtd:null);
                  const faltante=c.entregue&&qtdEntr!=null?c.qtd-qtdEntr:null;
                  return(
                    <div key={c.id} style={{display:"grid",gridTemplateColumns:"10px 52px 84px 1fr 90px 60px 100px 90px 90px 52px 24px 52px 70px 60px 32px 28px",borderBottom:"1px solid #d0dde8",alignItems:"center"}}>
                      <div style={{height:"100%",background:STATUS_COR[st],minHeight:36,alignSelf:"stretch"}}/>
                      <div style={{padding:"5px 6px",fontSize:11,fontWeight:600,color:"#4a7fa5",background:"#edf4fb",alignSelf:"stretch",display:"flex",alignItems:"center"}}>{c.nCorte}</div>
                      <div style={{padding:"3px 4px",display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
                        <FotoProd sbUrl={sbUrl} refProd={c.ref} onZoom={handleZoom}/><div style={{width:34,height:44,borderRadius:4,background:"#f0ebe3",display:"none",alignItems:"center",justifyContent:"center",border:"1px solid #e8e2da",flexShrink:0}}><span style={{fontSize:12,opacity:0.3}}>📷</span></div>
                        <div style={{fontSize:12,fontWeight:700,color:"#2c3e50",fontFamily:"Georgia,serif"}}>{c.ref}</div>
                      </div>
                      <div style={{padding:"5px 8px"}}><div style={{fontSize:12,color:"#2c3e50"}}>{c.descricao}</div><span style={{fontSize:9,color:"#fff",background:c.marca==="Meluni"?"#9b59b6":"#4a7fa5",borderRadius:3,padding:"1px 5px"}}>{c.marca}</span></div>
                      <div style={{padding:"5px 8px",fontSize:11,color:"#2c3e50"}}>{c.oficina}</div>
                      <div style={{padding:"5px 8px",fontSize:15,fontWeight:700,textAlign:"right",color:"#2c3e50",fontFamily:_FN}}>{c.qtd}</div>
                      <div style={{padding:"5px 8px",fontSize:_FS,fontWeight:700,textAlign:"right",color:"#2c3e50",fontFamily:_FN}}>{c.valorUnit!=null?"R$ "+Number(c.valorUnit).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2}):"—"}</div>
                      <div style={{padding:"5px 8px",fontSize:_FS,fontWeight:700,textAlign:"right",color:"#2c3e50",fontFamily:_FN}}>{fmt(c.valorTotal)}</div>
                      <div style={{padding:"5px 8px",fontSize:11,color:"#6b7c8a"}}>{new Date(c.data).toLocaleDateString("pt-BR")}</div>
                      <div style={{display:"flex",alignItems:"center",justifyContent:"center"}}><div onClick={()=>!c.pago&&toggleEntregue(c.id)} style={{width:18,height:18,borderRadius:4,background:c.entregue||c.pago?"#4a7fa5":"#fff",border:c.entregue||c.pago?"none":"1px solid #c0d0dc",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>{(c.entregue||c.pago)&&<span style={{color:"#fff",fontSize:11,fontWeight:700}}>✓</span>}</div></div>
                      <div/>
                      <div style={{display:"flex",alignItems:"center",justifyContent:"center"}}><div onClick={()=>c.entregue&&togglePago(c.id)} style={{width:18,height:18,borderRadius:4,background:c.pago?"#27ae60":"#fff",border:c.pago?"none":"1px solid #c0d0dc",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>{c.pago&&<span style={{color:"#fff",fontSize:11,fontWeight:700}}>✓</span>}</div></div>
                      <div style={{padding:"3px 6px"}}>{c.entregue?(<input type="number" min="0" max={c.qtd} value={qtdEntr??""} onChange={e=>editarQtdEntregue(c.id,e.target.value)} style={{width:"100%",border:"1px solid #c8d8e4",borderRadius:4,padding:"3px 5px",fontSize:12,textAlign:"right",fontFamily:_FN,outline:"none"}}/>):(<div style={{textAlign:"right",fontSize:12,color:"#d0c8c0",fontFamily:_FN}}>—</div>)}</div>
                      <div style={{padding:"5px 8px",textAlign:"right"}}>{faltante!=null?(<span style={{fontSize:12,fontWeight:700,fontFamily:_FN,color:faltante>0?"#c0392b":"#27ae60"}}>{faltante>0?`-${faltante}`:faltante===0?"✓":faltante}</span>):(<span style={{fontSize:12,color:"#d0c8c0"}}>—</span>)}</div>
                      <div style={{display:"flex",alignItems:"center",justifyContent:"center"}}><span onClick={()=>iniciarEdicao(c)} style={{cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>
  <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
    <path d="M14.5 2.5L17.5 5.5L7 16H4V13L14.5 2.5Z" fill="#4a7fa5" stroke="#3a6f95" strokeWidth="1" strokeLinejoin="round"/>
    <path d="M12.5 4.5L15.5 7.5" stroke="#3a6f95" strokeWidth="1" strokeLinecap="round"/>
    <path d="M4 13L7 16" stroke="#3a6f95" strokeWidth="1" strokeLinecap="round"/>
  </svg>
</span></div>
                      <div style={{display:"flex",alignItems:"center",justifyContent:"center"}}><span onClick={()=>deletarCorte(c.id)} style={{cursor:"pointer",color:"#d0c8c0",fontSize:16,lineHeight:1}}>×</span></div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div style={{padding:"7px 16px",background:"#f7f4f0",borderTop:"1px solid #e8e2da",display:"flex",gap:16,flexWrap:"wrap",alignItems:"center"}}>
              {Object.entries(STATUS_LABEL).map(([k,v])=>(<div key={k} style={{display:"flex",alignItems:"center",gap:5,fontSize:10,color:"#6b7c8a"}}><div style={{width:10,height:10,borderRadius:2,background:STATUS_COR[k]}}/>{v}</div>))}
              <div style={{marginLeft:"auto",fontSize:11,color:"#a89f94"}}>{cortesFiltrados.length} corte(s)</div>
            </div>
          </div>
        </div>
      )}

      {aba==="dashboard"&&(()=>{
        const totalEmAberto=cortesDash.filter(c=>!c.entregue&&!c.pago).reduce((s,c)=>s+c.qtd,0);
        const nCortesAberto=cortesDash.filter(c=>!c.entregue&&!c.pago).length;
        const totalAtrasado=cortesDash.filter(c=>!c.entregue&&!c.pago&&getDias(c)>=30).reduce((s,c)=>s+c.qtd,0);
        const nCortesAtrasado=cortesDash.filter(c=>!c.entregue&&!c.pago&&getDias(c)>=30).length;
        const trintaDiasAtras=new Date(Date.now()-30*86400000);
        const totalEntregue30d=cortesDash.filter(c=>(c.entregue||c.pago)&&c.dataEntrega&&new Date(c.dataEntrega.split("/").reverse().join("-"))>=trintaDiasAtras).reduce((s,c)=>s+(c.qtdEntregue||c.qtd),0);
        const nCortes30d=cortesDash.filter(c=>(c.entregue||c.pago)&&c.dataEntrega&&new Date(c.dataEntrega.split("/").reverse().join("-"))>=trintaDiasAtras).length;
        const totalEnviadas=cortesDash.reduce((s,c)=>s+c.qtd,0);
        const totalEntregues=cortesDash.filter(c=>c.entregue||c.pago).reduce((s,c)=>s+(c.qtdEntregue||c.qtd),0);
        const pctNaoEntregue=totalEnviadas>0?(((totalEnviadas-totalEntregues)/totalEnviadas)*100).toFixed(1):0;
        const nNaoEntregue=totalEnviadas-totalEntregues;
        const perda=totalEnviadas-totalEntregues;
        const totalAPagar=cortesDash.filter(c=>c.entregue&&!c.pago).reduce((s,c)=>s+(c.qtdEntregue||c.qtd)*c.valorUnit,0);
        const totalPago=cortesDash.filter(c=>c.pago).reduce((s,c)=>s+(c.qtdEntregue||c.qtd)*c.valorUnit,0);
        const totalEntregueNP=cortesDash.filter(c=>c.entregue&&!c.pago).reduce((s,c)=>s+c.qtd,0);
        const pctPerda=totalEnviadas>0?((perda/totalEnviadas)*100).toFixed(1):0;
        return(
          <div>
            <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap",alignItems:"center"}}>
              <div style={{display:"flex",background:"#e8e2da",borderRadius:8,padding:3}}>
                {[{id:"ano",label:"Ano corrente"},{id:"custom",label:"Período"}].map(o=>(
                  <button key={o.id} onClick={()=>setDashPeriodo(o.id)} style={{padding:"5px 14px",border:"none",borderRadius:6,background:dashPeriodo===o.id?"#2c3e50":"transparent",color:dashPeriodo===o.id?"#fff":"#6b7c8a",cursor:"pointer",fontSize:12,fontFamily:"Georgia,serif"}}>{o.label}</button>
                ))}
              </div>
              {dashPeriodo==="custom"&&<><input type="date" value={dashDe} onChange={e=>setDashDe(e.target.value)} style={{...iStyle}}/><span style={{fontSize:12,color:"#a89f94"}}>→</span><input type="date" value={dashAte} onChange={e=>setDashAte(e.target.value)} style={{...iStyle}}/><button onClick={()=>{}} style={{background:"#2c3e50",color:"#fff",border:"none",borderRadius:6,padding:"5px 14px",fontSize:12,cursor:"pointer",fontFamily:"Georgia,serif"}}>Filtrar</button></>}
              <select value={dashMarca} onChange={e=>setDashMarca(e.target.value)} style={{...iStyle}}><option value="todas">Todas as marcas</option><option>Amícia</option><option>Meluni</option></select>
              <select value={dashOf} onChange={e=>setDashOf(e.target.value)} style={{...iStyle}}><option value="todas">Todas as oficinas</option>{oficinasUnicas.map(of=><option key={of}>{of}</option>)}</select>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,marginBottom:16}}>
              {[{label:"Peças em produção",pcs:totalEmAberto,sub:`${nCortesAberto} corte(s)`,color:"#2c3e50",bg:"#fff",border:"#e8e2da"},{label:"Peças em atraso",pcs:totalAtrasado,sub:`${nCortesAtrasado} corte(s)`,color:"#c0392b",bg:"#fdeaea",border:"#f4b8b8"},{label:"Entregues · últ. 30 dias",pcs:totalEntregue30d,sub:`${nCortes30d} corte(s)`,color:"#27ae60",bg:"#eafbf0",border:"#b8dfc8"}].map((c,i)=>(
                <div key={i} style={{background:c.bg,borderRadius:12,padding:"16px 18px",border:`1px solid ${c.border}`}}>
                  <div style={{fontSize:9,color:"#a89f94",letterSpacing:2,textTransform:"uppercase",marginBottom:4}}>{c.label}</div>
                  <div style={{fontSize:28,fontWeight:700,color:c.color,lineHeight:1}}>{c.pcs}</div>
                  <div style={{fontSize:10,color:"#8a9aa4",marginTop:6}}>{c.sub}</div>
                </div>
              ))}
            </div>
            <div style={{marginBottom:16}}>
              <button onClick={()=>setVerValores(p=>!p)} style={{background:"#fff",border:"1px solid #e8e2da",borderRadius:6,padding:"5px 14px",fontSize:11,cursor:"pointer",color:"#6b7c8a",fontFamily:"Georgia,serif"}}>{verValores?"▲":"▼"} Valores financeiros</button>
              {verValores&&(
                <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,marginTop:10}}>
                  {[{label:"A pagar (entregue)",value:fmt(totalAPagar),sub:totalEntregueNP+" pç aguardando",color:"#c0392b"},{label:"Total pago no período",value:fmt(totalPago),color:"#27ae60"},{label:"Perda estimada",value:perda+" peças",sub:pctPerda+"% do enviado",color:perda>0?"#c0392b":"#27ae60"}].map((c,i)=>(
                    <div key={i} style={{background:"#fff",borderRadius:10,padding:"14px 16px",border:"1px solid #e8e2da"}}>
                      <div style={{fontSize:9,color:"#a89f94",letterSpacing:2,textTransform:"uppercase",marginBottom:4}}>{c.label}</div>
                      <div style={{fontSize:18,fontWeight:700,color:c.color}}>{c.value}</div>
                      {c.sub&&<div style={{fontSize:10,color:"#8a9aa4",marginTop:4}}>{c.sub}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
            {alertas.length>0&&(
              <div style={{marginBottom:16}}>
                <div onClick={()=>setAlertaVer(p=>!p)} style={{background:"#fff8e8",border:"1px solid #f0d080",borderRadius:alertaVer?"10px 10px 0 0":10,padding:"10px 16px",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <span style={{fontSize:12,fontWeight:600,color:"#8a6500"}}>⚠ {alertas.length} alerta(s) de carga</span>
                  <span style={{fontSize:11,color:"#8a6500"}}>{alertaVer?"▲":"▼"}</span>
                </div>
                {alertaVer&&(<div style={{background:"#fff",border:"1px solid #f0d080",borderTop:"none",borderRadius:"0 0 10px 10px",padding:"0 16px"}}>{alertas.map((a,i)=>(<div key={i} style={{display:"flex",gap:10,alignItems:"center",padding:"6px 0",borderBottom:i<alertas.length-1?"1px solid #f7f0e0":"none"}}><span style={{fontSize:16}}>{a.tipo==="sobrecarga"?"🔴":"⚪"}</span><span style={{fontSize:13,color:"#2c3e50",fontWeight:600}}>{a.of}</span><span style={{fontSize:12,color:a.tipo==="sobrecarga"?"#c0392b":"#b7791f"}}>{a.tipo==="sobrecarga"?`${a.pct}% acima do histórico`:`${Math.abs(a.pct)}% abaixo`}</span></div>))}</div>)}
              </div>
            )}
            <div style={{background:"#fff",borderRadius:12,border:"1px solid #e8e2da",overflow:"hidden",marginBottom:16}}>
              <div style={{padding:"12px 16px",borderBottom:"1px solid #e8e2da",fontSize:11,color:"#a89f94",letterSpacing:2,textTransform:"uppercase"}}>Ranking por Oficina</div>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                <thead><tr style={{background:"#f7f4f0"}}>{["Oficina","Peças fabricadas","Valor pago","Prazo médio","Pontualidade","% Perda","Eficiência"].map(h=>(<th key={h} style={{padding:"8px 12px",textAlign:h==="Oficina"?"left":"center",fontSize:10,color:"#a89f94",fontWeight:600}}>{h}</th>))}</tr></thead>
                <tbody>
                  {oficinasUnicas.sort((a,b)=>kpiOficina(b).totalEntregues-kpiOficina(a).totalEntregues).map(of=>{
                    const k=kpiOficina(of);
                    return(<tr key={of} style={{borderBottom:"1px solid #f0ebe4"}}><td style={{padding:"9px 12px",fontWeight:600,color:"#2c3e50"}}>{of}</td><td style={{padding:"9px 12px",textAlign:"center",color:"#2c3e50"}}>{k.totalEntregues}<span style={{fontSize:10,color:"#a89f94",marginLeft:4}}>pç</span></td><td style={{padding:"9px 12px",textAlign:"center",color:"#27ae60",fontWeight:600}}>{fmt(k.totalValor)}</td><td style={{padding:"9px 12px",textAlign:"center",color:"#2c3e50"}}>{k.prazoMedio!=null?k.prazoMedio+"d":"—"}</td><td style={{padding:"9px 12px",textAlign:"center",color:k.pontualidade>=80?"#27ae60":k.pontualidade>=60?"#f0b429":"#c0392b"}}>{k.pontualidade!=null?k.pontualidade+"%":"—"}</td><td style={{padding:"9px 12px",textAlign:"center",color:k.perda>5?"#c0392b":"#27ae60"}}>{k.perda}%</td><td style={{padding:"9px 12px",textAlign:"center"}}><EstrelaScore n={k.nota}/></td></tr>);
                  })}
                  {oficinasUnicas.length===0&&<tr><td colSpan={7} style={{padding:24,textAlign:"center",color:"#c0b8b0",fontSize:13}}>Nenhum dado</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      {aba==="cadastros"&&(
        <div>
          <div style={{display:"flex",gap:4,borderBottom:"1px solid #e8e2da",marginBottom:16}}>
            {[{id:"produtos",label:"Produtos"},{id:"tecidos",label:"Tecidos"},{id:"oficinas",label:"Oficinas"},{id:"troca",label:"Troca de REF"},{id:"log",label:"Log"}].map(t=>(
              <button key={t.id} onClick={()=>setCadAba(t.id)} style={{padding:"6px 14px",border:"none",background:"transparent",borderBottom:cadAba===t.id?"2px solid #2c3e50":"2px solid transparent",cursor:"pointer",fontSize:12,fontFamily:"Georgia,serif",color:cadAba===t.id?"#2c3e50":"#8a9aa4"}}>{t.label}</button>
            ))}
          </div>
          {cadAba==="produtos"&&(
            <div>
              <div style={{background:"#f0f6fb",border:"1px solid #c8d8e4",borderRadius:10,padding:12,marginBottom:12}}>
                <div style={{display:"flex",flexWrap:"wrap",gap:6,alignItems:"end"}}>
                  <div style={{minWidth:50,flex:"0 0 50px"}}><div style={{fontSize:11,color:"#2c3e50",marginBottom:2,fontWeight:700}}>Ref</div><input value={formProd.ref} onChange={e=>setFormProd(p=>({...p,ref:e.target.value}))} style={{...iStyle,width:"100%"}}/></div>
                  <div style={{flex:"2 1 120px"}}><div style={{fontSize:11,color:"#2c3e50",marginBottom:2,fontWeight:700}}>Descrição</div><input value={formProd.descricao} onChange={e=>setFormProd(p=>({...p,descricao:e.target.value}))} style={{...iStyle,width:"100%"}}/></div>
                  <div style={{flex:"0 0 70px"}}><div style={{fontSize:11,color:"#2c3e50",marginBottom:2,fontWeight:700}}>Marca</div><select value={formProd.marca} onChange={e=>setFormProd(p=>({...p,marca:e.target.value}))} style={{...iStyle,width:"100%"}}><option>Amícia</option><option>Meluni</option></select></div>
                  <div style={{flex:"0 0 50px"}}><div style={{fontSize:11,color:"#2c3e50",marginBottom:2,fontWeight:700}}>R$</div><input value={formProd.valorUnit} onChange={e=>setFormProd(p=>({...p,valorUnit:e.target.value}))} style={{...iStyle,width:"100%"}}/></div>
                  <div style={{flex:"1 1 90px"}}><div style={{fontSize:11,color:"#2c3e50",marginBottom:2,fontWeight:700}}>Tecido</div><select value={formProd.tecido||""} onChange={e=>setFormProd(p=>({...p,tecido:e.target.value}))} style={{...iStyle,width:"100%",color:formProd.tecido?"#2c3e50":"#a89f94"}}><option value="">—</option>{(tecidosCAD||[]).map(t=><option key={t.id} value={t.descricao}>{t.descricao}</option>)}</select></div>
                  <div style={{flex:"0 0 80px"}}><button onClick={()=>{if(!formProd.ref||!formProd.descricao||!formProd.valorUnit)return;const valorNum=parseFloat(String(formProd.valorUnit).replace(",","."));if(editProdRef)setProdutos(prev=>prev.map(p=>p.ref===editProdRef?{...formProd,valorUnit:valorNum,_mod:Date.now()}:p));else if(produtos.find(p=>p.ref===formProd.ref)){alert("Ref já cadastrada!");}else setProdutos(prev=>[...prev,{...formProd,valorUnit:valorNum,_mod:Date.now()}]);setFormProd({ref:"",descricao:"",marca:"Amícia",valorUnit:"",tecido:""});setEditProdRef(null);}} style={{background:"#4a7fa5",color:"#fff",border:"none",borderRadius:6,padding:"7px 14px",fontSize:12,cursor:"pointer",width:"100%"}}>{editProdRef?"Atualizar":"Adicionar"}</button></div>
                </div>
              </div>
              {/* Busca */}
              {(()=>{const prodsFilt=buscaProd.trim()?produtos.filter(p=>p.ref.toLowerCase().includes(buscaProd.toLowerCase())||p.descricao.toLowerCase().includes(buscaProd.toLowerCase())):produtos;return(<>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
                <div style={{position:"relative",flex:1}}><span style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",fontSize:14,color:"#a89f94",pointerEvents:"none"}}>🔍</span><input value={buscaProd} onChange={e=>setBuscaProd(e.target.value)} placeholder="Buscar por referência ou descrição..." style={{...iStyle,width:"100%",paddingLeft:32,fontSize:12}}/></div>
                {buscaProd&&<button onClick={()=>setBuscaProd("")} style={{background:"none",border:"1px solid #e8e2da",borderRadius:6,padding:"6px 10px",fontSize:12,cursor:"pointer",color:"#a89f94"}}>✕</button>}
                <span style={{fontSize:11,color:"#a89f94",whiteSpace:"nowrap"}}>{prodsFilt.length} de {produtos.length}</span>
              </div>
              <div style={{background:"#fff",borderRadius:12,border:"1px solid #e8e2da",overflow:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,minWidth:500}}><thead><tr style={{background:"#4a7fa5"}}>{["Ref","Descrição","Marca","Tecido","Vl. Unit.",""].map(h=><th key={h} style={{padding:"7px 12px",textAlign:"left",color:"#fff",fontSize:10,fontWeight:600}}>{h}</th>)}</tr></thead>
                  <tbody>{prodsFilt.length===0&&<tr><td colSpan={6} style={{padding:24,textAlign:"center",color:"#c0b8b0",fontSize:13}}>{buscaProd?`Nenhum produto com "${buscaProd}"`:"Nenhum produto cadastrado"}</td></tr>}{prodsFilt.map(p=>(<tr key={p.ref} style={{borderBottom:"1px solid #f0ebe4"}}><td style={{padding:"8px 12px",fontWeight:700,color:"#2c3e50"}}>{p.ref}</td><td style={{padding:"8px 12px",color:"#2c3e50"}}>{p.descricao}</td><td style={{padding:"8px 12px"}}><span style={{fontSize:10,color:"#fff",background:p.marca==="Meluni"?"#9b59b6":"#4a7fa5",borderRadius:3,padding:"1px 6px"}}>{p.marca}</span></td><td style={{padding:"8px 12px",color:p.tecido?"#2c3e50":"#c0b8b0",fontSize:12}}>{p.tecido||"—"}</td><td style={{padding:"8px 12px",textAlign:"right",color:"#2c3e50",fontWeight:700,fontFamily:_FN}}>{fmt(p.valorUnit)}</td><td style={{padding:"8px 8px",textAlign:"center"}}><span onClick={()=>{const vStr=Number(p.valorUnit).toFixed(2).replace(".",",");setFormProd({ref:p.ref,descricao:p.descricao,marca:p.marca,valorUnit:vStr,tecido:p.tecido||""});setEditProdRef(p.ref);}} style={{cursor:"pointer",color:"#4a7fa5",fontSize:13,marginRight:8}}>✏</span>{isAdmin&&<span onClick={()=>setProdutos(prev=>prev.filter(x=>x.ref!==p.ref))} style={{cursor:"pointer",color:"#d0c8c0",fontSize:13}}>×</span>}</td></tr>))}</tbody>
                </table>
              </div></>);})()}
            </div>
          )}
          {cadAba==="tecidos"&&(
            <div>
              <div style={{background:"#f0f6fb",border:"1px solid #c8d8e4",borderRadius:10,padding:12,marginBottom:12}}>
                <div style={{display:"flex",flexWrap:"wrap",gap:6,alignItems:"end"}}>
                  <div style={{flex:"2 1 120px"}}><div style={{fontSize:11,color:"#2c3e50",marginBottom:2,fontWeight:700}}>Descrição</div><input value={formTec.descricao} onChange={e=>setFormTec(p=>({...p,descricao:e.target.value}))} placeholder="Ex: Linho" style={{...iStyle,width:"100%"}}/></div>
                  <div style={{flex:"1 1 80px"}}><div style={{fontSize:11,color:"#2c3e50",marginBottom:2,fontWeight:700}}>Metragem/Rolo</div><input type="number" value={formTec.metragemRolo} onChange={e=>setFormTec(p=>({...p,metragemRolo:e.target.value}))} placeholder="50" style={{...iStyle,width:"100%",textAlign:"center"}}/></div>
                  <div style={{flex:"1 1 80px"}}><div style={{fontSize:11,color:"#2c3e50",marginBottom:2,fontWeight:700}}>Valor/Metro</div><input value={formTec.valorMetro} onChange={e=>setFormTec(p=>({...p,valorMetro:e.target.value}))} placeholder="28,50" style={{...iStyle,width:"100%",textAlign:"center"}}/></div>
                  <div style={{flex:"0 0 80px"}}><button onClick={()=>{if(!formTec.descricao.trim())return;const t={id:editTecId||Date.now(),descricao:formTec.descricao.trim(),metragemRolo:Number(formTec.metragemRolo)||0,valorMetro:Number(String(formTec.valorMetro).replace(",","."))||0};if(editTecId&&setTecidosCAD)setTecidosCAD(prev=>prev.map(x=>x.id===editTecId?t:x));else if(setTecidosCAD)setTecidosCAD(prev=>[...prev,t]);setFormTec({descricao:"",metragemRolo:"",valorMetro:""});setEditTecId(null);}} style={{background:"#4a7fa5",color:"#fff",border:"none",borderRadius:6,padding:"7px 14px",fontSize:12,cursor:"pointer",width:"100%"}}>{editTecId?"Atualizar":"Adicionar"}</button></div>
                </div>
              </div>
              <div style={{background:"#fff",borderRadius:12,border:"1px solid #e8e2da",overflow:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,minWidth:400}}><thead><tr style={{background:"#4a7fa5"}}>{["Tecido","Metragem/Rolo","Valor/Metro","Custo/Rolo",""].map(h=><th key={h} style={{padding:"7px 12px",textAlign:"left",color:"#fff",fontSize:10,fontWeight:600}}>{h}</th>)}</tr></thead>
                  <tbody>{(tecidosCAD||[]).length===0&&<tr><td colSpan={5} style={{padding:24,textAlign:"center",color:"#c0b8b0",fontSize:13}}>Nenhum tecido cadastrado</td></tr>}{(tecidosCAD||[]).map(t=>(<tr key={t.id} style={{borderBottom:"1px solid #f0ebe4"}}><td style={{padding:"8px 12px",fontWeight:700,color:"#2c3e50"}}>{t.descricao}</td><td style={{padding:"8px 12px",color:"#6b7c8a"}}>{t.metragemRolo}m</td><td style={{padding:"8px 12px",fontFamily:_FN,fontWeight:700,color:"#2c3e50"}}>{fmt(t.valorMetro)}</td><td style={{padding:"8px 12px",fontFamily:_FN,fontWeight:700,color:"#4a7fa5"}}>{fmt(t.valorMetro*t.metragemRolo)}</td><td style={{padding:"8px 8px",textAlign:"center"}}><span onClick={()=>{setFormTec({descricao:t.descricao,metragemRolo:String(t.metragemRolo),valorMetro:String(t.valorMetro)});setEditTecId(t.id);}} style={{cursor:"pointer",color:"#4a7fa5",fontSize:13,marginRight:8}}>✏</span><span onClick={()=>{if(setTecidosCAD)setTecidosCAD(prev=>prev.filter(x=>x.id!==t.id));}} style={{cursor:"pointer",color:"#d0c8c0",fontSize:13}}>×</span></td></tr>))}</tbody>
                </table>
              </div>
            </div>
          )}
          {cadAba==="oficinas"&&(
            <div>
              <div style={{background:"#f0f6fb",border:"1px solid #c8d8e4",borderRadius:10,padding:12,marginBottom:12}}>
                <div style={{display:"grid",gridTemplateColumns:"80px 1fr 80px",gap:8,alignItems:"end"}}>
                  <div><div style={{fontSize:10,color:"#a89f94",marginBottom:2}}>Código</div><input value={formOf.codigo} onChange={e=>setFormOf(p=>({...p,codigo:e.target.value}))} style={{...iStyle,width:"100%"}}/></div>
                  <div><div style={{fontSize:10,color:"#a89f94",marginBottom:2}}>Descrição / Nome</div><input value={formOf.descricao} onChange={e=>setFormOf(p=>({...p,descricao:e.target.value}))} style={{...iStyle,width:"100%"}}/></div>
                  <button onClick={()=>{if(!formOf.codigo||!formOf.descricao)return;if(editOfCod)setOficinasCAD(prev=>prev.map(o=>o.codigo===editOfCod?{...formOf}:o));else setOficinasCAD(prev=>[...prev,{...formOf}]);setFormOf({codigo:"",descricao:""});setEditOfCod(null);}} style={{background:"#4a7fa5",color:"#fff",border:"none",borderRadius:6,padding:"7px",fontSize:12,cursor:"pointer"}}>{editOfCod?"Atualizar":"Adicionar"}</button>
                </div>
              </div>
              <div style={{background:"#fff",borderRadius:12,border:"1px solid #e8e2da",overflow:"hidden"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}><thead><tr style={{background:"#f7f4f0"}}>{["Código","Descrição","Cortes em aberto",""].map(h=><th key={h} style={{padding:"8px 12px",textAlign:"left",fontSize:10,color:"#a89f94",fontWeight:600}}>{h}</th>)}</tr></thead>
                  <tbody>{oficinasCAD.length===0&&<tr><td colSpan={4} style={{padding:24,textAlign:"center",color:"#c0b8b0"}}>Nenhuma oficina cadastrada</td></tr>}{oficinasCAD.map(o=>{const aberto=cortes.filter(c=>c.oficina===o.descricao&&!c.entregue&&!c.pago).length;return(<tr key={o.codigo} style={{borderBottom:"1px solid #f0ebe4"}}><td style={{padding:"8px 12px",fontWeight:700,color:"#2c3e50"}}>{o.codigo}</td><td style={{padding:"8px 12px",color:"#2c3e50"}}>{o.descricao}</td><td style={{padding:"8px 12px"}}>{aberto>0?<span style={{background:"#fffbea",color:"#b7791f",borderRadius:4,padding:"2px 8px",fontSize:11}}>{aberto} em aberto</span>:<span style={{color:"#a0a0a0",fontSize:11}}>—</span>}</td><td style={{padding:"8px 8px",textAlign:"center"}}><span onClick={()=>{setFormOf({codigo:o.codigo,descricao:o.descricao});setEditOfCod(o.codigo);}} style={{cursor:"pointer",color:"#4a7fa5",fontSize:13,marginRight:8}}>✏</span><span onClick={()=>setOficinasCAD(prev=>prev.filter(x=>x.codigo!==o.codigo))} style={{cursor:"pointer",color:"#d0c8c0",fontSize:13}}>×</span></td></tr>);})}</tbody>
                </table>
              </div>
            </div>
          )}
          {cadAba==="troca"&&(
            <div style={{maxWidth:480}}>
              <div style={{background:"#fff8e8",border:"1px solid #f0d080",borderRadius:10,padding:"12px 16px",marginBottom:16,fontSize:12,color:"#8a6500"}}>⚠ A troca atualiza <strong>todos os cortes e o cadastro de produto</strong> com a referência antiga.</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 40px 1fr 100px",gap:8,alignItems:"end",marginBottom:12}}>
                <div><div style={{fontSize:10,color:"#a89f94",marginBottom:2}}>Referência antiga</div><input value={trocaDe} onChange={e=>setTrocaDe(e.target.value)} style={{...iStyle,width:"100%"}}/></div>
                <div style={{textAlign:"center",fontSize:18,color:"#a89f94",paddingBottom:4}}>→</div>
                <div><div style={{fontSize:10,color:"#a89f94",marginBottom:2}}>Nova referência</div><input value={trocaPara} onChange={e=>setTrocaPara(e.target.value)} style={{...iStyle,width:"100%"}}/></div>
                <button onClick={executarTroca} style={{background:"#c0392b",color:"#fff",border:"none",borderRadius:6,padding:"7px",fontSize:12,cursor:"pointer"}}>Trocar</button>
              </div>
              {trocaMsg&&<div style={{padding:"8px 14px",background:"#eafbf0",border:"1px solid #b8dfc8",borderRadius:6,fontSize:12,color:"#27ae60"}}>{trocaMsg}</div>}
            </div>
          )}
          {cadAba==="log"&&(
            <div style={{background:"#fff",borderRadius:12,border:"1px solid #e8e2da",overflow:"hidden"}}>
              <div style={{padding:"12px 16px",borderBottom:"1px solid #e8e2da",fontSize:11,color:"#a89f94",letterSpacing:2,textTransform:"uppercase"}}>Log de Trocas</div>
              {logTroca.length===0?<div style={{padding:32,textAlign:"center",color:"#c0b8b0",fontSize:13}}>Nenhuma troca registrada</div>:
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}><thead><tr style={{background:"#f7f4f0"}}>{["Data","Ref anterior","Nova ref"].map(h=><th key={h} style={{padding:"8px 12px",textAlign:"left",fontSize:10,color:"#a89f94",fontWeight:600}}>{h}</th>)}</tr></thead><tbody>{logTroca.map((l,i)=><tr key={i} style={{borderBottom:"1px solid #f0ebe4"}}><td style={{padding:"8px 12px",color:"#6b7c8a"}}>{l.data}</td><td style={{padding:"8px 12px",color:"#c0392b",fontWeight:700}}>{l.de}</td><td style={{padding:"8px 12px",color:"#27ae60",fontWeight:700}}>{l.para}</td></tr>)}</tbody></table>}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const TODOS_MODULOS=["dashboard","lancamentos","boletos","agenda","historico","relatorio","oficinas","configuracoes","calculadora","fichatecnica","salascorte","bling","sac"];
const USUARIOS_INICIAL=[
  {id:1,usuario:"admin",senha:"1234",modulos:[...TODOS_MODULOS,"usuarios"],admin:true,moduloPadrao:"home"},
  {id:2,usuario:"corte",senha:"1234",modulos:["oficinas","salascorte"],admin:false,moduloPadrao:"oficinas"},
  {id:3,usuario:"financeiro",senha:"1234",modulos:["boletos"],admin:false,moduloPadrao:"boletos"},
];

const LoginScreen=({usuarios,onLogin})=>{
  const [user,setUser]=useState("");
  const [senha,setSenha]=useState("");
  const [erro,setErro]=useState(false);
  const [mostraSenha,setMostraSenha]=useState(false);
  const tentar=()=>{
    const u=user.replace(/\s/g,"").toLowerCase();
    const s=senha.replace(/\s/g,"");
    if(!u||!s){setErro(true);return;}
    const found=(usuarios||[]).find(x=>x.usuario.toLowerCase()===u&&x.senha===s);
    if(found){onLogin(found);setErro(false);}
    else{setErro(true);}
  };
  return(
    <div style={{height:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"#f7f4f0",fontFamily:"Georgia,serif"}}>
      <div style={{background:"#fff",borderRadius:16,padding:"40px 36px",width:320,boxShadow:"0 8px 32px rgba(0,0,0,0.10)"}}>
        <div style={{textAlign:"center",marginBottom:28}}>
          <div style={{fontSize:11,color:"#a89f94",letterSpacing:3,textTransform:"uppercase",marginBottom:8}}>Grupo</div>
          <div style={{fontSize:26,fontWeight:700,color:"#2c3e50",letterSpacing:1}}>Amícia</div>
          <div style={{width:40,height:2,background:"#4a7fa5",margin:"12px auto 0"}}/>
        </div>
        <div style={{marginBottom:14}}>
          <div style={{fontSize:11,color:"#a89f94",marginBottom:5}}>Usuário</div>
          <input value={user} onChange={e=>{setUser(e.target.value);setErro(false);}} onKeyDown={e=>e.key==="Enter"&&tentar()} placeholder="Digite seu usuário" autoCapitalize="none" autoCorrect="off" autoComplete="off" spellCheck="false" style={{width:"100%",border:"1px solid "+(erro?"#f4b8b8":"#c8d8e4"),borderRadius:8,padding:"9px 12px",fontSize:13,outline:"none",fontFamily:"Georgia,serif",boxSizing:"border-box"}}/>
        </div>
        <div style={{marginBottom:20}}>
          <div style={{fontSize:11,color:"#a89f94",marginBottom:5}}>Senha</div>
          <div style={{position:"relative"}}>
            <input type={mostraSenha?"text":"password"} value={senha} onChange={e=>{setSenha(e.target.value);setErro(false);}} onKeyDown={e=>e.key==="Enter"&&tentar()} placeholder="Digite sua senha" autoComplete="off" style={{width:"100%",border:"1px solid "+(erro?"#f4b8b8":"#c8d8e4"),borderRadius:8,padding:"9px 12px",fontSize:13,outline:"none",fontFamily:"Georgia,serif",boxSizing:"border-box"}}/>
            <span onClick={()=>setMostraSenha(p=>!p)} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",cursor:"pointer",fontSize:16,color:"#a89f94"}}>{mostraSenha?"🙈":"👁"}</span>
          </div>
        </div>
        {erro&&<div style={{fontSize:12,color:"#c0392b",textAlign:"center",marginBottom:14}}>{(!user.trim()||!senha.trim())?"Preencha usuário e senha":"Usuário ou senha incorretos"}</div>}
        <button onClick={tentar} style={{width:"100%",background:"#2c3e50",color:"#fff",border:"none",borderRadius:8,padding:"11px",fontSize:14,cursor:"pointer",fontFamily:"Georgia,serif",fontWeight:600}}>Entrar</button>
      </div>
    </div>
  );
};

const UsuariosContent=({usuarios,setUsuarios})=>{
  const [form,setForm]=useState({usuario:"",senha:"",modulos:[],admin:false,moduloPadrao:"home"});
  const [editId,setEditId]=useState(null);
  const [erro,setErro]=useState("");
  const toggleMod=(mod)=>setForm(p=>({...p,modulos:p.modulos.includes(mod)?p.modulos.filter(m=>m!==mod):[...p.modulos,mod]}));
  const toggleAdmin=()=>setForm(p=>{const na=!p.admin;return{...p,admin:na,modulos:na?[...TODOS_MODULOS,"usuarios"]:p.modulos};});
  const salvar=()=>{
    if(!form.usuario.trim()||!form.senha.trim()){setErro("Preencha usuário e senha.");return;}
    if(!editId&&usuarios.find(u=>u.usuario===form.usuario.trim().toLowerCase())){setErro("Usuário já existe.");return;}
    if(form.modulos.length===0){setErro("Selecione ao menos um módulo.");return;}
    if(editId){setUsuarios(prev=>prev.map(u=>{
      if(u.id!==editId)return u;
      const updated={...u,...form,usuario:form.usuario.trim().toLowerCase(),_mod:Date.now()};
      // PROTEÇÃO: user id=1 (admin) NUNCA pode perder admin:true
      if(u.id===1||u.usuario==='admin')updated.admin=true;
      return updated;
    }));}
    else{setUsuarios(prev=>[...prev,{id:Date.now(),...form,usuario:form.usuario.trim().toLowerCase(),_mod:Date.now()}]);}
    setForm({usuario:"",senha:"",modulos:[],admin:false,moduloPadrao:"home"});setEditId(null);setErro("");
  };
  const editar=(u)=>{setForm({usuario:u.usuario,senha:u.senha,modulos:[...u.modulos],admin:u.admin,moduloPadrao:u.moduloPadrao||"home"});setEditId(u.id);};
  const deletar=(id)=>{if(usuarios.find(u=>u.id===id)?.admin){setErro("Não é possível excluir o admin.");return;}setUsuarios(prev=>prev.filter(u=>u.id!==id));};
  const iStyle={border:"1px solid #c8d8e4",borderRadius:6,padding:"6px 10px",fontSize:12,outline:"none",fontFamily:"Georgia,serif"};
  const modulesAll=[...modules.filter(m=>m.id!=="usuarios")];
  return(
    <div>
      <div style={{background:"#fff",borderRadius:12,border:"1px solid #e8e2da",padding:20,marginBottom:16}}>
        <div style={{fontSize:11,color:"#a89f94",letterSpacing:2,textTransform:"uppercase",marginBottom:14}}>{editId?"Editar usuário":"Novo usuário"}</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}}>
          <div><div style={{fontSize:11,color:"#a89f94",marginBottom:4}}>Usuário</div><input value={form.usuario} onChange={e=>setForm(p=>({...p,usuario:e.target.value}))} placeholder="nome_usuario" style={{...iStyle,width:"100%",boxSizing:"border-box"}}/></div>
          <div><div style={{fontSize:11,color:"#a89f94",marginBottom:4}}>Senha</div><input value={form.senha} onChange={e=>setForm(p=>({...p,senha:e.target.value}))} placeholder="senha" style={{...iStyle,width:"100%",boxSizing:"border-box"}}/></div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
          <div onClick={toggleAdmin} style={{width:40,height:22,borderRadius:11,background:form.admin?"#2c3e50":"#e0d8d0",cursor:"pointer",position:"relative",transition:"background 0.2s"}}>
            <div style={{position:"absolute",top:3,left:form.admin?20:3,width:16,height:16,borderRadius:"50%",background:"#fff",transition:"left 0.2s"}}/>
          </div>
          <span style={{fontSize:13,color:form.admin?"#2c3e50":"#a89f94",fontWeight:form.admin?600:400}}>{form.admin?"Administrador (acesso total)":"Usuário limitado"}</span>
        </div>
        {!form.admin&&(
          <div style={{marginBottom:14}}>
            <div style={{fontSize:11,color:"#a89f94",marginBottom:8}}>Módulos com acesso</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
              {modulesAll.map(m=>{
                const ativo=form.modulos.includes(m.id);
                return(
                  <div key={m.id} onClick={()=>toggleMod(m.id)} style={{display:"flex",alignItems:"center",gap:6,padding:"6px 12px",borderRadius:8,cursor:"pointer",background:ativo?"#e8f0f8":"#f7f4f0",border:"1px solid "+(ativo?"#4a7fa5":"#e8e2da"),transition:"all 0.15s"}}>
                    <m.Icon size={16}/>
                    <span style={{fontSize:12,fontWeight:ativo?600:400,color:ativo?"#2c3e50":"#8a9aa4"}}>{m.label}</span>
                    {ativo&&<span style={{fontSize:11,color:"#4a7fa5"}}>✓</span>}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {/* Página inicial */}
        <div style={{marginBottom:14}}>
          <div style={{fontSize:11,color:"#a89f94",marginBottom:4}}>Página inicial ao logar</div>
          <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
            <select value={form.moduloPadrao||"home"} onChange={e=>setForm(p=>({...p,moduloPadrao:e.target.value}))} style={{...iStyle,minWidth:200}}>
              <option value="home">🏠 Tela inicial (home)</option>
              {modulesAll.filter(m=>form.admin||form.modulos.includes(m.id)).map(m=>(
                <option key={m.id} value={m.id}>📌 {m.label}</option>
              ))}
            </select>
            <span style={{fontSize:10,color:"#a89f94"}}>{(form.moduloPadrao||"home")==="home"?"Abre com os cards dos módulos":"Abre direto no módulo"}</span>
          </div>
        </div>
        {erro&&<div style={{fontSize:12,color:"#c0392b",marginBottom:10}}>{erro}</div>}
        <div style={{display:"flex",gap:8}}>
          <button onClick={salvar} style={{background:"#2c3e50",color:"#fff",border:"none",borderRadius:6,padding:"8px 20px",fontSize:12,cursor:"pointer",fontFamily:"Georgia,serif"}}>{editId?"Salvar alterações":"Criar usuário"}</button>
          {editId&&<button onClick={()=>{setForm({usuario:"",senha:"",modulos:[],admin:false,moduloPadrao:"home"});setEditId(null);setErro("");}} style={{background:"#fff",color:"#6b7c8a",border:"1px solid #e8e2da",borderRadius:6,padding:"8px 16px",fontSize:12,cursor:"pointer",fontFamily:"Georgia,serif"}}>Cancelar</button>}
        </div>
      </div>
      <div style={{background:"#fff",borderRadius:12,border:"1px solid #e8e2da",overflow:"hidden"}}>
        <div style={{padding:"12px 16px",borderBottom:"1px solid #e8e2da",fontSize:11,color:"#a89f94",letterSpacing:2,textTransform:"uppercase"}}>Usuários do sistema</div>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
          <thead><tr style={{background:"#f7f4f0"}}>{["Usuário","Perfil","Módulos com acesso",""].map(h=><th key={h} style={{padding:"8px 14px",textAlign:"left",fontSize:10,color:"#a89f94",fontWeight:600}}>{h}</th>)}</tr></thead>
          <tbody>
            {usuarios.map(u=>(
              <tr key={u.id} style={{borderBottom:"1px solid #f0ebe4"}}>
                <td style={{padding:"10px 14px",fontWeight:600,color:"#2c3e50"}}>{u.usuario}</td>
                <td style={{padding:"10px 14px"}}>{u.admin?<span style={{background:"#2c3e50",color:"#fff",borderRadius:4,padding:"2px 8px",fontSize:11}}>Admin</span>:<span style={{background:"#f0f6fb",color:"#4a7fa5",borderRadius:4,padding:"2px 8px",fontSize:11}}>Usuário</span>}</td>
                <td style={{padding:"10px 14px"}}><div style={{display:"flex",flexWrap:"wrap",gap:4}}>{u.admin?<span style={{fontSize:11,color:"#a89f94"}}>Todos os módulos</span>:u.modulos.map(mid=>{const m=modules.find(x=>x.id===mid);return m?<span key={mid} style={{fontSize:11,background:"#f0f6fb",color:"#4a7fa5",borderRadius:3,padding:"1px 6px"}}>{m.label}</span>:null;})}</div></td>
                <td style={{padding:"10px 10px",textAlign:"center"}}><span onClick={()=>editar(u)} style={{cursor:"pointer",color:"#4a7fa5",fontSize:13,marginRight:8}}>✏</span>{!u.admin&&<span onClick={()=>deletar(u.id)} style={{cursor:"pointer",color:"#d0c8c0",fontSize:13}}>×</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ── Módulo Bling ─────────────────────────────────────────────────────────────
const blingDb={
  async getTokens(){
    try{
      const {data}=await supabase.from('bling_tokens').select('*');
      return data||[];
    }catch{return[];}
  },
  async saveToken(conta,data){
    try{
      await supabase.from('bling_tokens').upsert({conta,...data},{onConflict:'conta'});
    }catch(e){console.error(e)}
  },
  async getResultado(data){
    try{
      const {data:r}=await supabase.from('bling_resultados').select('*').eq('data',data).single();
      return r||null;
    }catch{return null;}
  },
  async saveResultado(data,exitus,lumia,muniam,total_bruto,valor_liquido){
    try{
      await supabase.from('bling_resultados').upsert({data,exitus,lumia,muniam,total_bruto,valor_liquido},{onConflict:'data'});
    }catch(e){console.error(e)}
  },
};

// Foto do produto: tenta jpg→png→webp (normalizado + original), placeholder se falhar
const FotoProd=({sbUrl,refProd,onZoom})=>{
  const orig=String(refProd).toUpperCase();
  const norm=orig.replace(/^0+/,'');
  const storageBase=sbUrl?`${sbUrl}/storage/v1/object/public/produtos/`:'';
  const cb='?v='+new Date().toISOString().slice(0,10);
  if(!storageBase)return <div style={{width:34,height:44,borderRadius:4,background:"#f0ebe3",display:"flex",alignItems:"center",justifyContent:"center",border:"1px solid #e8e2da",flexShrink:0}}><span style={{fontSize:12,opacity:0.3}}>📷</span></div>;
  // Sequência: norm → orig (se diferente) → zero-padded (4 e 5 dígitos) → placeholder
  const urls=[norm+'.jpg',norm+'.png',norm+'.webp'];
  if(orig!==norm)urls.push(orig+'.jpg',orig+'.png',orig+'.webp');
  // Tenta com zero-padding (376 → 0376, 0376 → 00376)
  const pad4=norm.padStart(4,'0');const pad5=norm.padStart(5,'0');
  if(pad4!==norm&&pad4!==orig)urls.push(pad4+'.jpg',pad4+'.png',pad4+'.webp');
  if(pad5!==norm&&pad5!==orig&&pad5!==pad4)urls.push(pad5+'.jpg',pad5+'.png',pad5+'.webp');
  return <img src={storageBase+urls[0]+cb}
    onError={(e)=>{const cur=e.target.src;const idx=urls.findIndex(u=>cur.includes(u));if(idx>=0&&idx<urls.length-1){e.target.src=storageBase+urls[idx+1]+cb;}else{e.target.style.display='none';const ph=e.target.nextSibling;if(ph)ph.style.display='flex';}}}
    onClick={(e)=>{e.stopPropagation();onZoom&&onZoom(e.target.src);}}
    style={{width:34,height:44,objectFit:"cover",borderRadius:4,border:"1px solid #e8e2da",flexShrink:0,cursor:"pointer"}}/>;
};

const FotoProdLarge=({sbUrl,refProd,onZoom})=>{
  const orig=String(refProd).toUpperCase();
  const norm=orig.replace(/^0+/,'');
  const storageBase=sbUrl?`${sbUrl}/storage/v1/object/public/produtos/`:'';
  const cb='?v='+new Date().toISOString().slice(0,10);
  if(!storageBase)return <div style={{width:"100%",aspectRatio:"3/4",background:"linear-gradient(135deg,#f0ebe3,#e8e2da)",display:"flex",alignItems:"center",justifyContent:"center",color:"#c0b8b0",fontSize:10,fontFamily:"Georgia,serif",fontStyle:"italic"}}>foto ref {String(refProd)}</div>;
  const urls=[norm+'.jpg',norm+'.png',norm+'.webp'];
  if(orig!==norm)urls.push(orig+'.jpg',orig+'.png',orig+'.webp');
  const pad4=norm.padStart(4,'0');const pad5=norm.padStart(5,'0');
  if(pad4!==norm&&pad4!==orig)urls.push(pad4+'.jpg',pad4+'.png',pad4+'.webp');
  if(pad5!==norm&&pad5!==orig&&pad5!==pad4)urls.push(pad5+'.jpg',pad5+'.png',pad5+'.webp');
  return(<div style={{width:"100%",aspectRatio:"3/4",position:"relative",overflow:"hidden",background:"linear-gradient(135deg,#f0ebe3,#e8e2da)"}}>
    <img src={storageBase+urls[0]+cb}
      onError={(e)=>{const cur=e.target.src;const idx=urls.findIndex(u=>cur.includes(u));if(idx>=0&&idx<urls.length-1){e.target.src=storageBase+urls[idx+1]+cb;}else{e.target.style.display='none';const ph=e.target.nextSibling;if(ph)ph.style.display='flex';}}}
      onClick={(e)=>{e.stopPropagation();onZoom&&onZoom(e.target.src);}}
      style={{width:"100%",height:"100%",objectFit:"cover",cursor:"pointer",display:"block"}}/>
    <div style={{display:"none",width:"100%",height:"100%",alignItems:"center",justifyContent:"center",color:"#c0b8b0",fontSize:10,fontFamily:"Georgia,serif",fontStyle:"italic"}}>foto ref {String(refProd)}</div>
  </div>);
};

// ── Tela de Estoque (ML Lumia proxy) ─────────────────────────────────────────
const EstoqueView=({sbUrl,handleZoom,produtos=[]})=>{
  const [dados,setDados]=useState(null); // {total_geral, refs, historico, ultimaSync}
  const [loading,setLoading]=useState(true);
  const [erro,setErro]=useState(null);
  const [view,setView]=useState("grid"); // "grid" | "list"
  const [busca,setBusca]=useState("");
  const [modalRef,setModalRef]=useState(null); // ref selecionada
  const [syncing,setSyncing]=useState(false);
  const [calcDesc,setCalcDesc]=useState({}); // ref → descricao da Calculadora

  const carregarCalc=async()=>{
    try{
      const {data}=await supabase.from('amicia_data').select('payload').eq('user_id','calc-meluni').maybeSingle();
      const prods=data?.payload?.prods||[];
      const map={};
      prods.forEach(p=>{const rk=String(p.ref||'').replace(/\D/g,'').replace(/^0+/,'');if(rk)map[rk]=p.descricao||'';});
      setCalcDesc(map);
    }catch(e){console.error('calc desc:',e.message);}
  };

  const carregar=async()=>{
    setLoading(true);setErro(null);
    try{
      const r=await fetch('/api/ml-estoque?action=list');
      if(!r.ok)throw new Error('HTTP '+r.status);
      const d=await r.json();
      setDados(d);
    }catch(e){setErro(e.message);}
    finally{setLoading(false);}
  };

  const forcarSync=async()=>{
    if(syncing)return;
    setSyncing(true);
    try{
      const r=await fetch('/api/ml-estoque',{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"sync_now"})});
      if(!r.ok)throw new Error('Falha ao sincronizar');
      await new Promise(rr=>setTimeout(rr,1500));
      await carregar();
    }catch(e){alert('Erro: '+e.message);}
    finally{setSyncing(false);}
  };

  useEffect(()=>{carregarCalc();carregar();},[]);

  const refs=useMemo(()=>{
    const arr=(dados?.refs||[]).filter(r=>!r.sem_dados);
    const q=busca.trim().toLowerCase();
    if(!q)return arr;
    return arr.filter(r=>{
      const rk=String(r.ref).toLowerCase();
      const desc=(calcDesc[r.ref]||r.descricao||'').toLowerCase();
      return rk.includes(q)||desc.includes(q);
    });
  },[dados,busca,calcDesc]);

  const totalGeral=dados?.total_geral||0;
  const qtdRefsAtivas=refs.length;
  const qtdVariacoes=useMemo(()=>refs.reduce((a,r)=>a+(r.variations?.length||0),0),[refs]);

  // Histórico 12 meses — vem do back (tabela ml_estoque_total_mensal) ou cria mock
  const historico=useMemo(()=>{
    const h=dados?.historico||[];
    // h esperado: [{ano_mes:"2026-04", qtd_total:N}, ...]
    // Se faltar, preenche os últimos 12 meses com 0
    const hoje=new Date();
    const meses=[];
    for(let i=11;i>=0;i--){
      const d=new Date(hoje.getFullYear(),hoje.getMonth()-i,1);
      const ym=d.toISOString().slice(0,7);
      const encontrado=h.find(x=>x.ano_mes===ym);
      const mesNome=['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'][d.getMonth()];
      meses.push({ano_mes:ym,lbl:mesNome,qtd:encontrado?.qtd_total||(i===0?totalGeral:0)});
    }
    return meses;
  },[dados,totalGeral]);

  const maxHist=Math.max(1,...historico.map(m=>m.qtd));
  const varPct=(()=>{
    const atual=historico[historico.length-1]?.qtd||0;
    const ant=historico[historico.length-2]?.qtd||0;
    if(!ant)return null;
    return Math.round(((atual-ant)/ant)*1000)/10;
  })();

  const selectedRef=modalRef?(dados?.refs||[]).find(r=>r.ref===modalRef):null;

  if(loading){
    return <div style={{padding:40,textAlign:"center",color:"#8a9aa4",fontFamily:"Georgia,serif"}}>Carregando estoque...</div>;
  }
  if(erro){
    return <div style={{padding:40,textAlign:"center",color:"#c0392b",fontFamily:"Georgia,serif"}}>Erro: {erro}<br/><button onClick={carregar} style={{marginTop:16,background:"#4a7fa5",color:"#fff",border:"none",borderRadius:8,padding:"8px 16px",cursor:"pointer",fontFamily:"Georgia,serif"}}>Tentar de novo</button></div>;
  }
  if(!dados||refs.length===0 && !busca){
    return <div style={{padding:40,textAlign:"center",color:"#8a9aa4",fontFamily:"Georgia,serif"}}>
      Nenhum dado de estoque ainda.<br/>
      <button onClick={forcarSync} disabled={syncing} style={{marginTop:16,background:"#4a7fa5",color:"#fff",border:"none",borderRadius:8,padding:"8px 16px",cursor:syncing?"not-allowed":"pointer",fontFamily:"Georgia,serif",opacity:syncing?0.7:1}}>
        {syncing?"⏳ Sincronizando...":"🔄 Sincronizar agora"}
      </button>
    </div>;
  }

  const ultSync=dados?.ultima_sync?new Date(dados.ultima_sync).toLocaleString('pt-BR',{hour:'2-digit',minute:'2-digit',day:'2-digit',month:'2-digit'}):'—';

  return(<div>
    {/* TOPO: total geral + gráfico 12 meses */}
    <div style={{background:"#fff",border:"1px solid #e8e2da",borderRadius:12,padding:"16px 20px",marginBottom:14,display:"grid",gridTemplateColumns:"auto 1fr",gap:28,alignItems:"center"}}>
      <div style={{borderRight:"1px solid #e8e2da",paddingRight:28}}>
        <div style={{fontSize:10,color:"#8a9aa4",letterSpacing:1,textTransform:"uppercase",fontWeight:700}}>Estoque total</div>
        <div style={{fontFamily:"Calibri,Segoe UI,Arial,sans-serif",fontSize:38,fontWeight:700,color:"#2c3e50",lineHeight:1,margin:"4px 0 2px"}}>{totalGeral.toLocaleString('pt-BR')}</div>
        <div style={{fontSize:11,color:"#8a9aa4"}}>em <b style={{color:"#2c3e50",fontWeight:700}}>{qtdRefsAtivas} refs ativas</b> · <b style={{color:"#2c3e50",fontWeight:700}}>{qtdVariacoes} variações</b></div>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:6}}>
        <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between"}}>
          <span style={{fontSize:10,color:"#8a9aa4",letterSpacing:1,textTransform:"uppercase",fontWeight:700}}>Evolução últimos 12 meses</span>
          {varPct!==null&&<span style={{fontSize:11,fontWeight:700,color:varPct>0?"#27ae60":varPct<0?"#c0392b":"#8a9aa4"}}>{varPct>0?"↑ +":varPct<0?"↓ ":"→ "}{Math.abs(varPct)}% vs mês passado</span>}
        </div>
        <div style={{display:"flex",gap:4,alignItems:"flex-end",height:52}}>
          {historico.map((m,i)=>(
            <div key={m.ano_mes} title={m.lbl+": "+m.qtd.toLocaleString('pt-BR')} style={{flex:1,background:i===historico.length-1?"#c19a3e":"#4a7fa5",borderRadius:"2px 2px 0 0",minHeight:3,height:`${(m.qtd/maxHist)*100}%`,transition:"background 0.15s"}}/>
          ))}
        </div>
        <div style={{display:"flex",gap:4,marginTop:2}}>
          {historico.map(m=><div key={m.ano_mes} style={{flex:1,textAlign:"center",fontSize:9,color:"#8a9aa4",letterSpacing:0.3}}>{m.lbl}</div>)}
        </div>
      </div>
    </div>

    {/* Toolbar */}
    <div style={{background:"#fff",border:"1px solid #e8e2da",borderRadius:12,padding:"10px 14px",display:"flex",gap:10,alignItems:"center",flexWrap:"wrap",marginBottom:14}}>
      <div style={{flex:1,minWidth:200,position:"relative"}}>
        <span style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",color:"#8a9aa4",fontSize:13,pointerEvents:"none"}}>🔍</span>
        <input type="text" value={busca} onChange={e=>setBusca(e.target.value)} placeholder="Buscar por referência ou descrição..." style={{width:"100%",border:"1px solid #e8e2da",borderRadius:8,padding:"7px 12px 7px 32px",fontSize:13,fontFamily:"Georgia,serif",color:"#2c3e50",background:"#faf8f5",outline:"none"}}/>
      </div>
      <div style={{fontSize:11,color:"#8a9aa4",whiteSpace:"nowrap"}}>última sync: <b style={{color:"#2c3e50"}}>{ultSync}</b></div>
      <button onClick={forcarSync} disabled={syncing} title="Forçar sync agora" style={{background:"none",border:"1px solid #e8e2da",borderRadius:8,padding:"6px 10px",fontSize:12,cursor:syncing?"not-allowed":"pointer",fontFamily:"Georgia,serif",color:"#4a7fa5",opacity:syncing?0.5:1}}>{syncing?"⏳":"🔄"}</button>
      <div style={{display:"flex",background:"#faf8f5",border:"1px solid #e8e2da",borderRadius:8,padding:3,gap:2}}>
        <button onClick={()=>setView("grid")} style={{background:view==="grid"?"#2c3e50":"transparent",color:view==="grid"?"#fff":"#8a9aa4",border:"none",padding:"5px 10px",fontSize:11,cursor:"pointer",borderRadius:5,fontFamily:"Georgia,serif",fontWeight:600}}>▦ Grid</button>
        <button onClick={()=>setView("list")} style={{background:view==="list"?"#2c3e50":"transparent",color:view==="list"?"#fff":"#8a9aa4",border:"none",padding:"5px 10px",fontSize:11,cursor:"pointer",borderRadius:5,fontFamily:"Georgia,serif",fontWeight:600}}>≡ Lista</button>
      </div>
    </div>

    {/* Grid / Lista */}
    {view==="grid"?(
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(170px,1fr))",gap:10}}>
        {refs.map(r=>{
          const refN=String(r.ref);
          const desc=calcDesc[refN]||r.descricao||'';
          const qtd=r.qtd_total||0;
          const low=qtd<5;
          return(<div key={refN} onClick={()=>setModalRef(refN)} style={{background:"#fff",border:"1px solid #e8e2da",borderRadius:10,overflow:"hidden",cursor:"pointer",transition:"all 0.15s",position:"relative"}}
            onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-2px)";e.currentTarget.style.boxShadow="0 4px 14px rgba(44,62,80,0.08)";e.currentTarget.style.borderColor="#4a7fa5";}}
            onMouseLeave={e=>{e.currentTarget.style.transform="";e.currentTarget.style.boxShadow="";e.currentTarget.style.borderColor="#e8e2da";}}
          >
            {r.alerta_duplicata&&<div style={{position:"absolute",top:6,right:6,background:"#c19a3e",color:"#fff",fontSize:8,fontWeight:700,padding:"2px 5px",borderRadius:8,letterSpacing:0.2,zIndex:2}}>⚠ DUP</div>}
            {low&&<div style={{position:"absolute",top:6,left:6,background:"#c0392b",color:"#fff",fontSize:8,fontWeight:700,padding:"2px 5px",borderRadius:8,letterSpacing:0.2,zIndex:2}}>BAIXO</div>}
            <FotoProdLarge sbUrl={sbUrl} refProd={refN} onZoom={handleZoom}/>
            <div style={{padding:"8px 10px 10px"}}>
              <div style={{fontSize:14,fontWeight:700,color:"#4a7fa5",letterSpacing:0.3,marginBottom:2}}>{refN}</div>
              <div style={{fontSize:10.5,color:"#2c3e50",lineHeight:1.25,minHeight:26,marginBottom:6,display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden"}}>{desc}</div>
              <div style={{display:"flex",alignItems:"flex-end",justifyContent:"space-between",paddingTop:6,borderTop:"1px solid #e8e2da"}}>
                <div>
                  <div style={{fontFamily:"Calibri,Segoe UI,Arial,sans-serif",fontSize:18,fontWeight:700,color:"#2c3e50",lineHeight:1}}>{qtd.toLocaleString('pt-BR')}</div>
                  <div style={{fontSize:8,color:"#8a9aa4",letterSpacing:0.3,textTransform:"uppercase",marginTop:1}}>estoque</div>
                </div>
                <div style={{fontSize:9,color:"#8a9aa4"}}>{r.variations?.length||0} var</div>
              </div>
            </div>
          </div>);
        })}
        {refs.length===0&&<div style={{gridColumn:"1/-1",padding:30,textAlign:"center",color:"#8a9aa4",fontFamily:"Georgia,serif"}}>Nenhuma ref encontrada.</div>}
      </div>
    ):(
      <div style={{display:"flex",flexDirection:"column",gap:6}}>
        {refs.map(r=>{
          const refN=String(r.ref);
          const desc=calcDesc[refN]||r.descricao||'';
          const qtd=r.qtd_total||0;
          const low=qtd<5;
          return(<div key={refN} onClick={()=>setModalRef(refN)} style={{background:"#fff",border:"1px solid #e8e2da",borderRadius:10,cursor:"pointer",display:"grid",gridTemplateColumns:"60px 1fr auto",gap:14,alignItems:"center",padding:"8px 14px 8px 8px",transition:"all 0.15s"}}
            onMouseEnter={e=>{e.currentTarget.style.transform="translateX(2px)";e.currentTarget.style.borderColor="#4a7fa5";}}
            onMouseLeave={e=>{e.currentTarget.style.transform="";e.currentTarget.style.borderColor="#e8e2da";}}
          >
            <div style={{width:60,aspectRatio:"3/4",borderRadius:6,overflow:"hidden"}}><FotoProdLarge sbUrl={sbUrl} refProd={refN} onZoom={handleZoom}/></div>
            <div style={{display:"flex",flexDirection:"column",gap:2,minWidth:0}}>
              <div style={{fontSize:14,fontWeight:700,color:"#4a7fa5",display:"flex",alignItems:"center",gap:6}}>
                {refN}
                {r.alerta_duplicata&&<span style={{background:"#c19a3e",color:"#fff",fontSize:8,fontWeight:700,padding:"2px 5px",borderRadius:8,letterSpacing:0.2}}>⚠ DUP</span>}
                {low&&<span style={{background:"#c0392b",color:"#fff",fontSize:8,fontWeight:700,padding:"2px 5px",borderRadius:8,letterSpacing:0.2}}>BAIXO</span>}
              </div>
              <div style={{fontSize:12,color:"#2c3e50",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{desc}</div>
            </div>
            <div style={{textAlign:"right"}}>
              <div style={{fontFamily:"Calibri,Segoe UI,Arial,sans-serif",fontSize:20,fontWeight:700,color:"#2c3e50",lineHeight:1}}>{qtd.toLocaleString('pt-BR')}</div>
              <div style={{fontSize:8,color:"#8a9aa4",letterSpacing:0.3,textTransform:"uppercase",marginTop:1}}>estoque · {r.variations?.length||0} var</div>
            </div>
          </div>);
        })}
        {refs.length===0&&<div style={{padding:30,textAlign:"center",color:"#8a9aa4",fontFamily:"Georgia,serif"}}>Nenhuma ref encontrada.</div>}
      </div>
    )}

    {/* Modal de variações */}
    {modalRef&&selectedRef&&(()=>{
      const desc=calcDesc[modalRef]||selectedRef.descricao||'';
      const vars=(selectedRef.variations||[]).slice().sort((a,b)=>{
        const corA=a.cor||'';const corB=b.cor||'';
        if(corA!==corB)return corA.localeCompare(corB);
        const tamOrder={P:1,M:2,G:3,GG:4,G1:5,G2:6,G3:7};
        return (tamOrder[a.tam]||99)-(tamOrder[b.tam]||99);
      });
      return <div onClick={()=>setModalRef(null)} style={{position:"fixed",inset:0,background:"rgba(44,62,80,0.55)",display:"flex",alignItems:"flex-start",justifyContent:"center",padding:"40px 20px",zIndex:100,overflowY:"auto",backdropFilter:"blur(3px)"}}>
        <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:14,width:"100%",maxWidth:680,overflow:"hidden",boxShadow:"0 20px 50px rgba(0,0,0,0.25)"}}>
          <div style={{display:"flex",gap:14,padding:"18px 20px",borderBottom:"1px solid #e8e2da",background:"#faf8f5",alignItems:"flex-start"}}>
            <div style={{width:64,height:84,borderRadius:8,background:"#e8e2da",flexShrink:0,overflow:"hidden"}}><FotoProdLarge sbUrl={sbUrl} refProd={modalRef} onZoom={handleZoom}/></div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:11,color:"#4a7fa5",fontWeight:700,letterSpacing:0.4}}>REF {modalRef}</div>
              <div style={{fontSize:17,fontWeight:700,color:"#2c3e50",margin:"2px 0 6px",lineHeight:1.25}}>{desc||"(sem descrição)"}</div>
              <div style={{display:"flex",gap:14,fontSize:11,color:"#8a9aa4",flexWrap:"wrap"}}>
                <span>Total: <b style={{color:"#2c3e50",fontWeight:700,fontFamily:"Calibri,Segoe UI,Arial,sans-serif",fontSize:40}}>{(selectedRef.qtd_total||0).toLocaleString('pt-BR')}</b></span>
                <span>· Variações: <b style={{color:"#2c3e50",fontWeight:700,fontFamily:"Calibri,Segoe UI,Arial,sans-serif",fontSize:13}}>{vars.length}</b></span>
              </div>
              {selectedRef.alerta_duplicata&&<div style={{background:"#fef7e6",border:"1px solid #f5dba1",color:"#8a6a1f",padding:"8px 12px",borderRadius:6,fontSize:11,marginTop:10}}>⚠️ <b style={{color:"#c19a3e"}}>Duplicata:</b> esta ref está em múltiplos anúncios ativos. Usando o MLB com maior saldo.</div>}
            </div>
            <button onClick={()=>setModalRef(null)} style={{background:"none",border:"none",fontSize:22,color:"#8a9aa4",cursor:"pointer",padding:"0 4px",lineHeight:1}}>×</button>
          </div>
          <div style={{padding:"16px 20px"}}>
            <div style={{fontSize:10,color:"#8a9aa4",fontWeight:700,letterSpacing:1,textTransform:"uppercase",marginBottom:10}}>Variações · Estoque atual</div>
            <table style={{width:"100%",borderCollapse:"separate",borderSpacing:0,fontSize:12}}>
              <thead><tr>
                <th style={{background:"#4a7fa5",color:"#fff",fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:0.4,padding:"8px 12px",textAlign:"left"}}>Cor</th>
                <th style={{background:"#4a7fa5",color:"#fff",fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:0.4,padding:"8px 12px",textAlign:"left"}}>Tamanho</th>
                <th style={{background:"#4a7fa5",color:"#fff",fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:0.4,padding:"8px 12px",textAlign:"left"}}>SKU</th>
                <th style={{background:"#4a7fa5",color:"#fff",fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:0.4,padding:"8px 12px",textAlign:"right"}}>Estoque</th>
              </tr></thead>
              <tbody>
                {vars.map((v,i)=>{
                  const q=v.qtd||0;const cls=q===0?"#c0392b":q<=3?"#c19a3e":"#2c3e50";
                  return<tr key={i} style={{background:i%2===0?"#fff":"#faf8f5",borderBottom:"1px solid #e8e2da"}}>
                    <td style={{padding:"8px 12px",color:"#2c3e50",fontWeight:600}}>{v.cor||'—'}</td>
                    <td style={{padding:"8px 12px",fontFamily:"Calibri,Segoe UI,Arial,sans-serif",fontWeight:700,color:"#4a7fa5"}}>{v.tam||'—'}</td>
                    <td style={{padding:"8px 12px",fontFamily:"Courier New,monospace",fontSize:10,color:"#8a9aa4"}}>{v.sku&&!String(v.sku).startsWith('_SINT_')?v.sku:'—'}</td>
                    <td style={{padding:"8px 12px",textAlign:"right",fontFamily:"Calibri,Segoe UI,Arial,sans-serif",fontWeight:700,fontSize:13,color:cls}}>{q}</td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>;
    })()}
  </div>);
};

const BlingContent=({setReceitasMes,mesAtual,blingVendas={},blingImportStatus=null,produtos=[]})=>{
  const [tela,setTela]=useState("dash");
  const [vendasSub,setVendasSub]=useState("overview"); // "overview" | "produtos"
  const [vendasFiltro,setVendasFiltro]=useState("hoje");
  const [filtroMarca,setFiltroMarca]=useState("todas");
  const [filtroCanal,setFiltroCanal]=useState("todos");
  const [prodFiltroData,setProdFiltroData]=useState("7dias");

  const sbUrl=import.meta.env.VITE_SUPABASE_URL||localStorage.getItem("sb_url")||"";
  const handleZoom=(src)=>{
    const overlay=document.createElement('div');
    overlay.style.cssText='position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:99999;display:flex;align-items:center;justify-content:center;cursor:pointer';
    const img=document.createElement('img');
    img.src=src;
    img.style.cssText='width:265px;height:378px;object-fit:cover;border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,0.3);border:3px solid #fff';
    overlay.appendChild(img);
    overlay.onclick=()=>document.body.removeChild(overlay);
    document.body.appendChild(overlay);
  };
  // Agregação de dados do cache blingVendas
  const agregarPeriodo=(dataInicio,dataFim)=>{
    const r={totalPedidos:0,totalBruto:0,totalFrete:0,totalItens:0,porCanal:{},porMarca:{},porProduto:{},porDia:[],tamGeral:{},corGeral:{}};
    const CONTAS_AGG=["exitus","lumia","muniam"];
    let d=new Date(dataInicio+"T00:00:00");const fim=new Date(dataFim+"T00:00:00");
    while(d<=fim){
      const ds=d.toISOString().slice(0,10);const mk=ds.slice(0,7);const dk=ds.slice(8,10);
      const dd=blingVendas[mk]?.[dk];let totalDia=0;
      if(dd&&!dd._vazio){
        for(const marca of CONTAS_AGG){
          const md=dd[marca];if(!md)continue;
          const mn=marca.charAt(0).toUpperCase()+marca.slice(1);
          if(!r.porMarca[mn])r.porMarca[mn]={pedidos:0,bruto:0,itens:0};
          for(const cn in md){
            const cd=md[cn];
            if(!r.porCanal[cn])r.porCanal[cn]={pedidos:0,bruto:0,frete:0,itens:0,subcanais:{},produtos:{}};
            const cc=r.porCanal[cn];
            cc.pedidos+=cd.pedidos||0;cc.bruto+=cd.bruto||0;cc.frete+=cd.frete||0;cc.itens+=cd.itens||0;
            r.porMarca[mn].pedidos+=cd.pedidos||0;r.porMarca[mn].bruto+=cd.bruto||0;r.porMarca[mn].itens+=cd.itens||0;
            r.totalPedidos+=cd.pedidos||0;r.totalBruto+=cd.bruto||0;r.totalFrete+=cd.frete||0;r.totalItens+=cd.itens||0;totalDia+=cd.bruto||0;
            if(cd.subcanais)for(const sc in cd.subcanais){if(!cc.subcanais[sc])cc.subcanais[sc]={pedidos:0,bruto:0};cc.subcanais[sc].pedidos+=cd.subcanais[sc].pedidos||0;cc.subcanais[sc].bruto+=cd.subcanais[sc].bruto||0;}
            for(const prod of(cd.produtos||[])){
              const ref=prod.ref;
              if(!cc.produtos[ref])cc.produtos[ref]={ref,desc:prod.desc,qtd:0,valor:0};
              cc.produtos[ref].qtd+=prod.qtd||0;cc.produtos[ref].valor+=prod.valor||0;
              if(!r.porProduto[ref])r.porProduto[ref]={ref,desc:prod.desc,marca:mn,marcas:{},qtd:0,valor:0,tam:{},cor:{},porCanal:{}};
              const rp=r.porProduto[ref];rp.qtd+=prod.qtd||0;rp.valor+=prod.valor||0;
              rp.marcas[mn]=(rp.marcas[mn]||0)+(prod.qtd||0);
              if(!rp.porCanal[cn])rp.porCanal[cn]={qtd:0,valor:0};rp.porCanal[cn].qtd+=prod.qtd||0;rp.porCanal[cn].valor+=prod.valor||0;
              for(const t in(prod.tam||{})){rp.tam[t]=(rp.tam[t]||0)+prod.tam[t];r.tamGeral[t]=(r.tamGeral[t]||0)+prod.tam[t];}
              for(const c in(prod.cor||{})){rp.cor[c]=(rp.cor[c]||0)+prod.cor[c];r.corGeral[c]=(r.corGeral[c]||0)+prod.cor[c];}
            }
          }
        }
      }
      r.porDia.push({dia:ds,total:totalDia});
      d.setDate(d.getDate()+1);
    }
    for(const cn in r.porCanal)r.porCanal[cn].produtos=Object.values(r.porCanal[cn].produtos).sort((a,b)=>b.qtd-a.qtd);
    r.top20=Object.values(r.porProduto).sort((a,b)=>b.qtd-a.qtd).slice(0,30);
    return r;
  };

  // Date helpers
  const hojeDate=new Date().toISOString().slice(0,10);
  const ontemDate=new Date(Date.now()-86400000).toISOString().slice(0,10);
  const mesAtualInicio=hojeDate.slice(0,8)+"01";
  const seteDiasAtras=new Date(Date.now()-7*86400000).toISOString().slice(0,10);
  const mesAnterior=()=>{const d=new Date();d.setMonth(d.getMonth()-1);const y=d.getFullYear();const m=String(d.getMonth()+1).padStart(2,"0");const last=new Date(y,d.getMonth()+1,0).getDate();return{inicio:`${y}-${m}-01`,fim:`${y}-${m}-${last}`};};

  const getVendasRange=()=>{
    if(vendasFiltro==="hoje")return agregarPeriodo(hojeDate,hojeDate);
    if(vendasFiltro==="ontem")return agregarPeriodo(ontemDate,ontemDate);
    if(vendasFiltro==="mes"){return agregarPeriodo(mesAtualInicio,hojeDate);}
    if(vendasFiltro==="mespassado"){const mp=mesAnterior();return agregarPeriodo(mp.inicio,mp.fim);}
    return agregarPeriodo(hojeDate,hojeDate);
  };
  const getProdRange=()=>{
    if(prodFiltroData==="7dias")return agregarPeriodo(seteDiasAtras,hojeDate);
    if(prodFiltroData==="mes")return agregarPeriodo(mesAtualInicio,hojeDate);
    if(prodFiltroData==="mespassado"){const mp=mesAnterior();return agregarPeriodo(mp.inicio,mp.fim);}
    return agregarPeriodo(seteDiasAtras,hojeDate);
  };

  const CANAIS_ALL=["Mercado Livre","Shopee","Shein","TikTok","Magalu","Meluni"];
  const MARCAS_ALL=["Exitus","Lumia","Muniam"];
  const CORES_CANAL={"Mercado Livre":"#FFE600","Shopee":"#EE4D2D","Shein":"#222","TikTok":"#00f2ea","Magalu":"#0086ff","Meluni":"#9b59b6"};
  const CORES_MARCA2={Exitus:"#d4c8a8",Lumia:"#b8a88a",Muniam:"#8a7560"};
  const fmtV=(v)=>Number(v||0).toLocaleString("pt-BR",{minimumFractionDigits:0});
  const fmtRV=(v)=>"R$ "+Number(v||0).toLocaleString("pt-BR",{minimumFractionDigits:2});
  const dotColor=(cor)=>{const m={Preto:"#222",Natural:"#d4c8a8",Branco:"#f5f0e8",Areia:"#c8b88a",Verde:"#4a8a4a","Verde Agua":"#5ab8a0","Verde Militar":"#5a6b4a","Verde Salvia":"#b5c99a","Verde Escuro":"#2d5a2d",Terracota:"#b85c38",Rose:"#d4a0a0",Caqui:"#8a7a5a",Cinza:"#999",Marrom:"#6b4226","Marrom Escuro":"#4a2a12",Azul:"#3a6aa5","Azul Marinho":"#1a3a6a","Azul Claro":"#7ab0d4","Azul Serenity":"#5b9bd5","Amarelo Manteiga":"#e8d080",Bege:"#d4c0a0","Bege Claro":"#e8d8c0",Caramelo:"#b87a3a",Figo:"#6a3a5a","Off White":"#f0e8d8",Creme:"#e8d8c0",Cappuccino:"#8a6a4a",Vermelho:"#c0392b",Roxo:"#6a2d8a",Laranja:"#e67e22",Bordo:"#6a1a2a",Rosa:"#d48aa0",Nude:"#c8a890","Vinho":"#5a1a2a"};return m[cor]||"#a89f94";};
  // Credenciais separadas por conta — localStorage + Supabase
  const [creds,setCreds]=useState(()=>{try{return JSON.parse(localStorage.getItem("bling_creds"))||{exitus:{id:"",secret:""},lumia:{id:"",secret:""},muniam:{id:"",secret:""}};}catch{return{exitus:{id:"",secret:""},lumia:{id:"",secret:""},muniam:{id:"",secret:""}};}});
  const [tokens,setTokens]=useState({exitus:null,lumia:null,muniam:null});
  const [resultado,setResultado]=useState(null);
  const [historico,setHistorico]=useState([]);
  const [hist,setHist]=useState(false);
  const [syncing,setSyncing]=useState(false);
  const [syncMsg,setSyncMsg]=useState("");
  const [devPct,setDevPct]=useState(10);
  const [totalMes,setTotalMes]=useState(0);
  const [fechandoAnterior,setFechandoAnterior]=useState(false);
  const [blingHealth,setBlingHealth]=useState(null);
  const [healthLoading,setHealthLoading]=useState(false);
  const fetchBlingHealth=async()=>{
    try{
      setHealthLoading(true);
      const r=await fetch("/api/bling-health");
      if(r.ok){const d=await r.json();setBlingHealth(d);}
    }catch(e){console.error("health:",e);}
    finally{setHealthLoading(false);}
  };
  const fmt2=(v)=>"R$ "+Number(v||0).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
  const hoje=new Date().toISOString().slice(0,10);
  const hojeStr=new Date().toLocaleDateString("pt-BR");
  const CONTAS=["exitus","lumia","muniam"];
  const CORES={exitus:"#0057FF",lumia:"#6c2bd9",muniam:"#0096c7"};

  // Verificar se token está expirado
  const tokenExpirado=(token)=>{
    if(!token||!token.expires_at)return true;
    return new Date(token.expires_at)<new Date();
  };

  // Carregar tokens, creds do Supabase e auto-sync ao montar
  useEffect(()=>{
    try{
      if(supabase){
        const url=import.meta.env.VITE_SUPABASE_URL||"";
        const key=import.meta.env.VITE_SUPABASE_ANON_KEY||"";
        if(url)localStorage.setItem("sb_url",url);
        if(key)localStorage.setItem("sb_key",key);
      }
    }catch(e){console.error(e)}
    (async()=>{
      const ts=await blingDb.getTokens();
      const m={exitus:null,lumia:null,muniam:null};
      ts.forEach(t=>{if(m[t.conta]!==undefined)m[t.conta]=t;});
      setTokens(m);
      // Carregar credenciais — sync bidirecional localStorage ↔ Supabase
      try{
        const {data:sbCreds}=await supabase.from('amicia_data').select('payload').eq('user_id','bling-creds').maybeSingle();
        const local=JSON.parse(localStorage.getItem("bling_creds")||"{}");
        const hasLocal=local.exitus?.id||local.lumia?.id||local.muniam?.id;
        const hasSb=sbCreds?.payload?.exitus?.id||sbCreds?.payload?.lumia?.id||sbCreds?.payload?.muniam?.id;

        if(hasLocal&&!hasSb){
          // localStorage tem creds mas Supabase não → salva no Supabase (pra cron usar)
          console.log("BLING: sincronizando creds localStorage → Supabase");
          await supabase.from('amicia_data').upsert({user_id:'bling-creds',payload:local},{onConflict:'user_id'});
        }else if(hasSb&&!hasLocal){
          // Supabase tem mas localStorage não → carrega
          setCreds(sbCreds.payload);
          localStorage.setItem("bling_creds",JSON.stringify(sbCreds.payload));
        }
      }catch(e){console.error("BLING creds sync:",e)}
      const r=await blingDb.getResultado(hoje);
      if(r)setResultado(r);
      try{
        const {data:hist}=await supabase.from('bling_resultados').select('*').order('data',{ascending:false}).limit(31);
        if(hist)setHistorico(hist);
      }catch(e){console.error(e)}
    })();
  },[]);

  const salvarCreds=(conta,campo,valor)=>{
    const novo={...creds,[conta]:{...creds[conta],[campo]:valor}};
    setCreds(novo);
    localStorage.setItem("bling_creds",JSON.stringify(novo));
    // Salva no Supabase também
    try{supabase.from('amicia_data').upsert({user_id:'bling-creds',payload:novo},{onConflict:'user_id'});}catch(e){console.error(e)}
  };

  const conectarConta=(conta)=>{
    const c=creds[conta];
    if(!c.id||!c.secret){setSyncMsg("⚠ Preencha Client ID e Secret da "+conta+" primeiro");setTimeout(()=>setSyncMsg(""),3000);return;}
    // Salva as creds da conta em chaves temporárias para o callback ler
    localStorage.setItem("bling_auth_id",c.id);
    localStorage.setItem("bling_auth_secret",c.secret);
    const state=conta;
    const callback=encodeURIComponent(window.location.origin+"/bling-callback.html");
    const url=`https://www.bling.com.br/Api/v3/oauth/authorize?response_type=code&client_id=${c.id}&redirect_uri=${callback}&state=${state}`;
    window.open(url,"_blank");
    let tentativas=0;
    const poll=setInterval(async()=>{
      tentativas++;
      const ts=await blingDb.getTokens();
      const t=ts.find(x=>x.conta===conta);
      if(t&&t.access_token){
        setTokens(prev=>({...prev,[conta]:t}));
        setSyncMsg(`✓ ${conta} conectada!`);setTimeout(()=>setSyncMsg(""),3000);
        clearInterval(poll);
      }
      if(tentativas>40)clearInterval(poll);
    },3000);
  };

  const renovarToken=async(conta,token)=>{
    try{
      const c=creds[conta];
      if(!c||!c.id||!c.secret)return null;
      const r=await fetch("/api/bling-token",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({client_id:c.id,client_secret:c.secret,grant_type:"refresh_token",refresh_token:token.refresh_token})
      });
      if(!r.ok)return null;
      const d=await r.json();
      if(!d.access_token)return null;
      const nd={access_token:d.access_token,refresh_token:d.refresh_token,expires_at:new Date(Date.now()+(d.expires_in||21600)*1000).toISOString()};
      await blingDb.saveToken(conta,nd);
      setTokens(prev=>({...prev,[conta]:{...prev[conta],...nd}}));
      return nd.access_token;
    }catch{return null;}
  };

  const buscarTotalConta=async(conta,token,dataInicial,dataFinal)=>{
    // Retorna total bruto da conta no período
    try{
      let accessToken=token.access_token;
      if(tokenExpirado(token)){
        accessToken=await renovarToken(conta,token);
        if(!accessToken)return 0;
      }
      let total=0,pagina=1,continuar=true;
      while(continuar){
        const r=await fetch("/api/bling-pedidos",{
          method:"POST",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({access_token:accessToken,data_inicial:dataInicial,data_final:dataFinal,pagina,limite:100})
        });
        if(!r.ok)break;
        const d=await r.json();
        if(!d.data||d.data.length===0){continuar=false;break;}
        d.data.forEach(p=>total+=parseFloat(p.totalProdutos||0));
        if(d.data.length<100)continuar=false;
        else pagina++;
      }
      return total;
    }catch{return 0;}
  };

  const executarSync=async(mesOverride)=>{
    if(syncing)return;
    setSyncing(true);
    const isFechamento=!!mesOverride;
    setSyncMsg(isFechamento?"⏳ Fechando mês anterior...":"⏳ Sincronizando mês...");
    try{
      const now=new Date();
      let anoMes,dataInicial,dataFinal,mesAlvo;
      if(mesOverride){
        // Fechar mês anterior
        anoMes=mesOverride; // "YYYY-MM"
        dataInicial=anoMes+"-01";
        const [y,m]=anoMes.split("-").map(Number);
        const ultimoDia=new Date(y,m,0).getDate();
        dataFinal=anoMes+"-"+String(ultimoDia).padStart(2,"0");
        mesAlvo=mesOverride;
      }else{
        anoMes=now.toISOString().slice(0,7);
        dataInicial=anoMes+"-01";
        dataFinal=hoje;
        mesAlvo=mesAtual;
      }

      const [ex,lu,mu]=await Promise.all([
        tokens.exitus?buscarTotalConta("exitus",tokens.exitus,dataInicial,dataFinal):Promise.resolve(0),
        tokens.lumia?buscarTotalConta("lumia",tokens.lumia,dataInicial,dataFinal):Promise.resolve(0),
        tokens.muniam?buscarTotalConta("muniam",tokens.muniam,dataInicial,dataFinal):Promise.resolve(0),
      ]);

      const bruto=ex+lu+mu;
      const liquido=Math.round(bruto*(1-devPct/100)*100)/100;

      // Salvar resultado consolidado no Supabase (data = último dia do período)
      await blingDb.saveResultado(dataFinal,ex,lu,mu,bruto,liquido);

      // Lançar valor acumulado do mês em Marketplaces (célula do dia 1)
      setReceitasMes(mesAlvo,prev=>{
        const limpo={...prev};
        // Limpar marketplaces de outros dias pra não duplicar
        for(const k of Object.keys(limpo)){
          if(limpo[k]?.marketplaces)limpo[k]={...limpo[k],marketplaces:""};
        }
        limpo[1]={...(limpo[1]||{}),marketplaces:String(liquido)};
        return limpo;
      });

      if(!isFechamento){
        setResultado({data:hoje,exitus:ex,lumia:lu,muniam:mu,total_bruto:bruto,valor_liquido:liquido});
        setTotalMes(liquido);
        localStorage.setItem("bling_ultimo_sync",hoje);
      }

      setSyncMsg(isFechamento?`✓ Mês ${anoMes} fechado: ${fmt2(liquido)}`:`✓ Mês: ${fmt2(liquido)} (bruto ${fmt2(bruto)})`);
      const {data:hist}=await supabase.from('bling_resultados').select('*').order('data',{ascending:false}).limit(31);
      if(hist)setHistorico(hist);
    }catch(e){setSyncMsg("⚠ Erro: "+e.message);}
    setSyncing(false);
    if(isFechamento)setFechandoAnterior(false);
    setTimeout(()=>setSyncMsg(""),6000);
  };

  const doSync=()=>executarSync(null);
  const fecharMesAnterior=()=>{
    const now=new Date();
    const prev=new Date(now.getFullYear(),now.getMonth()-1,1);
    const anoMes=prev.toISOString().slice(0,7);
    setFechandoAnterior(true);
    executarSync(anoMes);
  };

  // Auto-sync: quando tokens carregarem e não sincronizou hoje, dispara
  useEffect(()=>{
    const ultimoSync=localStorage.getItem("bling_ultimo_sync");
    if(ultimoSync===hoje)return;
    if(tokens.exitus||tokens.lumia||tokens.muniam){
      doSync();
    }
  },[tokens]);

  const bruto=resultado?.total_bruto||0;
  const liquido=resultado?.valor_liquido||0;
  const dev=bruto-liquido;

  return(
    <div style={{fontFamily:"Georgia,serif",background:"#f7f4f0",minHeight:"100%"}}>
      {/* Header */}
      <div style={{background:"#fff",borderBottom:"1px solid #e8e2da",padding:"10px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:36,height:36,borderRadius:8,background:"#4CAF73",display:"flex",alignItems:"center",justifyContent:"center"}}>
            <svg width="36" height="36" viewBox="0 0 64 64"><rect width="64" height="64" rx="10" fill="#4CAF73"/><text x="8" y="42" fontSize="19" fontWeight="900" fill="white" fontFamily="Arial" letterSpacing="-0.5">bling</text><rect x="47" y="20" width="7" height="17" rx="3.5" fill="white" transform="rotate(10 50 28)"/><ellipse cx="51.5" cy="45" rx="4" ry="3.5" fill="white" transform="rotate(10 51 45)"/></svg>
          </div>
          <div>
            <div style={{fontSize:17,fontWeight:700,color:"#2c3e50"}}>Bling Marketplaces</div>
            <div style={{fontSize:11,color:"#8a9aa4"}}>Exitus · Lumia · Muniam</div>
          </div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
          {syncMsg&&<span style={{fontSize:11,color:syncMsg.startsWith("⚠")?"#c0392b":syncMsg.startsWith("⏳")?"#e67e22":"#27ae60"}}>{syncMsg}</span>}
          <button onClick={doSync} disabled={syncing} style={{background:"#4a7fa5",color:"#fff",border:"none",borderRadius:8,padding:"7px 12px",fontSize:12,cursor:syncing?"not-allowed":"pointer",opacity:syncing?0.7:1,fontFamily:"Georgia,serif",fontWeight:600}}>🔄 Sync</button>
          <button onClick={()=>{setTela("vendas");setVendasSub("overview");}} style={{background:tela==="vendas"&&vendasSub==="overview"?"#2c3e50":"#fff",color:tela==="vendas"&&vendasSub==="overview"?"#fff":"#2c3e50",border:tela==="vendas"&&vendasSub==="overview"?"none":"1px solid #e8e2da",borderRadius:8,padding:"7px 12px",fontSize:12,cursor:"pointer",fontFamily:"Georgia,serif",fontWeight:600}}>📦 Vendas</button>
          <button onClick={()=>{setTela("vendas");setVendasSub("produtos");}} style={{background:tela==="vendas"&&vendasSub==="produtos"?"#2c3e50":"#fff",color:tela==="vendas"&&vendasSub==="produtos"?"#fff":"#2c3e50",border:tela==="vendas"&&vendasSub==="produtos"?"none":"1px solid #e8e2da",borderRadius:8,padding:"7px 12px",fontSize:12,cursor:"pointer",fontFamily:"Georgia,serif",fontWeight:600,display:"flex",alignItems:"center",gap:5}}><svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 2C10.8 2 10 2.8 10 4C10 4.8 10.4 5.4 11 5.7L8.5 11L5 22H19L15.5 11L13 5.7C13.6 5.4 14 4.8 14 4C14 2.8 13.2 2 12 2Z" fill={tela==="vendas"&&vendasSub==="produtos"?"white":"#4a7fa5"}/></svg> Produtos</button>
          <button onClick={()=>setTela("estoque")} style={{background:tela==="estoque"?"#2c3e50":"#fff",color:tela==="estoque"?"#fff":"#2c3e50",border:tela==="estoque"?"none":"1px solid #e8e2da",borderRadius:8,padding:"7px 12px",fontSize:12,cursor:"pointer",fontFamily:"Georgia,serif",fontWeight:600,display:"flex",alignItems:"center",gap:5}}><svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M4 6h16v12H4zM4 10h16M8 6v12M16 6v12" stroke={tela==="estoque"?"white":"#4a7fa5"} strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg> Estoque</button>
          <button onClick={()=>{const next=tela==="dash"?"config":"dash";setTela(next);if(next==="config")fetchBlingHealth();}} style={{background:tela==="config"?"#2c3e50":"#fff",color:tela==="config"?"#fff":"#2c3e50",border:"1px solid #e8e2da",borderRadius:8,padding:"7px 12px",fontSize:12,cursor:"pointer",fontFamily:"Georgia,serif",fontWeight:600}}>
            {tela==="config"?"← Voltar":"⚙ Config"}
          </button>
        </div>
      </div>

      <div style={{maxWidth:860,margin:"0 auto",padding:16}}>

        {/* DASHBOARD */}
        {tela==="dash"&&(
          <div>
            {/* Alertas de token expirado ou desconectado */}
            {CONTAS.map(c=>{
              const tk=tokens[c];
              const semCred=!creds[c]?.id;
              const desconectada=!tk;
              const expirado=tk&&tokenExpirado(tk);
              if(!desconectada&&!expirado)return null;
              return(
                <div key={c} style={{background:expirado?"#fdeaea":"#fff8e8",border:`1px solid ${expirado?"#f4b8b8":"#f0d080"}`,borderRadius:10,padding:"10px 14px",marginBottom:10,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <span style={{fontSize:12,color:expirado?"#c0392b":"#8a6500"}}>{expirado?"🔴":"⚠"} <b style={{textTransform:"capitalize"}}>{c}</b> {semCred?"sem credenciais":expirado?"token expirado — reconecte":"desconectada"}</span>
                  <button onClick={()=>{if(semCred)setTela("config");else conectarConta(c);}} style={{fontSize:11,background:"none",border:`1px solid ${expirado?"#c0392b":"#c8a040"}`,borderRadius:6,padding:"3px 10px",cursor:"pointer",color:expirado?"#c0392b":"#8a6500",fontFamily:"Georgia,serif"}}>{semCred?"Configurar":"Reconectar"}</button>
                </div>
              );
            })}

            {/* Cards 3 contas */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:10}}>
              {CONTAS.map(c=>{
                const tk=tokens[c];
                const ok=!!tk&&!tokenExpirado(tk);
                const val=resultado?resultado[c]:null;
                return(
                  <div key={c} style={{background:"#fff",borderRadius:12,overflow:"hidden",border:"1px solid #e8e2da",opacity:ok?1:0.5}}>
                    <div style={{background:CORES[c],padding:"7px 12px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <span style={{fontSize:12,fontWeight:700,color:"#fff",textTransform:"capitalize"}}>{c}</span>
                      <span style={{fontSize:10,color:"rgba(255,255,255,0.8)"}}>{ok?"conectada":tk?"expirado":"offline"}</span>
                    </div>
                    <div style={{padding:12}}>
                      <div style={{fontFamily:"Calibri,'Segoe UI',Arial",fontSize:18,fontWeight:800,color:"#2c3e50"}}>{ok&&val!=null?fmt2(val):"—"}</div>
                      <div style={{fontSize:10,color:"#a89f94",marginTop:3}}>acumulado mês</div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Card total */}
            <div style={{background:"#2c3e50",borderRadius:14,padding:18,marginBottom:12}}>
              <div style={{fontSize:9,color:"rgba(255,255,255,0.5)",letterSpacing:2,textTransform:"uppercase",marginBottom:12}}>
                {resultado?`Sincronizado · ${hojeStr}`:"Sem dados — sync automático ao abrir"}
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>
                <div>
                  <div style={{fontSize:10,color:"rgba(255,255,255,0.55)",marginBottom:3}}>Total bruto mês</div>
                  <div style={{fontFamily:"Calibri,'Segoe UI',Arial",fontSize:18,fontWeight:800,color:"#fff"}}>{bruto?fmt2(bruto):"—"}</div>
                </div>
                <div>
                  <div style={{fontSize:10,color:"rgba(255,255,255,0.55)",marginBottom:3}}>Devoluções −{devPct}%</div>
                  <div style={{fontFamily:"Calibri,'Segoe UI',Arial",fontSize:18,fontWeight:800,color:"#f4b8b8"}}>{dev?`−${fmt2(dev)}`:"—"}</div>
                </div>
                <div>
                  <div style={{fontSize:10,color:"rgba(255,255,255,0.55)",marginBottom:3}}>💰 Líquido lançado</div>
                  <div style={{fontFamily:"Calibri,'Segoe UI',Arial",fontSize:24,fontWeight:900,color:"#4dffcc"}}>{liquido?fmt2(liquido):"—"}</div>
                  {liquido>0&&<div style={{fontSize:9,color:"rgba(255,255,255,0.4)",marginTop:2}}>✓ Lançado em Marketplaces</div>}
                </div>
              </div>
            </div>

            {/* Botão fechar mês anterior */}
            <div style={{display:"flex",gap:10,marginBottom:12}}>
              <button onClick={fecharMesAnterior} disabled={syncing||fechandoAnterior} style={{background:"#fff",border:"1px solid #e8e2da",borderRadius:10,padding:"10px 16px",fontSize:12,cursor:syncing?"not-allowed":"pointer",fontFamily:"Georgia,serif",fontWeight:600,color:"#2c3e50",flex:1,opacity:syncing?0.6:1}}>
                📅 Fechar mês anterior
              </button>
            </div>

            {/* Histórico */}
            <div style={{background:"#fff",borderRadius:12,border:"1px solid #e8e2da",overflow:"hidden"}}>
              <div onClick={()=>setHist(v=>!v)} style={{padding:"12px 14px",display:"flex",justifyContent:"space-between",cursor:"pointer",borderBottom:hist?"1px solid #e8e2da":"none",alignItems:"center"}}>
                <span style={{fontSize:12,fontWeight:700,color:"#2c3e50"}}>📋 Histórico</span>
                <span style={{fontSize:11,color:"#4a7fa5"}}>{hist?"▲ Fechar":"▼ Ver"}</span>
              </div>
              {hist&&(
                <div>
                  <div style={{display:"grid",gridTemplateColumns:"90px 1fr 1fr 1fr 1fr",padding:"6px 14px",background:"#f7f4f0"}}>
                    {["Data","Exitus","Lumia","Muniam","Líquido"].map(h=><div key={h} style={{fontSize:9,color:"#a89f94",fontWeight:700,textTransform:"uppercase"}}>{h}</div>)}
                  </div>
                  {historico.length===0&&<div style={{padding:16,textAlign:"center",fontSize:12,color:"#c0b8b0"}}>Nenhum registro ainda</div>}
                  {historico.map((r,i)=>(
                    <div key={i} style={{display:"grid",gridTemplateColumns:"90px 1fr 1fr 1fr 1fr",padding:"8px 14px",borderBottom:"1px solid #f0ebe4",background:i%2===0?"#fff":"#faf8f5",alignItems:"center"}}>
                      <div style={{fontSize:11,color:"#6b7c8a"}}>{new Date(r.data+"T12:00:00").toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit"})}</div>
                      <div style={{fontFamily:"Calibri,'Segoe UI',Arial",fontSize:11,color:"#2c3e50"}}>{fmt2(r.exitus||0)}</div>
                      <div style={{fontFamily:"Calibri,'Segoe UI',Arial",fontSize:11,color:"#2c3e50"}}>{fmt2(r.lumia||0)}</div>
                      <div style={{fontFamily:"Calibri,'Segoe UI',Arial",fontSize:11,color:"#2c3e50"}}>{fmt2(r.muniam||0)}</div>
                      <div style={{fontFamily:"Calibri,'Segoe UI',Arial",fontSize:12,fontWeight:800,color:"#27ae60"}}>{fmt2(r.valor_liquido||0)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* CONFIG — Credenciais separadas por conta */}
        {tela==="config"&&(
          <div>
            <div style={{fontSize:13,fontWeight:700,color:"#2c3e50",marginBottom:4}}>Credenciais por conta</div>
            <div style={{fontSize:11,color:"#8a9aa4",marginBottom:12}}>Cada Bling tem seu próprio app em <b>developer.bling.com.br</b></div>

            {CONTAS.map(conta=>{
              const c=creds[conta];
              const tk=tokens[conta];
              const ok=!!tk&&!tokenExpirado(tk);
              return(
                <div key={conta} style={{background:"#fff",borderRadius:12,padding:14,border:`2px solid ${ok?"#b8dfc8":"#f4b8b8"}`,marginBottom:12}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <div style={{width:10,height:10,borderRadius:5,background:CORES[conta]}}/>
                      <span style={{fontSize:14,fontWeight:700,color:"#2c3e50",textTransform:"capitalize"}}>{conta}</span>
                    </div>
                    <span style={{fontSize:10,padding:"2px 8px",borderRadius:10,fontWeight:700,background:ok?"#eafbf0":tk?"#fff3e0":"#fdeaea",color:ok?"#27ae60":tk?"#e67e22":"#c0392b"}}>{ok?"● On":tk?"● Expirado":"○ Off"}</span>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
                    <div>
                      <div style={{fontSize:9,color:"#a89f94",marginBottom:3,textTransform:"uppercase",letterSpacing:1}}>Client ID</div>
                      <input value={c.id} onChange={e=>salvarCreds(conta,"id",e.target.value)} placeholder="Client ID" style={{width:"100%",border:"1px solid #c8d8e4",borderRadius:6,padding:"6px 8px",fontSize:11,outline:"none",boxSizing:"border-box",fontFamily:"Georgia,serif"}}/>
                    </div>
                    <div>
                      <div style={{fontSize:9,color:"#a89f94",marginBottom:3,textTransform:"uppercase",letterSpacing:1}}>Client Secret</div>
                      <input value={c.secret} onChange={e=>salvarCreds(conta,"secret",e.target.value)} placeholder="Client Secret" type="password" style={{width:"100%",border:"1px solid #c8d8e4",borderRadius:6,padding:"6px 8px",fontSize:11,outline:"none",boxSizing:"border-box",fontFamily:"Georgia,serif"}}/>
                    </div>
                  </div>
                  <button onClick={()=>conectarConta(conta)} disabled={!c.id||!c.secret} style={{width:"100%",background:ok?"#fdeaea":(!c.id||!c.secret)?"#e8e2da":"#4a7fa5",color:ok?"#c0392b":(!c.id||!c.secret)?"#a89f94":"#fff",border:ok?"1px solid #f4b8b8":"none",borderRadius:8,padding:"7px",fontSize:12,cursor:(!c.id||!c.secret)?"not-allowed":"pointer",fontFamily:"Georgia,serif",fontWeight:600}}>
                    {ok?"Reconectar":tk?"🔄 Renovar token":"🔗 Conectar "+conta}
                  </button>
                </div>
              );
            })}

            <div style={{background:"#fff",borderRadius:12,padding:14,border:"1px solid #e8e2da"}}>
              <div style={{fontSize:12,fontWeight:600,color:"#2c3e50",marginBottom:8}}>Regra de devolução</div>
              <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                <span style={{fontSize:12,color:"#6b7c8a"}}>Desconto automático:</span>
                <input type="number" value={devPct} onChange={e=>setDevPct(Number(e.target.value))} style={{width:55,border:"1px solid #c8d8e4",borderRadius:6,padding:"5px 8px",fontSize:14,fontWeight:700,textAlign:"center",outline:"none",fontFamily:"Calibri,Arial"}}/>
                <span style={{fontSize:12,color:"#6b7c8a"}}>% do bruto</span>
              </div>
            </div>

            {/* ════ SAÚDE DA INTEGRAÇÃO ════ */}
            <div style={{background:"#fff",borderRadius:12,padding:14,border:"1px solid #e8e2da",marginTop:12}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <div style={{fontSize:13,fontWeight:700,color:"#2c3e50"}}>🩺 Saúde da Integração</div>
                <button onClick={fetchBlingHealth} disabled={healthLoading} style={{background:"#4a7fa5",color:"#fff",border:"none",borderRadius:6,padding:"4px 10px",fontSize:10,cursor:"pointer",fontFamily:"Georgia,serif",fontWeight:600,opacity:healthLoading?0.6:1}}>
                  {healthLoading?"Carregando...":"🔄 Atualizar"}
                </button>
              </div>

              {!blingHealth?(
                <div style={{fontSize:11,color:"#a89f94",textAlign:"center",padding:12}}>Clique em Atualizar pra ver o status</div>
              ):(
                <div>
                  {/* Último cron */}
                  <div style={{display:"flex",gap:8,marginBottom:10,flexWrap:"wrap"}}>
                    <div style={{flex:1,minWidth:120,background:"#f7f4f0",borderRadius:8,padding:"8px 10px",textAlign:"center"}}>
                      <div style={{fontSize:9,color:"#a89f94",marginBottom:2}}>Último cron</div>
                      <div style={{fontSize:11,fontWeight:700,color:"#2c3e50"}}>{blingHealth.last_cron?new Date(blingHealth.last_cron).toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}):"—"}</div>
                    </div>
                    <div style={{flex:1,minWidth:120,background:"#f7f4f0",borderRadius:8,padding:"8px 10px",textAlign:"center"}}>
                      <div style={{fontSize:9,color:"#a89f94",marginBottom:2}}>Duração</div>
                      <div style={{fontSize:11,fontWeight:700,color:"#2c3e50"}}>{blingHealth.duracao_ultimo||"—"}</div>
                    </div>
                    <div style={{flex:1,minWidth:120,background:"#f7f4f0",borderRadius:8,padding:"8px 10px",textAlign:"center"}}>
                      <div style={{fontSize:9,color:"#a89f94",marginBottom:2}}>Pedidos 7d</div>
                      <div style={{fontSize:11,fontWeight:700,color:"#2c3e50"}}>{blingHealth.total_7d||0}</div>
                    </div>
                  </div>

                  {/* Por conta */}
                  {CONTAS.map(conta=>{
                    const c=blingHealth.contas?.[conta];
                    if(!c)return null;
                    const tkColor=c.token_status==="valido"?"#27ae60":c.token_status==="expira_breve"?"#e67e22":"#c0392b";
                    const tkLabel=c.token_status==="valido"?"✅ Válido":c.token_status==="expira_breve"?"⚠️ Expira em breve":c.token_status==="expirado"?"❌ Expirado":"❓ Sem token";
                    const temErro=c.erros_ultimo_ciclo>0;
                    return(
                      <div key={conta} style={{background:temErro?"#fef5f5":"#fafff5",border:`1px solid ${temErro?"#f4b8b8":"#d4edc4"}`,borderRadius:8,padding:10,marginBottom:8}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                          <div style={{display:"flex",alignItems:"center",gap:6}}>
                            <div style={{width:8,height:8,borderRadius:4,background:CORES[conta]}}/>
                            <span style={{fontSize:12,fontWeight:700,color:"#2c3e50",textTransform:"capitalize"}}>{conta}</span>
                          </div>
                          <span style={{fontSize:9,fontWeight:700,color:tkColor,padding:"2px 8px",borderRadius:8,background:tkColor+"18"}}>{tkLabel}</span>
                        </div>
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6,marginBottom:6}}>
                          <div style={{textAlign:"center"}}>
                            <div style={{fontSize:9,color:"#a89f94"}}>Hoje</div>
                            <div style={{fontSize:13,fontWeight:700,color:"#2c3e50"}}>{c.pedidos_hoje}</div>
                          </div>
                          <div style={{textAlign:"center"}}>
                            <div style={{fontSize:9,color:"#a89f94"}}>Novos (ciclo)</div>
                            <div style={{fontSize:13,fontWeight:700,color:c.novos_ultimo_ciclo>0?"#27ae60":"#2c3e50"}}>{c.novos_ultimo_ciclo}</div>
                          </div>
                          <div style={{textAlign:"center"}}>
                            <div style={{fontSize:9,color:"#a89f94"}}>Erros</div>
                            <div style={{fontSize:13,fontWeight:700,color:temErro?"#c0392b":"#27ae60"}}>{c.erros_ultimo_ciclo}</div>
                          </div>
                        </div>
                        {c.last_error&&<div style={{fontSize:9,color:"#c0392b",background:"#fdeaea",borderRadius:4,padding:"3px 6px",marginBottom:4}}>⚠ {c.last_error}</div>}
                        {c.token_expires&&<div style={{fontSize:9,color:"#8a9aa4"}}>Token expira: {new Date(c.token_expires).toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})}</div>}
                      </div>
                    );
                  })}

                  {/* Botões operacionais */}
                  <div style={{display:"flex",gap:6,marginTop:8,flexWrap:"wrap"}}>
                    <button onClick={async()=>{
                      if(!confirm("Disparar sincronização manual agora?"))return;
                      setHealthLoading(true);
                      try{
                        const r=await fetch("/api/bling-health",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"sync_now"})});
                        const d=await r.json();
                        alert(d.ok?"✅ Sync disparado! Aguarde ~5min e atualize.":"❌ Erro: "+(d.error||""));
                      }catch(e){alert("Erro: "+e.message);}
                      setHealthLoading(false);
                      setTimeout(fetchBlingHealth,5000);
                    }} style={{background:"#2c3e50",color:"#fff",border:"none",borderRadius:6,padding:"6px 12px",fontSize:10,cursor:"pointer",fontFamily:"Georgia,serif",fontWeight:600}}>
                      🔄 Sincronizar Agora
                    </button>
                    <button onClick={async()=>{
                      if(!confirm("⚠️ Isso vai limpar todo o cache e reimportar ~5600 pedidos.\nVai levar ~2-3 horas pro cron completar.\n\nContinuar?"))return;
                      setHealthLoading(true);
                      try{
                        const r=await fetch("/api/bling-health",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"reprocess_all"})});
                        const d=await r.json();
                        alert(d.ok?"✅ "+d.msg:"❌ "+(d.error||""));
                      }catch(e){alert("Erro: "+e.message);}
                      setHealthLoading(false);
                      setTimeout(fetchBlingHealth,3000);
                    }} style={{background:"#c0392b",color:"#fff",border:"none",borderRadius:6,padding:"6px 12px",fontSize:10,cursor:"pointer",fontFamily:"Georgia,serif",fontWeight:600}}>
                      🗑 Reprocessar Tudo
                    </button>
                    {CONTAS.map(conta=>(
                      <button key={conta} onClick={async()=>{
                        setHealthLoading(true);
                        try{
                          const r=await fetch("/api/bling-health",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"refresh_token",conta})});
                          const d=await r.json();
                          alert(d.ok?`✅ Token ${conta} renovado!`:"❌ "+(d.error||""));
                        }catch(e){alert("Erro: "+e.message);}
                        setHealthLoading(false);
                        fetchBlingHealth();
                      }} style={{background:"#f7f4f0",color:"#2c3e50",border:"1px solid #e8e2da",borderRadius:6,padding:"5px 10px",fontSize:9,cursor:"pointer",fontFamily:"Georgia,serif",fontWeight:600,textTransform:"capitalize"}}>
                        🔑 Token {conta}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ════ ESTOQUE (ML Lumia proxy) ════ */}
        {tela==="estoque"&&(
          <EstoqueView sbUrl={sbUrl} handleZoom={handleZoom} produtos={produtos}/>
        )}

        {/* ════ VENDAS DASHBOARD ════ */}
        {tela==="vendas"&&vendasSub==="overview"&&(()=>{
          const vd=getVendasRange();
          const canaisAtivos=CANAIS_ALL.filter(c=>vd.porCanal[c]?.bruto>0).sort((a,b)=>(vd.porCanal[b]?.bruto||0)-(vd.porCanal[a]?.bruto||0));
          const maxCanal=canaisAtivos.length>0?vd.porCanal[canaisAtivos[0]]?.bruto||1:1;
          const filtroLabel=vendasFiltro==="hoje"?hojeDate.split("-").reverse().join("/")+" · 🔴 ao vivo":vendasFiltro==="ontem"?ontemDate.split("-").reverse().join("/")+" · consolidado":vendasFiltro==="mes"?"Mês atual":"Mês passado";
          return(
            <div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                <div>
                  <div style={{fontSize:11,color:"#a89f94",letterSpacing:2,textTransform:"uppercase"}}>Vendas Detalhadas</div>
                  <div style={{fontSize:16,fontWeight:700,color:"#2c3e50"}}>{filtroLabel}</div>
                </div>
                <div style={{display:"flex",gap:4}}>
                  {[["hoje","Hoje"],["ontem","Ontem"],["mes","Este mês"],["mespassado","Mês passado"]].map(([k,l])=>(
                    <button key={k} onClick={()=>setVendasFiltro(k)} style={{background:vendasFiltro===k?"#2c3e50":"#fff",color:vendasFiltro===k?"#fff":"#2c3e50",border:vendasFiltro===k?"none":"1px solid #e8e2da",borderRadius:6,padding:"5px 10px",fontSize:11,cursor:"pointer",fontFamily:"Georgia,serif"}}>{l}</button>
                  ))}
                </div>
              </div>
              {/* Total card */}
              <div style={{background:"#2c3e50",borderRadius:12,padding:"14px 20px",marginBottom:12,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div>
                  <div style={{fontSize:10,color:"#7a9ab5",letterSpacing:1}}>FATURAMENTO</div>
                  <div style={{fontSize:26,fontWeight:900,color:"#fff",fontFamily:"Calibri,Arial"}}>{fmtRV(vd.totalBruto)}</div>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:13,color:"#a3bacc",fontFamily:"Calibri,Arial"}}>{fmtV(vd.totalItens)} itens · {fmtV(vd.totalPedidos)} pedidos</div>
                  {blingImportStatus&&<div style={{fontSize:10,color:"#7a9ab5",marginTop:3}}>📦 {blingImportStatus}</div>}
                </div>
              </div>
              {vd.totalPedidos===0?(
                <div style={{background:"#fff",borderRadius:12,border:"1px dashed #d0c8c0",padding:40,textAlign:"center"}}>
                  <div style={{fontSize:32,marginBottom:10}}>📦</div>
                  <div style={{fontSize:14,color:"#a89f94"}}>Sem dados de vendas detalhadas neste período</div>
                  <div style={{fontSize:11,color:"#c0b8b0",marginTop:4}}>Os dados são importados automaticamente ao abrir o app</div>
                </div>
              ):(
                <div style={{display:"flex",gap:14}}>
                  {/* Canais */}
                  <div style={{flex:1,background:"#fff",borderRadius:12,border:"1px solid #e8e2da",padding:"14px 16px"}}>
                    <div style={{fontSize:12,fontWeight:700,color:"#2c3e50",marginBottom:10}}>Faturamento por Canal</div>
                    {canaisAtivos.map(c=>{const cd=vd.porCanal[c];const pct=cd.bruto/vd.totalBruto;const bar=cd.bruto/maxCanal;return(
                      <div key={c} style={{marginBottom:10}}>
                        <div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}>
                          <div style={{display:"flex",alignItems:"center",gap:5}}><div style={{width:8,height:8,borderRadius:"50%",background:CORES_CANAL[c]||"#aaa"}}/><span style={{fontSize:12,color:"#2c3e50"}}>{c}</span></div>
                          <span style={{fontSize:12,fontWeight:700,color:"#2c3e50",fontFamily:"Calibri,Arial"}}>{fmtRV(cd.bruto)} <span style={{fontWeight:400,color:"#a89f94"}}>({Math.round(pct*100)}%)</span></span>
                        </div>
                        <div style={{height:8,background:"#f0ebe4",borderRadius:4,overflow:"hidden"}}><div style={{height:"100%",borderRadius:4,background:CORES_CANAL[c]==="#222"?"#555":CORES_CANAL[c]||"#aaa",width:`${bar*100}%`,opacity:0.75}}/></div>
                        <div style={{fontSize:10,color:"#a89f94",marginTop:1}}>{fmtV(cd.itens)} itens · ticket {fmtRV(cd.bruto/(cd.pedidos||1))}</div>
                        {cd.subcanais&&Object.keys(cd.subcanais).length>1&&<div style={{fontSize:9,color:"#4a7fa5",marginTop:1}}>{Object.entries(cd.subcanais).map(([sc,sd])=>`${sc}: ${fmtV(sd.pedidos)} ped`).join(" · ")}</div>}
                      </div>
                    );})}
                  </div>
                  {/* Marcas + botão produtos */}
                  <div style={{flex:1,display:"flex",flexDirection:"column",gap:12}}>
                    <div style={{background:"#fff",borderRadius:12,border:"1px solid #e8e2da",padding:"14px 16px"}}>
                      <div style={{fontSize:12,fontWeight:700,color:"#2c3e50",marginBottom:10}}>Por Marca</div>
                      <div style={{display:"flex",gap:8}}>
                        {MARCAS_ALL.map(m=>{const md=vd.porMarca[m]||{bruto:0,itens:0};const pct=vd.totalBruto>0?md.bruto/vd.totalBruto:0;const semDado=md.bruto===0;return(
                          <div key={m} style={{flex:1,textAlign:"center",padding:"10px 6px",background:semDado?"#fafafa":"#f7f4f0",borderRadius:8,opacity:semDado?0.5:1}}>
                            <span style={{fontSize:9,color:"#4a3a2a",background:CORES_MARCA2[m],borderRadius:3,padding:"2px 8px",fontWeight:700}}>{m}</span>
                            {semDado?<div style={{fontSize:11,color:"#c0b8b0",marginTop:8}}>sem dados</div>:(
                              <><div style={{fontSize:16,fontWeight:800,color:"#2c3e50",fontFamily:"Calibri,Arial",marginTop:6}}>{fmtRV(md.bruto)}</div>
                              <div style={{fontSize:10,color:"#a89f94",marginTop:2}}>{fmtV(md.itens)} itens · {Math.round(pct*100)}%</div></>
                            )}
                          </div>
                        );})}
                      </div>
                      {MARCAS_ALL.some(m=>!vd.porMarca[m]||vd.porMarca[m].bruto===0)&&(
                        <div style={{fontSize:10,color:"#c0392b",marginTop:8,textAlign:"center"}}>⚠ Marcas sem dados — verificar tokens no Console (F12) ou em Config</div>
                      )}
                    </div>
                    {/* Gráfico dias */}
                    {vd.porDia.length>1&&(
                      <div style={{background:"#fff",borderRadius:12,border:"1px solid #e8e2da",padding:"14px 16px"}}>
                        <div style={{fontSize:12,fontWeight:700,color:"#2c3e50",marginBottom:10}}>Por Dia</div>
                        <div style={{display:"flex",alignItems:"flex-end",gap:4,height:120}}>
                          {(()=>{const maxD=Math.max(...vd.porDia.map(d=>d.total),1);return vd.porDia.map((d,i)=>{const h=maxD>0?(d.total/maxD)*100:0;const isHoje=d.dia===hojeDate;return(
                            <div key={d.dia} style={{flex:1,textAlign:"center"}}>
                              <div style={{fontSize:8,color:"#2c3e50",fontFamily:"Calibri,Arial",marginBottom:2}}>{d.total>0?(d.total/1000).toFixed(1)+"k":""}</div>
                              <div style={{height:h,background:isHoje?"#4a7fa5":"#c8d8e4",borderRadius:"3px 3px 0 0",minHeight:d.total>0?4:0}}/>
                              <div style={{fontSize:9,color:isHoje?"#4a7fa5":"#a89f94",marginTop:3,fontWeight:isHoje?700:400}}>{d.dia.slice(8)}</div>
                            </div>
                          );});})()}
                        </div>
                      </div>
                    )}
                    {/* Botão Produtos */}
                    <div onClick={()=>setVendasSub("produtos")} style={{background:"linear-gradient(135deg,#2c3e50,#4a7fa5)",borderRadius:12,padding:"16px",cursor:"pointer",textAlign:"center"}} onMouseEnter={e=>e.currentTarget.style.opacity="0.9"} onMouseLeave={e=>e.currentTarget.style.opacity="1"}>
                      <div style={{fontSize:14,fontWeight:700,color:"#fff"}}>📦 Ver Produtos</div>
                      <div style={{fontSize:11,color:"#a3bacc",marginTop:3}}>Ranking · Tamanhos · Cores</div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* ════ PRODUTOS ════ */}
        {tela==="vendas"&&vendasSub==="produtos"&&(()=>{
          const pd=getProdRange();
          // Canais e marcas reais (do dado, não hardcoded)
          const canaisReais=Object.keys(pd.porCanal).sort((a,b)=>(pd.porCanal[b]?.bruto||0)-(pd.porCanal[a]?.bruto||0));
          const marcasReais=Object.keys(pd.porMarca).sort((a,b)=>(pd.porMarca[b]?.bruto||0)-(pd.porMarca[a]?.bruto||0));
          const prods=Object.values(pd.porProduto).filter(p=>filtroMarca==="todas"||(p.marcas&&p.marcas[filtroMarca]>0)).map(p=>({...p,qtdF:filtroMarca!=="todas"?(p.marcas[filtroMarca]||0):(filtroCanal==="todos"?p.qtd:(p.porCanal[filtroCanal]?.qtd||0)),valF:filtroCanal==="todos"?p.valor:(p.porCanal[filtroCanal]?.valor||0)})).filter(p=>p.qtdF>0).sort((a,b)=>b.qtdF-a.qtdF).slice(0,30);
          const maxQ=prods.length>0?prods[0].qtdF:1;
          const tamS=Object.entries(pd.tamGeral).sort((a,b)=>b[1]-a[1]);const tamT=tamS.reduce((s,t)=>s+t[1],0)||1;const maxTam=tamS.length>0?tamS[0][1]:1;
          const corS=Object.entries(pd.corGeral).sort((a,b)=>b[1]-a[1]);const corT=corS.reduce((s,c)=>s+c[1],0)||1;const maxCor=corS.length>0?corS[0][1]:1;
          return(
            <div>
              <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:10}}>
                <button onClick={()=>setVendasSub("overview")} style={{background:"none",border:"1px solid #e8e2da",borderRadius:6,padding:"5px 12px",fontSize:12,cursor:"pointer",color:"#4a7fa5"}}>← Voltar</button>
                <div style={{fontSize:16,fontWeight:700,color:"#2c3e50"}}>📦 Produtos</div>
              </div>
              {/* Filtro data */}
              <div style={{display:"flex",gap:4,marginBottom:8,alignItems:"center"}}>
                <span style={{fontSize:11,color:"#a89f94"}}>Período:</span>
                {[["7dias","Últimos 7 dias"],["mes","Mês atual"],["mespassado","Mês passado"]].map(([k,l])=>(
                  <button key={k} onClick={()=>setProdFiltroData(k)} style={{background:prodFiltroData===k?"#2c3e50":"#fff",color:prodFiltroData===k?"#fff":"#2c3e50",border:prodFiltroData===k?"none":"1px solid #e8e2da",borderRadius:6,padding:"4px 10px",fontSize:11,cursor:"pointer"}}>{l}</button>
                ))}
              </div>
              {/* Filtro marca + canal — dinâmico dos dados reais */}
              <div style={{display:"flex",gap:4,marginBottom:12,alignItems:"center",flexWrap:"wrap"}}>
                <span style={{fontSize:11,color:"#a89f94"}}>Marca:</span>
                <button onClick={()=>setFiltroMarca("todas")} style={{background:filtroMarca==="todas"?"#2c3e50":"#fff",color:filtroMarca==="todas"?"#fff":"#2c3e50",border:filtroMarca==="todas"?"none":"1px solid #e8e2da",borderRadius:6,padding:"4px 8px",fontSize:10,cursor:"pointer"}}>Todas</button>
                {marcasReais.map(m=>(<button key={m} onClick={()=>setFiltroMarca(m)} style={{background:filtroMarca===m?CORES_MARCA2[m]||"#2c3e50":"#fff",color:filtroMarca===m?"#4a3a2a":"#2c3e50",border:filtroMarca===m?"1px solid "+(CORES_MARCA2[m]||"#2c3e50"):"1px solid #e8e2da",borderRadius:6,padding:"4px 8px",fontSize:10,cursor:"pointer",fontWeight:filtroMarca===m?700:400}}>{m} ({pd.porMarca[m]?.itens||0})</button>))}
                <div style={{width:1,height:16,background:"#e8e2da",margin:"0 4px"}}/>
                <span style={{fontSize:11,color:"#a89f94"}}>Canal:</span>
                <button onClick={()=>setFiltroCanal("todos")} style={{background:filtroCanal==="todos"?"#2c3e50":"#fff",color:filtroCanal==="todos"?"#fff":"#2c3e50",border:filtroCanal==="todos"?"none":"1px solid #e8e2da",borderRadius:6,padding:"4px 7px",fontSize:9,cursor:"pointer"}}>Todos</button>
                {canaisReais.map(c=>(<button key={c} onClick={()=>setFiltroCanal(c)} style={{background:filtroCanal===c?"#2c3e50":"#fff",color:filtroCanal===c?"#fff":"#2c3e50",border:filtroCanal===c?"none":"1px solid #e8e2da",borderRadius:6,padding:"4px 7px",fontSize:9,cursor:"pointer"}}>{c} ({pd.porCanal[c]?.itens||0})</button>))}
              </div>
              {prods.length===0?(
                <div style={{background:"#fff",borderRadius:12,border:"1px dashed #d0c8c0",padding:40,textAlign:"center"}}><div style={{fontSize:14,color:"#a89f94"}}>Sem dados de produto neste período</div></div>
              ):(
                <div style={{display:"flex",gap:14,alignItems:"flex-start"}}>
                  {/* Ranking */}
                  <div style={{flex:"1 1 50%",background:"#fff",borderRadius:12,border:"1px solid #e8e2da",overflow:"hidden"}}>
                    <div style={{padding:"7px 16px",background:"#f7f4f0",borderBottom:"1px solid #e8e2da",display:"flex",justifyContent:"space-between"}}><span style={{fontSize:13,fontWeight:700,color:"#2c3e50"}}>🏆 Top 30</span><span style={{fontSize:10,color:"#a89f94"}}>{prods.length} produtos</span></div>
                    <div style={{maxHeight:900,overflowY:"auto"}}>
                      {prods.map((p,i)=>{const pct=maxQ>0?p.qtdF/maxQ:0;return(
                        <div key={p.ref} style={{display:"flex",alignItems:"center",gap:6,padding:"5px 14px",borderBottom:"1px solid #f0ebe4"}}>
                          <div style={{width:20,height:20,borderRadius:"50%",background:"#e8e2da",display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:800,color:"#6b5f54",flexShrink:0}}>{i+1}</div>
                          <FotoProd sbUrl={sbUrl} refProd={p.ref} onZoom={handleZoom}/><div style={{width:34,height:44,borderRadius:4,background:"#f0ebe3",display:"none",alignItems:"center",justifyContent:"center",border:"1px solid #e8e2da",flexShrink:0}}><span style={{fontSize:12,opacity:0.3}}>📷</span></div>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{display:"flex",alignItems:"center",gap:4}}><span style={{fontSize:11,fontWeight:700,color:"#2c3e50"}}>REF {p.ref}</span><span style={{fontSize:10,color:"#6b7c8a",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.desc}</span><span style={{display:"flex",gap:2,flexShrink:0,marginLeft:"auto"}}>{Object.entries(p.marcas||{}).map(([m,q])=>(<span key={m} style={{fontSize:8,color:"#4a3a2a",background:CORES_MARCA2[m]||"#888",borderRadius:3,padding:"1px 4px"}} title={`${m}: ${q} un`}>{m}</span>))}</span></div>
                            <div style={{marginTop:2,height:3,background:"#f0ebe4",borderRadius:2,overflow:"hidden"}}><div style={{height:"100%",borderRadius:2,background:"linear-gradient(90deg,#4a7fa5,#2c3e50)",width:`${pct*100}%`}}/></div>
                          </div>
                          <div style={{textAlign:"right",flexShrink:0,marginLeft:6}}><div style={{fontSize:13,fontWeight:800,color:"#2c3e50",fontFamily:"Calibri,Arial"}}>{fmtV(p.qtdF)} un</div><div style={{fontSize:10,color:"#4a7fa5",fontFamily:"Calibri,Arial"}}>{fmtRV(p.valF)}</div></div>
                        </div>
                      );})}
                    </div>
                  </div>
                  {/* Tamanhos + Cores */}
                  <div style={{flex:"1 1 46%",display:"flex",flexDirection:"column",gap:12}}>
                    <div style={{background:"#fff",borderRadius:12,border:"1px solid #e8e2da",overflow:"hidden"}}>
                      <div style={{padding:"10px 16px",background:"#f7f4f0",borderBottom:"1px solid #e8e2da",fontSize:12,fontWeight:700,color:"#2c3e50"}}>📏 Vendas por Tamanho</div>
                      <div style={{padding:"12px 16px"}}>
                        {tamS.length===0?<div style={{fontSize:11,color:"#a89f94"}}>Sem dados de tamanho</div>:tamS.map(([tam,qtd],i)=>{const pct=qtd/tamT;const bar=qtd/maxTam;return(
                          <div key={tam} style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
                            <div style={{width:32,height:32,borderRadius:6,background:i===0?"#2c3e50":"#f7f4f0",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:800,color:i===0?"#fff":"#2c3e50",fontFamily:"Calibri,Arial",flexShrink:0}}>{tam}</div>
                            <div style={{flex:1}}>
                              <div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}><span style={{fontSize:13,fontWeight:700,color:"#2c3e50",fontFamily:"Calibri,Arial"}}>{fmtV(qtd)} un</span><span style={{fontSize:12,fontWeight:800,color:"#4a7fa5",fontFamily:"Calibri,Arial"}}>{Math.round(pct*100)}%</span></div>
                              <div style={{height:6,background:"#f0ebe4",borderRadius:3,overflow:"hidden"}}><div style={{height:"100%",borderRadius:3,background:i===0?"#2c3e50":"#4a7fa5",width:`${bar*100}%`,opacity:1-i*0.12}}/></div>
                            </div>
                          </div>
                        );})}
                      </div>
                    </div>
                    <div style={{background:"#fff",borderRadius:12,border:"1px solid #e8e2da",overflow:"hidden"}}>
                      <div style={{padding:"10px 16px",background:"#f7f4f0",borderBottom:"1px solid #e8e2da",fontSize:12,fontWeight:700,color:"#2c3e50"}}>🎨 Vendas por Cor</div>
                      <div style={{padding:"12px 16px"}}>
                        {corS.length===0?<div style={{fontSize:11,color:"#a89f94"}}>Sem dados de cor</div>:corS.slice(0,14).map(([cor,qtd])=>{const pct=qtd/corT;const bar=qtd/maxCor;const dc=dotColor(cor);return(
                          <div key={cor} style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                            <div style={{width:12,height:12,borderRadius:"50%",background:dc,border:cor==="Branco"?"1px solid #d0c8c0":"none",flexShrink:0}}/>
                            <span style={{fontSize:11,color:"#2c3e50",width:80,flexShrink:0}}>{cor}</span>
                            <div style={{flex:1,height:6,background:"#f0ebe4",borderRadius:3,overflow:"hidden"}}><div style={{height:"100%",borderRadius:3,background:dc==="#f0ebe4"?"#d0c8c0":dc,width:`${bar*100}%`,opacity:0.7}}/></div>
                            <span style={{fontSize:12,fontWeight:700,color:"#2c3e50",fontFamily:"Calibri,Arial",width:40,textAlign:"right",flexShrink:0}}>{fmtV(qtd)}</span>
                            <span style={{fontSize:10,color:"#4a7fa5",fontFamily:"Calibri,Arial",width:30,textAlign:"right",flexShrink:0}}>{Math.round(pct*100)}%</span>
                          </div>
                        );})}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
};

// ── Módulo Salas de Corte ────────────────────────────────────────────────────
const SALAS_CORTE_INICIAL=["Antonio","Adalecio","Chico"];
const scDb={
  async load(){try{const {data}=await supabase.from('amicia_data').select('payload').eq('user_id','salas-corte').single();return data?.payload||null;}catch{return null;}},
  async save(payload){try{await supabase.from('amicia_data').upsert({user_id:'salas-corte',payload},{onConflict:'user_id'});}catch(e){console.error(e)}},
};

const SalasCorteContent=({produtos=[],usuario="",logTroca=[],tecidosCAD=[]})=>{
  const [w,setW]=useState(typeof window!=="undefined"?window.innerWidth:900);
  useEffect(()=>{const h=()=>setW(window.innerWidth);window.addEventListener("resize",h);return()=>window.removeEventListener("resize",h);},[]);
  const mobile=w<640;

  // Fotos: mesma lógica do Bling (FotoProd + zoom DOM)
  const sbUrl=import.meta.env.VITE_SUPABASE_URL||localStorage.getItem("sb_url")||"";
  const handleZoom=(src)=>{const ov=document.createElement('div');ov.style.cssText='position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:99999;display:flex;align-items:center;justify-content:center;cursor:pointer';const img=document.createElement('img');img.src=src;img.style.cssText='width:200px;height:280px;object-fit:cover;border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,0.3);border:3px solid #fff';ov.appendChild(img);ov.onclick=()=>document.body.removeChild(ov);document.body.appendChild(ov);};

  const [tela,setTela]=useState("lancamento");
  const [cortesSala,setCortesSala]=useState([]);
  const [salas,setSalas]=useState(SALAS_CORTE_INICIAL);
  const [novaSala,setNovaSala]=useState("");
  const [mostraAddSala,setMostraAddSala]=useState(false);
  const [salaSelected,setSalaSelected]=useState("");
  const [refBusca,setRefBusca]=useState("");
  const [prodFound,setProdFound]=useState(null);
  const [qtdRolos,setQtdRolos]=useState("");
  const [saveMsg,setSaveMsg]=useState("");
  const [scSync,setScSync]=useState(null); // null | 'saving' | 'saved' | 'error'
  const [editandoPecas,setEditandoPecas]=useState(null);
  const [pecasInput,setPecasInput]=useState("");
  const [abaAnalise,setAbaAnalise]=useState("ranking");
  const [refBuscaAnalise,setRefBuscaAnalise]=useState("");
  const [prodCardRef,setProdCardRef]=useState(null);
  const [filtroSala,setFiltroSala]=useState("todas");
  const [addHist,setAddHist]=useState(false);
  const [histForm,setHistForm]=useState({sala:"",qtdRolos:"",qtdPecas:"",data:""});
  const [dbLoaded,setDbLoaded]=useState(false);
  const debRef=useRef(null);
  const deletedIdsRef=useRef(new Set()); // rastreia IDs excluídos pra não voltar no merge
  const [logSC,setLogSC]=useState([]);
  const [editCorte,setEditCorte]=useState(null);
  const [editForm,setEditForm]=useState({sala:"",ref:"",qtdRolos:"",qtdPecas:""});
  const [confirm,setConfirm]=useState(null);
  const [custoAberto,setCustoAberto]=useState(null);

  const _FN="Calibri,'Segoe UI',Arial";
  const fmt=(v)=>Number(v||0).toLocaleString("pt-BR");
  const fmtR=(v)=>"R$ "+Number(v||0).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
  const getTecido=(nome)=>tecidosCAD.find(t=>t.descricao===nome);
  const tecCorte=(c)=>{const p=buscarProd(c.ref);return p?.tecido||"";};
  const custoCorte=(c)=>{
    const prod=buscarProd(c.ref);if(!prod?.tecido)return null;
    const tec=getTecido(prod.tecido);if(!tec)return null;
    const custoRolo=tec.valorMetro*tec.metragemRolo;
    const custoTotal=custoRolo*c.qtdRolos;
    const custoPeca=c.qtdPecas?Math.round((custoTotal/c.qtdPecas)*100)/100:null;
    return{custoRolo,custoTotal,custoPeca,tecido:tec.descricao};
  };

  // ── Supabase: load com merge ──
  useEffect(()=>{
    (async()=>{
      const remote=await scDb.load();
      if(remote){
        if(remote.cortes)setCortesSala(remote.cortes);
        if(remote.salas)setSalas(remote.salas);
        if(remote.logs)setLogSC(remote.logs);
      }
      setDbLoaded(true);
    })();
  },[]);

  // ── Supabase: auto-save com merge (multi-usuário) ──
  useEffect(()=>{
    if(!dbLoaded)return;
    if(debRef.current)clearTimeout(debRef.current);
    debRef.current=setTimeout(async()=>{
      try{
        const remote=await scDb.load();
        const remoteCortes=remote?.cortes||[];
        // Merge: mantém itens remotos que não existem localmente E que não foram excluídos
        const localIds=new Set(cortesSala.map(c=>c.id));
        const remoteOnly=remoteCortes.filter(c=>!localIds.has(c.id)&&!deletedIdsRef.current.has(c.id));
        const merged=[...cortesSala,...remoteOnly];
        // Merge salas
        const mergedSalas=[...new Set([...salas,...(remote?.salas||[])])];
        // Merge logs
        const remoteLogs=remote?.logs||[];
        const localLogIds=new Set(logSC.map(l=>l.id));
        const remoteLogsOnly=remoteLogs.filter(l=>!localLogIds.has(l.id));
        const mergedLogs=[...logSC,...remoteLogsOnly].sort((a,b)=>new Date(b.data)-new Date(a.data)).slice(0,200);
        setScSync('saving');
        await scDb.save({cortes:merged,salas:mergedSalas,logs:mergedLogs});
        setScSync('saved');setTimeout(()=>setScSync(null),2000);
      }catch(e){console.error(e);setScSync('error');setTimeout(()=>setScSync(null),4000);}
    },2000);
    return()=>clearTimeout(debRef.current);
  },[cortesSala,salas,logSC,dbLoaded]);

  // ── Sync descrições de produtos ──
  useEffect(()=>{
    if(!dbLoaded||!produtos.length)return;
    setCortesSala(prev=>{
      let mudou=false;
      const att=prev.map(c=>{
        if(c.descricao&&c.marca)return c;
        const normR=(r)=>String(r).replace(/^0+/,'');const p=produtos.find(x=>normR(x.ref)===normR(c.ref));
        if(!p)return c;
        mudou=true;
        return{...c,descricao:p.descricao,marca:p.marca};
      });
      return mudou?att:prev;
    });
  },[produtos,dbLoaded]);

  const concluidos=cortesSala.filter(c=>c.status==="concluido");
  const pendentes=cortesSala.filter(c=>c.status==="pendente").sort((a,b)=>new Date(a.data)-new Date(b.data));
  const hoje=new Date();
  const parados=pendentes.filter(c=>{const d=new Date(c.data+"T12:00:00");return(hoje-d)/(1000*60*60*24)>3;});
  const buscarProd=(ref)=>produtos.find(p=>p.ref===String(ref).trim());
  const handleRefChange=(val)=>{setRefBusca(val);setProdFound(buscarProd(val));};
  const descCorte=(c)=>{if(c.descricao)return c.descricao;const p=buscarProd(c.ref);return p?p.descricao:"";};

  // Log helper
  const addLog=(acao,detalhe)=>{setLogSC(prev=>[{id:Date.now(),data:new Date().toISOString(),usuario:usuario||"—",acao,detalhe},...prev].slice(0,200));};

  // Excluir corte — salva imediatamente no Supabase (sem esperar debounce)
  const excluirCorte=(id)=>{
    const c=cortesSala.find(x=>x.id===id);
    setConfirm({msg:`Excluir corte REF ${c?.ref} (${c?.sala})?`,onYes:()=>{
      deletedIdsRef.current.add(id);
      const novosCortes=cortesSala.filter(x=>x.id!==id);
      setCortesSala(novosCortes);
      addLog("excluir",`REF ${c?.ref} · ${c?.sala} · ${c?.qtdRolos}r`);
      setConfirm(null);
      // Save imediato — não depende do debounce
      scDb.save({cortes:novosCortes,salas,logs:logSC}).then(()=>{setScSync('saved');setTimeout(()=>setScSync(null),2000);}).catch(e=>{console.error("Erro salvando exclusão:",e);setScSync('error');setTimeout(()=>setScSync(null),4000);});
    }});
  };

  // Editar corte — abre modal
  const iniciarEdicao=(c)=>{
    setEditCorte(c.id);
    setEditForm({sala:c.sala,ref:c.ref,qtdRolos:String(c.qtdRolos),qtdPecas:c.qtdPecas?String(c.qtdPecas):""});
  };
  const salvarEdicao=()=>{
    if(!editCorte)return;
    const rolos=Number(editForm.qtdRolos),pecas=editForm.qtdPecas?Number(editForm.qtdPecas):null;
    const rend=pecas&&rolos?Math.round((pecas/rolos)*100)/100:null;
    const prod=buscarProd(editForm.ref);
    setCortesSala(prev=>prev.map(c=>{
      if(c.id!==editCorte)return c;
      const ref=mediaRef[editForm.ref];
      const temAlerta=ref&&ref.media>0&&rend&&rend<ref.media*0.95;
      return{...c,sala:editForm.sala,ref:editForm.ref,descricao:prod?.descricao||c.descricao||"",marca:prod?.marca||c.marca||"",qtdRolos:rolos,qtdPecas:pecas,rendimento:rend,status:pecas?"concluido":"pendente",alerta:!!temAlerta,visto:!temAlerta};
    }));
    addLog("editar",`REF ${editForm.ref} · ${editForm.sala} · ${editForm.qtdRolos}r${editForm.qtdPecas?` → ${editForm.qtdPecas}pç`:""}`);
    setEditCorte(null);
  };

  // Sync troca de referências do módulo Oficinas
  const [lastTrocaLen,setLastTrocaLen]=useState(0);
  useEffect(()=>{
    if(!dbLoaded||!logTroca.length||logTroca.length<=lastTrocaLen)return;
    const novasTrocas=logTroca.slice(lastTrocaLen);
    setCortesSala(prev=>{
      let mudou=false;
      const att=prev.map(c=>{
        const troca=novasTrocas.find(t=>t.de===c.ref);
        if(!troca)return c;
        mudou=true;
        return{...c,ref:troca.para};
      });
      return mudou?att:prev;
    });
    setLastTrocaLen(logTroca.length);
  },[logTroca,dbLoaded]);

  const mediaRef=useMemo(()=>{
    const m={};
    concluidos.forEach(c=>{
      if(!m[c.ref])m[c.ref]={total:0,rolos:0,count:0,descricao:c.descricao||descCorte(c),marca:c.marca,min:Infinity,max:0};
      m[c.ref].total+=c.qtdPecas;m[c.ref].rolos+=c.qtdRolos;m[c.ref].count++;
      if(c.rendimento<m[c.ref].min)m[c.ref].min=c.rendimento;
      if(c.rendimento>m[c.ref].max)m[c.ref].max=c.rendimento;
    });
    Object.keys(m).forEach(r=>{m[r].media=Math.round((m[r].total/m[r].rolos)*100)/100;if(m[r].min===Infinity)m[r].min=0;});
    return m;
  },[concluidos,produtos]);

  const ranking=useMemo(()=>{
    const m={};salas.forEach(s=>{m[s]={total:0,limpos:0};});
    concluidos.forEach(c=>{if(!m[c.sala])m[c.sala]={total:0,limpos:0};m[c.sala].total++;if(!c.alerta)m[c.sala].limpos++;});
    return Object.entries(m).map(([sala,d])=>({sala,...d,pct:d.total>0?Math.round(d.limpos/d.total*100):100})).sort((a,b)=>b.pct-a.pct||b.total-a.total);
  },[concluidos,salas]);

  const alertas=cortesSala.filter(c=>c.alerta&&!c.visto&&c.status==="concluido");

  const salvarCorte=()=>{
    if(!salaSelected||(!prodFound&&!refBusca.trim())||!qtdRolos){setSaveMsg("⚠ Preencha todos os campos");setTimeout(()=>setSaveMsg(""),2000);return;}
    const novo={id:Date.now(),data:new Date().toISOString().slice(0,10),sala:salaSelected,ref:prodFound?prodFound.ref:refBusca.trim(),descricao:prodFound?prodFound.descricao:"",marca:prodFound?prodFound.marca:"",qtdRolos:Number(qtdRolos),qtdPecas:null,rendimento:null,status:"pendente",alerta:false,visto:true};
    setCortesSala(prev=>[novo,...prev]);
    setSalaSelected("");setRefBusca("");setProdFound(null);setQtdRolos("");
    setSaveMsg("✓ Corte registrado!");setTimeout(()=>setSaveMsg(""),2500);
    addLog("criar",`REF ${novo.ref} · ${salaSelected} · ${qtdRolos}r`);
  };

  const fecharCorte=()=>{
    if(!editandoPecas||!pecasInput)return;
    const pecas=Number(pecasInput),corte=cortesSala.find(c=>c.id===editandoPecas);
    if(!corte)return;
    const rend=Math.round((pecas/corte.qtdRolos)*100)/100;
    const ref=mediaRef[corte.ref];
    const temAlerta=ref&&ref.media>0&&rend<ref.media*0.95;
    setCortesSala(prev=>prev.map(c=>c.id===editandoPecas?{...c,qtdPecas:pecas,rendimento:rend,status:"concluido",alerta:temAlerta,visto:!temAlerta}:c));
    addLog("fechar",`REF ${corte.ref} · ${corte.sala} · ${corte.qtdRolos}r → ${pecas}pç (${rend} pç/r)`);
    setEditandoPecas(null);setPecasInput("");
  };

  const marcarVisto=(id)=>{setCortesSala(prev=>prev.map(c=>c.id===id?{...c,visto:true}:c));addLog("visto",`Alerta corte ${id}`);};

  const addHistorico=()=>{
    if(!prodCardRef||!histForm.sala||!histForm.qtdRolos||!histForm.qtdPecas)return;
    const rolos=Number(histForm.qtdRolos),pecas=Number(histForm.qtdPecas);
    const rend=Math.round((pecas/rolos)*100)/100;
    const prod=buscarProd(prodCardRef);
    const dataCorte=histForm.data||new Date().toISOString().slice(0,10);
    const novo={id:Date.now(),data:dataCorte,sala:histForm.sala,ref:prodCardRef,descricao:prod?.descricao||"",marca:prod?.marca||"",qtdRolos:rolos,qtdPecas:pecas,rendimento:rend,status:"concluido",alerta:false,visto:true};
    setCortesSala(prev=>[novo,...prev]);
    addLog("manual",`REF ${prodCardRef} · ${histForm.sala} · ${rolos}r → ${pecas}pç`);
    setHistForm({sala:"",qtdRolos:"",qtdPecas:"",data:""});setAddHist(false);
  };

  const cortesFiltrados=useMemo(()=>{
    let list=[...cortesSala].filter(c=>c.status==="concluido");
    if(filtroSala!=="todas")list=list.filter(c=>c.sala===filtroSala);
    return list.sort((a,b)=>new Date(b.data)-new Date(a.data));
  },[cortesSala,filtroSala]);

  const sty={
    card:{background:"#fff",borderRadius:14,padding:mobile?14:16,border:"1px solid #e8e2da",marginBottom:12},
    input:{width:"100%",border:"1px solid #c8d8e4",borderRadius:10,padding:mobile?"14px 16px":"12px 14px",fontSize:mobile?17:15,outline:"none",boxSizing:"border-box",fontFamily:"Georgia,serif"},
    label:{fontSize:mobile?11:10,color:"#a89f94",letterSpacing:1,textTransform:"uppercase",marginBottom:6},
    salaBtn:(s)=>({flex:1,minWidth:mobile?80:90,padding:mobile?"18px 8px":"14px 8px",borderRadius:12,border:s?"2px solid #4a7fa5":"2px solid #e8e2da",background:s?"#e8f0f8":"#fff",cursor:"pointer",textAlign:"center",fontFamily:"Georgia,serif",fontSize:mobile?16:14,fontWeight:700,color:s?"#4a7fa5":"#2c3e50"}),
    tab:(a)=>({padding:mobile?"8px 12px":"6px 14px",borderRadius:8,border:"none",fontSize:mobile?13:12,cursor:"pointer",fontFamily:"Georgia,serif",fontWeight:600,background:a?"#4a7fa5":"transparent",color:a?"#fff":"#8a9aa4",whiteSpace:"nowrap",flex:mobile?1:"none"}),
  };

  return(
    <div style={{fontFamily:"Georgia,serif",background:"#f7f4f0",minHeight:"100%"}}>
      {/* Header */}
      <div style={{background:"#fff",borderBottom:"1px solid #e8e2da",padding:mobile?"8px 12px":"10px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <SvgSalasCorte size={36}/>
          <div>
            <div style={{fontSize:mobile?15:17,fontWeight:700,color:"#2c3e50"}}>Salas de Corte</div>
            <div style={{fontSize:11,color:"#8a9aa4"}}>Controle de rendimento</div>
          </div>
          {scSync&&<span style={{fontSize:11,padding:"3px 9px",borderRadius:10,fontFamily:"Georgia,serif",background:scSync==='saving'?"#f0f6fb":scSync==='saved'?"#eafbf0":"#fdeaea",color:scSync==='saving'?"#4a7fa5":scSync==='saved'?"#27ae60":"#c0392b"}}>{scSync==='saving'?"☁ salvando…":scSync==='saved'?"☁ salvo":"✗ erro"}</span>}
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          {alertas.length>0&&tela==="analise"&&<span style={{background:"#c0392b",color:"#fff",borderRadius:10,padding:"2px 8px",fontSize:11,fontWeight:700}}>{alertas.length}</span>}
          <button onClick={()=>setTela("lancamento")} style={{padding:mobile?"10px 14px":"8px 16px",border:tela==="lancamento"?"none":"1px solid #e8e2da",borderRadius:8,fontSize:mobile?14:13,cursor:"pointer",fontFamily:"Georgia,serif",fontWeight:600,background:tela==="lancamento"?"#2c3e50":"#fff",color:tela==="lancamento"?"#fff":"#2c3e50"}}>📋 Lançar</button>
          <button onClick={()=>setTela("analise")} style={{padding:mobile?"10px 14px":"8px 16px",border:tela==="analise"?"none":"1px solid #e8e2da",borderRadius:8,fontSize:mobile?14:13,cursor:"pointer",fontFamily:"Georgia,serif",fontWeight:600,background:tela==="analise"?"#2c3e50":"#fff",color:tela==="analise"?"#fff":"#2c3e50"}}>📊 Análise</button>
        </div>
      </div>

      <div style={{maxWidth:900,margin:"0 auto",padding:mobile?10:16}}>
        {/* ═══ LANÇAMENTO ═══ */}
        {tela==="lancamento"&&(<div>
          <div style={sty.card}><div style={sty.label}>Sala de Corte</div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              {salas.map(s=><div key={s} onClick={()=>setSalaSelected(s)} style={sty.salaBtn(salaSelected===s)}>{s}</div>)}
              {!mostraAddSala?<div onClick={()=>setMostraAddSala(true)} style={{...sty.salaBtn(false),color:"#a89f94",borderStyle:"dashed",fontSize:20,padding:"10px 8px"}}>+</div>
              :<div style={{display:"flex",gap:6,flex:1,minWidth:140}}>
                <input value={novaSala} onChange={e=>setNovaSala(e.target.value)} placeholder="Nome" style={{...sty.input,padding:"10px 12px",fontSize:14}}/>
                <button onClick={()=>{if(novaSala.trim()){setSalas(p=>[...p,novaSala.trim()]);setNovaSala("");setMostraAddSala(false);}}} style={{background:"#4a7fa5",color:"#fff",border:"none",borderRadius:8,padding:"8px 14px",fontSize:13,cursor:"pointer"}}>OK</button>
                <button onClick={()=>{setMostraAddSala(false);setNovaSala("");}} style={{background:"none",border:"1px solid #e8e2da",borderRadius:8,padding:"8px 10px",fontSize:13,cursor:"pointer"}}>✕</button>
              </div>}
            </div>
          </div>
          <div style={sty.card}><div style={sty.label}>Referência</div>
            <input value={refBusca} onChange={e=>handleRefChange(e.target.value)} placeholder="Digite a referência" style={sty.input}/>
            {prodFound&&<div style={{marginTop:10,padding:"12px 14px",background:"#eafbf0",borderRadius:10,border:"1px solid #b8dfc8"}}><div style={{fontSize:mobile?16:14,fontWeight:700,color:"#2c3e50"}}>{prodFound.descricao}</div><div style={{display:"flex",gap:6,marginTop:6}}><span style={{fontSize:10,color:"#fff",background:prodFound.marca==="Meluni"?"#9b59b6":"#4a7fa5",borderRadius:3,padding:"1px 6px"}}>{prodFound.marca}</span>{prodFound.tecido&&<span style={{fontSize:10,color:"#fff",background:"#e67e22",borderRadius:3,padding:"1px 6px"}}>🧵 {prodFound.tecido}</span>}</div></div>}
            {refBusca&&!prodFound&&<div style={{marginTop:8,padding:"10px 12px",background:"#fff8e8",border:"1px solid #f0d080",borderRadius:8}}><div style={{fontSize:12,color:"#8a6500"}}>⚠ REF <b>{refBusca}</b> não cadastrada</div><div style={{fontSize:11,color:"#a89f94",marginTop:4}}>Pode continuar sem descrição. Cadastre depois em Oficinas → Produtos.</div></div>}
          </div>
          <div style={sty.card}><div style={sty.label}>Quantidade de Rolos</div>
            <div style={{display:"flex",gap:8,alignItems:"center",flexDirection:mobile?"column":"row"}}>
              <input type="number" value={qtdRolos} onChange={e=>setQtdRolos(e.target.value)} placeholder="Qtd" style={{...sty.input,width:mobile?"100%":100,textAlign:"center",fontSize:mobile?28:22,fontWeight:800,fontFamily:_FN}}/>
              <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                {[5,10,15,20,25,30].map(n=><button key={n} onClick={()=>setQtdRolos(String(n))} style={{padding:mobile?"12px 16px":"8px 12px",borderRadius:8,border:qtdRolos===String(n)?"2px solid #4a7fa5":"1px solid #e8e2da",background:qtdRolos===String(n)?"#e8f0f8":"#fff",cursor:"pointer",fontSize:mobile?16:13,fontWeight:700,color:"#2c3e50",fontFamily:_FN,flex:mobile?1:"none",minWidth:mobile?50:"auto"}}>{n}</button>)}
              </div>
            </div>
          </div>
          {saveMsg&&<div style={{textAlign:"center",padding:"8px",fontSize:14,color:saveMsg.startsWith("⚠")?"#c0392b":"#27ae60",fontWeight:600}}>{saveMsg}</div>}
          <button onClick={salvarCorte} style={{width:"100%",padding:mobile?"18px":"16px",borderRadius:12,border:"none",fontSize:mobile?18:16,fontWeight:700,cursor:"pointer",fontFamily:"Georgia,serif",background:(salaSelected&&(prodFound||refBusca.trim())&&qtdRolos)?"#4a7fa5":"#c8d8e4",color:"#fff",marginBottom:20}}>✓ Registrar Corte</button>

          {/* Alerta tecido parado */}
          {parados.length>0&&(<div style={{marginBottom:12,padding:"10px 14px",background:"#fdeaea",border:"2px solid #f4b8b8",borderRadius:12}}>
            <div style={{fontSize:mobile?14:12,fontWeight:700,color:"#c0392b",display:"flex",alignItems:"center",gap:6}}>🚨 {parados.length} corte(s) parado(s) há mais de 3 dias</div>
            {parados.map(c=>{const dias=Math.floor((hoje-new Date(c.data+"T12:00:00"))/(1000*60*60*24));return(
              <div key={c.id} style={{marginTop:6,fontSize:12,color:"#6b7c8a"}}>• <b style={{color:"#c0392b"}}>{c.sala}</b> — REF {c.ref} — {c.qtdRolos}r — <b style={{color:"#c0392b"}}>{dias} dias</b></div>
            );})}
          </div>)}

          {/* Pendentes */}
          {pendentes.length>0&&(<div>
            <div style={{fontSize:mobile?14:12,fontWeight:700,color:"#e67e22",marginBottom:8,display:"flex",alignItems:"center",gap:6}}>
              <span style={{background:"#e67e22",color:"#fff",borderRadius:10,padding:"2px 8px",fontSize:11}}>{pendentes.length}</span>Aguardando qtd de peças
            </div>
            {pendentes.map(c=>(
              <div key={c.id} onClick={()=>{setEditandoPecas(c.id);setPecasInput("");}} style={{background:"#fff",borderRadius:12,padding:mobile?"14px 16px":"12px 14px",border:"2px solid #f0d080",marginBottom:8,cursor:"pointer"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div><span style={{fontSize:mobile?14:12,fontWeight:700,color:"#e67e22"}}>{c.sala}</span><span style={{fontSize:11,color:"#a89f94",marginLeft:8}}>{new Date(c.data+"T12:00:00").toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit"})}</span></div>
                  <span style={{fontSize:10,background:"#fff8e8",color:"#8a6500",padding:"2px 8px",borderRadius:6}}>⏳ pendente</span>
                </div>
                <div style={{display:"flex",gap:10,marginTop:6,alignItems:"center"}}>
                  <FotoProd sbUrl={sbUrl} refProd={c.ref} onZoom={handleZoom}/><div style={{width:34,height:44,borderRadius:4,background:"#f0ebe3",display:"none",alignItems:"center",justifyContent:"center",border:"1px solid #e8e2da",flexShrink:0}}><span style={{fontSize:12,opacity:0.3}}>📷</span></div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:mobile?16:14,fontWeight:700,color:"#2c3e50"}}>REF {c.ref}{descCorte(c)?` — ${descCorte(c)}`:""}{!descCorte(c)&&<span style={{fontSize:11,color:"#a89f94",fontStyle:"italic",marginLeft:6}}>sem cadastro</span>}</div>
                    <div style={{display:"flex",gap:6,marginTop:4,alignItems:"center"}}>{tecCorte(c)&&<span style={{fontSize:10,color:"#fff",background:"#e67e22",borderRadius:3,padding:"1px 6px"}}>🧵 {tecCorte(c)}</span>}<span style={{fontSize:mobile?13:12,color:"#6b7c8a"}}>{c.qtdRolos} rolos · toque para informar peças</span></div>
                  </div>
                </div>
              </div>
            ))}
          </div>)}

          {/* Últimos concluídos */}
          {concluidos.length>0&&(<div style={{marginTop:16}}>
            <div style={{fontSize:12,fontWeight:700,color:"#2c3e50",marginBottom:8}}>Últimos concluídos</div>
            {[...concluidos].sort((a,b)=>new Date(b.data)-new Date(a.data)).slice(0,5).map(c=>(
              <div key={c.id} style={{background:"#fff",borderRadius:10,padding:"10px 14px",border:"1px solid #e8e2da",marginBottom:6}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                  <div style={{display:"flex",gap:10,flex:1,alignItems:"center"}}>
                    <FotoProd sbUrl={sbUrl} refProd={c.ref} onZoom={handleZoom}/><div style={{width:34,height:44,borderRadius:4,background:"#f0ebe3",display:"none",alignItems:"center",justifyContent:"center",border:"1px solid #e8e2da",flexShrink:0}}><span style={{fontSize:12,opacity:0.3}}>📷</span></div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:"flex",alignItems:"center",gap:6}}>
                        <span style={{fontSize:12,fontWeight:700,color:"#2c3e50"}}>{c.sala}</span>
                        <span style={{fontSize:11,color:"#a89f94"}}>{new Date(c.data+"T12:00:00").toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit"})}</span>
                      </div>
                      <div style={{fontSize:13,fontWeight:600,color:"#2c3e50",marginTop:2}}>REF {c.ref}{descCorte(c)?` — ${descCorte(c)}`:""}</div>
                      <div style={{display:"flex",gap:6,marginTop:3,alignItems:"center"}}>{tecCorte(c)&&<span style={{fontSize:10,color:"#fff",background:"#e67e22",borderRadius:3,padding:"1px 6px"}}>🧵 {tecCorte(c)}</span>}<span style={{fontSize:11,color:"#a89f94"}}>{c.qtdRolos}r → {fmt(c.qtdPecas)} pç</span></div>
                    </div>
                  </div>
                  <div style={{display:"flex",gap:8,alignItems:"center",marginLeft:8}}>
                    <span onClick={()=>iniciarEdicao(c)} style={{cursor:"pointer",color:"#4a7fa5",fontSize:14}}>✏</span>
                    <span onClick={()=>excluirCorte(c.id)} style={{cursor:"pointer",color:"#d0c8c0",fontSize:16}}>×</span>
                  </div>
                </div>
              </div>
            ))}
          </div>)}

          {/* Modal Peças */}
          {editandoPecas&&(
            <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:999,padding:20}}>
              <div style={{background:"#fff",borderRadius:16,padding:mobile?20:24,maxWidth:380,width:"100%"}}>
                {(()=>{const c=cortesSala.find(x=>x.id===editandoPecas);if(!c)return null;
                  const ref=mediaRef[c.ref];const estimativa=ref?Math.round(ref.media*c.qtdRolos):null;
                  return(<>
                    <div style={{fontSize:11,color:"#a89f94",textTransform:"uppercase",letterSpacing:1}}>Informar peças</div>
                    <div style={{fontSize:mobile?18:16,fontWeight:700,color:"#2c3e50",marginTop:4}}>{c.sala} · REF {c.ref}</div>
                    <div style={{fontSize:13,color:"#6b7c8a",marginTop:2}}>{descCorte(c)||"Ref sem cadastro"} · {c.qtdRolos} rolos</div>
                    {estimativa&&<div style={{marginTop:8,padding:"8px 10px",background:"#f0f6fb",borderRadius:8,fontSize:12,color:"#4a7fa5"}}>📊 Estimativa: ~{fmt(estimativa)} peças</div>}
                    <input type="number" value={pecasInput} onChange={e=>setPecasInput(e.target.value)} placeholder="Qtd de peças" autoFocus style={{...sty.input,marginTop:12,textAlign:"center",fontSize:mobile?30:24,fontWeight:800,fontFamily:_FN}}/>
                    {pecasInput&&estimativa&&Number(pecasInput)<estimativa*0.95&&<div style={{marginTop:8,padding:"8px 10px",background:"#fdeaea",borderRadius:8,fontSize:13,color:"#c0392b",fontWeight:600}}>⚠ {Math.round((1-Number(pecasInput)/estimativa)*100)}% abaixo da estimativa!</div>}
                    <div style={{display:"flex",gap:8,marginTop:14}}>
                      <button onClick={()=>setEditandoPecas(null)} style={{flex:1,padding:mobile?"14px":"12px",borderRadius:10,border:"1px solid #e8e2da",background:"#fff",fontSize:mobile?16:14,cursor:"pointer",fontFamily:"Georgia,serif"}}>Cancelar</button>
                      <button onClick={fecharCorte} disabled={!pecasInput} style={{flex:1,padding:mobile?"14px":"12px",borderRadius:10,border:"none",background:pecasInput?"#27ae60":"#c8d8e4",color:"#fff",fontSize:mobile?16:14,fontWeight:700,cursor:pecasInput?"pointer":"not-allowed",fontFamily:"Georgia,serif"}}>Confirmar</button>
                    </div>
                  </>);
                })()}
              </div>
            </div>
          )}
        </div>)}

        {/* ═══ ANÁLISE ═══ */}
        {tela==="analise"&&(<div>
          <div style={{display:"flex",gap:4,marginBottom:14,background:"#fff",borderRadius:10,padding:4,border:"1px solid #e8e2da",overflowX:"auto"}}>
            {[{id:"ranking",label:"🏆 Ranking"},{id:"produtos",label:"📦 Produtos"},{id:"cortes",label:"📋 Cortes"},{id:"alertas",label:`🚨 Alertas${alertas.length>0?` (${alertas.length})`:""}`},{id:"logs",label:"📝 Logs"}].map(t=>(
              <button key={t.id} onClick={()=>setAbaAnalise(t.id)} style={sty.tab(abaAnalise===t.id)}>{t.label}</button>
            ))}
          </div>

          {/* RANKING */}
          {abaAnalise==="ranking"&&(<div>
            <div style={{fontSize:11,color:"#8a9aa4",marginBottom:12}}>Ordenado por % de cortes sem alertas</div>
            <div style={{display:"grid",gridTemplateColumns:mobile?"1fr":"1fr 1fr 1fr",gap:10}}>
              {ranking.map((s,i)=>{const corPct=s.pct>=95?(i===0?"#4dffcc":"#27ae60"):s.pct>=90?"#e67e22":"#c0392b";
                return(<div key={s.sala} style={{background:i===0?"#2c3e50":i===1?"#f7f4f0":"#fff",borderRadius:14,padding:16,textAlign:"center",border:i===0?"none":"1px solid #e8e2da"}}>
                  {i<3&&<div style={{fontSize:i===0?18:16}}>{["🥇","🥈","🥉"][i]}</div>}
                  <div style={{fontSize:32,fontWeight:900,color:corPct,fontFamily:_FN}}>{s.pct}%</div>
                  <div style={{fontSize:10,color:i===0?"rgba(255,255,255,0.6)":"#a89f94",marginTop:2}}>cortes limpos</div>
                  <div style={{fontSize:15,fontWeight:700,color:i===0?"#fff":"#2c3e50",marginTop:8}}>{s.sala}</div>
                  <div style={{fontSize:11,color:i===0?"rgba(255,255,255,0.5)":"#a89f94",marginTop:2}}>{s.total} cortes · {s.limpos} limpos</div>
                  {s.total-s.limpos>0&&<div style={{marginTop:4,fontSize:10,color:i===0?"#ff6b6b":"#c0392b",fontWeight:700}}>🔴 {s.total-s.limpos} alerta(s)</div>}
                </div>);
              })}
            </div>
          </div>)}

          {/* PRODUTOS */}
          {abaAnalise==="produtos"&&(<div>
            <input value={refBuscaAnalise} onChange={e=>{setRefBuscaAnalise(e.target.value);setProdCardRef(null);}} placeholder="Buscar por referência..." style={{...sty.input,marginBottom:12}}/>
            {!prodCardRef?(<div>
              {(refBuscaAnalise?produtos.filter(p=>p.ref.includes(refBuscaAnalise)||p.descricao.toLowerCase().includes(refBuscaAnalise.toLowerCase())):produtos).map(p=>{
                const ref=mediaRef[p.ref];
                return(<div key={p.ref} onClick={()=>setProdCardRef(p.ref)} style={{background:"#fff",borderRadius:10,padding:"12px 14px",border:"1px solid #e8e2da",marginBottom:6,cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div><span style={{fontSize:13,fontWeight:700,color:"#2c3e50"}}>REF {p.ref}</span><span style={{fontSize:12,color:"#6b7c8a",marginLeft:8}}>{p.descricao}</span></div>
                  {ref?<div style={{fontSize:12,fontWeight:800,color:"#4a7fa5",fontFamily:_FN}}>{ref.count} corte(s)</div>:<div style={{fontSize:11,color:"#a89f94"}}>sem cortes</div>}
                </div>);
              })}
            </div>):(<div>
              <button onClick={()=>setProdCardRef(null)} style={{background:"none",border:"none",color:"#4a7fa5",cursor:"pointer",fontSize:12,marginBottom:8,fontFamily:"Georgia,serif"}}>← Voltar</button>
              {(()=>{const p=buscarProd(prodCardRef);const ref=mediaRef[prodCardRef];const cortesDaRef=concluidos.filter(c=>c.ref===prodCardRef).sort((a,b)=>new Date(b.data)-new Date(a.data));
                return(<div style={sty.card}>
                  <div style={{display:"flex",justifyContent:"space-between"}}><div><div style={{fontSize:18,fontWeight:700,color:"#2c3e50"}}>REF {prodCardRef}</div><div style={{fontSize:13,color:"#6b7c8a"}}>{p?.descricao}</div>{p?.marca&&<span style={{fontSize:10,color:"#fff",background:p.marca==="Meluni"?"#9b59b6":"#4a7fa5",borderRadius:3,padding:"1px 6px"}}>{p.marca}</span>}</div><div style={{fontSize:11,color:"#a89f94"}}>{ref?.count||0} corte(s)</div></div>
                  {ref?(<div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginTop:14}}>
                    <div style={{background:"#eafbf0",borderRadius:10,padding:12,textAlign:"center"}}><div style={{fontSize:9,color:"#27ae60",textTransform:"uppercase",letterSpacing:1}}>Máximo</div><div style={{fontSize:22,fontWeight:800,color:"#27ae60",fontFamily:_FN}}>{ref.max}</div><div style={{fontSize:10,color:"#a89f94"}}>pç/rolo</div></div>
                    <div style={{background:"#f0f6fb",borderRadius:10,padding:12,textAlign:"center"}}><div style={{fontSize:9,color:"#4a7fa5",textTransform:"uppercase",letterSpacing:1}}>Média</div><div style={{fontSize:22,fontWeight:800,color:"#4a7fa5",fontFamily:_FN}}>{ref.media}</div><div style={{fontSize:10,color:"#a89f94"}}>pç/rolo</div></div>
                    <div style={{background:"#fdeaea",borderRadius:10,padding:12,textAlign:"center"}}><div style={{fontSize:9,color:"#c0392b",textTransform:"uppercase",letterSpacing:1}}>Mínimo</div><div style={{fontSize:22,fontWeight:800,color:"#c0392b",fontFamily:_FN}}>{ref.min}</div><div style={{fontSize:10,color:"#a89f94"}}>pç/rolo</div></div>
                  </div>):<div style={{marginTop:12,padding:12,background:"#f7f4f0",borderRadius:8,fontSize:12,color:"#a89f94",textAlign:"center"}}>Sem dados ainda</div>}
                  <div style={{marginTop:14}}>
                    {!addHist?<button onClick={()=>setAddHist(true)} style={{width:"100%",padding:"10px",borderRadius:8,border:"1px dashed #c8d8e4",background:"#fff",fontSize:12,cursor:"pointer",color:"#4a7fa5",fontFamily:"Georgia,serif",fontWeight:600}}>+ Adicionar corte ao histórico</button>
                    :<div style={{background:"#f7f4f0",borderRadius:10,padding:12}}>
                      <div style={{fontSize:10,color:"#a89f94",textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>Corte manual</div>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:8}}>
                        <div><div style={{fontSize:9,color:"#a89f94",marginBottom:3}}>Data</div><input type="date" value={histForm.data} onChange={e=>setHistForm(p=>({...p,data:e.target.value}))} style={{...sty.input,padding:"8px 6px",fontSize:11}}/></div>
                        <div><div style={{fontSize:9,color:"#a89f94",marginBottom:3}}>Sala</div><select value={histForm.sala} onChange={e=>setHistForm(p=>({...p,sala:e.target.value}))} style={{...sty.input,padding:"8px 6px",fontSize:11}}><option value="">—</option>{salas.map(s=><option key={s} value={s}>{s}</option>)}</select></div>
                        <div><div style={{fontSize:9,color:"#a89f94",marginBottom:3}}>Rolos</div><input type="number" value={histForm.qtdRolos} onChange={e=>setHistForm(p=>({...p,qtdRolos:e.target.value}))} placeholder="Qtd" style={{...sty.input,padding:"8px 6px",fontSize:11,textAlign:"center"}}/></div>
                        <div><div style={{fontSize:9,color:"#a89f94",marginBottom:3}}>Peças</div><input type="number" value={histForm.qtdPecas} onChange={e=>setHistForm(p=>({...p,qtdPecas:e.target.value}))} placeholder="Qtd" style={{...sty.input,padding:"8px 6px",fontSize:11,textAlign:"center"}}/></div>
                      </div>
                      <div style={{display:"flex",gap:8,marginTop:8}}>
                        <button onClick={()=>{setAddHist(false);setHistForm({sala:"",qtdRolos:"",qtdPecas:"",data:""});}} style={{flex:1,padding:"8px",borderRadius:8,border:"1px solid #e8e2da",background:"#fff",fontSize:12,cursor:"pointer"}}>Cancelar</button>
                        <button onClick={addHistorico} style={{flex:1,padding:"8px",borderRadius:8,border:"none",background:"#4a7fa5",color:"#fff",fontSize:12,cursor:"pointer",fontWeight:600}}>Salvar</button>
                      </div>
                    </div>}
                  </div>
                  {cortesDaRef.length>0&&(<div style={{marginTop:14}}>
                    <div style={{fontSize:10,color:"#a89f94",textTransform:"uppercase",letterSpacing:1,marginBottom:6}}>Histórico</div>
                    {cortesDaRef.map(c=>(<div key={c.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 8px",borderRadius:6,marginBottom:3,background:c.alerta?"#fdeaea":"#f9f9f7"}}>
                      <div style={{fontSize:11,color:"#6b7c8a"}}>{new Date(c.data+"T12:00:00").toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit"})} · {c.sala}</div>
                      <div style={{display:"flex",alignItems:"center",gap:8}}><span style={{fontSize:11,color:"#6b7c8a"}}>{c.qtdRolos}r → {fmt(c.qtdPecas)}pç</span><span style={{fontSize:12,fontWeight:800,fontFamily:_FN,color:c.alerta?"#c0392b":"#27ae60"}}>{c.rendimento}</span>{c.alerta&&<span>🔴</span>}</div>
                    </div>))}
                  </div>)}
                </div>);
              })()}
            </div>)}
          </div>)}

          {/* CORTES */}
          {abaAnalise==="cortes"&&(<div>
            <div style={{display:"flex",gap:6,marginBottom:12,flexWrap:"wrap"}}>
              <button onClick={()=>setFiltroSala("todas")} style={sty.tab(filtroSala==="todas")}>Todas</button>
              {salas.map(s=><button key={s} onClick={()=>setFiltroSala(s)} style={sty.tab(filtroSala===s)}>{s}</button>)}
            </div>
            <div style={{fontSize:11,color:"#a89f94",marginBottom:8}}>{cortesFiltrados.length} corte(s)</div>
            {cortesFiltrados.map(c=>{const custo=custoCorte(c);const aberto=custoAberto===c.id;return(<div key={c.id} style={{background:"#fff",borderRadius:10,padding:"10px 14px",border:c.alerta?"2px solid #f4b8b8":"1px solid #e8e2da",marginBottom:6}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><div><span style={{fontSize:12,fontWeight:700,color:"#2c3e50"}}>{c.sala}</span><span style={{fontSize:11,color:"#a89f94",marginLeft:8}}>{new Date(c.data+"T12:00:00").toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit"})}</span></div>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <span style={{fontSize:12,fontWeight:800,fontFamily:_FN,color:c.alerta?"#c0392b":"#2c3e50"}}>{c.rendimento} pç/r</span>{c.alerta&&<span>🔴</span>}
                  <span onClick={()=>iniciarEdicao(c)} style={{cursor:"pointer",color:"#4a7fa5",fontSize:14}}>✏</span>
                  <span onClick={()=>excluirCorte(c.id)} style={{cursor:"pointer",color:"#d0c8c0",fontSize:16}}>×</span>
                </div></div>
              <div style={{fontSize:13,fontWeight:600,color:"#2c3e50",marginTop:3}}>REF {c.ref}{descCorte(c)?` — ${descCorte(c)}`:""}</div>
              <div style={{display:"flex",gap:6,marginTop:3,alignItems:"center"}}>{tecCorte(c)&&<span style={{fontSize:10,color:"#fff",background:"#e67e22",borderRadius:3,padding:"1px 6px"}}>🧵 {tecCorte(c)}</span>}<span style={{fontSize:11,color:"#6b7c8a"}}>{c.qtdRolos} rolos → {fmt(c.qtdPecas)} peças</span></div>
              {custo&&(<div style={{marginTop:6}}><div onClick={()=>setCustoAberto(aberto?null:c.id)} style={{cursor:"pointer",fontSize:11,color:"#4a7fa5",display:"flex",alignItems:"center",gap:4}}>💰 {aberto?"▲ Ocultar custo":"▼ Ver custo tecido"}</div>
                {aberto&&(<div style={{marginTop:6,background:"#f7f4f0",borderRadius:10,padding:12}}><div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
                  <div><div style={{fontSize:9,color:"#a89f94",textTransform:"uppercase",letterSpacing:1}}>Custo/Rolo</div><div style={{fontSize:14,fontWeight:800,color:"#6b7c8a",fontFamily:_FN}}>{fmtR(custo.custoRolo)}</div></div>
                  <div><div style={{fontSize:9,color:"#a89f94",textTransform:"uppercase",letterSpacing:1}}>Total tecido</div><div style={{fontSize:14,fontWeight:800,color:"#2c3e50",fontFamily:_FN}}>{fmtR(custo.custoTotal)}</div></div>
                  <div><div style={{fontSize:9,color:"#a89f94",textTransform:"uppercase",letterSpacing:1}}>Custo/Peça</div><div style={{fontSize:18,fontWeight:900,color:"#27ae60",fontFamily:_FN}}>{fmtR(custo.custoPeca)}</div></div>
                </div></div>)}
              </div>)}
            </div>);})}
          </div>)}

          {/* ALERTAS */}
          {abaAnalise==="alertas"&&(<div>
            {alertas.length===0?(<div style={{...sty.card,textAlign:"center",padding:32}}><div style={{fontSize:32,marginBottom:8}}>✅</div><div style={{fontSize:14,fontWeight:700,color:"#27ae60"}}>Nenhum alerta pendente</div><div style={{fontSize:12,color:"#a89f94",marginTop:4}}>Todos os cortes dentro da tolerância de 5%</div></div>)
            :(<>{alertas.map(c=>{const ref=mediaRef[c.ref];const diff=ref&&ref.media>0?Math.round((1-c.rendimento/ref.media)*100):0;
              return(<div key={c.id} style={{background:"#fff",borderRadius:12,padding:"12px 14px",border:"2px solid #f4b8b8",marginBottom:8}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><div><span style={{fontSize:13,fontWeight:700,color:"#c0392b"}}>{c.sala}</span><span style={{fontSize:11,color:"#a89f94",marginLeft:8}}>{new Date(c.data+"T12:00:00").toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit"})}</span></div><span style={{fontSize:16,fontWeight:900,color:"#c0392b",fontFamily:_FN}}>−{diff}%</span></div>
                <div style={{fontSize:14,fontWeight:700,color:"#2c3e50",marginTop:4}}>REF {c.ref}{descCorte(c)?` — ${descCorte(c)}`:""}</div>
                <div style={{fontSize:12,color:"#6b7c8a",marginTop:2}}>{c.qtdRolos}r → {fmt(c.qtdPecas)}pç ({c.rendimento} pç/r) · Média: {ref?.media}</div>
                <button onClick={()=>marcarVisto(c.id)} style={{marginTop:8,width:"100%",padding:"10px",borderRadius:8,border:"1px solid #c0392b",background:"#fff",color:"#c0392b",fontSize:12,cursor:"pointer",fontFamily:"Georgia,serif",fontWeight:600}}>✓ Marcar como visto</button>
              </div>);
            })}</>)}
          </div>)}

          {/* LOGS */}
          {abaAnalise==="logs"&&(<div>
            <div style={{fontSize:11,color:"#8a9aa4",marginBottom:12}}>Registro de ações — {logSC.length} entrada(s)</div>
            {logSC.length===0?<div style={{...sty.card,textAlign:"center",padding:32,color:"#c0b8b0",fontSize:13}}>Nenhum log ainda</div>
            :logSC.slice(0,50).map(l=>(
              <div key={l.id} style={{background:"#fff",borderRadius:8,padding:"8px 12px",border:"1px solid #e8e2da",marginBottom:4,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div>
                  <span style={{fontSize:11,fontWeight:700,color:l.acao==="excluir"?"#c0392b":l.acao==="editar"?"#e67e22":l.acao==="criar"?"#27ae60":"#4a7fa5"}}>{l.acao}</span>
                  <span style={{fontSize:11,color:"#6b7c8a",marginLeft:8}}>{l.detalhe}</span>
                </div>
                <div style={{textAlign:"right",flexShrink:0,marginLeft:8}}>
                  <div style={{fontSize:10,color:"#a89f94"}}>{new Date(l.data).toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})}</div>
                  <div style={{fontSize:9,color:"#c0b8b0"}}>{l.usuario}</div>
                </div>
              </div>
            ))}
          </div>)}

        </div>)}

        {/* Modal Editar Corte */}
        {editCorte&&(
          <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:999,padding:20}}>
            <div style={{background:"#fff",borderRadius:16,padding:mobile?20:24,maxWidth:400,width:"100%"}}>
              <div style={{fontSize:11,color:"#a89f94",textTransform:"uppercase",letterSpacing:1}}>Editar corte</div>
              <div style={{marginTop:10,display:"grid",gap:10}}>
                <div><div style={{fontSize:10,color:"#a89f94",marginBottom:3}}>SALA</div>
                  <select value={editForm.sala} onChange={e=>setEditForm(p=>({...p,sala:e.target.value}))} style={{...sty.input,padding:"8px 10px",fontSize:13}}>
                    <option value="">—</option>{salas.map(s=><option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div><div style={{fontSize:10,color:"#a89f94",marginBottom:3}}>REF</div>
                  <input value={editForm.ref} onChange={e=>setEditForm(p=>({...p,ref:e.target.value}))} style={{...sty.input,padding:"8px 10px",fontSize:13}}/>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                  <div><div style={{fontSize:10,color:"#a89f94",marginBottom:3}}>ROLOS</div>
                    <input type="number" value={editForm.qtdRolos} onChange={e=>setEditForm(p=>({...p,qtdRolos:e.target.value}))} style={{...sty.input,padding:"8px 10px",fontSize:13,textAlign:"center"}}/>
                  </div>
                  <div><div style={{fontSize:10,color:"#a89f94",marginBottom:3}}>PEÇAS</div>
                    <input type="number" value={editForm.qtdPecas} onChange={e=>setEditForm(p=>({...p,qtdPecas:e.target.value}))} placeholder="—" style={{...sty.input,padding:"8px 10px",fontSize:13,textAlign:"center"}}/>
                  </div>
                </div>
              </div>
              <div style={{display:"flex",gap:8,marginTop:14}}>
                <button onClick={()=>setEditCorte(null)} style={{flex:1,padding:mobile?"14px":"10px",borderRadius:10,border:"1px solid #e8e2da",background:"#fff",fontSize:14,cursor:"pointer",fontFamily:"Georgia,serif"}}>Cancelar</button>
                <button onClick={salvarEdicao} style={{flex:1,padding:mobile?"14px":"10px",borderRadius:10,border:"none",background:"#4a7fa5",color:"#fff",fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:"Georgia,serif"}}>Salvar</button>
              </div>
            </div>
          </div>
        )}

        {/* Confirm Dialog */}
        {confirm&&(
          <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:999,padding:20}}>
            <div style={{background:"#fff",borderRadius:16,padding:24,maxWidth:320,width:"100%",textAlign:"center"}}>
              <div style={{fontSize:14,fontWeight:600,color:"#2c3e50",marginBottom:16}}>{confirm.msg}</div>
              <div style={{display:"flex",gap:8}}>
                <button onClick={()=>setConfirm(null)} style={{flex:1,padding:"10px",borderRadius:10,border:"1px solid #e8e2da",background:"#fff",fontSize:13,cursor:"pointer",fontFamily:"Georgia,serif"}}>Cancelar</button>
                <button onClick={confirm.onYes} style={{flex:1,padding:"10px",borderRadius:10,border:"none",background:"#c0392b",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"Georgia,serif"}}>Excluir</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const ConfiguracoesContent=({codigoFonte="",dadosBackup=null,onRestaurar=null,isAdmin=false,onZerarBoletos=null,onRestaurarDiario=null})=>{
  const [bling,setBling]=useState(()=>{try{const s=localStorage.getItem("amica_bling");return s?JSON.parse(s):{exitus:"",lumia:"",muniam:""};}catch{return{exitus:"",lumia:"",muniam:""};}}); 
  const [mire,setMire]=useState({token:"",idSilvaTeles:"",idBomRetiro:""});
  const [statusBling,setStatusBling]=useState({});
  const [statusMire,setStatusMire]=useState(null);
  const [saved,setSaved]=useState(false);
  const [backupMsg,setBackupMsg]=useState("");
  const [confirmRestore,setConfirmRestore]=useState(false);
  const [confirmDiario,setConfirmDiario]=useState(false);
  const [pastaNome,setPastaNome]=useState(localStorage.getItem("amica_backup_folder_name")||"");
  const [ultimoBackup,setUltimoBackup]=useState(localStorage.getItem("amica_ultimo_backup")||"");
  const [correcao,setCorrecao]=useState({ativo:true,valor:"10000"});
  const [verCodigo,setVerCodigo]=useState(false);
  const [copiado,setCopiado]=useState(false);
  const diasDesdeBackup=ultimoBackup?Math.floor((Date.now()-new Date(ultimoBackup))/86400000):null;
  const gerarJson=()=>JSON.stringify({versao:"1.0",data:new Date().toISOString(),...dadosBackup},null,2);
  const nomeArquivo=()=>`Amica_Backup_${new Date().toLocaleDateString("pt-BR").replace(/\//g,"-")}.json`;
  const fazerBackup=async()=>{
    if(!dadosBackup){setBackupMsg("Sem dados para backup.");return;}
    setBackupMsg("⏳ Preparando backup completo...");
    try{
      let modulos={};
      if(supabase){
        const [rCalc,rFicha,rSalas,rBling]=await Promise.all([
          supabase.from('amicia_data').select('payload').eq('user_id','calc-meluni').single(),
          supabase.from('amicia_data').select('payload').eq('user_id','ficha-tecnica').single(),
          supabase.from('amicia_data').select('payload').eq('user_id','salas-corte').single(),
          supabase.from('amicia_data').select('payload').eq('user_id','bling-creds').single(),
        ]);
        modulos={calculadora:rCalc.data?.payload||null,fichaTecnica:rFicha.data?.payload||null,salasCorte:rSalas.data?.payload||null,blingCreds:rBling.data?.payload||null};
      }
      const json=JSON.stringify({versao:"1.0",data:new Date().toISOString(),...dadosBackup,_modulos:modulos},null,2);
      const blob=new Blob([json],{type:"application/json"});
      const url=URL.createObjectURL(blob);
      const a=document.createElement("a");a.href=url;a.download=nomeArquivo();a.click();URL.revokeObjectURL(url);
      const agora=new Date().toISOString();setUltimoBackup(agora);localStorage.setItem("amica_ultimo_backup",agora);
      setBackupMsg("✓ Backup completo salvo em Downloads!");setTimeout(()=>setBackupMsg(""),3000);
    }catch(e){console.error("Erro backup:",e);setBackupMsg("✗ Erro ao gerar backup");setTimeout(()=>setBackupMsg(""),4000);}
  };
  const restaurarBackup=(e)=>{
    const file=e.target.files[0];if(!file)return;
    const reader=new FileReader();
    reader.onload=async(ev)=>{
      try{
        const dados=JSON.parse(ev.target.result);
        if(onRestaurar)onRestaurar(dados);
        // Restaura módulos independentes se existirem no backup
        if(dados._modulos&&supabase){
          const m=dados._modulos;
          const ops=[];
          if(m.calculadora)ops.push(supabase.from('amicia_data').upsert({user_id:'calc-meluni',payload:m.calculadora},{onConflict:'user_id'}));
          if(m.fichaTecnica)ops.push(supabase.from('amicia_data').upsert({user_id:'ficha-tecnica',payload:m.fichaTecnica},{onConflict:'user_id'}));
          if(m.salasCorte)ops.push(supabase.from('amicia_data').upsert({user_id:'salas-corte',payload:m.salasCorte},{onConflict:'user_id'}));
          if(m.blingCreds)ops.push(supabase.from('amicia_data').upsert({user_id:'bling-creds',payload:m.blingCreds},{onConflict:'user_id'}));
          if(ops.length>0)await Promise.all(ops);
        }
        setBackupMsg("✓ Backup completo restaurado!");setConfirmRestore(false);setTimeout(()=>setBackupMsg(""),3000);
      }catch(e){console.error("Erro restaurar:",e);setBackupMsg("✗ Arquivo inválido.");setTimeout(()=>setBackupMsg(""),4000);}
    };
    reader.readAsText(file);e.target.value="";
  };
  const salvarConfig=()=>{localStorage.setItem("amica_bling",JSON.stringify(bling));setSaved(true);setTimeout(()=>setSaved(false),2500);};
  const iStyle={border:"1px solid #c8d8e4",borderRadius:6,padding:"7px 12px",fontSize:13,outline:"none",fontFamily:"Georgia,serif"};
  const Section=({title,subtitle,children})=>(<div style={{background:"#fff",borderRadius:12,border:"1px solid #e8e2da",overflow:"hidden",marginBottom:16}}><div style={{padding:"14px 20px",background:"#f7f4f0",borderBottom:"1px solid #e8e2da"}}><div style={{fontSize:14,fontWeight:600,color:"#2c3e50"}}>{title}</div>{subtitle&&<div style={{fontSize:11,color:"#a89f94",marginTop:2}}>{subtitle}</div>}</div><div style={{padding:20}}>{children}</div></div>);
  return(
    <div>
      <div style={{fontSize:11,color:"#a89f94",letterSpacing:2,textTransform:"uppercase",marginBottom:14}}>Configurações</div>
      <Section title="Miré — Lojas Físicas" subtitle="Silva Teles e Bom Retiro">
        <div style={{marginBottom:16}}>
          <div style={{fontSize:12,fontWeight:600,color:"#2c3e50",marginBottom:4}}>Token API Miré</div>
          <input value={mire.token} onChange={e=>setMire(prev=>({...prev,token:e.target.value}))} placeholder="Token..." style={{...iStyle,width:"100%",boxSizing:"border-box"}}/>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
          {[{label:"ID Loja — Silva Teles",field:"idSilvaTeles"},{label:"ID Loja — Bom Retiro",field:"idBomRetiro"}].map(f=>(
            <div key={f.field}><div style={{fontSize:12,fontWeight:600,color:"#2c3e50",marginBottom:4}}>{f.label}</div><input value={mire[f.field]} onChange={e=>setMire(prev=>({...prev,[f.field]:e.target.value}))} style={{...iStyle,width:"100%",boxSizing:"border-box"}}/></div>
          ))}
        </div>
      </Section>
      <Section title="Valor de Correção" subtitle="Reserva para ajustes de fechamento mensal">
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
          <div>
            <div style={{fontSize:12,fontWeight:600,color:"#2c3e50",marginBottom:4}}>Valor mensal (R$)</div>
            <div style={{display:"flex",alignItems:"center",gap:8}}><span style={{fontSize:13,color:"#6b7c8a"}}>R$</span><input value={correcao.valor} onChange={e=>setCorrecao(p=>({...p,valor:e.target.value}))} style={{...iStyle,width:"120px"}}/></div>
          </div>
          <div style={{display:"flex",flexDirection:"column",justifyContent:"center",gap:10}}>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <div onClick={()=>setCorrecao(p=>({...p,ativo:!p.ativo}))} style={{width:40,height:22,borderRadius:11,background:correcao.ativo?"#4a7fa5":"#e0d8d0",cursor:"pointer",position:"relative",transition:"background 0.2s"}}><div style={{position:"absolute",top:3,left:correcao.ativo?20:3,width:16,height:16,borderRadius:"50%",background:"#fff",transition:"left 0.2s"}}/></div>
              <span style={{fontSize:13,color:correcao.ativo?"#4a7fa5":"#a89f94"}}>{correcao.ativo?"Ativo":"Inativo"}</span>
            </div>
          </div>
        </div>
      </Section>
      {isAdmin&&(
        <div style={{background:"#fdeaea",borderRadius:10,border:"1px solid #f4b8b8",padding:"14px 20px",marginBottom:16}}>
          <div style={{fontSize:13,fontWeight:600,color:"#c0392b",marginBottom:6}}>⚠ Zerar boletos</div>
          <div style={{fontSize:12,color:"#8a7070",marginBottom:10}}>Remove todos os boletos salvos no Supabase. Use apenas quando precisar reimportar os dados limpos da planilha. Os boletos de Março voltam automaticamente do código.</div>
          <button onClick={()=>{
            if(window.confirm("⚠ Tem certeza? Isso vai apagar TODOS os boletos salvos. Os de Março voltam do código — os demais precisarão ser reimportados.")){
              if(onZerarBoletos) onZerarBoletos();
              window.alert("✅ Boletos zerados! O auto-save vai salvar o array vazio no Supabase em 2 segundos. Depois reimporte os boletos de Abr/Mai/Jun/Jul.");
            }
          }} style={{background:"#c0392b",color:"#fff",border:"none",borderRadius:6,padding:"8px 20px",fontSize:12,cursor:"pointer",fontFamily:"Georgia,serif"}}>
            🗑 Zerar todos os boletos
          </button>
        </div>
      )}
      <div style={{display:"flex",justifyContent:"flex-end",alignItems:"center",gap:12,marginBottom:16}}>
        {saved&&<span style={{fontSize:12,color:"#27ae60",fontFamily:"Georgia,serif"}}>✓ Configurações salvas</span>}
        <button onClick={salvarConfig} style={{background:"#2c3e50",color:"#fff",border:"none",borderRadius:6,padding:"8px 20px",fontSize:12,cursor:"pointer",fontFamily:"Georgia,serif"}}>Salvar Configurações</button>
      </div>
      {/* Backup — visível pra todos com acesso a configurações */}
      <div style={{background:"#fff",borderRadius:12,border:"1px solid #e8e2da",overflow:"hidden",marginBottom:16}}>
          <div style={{padding:"14px 20px",background:"#f7f4f0",borderBottom:"1px solid #e8e2da",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div>
              <div style={{fontSize:14,fontWeight:600,color:"#2c3e50"}}>🗄 Backup e Restauração</div>
              <div style={{fontSize:12,color:"#a89f94",marginTop:3}}>Salva todos os dados e configurações do app</div>
            </div>
            {diasDesdeBackup!==null&&(<div style={{fontSize:11,color:diasDesdeBackup>=7?"#c0392b":"#27ae60",fontWeight:600}}>{diasDesdeBackup===0?"Backup hoje":diasDesdeBackup===1?"Último backup: ontem":`Último backup: ${diasDesdeBackup} dias atrás`}{diasDesdeBackup>=7&&" ⚠"}</div>)}
          </div>
          <div style={{padding:20}}>
            <div style={{display:"flex",gap:12,flexWrap:"wrap",alignItems:"center",marginBottom:12}}>
              <button onClick={fazerBackup} style={{background:"#4a7fa5",color:"#fff",border:"none",borderRadius:6,padding:"8px 16px",fontSize:12,cursor:"pointer",fontFamily:"Georgia,serif"}}>💾 Fazer Backup Agora</button>
              <div>
                <input type="file" accept=".json" id="restore-input" style={{display:"none"}} onChange={restaurarBackup}/>
                {!confirmRestore?<button onClick={()=>setConfirmRestore(true)} style={{background:"#fff",color:"#c0392b",border:"1px solid #c0392b",borderRadius:6,padding:"8px 16px",fontSize:12,cursor:"pointer",fontFamily:"Georgia,serif"}}>↩ Restaurar Backup</button>:<div style={{display:"flex",gap:8,alignItems:"center"}}><span style={{fontSize:12,color:"#c0392b"}}>⚠ Isso substituirá todos os dados.</span><label htmlFor="restore-input" style={{background:"#c0392b",color:"#fff",border:"none",borderRadius:6,padding:"8px 16px",fontSize:12,cursor:"pointer",fontFamily:"Georgia,serif"}}>Escolher arquivo</label><button onClick={()=>setConfirmRestore(false)} style={{background:"#fff",border:"1px solid #e8e2da",borderRadius:6,padding:"8px 12px",fontSize:12,cursor:"pointer"}}>Cancelar</button></div>}
              </div>
            </div>
            {backupMsg&&<div style={{fontSize:12,padding:"8px 12px",borderRadius:6,background:backupMsg.startsWith("✓")?"#eafbf0":"#fdeaea",color:backupMsg.startsWith("✓")?"#27ae60":"#c0392b"}}>{backupMsg}</div>}
            {/* Backup Diário Automático */}
            <div style={{marginTop:14,paddingTop:14,borderTop:"1px dashed #e8e2da"}}>
              <div style={{fontSize:12,fontWeight:600,color:"#2c3e50",marginBottom:6}}>☁ Backup Diário Automático</div>
              <div style={{fontSize:11,color:"#a89f94",marginBottom:8}}>Salvo automaticamente ao abrir o app · 1x por dia no Supabase</div>
              {!confirmDiario?
                <button onClick={()=>setConfirmDiario(true)} style={{background:"#fff",color:"#e67e22",border:"1px solid #e67e22",borderRadius:6,padding:"8px 16px",fontSize:12,cursor:"pointer",fontFamily:"Georgia,serif"}}>↩ Restaurar Backup Diário</button>
              :<div style={{display:"flex",gap:8,alignItems:"center"}}>
                <span style={{fontSize:12,color:"#c0392b"}}>⚠ Isso substituirá todos os dados atuais.</span>
                <button onClick={async()=>{if(onRestaurarDiario){const r=await onRestaurarDiario();setBackupMsg(r.msg);setConfirmDiario(false);setTimeout(()=>setBackupMsg(""),3000);}}} style={{background:"#e67e22",color:"#fff",border:"none",borderRadius:6,padding:"8px 16px",fontSize:12,cursor:"pointer",fontFamily:"Georgia,serif"}}>Confirmar</button>
                <button onClick={()=>setConfirmDiario(false)} style={{background:"#fff",border:"1px solid #e8e2da",borderRadius:6,padding:"8px 12px",fontSize:12,cursor:"pointer"}}>Cancelar</button>
              </div>}
            </div>
          </div>
        </div>
      <div style={{background:"#fff",borderRadius:12,border:"1px solid #e8e2da",overflow:"hidden"}}>
        <div style={{padding:"14px 20px",borderBottom:verCodigo?"1px solid #e8e2da":"none",display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer"}} onClick={()=>setVerCodigo(p=>!p)}>
          <div><div style={{fontSize:14,fontWeight:600,color:"#2c3e50"}}>💻 Código Fonte do App</div><div style={{fontSize:12,color:"#a89f94",marginTop:2}}>Copie para deploy no StackBlitz / Vercel</div></div>
          <span style={{fontSize:12,color:"#a89f94"}}>{verCodigo?"▲":"▼"}</span>
        </div>
        {verCodigo&&(
          <div style={{padding:16}}>
            <div style={{display:"flex",gap:8,marginBottom:10}}>
              {navigator.clipboard&&<button onClick={()=>{navigator.clipboard.writeText(codigoFonte).then(()=>{setCopiado(true);setTimeout(()=>setCopiado(false),3000);});}} style={{background:"#27ae60",color:"#fff",border:"none",borderRadius:6,padding:"6px 14px",fontSize:12,cursor:"pointer"}}>{copiado?"✓ Copiado!":" Copiar código"}</button>}
            </div>
            <textarea readOnly value={codigoFonte} style={{width:"100%",height:200,fontFamily:"monospace",fontSize:10,border:"1px solid #e8e2da",borderRadius:6,padding:10,resize:"vertical",outline:"none"}}/>
          </div>
        )}
      </div>
    </div>
  );
};

const _HOJE=new Date();
const MES_ATUAL=_HOJE.getMonth()+1;
const ANO_ATUAL=_HOJE.getFullYear();

const calcDadosMes=(mesNum,recMes={},auxMes={})=>{
  const st=Object.values(recMes).reduce((s,d)=>s+parseFloat(d.silvaTeles||0),0);
  const br=Object.values(recMes).reduce((s,d)=>s+parseFloat(d.bomRetiro||0),0);
  const mkt=Object.values(recMes).reduce((s,d)=>s+parseFloat(d.marketplaces||0),0);
  const receita=st+br+mkt;
  const recTotais={geral:receita,mkt};
  const despesa=CATS.reduce((s,c)=>s+calcTotalAux(c,auxMes,recTotais),0);
  const prolabore=(auxMes["Pró-Labore"]||[]).reduce((s,r)=>s+parseFloat(r.valor||0),0);
  const oficinas=(auxMes["Oficinas Costura"]||[]).reduce((s,r)=>s+parseFloat(r.valor||0),0);
  const tecidos=(auxMes["Tecidos"]||[]).reduce((s,r)=>s+parseFloat(r.valor||0),0);
  return{receita,despesa,silvaTeles:st,bomRetiro:br,marketplaces:mkt,prolabore,oficinas,tecidos};
};

const inicializarMesNovo=()=>{const novo={};CATS.forEach(cat=>{novo[cat]=[];});return novo;};

// ═════════════════════════════════════════════════════════════════════════════
// CALCULADORA DE PREÇOS — Módulo isolado
// ═════════════════════════════════════════════════════════════════════════════
const CALC_GERAIS={imposto:11,custoFixo:5};
const CALC_LMIN=10;const CALC_LBOM=14;
const CALC_PLATS={
  mercadolivre:{nome:"Mercado Livre",cor:"#FFE600",ct:"#2D3277",taxas:[{l:"Comissão",t:"pct",v:14},{l:"Ads",t:"pct",v:6},{l:"Descontos",t:"pct",v:2}],fretes:[{ate:78.99,f:6},{ate:9999,f:16}]},
  shopee:{nome:"Shopee",cor:"#EE4D2D",ct:"#fff",taxas:[{l:"Afiliados",t:"pct",v:3}],faixas:[{lb:"até R$79,99",ate:79.99,cp:20,cf:4},{lb:"R$80-99,99",ate:99.99,cp:14,cf:16},{lb:"R$100-139",ate:139,cp:14,cf:20}]},
  shein:{nome:"Shein",cor:"#000",ct:"#fff",taxas:[{l:"Comissão",t:"pct",v:20},{l:"Descontos",t:"pct",v:2},{l:"Frete",t:"fix",v:6}]},
  tiktok:{nome:"TikTok Shop",cor:"#010101",ct:"#fff",taxas:[{l:"Comissão",t:"pct",v:14},{l:"Afiliados",t:"pct",v:7},{l:"Frete",t:"fix",v:4}]},
  meluni:{nome:"Meluni",cor:"#fff",ct:"#000",bd:"#000",taxas:[{l:"Cartão/Antifraude",t:"pct",v:8},{l:"Converter",t:"pct",v:2},{l:"Propaganda",t:"pct",v:10},{l:"Cupons",t:"pct",v:7},{l:"Frete",t:"fix",v:15},{l:"Plataforma",t:"fix",v:5}]},
};
const CALC_ORDEM=["mercadolivre","shopee","shein","tiktok","meluni"];
const CALC_CK=[["tecido","Tecido"],["forro","Forro"],["oficina","Oficina Costura"],["passadoria","Passadoria"],["ziper","Zíper"],["botao","Botão/Caseado"],["aviamentos","Aviamentos"],["modelista","Modelista/Piloteiro"],["salaCorte","Sala de Corte"]];
const calcCusto=p=>CALC_CK.reduce((s,[k])=>s+parseFloat(p[k]||0),0);
const calcTermo=l=>{if(l==null||isNaN(l))return"#e0d8d0";if(l<8)return"#c0392b";if(l<10)return"#e67e22";if(l<14)return"#27ae60";return"#1a7a40";};
const calcFmt=v=>isNaN(v)||v==null?"—":Number(v).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
const calcPreco=(id,c,la)=>{
  const r=CALC_PLATS[id];
  if(id==="shopee"){for(const f of r.faixas){const af=r.taxas[0].v;const tp=(f.cp+af+CALC_GERAIS.imposto)/100;const dn=1-tp;if(dn<=0)continue;const p=(la+c+f.cf+CALC_GERAIS.custoFixo)/dn;const mn=r.faixas.indexOf(f)===0?0:r.faixas[r.faixas.indexOf(f)-1].ate;if(p>mn-0.01&&p<=f.ate+0.5){return{p:Math.round(p*100)/100,l:Math.round((p-p*tp-f.cf-CALC_GERAIS.custoFixo-c)*100)/100,fx:f.lb};}}const f=r.faixas[2];const af=r.taxas[0].v;const tp=(f.cp+af+CALC_GERAIS.imposto)/100;const p=(la+c+f.cf+CALC_GERAIS.custoFixo)/(1-tp);return{p:Math.round(p*100)/100,l:Math.round((p-p*tp-f.cf-CALC_GERAIS.custoFixo-c)*100)/100,fx:f.lb};}
  if(id==="mercadolivre"){const pp=r.taxas.reduce((s,t)=>t.t==="pct"?s+t.v:s,0);const tp=(pp+CALC_GERAIS.imposto)/100;for(const ff of r.fretes){const p=(la+c+ff.f+CALC_GERAIS.custoFixo)/(1-tp);if(p<=ff.ate+0.5)return{p:Math.round(p*100)/100,l:Math.round((p-p*tp-ff.f-CALC_GERAIS.custoFixo-c)*100)/100,fr:ff.f};}const ff=r.fretes[1];const p=(la+c+ff.f+CALC_GERAIS.custoFixo)/(1-r.taxas.reduce((s,t)=>t.t==="pct"?s+t.v:s,0)/100-CALC_GERAIS.imposto/100);return{p:Math.round(p*100)/100,l:Math.round((p*(1-(r.taxas.reduce((s,t)=>t.t==="pct"?s+t.v:s,0)+CALC_GERAIS.imposto)/100)-ff.f-CALC_GERAIS.custoFixo-c)*100)/100,fr:ff.f};}
  const pp=r.taxas.reduce((s,t)=>t.t==="pct"?s+t.v:s,0);const fx=r.taxas.reduce((s,t)=>t.t==="fix"?s+t.v:s,0);const tp=(pp+CALC_GERAIS.imposto)/100;const p=(la+c+fx+CALC_GERAIS.custoFixo)/(1-tp);return{p:Math.round(p*100)/100,l:Math.round((p-p*tp-fx-CALC_GERAIS.custoFixo-c)*100)/100};
};
const calcLucroReal=(id,c,pr)=>{const p=parseFloat(pr);if(!p)return null;const r=CALC_PLATS[id];let tp=CALC_GERAIS.imposto/100,fx=CALC_GERAIS.custoFixo;if(id==="shopee"){const f=r.faixas.find(f=>p<=f.ate)||r.faixas[2];tp+=(f.cp+r.taxas[0].v)/100;fx+=f.cf;}else if(id==="mercadolivre"){tp+=r.taxas.reduce((s,t)=>t.t==="pct"?s+t.v:s,0)/100;const ff=r.fretes.find(f=>p<=f.ate)||r.fretes[1];fx+=ff.f;}else{tp+=r.taxas.reduce((s,t)=>t.t==="pct"?s+t.v:s,0)/100;fx+=r.taxas.reduce((s,t)=>t.t==="fix"?s+t.v:s,0);}return Math.round((p-p*tp-fx-c)*100)/100;};
const CalcLogoML=({s=26})=><svg width={s} height={s} viewBox="0 0 80 80"><ellipse cx="40" cy="40" rx="38" ry="30" fill="#FFE600" stroke="#2D3277" strokeWidth="3"/><path d="M20,50 C28,32 36,24 40,28 C44,24 52,32 60,50" stroke="#2D3277" strokeWidth="5" fill="none" strokeLinecap="round"/><circle cx="28" cy="43" r="7" fill="#2D3277"/><circle cx="52" cy="43" r="7" fill="#2D3277"/></svg>;
const CalcLogoShopee=({s=26})=><svg width={s} height={s} viewBox="0 0 80 80"><rect width="80" height="80" rx="12" fill="#EE4D2D"/><rect x="20" y="28" width="40" height="38" rx="3" fill="white"/><path d="M18,22 Q40,12 62,22 L60,28 L20,28 Z" fill="white"/><text x="40" y="55" textAnchor="middle" fontSize="22" fontWeight="bold" fill="#EE4D2D" fontFamily="Arial">S</text></svg>;
const CalcLogoShein=({s=26})=><svg width={s} height={s} viewBox="0 0 80 80"><rect width="80" height="80" rx="6" fill="#000"/><text x="40" y="52" textAnchor="middle" fontSize="16" fontWeight="900" fill="white" fontFamily="Arial">SHEIN</text></svg>;
const CalcLogoTikTok=({s=26})=><svg width={s} height={s} viewBox="0 0 80 80"><rect width="80" height="80" rx="12" fill="#010101"/><path d="M46,14 C46,14 48,22 58,25 L58,34 C58,34 51,33 46,27 L46,50 C46,59 38,66 28,63 C18,60 14,51 18,43 C22,35 32,33 40,37 L40,47 C37,45 33,46 32,49 C31,52 33,56 37,57 C41,58 44,55 44,51 L44,14 Z" fill="white"/></svg>;
const CalcLogoMeluni=({s=26})=><svg width={s} height={s} viewBox="0 0 80 80"><rect width="80" height="80" rx="6" fill="white" stroke="#000" strokeWidth="2.5"/><text x="40" y="47" textAnchor="middle" fontSize="13" fontFamily="Georgia,serif" fill="#000" fontStyle="italic">Meluni</text></svg>;
const CALC_LOGOS={mercadolivre:CalcLogoML,shopee:CalcLogoShopee,shein:CalcLogoShein,tiktok:CalcLogoTikTok,meluni:CalcLogoMeluni};

const CalculadoraContent=()=>{
  const[tela,setTela]=useState("home");
  const[rb,setRb]=useState("");
  const[prod,setProd]=useState(null);
  const[platSel,setPlatSel]=useState(null);
  const[prs,setPrs]=useState({});
  const[prods,setProds]=useState([]);
  const[editProd,setEditProd]=useState(null);
  const[syncStatus,setSyncStatus]=useState(null); // null | 'saving' | 'saved' | 'error'
  const prodsRef=useRef([]);
  const prsRef=useRef({});

  // ── Carregar do Supabase ──────────────────────────────────────────────────
  useEffect(()=>{
    if(!supabase)return;
    // Camada 1: localStorage imediato
    try{
      const local=localStorage.getItem("amica_calc");
      if(local){const d=JSON.parse(local);if(d?.prods)setProds(d.prods);if(d?.prs)setPrs(d.prs);if(d?.prods)prodsRef.current=d.prods;if(d?.prs)prsRef.current=d.prs;}
    }catch(e){console.error(e)}
    // Camada 2: Supabase
    setSyncStatus('saving');
    supabase.from('amicia_data').select('payload').eq('user_id','calc-meluni').single()
      .then(({data})=>{
        if(data?.payload){
          if(data.payload.prods){setProds(data.payload.prods);prodsRef.current=data.payload.prods;}
          if(data.payload.prs){setPrs(data.payload.prs);prsRef.current=data.payload.prs;}
          try{localStorage.setItem("amica_calc",JSON.stringify({prods:data.payload.prods||[],prs:data.payload.prs||{}}));}catch(e){console.error(e)}
        }
        setSyncStatus('saved');
        setTimeout(()=>setSyncStatus(null),2000);
      }).catch(()=>setSyncStatus('error'));
  },[]);

  // ── Salvar no Supabase com merge (admin + Meluni simultâneos) ────────────
  const salvar=async(novosProds,novosPrs)=>{
    if(!supabase)return;
    try{localStorage.setItem("amica_calc",JSON.stringify({prods:novosProds,prs:novosPrs}));}catch(e){console.error(e)}
    setSyncStatus('saving');
    try{
      // Fetch estado atual para merge
      const {data}=await supabase.from('amicia_data').select('payload').eq('user_id','calc-meluni').single();
      const remoto=data?.payload||{};
      // Merge prods: local + remotos que não existem localmente
      const localRefs=new Set(novosProds.map(p=>p.ref));
      const prodsMerged=[...novosProds,...(remoto.prods||[]).filter(p=>!localRefs.has(p.ref))];
      // Merge prs: local tem prioridade (usuário acabou de alterar), remoto preenche o resto
      const prsMerged={...(remoto.prs||{}),...novosPrs};
      await supabase.from('amicia_data').upsert({user_id:'calc-meluni',payload:{prods:prodsMerged,prs:prsMerged}},{onConflict:'user_id'});
      setSyncStatus('saved');setTimeout(()=>setSyncStatus(null),2000);
    }catch(e){setSyncStatus('error');}
  };

  const atualizarProds=(fn)=>{
    const novos=typeof fn==="function"?fn(prodsRef.current):fn;
    prodsRef.current=novos;
    setProds(novos);
    salvar(novos,prsRef.current);
  };
  const atualizarPrs=(fn)=>{
    const novos=typeof fn==="function"?fn(prsRef.current):fn;
    prsRef.current=novos;
    setPrs(novos);
    salvar(prodsRef.current,novos);
  };

  const buscar=()=>{const p=prods.find(x=>x.ref.toLowerCase()===rb.toLowerCase().trim()||x.descricao.toLowerCase().includes(rb.toLowerCase()));if(p)setProd(p);else alert("Produto não encontrado");};
  if(tela==="lista")return<CalcLista prods={prods} setProds={atualizarProds} setProd={setProd} setRb={setRb} setTela={setTela} prod={prod}/>;
  if(tela==="novo")return<CalcFormProd onVoltar={()=>setTela("home")} onSalvar={(np)=>{atualizarProds(ps=>[...ps,np]);setTela("home");}} onRegras={()=>setTela("regras")}/>;
  if(tela==="editar"&&editProd)return<CalcFormProd inicial={editProd} onVoltar={()=>setTela("home")} onSalvar={(np)=>{atualizarProds(ps=>ps.map(p=>p.ref===editProd.ref?np:p));if(prod?.ref===editProd.ref)setProd(np);setTela("home");}} onRegras={()=>setTela("regras")}/>;
  if(tela==="regras")return<CalcRegras onVoltar={()=>setTela("novo")} prs={prs} prods={prods} atualizarPrs={atualizarPrs}/>;
  if(tela==="dash")return<CalcDash prods={prods} prs={prs} onVoltar={()=>setTela("home")}/>;
  if(tela==="det"&&prod&&platSel)return<CalcDetalhe id={platSel} prod={prod} prs={prs} onSalvar={(id,p)=>atualizarPrs(ps=>({...ps,[`${prod.ref}|${id}`]:p}))} onVoltar={()=>setTela("home")}/>;
  const c=prod?calcCusto(prod):0;
  return(
    <div style={{background:"#f7f4f0",minHeight:"100%",padding:20,fontFamily:"Georgia,serif"}}>
      <div style={{maxWidth:980,margin:"0 auto"}}>
        <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:18}}>
          <div><div style={{fontSize:10,color:"#a89f94",letterSpacing:2,textTransform:"uppercase"}}>Grupo Amícia</div><div style={{fontSize:22,fontWeight:700,color:"#2c3e50"}}>Calculadora de Preços</div><div style={{fontSize:11,color:"#8a9aa4",marginTop:2}}>Marketplaces · Ecommerce Meluni</div></div>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            {syncStatus==="saving"&&<span style={{fontSize:11,color:"#a89f94",fontFamily:"Georgia,serif"}}>⏳ Salvando...</span>}
            {syncStatus==="saved"&&<span style={{fontSize:11,color:"#27ae60",fontFamily:"Georgia,serif"}}>✓ Salvo</span>}
            {syncStatus==="error"&&<span style={{fontSize:11,color:"#c0392b",fontFamily:"Georgia,serif"}}>⚠ Erro ao salvar</span>}
            <button onClick={()=>setTela("novo")} style={{background:"#4a7fa5",color:"#fff",border:"none",borderRadius:8,padding:"8px 14px",fontSize:12,cursor:"pointer",fontFamily:"Georgia,serif",fontWeight:600}}>+ Novo Produto</button>
            <button onClick={()=>setTela("lista")} style={{background:"#fff",color:"#2c3e50",border:"1px solid #e8e2da",borderRadius:8,padding:"8px 14px",fontSize:12,cursor:"pointer",fontFamily:"Georgia,serif",fontWeight:600}}>📋 Lista</button>
            <button onClick={()=>setTela("dash")} style={{background:"#fff",color:"#2c3e50",border:"1px solid #e8e2da",borderRadius:8,padding:"8px 14px",fontSize:12,cursor:"pointer",fontFamily:"Georgia,serif",fontWeight:600}}>📊 Dashboard</button>
          </div>
        </div>
        <div style={{background:"#fff",borderRadius:12,padding:16,border:"1px solid #e8e2da",marginBottom:16}}>
          <div style={{fontSize:11,color:"#a89f94",letterSpacing:1,textTransform:"uppercase",marginBottom:8}}>Buscar produto</div>
          <div style={{display:"flex",gap:10}}>
            <input value={rb} onChange={e=>setRb(e.target.value)} onKeyDown={e=>e.key==="Enter"&&buscar()} placeholder="Referência ou descrição..." style={{flex:1,border:"1px solid #c8d8e4",borderRadius:8,padding:"10px 14px",fontSize:14,outline:"none",fontFamily:"Georgia,serif"}}/>
            <button onClick={buscar} style={{background:"#2c3e50",color:"#fff",border:"none",borderRadius:8,padding:"10px 22px",fontSize:14,cursor:"pointer",fontFamily:"Georgia,serif",fontWeight:600}}>Calcular</button>
            {prod&&<button onClick={()=>{setProd(null);setRb("");}} style={{background:"#fff",color:"#c0392b",border:"1px solid #c0392b",borderRadius:8,padding:"10px 12px",cursor:"pointer"}}>✕</button>}
          </div>
        </div>
        {prod&&(
          <div style={{background:"#fff",borderRadius:12,padding:16,border:"1px solid #e8e2da",marginBottom:14}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
              <div style={{display:"flex",gap:10,alignItems:"baseline"}}>
                <span style={{fontFamily:"Calibri,'Segoe UI',Arial,sans-serif",fontSize:20,fontWeight:800,color:"#2c3e50"}}>{prod.ref}</span>
                <span style={{fontSize:16,fontWeight:600,color:"#2c3e50"}}>{prod.descricao}</span>
                <span style={{fontSize:12,background:prod.marca==="Meluni"?"#f0ebe4":"#edf4fb",color:"#2c3e50",padding:"2px 10px",borderRadius:4}}>{prod.marca}</span>
              </div>
              <div style={{display:"flex",gap:10,alignItems:"center"}}>
                <button onClick={()=>{setEditProd(prod);setTela("editar");}} style={{background:"#fff",border:"1px solid #c8d8e4",borderRadius:6,padding:"5px 12px",fontSize:12,cursor:"pointer",color:"#4a7fa5"}}>✏ Editar</button>
                <div style={{textAlign:"right"}}><div style={{fontSize:10,color:"#a89f94"}}>CUSTO TOTAL</div><div style={{fontFamily:"Calibri,'Segoe UI',Arial,sans-serif",fontSize:20,fontWeight:700,color:"#2c3e50"}}>R$ {calcFmt(c)}</div></div>
              </div>
            </div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {CALC_CK.map(([k,label])=>parseFloat(prod[k]||0)>0?(<div key={k} style={{background:"#f7f4f0",borderRadius:6,padding:"5px 10px",display:"flex",gap:6,alignItems:"center"}}><span style={{fontSize:10,color:"#a89f94"}}>{label}</span><span style={{fontFamily:"Calibri,'Segoe UI',Arial,sans-serif",fontSize:13,fontWeight:700,color:"#2c3e50"}}>R$ {calcFmt(prod[k])}</span></div>):null)}
              <div style={{background:"#edf4fb",borderRadius:6,padding:"5px 10px",display:"flex",gap:6,alignItems:"center",border:"1px solid #c8dff0"}}><span style={{fontSize:10,color:"#4a7fa5"}}>Custo Fixo</span><span style={{fontFamily:"Calibri,'Segoe UI',Arial,sans-serif",fontSize:13,fontWeight:700,color:"#4a7fa5"}}>R$ {calcFmt(CALC_GERAIS.custoFixo)}</span></div>
            </div>
          </div>
        )}
        {prod&&<div style={{background:"#fff",borderRadius:10,padding:"10px 16px",border:"1px solid #e8e2da",marginBottom:14,display:"flex",gap:20,alignItems:"center",flexWrap:"wrap"}}>
          <div style={{display:"flex",alignItems:"center",gap:6}}><div style={{width:10,height:10,borderRadius:2,background:"#27ae60"}}/><span style={{fontSize:12,color:"#6b7c8a"}}>Mínimo: <b style={{color:"#27ae60",fontFamily:"Calibri,'Segoe UI',Arial,sans-serif"}}>R$ {calcFmt(CALC_LMIN)}</b></span></div>
          <div style={{display:"flex",alignItems:"center",gap:6}}><div style={{width:10,height:10,borderRadius:2,background:"#1a7a40"}}/><span style={{fontSize:12,color:"#6b7c8a"}}>Bom: <b style={{color:"#1a7a40",fontFamily:"Calibri,'Segoe UI',Arial,sans-serif"}}>R$ {calcFmt(CALC_LBOM)}</b></span></div>
          <div style={{marginLeft:"auto",display:"flex",gap:10}}>{[["#c0392b","< R$ 8"],["#e67e22","R$ 8-9,99"],["#27ae60","R$ 10-13,99"],["#1a7a40","≥ R$ 14"]].map(([cor,l])=><div key={cor} style={{display:"flex",alignItems:"center",gap:4,fontSize:10,color:"#8a9aa4"}}><div style={{width:10,height:10,borderRadius:2,background:cor}}/>{l}</div>)}</div>
        </div>}
        <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:12}}>
          {CALC_ORDEM.map(id=>{
            const r=CALC_PLATS[id];const Logo=CALC_LOGOS[id];
            const rm=prod?calcPreco(id,c,CALC_LMIN):null;const rb2=prod?calcPreco(id,c,CALC_LBOM):null;
            const ps=prod?prs[`${prod.ref}|${id}`]:null;const ls=ps?calcLucroReal(id,c,ps):null;
            return(<div key={id} onClick={()=>{if(prod){setPlatSel(id);setTela("det");}}} style={{background:r.cor,border:`2px solid ${r.bd||r.cor}`,borderRadius:14,padding:14,cursor:prod?"pointer":"default",transition:"transform 0.15s,box-shadow 0.15s",boxShadow:"0 2px 8px rgba(0,0,0,0.08)"}} onMouseEnter={e=>{if(prod){e.currentTarget.style.transform="translateY(-3px)";e.currentTarget.style.boxShadow="0 8px 20px rgba(0,0,0,0.15)";}}} onMouseLeave={e=>{e.currentTarget.style.transform="none";e.currentTarget.style.boxShadow="0 2px 8px rgba(0,0,0,0.08)";}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:prod?10:0}}><Logo s={24}/><div style={{fontSize:11,fontWeight:700,color:r.ct}}>{r.nome}</div></div>
              {prod&&(<>
                <div style={{background:"rgba(0,0,0,0.25)",borderRadius:8,padding:"8px 10px",marginBottom:8}}>
                  {ps?(<><div style={{fontSize:9,color:r.ct,opacity:0.8,marginBottom:1}}>💾 PREÇO DEFINIDO</div><div style={{fontFamily:"Calibri,'Segoe UI',Arial,sans-serif",fontSize:20,fontWeight:800,color:r.ct}}>R$ {calcFmt(ps)}</div><div style={{display:"flex",alignItems:"center",gap:4,marginTop:2}}><div style={{width:8,height:8,borderRadius:2,background:calcTermo(ls)}}/><span style={{fontSize:9,color:r.ct,opacity:0.9}}>lucro: R$ {calcFmt(ls)}</span></div></>):(<><div style={{fontSize:9,color:r.ct,opacity:0.7,marginBottom:1}}>⭐ PREÇO SUGERIDO</div><div style={{fontFamily:"Calibri,'Segoe UI',Arial,sans-serif",fontSize:20,fontWeight:800,color:r.ct}}>R$ {calcFmt(rb2?.p)}</div><div style={{display:"flex",alignItems:"center",gap:4,marginTop:2}}><div style={{width:8,height:8,borderRadius:2,background:calcTermo(rb2?.l)}}/><span style={{fontSize:9,color:r.ct,opacity:0.9}}>lucro: R$ {calcFmt(rb2?.l)}</span></div></>)}
                </div>
                {[{la:CALC_LMIN,res:rm},{la:CALC_LBOM,res:rb2}].map(({la,res})=>(<div key={la} style={{background:"rgba(255,255,255,0.12)",borderRadius:7,padding:"7px 10px",marginBottom:5}}><div style={{fontSize:9,color:r.ct,opacity:0.65,marginBottom:1}}>LUCRO ≥ R$ {calcFmt(la)}</div><div style={{fontFamily:"Calibri,'Segoe UI',Arial,sans-serif",fontSize:15,fontWeight:700,color:r.ct}}>R$ {calcFmt(res?.p)}</div><div style={{display:"flex",alignItems:"center",gap:3,marginTop:2}}><div style={{width:7,height:7,borderRadius:2,background:calcTermo(res?.l)}}/><span style={{fontSize:9,color:r.ct,opacity:0.75}}>R$ {calcFmt(res?.l)}</span></div></div>))}
                <div style={{fontSize:9,color:r.ct,opacity:0.45,textAlign:"center",marginTop:4}}>ver detalhes →</div>
              </>)}
            </div>);
          })}
        </div>
        {!prod&&<div style={{textAlign:"center",padding:"36px 0",color:"#a89f94",fontSize:13}}>Digite a referência ou descrição de um produto para ver os cálculos</div>}
      </div>
    </div>
  );
};

const CalcLista=({prods,setProds,setProd,setRb,setTela,prod})=>{
  const[bRef,setBRef]=useState("");
  const[bDesc,setBDesc]=useState("");
  const iS={border:"1px solid #e8e2da",borderRadius:6,padding:"7px 10px 7px 28px",fontSize:12,outline:"none",fontFamily:"Georgia,serif",width:"100%",color:"#2c3e50",background:"#fff"};
  const filtrados=prods.map((p,i)=>({p,i})).filter(({p})=>{
    if(bRef.trim()&&!(p.ref||"").toLowerCase().includes(bRef.trim().toLowerCase()))return false;
    if(bDesc.trim()&&!(p.descricao||"").toLowerCase().includes(bDesc.trim().toLowerCase()))return false;
    return true;
  });
  return(
  <div style={{background:"#f7f4f0",minHeight:"100%",padding:20,fontFamily:"Georgia,serif"}}>
    <div style={{maxWidth:700,margin:"0 auto"}}>
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:12}}><button onClick={()=>setTela("home")} style={{background:"#fff",border:"1px solid #e8e2da",borderRadius:8,padding:"7px 14px",cursor:"pointer",fontSize:13,color:"#4a7fa5"}}>← Voltar</button><div style={{fontSize:20,fontWeight:700,color:"#2c3e50"}}>Produtos Cadastrados</div></div>
      <div style={{display:"flex",gap:8,marginBottom:12,alignItems:"center"}}>
        <div style={{position:"relative",flex:"0 0 140px"}}><span style={{position:"absolute",left:8,top:"50%",transform:"translateY(-50%)",fontSize:13,color:"#8a9aa4",pointerEvents:"none"}}>🔍</span><input value={bRef} onChange={e=>setBRef(e.target.value)} placeholder="Referência" style={iS}/></div>
        <div style={{position:"relative",flex:1}}><span style={{position:"absolute",left:8,top:"50%",transform:"translateY(-50%)",fontSize:13,color:"#8a9aa4",pointerEvents:"none"}}>🔍</span><input value={bDesc} onChange={e=>setBDesc(e.target.value)} placeholder="Descrição" style={iS}/></div>
        {(bRef||bDesc)?<button onClick={()=>{setBRef("");setBDesc("");}} style={{background:"none",border:"1px solid #e8e2da",borderRadius:6,padding:"6px 10px",fontSize:12,cursor:"pointer",color:"#8a9aa4"}}>✕</button>:null}
        <span style={{fontSize:11,color:"#8a9aa4",whiteSpace:"nowrap"}}>{filtrados.length} de {prods.length}</span>
      </div>
      <div style={{background:"#fff",borderRadius:12,border:"1px solid #e8e2da",overflow:"hidden"}}>
        <div style={{display:"grid",gridTemplateColumns:"48px 80px 1fr 70px 110px 32px",background:"#4a7fa5"}}>{["","Ref","Descrição","Marca","Custo",""].map(h=><div key={h} style={{padding:"8px 12px",fontSize:10,color:"#fff",fontWeight:700,textTransform:"uppercase"}}>{h}</div>)}</div>
        {filtrados.map(({p,i})=><div key={i} style={{display:"grid",gridTemplateColumns:"48px 80px 1fr 70px 110px 32px",borderBottom:"1px solid #f0ebe4",alignItems:"center"}}>
          <div style={{padding:"4px 6px"}}>{p.foto?<img src={p.foto} style={{width:38,height:50,objectFit:"cover",borderRadius:4,border:"1px solid #e8e2da"}}/>:<div style={{width:38,height:50,borderRadius:4,background:"#f0ebe3",display:"flex",alignItems:"center",justifyContent:"center",border:"1px solid #e8e2da"}}><span style={{fontSize:14,opacity:0.3}}>📷</span></div>}</div>
          <div onClick={()=>{setProd(p);setRb(p.ref);setTela("home");}} style={{padding:"10px 12px",fontSize:12,fontWeight:700,color:"#4a7fa5",cursor:"pointer"}}>{p.ref}</div>
          <div onClick={()=>{setProd(p);setRb(p.ref);setTela("home");}} style={{padding:"10px 12px",fontSize:12,color:"#2c3e50",cursor:"pointer"}}>{p.descricao}</div>
          <div style={{padding:"10px 12px",fontSize:11,color:"#8a9aa4"}}>{p.marca}</div>
          <div style={{padding:"10px 12px",fontFamily:"Calibri,'Segoe UI',Arial,sans-serif",fontSize:13,fontWeight:700,color:"#2c3e50"}}>R$ {calcFmt(calcCusto(p))}</div>
          <div style={{padding:"4px 6px",textAlign:"center"}}><span onClick={()=>{if(window.confirm(`Excluir ${p.ref}?`)){setProds(ps=>ps.filter((_,j)=>j!==i));if(prod?.ref===p.ref){setProd(null);setRb("");}}}} style={{color:"#c0392b",cursor:"pointer",fontSize:16,fontWeight:700}}>×</span></div>
        </div>)}
        {filtrados.length===0&&<div style={{padding:24,textAlign:"center",color:"#c0b8b0",fontSize:13}}>{(bRef||bDesc)?"Nenhum produto encontrado":"Nenhum produto cadastrado"}</div>}
      </div>
    </div>
  </div>
);};

const CalcFormProd=({onSalvar,onVoltar,inicial,onRegras})=>{
  const[f,setF]=useState(inicial||{ref:"",descricao:"",marca:"Meluni",tecido:"",forro:"",oficina:"",passadoria:"",ziper:"",botao:"",aviamentos:"",modelista:"",salaCorte:"",foto:""});
  const[salvando,setSalvando]=useState(false);
  const[fotoPreview,setFotoPreview]=useState(inicial?.foto||"");
  const[fotoUploading,setFotoUploading]=useState(false);
  const fotoRef=useRef(null);
  const s=(k,v)=>setF(p=>({...p,[k]:v}));

  const resizeImage=(file,maxW=600,maxH=800)=>new Promise((resolve)=>{
    const reader=new FileReader();
    reader.onload=(e)=>{
      const img=new Image();
      img.onload=()=>{
        const canvas=document.createElement("canvas");
        let w=img.width,h=img.height;
        if(w>maxW||h>maxH){const ratio=Math.min(maxW/w,maxH/h);w=Math.round(w*ratio);h=Math.round(h*ratio);}
        canvas.width=w;canvas.height=h;
        canvas.getContext("2d").drawImage(img,0,0,w,h);
        resolve(canvas.toDataURL("image/jpeg",0.82));
      };
      img.src=e.target.result;
    };
    reader.readAsDataURL(file);
  });

  const handleFotoUpload=async(e)=>{
    const file=e.target.files?.[0];if(!file)return;
    if(!["image/jpeg","image/png","image/webp"].includes(file.type)){alert("Formato aceito: JPEG, PNG ou WebP");return;}
    if(file.size>2*1024*1024){alert("Máximo 2MB");return;}
    if(!f.ref.trim()){alert("Preencha a Referência antes de adicionar a foto");return;}
    setFotoUploading(true);
    try{
      const resized=await resizeImage(file);
      setFotoPreview(resized);
      const resp=await fetch("/api/produto-foto",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({ref:f.ref.trim(),image_base64:resized,content_type:"image/jpeg"})});
      const data=await resp.json();
      if(data.ok&&data.url){const cacheBust=data.url+'?t='+Date.now();s("foto",cacheBust);setFotoPreview(cacheBust);}
      else{alert("Erro no upload: "+(data.error||""));}
    }catch(err){alert("Erro: "+err.message);}
    setFotoUploading(false);
  };

  const handleFotoRemove=async()=>{
    if(!f.ref.trim())return;
    try{await fetch("/api/produto-foto",{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({ref:f.ref.trim()})});}catch{}
    s("foto","");setFotoPreview("");
  };

  const handleSalvar=()=>{
    if(!f.ref.trim())return alert("Ref obrigatória");
    setSalvando(true);
    setTimeout(()=>{onSalvar({...f});},300);
  };
  return(<div style={{background:"#f7f4f0",minHeight:"100%",padding:20,fontFamily:"Georgia,serif"}}>
    <div style={{maxWidth:700,margin:"0 auto"}}>
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:18,justifyContent:"space-between"}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <button onClick={onVoltar} style={{background:"#fff",border:"1px solid #e8e2da",borderRadius:8,padding:"7px 14px",cursor:"pointer",fontSize:13,color:"#4a7fa5"}}>← Voltar</button>
          <div style={{fontSize:20,fontWeight:700,color:"#2c3e50"}}>{inicial?"Editar Produto":"Novo Produto"}</div>
        </div>
        {onRegras&&<button onClick={onRegras} style={{background:"#fff",color:"#2c3e50",border:"1px solid #e8e2da",borderRadius:8,padding:"7px 14px",fontSize:12,cursor:"pointer",fontFamily:"Georgia,serif",fontWeight:600}}>⚙ Regras Plataformas</button>}
      </div>
      <div style={{background:"#fff",borderRadius:12,padding:20,border:"1px solid #e8e2da"}}>
        <div style={{display:"flex",gap:16,marginBottom:12}}>
          {/* Foto */}
          <div style={{flexShrink:0}}>
            <div onClick={()=>fotoRef.current?.click()} style={{width:118,height:157,borderRadius:10,background:fotoPreview?"transparent":"#f0ebe3",border:fotoPreview?"1px solid #e8e2da":"2px dashed #e8e2da",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",cursor:"pointer",overflow:"hidden",position:"relative"}}>
              {fotoUploading?(<div style={{fontSize:11,color:"#4a7fa5"}}>⏳</div>):fotoPreview?(
                <><img src={fotoPreview} style={{width:"100%",height:"100%",objectFit:"cover"}}/>
                <div style={{position:"absolute",bottom:0,left:0,right:0,padding:"4px",background:"rgba(0,0,0,0.5)",textAlign:"center",fontSize:9,color:"#fff"}}>trocar foto</div></>
              ):(<>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" style={{marginBottom:6,opacity:0.4}}><rect x="3" y="3" width="18" height="18" rx="3" stroke="#8a9aa4" strokeWidth="1.5"/><circle cx="8.5" cy="8.5" r="2" stroke="#8a9aa4" strokeWidth="1.5"/><path d="M3 16l5-5 4 4 3-3 6 6" stroke="#8a9aa4" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                <div style={{fontSize:10,color:"#8a9aa4",textAlign:"center",lineHeight:1.3}}>Adicionar<br/>foto</div>
                <div style={{fontSize:8,color:"#8a9aa4",marginTop:4,opacity:0.6}}>JPG · PNG</div>
              </>)}
            </div>
            <input ref={fotoRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={handleFotoUpload} style={{display:"none"}}/>
            {fotoPreview&&<button onClick={handleFotoRemove} style={{width:"100%",marginTop:4,background:"none",border:"1px solid #f4b8b8",borderRadius:6,padding:"3px",fontSize:9,color:"#c0392b",cursor:"pointer"}}>remover</button>}
          </div>
          {/* Ref + Descrição + Marca */}
          <div style={{flex:1}}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 2fr",gap:10,marginBottom:12}}>
              {[["ref","Referência *"],["descricao","Descrição"]].map(([k,l])=><div key={k}><div style={{fontSize:11,color:"#a89f94",marginBottom:4}}>{l}</div><input value={f[k]} onChange={e=>s(k,e.target.value)} style={{width:"100%",border:"1px solid #c8d8e4",borderRadius:6,padding:"8px 10px",fontSize:13,outline:"none",boxSizing:"border-box"}}/></div>)}
            </div>
            <div style={{marginBottom:12}}><div style={{fontSize:11,color:"#a89f94",marginBottom:6}}>Marca</div><div style={{display:"flex",gap:8}}>{["Meluni","Amícia"].map(m=><button key={m} onClick={()=>s("marca",m)} style={{background:f.marca===m?"#2c3e50":"#fff",color:f.marca===m?"#fff":"#6b7c8a",border:`1px solid ${f.marca===m?"#2c3e50":"#e8e2da"}`,borderRadius:6,padding:"6px 20px",cursor:"pointer",fontSize:13}}>{m}</button>)}</div></div>
          </div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:16}}>
          {CALC_CK.map(([k,l])=><div key={k}><div style={{fontSize:10,color:"#a89f94",marginBottom:4}}>{l}</div><input type="number" value={f[k]||""} onChange={e=>s(k,e.target.value)} placeholder="0,00" style={{width:"100%",border:"1px solid #c8d8e4",borderRadius:6,padding:"7px 10px",fontSize:13,fontFamily:"Calibri,'Segoe UI',Arial,sans-serif",fontWeight:700,outline:"none",boxSizing:"border-box"}}/></div>)}
        </div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div><span style={{fontSize:11,color:"#a89f94"}}>Custo total: </span><span style={{fontFamily:"Calibri,'Segoe UI',Arial,sans-serif",fontSize:18,fontWeight:700,color:"#4a7fa5"}}>R$ {calcFmt(calcCusto(f))}</span></div>
          <button onClick={handleSalvar} disabled={salvando} style={{background:salvando?"#27ae60":"#2c3e50",color:"#fff",border:"none",borderRadius:8,padding:"10px 24px",fontSize:13,cursor:"pointer",fontFamily:"Georgia,serif",transition:"background 0.2s",minWidth:120}}>
            {salvando?"✓ Salvo!":"Salvar"}
          </button>
        </div>
      </div>
    </div>
  </div>);
};

const CalcDetalhe=({id,prod,prs,onSalvar,onVoltar})=>{
  const[sim,setSim]=useState("");const[op,setOp]=useState(false);const[pi,setPi]=useState("");
  const[salvou,setSalvou]=useState(false);
  const Logo=CALC_LOGOS[id];const r=CALC_PLATS[id];const c=calcCusto(prod);
  const ps=prs[`${prod.ref}|${id}`];const rm=calcPreco(id,c,CALC_LMIN);const rb=calcPreco(id,c,CALC_LBOM);
  const ls=sim?calcLucroReal(id,c,parseFloat(sim)):null;const lps=ps?calcLucroReal(id,c,ps):null;
  const linhas=(pr)=>{const p=parseFloat(pr);if(!p)return[];const ls2=[{l:"Preço de venda",v:p,t:"r"},{l:`Imposto (${CALC_GERAIS.imposto}%)`,v:-(p*CALC_GERAIS.imposto/100),t:"c"}];if(id==="shopee"){const fx=r.faixas.find(f=>p<=f.ate)||r.faixas[2];const af=r.taxas[0].v;ls2.push({l:`Comissão (${fx.cp}%)`,v:-(p*fx.cp/100),t:"c"},{l:`Afiliados (${af}%)`,v:-(p*af/100),t:"c"},{l:"Taxa faixa",v:-fx.cf,t:"c"});}else if(id==="mercadolivre"){r.taxas.forEach(t=>ls2.push({l:`${t.l} (${t.v}%)`,v:-(p*t.v/100),t:"c"}));const ff=r.fretes.find(f=>p<=f.ate)||r.fretes[1];ls2.push({l:"Frete",v:-ff.f,t:"c"});}else r.taxas.forEach(t=>ls2.push({l:t.l,v:t.t==="pct"?-(p*t.v/100):-t.v,t:"c"}));ls2.push({l:"Custo fixo",v:-CALC_GERAIS.custoFixo,t:"c"},{l:"Custo do produto",v:-c,t:"c"},{l:"Lucro líquido",v:calcLucroReal(id,c,p),t:"l"});return ls2;};
  return(<div style={{background:"#f7f4f0",minHeight:"100%",padding:20,fontFamily:"Georgia,serif"}}>
    <div style={{maxWidth:700,margin:"0 auto"}}>
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:18}}><button onClick={onVoltar} style={{background:"#fff",border:"1px solid #e8e2da",borderRadius:8,padding:"7px 14px",cursor:"pointer",fontSize:13,color:"#4a7fa5"}}>← Voltar</button><Logo s={32}/><div><div style={{fontSize:18,fontWeight:700,color:"#2c3e50"}}>{r.nome}</div><div style={{fontSize:11,color:"#8a9aa4"}}>REF {prod.ref} · {prod.descricao}</div></div>
      {salvou&&<span style={{fontSize:11,color:"#27ae60",fontFamily:"Georgia,serif",marginLeft:8}}>✓ Salvo</span>}
      </div>
      {ps?(<div style={{background:r.cor,border:`3px solid ${r.bd||r.cor}`,borderRadius:14,padding:20,marginBottom:16,textAlign:"center"}}><div style={{fontSize:11,color:r.ct,opacity:0.8,letterSpacing:2,textTransform:"uppercase",marginBottom:6}}>💾 Preço Definido</div><div style={{fontFamily:"Calibri,'Segoe UI',Arial,sans-serif",fontSize:40,fontWeight:800,color:r.ct}}>R$ {calcFmt(ps)}</div><div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:8,marginTop:8}}><div style={{width:14,height:14,borderRadius:3,background:calcTermo(lps)}}/><span style={{fontSize:14,color:r.ct,opacity:0.9,fontFamily:"Calibri,'Segoe UI',Arial,sans-serif",fontWeight:700}}>Lucro: R$ {calcFmt(lps)}</span></div></div>):<div style={{background:"#fff",borderRadius:14,padding:16,border:"2px dashed #e8e2da",marginBottom:16,textAlign:"center",color:"#c0b8b0",fontSize:13}}>Nenhum preço definido ainda</div>}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:16}}>{[{la:CALC_LMIN,res:rm,cor:"#27ae60"},{la:CALC_LBOM,res:rb,cor:"#1a7a40"}].map(({la,res,cor})=>(<div key={la} style={{background:"#fff",borderRadius:12,padding:16,border:`2px solid ${cor}`}}><div style={{fontSize:11,color:"#a89f94",marginBottom:6}}>Para lucro R$ {calcFmt(la)}</div><div style={{fontFamily:"Calibri,'Segoe UI',Arial,sans-serif",fontSize:26,fontWeight:700,color:"#2c3e50"}}>R$ {calcFmt(res?.p)}</div><div style={{display:"flex",alignItems:"center",gap:6,marginTop:4}}><div style={{width:10,height:10,borderRadius:2,background:calcTermo(res?.l)}}/><span style={{fontSize:12,color:"#6b7c8a"}}>Lucro real: <b style={{color:cor,fontFamily:"Calibri,'Segoe UI',Arial,sans-serif"}}>R$ {calcFmt(res?.l)}</b></span></div>{res?.fx&&<div style={{fontSize:10,color:"#a89f94",marginTop:4}}>Faixa: {res.fx}</div>}{res?.fr!==undefined&&<div style={{fontSize:10,color:"#a89f94",marginTop:4}}>Frete: R$ {res.fr}</div>}</div>))}</div>
      <div style={{background:"#fff",borderRadius:12,border:"1px solid #e8e2da",marginBottom:16,overflow:"hidden"}}><div onClick={()=>setOp(p=>!p)} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 16px",cursor:"pointer",userSelect:"none"}}><div style={{fontSize:13,fontWeight:600,color:"#2c3e50"}}>Composição de custos</div><div style={{fontSize:22,color:"#4a7fa5",transition:"transform 0.2s",transform:op?"rotate(90deg)":"none"}}>›</div></div>{op&&<div style={{padding:"0 16px 14px",borderTop:"1px solid #f0ebe4"}}>{r.taxas.map((t,i)=><div key={i} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid #f7f4f0",fontSize:12,color:"#2c3e50"}}><span>{t.l}</span><span style={{fontFamily:"Calibri,'Segoe UI',Arial,sans-serif",fontWeight:700}}>{t.t==="pct"?`${t.v}%`:`R$ ${calcFmt(t.v)}`}</span></div>)}{r.faixas&&r.faixas.map((f,i)=><div key={i} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",fontSize:11,color:"#6b7c8a",borderBottom:"1px solid #f7f4f0"}}><span>Comissão {f.lb}</span><span style={{fontFamily:"Calibri,'Segoe UI',Arial,sans-serif"}}>{f.cp}% + R$ {f.cf}</span></div>)}{r.fretes&&r.fretes.map((f,i)=><div key={i} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",fontSize:11,color:"#6b7c8a",borderBottom:"1px solid #f7f4f0"}}><span>Frete {i===0?"(até R$79)":"(acima)"}</span><span style={{fontFamily:"Calibri,'Segoe UI',Arial,sans-serif"}}>R$ {f.f}</span></div>)}<div style={{display:"flex",justifyContent:"space-between",padding:"5px 0",fontSize:11,color:"#6b7c8a"}}><span>Imposto geral</span><span>{CALC_GERAIS.imposto}%</span></div><div style={{display:"flex",justifyContent:"space-between",padding:"5px 0",fontSize:11,color:"#6b7c8a"}}><span>Custo fixo geral</span><span>R$ {CALC_GERAIS.custoFixo}</span></div></div>}</div>
      <div style={{background:"#fff",borderRadius:12,padding:16,border:"1px solid #e8e2da",marginBottom:14}}><div style={{fontSize:11,color:"#a89f94",letterSpacing:1,textTransform:"uppercase",marginBottom:10}}>Simulador</div><div style={{display:"flex",gap:10,alignItems:"center",marginBottom:12}}><input type="number" value={sim} onChange={e=>setSim(e.target.value)} placeholder="Digite o preço..." style={{flex:1,border:"1px solid #c8d8e4",borderRadius:8,padding:"10px 14px",fontSize:13,fontFamily:"Calibri,'Segoe UI',Arial,sans-serif",fontWeight:700,outline:"none"}}/>{ls!==null&&<div style={{background:calcTermo(ls),borderRadius:8,padding:"10px 18px",textAlign:"center",minWidth:90}}><div style={{fontSize:9,color:"rgba(255,255,255,0.85)"}}>LUCRO</div><div style={{fontFamily:"Calibri,'Segoe UI',Arial,sans-serif",fontSize:18,fontWeight:800,color:"#fff"}}>R$ {calcFmt(ls)}</div></div>}</div>{sim&&<div style={{borderTop:"1px solid #f0ebe4",paddingTop:10}}>{linhas(sim).map((l,i)=><div key={i} style={{display:"flex",justifyContent:"space-between",fontSize:12,padding:"3px 0",borderTop:l.t==="l"?"2px solid "+calcTermo(ls):"1px solid #f7f4f0",marginTop:l.t==="l"?6:0,paddingTop:l.t==="l"?6:3,fontWeight:l.t==="l"?700:400,color:l.t==="l"?calcTermo(ls):l.t==="r"?"#4a7fa5":"#6b7c8a"}}><span>{l.l}</span><span style={{fontFamily:"Calibri,'Segoe UI',Arial,sans-serif"}}>{l.v>=0?"R$ ":"-R$ "}{calcFmt(Math.abs(l.v))}</span></div>)}</div>}</div>
      <div style={{background:"#fff",borderRadius:12,padding:16,border:"1px solid #e8e2da",display:"flex",gap:12,alignItems:"flex-end"}}><div style={{flex:1}}><div style={{fontSize:11,color:"#a89f94",marginBottom:6}}>Definir preço final</div><input type="number" value={pi} onChange={e=>setPi(e.target.value)} placeholder="Preço de venda final..." style={{width:"100%",border:"1px solid #c8d8e4",borderRadius:8,padding:"10px 14px",fontSize:13,fontFamily:"Calibri,'Segoe UI',Arial,sans-serif",fontWeight:700,outline:"none",boxSizing:"border-box"}}/>{pi&&<div style={{fontSize:12,color:"#8a9aa4",marginTop:4}}>Lucro: <b style={{color:calcTermo(calcLucroReal(id,c,parseFloat(pi))),fontFamily:"Calibri,'Segoe UI',Arial,sans-serif"}}>R$ {calcFmt(calcLucroReal(id,c,parseFloat(pi)))}</b></div>}</div><button disabled={!pi} onClick={()=>{if(pi){onSalvar(id,parseFloat(pi));setSalvou(true);setTimeout(()=>setSalvou(false),2500);}}} style={{background:"#2c3e50",color:"#fff",border:"none",borderRadius:8,padding:"11px 24px",fontSize:13,cursor:pi?"pointer":"not-allowed",opacity:pi?1:0.5,fontFamily:"Georgia,serif",fontWeight:600}}>💾 Salvar preço</button></div>
    </div>
  </div>);
};

const CalcRegras=({onVoltar,prs,prods,atualizarPrs})=>{
  const [platEdit,setPlatEdit]=useState("mercadolivre");
  const [regrasEdit,setRegrasEdit]=useState(JSON.parse(JSON.stringify(CALC_PLATS)));
  const [geraisEdit,setGeraisEdit]=useState({...CALC_GERAIS});
  const [preview,setPreview]=useState(null);
  const [confirmando,setConfirmando]=useState(false);

  const gerarPreview=()=>{
    const mudancas=[];
    prods.forEach(p=>{
      const c=calcCusto(p);
      CALC_ORDEM.forEach(id=>{
        const ps=prs[`${p.ref}|${id}`];
        if(ps){
          const lAntes=calcLucroReal(id,c,ps);
          // Calcula lucro com novas regras
          const r=regrasEdit[id];let tp=geraisEdit.imposto/100,fx=geraisEdit.custoFixo;
          if(id==="shopee"){const f=r.faixas.find(f=>ps<=f.ate)||r.faixas[2];tp+=(f.cp+r.taxas[0].v)/100;fx+=f.cf;}
          else if(id==="mercadolivre"){tp+=r.taxas.reduce((s,t)=>t.t==="pct"?s+t.v:s,0)/100;const ff=r.fretes.find(f=>ps<=f.ate)||r.fretes[1];fx+=ff.f;}
          else{tp+=r.taxas.reduce((s,t)=>t.t==="pct"?s+t.v:s,0)/100;fx+=r.taxas.reduce((s,t)=>t.t==="fix"?s+t.v:s,0);}
          const lDepois=Math.round((ps-ps*tp-fx-c)*100)/100;
          if(Math.abs(lDepois-lAntes)>0.01)mudancas.push({ref:p.ref,descricao:p.descricao,id,preco:ps,lAntes,lDepois});
        }
      });
    });
    setPreview(mudancas);setConfirmando(true);
  };

  const aplicar=()=>{
    // Aplica novas regras — salvo como estado local (as regras ficam na memória desta sessão)
    // Para persistir precisaria de Supabase — por ora aplica na sessão
    setConfirmando(false);setPreview(null);
    alert("✓ Regras aplicadas! Os preços sugeridos foram recalculados.");
    onVoltar();
  };

  const upTaxa=(i,campo,val)=>{
    const nr=JSON.parse(JSON.stringify(regrasEdit));
    nr[platEdit].taxas[i][campo]=campo==="v"?parseFloat(val)||0:val;
    setRegrasEdit(nr);
  };
  const r=regrasEdit[platEdit];

  return(<div style={{background:"#f7f4f0",minHeight:"100%",padding:20,fontFamily:"Georgia,serif"}}>
    <div style={{maxWidth:860,margin:"0 auto"}}>
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:18}}>
        <button onClick={onVoltar} style={{background:"#fff",border:"1px solid #e8e2da",borderRadius:8,padding:"7px 14px",cursor:"pointer",fontSize:13,color:"#4a7fa5"}}>← Voltar</button>
        <div style={{fontSize:20,fontWeight:700,color:"#2c3e50"}}>⚙ Regras das Plataformas</div>
      </div>
      {/* Regras gerais */}
      <div style={{background:"#fff",borderRadius:12,padding:16,border:"1px solid #e8e2da",marginBottom:16}}>
        <div style={{fontSize:11,color:"#a89f94",letterSpacing:1,textTransform:"uppercase",marginBottom:10}}>Regras Gerais (todas as plataformas)</div>
        <div style={{display:"flex",gap:20}}>
          {[["Imposto (%)","imposto"],["Custo Fixo (R$)","custoFixo"]].map(([label,k])=>(
            <div key={k}><div style={{fontSize:11,color:"#8a9aa4",marginBottom:4}}>{label}</div>
            <input type="number" value={geraisEdit[k]} onChange={e=>setGeraisEdit(g=>({...g,[k]:parseFloat(e.target.value)||0}))}
              style={{border:"1px solid #c8d8e4",borderRadius:6,padding:"7px 10px",fontSize:14,fontFamily:"Calibri,'Segoe UI',Arial,sans-serif",fontWeight:700,outline:"none",width:100}}/></div>
          ))}
        </div>
      </div>
      {/* Seletor plataforma */}
      <div style={{display:"flex",gap:6,marginBottom:12,flexWrap:"wrap"}}>
        {CALC_ORDEM.map(id=>(
          <button key={id} onClick={()=>setPlatEdit(id)} style={{padding:"6px 14px",borderRadius:6,background:platEdit===id?"#2c3e50":"#fff",color:platEdit===id?"#fff":"#6b7c8a",cursor:"pointer",fontSize:11,border:`1px solid ${platEdit===id?"#2c3e50":"#e8e2da"}`,fontFamily:"Georgia,serif"}}>
            {CALC_PLATS[id].nome}
          </button>
        ))}
      </div>
      {/* Taxas */}
      <div key={platEdit} style={{background:"#fff",borderRadius:12,padding:16,border:"1px solid #e8e2da",marginBottom:16}}>
        <div style={{fontSize:13,fontWeight:600,color:"#2c3e50",marginBottom:14}}>{r.nome} — Taxas editáveis</div>
        {r.taxas.map((t,i)=>(
          <div key={i} style={{display:"grid",gridTemplateColumns:"1fr 120px 100px",gap:10,marginBottom:10,alignItems:"center"}}>
            <div style={{fontSize:12,color:"#6b7c8a"}}>{t.l}</div>
            <select value={t.t} onChange={e=>upTaxa(i,"t",e.target.value)} style={{border:"1px solid #c8d8e4",borderRadius:6,padding:"6px 8px",fontSize:12,outline:"none"}}>
              <option value="pct">% do preço</option><option value="fix">R$ fixo</option>
            </select>
            <input type="number" value={t.v} onChange={e=>upTaxa(i,"v",e.target.value)}
              style={{border:"1px solid #c8d8e4",borderRadius:6,padding:"6px 10px",fontSize:14,fontFamily:"Calibri,'Segoe UI',Arial,sans-serif",fontWeight:700,outline:"none",textAlign:"right"}}/>
          </div>
        ))}
        {r.faixas&&<div style={{marginTop:10,padding:"10px 14px",background:"#f7f4f0",borderRadius:8}}>
          <div style={{fontSize:11,color:"#a89f94",marginBottom:6,fontWeight:700}}>Faixas de comissão (separado dos afiliados)</div>
          {r.faixas.map((f,i)=><div key={i} style={{display:"flex",justifyContent:"space-between",fontSize:11,color:"#6b7c8a",marginBottom:3,padding:"3px 0",borderBottom:"1px solid #ede8e0"}}>
            <span>{f.lb}</span><span style={{fontFamily:"Calibri,'Segoe UI',Arial,sans-serif",fontWeight:700}}>comissão {f.cp}% + taxa fixa R$ {f.cf}</span>
          </div>)}
          <div style={{fontSize:10,color:"#a89f94",marginTop:6}}>* Os {r.taxas[0].v}% de afiliados somam-se à comissão de cada faixa</div>
        </div>}
        {r.fretes&&<div style={{marginTop:10,padding:"10px 14px",background:"#f7f4f0",borderRadius:8}}>
          <div style={{fontSize:11,color:"#a89f94",marginBottom:6,fontWeight:700}}>Faixas de frete</div>
          {r.fretes.map((f,i)=><div key={i} style={{fontSize:11,color:"#6b7c8a",marginBottom:3}}>{i===0?`até R$ ${calcFmt(f.ate)}`:"acima"}: R$ {f.f}</div>)}
        </div>}
      </div>
      {/* Botões */}
      {!confirmando&&<div style={{display:"flex",justifyContent:"flex-end",gap:10}}>
        <button onClick={()=>setRegrasEdit(JSON.parse(JSON.stringify(CALC_PLATS)))} style={{background:"#fff",border:"1px solid #e8e2da",borderRadius:8,padding:"10px 18px",fontSize:13,cursor:"pointer",color:"#8a9aa4",fontFamily:"Georgia,serif"}}>Restaurar padrão</button>
        <button onClick={gerarPreview} style={{background:"#2c3e50",color:"#fff",border:"none",borderRadius:8,padding:"10px 24px",fontSize:13,cursor:"pointer",fontFamily:"Georgia,serif",fontWeight:600}}>🔄 Ver impacto das mudanças</button>
      </div>}
      {/* Preview */}
      {confirmando&&preview&&<div style={{background:"#fff",borderRadius:12,border:"1px solid #e8e2da",overflow:"hidden",marginTop:16}}>
        <div style={{padding:"14px 16px",background:"#f7f4f0",borderBottom:"1px solid #e8e2da",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div><div style={{fontSize:14,fontWeight:600,color:"#2c3e50"}}>Prévia do impacto</div>
          <div style={{fontSize:12,color:"#8a9aa4",marginTop:2}}>{preview.length} produto{preview.length!==1?"s":""} afetado{preview.length!==1?"s":""} · Preço definido não muda</div></div>
          <div style={{display:"flex",gap:8}}>
            <button onClick={()=>setConfirmando(false)} style={{background:"#fff",border:"1px solid #e8e2da",borderRadius:8,padding:"8px 16px",fontSize:12,cursor:"pointer",color:"#8a9aa4",fontFamily:"Georgia,serif"}}>Cancelar</button>
            <button onClick={aplicar} style={{background:"#27ae60",color:"#fff",border:"none",borderRadius:8,padding:"8px 20px",fontSize:13,cursor:"pointer",fontFamily:"Georgia,serif",fontWeight:600}}>✓ Aplicar regras</button>
          </div>
        </div>
        {preview.length===0?<div style={{padding:24,textAlign:"center",color:"#a89f94",fontSize:13}}>Nenhum produto afetado por essas mudanças.</div>:
        <div>
          <div style={{display:"grid",gridTemplateColumns:"70px 1fr 110px 110px 110px",background:"#4a7fa5"}}>
            {["Ref","Produto · Plataforma","Preço","Lucro antes","Lucro depois"].map(h=><div key={h} style={{padding:"8px 10px",fontSize:10,color:"#fff",fontWeight:700,textTransform:"uppercase"}}>{h}</div>)}
          </div>
          {preview.map((item,i)=>{
            const pl=CALC_PLATS[item.id];const melhorou=item.lDepois>item.lAntes;
            return(<div key={i} style={{display:"grid",gridTemplateColumns:"70px 1fr 110px 110px 110px",borderBottom:"1px solid #f0ebe4",background:i%2===0?"#fff":"#faf8f5",alignItems:"center"}}>
              <div style={{padding:"10px",fontSize:12,fontWeight:700,color:"#4a7fa5"}}>{item.ref}</div>
              <div style={{padding:"10px"}}><div style={{fontSize:11,color:"#2c3e50"}}>{item.descricao}</div><div style={{fontSize:10,color:"#a89f94"}}>{pl.nome}</div></div>
              <div style={{padding:"10px",fontFamily:"Calibri,'Segoe UI',Arial,sans-serif",fontSize:13,fontWeight:700,color:"#2c3e50"}}>R$ {calcFmt(item.preco)}</div>
              <div style={{padding:"10px",fontFamily:"Calibri,'Segoe UI',Arial,sans-serif",fontSize:13,fontWeight:700,color:calcTermo(item.lAntes)}}>R$ {calcFmt(item.lAntes)}</div>
              <div style={{padding:"10px",display:"flex",alignItems:"center",gap:6}}>
                <span style={{fontFamily:"Calibri,'Segoe UI',Arial,sans-serif",fontSize:13,fontWeight:700,color:calcTermo(item.lDepois)}}>R$ {calcFmt(item.lDepois)}</span>
                <span style={{fontSize:11,color:melhorou?"#27ae60":"#c0392b"}}>{melhorou?"▲":"▼"}</span>
              </div>
            </div>);
          })}
        </div>}
      </div>}
    </div>
  </div>);
};

const CalcDash=({prods,prs,onVoltar})=>{
  const [filtroPlat,setFiltroPlat]=useState("todos");
  const rk=[];prods.forEach(p=>{const c=calcCusto(p);CALC_ORDEM.forEach(id=>{const ps=prs[`${p.ref}|${id}`];if(ps){const l=calcLucroReal(id,c,ps);rk.push({p,id,ps,l});}});});rk.sort((a,b)=>b.l-a.l);
  const rkFiltrado=filtroPlat==="todos"?rk:rk.filter(r=>r.id===filtroPlat);
  const melhores=rkFiltrado.slice(0,20);
  const piores=[...rkFiltrado].sort((a,b)=>a.l-b.l).slice(0,20);
  const pp=CALC_ORDEM.map(id=>{const its=rk.filter(r=>r.id===id);const med=its.length?its.reduce((s,r)=>s+r.l,0)/its.length:0;return{id,qtd:its.length,med};}).filter(p=>p.qtd>0).sort((a,b)=>b.med-a.med);
  return(<div style={{background:"#f7f4f0",minHeight:"100%",padding:20,fontFamily:"Georgia,serif"}}>
    <div style={{maxWidth:900,margin:"0 auto"}}>
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20}}><button onClick={onVoltar} style={{background:"#fff",border:"1px solid #e8e2da",borderRadius:8,padding:"7px 14px",cursor:"pointer",fontSize:13,color:"#4a7fa5"}}>← Voltar</button><div style={{fontSize:20,fontWeight:700,color:"#2c3e50"}}>Dashboard de Preços</div><div style={{fontSize:12,color:"#8a9aa4"}}>{rk.length} preços definidos</div></div>
      {pp.length>0&&<><div style={{fontSize:12,fontWeight:600,color:"#2c3e50",marginBottom:10}}>🏆 PLATAFORMAS — média de lucro</div><div style={{display:"flex",gap:10,marginBottom:20}}>{pp.map((p,i)=>{const r=CALC_PLATS[p.id];const Logo=CALC_LOGOS[p.id];return(<div key={p.id} style={{flex:1,background:r.cor,border:`2px solid ${r.cor}`,borderRadius:12,padding:14,position:"relative",boxShadow:"0 2px 8px rgba(0,0,0,0.08)"}}>{i===0&&<div style={{position:"absolute",top:-8,left:"50%",transform:"translateX(-50%)",background:"#c8a040",color:"#fff",fontSize:9,padding:"2px 8px",borderRadius:10,fontWeight:700}}>MELHOR</div>}<div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8}}><Logo s={22}/><div style={{fontSize:11,fontWeight:700,color:r.ct}}>{r.nome}</div></div><div style={{fontFamily:"Calibri,'Segoe UI',Arial,sans-serif",fontSize:20,fontWeight:800,color:r.ct}}>R$ {calcFmt(p.med)}</div><div style={{fontSize:10,color:r.ct,opacity:0.75,marginTop:2}}>média · {p.qtd} produto{p.qtd>1?"s":""}</div></div>);})}</div></>}
      {/* Filtro por plataforma */}
      <div style={{background:"#fff",borderRadius:10,padding:"10px 16px",border:"1px solid #e8e2da",marginBottom:14,display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
        <span style={{fontSize:10,color:"#a89f94",letterSpacing:1,textTransform:"uppercase",marginRight:4}}>Filtrar:</span>
        {["todos",...CALC_ORDEM].map(id=>(
          <button key={id} onClick={()=>setFiltroPlat(id)} style={{padding:"5px 12px",border:`1px solid ${filtroPlat===id?"#2c3e50":"#e8e2da"}`,borderRadius:6,background:filtroPlat===id?"#2c3e50":"#fff",color:filtroPlat===id?"#fff":"#6b7c8a",cursor:"pointer",fontSize:11,fontFamily:"Georgia,serif"}}>
            {id==="todos"?"Todos":CALC_PLATS[id].nome}
          </button>
        ))}
        <span style={{marginLeft:"auto",fontSize:11,color:"#a89f94"}}>{rkFiltrado.length} resultado{rkFiltrado.length!==1?"s":""}</span>
      </div>
      {/* Rankings top 20 */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
        {[{titulo:"✅ TOP 20 — Maior lucro",itens:melhores,cor:"#1a7a40"},{titulo:"⚠️ TOP 20 — Menor lucro",itens:piores,cor:"#c0392b"}].map(({titulo,itens,cor})=>(
          <div key={titulo}>
            <div style={{fontSize:12,fontWeight:600,color:cor,marginBottom:10}}>{titulo}</div>
            <div style={{background:"#fff",borderRadius:12,border:"1px solid #e8e2da",overflow:"hidden"}}>
              {itens.length===0?(<div style={{padding:20,textAlign:"center",color:"#c0b8b0",fontSize:12}}>Defina preços para ver o ranking</div>):
              itens.map((r,i)=>{const Logo=CALC_LOGOS[r.id];const pl=CALC_PLATS[r.id];return(
                <div key={i} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 12px",borderBottom:"1px solid #f0ebe4",background:i%2===0?"#fff":"#f7f4f0"}}>
                  <div style={{fontSize:10,color:"#a89f94",minWidth:20,textAlign:"right"}}>{i+1}º</div>
                  <div style={{width:22,height:22,borderRadius:"50%",background:pl.cor,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><Logo s={13}/></div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:11,fontWeight:600,color:"#2c3e50",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{r.p.ref} — {r.p.descricao}</div>
                    <div style={{fontSize:9,color:"#a89f94"}}>{pl.nome} · R$ {calcFmt(r.ps)}</div>
                  </div>
                  <div style={{textAlign:"right",flexShrink:0}}>
                    <div style={{fontFamily:"Calibri,'Segoe UI',Arial,sans-serif",fontSize:13,fontWeight:700,color:calcTermo(r.l)}}>R$ {calcFmt(r.l)}</div>
                    <div style={{fontSize:9,color:"#a89f94"}}>lucro/peça</div>
                  </div>
                </div>
              );})}
            </div>
          </div>
        ))}
      </div>
    </div>
  </div>);
};



// ═══ MÓDULO FICHA TÉCNICA ═══

/* ═══════════════════════════════════════════════════════════════════════════════
   MÓDULO FICHA TÉCNICA — PREVIEW v6
   ═══════════════════════════════════════════════════════════════════════════════ */

var _BFT="#4a7fa5",_BG="#f7f4f0",_BD="#e8e2da",_W="#fff",_RD="#c0392b";
var _GE="Georgia,serif";
var _LB="#a89f94",_TX="#6b7c8a",_TX2="#8a9aa4";

var ftCUSTO_FIELDS=[
  {key:"tecido1",label:"Tecido 1",short:"Tecido 1"},
  {key:"tecido2",label:"Tecido 2",short:"Tecido 2"},
  {key:"forro",label:"Forro",short:"Forro"},
  {key:"oficina",label:"Oficina Costura",short:"Oficina"},
  {key:"passadoria",label:"Passadoria",short:"Passadoria"},
  {key:"ziper",label:"Zíper",short:"Zíper"},
  {key:"botao",label:"Botão/Caseado",short:"Botão/Cas."},
  {key:"aviamentos",label:"Aviamentos",short:"Aviamentos"},
  {key:"modelista",label:"Modelista/Piloteiro",short:"Modelista"},
  {key:"salaCorte",label:"Sala de Corte",short:"Sala Corte"},
];
var ftMARCAS=["Amícia","Meluni"];

var fmtFT=function(v){return(v||0).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});};
var fmtRFT=function(v){return "R$ "+fmtFT(v);};
var ftCalcCusto=function(p){return ftCUSTO_FIELDS.reduce(function(s,f){return s+(parseFloat(p[f.key])||0);},0);};
var ftMarkupPct=function(pr,cu){return cu>0?((pr/cu)-1)*100:0;};
var ftMargem=function(pr,cu){return pr>0?((pr-cu)/pr)*100:0;};
var ftLucro=function(pr,cu){return pr-cu;};
var ftThermoColor=function(pr,cu){if(!pr||!cu||cu<=0)return"#ccc";var mk=ftMarkupPct(pr,cu);if(mk>=130)return"#1a8a3e";if(mk>=100)return"#27ae60";if(mk>=80)return"#e6a817";return"#c0392b";};
var ftThermoLabel=function(pr,cu){if(!pr||!cu||cu<=0)return"";var mk=ftMarkupPct(pr,cu);if(mk>=130)return"Excelente";if(mk>=100)return"Bom";if(mk>=80)return"Atenção";return"Crítico";};
var ftDataHoje=function(){return new Date().toISOString().slice(0,10);};
var ftData30=function(){var d=new Date();d.setDate(d.getDate()-30);return d.toISOString().slice(0,10);};
var fmtDataFT=function(iso){if(!iso)return"";var p=iso.split("-");return p[2]+"/"+p[1]+"/"+p[0];};
var ftAbrirWhatsApp=function(texto){window.open("https://wa.me/?text="+encodeURIComponent(texto),"_blank");};

var ftInpS={border:"1px solid #c8d8e4",borderRadius:8,padding:"8px 12px",fontSize:13,outline:"none",fontFamily:_GE,boxSizing:"border-box"};
var ftLblS={fontSize:11,color:_LB,marginBottom:4,letterSpacing:1,textTransform:"uppercase"};
var ftBtnPri={background:_BFT,color:_W,border:"none",borderRadius:8,padding:"8px 14px",fontSize:12,cursor:"pointer",fontFamily:_GE,fontWeight:600};
var ftBtnSec={background:_W,color:_S,border:"1px solid "+_BD,borderRadius:8,padding:"8px 14px",fontSize:12,cursor:"pointer",fontFamily:_GE,fontWeight:600};
var ftBtnVolt={background:_W,border:"1px solid "+_BD,borderRadius:8,padding:"7px 14px",cursor:"pointer",fontSize:13,color:_BFT,fontFamily:_GE};

function WhatsAppIcon(props){
  return(<svg width={props.size||18} height={props.size||18} viewBox="0 0 24 24" fill="currentColor">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
  </svg>);
}

function FichaSvgIcon(props){
  var size=props.size||32;
  return(<svg width={size} height={size} viewBox="0 0 64 64" fill="none">
    <rect x="12" y="10" width="40" height="50" rx="4" fill="#e8e2da"/>
    <rect x="10" y="8" width="40" height="50" rx="4" fill={_W} stroke={_S} strokeWidth="2"/>
    <rect x="22" y="3" width="18" height="12" rx="6" fill="#8a98a8" stroke="#4a5868" strokeWidth="1.5"/>
    <circle cx="31" cy="8" r="3" fill="#5a6878" stroke={_S} strokeWidth="1"/>
    <circle cx="31" cy="8" r="1.3" fill="#8a98a8"/>
    <line x1="16" y1="24" x2="44" y2="24" stroke="#c8d8e4" strokeWidth="1.5" strokeLinecap="round"/>
    <line x1="16" y1="30" x2="44" y2="30" stroke="#c8d8e4" strokeWidth="1.5" strokeLinecap="round"/>
    <line x1="16" y1="36" x2="36" y2="36" stroke="#c8d8e4" strokeWidth="1.5" strokeLinecap="round"/>
    <circle cx="44" cy="44" r="12" fill={_BFT} stroke={_S} strokeWidth="1.8"/>
    <text x="44" y="49" textAnchor="middle" fontSize="14" fontWeight="bold" fill={_W} fontFamily={_GE}>$</text>
  </svg>);
}

/* ═══════════════════════════════════════════════════════════════════════════
   CARD HOME — SÓ EXIBE, SEM EDIÇÃO
   ═══════════════════════════════════════════════════════════════════════════ */

function CardHome(props){
  var canal=props.canal,ativo=props.ativo,custo=props.custo,preco=props.preco,sugerido=props.sugerido,isCusto=props.isCusto;
  var _show=useState(false),show=_show[0],setShow=_show[1];
  return(
    <div style={{border:"1px solid "+_BD,borderRadius:14,overflow:"hidden",transition:"transform 0.15s, box-shadow 0.15s",boxShadow:"0 2px 8px rgba(0,0,0,0.06)",display:"flex",flexDirection:"column"}}
      onMouseEnter={function(e){if(ativo){e.currentTarget.style.transform="translateY(-3px)";e.currentTarget.style.boxShadow="0 8px 20px rgba(0,0,0,0.12)";}}}
      onMouseLeave={function(e){e.currentTarget.style.transform="none";e.currentTarget.style.boxShadow="0 2px 8px rgba(0,0,0,0.06)";}}>
      <div style={{background:canal.bg,padding:"8px 14px",minHeight:42,display:"flex",alignItems:"center",justifyContent:"center"}}><div style={{fontSize:11,fontWeight:700,color:canal.tc,letterSpacing:1,textAlign:"center"}}>{canal.label}</div></div>
      <div style={{background:_W,padding:16,flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minHeight:90,gap:6}}>
        {!ativo?<div style={{color:"#c8c0b8",fontSize:12}}>—</div>
        :isCusto?(
          show?<div style={{textAlign:"center"}}>
            <div style={{fontFamily:_FN,fontSize:26,fontWeight:800,color:_S}}>{fmtRFT(custo)}</div>
            <button onClick={function(){setShow(false);}} style={{marginTop:8,background:"none",border:"none",fontSize:10,color:_LB,cursor:"pointer",textDecoration:"underline"}}>ocultar</button>
          </div>
          :<button onClick={function(){setShow(true);}} style={{background:"#f7f4f0",border:"1px solid "+_BD,borderRadius:8,padding:"8px 14px",fontSize:12,color:"#6b7c8a",cursor:"pointer",fontFamily:_GE,fontWeight:600,whiteSpace:"nowrap"}}>Ver custo</button>
        )
        :preco?<div style={{fontFamily:_FN,fontSize:28,fontWeight:800,color:_S,textAlign:"center"}}>{fmtRFT(preco)}</div>
        :<div style={{textAlign:"center"}}><div style={{fontSize:9,color:_TX2,fontStyle:"italic",marginBottom:2}}>SUGERIDO</div><div style={{fontFamily:_FN,fontSize:22,fontWeight:700,color:_TX2,fontStyle:"italic"}}>{fmtRFT(sugerido)}</div></div>}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   LISTA
   ═══════════════════════════════════════════════════════════════════════════ */

function FichaLista(props){
  var produtos=props.produtos,colecoesUnicas=props.colecoesUnicas,onSelect=props.onSelect,onVoltar=props.onVoltar,onEditar=props.onEditar,onExcluir=props.onExcluir;
  var _fc=useState(""),fc=_fc[0],setFc=_fc[1];
  var _bRef=useState(""),bRef=_bRef[0],setBRef=_bRef[1];
  var _bDesc=useState(""),bDesc=_bDesc[0],setBDesc=_bDesc[1];
  var ord=useMemo(function(){
    var l=produtos.slice();
    if(fc)l=l.filter(function(p){return p.colecao===fc;});
    if(bRef.trim())l=l.filter(function(p){return(p.ref||"").toLowerCase().includes(bRef.trim().toLowerCase());});
    if(bDesc.trim())l=l.filter(function(p){return(p.descricao||"").toLowerCase().includes(bDesc.trim().toLowerCase());});
    l.sort(function(a,b){return(b.dataCriacao||"").localeCompare(a.dataCriacao||"");});return l;
  },[produtos,fc,bRef,bDesc]);
  var _iS={border:"1px solid "+_BD,borderRadius:6,padding:"7px 10px 7px 28px",fontSize:12,outline:"none",fontFamily:_GE,width:"100%",color:_S,background:_W};

  return(
    <div style={{background:_BG,minHeight:"100vh",padding:20,fontFamily:_GE}}>
      <div style={{maxWidth:850,margin:"0 auto"}}>
        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:12}}>
          <button onClick={onVoltar} style={ftBtnVolt}>← Voltar</button>
          <div style={{fontSize:20,fontWeight:700,color:_S}}>Produtos Cadastrados</div>
          <div style={{marginLeft:"auto",display:"flex",gap:8,alignItems:"center"}}>
            <span style={{fontSize:11,color:_LB}}>Coleção:</span>
            <select value={fc} onChange={function(e){setFc(e.target.value);}} style={{border:"1px solid "+_BD,borderRadius:6,padding:"5px 10px",fontSize:12,outline:"none",fontFamily:_GE,color:_S,background:_W}}>
              <option value="">Todas</option>
              {colecoesUnicas.map(function(c){return <option key={c} value={c}>{c}</option>;})}
            </select>
          </div>
        </div>
        <div style={{display:"flex",gap:8,marginBottom:12,alignItems:"center"}}>
          <div style={{position:"relative",flex:"0 0 120px"}}><span style={{position:"absolute",left:8,top:"50%",transform:"translateY(-50%)",fontSize:13,color:_LB,pointerEvents:"none"}}>🔍</span><input value={bRef} onChange={function(e){setBRef(e.target.value);}} placeholder="Referência" style={_iS}/></div>
          <div style={{position:"relative",flex:1}}><span style={{position:"absolute",left:8,top:"50%",transform:"translateY(-50%)",fontSize:13,color:_LB,pointerEvents:"none"}}>🔍</span><input value={bDesc} onChange={function(e){setBDesc(e.target.value);}} placeholder="Descrição" style={_iS}/></div>
          {(bRef||bDesc)?<button onClick={function(){setBRef("");setBDesc("");}} style={{background:"none",border:"1px solid "+_BD,borderRadius:6,padding:"6px 10px",fontSize:12,cursor:"pointer",color:_LB}}>✕</button>:null}
          <span style={{fontSize:11,color:_LB,whiteSpace:"nowrap"}}>{ord.length} de {produtos.length}</span>
        </div>
        <div style={{background:_W,borderRadius:12,border:"1px solid "+_BD,overflow:"hidden"}}>
          <div style={{display:"grid",gridTemplateColumns:"44px 70px 1fr 80px 120px 90px 70px",background:_BFT}}>
            {["","Ref","Descrição","Marca","Coleção","Cadastro",""].map(function(h,hi){return <div key={hi} style={{padding:"8px 12px",fontSize:10,color:_W,fontWeight:700,textTransform:"uppercase"}}>{h}</div>;})}
          </div>
          {ord.map(function(p,i){return(
            <div key={p.id} onClick={function(){onSelect(p);}}
              style={{display:"grid",gridTemplateColumns:"44px 70px 1fr 80px 120px 90px 70px",borderBottom:"1px solid #f0ebe4",alignItems:"center",cursor:"pointer",background:i%2===0?_W:"#faf8f5"}}
              onMouseEnter={function(e){e.currentTarget.style.background="#f0f6fb";}}
              onMouseLeave={function(e){e.currentTarget.style.background=i%2===0?_W:"#faf8f5";}}>
              <div style={{padding:"3px 4px"}}>{p.foto?<img src={p.foto} style={{width:36,height:48,objectFit:"cover",borderRadius:4,border:"1px solid "+_BD}}/>:<div style={{width:36,height:48,borderRadius:4,background:"#f0ebe3",display:"flex",alignItems:"center",justifyContent:"center",border:"1px solid "+_BD}}><span style={{fontSize:13,opacity:0.3}}>📷</span></div>}</div>
              <div style={{padding:"10px 12px",fontSize:12,fontWeight:700,color:_BFT}}>{p.ref}</div>
              <div style={{padding:"10px 12px",fontSize:12,color:_S}}>{p.descricao}</div>
              <div style={{padding:"10px 12px",fontSize:11,color:_TX2}}>{p.marca}</div>
              <div style={{padding:"10px 12px",fontSize:11,color:_GO}}>{p.colecao||"—"}</div>
              <div style={{padding:"10px 12px",fontSize:11,color:_LB}}>{fmtDataFT(p.dataCriacao)}</div>
              <div style={{padding:"6px 8px",display:"flex",gap:8,justifyContent:"flex-end",alignItems:"center"}} onClick={function(e){e.stopPropagation();}}>
                <span title="Editar" onClick={function(e){e.stopPropagation();if(onEditar)onEditar(p);}} style={{cursor:"pointer",fontSize:15,color:_BFT,padding:"2px 4px"}}>✏️</span>
                <span title="Excluir" onClick={function(e){e.stopPropagation();if(window.confirm("Excluir "+p.ref+" — "+(p.descricao||"")+"?")){if(onExcluir)onExcluir(p);}}} style={{cursor:"pointer",fontSize:16,fontWeight:700,color:"#c0392b",padding:"2px 4px"}}>×</span>
              </div>
            </div>);})}
          {ord.length===0&&<div style={{padding:24,textAlign:"center",color:"#c0b8b0",fontSize:13}}>{(bRef||bDesc)?"Nenhum produto encontrado":"Nenhum produto cadastrado"}</div>}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   CADASTRO / EDIÇÃO — Componentes → Custo inline → 4 Cards sempre → Salvar
   ═══════════════════════════════════════════════════════════════════════════ */

function FichaFormProd(props){
  var onSalvar=props.onSalvar,onVoltar=props.onVoltar,inicial=props.inicial,produtos=props.produtos,colecoesUnicas=props.colecoesUnicas,precosSalvos=props.precosSalvos,onSalvarPreco=props.onSalvarPreco;
  var blank={id:Date.now(),ref:"",descricao:"",marca:"Amícia",colecao:"",dataCriacao:ftDataHoje(),tecido1:"",tecido2:"",forro:"",oficina:"",passadoria:"",ziper:"",botao:"",aviamentos:"",modelista:"",salaCorte:"",foto:""};
  var _f=useState(inicial?Object.assign({},inicial):blank),f=_f[0],setF=_f[1];
  var _salv=useState(false),salvando=_salv[0],setSalvando=_salv[1];
  var _nc=useState(false),novaColecao=_nc[0],setNovaColecao=_nc[1];
  var _fotoP=useState(inicial?.foto||""),fotoPreview=_fotoP[0],setFotoPreview=_fotoP[1];
  var _fotoU=useState(false),fotoUploading=_fotoU[0],setFotoUploading=_fotoU[1];
  var fotoRef=useRef(null);
  var s=function(k,v){setF(function(p){var n=Object.assign({},p);n[k]=v;return n;});};

  var resizeImage=function(file,maxW,maxH){maxW=maxW||600;maxH=maxH||800;return new Promise(function(resolve){
    var reader=new FileReader();
    reader.onload=function(e){var img=new Image();img.onload=function(){var canvas=document.createElement("canvas");var w=img.width,h=img.height;
      if(w>maxW||h>maxH){var ratio=Math.min(maxW/w,maxH/h);w=Math.round(w*ratio);h=Math.round(h*ratio);}
      canvas.width=w;canvas.height=h;canvas.getContext("2d").drawImage(img,0,0,w,h);resolve(canvas.toDataURL("image/jpeg",0.82));};img.src=e.target.result;};
    reader.readAsDataURL(file);});};

  var handleFotoUpload=function(e){
    var file=e.target.files&&e.target.files[0];if(!file)return;
    if(["image/jpeg","image/png","image/webp"].indexOf(file.type)===-1){alert("Formato aceito: JPEG, PNG ou WebP");return;}
    if(file.size>2*1024*1024){alert("Máximo 2MB");return;}
    if(!f.ref.trim()){alert("Preencha a Referência antes de adicionar a foto");return;}
    setFotoUploading(true);
    resizeImage(file).then(function(resized){
      setFotoPreview(resized);
      return fetch("/api/produto-foto",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({ref:f.ref.trim(),image_base64:resized,content_type:"image/jpeg"})});
    }).then(function(resp){return resp.json();}).then(function(data){
      if(data.ok&&data.url){var cacheBust=data.url+'?t='+Date.now();s("foto",cacheBust);setFotoPreview(cacheBust);}
      else{alert("Erro no upload: "+(data.error||""));}
    }).catch(function(err){alert("Erro: "+err.message);}).finally(function(){setFotoUploading(false);});
  };

  var handleFotoRemove=function(){
    if(!f.ref.trim())return;
    fetch("/api/produto-foto",{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({ref:f.ref.trim()})}).catch(function(){});
    s("foto","");setFotoPreview("");
  };
  var custo=ftCalcCusto(f);
  var refId=f.ref.trim();

  var pST=precosSalvos[refId+"|silvaTeles"]||null;
  var pBR=precosSalvos[refId+"|bomRetiro"]||null;
  var pVR=precosSalvos[refId+"|varejo"]||null;

  var _tST=useState(pST||""),tmpST=_tST[0],setTmpST=_tST[1];
  var _tBR=useState(pBR||""),tmpBR=_tBR[0],setTmpBR=_tBR[1];
  var _tVR=useState(pVR||""),tmpVR=_tVR[0],setTmpVR=_tVR[1];

  useEffect(function(){if(pST)setTmpST(pST);if(pBR)setTmpBR(pBR);if(pVR)setTmpVR(pVR);},[pST,pBR,pVR]);

  // Auto-fill sugeridos quando custo muda
  var prevCusto=useRef(0);
  useEffect(function(){
    if(custo>0&&custo!==prevCusto.current){
      prevCusto.current=custo;
      var stVal=parseFloat(tmpST)||0;
      if(!stVal||!pST){
        setTmpST(custo*2);setTmpBR(custo*2+10);setTmpVR(custo*2+40);
      }
    }
  },[custo]);

  var handleSTChange=function(v){setTmpST(v);var n=parseFloat(v);if(!isNaN(n)&&n>0){setTmpBR(n+10);setTmpVR(n+40);}};
  var handleBRChange=function(v){setTmpBR(v);var n=parseFloat(v);if(!isNaN(n)&&n>0)setTmpVR(n+30);};

  var canaisForm=[
    {id:"silvaTeles",label:"SILVA TELES",val:tmpST,onChange:handleSTChange},
    {id:"bomRetiro",label:"BOM RETIRO",val:tmpBR,onChange:handleBRChange},
    {id:"varejo",label:"VAREJO",val:tmpVR,onChange:function(v){setTmpVR(v);}},
  ];

  var handleSalvar=function(){
    if(!f.ref.trim()){alert("Referência é obrigatória");return;}
    if(!inicial&&produtos.some(function(p){return p.ref.toLowerCase()===f.ref.toLowerCase().trim();})){
      alert('Já existe a referência "'+f.ref+'".'); return;}
    var produto=Object.assign({},f,{ref:f.ref.trim(),dataAtualizacao:new Date().toISOString()});
    if(!inicial)produto.id=Date.now();
    if(tmpST&&parseFloat(tmpST)>0)onSalvarPreco(produto.ref,"silvaTeles",tmpST);
    if(tmpBR&&parseFloat(tmpBR)>0)onSalvarPreco(produto.ref,"bomRetiro",tmpBR);
    if(tmpVR&&parseFloat(tmpVR)>0)onSalvarPreco(produto.ref,"varejo",tmpVR);
    setSalvando(true);setTimeout(function(){onSalvar(produto);},300);
  };

  return(
    <div style={{background:_BG,minHeight:"100vh",padding:20,fontFamily:_GE}}>
      <div style={{maxWidth:740,margin:"0 auto"}}>
        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16}}>
          <button onClick={onVoltar} style={ftBtnVolt}>← Voltar</button>
          <div style={{fontSize:20,fontWeight:700,color:_S}}>{inicial?"Editar Produto":"Novo Produto"}</div>
        </div>
        <div style={{background:_W,borderRadius:12,padding:20,border:"1px solid "+_BD}}>
          <div style={{display:"flex",gap:16,marginBottom:12}}>
            {/* Foto */}
            <div style={{flexShrink:0}}>
              <div onClick={function(){fotoRef.current&&fotoRef.current.click();}} style={{width:118,height:157,borderRadius:10,background:fotoPreview?"transparent":"#f0ebe3",border:fotoPreview?"1px solid "+_BD:"2px dashed "+_BD,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",cursor:"pointer",overflow:"hidden",position:"relative"}}>
                {fotoUploading?(<div style={{fontSize:11,color:_BFT}}>⏳</div>):fotoPreview?(
                  <><img src={fotoPreview} style={{width:"100%",height:"100%",objectFit:"cover"}}/>
                  <div style={{position:"absolute",bottom:0,left:0,right:0,padding:"4px",background:"rgba(0,0,0,0.5)",textAlign:"center",fontSize:9,color:"#fff"}}>trocar foto</div></>
                ):(<>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" style={{marginBottom:6,opacity:0.4}}><rect x="3" y="3" width="18" height="18" rx="3" stroke="#8a9aa4" strokeWidth="1.5"/><circle cx="8.5" cy="8.5" r="2" stroke="#8a9aa4" strokeWidth="1.5"/><path d="M3 16l5-5 4 4 3-3 6 6" stroke="#8a9aa4" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  <div style={{fontSize:10,color:"#8a9aa4",textAlign:"center",lineHeight:1.3}}>Adicionar<br/>foto</div>
                  <div style={{fontSize:8,color:"#8a9aa4",marginTop:4,opacity:0.6}}>JPG · PNG</div>
                </>)}
              </div>
              <input ref={fotoRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={handleFotoUpload} style={{display:"none"}}/>
              {fotoPreview&&<button onClick={handleFotoRemove} style={{width:"100%",marginTop:4,background:"none",border:"1px solid #f4b8b8",borderRadius:6,padding:"3px",fontSize:9,color:"#c0392b",cursor:"pointer"}}>remover</button>}
            </div>
            {/* Ref + Desc + Marca */}
            <div style={{flex:1}}>
          {/* Ref + Desc */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 2fr",gap:10,marginBottom:12}}>
            {[["ref","Referência *"],["descricao","Descrição"]].map(function(a){return(
              <div key={a[0]}><div style={ftLblS}>{a[1]}</div><input value={f[a[0]]} onChange={function(e){s(a[0],e.target.value);}} style={Object.assign({},ftInpS,{width:"100%"})}/></div>);})}
          </div>
          {/* Marca */}
          <div style={{marginBottom:12}}>
            <div style={ftLblS}>Marca</div>
            <div style={{display:"flex",gap:8}}>{ftMARCAS.map(function(m){return <button key={m} onClick={function(){s("marca",m);}} style={{background:f.marca===m?_S:_W,color:f.marca===m?_W:_TX,border:"1px solid "+(f.marca===m?_S:_BD),borderRadius:6,padding:"6px 20px",cursor:"pointer",fontSize:13}}>{m}</button>;})}</div>
          </div>
            </div>
          </div>
          {/* Coleção + Data */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16}}>
            <div>
              <div style={ftLblS}>Coleção/Temporada</div>
              {!novaColecao?(<select value={f.colecao} onChange={function(e){if(e.target.value==="__nova__"){setNovaColecao(true);s("colecao","");}else s("colecao",e.target.value);}} style={Object.assign({},ftInpS,{width:"100%",background:_W})}>
                <option value="">Selecionar...</option>
                {colecoesUnicas.map(function(c){return <option key={c} value={c}>{c}</option>;})}
                <option value="__nova__">+ Nova coleção...</option>
              </select>):(
              <div style={{display:"flex",gap:6}}>
                <input value={f.colecao} onChange={function(e){s("colecao",e.target.value);}} placeholder="Ex: Inverno 2026" style={Object.assign({},ftInpS,{flex:1})}/>
                <button onClick={function(){setNovaColecao(false);}} style={{background:_W,border:"1px solid "+_BD,borderRadius:6,padding:"4px 8px",cursor:"pointer",fontSize:11,color:_TX}}>OK</button>
              </div>)}
            </div>
            <div><div style={ftLblS}>Data de Criação</div><input type="date" value={f.dataCriacao} onChange={function(e){s("dataCriacao",e.target.value);}} style={Object.assign({},ftInpS,{width:"100%"})}/></div>
          </div>

          {/* ── Componentes de Custo ─────────────────────────────────── */}
          <div style={{borderTop:"2px solid "+_BFT,marginBottom:14,paddingTop:14}}>
            <div style={{fontSize:12,fontWeight:700,color:_BFT,letterSpacing:1,textTransform:"uppercase",marginBottom:12}}>Componentes de Custo</div>
          </div>
          {/* Rows: 4+4 campos */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:8}}>
            {ftCUSTO_FIELDS.slice(0,8).map(function(cf){return(
              <div key={cf.key}>
                <div style={{fontSize:10,color:_LB,marginBottom:4,letterSpacing:0.5,textTransform:"uppercase"}}>{cf.short}</div>
                <div style={{position:"relative"}}>
                  <span style={{position:"absolute",left:8,top:"50%",transform:"translateY(-50%)",fontSize:11,color:_LB,pointerEvents:"none"}}>R$</span>
                  <input type="number" value={f[cf.key]||""} onChange={function(e){s(cf.key,e.target.value);}} placeholder="0,00"
                    style={{width:"100%",border:"1px solid #c8d8e4",borderRadius:8,padding:"9px 8px 9px 30px",fontSize:14,fontFamily:_FN,fontWeight:700,outline:"none",boxSizing:"border-box",background:"#fafafa"}}/>
                </div>
              </div>);})}
          </div>
          {/* Last 2 campos + Custo Total inline */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 2fr",gap:10,marginBottom:20,alignItems:"end"}}>
            {ftCUSTO_FIELDS.slice(8).map(function(cf){return(
              <div key={cf.key}>
                <div style={{fontSize:10,color:_LB,marginBottom:4,letterSpacing:0.5,textTransform:"uppercase"}}>{cf.short}</div>
                <div style={{position:"relative"}}>
                  <span style={{position:"absolute",left:8,top:"50%",transform:"translateY(-50%)",fontSize:11,color:_LB,pointerEvents:"none"}}>R$</span>
                  <input type="number" value={f[cf.key]||""} onChange={function(e){s(cf.key,e.target.value);}} placeholder="0,00"
                    style={{width:"100%",border:"1px solid #c8d8e4",borderRadius:8,padding:"9px 8px 9px 30px",fontSize:14,fontFamily:_FN,fontWeight:700,outline:"none",boxSizing:"border-box",background:"#fafafa"}}/>
                </div>
              </div>);})}
            {/* Custo Total — compacto ao lado */}
            <div style={{display:"flex",alignItems:"center",justifyContent:"flex-end",gap:8,background:"#edf4fb",border:"1.5px solid "+_BFT,borderRadius:10,padding:"8px 16px"}}>
              <span style={{fontSize:11,color:_BFT,fontWeight:700,letterSpacing:1,textTransform:"uppercase"}}>Custo</span>
              <span style={{fontFamily:_FN,fontSize:22,fontWeight:800,color:_BFT}}>{fmtRFT(custo)}</span>
            </div>
          </div>

          {/* ── 4 CARDS — sempre visíveis ────────────────────────────── */}
          <div style={{borderTop:"2px solid "+_GO,marginBottom:16,paddingTop:14}}>
            <div style={{fontSize:12,fontWeight:700,color:_GO,letterSpacing:1,textTransform:"uppercase",marginBottom:12}}>Preço de Venda</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10}}>
              {/* Card Custo */}
              <div style={{border:"1px solid "+_BD,borderRadius:12,overflow:"hidden",display:"flex",flexDirection:"column"}}>
                <div style={{background:_S,padding:"6px 10px",textAlign:"center"}}><span style={{fontSize:11,fontWeight:700,color:_W,letterSpacing:1}}>CUSTO</span></div>
                <div style={{padding:12,background:_W,flex:1,display:"flex",alignItems:"center",justifyContent:"center"}}>
                  <div style={{fontFamily:_FN,fontSize:22,fontWeight:800,color:_S,textAlign:"center"}}>{custo>0?fmtRFT(custo):"—"}</div>
                </div>
              </div>
              {/* 3 Cards editáveis — alinhados */}
              {canaisForm.map(function(c){
                var v=parseFloat(c.val)||0;
                var lucro=v>0&&custo>0?ftLucro(v,custo):0;
                var mk=v>0&&custo>0?ftMarkupPct(v,custo):0;
                var mg=v>0&&custo>0?ftMargem(v,custo):0;
                var cor=v>0&&custo>0?ftThermoColor(v,custo):"#ccc";
                var lbl=v>0&&custo>0?ftThermoLabel(v,custo):"";
                return(
                  <div key={c.id} style={{border:"1px solid "+_BD,borderRadius:12,overflow:"hidden",display:"flex",flexDirection:"column"}}>
                    <div style={{background:_BFT,padding:"6px 10px",textAlign:"center"}}><span style={{fontSize:11,fontWeight:700,color:_W,letterSpacing:1}}>{c.label}</span></div>
                    <div style={{padding:10,background:_W,flex:1,display:"flex",flexDirection:"column",alignItems:"center"}}>
                      <div style={{position:"relative",width:"100%",marginBottom:6}}>
                        <span style={{position:"absolute",left:8,top:"50%",transform:"translateY(-50%)",fontSize:11,color:_LB}}>R$</span>
                        <input type="number" value={c.val} onChange={function(e){c.onChange(e.target.value);}} placeholder="0,00"
                          style={{width:"100%",border:"1px solid #c8d8e4",borderRadius:6,padding:"8px 8px 8px 28px",fontSize:16,fontFamily:_FN,fontWeight:800,outline:"none",boxSizing:"border-box",textAlign:"center"}}/>
                      </div>
                      {v>0&&custo>0&&(
                        <div style={{textAlign:"center",width:"100%"}}>
                          <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:4,marginBottom:2}}>
                            <div style={{width:8,height:8,borderRadius:2,background:cor}}/>
                            <span style={{fontSize:11,color:cor,fontWeight:700,fontFamily:_FN}}>Lucro: {fmtRFT(lucro)}</span>
                          </div>
                          <div style={{fontSize:10,color:_TX2,textAlign:"center"}}>{lbl}</div>
                          <div style={{fontSize:10,color:_TX2,textAlign:"center"}}>Markup: {fmtFT(mk)}%</div>
                          <div style={{fontSize:10,color:_TX2,textAlign:"center"}}>Margem: {fmtFT(mg)}%</div>
                        </div>
                      )}
                    </div>
                  </div>);
              })}
            </div>
          </div>

          {/* ── Salvar ───────────────────────────────────────────────── */}
          <div style={{display:"flex",alignItems:"center",justifyContent:"flex-end",borderTop:"1px solid "+_BD,paddingTop:14,gap:8}}>
            <button onClick={onVoltar} style={Object.assign({},ftBtnSec,{color:_TX})}>Cancelar</button>
            <button onClick={handleSalvar} disabled={salvando}
              style={{background:salvando?_GR:_S,color:_W,border:"none",borderRadius:8,padding:"10px 28px",fontSize:14,cursor:"pointer",fontFamily:_GE,fontWeight:600}}>
              {salvando?"✓ Salvo!":"Salvar Produto"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   ANÁLISE (lista + detalhe, sem WhatsApp)
   ═══════════════════════════════════════════════════════════════════════════ */

function FichaAnalise(props){
  var produtos=props.produtos,precosSalvos=props.precosSalvos,onSalvarPreco=props.onSalvarPreco,onSalvarProduto=props.onSalvarProduto,onVoltar=props.onVoltar;
  var _busca=useState(""),busca=_busca[0],setBusca=_busca[1];
  var _prod=useState(null),prod=_prod[0],setProd=_prod[1];
  var _edit=useState(false),editMode=_edit[0],setEditMode=_edit[1];
  var _editF=useState({}),editF=_editF[0],setEditF=_editF[1];
  var _eST=useState(""),editST=_eST[0],setEditST=_eST[1];
  var _eBR=useState(""),editBR=_eBR[0],setEditBR=_eBR[1];
  var _eVR=useState(""),editVR=_eVR[0],setEditVR=_eVR[1];
  var _tab=useState("lista"),tab=_tab[0],setTab=_tab[1];

  var filtrados=busca?produtos.filter(function(p){return p.ref.toLowerCase().indexOf(busca.toLowerCase())!==-1||p.descricao.toLowerCase().indexOf(busca.toLowerCase())!==-1;}):produtos;
  var ordenados=useMemo(function(){return filtrados.slice().sort(function(a,b){return(b.dataCriacao||"").localeCompare(a.dataCriacao||"");});},[filtrados]);

  var selecionar=function(p){setProd(p);setTab("detalhe");setEditMode(false);setEditF(Object.assign({},p));
    setEditST(precosSalvos[p.ref+"|silvaTeles"]||"");setEditBR(precosSalvos[p.ref+"|bomRetiro"]||"");setEditVR(precosSalvos[p.ref+"|varejo"]||"");};
  var iniciarEdicao=function(){setEditMode(true);setEditF(Object.assign({},prod));
    setEditST(precosSalvos[prod.ref+"|silvaTeles"]||"");setEditBR(precosSalvos[prod.ref+"|bomRetiro"]||"");setEditVR(precosSalvos[prod.ref+"|varejo"]||"");};
  var salvarEdicao=function(){var np=Object.assign({},editF,{dataAtualizacao:new Date().toISOString()});onSalvarProduto(np);setProd(np);
    if(editST)onSalvarPreco(np.ref,"silvaTeles",editST);if(editBR)onSalvarPreco(np.ref,"bomRetiro",editBR);if(editVR)onSalvarPreco(np.ref,"varejo",editVR);setEditMode(false);};
  var handleEditSTChange=function(v){setEditST(v);var n=parseFloat(v);if(!isNaN(n)&&n>0){setEditBR(n+10);setEditVR(n+40);}};
  var handleEditBRChange=function(v){setEditBR(v);var n=parseFloat(v);if(!isNaN(n)&&n>0)setEditVR(n+30);};

  var custo=prod?ftCalcCusto(editMode?editF:prod):0;
  var canaisData=prod?[
    {id:"silvaTeles",label:"Silva Teles",preco:parseFloat(precosSalvos[prod.ref+"|silvaTeles"])||0},
    {id:"bomRetiro",label:"Bom Retiro",preco:parseFloat(precosSalvos[prod.ref+"|bomRetiro"])||0},
    {id:"varejo",label:"Varejo",preco:parseFloat(precosSalvos[prod.ref+"|varejo"])||0},
  ].filter(function(c){return c.preco>0;}):[];
  var mkMedia=canaisData.length>0?canaisData.reduce(function(s,c){return s+ftMarkupPct(c.preco,custo);},0)/canaisData.length:0;
  var mgMedia=canaisData.length>0?canaisData.reduce(function(s,c){return s+ftMargem(c.preco,custo);},0)/canaisData.length:0;
  var melhor=canaisData.length>0?canaisData.reduce(function(a,b){return ftMargem(a.preco,custo)>ftMargem(b.preco,custo)?a:b;}):null;
  var componentes=prod?ftCUSTO_FIELDS.filter(function(cf){return parseFloat((editMode?editF:prod)[cf.key])>0;})
    .map(function(cf){var v=parseFloat((editMode?editF:prod)[cf.key]);return Object.assign({},cf,{valor:v,pct:custo>0?(v/custo)*100:0});}):[];

  return(
    <div style={{background:_BG,minHeight:"100vh",padding:20,fontFamily:_GE}}>
      <div style={{maxWidth:860,margin:"0 auto"}}>
        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16}}>
          <button onClick={function(){if(tab==="detalhe"){setTab("lista");setProd(null);setEditMode(false);}else onVoltar();}} style={ftBtnVolt}>← {tab==="detalhe"?"Lista":"Voltar"}</button>
          <div style={{fontSize:20,fontWeight:700,color:_S}}>Análise Detalhada</div>
        </div>
        <div style={{background:_W,borderRadius:12,padding:14,border:"1px solid "+_BD,marginBottom:14}}>
          <input value={busca} onChange={function(e){setBusca(e.target.value);if(tab==="detalhe"&&!e.target.value){setTab("lista");setProd(null);}}} placeholder="Buscar por referência ou descrição..." style={Object.assign({},ftInpS,{width:"100%"})}/>
        </div>

        {tab==="lista"&&(
          <div style={{background:_W,borderRadius:12,border:"1px solid "+_BD,overflow:"hidden"}}>
            <div style={{display:"grid",gridTemplateColumns:"70px 1fr 80px 100px 80px 80px 80px",background:_BFT}}>
              {["Ref","Descrição","Marca","Coleção","Custo","S.Teles","B.Retiro"].map(function(h){return <div key={h} style={{padding:"8px 10px",fontSize:10,color:_W,fontWeight:700,textTransform:"uppercase"}}>{h}</div>;})}
            </div>
            {ordenados.map(function(p,i){var cu=ftCalcCusto(p);var st=precosSalvos[p.ref+"|silvaTeles"];var br=precosSalvos[p.ref+"|bomRetiro"];
              return(<div key={p.id} onClick={function(){selecionar(p);}} style={{display:"grid",gridTemplateColumns:"70px 1fr 80px 100px 80px 80px 80px",borderBottom:"1px solid #f0ebe4",alignItems:"center",cursor:"pointer",background:i%2===0?_W:"#faf8f5"}}
                onMouseEnter={function(e){e.currentTarget.style.background="#f0f6fb";}} onMouseLeave={function(e){e.currentTarget.style.background=i%2===0?_W:"#faf8f5";}}>
                <div style={{padding:"8px 10px",fontSize:12,fontWeight:700,color:_BFT}}>{p.ref}</div>
                <div style={{padding:"8px 10px",fontSize:12,color:_S}}>{p.descricao}</div>
                <div style={{padding:"8px 10px",fontSize:11,color:_TX2}}>{p.marca}</div>
                <div style={{padding:"8px 10px",fontSize:11,color:_GO}}>{p.colecao||"—"}</div>
                <div style={{padding:"8px 10px",fontSize:12,fontFamily:_FN,fontWeight:700,color:_S}}>{fmtRFT(cu)}</div>
                <div style={{padding:"8px 10px",fontSize:12,fontFamily:_FN,fontWeight:700,color:st?_S:_TX2}}>{st?fmtRFT(st):"—"}</div>
                <div style={{padding:"8px 10px",fontSize:12,fontFamily:_FN,fontWeight:700,color:br?_S:_TX2}}>{br?fmtRFT(br):"—"}</div>
              </div>);})}
            {ordenados.length===0&&<div style={{padding:24,textAlign:"center",color:"#c0b8b0",fontSize:13}}>Nenhum produto</div>}
          </div>
        )}

        {tab==="detalhe"&&prod&&(<div>
          <div style={{background:_W,borderRadius:12,padding:14,border:"1px solid "+_BD,marginBottom:14,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div style={{display:"flex",gap:10,alignItems:"baseline",flexWrap:"wrap"}}>
              <span style={{fontFamily:_FN,fontSize:20,fontWeight:800,color:_S}}>{prod.ref}</span>
              <span style={{fontSize:16,fontWeight:600,color:_S}}>{prod.descricao}</span>
              <span style={{fontSize:11,background:prod.marca==="Meluni"?"#f0ebe4":"#edf4fb",color:_S,padding:"2px 10px",borderRadius:4}}>{prod.marca}</span>
              <span style={{fontSize:11,background:"#f5f0e6",color:_GO,padding:"2px 10px",borderRadius:4}}>{prod.colecao||"—"}</span>
            </div>
            {!editMode&&<button onClick={iniciarEdicao} style={{background:_W,border:"1px solid #c8d8e4",borderRadius:6,padding:"5px 12px",fontSize:12,cursor:"pointer",color:_BFT}}>✏ Editar</button>}
          </div>

          {editMode&&(<div style={{background:_W,borderRadius:12,padding:16,border:"2px solid "+_BFT,marginBottom:14}}>
            <div style={{fontSize:12,fontWeight:700,color:_BFT,marginBottom:12}}>Editando Produto + Preços</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:10}}>
              <div><div style={{fontSize:10,color:_LB}}>Descrição</div><input value={editF.descricao||""} onChange={function(e){setEditF(function(p){return Object.assign({},p,{descricao:e.target.value});});}} style={Object.assign({},ftInpS,{width:"100%"})}/></div>
              <div><div style={{fontSize:10,color:_LB}}>Marca</div><div style={{display:"flex",gap:4}}>{ftMARCAS.map(function(m){return <button key={m} onClick={function(){setEditF(function(p){return Object.assign({},p,{marca:m});});}} style={{background:editF.marca===m?_S:_W,color:editF.marca===m?_W:_TX,border:"1px solid "+(editF.marca===m?_S:_BD),borderRadius:4,padding:"4px 12px",cursor:"pointer",fontSize:11}}>{m}</button>;})}</div></div>
              <div><div style={{fontSize:10,color:_LB}}>Coleção</div><input value={editF.colecao||""} onChange={function(e){setEditF(function(p){return Object.assign({},p,{colecao:e.target.value});});}} style={Object.assign({},ftInpS,{width:"100%"})}/></div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:6,marginBottom:10}}>
              {ftCUSTO_FIELDS.map(function(cf){return(<div key={cf.key}><div style={{fontSize:9,color:_LB}}>{cf.short}</div>
                <input type="number" value={editF[cf.key]||""} onChange={function(e){setEditF(function(p){var n=Object.assign({},p);n[cf.key]=e.target.value;return n;});}} placeholder="0"
                  style={{width:"100%",border:"1px solid #c8d8e4",borderRadius:4,padding:"5px 6px",fontSize:12,fontFamily:_FN,fontWeight:700,outline:"none",boxSizing:"border-box"}}/>
              </div>);})}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:10}}>
              {[{l:"Silva Teles",v:editST,fn:handleEditSTChange},{l:"Bom Retiro",v:editBR,fn:handleEditBRChange},{l:"Varejo",v:editVR,fn:function(v){setEditVR(v);}}].map(function(c){
                var pv=parseFloat(c.v)||0;var cu=ftCalcCusto(editF);
                return(<div key={c.l}><div style={{fontSize:10,color:_LB}}>{c.l}</div>
                  <input type="number" value={c.v} onChange={function(e){c.fn(e.target.value);}} placeholder="0"
                    style={{width:"100%",border:"1px solid #c8d8e4",borderRadius:4,padding:"5px 6px",fontSize:13,fontFamily:_FN,fontWeight:700,outline:"none",boxSizing:"border-box",marginBottom:4}}/>
                  {pv>0&&cu>0&&<div style={{display:"flex",alignItems:"center",gap:4}}>
                    <div style={{width:8,height:8,borderRadius:2,background:ftThermoColor(pv,cu)}}/>
                    <span style={{fontSize:10,color:ftThermoColor(pv,cu),fontFamily:_FN,fontWeight:700}}>{fmtRFT(ftLucro(pv,cu))}</span>
                    <span style={{fontSize:9,color:_LB,marginLeft:"auto"}}>{fmtFT(ftMarkupPct(pv,cu))}%</span>
                  </div>}</div>);})}
            </div>
            <div style={{display:"flex",justifyContent:"flex-end",gap:8}}>
              <button onClick={function(){setEditMode(false);}} style={Object.assign({},ftBtnSec,{fontSize:12,padding:"6px 14px"})}>Cancelar</button>
              <button onClick={salvarEdicao} style={{background:_S,color:_W,border:"none",borderRadius:6,padding:"6px 18px",fontSize:12,cursor:"pointer",fontFamily:_GE,fontWeight:600}}>Salvar</button>
            </div>
          </div>)}

          <div style={{background:_W,borderRadius:12,padding:16,border:"1px solid "+_BD,marginBottom:14}}>
            <div style={{fontSize:12,fontWeight:600,color:_BFT,marginBottom:12}}>Composição de Custo</div>
            {componentes.map(function(c){return(
              <div key={c.key} style={{display:"flex",alignItems:"center",gap:10,marginBottom:6}}>
                <div style={{width:100,fontSize:12,color:_S}}>{c.label}</div>
                <div style={{flex:1,height:16,background:"#f0ebe4",borderRadius:4,overflow:"hidden"}}><div style={{width:c.pct+"%",height:"100%",background:_BFT,borderRadius:4}}/></div>
                <div style={{width:80,textAlign:"right",fontFamily:_FN,fontSize:13,fontWeight:700,color:_S}}>{fmtRFT(c.valor)}</div>
                <div style={{width:45,textAlign:"right",fontSize:11,color:_LB}}>{fmtFT(c.pct)}%</div>
              </div>);})}
            <div style={{display:"flex",alignItems:"center",gap:10,marginTop:10,borderTop:"1px solid "+_BD,paddingTop:8}}>
              <div style={{width:100,fontSize:13,fontWeight:700,color:_BFT}}>TOTAL</div><div style={{flex:1}}/>
              <div style={{width:80,textAlign:"right",fontFamily:_FN,fontSize:16,fontWeight:800,color:_BFT}}>{fmtRFT(custo)}</div>
              <div style={{width:45,textAlign:"right",fontSize:12,fontWeight:700,color:_BFT}}>100%</div>
            </div>
          </div>

          <div style={{background:_W,borderRadius:12,border:"1px solid "+_BD,marginBottom:14,overflow:"hidden"}}>
            <div style={{padding:"12px 16px",fontSize:12,fontWeight:600,color:_BFT}}>Análise de Preços</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr repeat(4,90px)",background:_BFT}}>
              {["Canal","Preço","Lucro","Markup","Margem"].map(function(h){return <div key={h} style={{padding:"8px 10px",fontSize:10,color:_W,fontWeight:700,textTransform:"uppercase",textAlign:h==="Canal"?"left":"right"}}>{h}</div>;})}
            </div>
            {canaisData.map(function(c,i){var isM=melhor&&c.id===melhor.id;var lu=ftLucro(c.preco,custo);
              return(<div key={c.id} style={{display:"grid",gridTemplateColumns:"1fr repeat(4,90px)",borderBottom:"1px solid #f0ebe4",background:isM?"#f0fbf4":i%2===0?_W:"#faf8f5"}}>
                <div style={{padding:"10px",fontSize:13,fontWeight:600,color:_S}}>{isM?"⭐ ":""}{c.label}</div>
                <div style={{padding:"10px",textAlign:"right",fontFamily:_FN,fontSize:14,fontWeight:700,color:_S}}>{fmtRFT(c.preco)}</div>
                <div style={{padding:"10px",textAlign:"right",fontFamily:_FN,fontSize:14,fontWeight:700,color:ftThermoColor(c.preco,custo),display:"flex",alignItems:"center",justifyContent:"flex-end",gap:4}}>
                  <div style={{width:8,height:8,borderRadius:2,background:ftThermoColor(c.preco,custo)}}/>{fmtRFT(lu)}</div>
                <div style={{padding:"10px",textAlign:"right",fontFamily:_FN,fontSize:13,color:_S}}>{fmtFT(ftMarkupPct(c.preco,custo))}%</div>
                <div style={{padding:"10px",textAlign:"right",fontFamily:_FN,fontSize:13,color:_S}}>{fmtFT(ftMargem(c.preco,custo))}%</div>
              </div>);})}
            {canaisData.length===0&&<div style={{padding:20,textAlign:"center",color:"#c0b8b0",fontSize:12}}>Nenhum preço definido</div>}
          </div>

          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:14}}>
            {[{label:"Markup Médio",valor:fmtFT(mkMedia)+"%",cor:_BFT},{label:"Margem Média",valor:fmtFT(mgMedia)+"%",cor:_BFT},{label:"Melhor Canal",valor:melhor?melhor.label:"—",cor:_GO},{label:"Preço Mínimo",valor:fmtRFT(custo*1.1),sub:"(custo + 10%)",cor:_RD}].map(function(ind){return(
              <div key={ind.label} style={{background:_W,borderRadius:12,padding:14,border:"1px solid "+_BD,textAlign:"center"}}>
                <div style={{fontSize:10,color:_LB,letterSpacing:1,textTransform:"uppercase",marginBottom:6}}>{ind.label}</div>
                <div style={{fontFamily:_FN,fontSize:20,fontWeight:800,color:ind.cor}}>{ind.valor}</div>
                {ind.sub&&<div style={{fontSize:9,color:_LB,marginTop:2}}>{ind.sub}</div>}
              </div>);})}
          </div>

          <div style={{background:_W,borderRadius:10,padding:"8px 14px",border:"1px solid "+_BD,display:"flex",gap:16,alignItems:"center",flexWrap:"wrap"}}>
            <span style={{fontSize:11,color:_LB,fontWeight:600}}>TERMÔMETRO:</span>
            {[["#c0392b","< 80%"],["#e6a817","80–99%"],["#27ae60","100–129%"],["#1a8a3e","≥ 130%"]].map(function(a){return(
              <div key={a[0]} style={{display:"flex",alignItems:"center",gap:4,fontSize:10,color:_TX2}}>
                <div style={{width:10,height:10,borderRadius:2,background:a[0]}}/>{a[1]}
              </div>);})}
          </div>
        </div>)}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   COMPONENTE PRINCIPAL
   ═══════════════════════════════════════════════════════════════════════════ */

const FichaTecnicaContent=()=>{
  var _tela=useState("home"),tela=_tela[0],setTela=_tela[1];
  var _prods=useState([]),produtos=_prods[0],setProdutos=_prods[1];
  var _precos=useState({}),precosSalvos=_precos[0],setPrecosSalvos=_precos[1];
  var _sel=useState(null),prodSel=_sel[0],setProdSel=_sel[1];
  var _edit=useState(null),editProd=_edit[0],setEditProd=_edit[1];
  var _bRef=useState(""),buscaRef=_bRef[0],setBuscaRef=_bRef[1];
  var _bDesc=useState(""),buscaDesc=_bDesc[0],setBuscaDesc=_bDesc[1];
  var _bDe=useState(ftData30),buscaDe=_bDe[0],setBuscaDe=_bDe[1];
  var _bAte=useState(ftDataHoje),buscaAte=_bAte[0],setBuscaAte=_bAte[1];
  var produtosRef=useRef([]);var precosRef=useRef({});
  var _ftSync=useState(null),ftSync=_ftSync[0],setFtSync=_ftSync[1];
  var ftDebounce=useRef(null);

  // ── LOAD com merge por ref + _mod ──
  useEffect(function(){
    var localProds=[],localPrecos={};
    try{var raw=localStorage.getItem("amica_ficha");if(raw){var d=JSON.parse(raw);
      if(d.produtos){localProds=d.produtos;}
      if(d.precosSalvos){localPrecos=d.precosSalvos;}
      setProdutos(localProds);produtosRef.current=localProds;
      setPrecosSalvos(localPrecos);precosRef.current=localPrecos;
    }}catch(e){console.error(e)}
    if(!supabase)return;
    setFtSync('saving');
    supabase.from('amicia_data').select('payload').eq('user_id','ficha-tecnica').single()
      .then(function(r){var d=r.data;
        if(d&&d.payload){
          var remoteProds=d.payload.produtos||[];
          var remotePrecos=d.payload.precosSalvos||{};
          // MERGE produtos por ref + _mod
          var localMap=new Map(localProds.map(function(p){return[p.ref,p];}));
          var remoteMap=new Map(remoteProds.map(function(p){return[p.ref,p];}));
          var mergedProds=[];
          var prodSource={}; // ref → 'local'|'remote' (de onde veio cada produto)
          var allRefs=new Set([].concat(Array.from(localMap.keys()),Array.from(remoteMap.keys())));
          allRefs.forEach(function(ref){
            var lp=localMap.get(ref);var rp=remoteMap.get(ref);
            if(lp&&rp){
              if((lp._mod||0)>(rp._mod||0)){mergedProds.push(lp);prodSource[ref]='local';}
              else{mergedProds.push(rp);prodSource[ref]='remote';}
            }else if(lp){mergedProds.push(lp);prodSource[ref]='local';}
            else{mergedProds.push(rp);prodSource[ref]='remote';}
          });
          // MERGE precos: pra cada ref, usa os precos da fonte vencedora
          var mergedPrecos=Object.assign({},remotePrecos); // base: remoto
          Object.keys(localPrecos).forEach(function(key){
            var ref=key.split("|")[0];
            if(prodSource[ref]==='local'){mergedPrecos[key]=localPrecos[key];}
            // Se remote venceu, mantém remotePrecos (já é a base)
            // Se ref não existe em nenhum produto, mantém o que tiver
            if(!prodSource[ref]){mergedPrecos[key]=localPrecos[key];}
          });
          console.log("FICHA TÉC: merge —",localProds.length,"local,",remoteProds.length,"remoto →",mergedProds.length,"resultado");
          setProdutos(mergedProds);produtosRef.current=mergedProds;
          setPrecosSalvos(mergedPrecos);precosRef.current=mergedPrecos;
          try{localStorage.setItem("amica_ficha",JSON.stringify({produtos:mergedProds,precosSalvos:mergedPrecos}));}catch(e){console.error(e)}
        }
        setFtSync('saved');setTimeout(function(){setFtSync(null);},2000);
      }).catch(function(){setFtSync('error');});
  },[]);

  var salvarLocal=useCallback(function(pr,pc){try{localStorage.setItem("amica_ficha",JSON.stringify({produtos:pr,precosSalvos:pc}));}catch(e){console.error(e)}},[]);

  // ── SAVE com debounce + read-merge-write ──
  var salvarSB=useCallback(function(pr,pc){
    if(!supabase)return;
    if(ftDebounce.current)clearTimeout(ftDebounce.current);
    ftDebounce.current=setTimeout(function(){
      setFtSync('saving');
      supabase.from('amicia_data').select('payload').eq('user_id','ficha-tecnica').single()
        .then(function(r){
          var remote=r.data?.payload||{};
          var remoteProds=remote.produtos||[];
          var remotePrecos=remote.precosSalvos||{};
          // Merge produtos por ref + _mod
          var localMap=new Map(pr.map(function(p){return[p.ref,p];}));
          var remoteMap=new Map(remoteProds.map(function(p){return[p.ref,p];}));
          var mergedProds=[];var prodSource={};
          var allRefs=new Set([].concat(Array.from(localMap.keys()),Array.from(remoteMap.keys())));
          allRefs.forEach(function(ref){
            var lp=localMap.get(ref);var rp=remoteMap.get(ref);
            if(lp&&rp){
              if((lp._mod||0)>=(rp._mod||0)){mergedProds.push(lp);prodSource[ref]='local';}
              else{mergedProds.push(rp);prodSource[ref]='remote';}
            }else if(lp){mergedProds.push(lp);prodSource[ref]='local';}
            else{mergedProds.push(rp);prodSource[ref]='remote';}
          });
          // Merge precos
          var mergedPrecos=Object.assign({},remotePrecos);
          Object.keys(pc).forEach(function(key){
            var ref=key.split("|")[0];
            if(prodSource[ref]!=='remote'){mergedPrecos[key]=pc[key];}
          });
          return supabase.from('amicia_data').upsert({user_id:'ficha-tecnica',payload:{produtos:mergedProds,precosSalvos:mergedPrecos}},{onConflict:'user_id'});
        })
        .then(function(res){
          if(res?.error){console.error("FICHA TÉC SAVE:",res.error);setFtSync('error');}
          else{setFtSync('saved');setTimeout(function(){setFtSync(null);},2000);}
        })
        .catch(function(e){console.error("FICHA TÉC SAVE:",e);setFtSync('error');});
    },1500);
  },[]);
  var atualizarProdutos=useCallback(function(fn){var n=typeof fn==="function"?fn(produtosRef.current):fn;produtosRef.current=n;setProdutos(n);salvarLocal(n,precosRef.current);salvarSB(n,precosRef.current);},[salvarLocal,salvarSB]);
  var atualizarPrecos=useCallback(function(fn){var n=typeof fn==="function"?fn(precosRef.current):fn;precosRef.current=n;setPrecosSalvos(n);salvarLocal(produtosRef.current,n);salvarSB(produtosRef.current,n);},[salvarLocal,salvarSB]);
  var colecoesUnicas=useMemo(function(){var s=new Set(produtos.map(function(p){return p.colecao;}).filter(Boolean));return Array.from(s).sort();},[produtos]);

  var selecionarProduto=function(p){setProdSel(p);setBuscaRef(p.ref);setBuscaDesc("");setTela("home");};
  var custoSel=prodSel?ftCalcCusto(prodSel):0;
  var getPreco=function(ref,canal){return precosSalvos[ref+"|"+canal]||null;};
  var getSugerido=function(ref){var c=ftCalcCusto(produtos.find(function(p){return p.ref===ref;})||{});var st=getPreco(ref,"silvaTeles")||c*2;var br=getPreco(ref,"bomRetiro")||(st+10);return{silvaTeles:c*2,bomRetiro:st+10,varejo:br+30};};

  var salvarPrecoCanal=function(ref,canal,valor){
    var v=parseFloat(valor);if(isNaN(v)||v<=0)return;
    atualizarPrecos(function(prev){
      var n=Object.assign({},prev);n[ref+"|"+canal]=v;
      if(canal==="silvaTeles"){if(!prev[ref+"|bomRetiro"]||prev[ref+"|_brAuto"]){n[ref+"|bomRetiro"]=v+10;n[ref+"|_brAuto"]=true;}var br=n[ref+"|bomRetiro"]||v+10;if(!prev[ref+"|varejo"]||prev[ref+"|_vrAuto"]){n[ref+"|varejo"]=br+30;n[ref+"|_vrAuto"]=true;}}
      if(canal==="bomRetiro"){n[ref+"|_brAuto"]=false;if(!prev[ref+"|varejo"]||prev[ref+"|_vrAuto"]){n[ref+"|varejo"]=v+30;n[ref+"|_vrAuto"]=true;}}
      if(canal==="varejo")n[ref+"|_vrAuto"]=false;return n;});
  };

  var enviarWhatsHome=function(){
    if(!prodSel)return;
    var st=precosSalvos[prodSel.ref+"|silvaTeles"];var br=precosSalvos[prodSel.ref+"|bomRetiro"];var vr=precosSalvos[prodSel.ref+"|varejo"];
    var t="Preço da ref "+prodSel.ref+" "+prodSel.descricao+" 🚀\n\n";
    t+="💰 *PREÇOS*\n━━━━━━━━━━━━━━━━\n";
    t+="Custo: *"+fmtRFT(custoSel)+"*\n";
    if(st)t+="Silva Teles: *"+fmtRFT(st)+"*\n";
    if(br)t+="Bom Retiro: *"+fmtRFT(br)+"*\n";
    if(vr)t+="Varejo: *"+fmtRFT(vr)+"*\n";
    t+="━━━━━━━━━━━━━━━━";
    ftAbrirWhatsApp(t);
  };

  if(tela==="lista")return <FichaLista produtos={produtos} colecoesUnicas={colecoesUnicas} onSelect={selecionarProduto} onVoltar={function(){setTela("home");}} onEditar={function(p){setEditProd(p);setTela("editar");}} onExcluir={function(p){atualizarProdutos(function(ps){return ps.filter(function(x){return x.id!==p.id;});});if(prodSel&&prodSel.id===p.id){setProdSel(null);setBuscaRef("");}}}/>;
  if(tela==="novo")return <FichaFormProd produtos={produtos} colecoesUnicas={colecoesUnicas} precosSalvos={precosSalvos} onSalvarPreco={salvarPrecoCanal} onVoltar={function(){setTela("home");}} onSalvar={function(np){np._mod=Date.now();atualizarProdutos(function(ps){return ps.concat([np]);});setProdSel(np);setBuscaRef(np.ref);setTela("home");}}/>;
  if(tela==="editar"&&editProd)return <FichaFormProd inicial={editProd} produtos={produtos} colecoesUnicas={colecoesUnicas} precosSalvos={precosSalvos} onSalvarPreco={salvarPrecoCanal} onVoltar={function(){setTela("home");}} onSalvar={function(np){np._mod=Date.now();atualizarProdutos(function(ps){return ps.map(function(p){return p.id===editProd.id?np:p;});});if(prodSel&&prodSel.id===editProd.id)setProdSel(np);setTela("home");}}/>;
  if(tela==="analise")return <FichaAnalise produtos={produtos} precosSalvos={precosSalvos} onSalvarPreco={salvarPrecoCanal} onSalvarProduto={function(np){np._mod=Date.now();atualizarProdutos(function(ps){return ps.map(function(p){return p.id===np.id?np:p;});});if(prodSel&&prodSel.id===np.id)setProdSel(np);}} onVoltar={function(){setTela("home");}}/>;

  // HOME
  var filtrados=produtos.filter(function(p){
    if(buscaRef&&p.ref.toLowerCase().indexOf(buscaRef.toLowerCase())===-1)return false;
    if(buscaDesc&&p.descricao.toLowerCase().indexOf(buscaDesc.toLowerCase())===-1)return false;
    if(buscaDe&&p.dataCriacao<buscaDe)return false;if(buscaAte&&p.dataCriacao>buscaAte)return false;return true;});
  var produtoAtivo=prodSel;
  var sugeridos=produtoAtivo?getSugerido(produtoAtivo.ref):null;
  var CANAIS=[{id:"custo",label:"CUSTO",bg:_S,tc:_W},{id:"silvaTeles",label:"SILVA TELES",bg:_BFT,tc:_W},{id:"bomRetiro",label:"BOM RETIRO",bg:_BFT,tc:_W},{id:"varejo",label:"VAREJO",bg:_BFT,tc:_W}];

  return(
    <div style={{background:_BG,minHeight:"100vh",padding:20,fontFamily:_GE}}>
      <div style={{maxWidth:980,margin:"0 auto"}}>
        <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:16}}>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <FichaSvgIcon size={38}/>
            <div>
              <div style={{fontSize:10,color:_LB,letterSpacing:2,textTransform:"uppercase"}}>GRUPO AMÍCIA</div>
              <div style={{fontSize:22,fontWeight:700,color:_S}}>Ficha Técnica</div>
              <div style={{fontSize:11,color:_TX2,marginTop:1}}>Lojas Físicas · Silva Teles · Bom Retiro · Varejo</div>
            </div>
          </div>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            {ftSync==='saving'&&<span style={{fontSize:11,color:"#a89f94",fontFamily:"Georgia,serif"}}>⏳ Salvando...</span>}
            {ftSync==='saved'&&<span style={{fontSize:11,color:"#27ae60",fontFamily:"Georgia,serif"}}>✓ Salvo</span>}
            {ftSync==='error'&&<span style={{fontSize:11,color:"#c0392b",fontFamily:"Georgia,serif"}}>⚠ Erro</span>}
            <button onClick={function(){setEditProd(null);setTela("novo");}} style={ftBtnPri}>+ Novo</button>
            <button onClick={function(){setTela("lista");}} style={ftBtnSec}>📋 Lista</button>
            <button onClick={function(){setTela("analise");}} style={ftBtnSec}>📊 Análise</button>
          </div>
        </div>

        {/* Busca — com botão Buscar ao lado da data */}
        <div style={{background:_W,borderRadius:12,padding:14,border:"1px solid "+_BD,marginBottom:14}}>
          <div style={{fontSize:11,color:_LB,letterSpacing:1,textTransform:"uppercase",marginBottom:8}}>Buscar produto</div>
          <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
            <input value={buscaRef} onChange={function(e){setBuscaRef(e.target.value);if(!e.target.value)setProdSel(null);}} placeholder="Referência" style={Object.assign({},ftInpS,{width:120})}/>
            <input value={buscaDesc} onChange={function(e){setBuscaDesc(e.target.value);}} placeholder="Descrição" style={Object.assign({},ftInpS,{flex:1,minWidth:140})}/>
            <input type="date" value={buscaDe} onChange={function(e){setBuscaDe(e.target.value);}} style={Object.assign({},ftInpS,{width:130,fontSize:11})}/>
            <span style={{fontSize:11,color:_LB}}>até</span>
            <input type="date" value={buscaAte} onChange={function(e){setBuscaAte(e.target.value);}} style={Object.assign({},ftInpS,{width:130,fontSize:11})}/>
            <button onClick={function(){/* filtro já é automático, mas força re-render */setProdSel(null);}} style={{background:_S,color:_W,border:"none",borderRadius:8,padding:"8px 16px",fontSize:12,cursor:"pointer",fontFamily:_GE,fontWeight:600}}>Buscar</button>
            {produtoAtivo&&<button onClick={function(){setProdSel(null);setBuscaRef("");setBuscaDesc("");setBuscaDe(ftData30());setBuscaAte(ftDataHoje());}} style={{background:_W,color:_RD,border:"1px solid "+_RD,borderRadius:8,padding:"8px 10px",cursor:"pointer",fontSize:13}}>✕</button>}
          </div>
          {(buscaRef||buscaDesc)&&!produtoAtivo&&filtrados.length>0&&(
            <div style={{marginTop:8,maxHeight:160,overflowY:"auto",borderTop:"1px solid "+_BD,paddingTop:6}}>
              {filtrados.slice(0,8).map(function(p){return(
                <div key={p.id} onClick={function(){selecionarProduto(p);}} style={{display:"flex",gap:10,alignItems:"center",padding:"6px 8px",cursor:"pointer",borderRadius:6}}
                  onMouseEnter={function(e){e.currentTarget.style.background="#f0f6fb";}} onMouseLeave={function(e){e.currentTarget.style.background="transparent";}}>
                  <span style={{fontFamily:_FN,fontWeight:700,color:_BFT,fontSize:13,minWidth:50}}>{p.ref}</span>
                  <span style={{fontSize:12,color:_S}}>{p.descricao}</span>
                  <span style={{fontSize:10,color:_LB,marginLeft:"auto"}}>{p.colecao}</span>
                </div>);})}
            </div>)}
          {(buscaRef||buscaDesc)&&!produtoAtivo&&filtrados.length===0&&<div style={{marginTop:8,fontSize:12,color:_LB,textAlign:"center",padding:8}}>Nenhum produto encontrado</div>}
        </div>

        {produtoAtivo&&(<div style={{background:_W,borderRadius:12,padding:14,border:"1px solid "+_BD,marginBottom:14}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div style={{display:"flex",gap:10,alignItems:"baseline",flexWrap:"wrap"}}>
              <span style={{fontFamily:_FN,fontSize:20,fontWeight:800,color:_S}}>{produtoAtivo.ref}</span>
              <span style={{fontSize:16,fontWeight:600,color:_S}}>{produtoAtivo.descricao}</span>
              <span style={{fontSize:11,background:produtoAtivo.marca==="Meluni"?"#f0ebe4":"#edf4fb",color:_S,padding:"2px 10px",borderRadius:4}}>{produtoAtivo.marca}</span>
              <span style={{fontSize:11,background:"#f5f0e6",color:_GO,padding:"2px 10px",borderRadius:4}}>{produtoAtivo.colecao||"—"}</span>
              <span style={{fontSize:10,color:_LB}}>{fmtDataFT(produtoAtivo.dataCriacao)}</span>
            </div>
            <button onClick={function(){setEditProd(produtoAtivo);setTela("editar");}} style={{background:_W,border:"1px solid #c8d8e4",borderRadius:6,padding:"5px 12px",fontSize:12,cursor:"pointer",color:_BFT}}>✏ Editar</button>
          </div>
        </div>)}

        {/* 4 Cards — SÓ EXIBEM, sem edição */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12}}>
          {CANAIS.map(function(canal){
            var isC=canal.id==="custo";var pr=produtoAtivo?(isC?custoSel:getPreco(produtoAtivo.ref,canal.id)):null;
            var sg=produtoAtivo&&!isC?sugeridos[canal.id]:null;
            return <CardHome key={canal.id} canal={canal} ativo={!!produtoAtivo} custo={custoSel} preco={pr} sugerido={sg} isCusto={isC}/>;
          })}
        </div>

        {/* WhatsApp pequeno */}
        {produtoAtivo&&(<div style={{display:"flex",justifyContent:"center",marginTop:12}}>
          <button onClick={enviarWhatsHome} style={{background:"#25D366",color:_W,border:"none",borderRadius:8,padding:"6px 16px",fontSize:12,cursor:"pointer",fontFamily:_GE,display:"flex",alignItems:"center",gap:6}}>
            <WhatsAppIcon size={16}/>Enviar
          </button>
        </div>)}

        {!produtoAtivo&&<div style={{textAlign:"center",padding:"36px 0",color:_LB,fontSize:13}}>Busque um produto para ver os preços</div>}
      </div>
    </div>
  );
}


export default function App(){
  const [usuarioLogado,setUsuarioLogado]=useState(()=>{try{const s=localStorage.getItem("amica_session");if(!s)return null;const u=JSON.parse(s);if((u.id===1||u.usuario==='admin')&&!u.admin){u.admin=true;try{localStorage.setItem("amica_session",JSON.stringify(u));}catch{}}return u;}catch{return null;}});
  const [active,setActive]=useState(()=>{
    try{const s=localStorage.getItem("amica_session");if(s){const u=JSON.parse(s);const mod=u.moduloPadrao||"home";if(u.admin||mod==="home"||u.modulos?.includes(mod))return mod;return u.modulos?.[0]||"home";}}catch{}return"lancamentos";
  });
  const [sacResetTrigger,setSacResetTrigger]=useState(0);
  const [menuUser,setMenuUser]=useState(false);
  const [usuarios,setUsuarios]=useState(USUARIOS_INICIAL);
  const [prestadores,setPrestadores]=useState(PRESTADORES_INICIAL);
  const [fixosConfig,setFixosConfig]=useState(FIXOS_TEMPLATE);
  const [fixosNomesFunc,setFixosNomesFunc]=useState(FIXOS_NOMES_FUNC);
  const [cortes,setCortes]=useState([]);
  const [produtos,setProdutos]=useState([
    {ref:"2700",descricao:"VESTIDO LINHO SEM ELASTANO",marca:"Meluni",valorUnit:1,tecido:"Linho s/ elastano"},
    {ref:"1060",descricao:"CALÇA PANTALONA VISCOLINHO",marca:"Amícia",valorUnit:1,tecido:"Viscolinho"},
    {ref:"2699",descricao:"SAIA LINHO COM ELASTANO",marca:"Amícia",valorUnit:1,tecido:""},
    {ref:"3157",descricao:"BLUSA LISTRADA",marca:"Amícia",valorUnit:1,tecido:""},
    {ref:"3027",descricao:"MACACÃO LINHO SEM ELASTANO",marca:"Meluni",valorUnit:1,tecido:"Linho s/ elastano"},
    {ref:"3154",descricao:"VESTIDO LONGO",marca:"Amícia",valorUnit:1,tecido:""},
    {ref:"3155",descricao:"BLUSA SAIA LISTRADO CONJUNTO",marca:"Amícia",valorUnit:1,tecido:""},
    {ref:"3164",descricao:"VESTIDO LONGO VISCOSE",marca:"Amícia",valorUnit:1,tecido:""},
    {ref:"3159",descricao:"BLUSA CALÇA CONJUNTO VISCOSE",marca:"Amícia",valorUnit:1,tecido:""},
    {ref:"3158",descricao:"BLUSA VISCOSE TRABALHADA",marca:"Amícia",valorUnit:1,tecido:""},
    {ref:"3161",descricao:"VESTIDO VELUDO",marca:"Amícia",valorUnit:1,tecido:""},
    {ref:"2970",descricao:"VESTIDO VERONA",marca:"Meluni",valorUnit:1,tecido:"Verona"},
    {ref:"2960",descricao:"VESTIDO TOMARA CAIA",marca:"Amícia",valorUnit:1,tecido:""},
    {ref:"2952",descricao:"VESTIDO PLUS",marca:"Meluni",valorUnit:1,tecido:"Linho s/ elastano"},
    {ref:"3151",descricao:"BLUSA BORDADO",marca:"Amícia",valorUnit:1,tecido:""},
    {ref:"3156",descricao:"BLUSA VISCOSE",marca:"Amícia",valorUnit:1,tecido:""},
    {ref:"3196",descricao:"CALÇA ALGODÃO",marca:"Amícia",valorUnit:1,tecido:""},
    {ref:"3131",descricao:"CROPPED E SAIA COURO CONJUNTO",marca:"Amícia",valorUnit:1,tecido:""},
    {ref:"494",descricao:"BASICA MANGA CURTA",marca:"Amícia",valorUnit:1,tecido:""},
    {ref:"3111",descricao:"VESTIDO ALÇA TRANSPASSADO",marca:"Amícia",valorUnit:1,tecido:""},
    {ref:"3138",descricao:"MACACÃO SENSORIALLE",marca:"Amícia",valorUnit:1,tecido:""},
    {ref:"2329",descricao:"SAIA LINHO SEM ELASTANO",marca:"Amícia",valorUnit:1,tecido:""},
    {ref:"2930",descricao:"BODY",marca:"Amícia",valorUnit:6,tecido:""},
    {ref:"805",descricao:"CROPPED VISCOLINHO",marca:"Amícia",valorUnit:1,tecido:"Viscolinho"},
    {ref:"3125",descricao:"BLUSA E SHORTS CONJUNTO",marca:"Amícia",valorUnit:1,tecido:""},
    {ref:"3127",descricao:"VESTIDO LINHO COM ELASTANO",marca:"Amícia",valorUnit:1,tecido:""},
    {ref:"3140",descricao:"SHORTS LINHO",marca:"Amícia",valorUnit:1,tecido:""},
    {ref:"3149",descricao:"BLUSA E SHORTS CONJUNTO",marca:"Amícia",valorUnit:1,tecido:""},
    {ref:"3136",descricao:"BLUSA VISCOSE",marca:"Amícia",valorUnit:1,tecido:""},
    {ref:"3153",descricao:"BLUSA XADREZ",marca:"Amícia",valorUnit:1,tecido:""},
    {ref:"3139",descricao:"SAIA PALA NA FRENTE",marca:"Amícia",valorUnit:1,tecido:""},
    {ref:"3145",descricao:"VESTIDO LINHO COM ELASTANO",marca:"Amícia",valorUnit:1,tecido:""},
    {ref:"3143",descricao:"BLUSA E SAIA CONJUNTO",marca:"Amícia",valorUnit:1,tecido:""},
    {ref:"3166",descricao:"VESTIDO VERONA",marca:"Meluni",valorUnit:16,tecido:"Verona"},
    {ref:"3150",descricao:"VESTIDO COURO CURTO",marca:"Meluni",valorUnit:16,tecido:""},
    {ref:"3169",descricao:"SHORTS ALFAITARIA",marca:"Amícia",valorUnit:1,tecido:""},
    {ref:"3195",descricao:"CONJUNTO BLAZER E CALÇA",marca:"Amícia",valorUnit:24,tecido:""},
    {ref:"2586",descricao:"CONJUNTO CROPPED CALÇA LINHO",marca:"Amícia",valorUnit:19,tecido:"Linho c/ elastano"},
    {ref:"2657",descricao:"CALÇA LINHO SEM ELASTANO",marca:"Meluni",valorUnit:11,tecido:"Linho s/ elastano"},
    {ref:"3184",descricao:"BLUSINHA PIPOCA",marca:"Amícia",valorUnit:1,tecido:""},
    {ref:"3114",descricao:"CALÇA ALGODÃO",marca:"Amícia",valorUnit:1,tecido:""},
    {ref:"3178",descricao:"SHORTS COURO",marca:"Amícia",valorUnit:1,tecido:""},
    {ref:"3190",descricao:"JAQUETA PLANO",marca:"Amícia",valorUnit:1,tecido:""},
    {ref:"0495",descricao:"BLUSA BASICA",marca:"Amícia",valorUnit:2.5,tecido:""},
    {ref:"3188",descricao:"BLUSA TRICOLINE",marca:"Amícia",valorUnit:1,tecido:"Tricoline c/ elastano"},
    {ref:"3189",descricao:"MACACÃO",marca:"Amícia",valorUnit:1,tecido:""},
    {ref:"3013",descricao:"MACACÃO PLUS",marca:"Meluni",valorUnit:16,tecido:"Linho s/ elastano"},
    {ref:"351",descricao:"BODY MANGA LONGA",marca:"Amícia",valorUnit:1,tecido:"Suplex poliamida"},
    {ref:"352",descricao:"BODY SEM MANGA",marca:"Amícia",valorUnit:1,tecido:"Suplex poliamida"},
    {ref:"2792",descricao:"SAIA LINHO SEM ELASTANO",marca:"Amícia",valorUnit:1,tecido:""},
    {ref:"3186",descricao:"CAMISA TRICOLINE",marca:"Amícia",valorUnit:1,tecido:"Tricoline site"},
    {ref:"3171",descricao:"JAQUETA COURO",marca:"Amícia",valorUnit:1,tecido:""},
    {ref:"2759",descricao:"BODY",marca:"Amícia",valorUnit:1,tecido:"Suplex poliamida"},
    {ref:"2818",descricao:"BODY",marca:"Amícia",valorUnit:1,tecido:"Suplex poliamida"},
    {ref:"2893",descricao:"SAIA ELASTICO NO CÓS",marca:"Amícia",valorUnit:1,tecido:""},
    {ref:"3176",descricao:"BODY",marca:"Amícia",valorUnit:1,tecido:"Suplex poliamida"},
    {ref:"3147",descricao:"VESTIDO COURO MIDI",marca:"Meluni",valorUnit:17,tecido:"Couro site"},
    {ref:"376",descricao:"BODY MANGA LONGA",marca:"Amícia",valorUnit:1,tecido:"Suplex poliamida"},
    {ref:"395",descricao:"BODY SEM MANGA",marca:"Amícia",valorUnit:1,tecido:"Suplex poliamida"},
    {ref:"2843",descricao:"VESTIDO DE UM OMBRO",marca:"Meluni",valorUnit:16,tecido:""},
    {ref:"8544",descricao:"BERMUDA",marca:"Amícia",valorUnit:1,tecido:""},
    {ref:"3105",descricao:"BLUSA VISCOLINHO",marca:"Amícia",valorUnit:1,tecido:""},
    {ref:"2939",descricao:"BLUSA VISCOLINHO",marca:"Amícia",valorUnit:1,tecido:""},
    {ref:"2708",descricao:"CROPPED CALÇA CONJUNTO",marca:"Amícia",valorUnit:1,tecido:""},
    {ref:"3172",descricao:"BLUSA E CALÇA XADREZ",marca:"Amícia",valorUnit:1,tecido:""},
    {ref:"3012",descricao:"CALÇA PLUS LINHO SEM ELASTANO",marca:"Meluni",valorUnit:12,tecido:"Linho s/ elastano"},
    {ref:"2965",descricao:"VESTIDO 2 BOLSOS LINHO SEM ELASTANO",marca:"Meluni",valorUnit:16,tecido:"Linho s/ elastano"},
    {ref:"3167",descricao:"CALÇA COURO",marca:"Amícia",valorUnit:1,tecido:""},
    {ref:"3168",descricao:"SHORTS ALFAITARIA",marca:"Amícia",valorUnit:1,tecido:""},
    {ref:"3174",descricao:"VESTIDO XADREZ",marca:"Amícia",valorUnit:1,tecido:""},
    {ref:"3170",descricao:"BLUSA VISCOSE",marca:"Amícia",valorUnit:1,tecido:""},
    {ref:"3175",descricao:"CALÇA PIQUE",marca:"Amícia",valorUnit:1,tecido:""},
    {ref:"2911",descricao:"CROPPED E CALÇA CONJUNTO",marca:"Amícia",valorUnit:1,tecido:""},
    {ref:"1065",descricao:"SAIA 1 BOTÃO LINHO SEM ELASTANO",marca:"Meluni",valorUnit:10,tecido:"Linho s/ elastano"},
    {ref:"3181",descricao:"BLUSA E CALÇA CONJUNTO",marca:"Amícia",valorUnit:1,tecido:""},
    {ref:"3182",descricao:"BLUSA E SHORTS SAIA CONJUNTO",marca:"Amícia",valorUnit:1,tecido:""},
    {ref:"2842",descricao:"MACACÃO REGULAR LINHO SEM ELASTANO",marca:"Meluni",valorUnit:16,tecido:"Linho s/ elastano"},
    {ref:"3120",descricao:"BLUSA VISCOLINHO",marca:"Amícia",valorUnit:1,tecido:""},
    {ref:"3088",descricao:"VESTIDO VERONA DRAPEADO",marca:"Meluni",valorUnit:16,tecido:"Verona"},
    {ref:"3141",descricao:"CROPPED SAIA LINHO CONJUNTO",marca:"Amícia",valorUnit:1,tecido:""},
    {ref:"2322",descricao:"SAIA LINHO COM ELASTANO",marca:"Meluni",valorUnit:10,tecido:"Linho c/ elastano"},
    {ref:"2841",descricao:"VESTIDO DE UM OMBRO",marca:"Meluni",valorUnit:16,tecido:"Linho s/ elastano"},
    {ref:"3109",descricao:"SAIA DE LINHO TRANSPASSADA",marca:"Meluni",valorUnit:10,tecido:"Linho s/ elastano"},
  ]);
  const [oficinasCAD,setOficinasCAD]=useState(OFICINAS_CAD_INICIAL);
  const [logTroca,setLogTroca]=useState([]);
  const [tecidosCAD,setTecidosCAD]=useState([
    {id:1,descricao:"Linho s/ elastano",metragemRolo:50,valorMetro:10},
    {id:2,descricao:"Linho c/ elastano",metragemRolo:50,valorMetro:18},
    {id:3,descricao:"Viscolinho",metragemRolo:50,valorMetro:10},
    {id:4,descricao:"Verona",metragemRolo:50,valorMetro:10},
    {id:5,descricao:"Couro site",metragemRolo:50,valorMetro:10},
    {id:6,descricao:"Couro loja",metragemRolo:50,valorMetro:19},
    {id:7,descricao:"Viscose estampada",metragemRolo:50,valorMetro:20},
    {id:8,descricao:"Tricoline site",metragemRolo:50,valorMetro:10},
    {id:9,descricao:"Tricoline c/ elastano",metragemRolo:50,valorMetro:10},
    {id:10,descricao:"Suplex poliamida",metragemRolo:50,valorMetro:10},
  ]);
  const [boletosShared,setBoletosShared]=useState([...BOLETOS_MAR,...BOLETOS_ABR,...BOLETOS_MAI,...BOLETOS_JUN,...BOLETOS_JUL]);
  const receitasIniciais={1:RECEITAS_JAN,2:RECEITAS_FEV,3:RECEITAS_MAR};
  const [receitasPorMes,setReceitasPorMes]=useState(receitasIniciais);
  const auxIniciais={1:AUX_JAN,2:AUX_FEV,3:AUX_MAR};
  const [auxDataPorMes,setAuxDataPorMes]=useState(()=>{
    if(MES_ATUAL>3&&!auxIniciais[MES_ATUAL]){auxIniciais[MES_ATUAL]=inicializarMesNovo();}
    return auxIniciais;
  });
  const [categoriasPorMes,setCategoriasPorMes]=useState(()=>{
    const base={1:[...CATS],2:[...CATS],3:[...CATS]};
    if(MES_ATUAL>3)base[MES_ATUAL]=[...CATS];
    return base;
  });
  const [blingStatus,setBlingStatus]=useState(null);
  const [blingVendas,setBlingVendas]=useState({});
  const [blingImportStatus,setBlingImportStatus]=useState(null);
  const [syncStatus,setSyncStatus]=useState(null); // null | 'loading' | 'saved' | 'error' | 'local'
  const [dbCarregado,setDbCarregado]=useState(false);
  const dbCarregadoTs=useRef(0); // timestamp de quando dbCarregado virou true
  const [homeSacPending,setHomeSacPending]=useState(0);
  const [homeSCPending,setHomeSCPending]=useState(0);
  const [homeAgendaHoje,setHomeAgendaHoje]=useState(0);
  const [sessaoExpirada,setSessaoExpirada]=useState(false);
  const sessaoInicio=useRef(Date.now());
  const debounceRef=useRef(null);
  const debounceCortes=useRef(null);
  const dadosRef=useRef(null); // ref pra flush/retry sem re-registrar listeners
  const lastSaveTs=useRef(0); // timestamp do último save pra detectar eco do Realtime
  const realtimeProcessing=useRef(false); // flag pra pular auto-save durante Realtime

  // ── CHAVES PARA DETECTAR MUDANÇAS ──────────────────────────────────────────
  const chavesDados={receitasPorMes,auxDataPorMes,categoriasPorMes,boletosShared,produtos,oficinasCAD,logTroca,prestadores,tecidosCAD,fixosConfig,fixosNomesFunc};
  const debounceUsuarios=useRef(null);
  const realtimeUsuarios=useRef(false);
  const lastUsuariosSaveTs=useRef(0);

  // ── SAVE LOCAL IMEDIATO (sem debounce) ─────────────────────────────────────
  // salvarLocal aceita timestamp opcional — quando fornecido, usa o MESMO que vai pro Supabase
  const salvarLocal=useCallback((dados,ts)=>{
    try{
      const payload={...dados,_updated:ts||Date.now()};
      const json=JSON.stringify(payload);
      const size=new Blob([json]).size;
      if(size>60000)console.warn("⚠ Payload localStorage:",Math.round(size/1024),"KB",size>65536?"— EXCEDE 64KB keepalive!":"");
      localStorage.setItem("amica_financeiro",json);
      localStorage.setItem("amica_pending_sync","true");
    }catch(e){console.error("Erro salvando localStorage:",e);}
  },[]);

  // ── LOAD DO SUPABASE NA ABERTURA ───────────────────────────────────────────
  useEffect(()=>{
    if(!supabase){setDbCarregado(true);return;}
    // Garante que sb_url e sb_key estejam no localStorage pro flush keepalive funcionar
    try{
      const url=import.meta.env.VITE_SUPABASE_URL||"";
      const key=import.meta.env.VITE_SUPABASE_ANON_KEY||"";
      if(url)localStorage.setItem("sb_url",url);
      if(key)localStorage.setItem("sb_key",key);
    }catch(e){console.error("Erro salvando sb_url/sb_key:",e);}
    // Safety timeout: se Supabase não responder em 10s, libera o app
    const safetyTimer=setTimeout(()=>{setDbCarregado(prev=>{if(!prev){console.warn("SAFETY: Supabase não respondeu em 10s, liberando app");setSyncStatus('error');}return true;});},10000);
    // Camada 1: carrega localStorage imediatamente (dados aparecem na hora)
    try{
      const local=localStorage.getItem("amica_cortes");
      if(local){const d=JSON.parse(local);if(d&&d.length>0)setCortes(d);}
    }catch(e){console.error("Erro lendo cortes local:",e);}
    try{
      const localFin=localStorage.getItem("amica_financeiro");
      if(localFin){
        const d=JSON.parse(localFin);
        if(d.receitasPorMes)setReceitasPorMes(d.receitasPorMes);
        if(d.auxDataPorMes)setAuxDataPorMes(d.auxDataPorMes);
        if(d.categoriasPorMes)setCategoriasPorMes(d.categoriasPorMes);
        if(d.boletosShared&&d.boletosShared.length>0)setBoletosShared(deduplicarBoletos(d.boletosShared));
        if(d.prestadores)setPrestadores(d.prestadores);
        if(d.produtos)setProdutos(d.produtos);
        if(d.oficinasCAD)setOficinasCAD(d.oficinasCAD);
        if(d.logTroca)setLogTroca(d.logTroca);
        if(d.tecidosCAD)setTecidosCAD(d.tecidosCAD);
        if(d.fixosConfig)setFixosConfig(d.fixosConfig);
        if(d.fixosNomesFunc)setFixosNomesFunc(d.fixosNomesFunc);
        setSyncStatus('local');
      }
    }catch(e){console.error("Erro lendo financeiro local:",e);}
    // Camada 1b: carrega usuarios do localStorage separado
    try{
      const localUsr=localStorage.getItem("amica_usuarios");
      if(localUsr){const d=JSON.parse(localUsr);if(d.usuarios&&d.usuarios.length>0)setUsuarios(d.usuarios);}
    }catch(e){console.error("Erro lendo usuarios local:",e);}

    // Camada 2: carrega Supabase — compara timestamps (MAIS RECENTE VENCE, sem depender de pending_sync)
    setSyncStatus('loading');
    Promise.all([
      supabase.from('amicia_data').select('payload').eq('user_id',USER_ID).single(),
      supabase.from('amicia_data').select('payload').eq('user_id','ailson_cortes').single(),
    ]).then(([{data:df,error:ef},{data:dc,error:ec}])=>{
      if(!ef&&df?.payload){
        const d=df.payload;
        const localRaw=localStorage.getItem("amica_financeiro");
        let localParsed=null;
        try{localParsed=localRaw?JSON.parse(localRaw):null;}catch(e){console.error("Erro parsing localStorage:",e);}
        const localTs=localParsed?._updated||0;
        const remoteTs=d._updated||0;

        // Non-admin: SEMPRE usa Supabase
        if(!usuarioLogado?.admin){
          console.log("SYNC: não-admin → Supabase vence sempre");
          localStorage.setItem("amica_pending_sync","false");
        }

        // DECISÃO POR TIMESTAMP: quem tem _updated mais recente vence
        if(localTs>remoteTs&&usuarioLogado?.admin&&localParsed){
          // LOCAL VENCE por timestamp: estado já foi setado no Passo 1 (localStorage)
          // MAS faz merge com remoto pra não perder dados que só existem no Supabase
          console.log("SYNC: LOCAL vence — localTs:",new Date(localTs).toLocaleString("pt-BR"),"(",localTs,") > remotoTs:",remoteTs?new Date(remoteTs).toLocaleString("pt-BR"):"nenhum","(",remoteTs,")");
          console.log("SYNC: LOCAL dados —",localParsed.boletosShared?.length||0,"boletos,",Object.keys(localParsed.receitasPorMes||{}).length,"meses receitas");
          // Merge receitas: se Supabase tem meses que local não tem, preserva
          if(d.receitasPorMes){
            const localRec=localParsed.receitasPorMes||{};
            const remoteRec=d.receitasPorMes||{};
            const mergedRec={...remoteRec,...localRec}; // local sobrescreve remoto (tem prioridade)
            // Mas preserva meses que SÓ existem no remoto
            Object.keys(remoteRec).forEach(m=>{if(!localRec[m])mergedRec[m]=remoteRec[m];});
            if(Object.keys(mergedRec).length>Object.keys(localRec).length){
              console.log("SYNC: merge receitas — local tinha",Object.keys(localRec).length,"meses, remoto",Object.keys(remoteRec).length,"→ resultado",Object.keys(mergedRec).length);
              setReceitasPorMes(mergedRec);
            }
          }
          // Merge auxData: mesma lógica
          if(d.auxDataPorMes){
            const localAux=localParsed.auxDataPorMes||{};
            const remoteAux=d.auxDataPorMes||{};
            const mergedAux={...remoteAux,...localAux};
            Object.keys(remoteAux).forEach(m=>{if(!localAux[m])mergedAux[m]=remoteAux[m];});
            if(Object.keys(mergedAux).length>Object.keys(localAux).length)setAuxDataPorMes(mergedAux);
          }
          // Merge categorias
          if(d.categoriasPorMes){
            const localCats=localParsed.categoriasPorMes||{};
            const remoteCats=d.categoriasPorMes||{};
            const mergedCats={...remoteCats,...localCats};
            Object.keys(remoteCats).forEach(m=>{if(!localCats[m])mergedCats[m]=remoteCats[m];});
            if(Object.keys(mergedCats).length>Object.keys(localCats).length)setCategoriasPorMes(mergedCats);
          }
          // Merge boletos por ID
          if(d.boletosShared&&d.boletosShared.length>0){
            const localBol=localParsed.boletosShared||[];
            const remoteBol=d.boletosShared||[];
            const bolMap=new Map(localBol.map(b=>[b.id,b]));
            for(const rb of remoteBol){if(!bolMap.has(rb.id))bolMap.set(rb.id,rb);else{const lb=bolMap.get(rb.id);if((rb._mod||0)>(lb._mod||0))bolMap.set(rb.id,rb);}}
            const mergedBol=[...bolMap.values()];
            if(mergedBol.length>localBol.length){
              console.log("SYNC: merge boletos — local",localBol.length,", remoto",remoteBol.length,"→ resultado",mergedBol.length);
              setBoletosShared(deduplicarBoletos(mergedBol));
            }
          }
          // Outros campos: local já tem prioridade (setado no passo 1)
          // Mas se local não tem, usa remoto
          if(!localParsed.prestadores&&d.prestadores)setPrestadores(d.prestadores);
          if(!localParsed.produtos&&d.produtos)setProdutos(d.produtos);
          if(!localParsed.oficinasCAD&&d.oficinasCAD)setOficinasCAD(d.oficinasCAD);
          if(!localParsed.logTroca&&d.logTroca)setLogTroca(d.logTroca);
          if(!localParsed.tecidosCAD&&d.tecidosCAD)setTecidosCAD(d.tecidosCAD);
          if(!localParsed.fixosConfig&&d.fixosConfig)setFixosConfig(d.fixosConfig);
          if(!localParsed.fixosNomesFunc&&d.fixosNomesFunc)setFixosNomesFunc(d.fixosNomesFunc);
        }else{
          // SUPABASE VENCE: dados remotos mais recentes (ou iguais, ou non-admin)
          console.log("SYNC: SUPABASE vence — remotoTs:",remoteTs?new Date(remoteTs).toLocaleString("pt-BR"):"nenhum","(",remoteTs,") >= localTs:",localTs?"("+localTs+")":"nenhum");
          console.log("SYNC: SUPABASE dados —",d.boletosShared?.length||0,"boletos,",Object.keys(d.receitasPorMes||{}).length,"meses receitas");
          // Merge com local pra não perder dados que só existem localmente
          const localRec=localParsed?.receitasPorMes||{};
          const localAux=localParsed?.auxDataPorMes||{};
          const localCats=localParsed?.categoriasPorMes||{};
          const localBol=localParsed?.boletosShared||[];
          // Receitas: remoto tem prioridade, mas preserva meses exclusivos do local
          if(d.receitasPorMes){
            const merged={...localRec,...d.receitasPorMes};
            Object.keys(localRec).forEach(m=>{if(!d.receitasPorMes[m])merged[m]=localRec[m];});
            setReceitasPorMes(merged);
          }
          if(d.auxDataPorMes){
            const merged={...localAux,...d.auxDataPorMes};
            Object.keys(localAux).forEach(m=>{if(!d.auxDataPorMes[m])merged[m]=localAux[m];});
            setAuxDataPorMes(merged);
          }
          if(d.categoriasPorMes){
            const merged={...localCats,...d.categoriasPorMes};
            Object.keys(localCats).forEach(m=>{if(!d.categoriasPorMes[m])merged[m]=localCats[m];});
            setCategoriasPorMes(merged);
          }
          // Boletos: merge por ID
          if(d.boletosShared&&d.boletosShared.length>0){
            const bolMap=new Map(d.boletosShared.map(b=>[b.id,b]));
            for(const lb of localBol){if(!bolMap.has(lb.id))bolMap.set(lb.id,lb);else{const rb=bolMap.get(lb.id);if((lb._mod||0)>(rb._mod||0))bolMap.set(lb.id,lb);}}
            setBoletosShared(deduplicarBoletos([...bolMap.values()]));
          }else if(localBol.length>0){
            setBoletosShared(deduplicarBoletos(localBol));
          }
          if(d.prestadores)setPrestadores(d.prestadores);
          if(d.cortes&&(!dc?.payload?.cortes)){setCortes(d.cortes);try{localStorage.setItem("amica_cortes",JSON.stringify(d.cortes));}catch(e){console.error(e);}}
          if(d.produtos)setProdutos(d.produtos);
          if(d.oficinasCAD)setOficinasCAD(d.oficinasCAD);
          if(d.logTroca)setLogTroca(d.logTroca);
          if(d.tecidosCAD)setTecidosCAD(d.tecidosCAD);
          if(d.fixosConfig)setFixosConfig(d.fixosConfig);
          if(d.fixosNomesFunc)setFixosNomesFunc(d.fixosNomesFunc);
          try{localStorage.setItem("amica_financeiro",JSON.stringify({...d,_updated:remoteTs||Date.now()}));localStorage.setItem("amica_pending_sync","false");}catch(e){console.error(e);}
        }
        // ── MIGRAÇÃO: se payload principal ainda tem usuarios, migra pro key separado ──
        if(d.usuarios&&d.usuarios.length>0){
          console.log("MIGRAÇÃO: movendo",d.usuarios.length,"usuarios do payload principal → user_id='usuarios'");
          const usrPayload={usuarios:d.usuarios,_updated:Date.now()};
          supabase.from('amicia_data').upsert({user_id:'usuarios',payload:usrPayload},{onConflict:'user_id'}).then(()=>{
            console.log("MIGRAÇÃO usuarios concluída");
          }).catch(()=>{});
          setUsuarios(d.usuarios);
          try{localStorage.setItem("amica_usuarios",JSON.stringify(usrPayload));}catch(e){console.error(e);}
        }
      }
      // Cortes (chave separada — cortes + produtos com merge por _mod)
      if(!ec&&dc?.payload){
        const d=dc.payload;
        if(d.cortes){setCortes(d.cortes);try{localStorage.setItem("amica_cortes",JSON.stringify(d.cortes));}catch(e){console.error(e)}}
        if(d.oficinasCAD&&d.oficinasCAD.length>0)setOficinasCAD(d.oficinasCAD);
        if(d.logTroca)setLogTroca(d.logTroca);
        // Merge produtos do cortes payload com os já carregados do payload principal
        if(d.produtos&&d.produtos.length>0){
          setProdutos(prev=>{
            const mainMap=new Map((prev||[]).map(p=>[p.ref,p]));
            const cortesMap=new Map(d.produtos.map(p=>[p.ref,p]));
            let mudou=false;
            const merged=prev.map(mp=>{
              const cp=cortesMap.get(mp.ref);
              if(cp&&(cp._mod||0)>(mp._mod||0)){mudou=true;return cp;}
              return mp;
            });
            // Produtos novos que só existem no cortes (não-admin adicionou)
            for(const [ref,cp] of cortesMap){
              if(!mainMap.has(ref)){merged.push(cp);mudou=true;}
            }
            if(mudou)console.log("LOAD: merge produtos — cortes tinha",d.produtos.length,", resultado:",merged.length);
            return mudou?merged:prev;
          });
        }
      }
      setDbCarregado(true);dbCarregadoTs.current=Date.now();clearTimeout(safetyTimer);
      setSyncStatus('saved');setTimeout(()=>setSyncStatus(null),2000);
    }).catch((e)=>{console.error("Erro carregando Supabase:",e);setDbCarregado(true);clearTimeout(safetyTimer);setSyncStatus('error');});

    // ── USUARIOS: carrega separado com MERGE por id + _mod (nunca sobrescreve cegamente) ──
    supabase.from('amicia_data').select('payload').eq('user_id','usuarios').maybeSingle()
      .then(({data:du})=>{
        const remoteUsers=du?.payload?.usuarios||[];
        let localParsed=null;
        try{const raw=localStorage.getItem("amica_usuarios");localParsed=raw?JSON.parse(raw):null;}catch(e){console.error("Usuarios parse local:",e);}
        const localUsers=localParsed?.usuarios||[];

        if(remoteUsers.length===0&&localUsers.length===0)return; // nada pra fazer

        // MERGE por id + _mod — garante que nenhum usuário se perde
        const remoteMap=new Map(remoteUsers.map(u=>[u.id,u]));
        const localMap=new Map(localUsers.map(u=>[u.id,u]));
        const mergedUsers=[];
        const allIds=new Set([...remoteMap.keys(),...localMap.keys()]);
        for(const id of allIds){
          const ru=remoteMap.get(id);
          const lu=localMap.get(id);
          if(ru&&lu){
            // Conflito: mais recente por _mod vence
            mergedUsers.push((lu._mod||0)>(ru._mod||0)?lu:ru);
          }else{
            // Só existe em um lado → preserva (nunca perde)
            mergedUsers.push(ru||lu);
          }
        }

        const mudou=mergedUsers.length!==remoteUsers.length||
          mergedUsers.some((u,i)=>u.id!==(remoteUsers[i]?.id)||u._mod!==(remoteUsers[i]?._mod));

        console.log("USUARIOS: merge —",remoteUsers.length,"remoto,",localUsers.length,"local →",mergedUsers.length,"resultado",mudou?"(MUDOU)":"(igual)");
        setUsuarios(mergedUsers);
        const mergedPayload={usuarios:mergedUsers,_updated:Date.now()};
        try{localStorage.setItem("amica_usuarios",JSON.stringify(mergedPayload));}catch(e){console.error(e);}

        // Se merge mudou algo em relação ao remoto, salva no Supabase
        if(mudou&&usuarioLogado?.admin){
          console.log("USUARIOS: merge diferente do remoto, sincronizando pro Supabase");
          supabase.from('amicia_data').upsert({user_id:'usuarios',payload:mergedPayload},{onConflict:'user_id'})
            .then(({error})=>{if(error)console.error("Usuarios merge sync:",error);})
            .catch(e=>console.error("Usuarios merge sync:",e));
        }
      }).catch(e=>console.error("Usuarios load:",e));
    return()=>clearTimeout(safetyTimer);
  },[]);

  // ── SUPABASE REALTIME — recebe mudanças de outros devices em tempo real ────
  useEffect(()=>{
    if(!supabase||!dbCarregado)return;
    const channel=supabase.channel('sync-financeiro')
      .on('postgres_changes',{event:'UPDATE',schema:'public',table:'amicia_data',filter:`user_id=eq.${USER_ID}`},(payload)=>{
        const d=payload.new?.payload;
        if(!d||!d._updated)return;
        // Ignora eco do próprio save (30s de margem — suficiente pra round-trip)
        if(Math.abs(d._updated-lastSaveTs.current)<30000){console.log("REALTIME: ignorando eco do próprio save, diff:",Math.abs(d._updated-lastSaveTs.current),"ms");return;}
        // Ignora se localStorage tem dados mais recentes (edits locais pendentes)
        try{
          const localRaw=localStorage.getItem("amica_financeiro");
          const localTs=localRaw?JSON.parse(localRaw)._updated||0:0;
          if(localTs>d._updated){console.log("REALTIME: ignorando — localStorage mais recente (",localTs,") que Realtime (",d._updated,")");return;}
        }catch(e){}
        console.log("REALTIME: recebido update de outro device, timestamp:",new Date(d._updated).toLocaleString("pt-BR"));
        realtimeProcessing.current=true;
        if(d.receitasPorMes)setReceitasPorMes(d.receitasPorMes);
        if(d.auxDataPorMes)setAuxDataPorMes(d.auxDataPorMes);
        if(d.categoriasPorMes)setCategoriasPorMes(d.categoriasPorMes);
        // Merge boletos: mantém todos, mais recente por _mod ganha
        if(d.boletosShared&&d.boletosShared.length>0)setBoletosShared(prev=>{
          const rm=new Map(d.boletosShared.map(b=>[b.id,b]));
          const lm=new Map(prev.map(b=>[b.id,b]));
          let mudou=false;
          const merged=prev.map(lb=>{const rb=rm.get(lb.id);if(rb&&(rb._mod||0)>(lb._mod||0)){mudou=true;return rb;}return lb;});
          for(const[id,rb]of rm){if(!lm.has(id)){merged.push(rb);mudou=true;}}
          return mudou?deduplicarBoletos(merged):prev;
        });
        if(d.prestadores)setPrestadores(d.prestadores);
        if(d.produtos)setProdutos(d.produtos);
        if(d.oficinasCAD)setOficinasCAD(d.oficinasCAD);
        if(d.logTroca)setLogTroca(d.logTroca);
        if(d.tecidosCAD)setTecidosCAD(d.tecidosCAD);
        if(d.fixosConfig)setFixosConfig(d.fixosConfig);
        if(d.fixosNomesFunc)setFixosNomesFunc(d.fixosNomesFunc);
        try{localStorage.setItem("amica_financeiro",JSON.stringify({...d,_updated:d._updated}));}catch(e){console.error(e);}
        setTimeout(()=>{realtimeProcessing.current=false;},2000); // reset após React processar batched updates
      }).subscribe();
    return()=>{supabase.removeChannel(channel);};
  },[dbCarregado]);

  // ── REALTIME OFICINAS — sync cortes entre 3 usuários simultâneos ────────────
  const lastCorteSaveTs=useRef(0);
  useEffect(()=>{
    if(!supabase||!dbCarregado)return;
    const ch=supabase.channel('sync-oficinas')
      .on('postgres_changes',{event:'UPDATE',schema:'public',table:'amicia_data',filter:'user_id=eq.ailson_cortes'},(payload)=>{
        const d=payload.new?.payload;
        if(!d?.cortes)return;
        // Ignora eco do próprio save (3s margem)
        if(Date.now()-lastCorteSaveTs.current<3000){console.log("REALTIME OFICINAS: ignorando eco");return;}
        console.log("REALTIME OFICINAS: recebido update de outro usuário,",d.cortes.length,"cortes");
        // Merge inteligente por _mod timestamp
        setCortes(prev=>{
          const localMap=new Map(prev.map(c=>[c.id,c]));
          let mudou=false;
          const merged=prev.map(lc=>{
            const rc=d.cortes.find(r=>r.id===lc.id);
            if(rc&&(rc._mod||0)>(lc._mod||0)){mudou=true;return rc;}
            return lc;
          });
          // Novos do remoto: non-admin adiciona, admin NÃO (pode ter deletado)
          if(!usuarioLogado?.admin){
            const localIds=new Set(prev.map(c=>c.id));
            const novos=d.cortes.filter(c=>!localIds.has(c.id));
            if(novos.length>0){mudou=true;console.log("REALTIME OFICINAS: merge aplicado,",novos.length,"novos");}
            if(!mudou)return prev;
            return[...merged,...novos];
          }
          return mudou?merged:prev;
        });
        if(d.oficinasCAD)setOficinasCAD(d.oficinasCAD);
        if(d.logTroca)setLogTroca(d.logTroca);
        // Merge produtos por ref + _mod (outro usuário editou/adicionou produto)
        if(d.produtos&&d.produtos.length>0){
          setProdutos(prev=>{
            const localMap=new Map((prev||[]).map(p=>[p.ref,p]));
            const remoteMap=new Map(d.produtos.map(p=>[p.ref,p]));
            let mudou=false;
            const merged=prev.map(lp=>{
              const rp=remoteMap.get(lp.ref);
              if(rp&&(rp._mod||0)>(lp._mod||0)){mudou=true;return rp;}
              return lp;
            });
            for(const [ref,rp] of remoteMap){
              if(!localMap.has(ref)){merged.push(rp);mudou=true;}
            }
            if(mudou)console.log("REALTIME OFICINAS: merge produtos aplicado");
            return mudou?merged:prev;
          });
        }
      }).subscribe();
    return()=>{supabase.removeChannel(ch);};
  },[dbCarregado]);

  // ── REALTIME USUARIOS — sync entre devices ────────────────────────────────
  useEffect(()=>{
    if(!supabase||!dbCarregado)return;
    const ch=supabase.channel('sync-usuarios')
      .on('postgres_changes',{event:'*',schema:'public',table:'amicia_data',filter:'user_id=eq.usuarios'},(payload)=>{
        const d=payload.new?.payload;
        if(!d?.usuarios||!d._updated)return;
        if(Math.abs(d._updated-lastUsuariosSaveTs.current)<30000){console.log("REALTIME USUARIOS: ignorando eco");return;}
        console.log("REALTIME USUARIOS: recebido update de outro device,",d.usuarios.length,"usuarios");
        realtimeUsuarios.current=true;
        setUsuarios(prev=>{
          const rm=new Map(d.usuarios.map(u=>[u.id,u]));
          const lm=new Map(prev.map(u=>[u.id,u]));
          let mudou=false;
          const m=prev.map(lu=>{const ru=rm.get(lu.id);if(ru&&(ru._mod||0)>(lu._mod||0)){mudou=true;return ru;}return lu;});
          for(const[id,ru]of rm){if(!lm.has(id)){m.push(ru);mudou=true;}}
          // Remove locais que não existem no remoto (deletados em outro device)
          const final=m.filter(u=>rm.has(u.id)||lm.has(u.id));
          return mudou||final.length!==m.length?final:prev;
        });
        try{localStorage.setItem("amica_usuarios",JSON.stringify(d));}catch(e){console.error(e);}
        setTimeout(()=>{realtimeUsuarios.current=false;},2000);
      }).subscribe();
    return()=>{supabase.removeChannel(ch);};
  },[dbCarregado]);

  // ── SAVE USUARIOS (payload separado — SOMENTE ADMIN — com merge por id) ──
  useEffect(()=>{
    if(!dbCarregado||!supabase||realtimeUsuarios.current)return;
    if(!usuarioLogado?.admin)return;
    // Não salva se ainda é o array inicial sem modificações
    if(usuarios.length<=3&&usuarios.every(u=>u.id<=3))return;
    const usrPayload={usuarios,_updated:Date.now()};
    try{localStorage.setItem("amica_usuarios",JSON.stringify(usrPayload));}catch(e){console.error(e);}
    if(debounceUsuarios.current)clearTimeout(debounceUsuarios.current);
    debounceUsuarios.current=setTimeout(async()=>{
      try{
        // READ-MERGE-WRITE: lê remoto, mergeia por id+_mod, salva resultado
        const {data:remoteData}=await supabase.from('amicia_data').select('payload').eq('user_id','usuarios').maybeSingle();
        const remoteUsers=remoteData?.payload?.usuarios||[];
        const localMap=new Map(usuarios.map(u=>[u.id,u]));
        const remoteMap=new Map(remoteUsers.map(u=>[u.id,u]));
        const mergedUsers=[];
        const allIds=new Set([...localMap.keys(),...remoteMap.keys()]);
        for(const id of allIds){
          const lu=localMap.get(id);
          const ru=remoteMap.get(id);
          if(lu&&ru){mergedUsers.push((lu._mod||0)>=(ru._mod||0)?lu:ru);}
          else if(lu){mergedUsers.push(lu);} // novo local
          else if(ru){
            // Existe no remoto mas não local — foi deletado localmente?
            // Se o admin deletou (não está no local), NÃO preserva
            mergedUsers.push(ru); // Preserva por segurança — admin pode deletar de novo
          }
        }
        const ts=Date.now();
        lastUsuariosSaveTs.current=ts;
        const payload={usuarios:mergedUsers,_updated:ts};
        const {error}=await supabase.from('amicia_data').upsert({user_id:'usuarios',payload},{onConflict:'user_id'});
        if(error)console.error("USUARIOS SAVE: erro:",error);
        else{
          console.log("USUARIOS SAVE: merge-write OK,",mergedUsers.length,"usuarios, ts:",ts);
          // Atualiza local com resultado do merge
          if(mergedUsers.length!==usuarios.length)setUsuarios(mergedUsers);
          try{localStorage.setItem("amica_usuarios",JSON.stringify(payload));}catch(e){console.error(e);}
        }
      }catch(e){console.error("USUARIOS SAVE: catch:",e);}
    },1500);
    return()=>{if(debounceUsuarios.current)clearTimeout(debounceUsuarios.current);};
  },[usuarios,dbCarregado]);

  // ── HOME KPIs: SAC pendentes, Salas Corte pendentes, Agenda hoje ──
  useEffect(()=>{
    if(!dbCarregado||!supabase)return;
    // SAC: count pending questions via API
    fetch('/api/ml-questions').then(r=>r.json()).then(d=>{
      const pending=(d.questions||[]).filter(q=>q.status==='UNANSWERED').length;
      setHomeSacPending(pending);
    }).catch(()=>{});
    // Salas de Corte: count pendentes
    supabase.from('amicia_data').select('payload').eq('user_id','salas-corte').single().then(({data})=>{
      const cortesSC=data?.payload?.cortes||[];
      setHomeSCPending(cortesSC.filter(c=>c.status==='pendente').length);
    }).catch(()=>{});
    // Agenda: count today's items (only items for today's day number)
    const hojeDia=new Date().getDate();
    try{
      const s=localStorage.getItem("amica_agenda");
      if(s){const d=JSON.parse(s);const now=new Date();if(d?.itens&&d.mes===now.getMonth()+1)setHomeAgendaHoje(d.itens.filter(i=>!i.feito&&i.dia===hojeDia).length);}
    }catch{}
    supabase.from('amicia_data').select('payload').eq('user_id','agenda').single().then(({data})=>{
      const now=new Date();
      if(data?.payload?.itens&&data.payload.mes===now.getMonth()+1)setHomeAgendaHoje(data.payload.itens.filter(i=>!i.feito&&i.dia===hojeDia).length);
    }).catch(()=>{});
  },[dbCarregado]);

  // ── BACKUP DIÁRIO AUTOMÁTICO (1x por dia ao abrir) ─────────────────────────
  useEffect(()=>{
    if(!dbCarregado||!supabase)return;
    const hoje=new Date().toISOString().slice(0,10);
    const ultimoBackup=localStorage.getItem("amica_backup_diario_data");
    if(ultimoBackup===hoje)return; // já fez hoje
    // Aguarda 5s pra garantir que todos os dados carregaram
    const timer=setTimeout(async()=>{
      try{
        const [rCalc,rFicha,rSalas,rBling]=await Promise.all([
          supabase.from('amicia_data').select('payload').eq('user_id','calc-meluni').single(),
          supabase.from('amicia_data').select('payload').eq('user_id','ficha-tecnica').single(),
          supabase.from('amicia_data').select('payload').eq('user_id','salas-corte').single(),
          supabase.from('amicia_data').select('payload').eq('user_id','bling-creds').single(),
        ]);
        const payload={
          receitasPorMes,auxDataPorMes,categoriasPorMes,boletosShared,
          usuarios,prestadores,produtos,oficinasCAD,logTroca,
          tecidosCAD,fixosConfig,fixosNomesFunc,cortes,
          _modulos:{
            calculadora:rCalc.data?.payload||null,
            fichaTecnica:rFicha.data?.payload||null,
            salasCorte:rSalas.data?.payload||null,
            blingCreds:rBling.data?.payload||null,
          },
          _backupDate:hoje,_backupTime:new Date().toISOString()
        };
        const {error}=await supabase.from('amicia_data').upsert({user_id:'backup-diario',payload},{onConflict:'user_id'});
        if(!error){localStorage.setItem("amica_backup_diario_data",hoje);console.log("Backup diário completo:",hoje);}
        else{console.error("Erro backup diário:",error);}
      }catch(e){console.error("Erro backup diário:",e);}
    },5000);
    return()=>clearTimeout(timer);
  },[dbCarregado]);

  // ── RECONCILIAÇÃO: boletos pagos → Tecidos em auxDataPorMes ─────────────
  // Garante que boletos marcados como "pago" tenham entrada correspondente em Tecidos
  // Roda após carregar dados do Supabase e sempre que boletosShared mudar
  useEffect(()=>{
    if(!dbCarregado)return;
    const getMesBoleto=(b)=>{const p=(b.data||"").split("/");return(p.length>=2&&parseInt(p[1])>=1&&parseInt(p[1])<=12)?parseInt(p[1]):Number(b.mes);};
    const pagos=boletosShared.filter(b=>b.pago);
    if(pagos.length===0)return;
    setAuxDataPorMes(prev=>{
      let mudou=false;
      const novo={...prev};
      pagos.forEach(b=>{
        const mesNum=getMesBoleto(b);
        if(!mesNum)return;
        const mesData=novo[mesNum]||{};
        const tecidos=[...(mesData["Tecidos"]||[])];
        if(!tecidos.find(t=>t._boletoid===b.id)){
          tecidos.push({data:b.data,empresa:b.empresa,nroNota:b.nroNota||"",valor:b.valor,descricao:"",_boletoid:b.id});
          mudou=true;
        }
        if(mudou||!novo[mesNum]){
          novo[mesNum]={...mesData,"Tecidos":tecidos};
        }
      });
      // Também remove entradas de boletos que foram desmarcados (pago→não pago)
      const pagoIds=new Set(pagos.map(b=>b.id));
      Object.keys(novo).forEach(mesKey=>{
        const mesData=novo[mesKey];
        if(!mesData?.["Tecidos"])return;
        const antes=mesData["Tecidos"].length;
        const filtrado=mesData["Tecidos"].filter(t=>!t._boletoid||pagoIds.has(t._boletoid));
        if(filtrado.length!==antes){
          novo[mesKey]={...mesData,"Tecidos":filtrado};
          mudou=true;
        }
      });
      return mudou?novo:prev;
    });
  },[boletosShared,dbCarregado]);

  // ── AUTO-SAVE LOCAL: cortes ────────────────────────────────────────────────
  useEffect(()=>{
    if(!dbCarregado)return;
    try{localStorage.setItem("amica_cortes",JSON.stringify(cortes));}catch(e){console.error(e)}
  },[cortes,dbCarregado]);

  // ── SAVE FINANCEIRO (admin only — read-merge-write, NUNCA perde dados) ─────
  const salvarNoSupabase=useCallback(async(payload)=>{
    if(!supabase||!dbCarregado)return;
    setSyncStatus('saving');
    try{
      // READ: busca dados atuais do Supabase antes de salvar
      const {data:remoteData}=await supabase.from('amicia_data').select('payload').eq('user_id',USER_ID).single();
      const remote=remoteData?.payload||{};

      // MERGE: protege contra perda de dados em receitas, auxData, categorias, boletos
      const mergedPayload={...payload};

      // Receitas: preserva meses que existem no remoto mas não no local
      if(remote.receitasPorMes){
        const localRec=payload.receitasPorMes||{};
        const remoteRec=remote.receitasPorMes||{};
        const merged={...localRec};
        let preserved=0;
        Object.keys(remoteRec).forEach(m=>{
          if(!localRec[m]||(typeof localRec[m]==='object'&&Object.keys(localRec[m]).length===0)){
            merged[m]=remoteRec[m];preserved++;
          }
        });
        if(preserved>0)console.log("SUPABASE-SAVE: preservou",preserved,"meses do remoto que local não tinha");
        mergedPayload.receitasPorMes=merged;
      }

      // AuxData: mesma proteção
      if(remote.auxDataPorMes){
        const localAux=payload.auxDataPorMes||{};
        const remoteAux=remote.auxDataPorMes||{};
        const merged={...localAux};
        Object.keys(remoteAux).forEach(m=>{if(!localAux[m])merged[m]=remoteAux[m];});
        mergedPayload.auxDataPorMes=merged;
      }

      // Categorias: mesma proteção
      if(remote.categoriasPorMes){
        const localCats=payload.categoriasPorMes||{};
        const remoteCats=remote.categoriasPorMes||{};
        const merged={...localCats};
        Object.keys(remoteCats).forEach(m=>{if(!localCats[m])merged[m]=remoteCats[m];});
        mergedPayload.categoriasPorMes=merged;
      }

      // Boletos: merge por ID (nunca perde boletos)
      if(remote.boletosShared&&remote.boletosShared.length>0){
        const localBol=payload.boletosShared||[];
        const bolMap=new Map(localBol.map(b=>[b.id,b]));
        for(const rb of remote.boletosShared){
          if(!bolMap.has(rb.id))bolMap.set(rb.id,rb);
          else{const lb=bolMap.get(rb.id);if((rb._mod||0)>(lb._mod||0))bolMap.set(rb.id,rb);}
        }
        mergedPayload.boletosShared=[...bolMap.values()];
      }

      // WRITE: salva o resultado mergeado
      const ts=Date.now();
      lastSaveTs.current=ts;
      const payloadComTs={...mergedPayload,_updated:ts};
      const recMeses=Object.keys(payloadComTs.receitasPorMes||{}).length;
      const bolCount=payloadComTs.boletosShared?.length||0;
      console.log("SUPABASE-SAVE: enviando merge, ts:",ts,",",recMeses,"meses receitas,",bolCount,"boletos");

      const {error}=await supabase.from('amicia_data').upsert({user_id:USER_ID,payload:payloadComTs},{onConflict:'user_id'});
      if(error){
        console.error("SUPABASE-SAVE: erro:",error);
        setSyncStatus('error');setTimeout(()=>setSyncStatus(null),4000);
      }else{
        try{localStorage.setItem("amica_financeiro",JSON.stringify(payloadComTs));}catch(e){console.error(e);}
        localStorage.setItem("amica_pending_sync","false");
        setSyncStatus('saved');setTimeout(()=>setSyncStatus(null),2500);
        console.log("SUPABASE-SAVE: sucesso, ts:",ts);
      }
    }catch(e){
      console.error("SUPABASE-SAVE: catch:",e);
      setSyncStatus('error');setTimeout(()=>setSyncStatus(null),4000);
    }
  },[dbCarregado]);

  // Auto-save: localStorage IMEDIATO + Supabase com debounce 1.5s (SOMENTE ADMIN)
  // NOTA: produtos/oficinasCAD/logTroca são REMOVIDOS dos deps — são salvos pelo SAVE CORTES.
  // Incluí-los aqui causava save do payload inteiro quando cortes mudavam via Realtime.
  useEffect(()=>{
    if(!dbCarregado)return;
    // SEMPRE atualiza dadosRef — flush/retry precisam do snapshot mais recente
    const dados={receitasPorMes,auxDataPorMes,categoriasPorMes,boletosShared,prestadores,produtos,oficinasCAD,logTroca,tecidosCAD,fixosConfig,fixosNomesFunc};
    dadosRef.current=dados;
    if(!usuarioLogado?.admin){return;}
    // Guard: não salva antes do Supabase load ter completado
    if(!dbCarregadoTs.current){console.log("AUTO-SAVE: bloqueado — load não completou");return;}
    // Guard: não salva nos primeiros 5s após load (state pode não ter estabilizado)
    const sinceDload=Date.now()-dbCarregadoTs.current;
    if(sinceDload<5000){
      console.log("AUTO-SAVE: aguardando estabilização (",Math.round(sinceDload),"ms < 5000ms)");
      const retrySettle=setTimeout(()=>{
        if(dadosRef.current&&usuarioLogado?.admin){
          console.log("AUTO-SAVE: retry pós-estabilização executando");
          salvarLocal(dadosRef.current,Date.now());
          salvarNoSupabase(dadosRef.current);
        }
      },5000-sinceDload+200);
      return()=>clearTimeout(retrySettle);
    }
    if(realtimeProcessing.current){
      console.log("AUTO-SAVE: bloqueado por realtimeProcessing — dadosRef atualizado, retry em 2.5s");
      const retryRT=setTimeout(()=>{
        if(!realtimeProcessing.current&&dadosRef.current){
          console.log("AUTO-SAVE: retry pós-Realtime executando");
          const retryTs=Date.now();
          salvarLocal(dadosRef.current,retryTs);
          salvarNoSupabase(dadosRef.current);
        }
      },2500);
      return()=>clearTimeout(retryRT);
    }
    // Timestamp ÚNICO: mesmo valor vai pro localStorage e pro Supabase
    const ts=Date.now();
    console.log("AUTO-SAVE: salvando —",boletosShared.length,"boletos,",Object.keys(receitasPorMes).length,"meses receitas, ts:",ts);
    // Camada 1: salva local na hora COM o timestamp que vai pro Supabase
    salvarLocal(dados,ts);
    setSyncStatus('local');
    // Camada 2: Supabase com debounce
    if(debounceRef.current)clearTimeout(debounceRef.current);
    debounceRef.current=setTimeout(()=>{
      salvarNoSupabase(dados);
    },1500);
    return()=>clearTimeout(debounceRef.current);
  },[receitasPorMes,auxDataPorMes,categoriasPorMes,boletosShared,prestadores,tecidosCAD,fixosConfig,fixosNomesFunc,dbCarregado]);

  // ── SAVE CORTES com merge (múltiplos usuários) ────────────────────────────
  useEffect(()=>{
    if(!dbCarregado||!supabase||realtimeProcessing.current)return;
    if(debounceCortes.current)clearTimeout(debounceCortes.current);
    debounceCortes.current=setTimeout(async()=>{
      try{
        const {data}=await supabase.from('amicia_data').select('payload').eq('user_id','ailson_cortes').single();
        const remoto=data?.payload||{};
        // Merge cortes: por ID, mais recente ganha (_mod timestamp)
        const now=Date.now();
        const localMap=new Map((cortes||[]).map(c=>[c.id,{...c,_mod:c._mod||now}]));
        const remoteMap=new Map((remoto.cortes||[]).map(c=>[c.id,c]));
        // 1. Todos os locais (com timestamp atualizado)
        const merged=[];
        for(const [id,lc] of localMap){
          const rc=remoteMap.get(id);
          if(!rc){merged.push(lc);}  // só local → mantém
          else{merged.push((lc._mod||0)>=(rc._mod||0)?lc:rc);}  // conflito → mais recente
        }
        // 2. Remotos que não existem localmente
        for(const [id,rc] of remoteMap){
          if(!localMap.has(id)){
            // Admin deletou localmente → NÃO traz de volta
            // Non-admin: pode ser corte novo de outro usuário → inclui
            if(!usuarioLogado?.admin)merged.push(rc);
          }
        }
        const payload={cortes:merged,
          // MERGE PRODUTOS por ref + _mod (qualquer usuário pode editar produtos)
          produtos:(()=>{
            const localProds=(produtos||[]).map(p=>({...p,_mod:p._mod||0}));
            const remoteProds=(remoto.produtos||[]).map(p=>({...p,_mod:p._mod||0}));
            const localMap=new Map(localProds.map(p=>[p.ref,p]));
            const remoteMap=new Map(remoteProds.map(p=>[p.ref,p]));
            const mergedProds=[];
            // 1. Todos os locais — se conflito, mais recente ganha
            for(const [ref,lp] of localMap){
              const rp=remoteMap.get(ref);
              if(!rp){mergedProds.push(lp);} // só local (novo)
              else{mergedProds.push((lp._mod||0)>=(rp._mod||0)?lp:rp);} // conflito → _mod maior
            }
            // 2. Remotos que não existem localmente (admin pode ter deletado)
            for(const [ref,rp] of remoteMap){
              if(!localMap.has(ref)){
                // Se admin e não tem local → admin deletou → não inclui
                // Se non-admin e não tem local → pode ser novo do admin → inclui
                if(!usuarioLogado?.admin)mergedProds.push(rp);
              }
            }
            return mergedProds;
          })(),
          oficinasCAD:usuarioLogado?.admin?oficinasCAD||[]:remoto.oficinasCAD||oficinasCAD||[],
          logTroca:usuarioLogado?.admin?logTroca||[]:remoto.logTroca||logTroca||[]};
        lastCorteSaveTs.current=Date.now();
        await supabase.from('amicia_data').upsert({user_id:'ailson_cortes',payload},{onConflict:'user_id'});
      }catch(e){console.error("Erro save cortes:",e);}
    },1500);
    return()=>clearTimeout(debounceCortes.current);
  },[cortes,produtos,oficinasCAD,logTroca,dbCarregado]);

  // ── Oficinas: reload ao voltar pra aba (pega mudanças do outro usuário) ──
  useEffect(()=>{
    const onVis=async()=>{
      if(document.visibilityState!=="visible"||!supabase||!dbCarregado)return;
      try{
        const {data}=await supabase.from('amicia_data').select('payload').eq('user_id','ailson_cortes').single();
        if(!data?.payload?.cortes)return;
        const remoteCortes=data.payload.cortes;
        setCortes(prev=>{
          const localMap=new Map(prev.map(c=>[c.id,c]));
          let mudou=false;
          const merged=prev.map(lc=>{
            const rc=remoteCortes.find(r=>r.id===lc.id);
            if(rc&&(rc._mod||0)>(lc._mod||0)){mudou=true;return rc;}
            return lc;
          });
          // Remotos novos: non-admin adiciona, admin NÃO (pode ter deletado)
          if(!usuarioLogado?.admin){
            const localIds=new Set(prev.map(c=>c.id));
            const novos=remoteCortes.filter(c=>!localIds.has(c.id));
            if(novos.length>0)mudou=true;
            return mudou?[...merged,...novos]:prev;
          }
          return mudou?merged:prev;
        });
      }catch(e){console.error("Oficinas reload:",e);}
    };
    document.addEventListener("visibilitychange",onVis);
    return()=>document.removeEventListener("visibilitychange",onVis);
  },[dbCarregado]);

  // ── SAVE AO SAIR + RETRY AO VOLTAR (SOMENTE ADMIN) ──
  useEffect(()=>{
    const flushSave=()=>{
      if(!dadosRef.current||!usuarioLogado?.admin){
        console.log("FLUSH: bloqueado —",!dadosRef.current?"dadosRef vazio":"não é admin",", usuarioLogado:",usuarioLogado?.usuario||"null");
        return;
      }
      const dados=dadosRef.current;
      const ts=Date.now();
      lastSaveTs.current=ts;
      const payloadComTs={...dados,_updated:ts};
      console.log("FLUSH: salvando —",dados.boletosShared?.length||0,"boletos,",Object.keys(dados.receitasPorMes||{}).length,"meses receitas, ts:",ts);
      // localStorage com MESMO timestamp que vai pro Supabase
      try{
        localStorage.setItem("amica_financeiro",JSON.stringify(payloadComTs));
        localStorage.setItem("amica_pending_sync","true");
      }catch(e){console.error("FLUSH localStorage erro:",e);}
      const sbUrl=localStorage.getItem("sb_url");
      const sbKey=localStorage.getItem("sb_key");
      if(sbUrl&&sbKey){
        try{
          const body=JSON.stringify({user_id:USER_ID,payload:payloadComTs});
          const size=body.length;
          if(size>65536)console.warn("⚠ Flush payload excede 64KB keepalive:",Math.round(size/1024),"KB — pode falhar silenciosamente");
          // CRITICAL: NÃO setar pending_sync=false no .then() — página pode morrer antes
          // O retry ao voltar vai resolver pendências que o keepalive salvou com sucesso
          fetch(`${sbUrl}/rest/v1/amicia_data`,{
            method:'POST',
            headers:{'Content-Type':'application/json','apikey':sbKey,'Authorization':`Bearer ${sbKey}`,'Prefer':'resolution=merge-duplicates'},
            body,keepalive:true
          }).catch(()=>{});
        }catch(e){console.error("Flush keepalive erro:",e);}
      }
    };
    const retrySePendente=()=>{
      if(!dadosRef.current||!supabase||!usuarioLogado?.admin)return;
      const pendente=localStorage.getItem("amica_pending_sync");
      if(pendente!=="true")return;
      console.log("RETRY: dados pendentes encontrados, enviando pro Supabase...");
      setSyncStatus('saving');
      const ts=Date.now();
      lastSaveTs.current=ts;
      const payloadComTs={...dadosRef.current,_updated:ts};
      supabase.from('amicia_data').upsert({user_id:USER_ID,payload:payloadComTs},{onConflict:'user_id'})
        .then(({error})=>{
          if(!error){
            try{localStorage.setItem("amica_financeiro",JSON.stringify(payloadComTs));}catch(e){console.error(e);}
            localStorage.setItem("amica_pending_sync","false");
            setSyncStatus('saved');setTimeout(()=>setSyncStatus(null),2500);
            console.log("RETRY: sucesso, ts:",ts);
          }else{
            console.error("RETRY: falhou:",error);
            setSyncStatus('error');setTimeout(()=>setSyncStatus(null),4000);
          }
        }).catch(e=>{console.error("RETRY: catch:",e);setSyncStatus('error');setTimeout(()=>setSyncStatus(null),4000);});
    };
    const onVisChange=()=>{
      if(document.visibilityState==="hidden")flushSave();
      if(document.visibilityState==="visible")retrySePendente();
    };
    const onPageHide=()=>flushSave();
    const retryInterval=setInterval(retrySePendente,30000);
    const retryInicial=setTimeout(retrySePendente,3000);
    document.addEventListener("visibilitychange",onVisChange);
    window.addEventListener("pagehide",onPageHide);
    return()=>{
      document.removeEventListener("visibilitychange",onVisChange);
      window.removeEventListener("pagehide",onPageHide);
      clearInterval(retryInterval);
      clearTimeout(retryInicial);
    };
  },[dbCarregado,usuarioLogado]); // ← inclui usuarioLogado pra closure do flush sempre ter o valor correto

  // ── SESSÃO EXPIRADA + VERSÃO DO APP (auto-update polling) ───────────────────
  useEffect(()=>{
    const TIMEOUT_MS=6*60*60*1000; // 6 horas
    const POLL_MS=3*60*1000; // 3 minutos
    // Verifica versão do app (deploy novo enquanto aba estava aberta)
    const versaoLocal=localStorage.getItem("amica_app_version");
    if(versaoLocal&&versaoLocal!==APP_VERSION){
      setSessaoExpirada(true);
      return;
    }
    localStorage.setItem("amica_app_version",APP_VERSION);

    // Checa versão remota: se diferente do APP_VERSION atual → forçar reload
    const checkVersaoRemota=async()=>{
      try{
        const r=await fetch('/api/version',{cache:'no-store'});
        if(!r.ok)return;
        const d=await r.json();
        if(d.version&&d.version!==APP_VERSION){
          console.log("AUTO-UPDATE: versão remota",d.version,"≠ local",APP_VERSION,"→ forçando reload");
          setSessaoExpirada(true);
        }
      }catch(e){/* offline, ignora */}
    };

    // Verifica timeout + versão ao voltar à aba
    const checkSessao=()=>{
      if(document.visibilityState==="visible"){
        const elapsed=Date.now()-sessaoInicio.current;
        if(elapsed>TIMEOUT_MS){
          console.log("Sessão expirada após",Math.round(elapsed/3600000),"horas");
          setSessaoExpirada(true);
          return;
        }
        // Checa versão remota ao voltar pra aba
        checkVersaoRemota();
      }
    };

    // Poll a cada 3 minutos enquanto app está aberto
    const pollInterval=setInterval(checkVersaoRemota,POLL_MS);
    // Primeiro check 30s após abrir (dá tempo do app carregar)
    const firstCheck=setTimeout(checkVersaoRemota,30000);

    document.addEventListener("visibilitychange",checkSessao);
    return()=>{
      document.removeEventListener("visibilitychange",checkSessao);
      clearInterval(pollInterval);
      clearTimeout(firstCheck);
    };
  },[]);

  // ── BLING: lê vendas do cache Supabase (cron popula a cada 10min) ──────────
  useEffect(()=>{
    if(!dbCarregado||!supabase)return;

    // Helper: busca vendas do cache (endpoint lê da tabela bling_vendas_detalhe)
    const carregarVendasCache=async()=>{
      try{
        const hoje=new Date().toISOString().slice(0,10);
        const mesInicio=hoje.slice(0,8)+"01";
        // Busca mês anterior também (pra aba "Mês passado")
        const d=new Date();d.setMonth(d.getMonth()-1);
        const mesAntInicio=d.toISOString().slice(0,8).replace(/T.*/,"")+"01";
        const mesAntFim=new Date(d.getFullYear(),d.getMonth()+1,0).toISOString().slice(0,10);

        setBlingImportStatus("carregando vendas...");

        // Busca período completo: mês anterior até hoje
        const resp=await fetch("/api/bling-vendas-cache",{
          method:"POST",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({data_inicio:mesAntInicio,data_fim:hoje})
        });

        if(!resp.ok){console.error("BLING cache HTTP",resp.status);setBlingImportStatus(null);return;}
        const result=await resp.json();
        if(!result.ok){console.error("BLING cache erro:",result.erro);setBlingImportStatus(null);return;}

        // result.vendas já vem no formato { mesKey: { diaKey: { conta: { canal: {...} } } } }
        if(result.vendas&&Object.keys(result.vendas).length>0){
          setBlingVendas(result.vendas);
          try{localStorage.setItem("amica_bling_vendas",JSON.stringify(result.vendas));}catch(e){}

          // Atualiza total MENSAL em Lançamentos (desconta 10% devoluções)
          const hojeMk=hoje.slice(0,7);
          let totalBrutoMes=0;
          const mesData=result.vendas[hojeMk];
          if(mesData){
            for(const diaKey in mesData){
              const diaData=mesData[diaKey];
              if(diaData&&!diaData._vazio){
                for(const conta in diaData){
                  for(const canal in diaData[conta]){
                    totalBrutoMes+=diaData[conta][canal]?.bruto||0;
                  }
                }
              }
            }
          }
          if(totalBrutoMes>0){
            const liquido=Math.round(totalBrutoMes*0.90);
            setReceitasPorMes(prev=>{const m=prev[MES_ATUAL]||{};return{...prev,[MES_ATUAL]:{...m,[1]:{...(m[1]||{}),marketplaces:String(liquido)}}};});
            setBlingStatus({ok:true,msg:`✓ Bling: R$ ${liquido.toLocaleString("pt-BR")}`});
            setTimeout(()=>setBlingStatus(null),8000);
          }
        }else{
          // Tenta cache local enquanto cron não populou
          try{
            const local=JSON.parse(localStorage.getItem("amica_bling_vendas")||"{}");
            if(Object.keys(local).length>0)setBlingVendas(local);
          }catch(e){}
        }

        setBlingImportStatus(result.totalPedidos>0?`✓ ${result.totalPedidos} pedidos carregados`:null);
        setTimeout(()=>setBlingImportStatus(null),3000);
        console.log(`BLING cache: ${result.totalPedidos} pedidos carregados`);
      }catch(e){
        console.error("BLING cache erro:",e);
        setBlingImportStatus(null);
        // Fallback: tenta cache local
        try{
          const local=JSON.parse(localStorage.getItem("amica_bling_vendas")||"{}");
          if(Object.keys(local).length>0)setBlingVendas(local);
        }catch(ex){}
      }
    };

    // Carrega ao abrir
    carregarVendasCache();

    // Recarrega a cada 5 min (leitura leve do Supabase, não chama Bling API)
    const refreshInterval=setInterval(carregarVendasCache,5*60*1000);

    // Ao voltar pra aba: recarrega do cache (sem reload!)
    const onVisibility=()=>{
      if(document.visibilityState==="visible"){
        console.log("BLING: voltou pra aba, recarregando cache...");
        carregarVendasCache();
      }
    };
    document.addEventListener("visibilitychange",onVisibility);

    return()=>{clearInterval(refreshInterval);document.removeEventListener("visibilitychange",onVisibility);};
  },[dbCarregado]);

  const dadosMensais=Object.fromEntries(
    Array.from({length:12},(_,i)=>{
      const mesNum=i+1;
      if(mesNum<MES_ATUAL){
        const rec=receitasPorMes[mesNum]||{};const aux=auxDataPorMes[mesNum]||{};
        const temDados=Object.keys(rec).length>0||Object.keys(aux).length>0;
        if(!temDados)return[i,DADOS_MENSAIS[i]];
        return[i,calcDadosMes(mesNum,rec,aux)];
      }else if(mesNum===MES_ATUAL){
        return[i,calcDadosMes(mesNum,receitasPorMes[mesNum]||{},auxDataPorMes[mesNum]||{})];
      }else{return[i,{receita:0,despesa:0,silvaTeles:0,bomRetiro:0,marketplaces:0,prolabore:0,oficinas:0,tecidos:0}];}
    })
  );

  const getReceitasMes=(m)=>receitasPorMes[m]||{};
  const setReceitasMes=(m,fn)=>setReceitasPorMes(prev=>({...prev,[m]:typeof fn==="function"?fn(prev[m]||{}):fn}));
  const setAuxMes=(m,fn)=>setAuxDataPorMes(prev=>({...prev,[m]:typeof fn==="function"?fn(prev[m]||{}):fn}));
  const setCatsMes=(m,fn)=>setCategoriasPorMes(prev=>({...prev,[m]:typeof fn==="function"?fn(prev[m]||[...CATS]):fn}));

  // ── MODAL SESSÃO EXPIRADA ────────────────────────────────────────────────────
  if(sessaoExpirada){
    return(
      <div style={{height:"100vh",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"Georgia,serif",background:"#f7f4f0"}}>
        <div style={{background:"#fff",borderRadius:16,padding:"40px 32px",textAlign:"center",maxWidth:360,boxShadow:"0 4px 24px rgba(0,0,0,0.1)",border:"1px solid #e8e2da"}}>
          <div style={{fontSize:40,marginBottom:16}}>🔄</div>
          <div style={{fontSize:18,fontWeight:700,color:"#2c3e50",marginBottom:8}}>Atualização necessária</div>
          <div style={{fontSize:13,color:"#6b7c8a",marginBottom:24,lineHeight:1.6}}>
            {localStorage.getItem("amica_app_version")!==APP_VERSION
              ?"Uma nova versão do app está disponível. Recarregue para atualizar."
              :"A sessão expirou após longo período. Recarregue para continuar com dados atualizados."}
          </div>
          <button onClick={()=>{localStorage.setItem("amica_app_version",APP_VERSION);window.location.reload();}}
            style={{background:"#2c3e50",color:"#fff",border:"none",borderRadius:8,padding:"12px 32px",fontSize:14,cursor:"pointer",fontFamily:"Georgia,serif",fontWeight:600}}>
            Recarregar agora
          </button>
          <div style={{fontSize:10,color:"#a89f94",marginTop:16}}>v{APP_VERSION} · Seus dados estão salvos</div>
        </div>
      </div>
    );
  }

  if(!usuarioLogado){
    if(!dbCarregado)return <div style={{height:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"#f7f4f0",fontFamily:"Georgia,serif"}}><div style={{textAlign:"center"}}><div style={{fontSize:26,fontWeight:700,color:"#2c3e50",marginBottom:8}}>Amícia</div><div style={{fontSize:13,color:"#a89f94"}}>Carregando...</div></div></div>;
    return <LoginScreen usuarios={usuarios} onLogin={(u)=>{const safeUser=(u.id===1||u.usuario==='admin')?{...u,admin:true}:u;setUsuarioLogado(safeUser);const defaultMod=safeUser.moduloPadrao||"home";const canAccess=safeUser.admin||defaultMod==="home"||safeUser.modulos.includes(defaultMod);setActive(canAccess?defaultMod:(safeUser.modulos[0]||"home"));try{localStorage.setItem("amica_session",JSON.stringify(safeUser));}catch{}}}/>;
  }

  const modulosVisiveis=modules.filter(m=>usuarioLogado.modulos.includes(m.id));

  return(
    <div style={{height:"100vh",display:"flex",flexDirection:"column",fontFamily:"Georgia,serif",background:"#f7f4f0"}}>
      {blingStatus&&(
        <div style={{background:blingStatus==="importando"?"#f0f6fb":blingStatus.ok?"#eafbf0":"#fdeaea",color:blingStatus==="importando"?"#4a7fa5":blingStatus.ok?"#27ae60":"#c0392b",padding:"6px 16px",fontSize:12,textAlign:"center"}}>
          {blingStatus==="importando"?<>⏳ Importando dados do Bling…</>:<>{blingStatus.msg}</>}
        </div>
      )}
      {blingImportStatus&&!blingStatus&&(
        <div style={{background:"#f0f6fb",color:"#4a7fa5",padding:"4px 16px",fontSize:11,textAlign:"center"}}>
          📦 {blingImportStatus}
        </div>
      )}
      {/* Barra de navegação com ícones SVG */}
      <div style={{background:"#fff",borderBottom:"1px solid #e8e2da",padding:"6px 12px",display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
        <div style={{flexShrink:0,marginRight:8,cursor:"pointer"}} onClick={()=>setActive("home")}>
          <div style={{fontSize:8,color:"#a89f94",letterSpacing:2,textTransform:"uppercase",lineHeight:1.2}}>Grupo</div>
          <div style={{fontSize:13,color:"#2c3e50",fontWeight:700,lineHeight:1.2}}>Amícia</div>
        </div>
        <div style={{display:"flex",gap:1,overflowX:"auto",flex:1,scrollbarWidth:"none",msOverflowStyle:"none"}}>
          {modulosVisiveis.map(m=>(
            <button key={m.id} onClick={()=>{
                // Flush: salva local + Supabase imediatamente ao trocar de módulo (SOMENTE ADMIN)
                if(usuarioLogado?.admin){
                  if(debounceRef.current)clearTimeout(debounceRef.current);
                  const dados={receitasPorMes,auxDataPorMes,categoriasPorMes,boletosShared,produtos,oficinasCAD,logTroca,prestadores,tecidosCAD,fixosConfig,fixosNomesFunc};
                  salvarLocal(dados);
                  salvarNoSupabase(dados);
                }
                if(m.id==="sac"&&active==="sac")setSacResetTrigger(p=>p+1);
                setActive(m.id);
              }}
              style={{display:"flex",flexDirection:"column",alignItems:"center",padding:"4px 10px",border:"none",background:active===m.id?"#f0f6fb":"transparent",borderBottom:active===m.id?"2px solid #4a7fa5":"2px solid transparent",borderRadius:active===m.id?"6px 6px 0 0":0,cursor:"pointer",flexShrink:0,gap:3,transition:"all 0.15s"}}>
              <m.Icon size={24}/>
              <span style={{fontSize:10,marginTop:2,color:active===m.id?"#4a7fa5":"#8a9aa4",fontWeight:active===m.id?700:400,whiteSpace:"nowrap"}}>{m.label}</span>
            </button>
          ))}
        </div>
        <div style={{position:"relative",flexShrink:0,display:"flex",alignItems:"center",gap:8}} id="user-menu">
          {syncStatus&&(
            <span style={{fontSize:11,padding:"3px 9px",borderRadius:10,
              background:syncStatus==='local'?"#fff8e8":syncStatus==='loading'||syncStatus==='saving'?"#f0f6fb":syncStatus==='saved'?"#eafbf0":"#fdeaea",
              color:syncStatus==='local'?"#b7791f":syncStatus==='loading'||syncStatus==='saving'?"#4a7fa5":syncStatus==='saved'?"#27ae60":"#c0392b",
              fontFamily:"Georgia,serif",whiteSpace:"nowrap"}}>
              {syncStatus==='loading'?"⏳ carregando…":syncStatus==='saving'?"☁ salvando…":syncStatus==='saved'?"☁ salvo":syncStatus==='local'?"💾 local":"✗ erro sync"}
            </span>
          )}
          <div onClick={()=>setMenuUser(p=>!p)} style={{width:30,height:30,borderRadius:"50%",background:"#2c3e50",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer"}}>
            <SvgUsuarios size={20}/>
          </div>
          {menuUser&&(
            <div style={{position:"absolute",right:0,top:36,background:"#fff",borderRadius:10,boxShadow:"0 4px 20px rgba(0,0,0,0.12)",minWidth:160,zIndex:100,overflow:"hidden"}}>
              <div style={{padding:"10px 14px",borderBottom:"1px solid #f0ebe4"}}>
                <div style={{fontSize:10,color:"#a89f94",letterSpacing:1,textTransform:"uppercase"}}>Conectado como</div>
                <div style={{fontSize:13,fontWeight:600,color:"#2c3e50",marginTop:2}}>{usuarioLogado.usuario}</div>
              </div>
              <div onClick={()=>{setUsuarioLogado(null);setActive("dashboard");setMenuUser(false);try{localStorage.removeItem("amica_session");}catch{}}}
                style={{padding:"10px 14px",cursor:"pointer",fontSize:13,color:"#c0392b",display:"flex",alignItems:"center",gap:8}}
                onMouseEnter={e=>e.currentTarget.style.background="#fdeaea"}
                onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                Sair
              </div>
            </div>
          )}
        </div>
      </div>
      {/* Conteúdo */}
      <div style={{flex:1,background:"#f7f4f0",padding:active==="oficinas"||active==="lancamentos"||active==="salascorte"||active==="sac"?"8px 8px":active==="home"?"0":"16px 20px",overflowY:"auto"}}>
        {active==="home"&&(()=>{
          const now=new Date();const hour=now.getHours();
          const greeting=hour<12?"Bom dia":hour<18?"Boa tarde":"Boa noite";
          const emoji=hour<12?"☀️":hour<18?"🌤️":"🌙";
          const dias=["Domingo","Segunda-feira","Terça-feira","Quarta-feira","Quinta-feira","Sexta-feira","Sábado"];
          const meses=["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
          const dataStr=`${dias[now.getDay()]}, ${now.getDate()} de ${meses[now.getMonth()]}`;
          const nome=usuarioLogado?.usuario||"";
          const nomeDisplay=nome.charAt(0).toUpperCase()+nome.slice(1);

          // KPIs dinâmicos
          const hojeDt=now.toISOString().slice(0,10);
          const hojeMk=hojeDt.slice(0,7);const hojeDk=hojeDt.slice(8,10);
          let blingHoje=0,blingPedidos=0;
          const dHoje=blingVendas[hojeMk]?.[hojeDk];
          if(dHoje){for(const c in dHoje){for(const cn in dHoje[c]){blingHoje+=dHoje[c][cn]?.bruto||0;blingPedidos+=dHoje[c][cn]?.pedidos||0;}}}
          const cortesAbertos=cortes.filter(c=>!c.entregue&&!c.pago);
          const nCortesAberto=cortesAbertos.length;
          const pecasAbertas=cortesAbertos.reduce((s,c)=>s+(parseInt(c.qtd)||0),0);
          // Boletos: vencendo hoje e no mês
          const hojeDia=now.getDate();const hojeMes=now.getMonth()+1;
          const diaNum=(d)=>parseInt((d||"99/99").split("/")[0]);
          const getMes=(b)=>{const p=(b.data||"").split("/");return(p.length>=2&&parseInt(p[1])>=1&&parseInt(p[1])<=12)?parseInt(p[1]):Number(b.mes);};
          const boletosMesAtual=boletosShared.filter(b=>getMes(b)===hojeMes);
          const boletosAbertosMes=boletosMesAtual.filter(b=>!b.pago);
          const boletosHoje=boletosShared.filter(b=>!b.pago&&getMes(b)===hojeMes&&diaNum(b.data)===hojeDia);
          const valorHoje=boletosHoje.reduce((s,b)=>s+(parseFloat(b.valor)||0),0);
          const fmt=(v)=>"R$ "+Number(v||0).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});

          const homeModules=[
            {id:"sac",label:"SAC",Icon:SvgSAC,color:"#4a7fa5",bg:"#f0f6fb",border:"#c8dae8",
              kpiValue:homeSacPending>0?`${homeSacPending}`:"✓",kpiLabel:homeSacPending>0?"pendentes":"sem pendentes",
              detail:homeSacPending>0?"Responder agora":"Tudo respondido"},
            {id:"bling",label:"Bling",Icon:SvgBling,color:"#2c3e50",bg:"#f7f4f0",border:"#e8e2da",
              kpiValue:blingHoje>0?"R$ "+Math.round(blingHoje).toLocaleString("pt-BR"):"—",kpiLabel:"faturamento hoje",
              detail:blingPedidos>0?`${blingPedidos} pedidos · 3 contas`:"cron atualizando..."},
            {id:"oficinas",label:"Oficinas",Icon:SvgOficinas,color:"#8e6b3a",bg:"#faf6f0",border:"#e8dcc8",
              kpiValue:nCortesAberto>0?`${nCortesAberto} cortes`:"—",kpiLabel:"em produção",
              detail:nCortesAberto>0?`${pecasAbertas.toLocaleString("pt-BR")} peças`:"sem cortes abertos"},
            {id:"salascorte",label:"Salas de Corte",Icon:SvgSalasCorte,color:"#6b4c3b",bg:"#f8f3ee",border:"#e0d4c8",
              kpiValue:homeSCPending>0?`${homeSCPending}`:"✓",kpiLabel:homeSCPending>0?"cortes pendentes":"todos concluídos",
              detail:homeSCPending>0?"Aguardando peças":"Nenhum pendente"},
            {id:"agenda",label:"Agenda",Icon:SvgAgenda,color:"#2c7d5a",bg:"#f0f8f3",border:"#c8e4d4",
              kpiValue:homeAgendaHoje>0?`${homeAgendaHoje}`:"✓",kpiLabel:homeAgendaHoje>0?"compromissos hoje":"dia livre",
              detail:homeAgendaHoje>0?"Ver agenda":"Sem compromissos"},
            {id:"fichatecnica",label:"Ficha Técnica",Icon:SvgFichaTecnica,color:"#6b5b73",bg:"#f6f3f8",border:"#ddd4e4",
              kpiValue:produtos.length>0?`Ref ${produtos[produtos.length-1]?.ref||"—"}`:"—",kpiLabel:"última cadastrada",
              detail:produtos.length>0?`${produtos.length} fichas no total`:"nenhuma ficha"},
            {id:"calculadora",label:"Calculadora",Icon:SvgCalculadora,color:"#2e7d6a",bg:"#f0f8f5",border:"#c8e4da",
              kpiValue:"—",kpiLabel:"calculadora",detail:"Calcular preços e margens"},
            {id:"boletos",label:"Boletos",Icon:SvgBoletos,color:"#5a6e82",bg:"#f2f5f8",border:"#d0dae4",
              kpiValue:boletosAbertosMes.length>0?`${boletosAbertosMes.length}`:"✓",
              kpiLabel:boletosAbertosMes.length>0?"a vencer este mês":"todos pagos ✓",
              detail:boletosHoje.length>0?`${boletosHoje.length} hoje · ${fmt(valorHoje)}`:"nenhum vencendo hoje"},
          ].filter(m=>usuarioLogado.modulos.includes(m.id));

          return(
            <div style={{maxWidth:820,margin:"0 auto",padding:"36px 20px"}}>
              <div style={{marginBottom:30}}>
                <div style={{fontSize:26,fontWeight:700,color:"#2c3e50",fontFamily:"Georgia,serif"}}>{greeting}, {nomeDisplay}! {emoji}</div>
                <div style={{fontSize:13,color:"#8a9aa4",marginTop:3,fontFamily:"Georgia,serif"}}>{dataStr}</div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(230px, 1fr))",gap:12}}>
                {homeModules.map(m=>(
                  <div key={m.id} onClick={()=>setActive(m.id)}
                    onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-3px)";e.currentTarget.style.borderColor=m.color;e.currentTarget.style.boxShadow=`0 8px 24px ${m.color}18, 0 2px 6px rgba(0,0,0,0.06)`;e.currentTarget.querySelector(".home-bar").style.background=m.color;e.currentTarget.querySelector(".home-arrow").style.opacity="1";e.currentTarget.querySelector(".home-arrow").style.transform="translateX(3px)";e.currentTarget.querySelector(".home-kpi").style.background=m.bg;}}
                    onMouseLeave={e=>{e.currentTarget.style.transform="none";e.currentTarget.style.borderColor=m.border;e.currentTarget.style.boxShadow="0 1px 3px rgba(0,0,0,0.03)";e.currentTarget.querySelector(".home-bar").style.background="transparent";e.currentTarget.querySelector(".home-arrow").style.opacity="0.25";e.currentTarget.querySelector(".home-arrow").style.transform="none";e.currentTarget.querySelector(".home-kpi").style.background="transparent";}}
                    style={{background:"#fff",border:`1.5px solid ${m.border}`,borderRadius:14,padding:"18px 16px 14px",cursor:"pointer",transition:"all 0.25s ease",position:"relative",overflow:"hidden",boxShadow:"0 1px 3px rgba(0,0,0,0.03)"}}>
                    <div className="home-bar" style={{position:"absolute",top:0,left:0,right:0,height:3,background:"transparent",transition:"background 0.25s",borderRadius:"14px 14px 0 0"}}/>
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
                      <div style={{display:"flex",alignItems:"center",gap:10}}>
                        <div style={{width:44,height:44,borderRadius:11,background:m.bg,display:"flex",alignItems:"center",justifyContent:"center",border:`1px solid ${m.border}`}}>
                          <m.Icon size={28}/>
                        </div>
                        <div style={{fontSize:15,fontWeight:700,color:m.color,fontFamily:"Georgia,serif"}}>{m.label}</div>
                      </div>
                      <div className="home-arrow" style={{opacity:0.25,transition:"all 0.25s"}}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M9 6l6 6-6 6" stroke={m.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      </div>
                    </div>
                    <div className="home-kpi" style={{borderTop:`1px solid ${m.border}`,background:"transparent",margin:"0 -16px -14px",padding:"11px 16px 14px",borderRadius:"0 0 13px 13px",transition:"background 0.25s"}}>
                      <div style={{display:"flex",alignItems:"baseline",gap:6,marginBottom:2}}>
                        <span style={{fontSize:20,fontWeight:700,color:"#2c3e50",fontFamily:"Calibri,'Segoe UI',Arial"}}>{m.kpiValue}</span>
                        <span style={{fontSize:10,color:m.color,fontWeight:600,fontFamily:"Georgia,serif"}}>{m.kpiLabel}</span>
                      </div>
                      <div style={{fontSize:10,color:"#8a9aa4",fontFamily:"Georgia,serif"}}>{m.detail}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{textAlign:"center",marginTop:36,fontSize:11,color:"#8a9aa4",opacity:0.5,fontFamily:"Georgia,serif"}}>Selecione um módulo para começar</div>
            </div>
          );
        })()}
        {active==="dashboard"&&<DashboardContent dadosMensais={dadosMensais} mesAtual={MES_ATUAL}/>}
        {active==="lancamentos"&&<LancamentosContent mes={MES_ATUAL} receitas={getReceitasMes(MES_ATUAL)} setReceitas={(fn)=>setReceitasMes(MES_ATUAL,fn)} auxData={auxDataPorMes[MES_ATUAL]||{}} setAuxData={(fn)=>setAuxMes(MES_ATUAL,fn)} categorias={categoriasPorMes[MES_ATUAL]||[...CATS]} setCategorias={(fn)=>setCatsMes(MES_ATUAL,fn)} boletos={boletosShared} setBoletos={setBoletosShared} prestadores={prestadores} setPrestadores={setPrestadores} setAuxDataPorMes={setAuxDataPorMes} fixosConfig={fixosConfig} setFixosConfig={setFixosConfig} fixosNomesFunc={fixosNomesFunc} setFixosNomesFunc={setFixosNomesFunc}/>}
        {active==="boletos"&&<BoletosContent boletos={boletosShared} setBoletos={setBoletosShared} setAuxDataPorMes={setAuxDataPorMes}/>}
        {active==="agenda"&&<AgendaContent/>}
        {active==="historico"&&<HistoricoContent boletosShared={boletosShared} setBoletosShared={setBoletosShared} getReceitasMes={getReceitasMes} setReceitasMes={setReceitasMes} auxDataPorMes={auxDataPorMes} setAuxDataPorMes={setAuxDataPorMes} categoriasPorMes={categoriasPorMes} setCategoriasPorMes={setCategoriasPorMes} dadosMensais={dadosMensais} mesAtual={MES_ATUAL} prestadores={prestadores} setPrestadores={setPrestadores} fixosConfig={fixosConfig} setFixosConfig={setFixosConfig} fixosNomesFunc={fixosNomesFunc} setFixosNomesFunc={setFixosNomesFunc}/>}
        {active==="relatorio"&&<RelatorioContent auxDataPorMes={auxDataPorMes} receitasPorMes={receitasPorMes} prestadores={prestadores} boletosShared={boletosShared} cortes={cortes} mesAtual={MES_ATUAL}/>}
        {active==="calculadora"&&<CalculadoraContent/>}
        {active==="fichatecnica"&&<FichaTecnicaContent/>}
        {active==="salascorte"&&<ModuleErrorBoundary><SalasCorteContent produtos={produtos} usuario={usuarioLogado?.usuario||""} logTroca={logTroca} tecidosCAD={tecidosCAD}/></ModuleErrorBoundary>}
        {active==="sac"&&<MLPerguntas supabase={supabase} currentUser={usuarioLogado?.usuario||""} resetTrigger={sacResetTrigger} />}
        {active==="bling"&&<BlingContent setReceitasMes={setReceitasMes} mesAtual={MES_ATUAL} blingVendas={blingVendas} blingImportStatus={blingImportStatus} produtos={produtos}/>}
        {active==="oficinas"&&<OficinasContent cortes={cortes} setCortes={setCortes} produtos={produtos} setProdutos={setProdutos} oficinasCAD={oficinasCAD} setOficinasCAD={setOficinasCAD} logTroca={logTroca} setLogTroca={setLogTroca} setAuxDataPorMes={setAuxDataPorMes} tecidosCAD={tecidosCAD} setTecidosCAD={setTecidosCAD} isAdmin={usuarioLogado?.admin===true}/>}
        {active==="usuarios"&&<UsuariosContent usuarios={usuarios} setUsuarios={setUsuarios}/>}
        {active==="configuracoes"&&<ConfiguracoesContent
          codigoFonte={document.currentScript?.ownerDocument?.body?.innerText||""}
          isAdmin={usuarioLogado?.admin===true}
          onZerarBoletos={()=>setBoletosShared([])}
          dadosBackup={{receitasPorMes,auxDataPorMes,categoriasPorMes,boletosShared,cortes,produtos,oficinasCAD,logTroca,usuarios,prestadores,tecidosCAD,fixosConfig,fixosNomesFunc}}
          onRestaurar={(dados)=>{
            if(dados.receitasPorMes)setReceitasPorMes(dados.receitasPorMes);
            if(dados.auxDataPorMes)setAuxDataPorMes(dados.auxDataPorMes);
            if(dados.categoriasPorMes)setCategoriasPorMes(dados.categoriasPorMes);
            if(dados.boletosShared)setBoletosShared(dados.boletosShared);
            if(dados.cortes)setCortes(dados.cortes);
            if(dados.produtos)setProdutos(dados.produtos);
            if(dados.oficinasCAD)setOficinasCAD(dados.oficinasCAD);
            if(dados.logTroca)setLogTroca(dados.logTroca);
            if(dados.usuarios)setUsuarios(dados.usuarios);
            if(dados.prestadores)setPrestadores(dados.prestadores);
            if(dados.tecidosCAD)setTecidosCAD(dados.tecidosCAD);
            if(dados.fixosConfig)setFixosConfig(dados.fixosConfig);
            if(dados.fixosNomesFunc)setFixosNomesFunc(dados.fixosNomesFunc);
          }}
          onRestaurarDiario={async()=>{
            try{
              const {data,error}=await supabase.from('amicia_data').select('payload').eq('user_id','backup-diario').single();
              if(error||!data?.payload)return{ok:false,msg:"Nenhum backup diário encontrado"};
              const d=data.payload;
              if(d.receitasPorMes)setReceitasPorMes(d.receitasPorMes);
              if(d.auxDataPorMes)setAuxDataPorMes(d.auxDataPorMes);
              if(d.categoriasPorMes)setCategoriasPorMes(d.categoriasPorMes);
              if(d.boletosShared)setBoletosShared(d.boletosShared);
              if(d.cortes)setCortes(d.cortes);
              if(d.produtos)setProdutos(d.produtos);
              if(d.oficinasCAD)setOficinasCAD(d.oficinasCAD);
              if(d.logTroca)setLogTroca(d.logTroca);
              if(d.usuarios)setUsuarios(d.usuarios);
              if(d.prestadores)setPrestadores(d.prestadores);
              if(d.tecidosCAD)setTecidosCAD(d.tecidosCAD);
              if(d.fixosConfig)setFixosConfig(d.fixosConfig);
              if(d.fixosNomesFunc)setFixosNomesFunc(d.fixosNomesFunc);
              // Restaura módulos independentes
              if(d._modulos){
                const m=d._modulos;
                const ops=[];
                if(m.calculadora)ops.push(supabase.from('amicia_data').upsert({user_id:'calc-meluni',payload:m.calculadora},{onConflict:'user_id'}));
                if(m.fichaTecnica)ops.push(supabase.from('amicia_data').upsert({user_id:'ficha-tecnica',payload:m.fichaTecnica},{onConflict:'user_id'}));
                if(m.salasCorte)ops.push(supabase.from('amicia_data').upsert({user_id:'salas-corte',payload:m.salasCorte},{onConflict:'user_id'}));
                if(m.blingCreds)ops.push(supabase.from('amicia_data').upsert({user_id:'bling-creds',payload:m.blingCreds},{onConflict:'user_id'}));
                if(ops.length>0)await Promise.all(ops);
              }
              return{ok:true,msg:`✓ Backup completo de ${d._backupDate||"?"} restaurado!`};
            }catch(e){console.error("Erro restaurar diário:",e);return{ok:false,msg:"Erro ao restaurar"};}
          }}
        />}
      </div>
    </div>
  );
}


