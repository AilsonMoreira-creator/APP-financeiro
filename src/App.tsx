// @ts-nocheck
import { useState, useEffect } from “react”;
const MESES = [“Jan”,“Fev”,“Mar”,“Abr”,“Mai”,“Jun”,“Jul”,“Ago”,“Set”,“Out”,“Nov”,“Dez”];
const modules = [
{ id: “dashboard”, icon: “📊”, label: “Dashboard” },
{ id: “lancamentos”, icon: “📋”, label: “Lançamentos” },
{ id: “boletos”, icon: “🧾”, label: “Boletos” },
{ id: “oficinas”, icon: “✂️”, label: “Oficinas” },
{ id: “agenda”, icon: “📅”, label: “Agenda” },
{ id: “historico”, icon: “🗂️”, label: “Histórico” },
{ id: “relatorio”, icon: “📄”, label: “Relatório” },
{ id: “usuarios”, icon: “👥”, label: “Usuários” },
{ id: “configuracoes”, icon: “⚙️”, label: “Config.” },
];
const CATS = [
“Funcionários”,“Free Lances”,“Passadoria”,“Salas Corte”,“Caseado”,
“Carreto”,“Tecidos”,“Oficinas Costura”,“Modelista”,“Piloteiro”,
“Aviamentos”,“Etiquetas/Tags”,
“Gastos Diários Loja e Fábrica”,“Gastos Carro”,“Reforma Loja e Equipamentos”,
“Embalagens”,“Aluguel”,“Representantes”,
“Impostos DAS”,“Contabilidade”,“Giro Empréstimo”,“Taxas Cartão”,“Taxas Marketplaces”,
“Marketing”,“Modelos Fotos”,“Pró-Labore”,“Sistemas”,“Concessionárias”,“Valor de Correção”
];
const SEM_AUX = [“Taxas Cartão”,“Taxas Marketplaces”,“Valor de Correção”];
const CATS_PREST = [“Oficinas Costura”,“Salas Corte”,“Passadoria”];
const FIXOS_FUNC = [
{ label: “Vale Transporte”, valor: 7000 },
{ label: “Café da Manhã”, valor: 4000 },
{ label: “Cestas Básicas”, valor: 3200 },
];
const DOMINGOS_MAR = [1,8,15,22,29];
const PRESTADORES_INICIAL = {
“Oficinas Costura”: [
{id:“01”,nome:“Roberto Belém”},{id:“02”,nome:“Roberto Ita”},{id:“03”,nome:“Hugo”},
{id:“04”,nome:“Dilmo”},{id:“05”,nome:“Senon”},{id:“06”,nome:“Reinaldo Belém”},
{id:“07”,nome:“Oscar”},{id:“08”,nome:“Gimena”},{id:“09”,nome:“Beltran”},
{id:“10”,nome:“Hever”},{id:“11”,nome:“Abad”},{id:“12”,nome:“Joaquim”},{id:“13”,nome:“Paola”},
],
“Salas Corte”: [
{id:“01”,nome:“Antonio”},{id:“02”,nome:“Adalecio”},{id:“03”,nome:“Chico”},
],
“Passadoria”: [
{id:“01”,nome:“Eliana”},{id:“02”,nome:“Ivone”},{id:“03”,nome:“Iara”},{id:“04”,nome:“Perla”},],
};
// FIX: AUX_VAZIO estava truncada
const AUX_VAZIO = Object.fromEntries(
CATS.filter(c => !SEM_AUX.includes(c) && c !== “Funcionários”).map(c => [c, []])
);
// ── Dados discriminados Março 2026 ──
// ── Dados discriminados Março 2026 ──
const AUX_MAR = {
“Funcionários”: [
{nome:“CELIA”,salario:“1267.0”,comissao:“0”,extra:“0”,alimentacao:“0”,vale:””,ferias:””,rescisao:””},
{nome:“CRISTIANE”,salario:“1501.0”,comissao:“0”,extra:“0”,alimentacao:“0”,vale:””,ferias:””,rescisao:””},
{nome:“JEAN”,salario:“1350.0”,comissao:“0”,extra:“200.0”,alimentacao:“0”,vale:””,ferias:””,rescisao:””},
{nome:“GILIARDE”,salario:“1680.0”,comissao:“0”,extra:“200.0”,alimentacao:“0”,vale:””,ferias:””,rescisao:””},
{nome:“PEDRO”,salario:“1537.0”,comissao:“0”,extra:“200.0”,alimentacao:“0”,vale:””,ferias:””,rescisao:””},
{nome:“MATHEUS”,salario:“1500.0”,comissao:“0”,extra:“200.0”,alimentacao:“0”,vale:””,ferias:””,rescisao:””},
{nome:“CLEIDE”,salario:“1267.0”,comissao:“0”,extra:“0”,alimentacao:“0”,vale:””,ferias:””,rescisao:””},
{nome:“VANESSA”,salario:“1267.0”,comissao:“0”,extra:“0”,alimentacao:“0”,vale:””,ferias:””,rescisao:””},
{nome:“TALITA”,salario:“1650.0”,comissao:“0”,extra:“0”,alimentacao:“0”,vale:””,ferias:””,rescisao:””},
{nome:“STEFANY”,salario:“1655.0”,comissao:“0”,extra:“0”,alimentacao:“0”,vale:””,ferias:””,rescisao:””},
{nome:“poly”,salario:“1213.0”,comissao:“0”,extra:“0”,alimentacao:“0”,vale:””,ferias:””,rescisao:””},
{nome:“Gabrielly”,salario:“1400.86”,comissao:“0”,extra:“0”,alimentacao:“0”,vale:””,ferias:””,rescisao:””},
{nome:“Kelly”,salario:“1267.0”,comissao:“0”,extra:“0”,alimentacao:“0”,vale:””,ferias:””,rescisao:””},
{nome:“EMANUELLE”,salario:“1680.0”,comissao:“0”,extra:“0”,alimentacao:“0”,vale:””,ferias:””,rescisao:””},
{nome:“Lucia”,salario:“1267.0”,comissao:“0”,extra:“0”,alimentacao:“0”,vale:””,ferias:””,rescisao:””},
],
…Object.fromEntries(CATS.filter(c=>!SEM_AUX.includes(c)&&c!==“Funcionários”).map(c=>[c,[]])),
“Free Lances”: [{data:””,valor:“3500”,descricao:“free lances”}],
“Passadoria”: [
{data:“03/03”,prestador:“perla”,valor:“2993.0”,descricao:””},
{data:“11/03”,prestador:“guilherme”,valor:“4083.5”,descricao:””},
{data:“11/03”,prestador:“iara”,valor:“800.0”,descricao:””},
{data:“13/03”,prestador:“eliana”,valor:“10389.2”,descricao:””},
],
“Salas Corte”: [
{data:“06/03”,prestador:“ANTONIO”,valor:“2050.0”,descricao:””},
{data:“06/03”,prestador:“AQDALECIO”,valor:“2550.0”,descricao:””},
{data:“06/03”,prestador:“AELSON”,valor:“492.0”,descricao:””},
{data:“13/03”,prestador:“ANTONIO”,valor:“1750.0”,descricao:””},
{data:“13/03”,prestador:“aelson”,valor:“526.0”,descricao:””},
],
“Caseado”: [{data:””,valor:“2500”,descricao:“caseado/estamparia”}],
“Carreto”: [{data:””,valor:“3000”,descricao:“carreto”}],
“Tecidos”: [{data:“02/03”,empresa:“EURO”,nroNota:””,valor:“3438.8”,descricao:””,_boletoid:100},
{data:“02/03”,empresa:“EUROTEXTIL”,nroNota:“NF 30062”,valor:“1582.87”,descricao:””,_boletoid:101},
{data:“02/03”,empresa:“EUROTEXTIL”,nroNota:“NF 529592”,valor:“3442.3”,descricao:””,_boletoid:102},
{data:“02/03”,empresa:“EUROTEXTIL”,nroNota:“NF 529132”,valor:“1459.86”,descricao:””,_boletoid:103},
{data:“02/03”,empresa:“EUROTEXTIL”,nroNota:“NF 529295”,valor:“1458.4”,descricao:””,_boletoid:104},
{data:“02/03”,empresa:“EUROTEXTIL”,nroNota:“NF 529305”,valor:“500.28”,descricao:””,_boletoid:105},
{data:“02/03”,empresa:“EUROTEXTIL”,nroNota:“NF 529307”,valor:“2211.4”,descricao:””,_boletoid:106},
{data:“02/03”,empresa:“EUROTEXTIL”,nroNota:“NF 30263”,valor:“1578.93”,descricao:””,_boletoid:107},
{data:“02/03”,empresa:“EUROTEXTIL”,nroNota:“NF 30515”,valor:“7375.83”,descricao:””,_boletoid:154},
{data:“02/03”,empresa:“EUROTEXTIL”,nroNota:“NF 531345”,valor:“1691.66”,descricao:””,_boletoid:175},
{data:“02/03”,empresa:“EUROTEXTIL”,nroNota:“NF 531627”,valor:“485.7”,descricao:””,_boletoid:188},
{data:“02/03”,empresa:“DIAGONAL TEXTIL”,nroNota:“NF 80778”,valor:“2263.68”,descricao:””,_boletoid:111},
{data:“02/03”,empresa:“EUROTEXTIL”,nroNota:“NF 30494”,valor:“1202.54”,descricao:””,_boletoid:189},
{data:“02/03”,empresa:“EUROTEXTIL”,nroNota:“NF 532936”,valor:“906.11”,descricao:””,_boletoid:176},
{data:“02/03”,empresa:“EUROTEXTIL”,nroNota:“NF 532901”,valor:“1597.52”,descricao:””,_boletoid:177},
{data:“02/03”,empresa:“EUROTEXTIL”,nroNota:“NF 32112”,valor:“1222.52”,descricao:””,_boletoid:181},
{data:“02/03”,empresa:“EUROTEXTIL”,nroNota:“NF 32138”,valor:“7969.46”,descricao:””,_boletoid:182},
{data:“02/03”,empresa:“EUROTEXTIL”,nroNota:“NF 32059”,valor:“1028.98”,descricao:””,_boletoid:178},
{data:“02/03”,empresa:“EUROTEXTIL”,nroNota:“NF 32204”,valor:“1831.92”,descricao:””,_boletoid:190},
{data:“02/03”,empresa:“MARLES”,nroNota:“NF316851”,valor:“3401.0”,descricao:””,_boletoid:119},
{data:“02/03”,empresa:“EUROTEXTIL”,nroNota:“NF 531636”,valor:“1653.21”,descricao:””,_boletoid:192},
{data:“02/03”,empresa:“EUROTEXTIL”,nroNota:“NF 31130”,valor:“1802.56”,descricao:””,_boletoid:184},
{data:“02/03”,empresa:“EUROTEXTIL”,nroNota:“NF 30821”,valor:“3078.16”,descricao:””,_boletoid:185},
{data:“02/03”,empresa:“EUROTEXTIL”,nroNota:“NF 32205”,valor:“1977.93”,descricao:””,_boletoid:193},
{data:“02/03”,empresa:“EUROTEXTIL”,nroNota:“NF32201”,valor:“1350.01”,descricao:””,_boletoid:194},
{data:“02/03”,empresa:“EUROTEXTIL”,nroNota:“NF 32198”,valor:“2075.79”,descricao:””,_boletoid:195},
{data:“03/03”,empresa:“EUROTEXTIL”,nroNota:“NF 530050”,valor:“1892.17”,descricao:””,_boletoid:126},
{data:“03/03”,empresa:“EUROTEXTIL”,nroNota:“NF 530040”,valor:“5832.73”,descricao:””,_boletoid:127},
{data:“03/03”,empresa:“EUROTEXTIL”,nroNota:“NF 30531”,valor:“2006.38”,descricao:””,_boletoid:196},
{data:“03/03”,empresa:“NOUVEAU”,nroNota:“NF 18304”,valor:“3090.27”,descricao:””,_boletoid:129},
{data:“04/03”,empresa:“EUROTEXTIL”,nroNota:“NF 30705”,valor:“8554.77”,descricao:””,_boletoid:155},
{data:“04/03”,empresa:“EUROTEXTIL”,nroNota:“NF 532022”,valor:“1425.61”,descricao:””,_boletoid:160},
{data:“04/03”,empresa:“EUROTEXTIL”,nroNota:“NF 31665”,valor:“1752.77”,descricao:””,_boletoid:163},
{data:“04/03”,empresa:“EUROTEXTIL”,nroNota:“NF532822”,valor:“1425.61”,descricao:””,_boletoid:164},
{data:“04/03”,empresa:“EUROTEXTIL”,nroNota:“NF 32626”,valor:“1321.94”,descricao:””,_boletoid:134},
{data:“05/03”,empresa:“matex”,nroNota:””,valor:“12847.0”,descricao:””,_boletoid:135},
{data:“06/03”,empresa:“romana”,nroNota:””,valor:“1309.0”,descricao:””,_boletoid:136},
{data:“06/03”,empresa:“MARLES”,nroNota:””,valor:“4541.0”,descricao:””,_boletoid:137},
{data:“05/03”,empresa:“euro”,nroNota:””,valor:“1344.63”,descricao:””,_boletoid:180},
{data:“05/03”,empresa:“EUROTEXTIL”,nroNota:“NF 30263”,valor:“1578.86”,descricao:””,_boletoid:139},
{data:“05/03”,empresa:“EUROTEXTIL”,nroNota:“NF 531345”,valor:“1691.66”,descricao:””,_boletoid:175},
{data:“05/03”,empresa:“EUROTEXTIL”,nroNota:“NF 30260”,valor:“1790.32”,descricao:””,_boletoid:141},
{data:“05/03”,empresa:“EUROTEXTIL”,nroNota:“NF 532936”,valor:“906.11”,descricao:””,_boletoid:176},
{data:“05/03”,empresa:“EUROTEXTIL”,nroNota:“NF 532901”,valor:“1597.52”,descricao:””,_boletoid:177},
{data:“05/03”,empresa:“EUROTEXTIL”,nroNota:“NF 31712”,valor:“545.19”,descricao:””,_boletoid:144},
{data:“05/03”,empresa:“EUROTEXTIL”,nroNota:“NF 31705”,valor:“1363.07”,descricao:””,_boletoid:145},
{data:“05/03”,empresa:“EUROTEXTIL”,nroNota:“NF 31711”,valor:“1085.16”,descricao:””,_boletoid:146},{data:“06/03”,empresa:“EUROTEXTIL”,nroNota:“NF 32112”,valor:“1222.52”,descricao:””,_boletoid:181},
{data:“06/03”,empresa:“EUROTEXTIL”,nroNota:“NF 534800”,valor:“9583.09”,descricao:””,_boletoid:148},
{data:“06/03”,empresa:“EUROTEXTIL”,nroNota:“NF 30821”,valor:“3078.16”,descricao:””,_boletoid:185},
{data:“06/03”,empresa:“MARLES”,nroNota:“NF 317339”,valor:“4541.9”,descricao:””,_boletoid:150},
{data:“06/03”,empresa:“PIX CARLINHOS”,nroNota:””,valor:“7594.5”,descricao:””,_boletoid:151},
{data:“09/03”,empresa:“EUROTEXTIL”,nroNota:“NF 530050”,valor:“1892.02”,descricao:””,_boletoid:152},
{data:“09/03”,empresa:“EUROTEXTIL”,nroNota:“NF 530040”,valor:“5832.28”,descricao:””,_boletoid:153},
{data:“09/03”,empresa:“EUROTEXTIL”,nroNota:“NF 30515”,valor:“7375.83”,descricao:””,_boletoid:154},
{data:“09/03”,empresa:“EUROTEXTIL”,nroNota:“NF 30705”,valor:“8554.77”,descricao:””,_boletoid:155},
{data:“09/03”,empresa:“EUROTEXTIL”,nroNota:“NF 531627”,valor:“485.7”,descricao:””,_boletoid:188},
{data:“09/03”,empresa:“EUROTEXTIL”,nroNota:“NF 30494”,valor:“1202.54”,descricao:””,_boletoid:189},
{data:“09/03”,empresa:“EUROTEXTIL”,nroNota:“NF 31414”,valor:“1820.93”,descricao:””,_boletoid:158},
{data:“09/03”,empresa:“EUROTEXTIL”,nroNota:“NF 32204”,valor:“1831.92”,descricao:””,_boletoid:190},
{data:“09/03”,empresa:“EUROTEXTIL”,nroNota:“NF 532022”,valor:“1425.61”,descricao:””,_boletoid:160},
{data:“09/03”,empresa:“EUROTEXTIL”,nroNota:“NF 532402”,valor:“1575.0”,descricao:””,_boletoid:161},
{data:“09/03”,empresa:“EUROTEXTIL”,nroNota:“NF 531636”,valor:“1653.21”,descricao:””,_boletoid:192},
{data:“09/03”,empresa:“EUROTEXTIL”,nroNota:“NF 31665”,valor:“1752.77”,descricao:””,_boletoid:163},
{data:“09/03”,empresa:“EUROTEXTIL”,nroNota:“NF532822”,valor:“1425.61”,descricao:””,_boletoid:164},
{data:“09/03”,empresa:“EUROTEXTIL”,nroNota:“NF 33123”,valor:“1565.89”,descricao:””,_boletoid:165},
{data:“09/03”,empresa:“MEDTEXTIL”,nroNota:“NF 14978”,valor:“1561.51”,descricao:””,_boletoid:166},
{data:“09/03”,empresa:“MEDTEXTIL”,nroNota:“NF 192935”,valor:“6482.5”,descricao:””,_boletoid:167},
{data:“09/03”,empresa:“EUROTEXTIL”,nroNota:“NF 32205”,valor:“1977.93”,descricao:””,_boletoid:193},
{data:“09/03”,empresa:“EUROTEXTIL”,nroNota:“NF32201”,valor:“1350.01”,descricao:””,_boletoid:194},
{data:“09/03”,empresa:“euro”,nroNota:””,valor:“1715.36”,descricao:””,_boletoid:170},
{data:“10/03”,empresa:“euro”,nroNota:””,valor:“2708.22”,descricao:””,_boletoid:171},
{data:“11/03”,empresa:“euro”,nroNota:””,valor:“1486.5”,descricao:””,_boletoid:172},
{data:“12/03”,empresa:“euro”,nroNota:””,valor:“2137.86”,descricao:””,_boletoid:173},
{data:“10/03”,empresa:“DIAGONAL TEXTIL”,nroNota:“NF 80262”,valor:“2011.7”,descricao:””,_boletoid:174},
{data:“10/03”,empresa:“EUROTEXTIL”,nroNota:“NF 531345”,valor:“1691.66”,descricao:””,_boletoid:175},
{data:“10/03”,empresa:“EUROTEXTIL”,nroNota:“NF 532936”,valor:“906.11”,descricao:””,_boletoid:176},
{data:“10/03”,empresa:“EUROTEXTIL”,nroNota:“NF 532901”,valor:“1597.52”,descricao:””,_boletoid:177},
{data:“10/03”,empresa:“EUROTEXTIL”,nroNota:“NF 32059”,valor:“1028.98”,descricao:””,_boletoid:178},
{data:“10/03”,empresa:“HOODORY”,nroNota:“NF 5728”,valor:“5072.26”,descricao:””,_boletoid:179},
{data:“10/03”,empresa:“euro”,nroNota:””,valor:“1344.63”,descricao:””,_boletoid:180},
{data:“11/03”,empresa:“EUROTEXTIL”,nroNota:“NF 32112”,valor:“1222.52”,descricao:””,_boletoid:181},
{data:“11/03”,empresa:“EUROTEXTIL”,nroNota:“NF 32138”,valor:“7969.46”,descricao:””,_boletoid:182},
{data:“11/03”,empresa:“ACT COMERCIO DE TECIDOS”,nroNota:“NF 135355”,valor:“2597.71”,descricao:””,_boletoid:183},
{data:“11/03”,empresa:“EUROTEXTIL”,nroNota:“NF 31130”,valor:“1802.56”,descricao:””,_boletoid:184},
{data:“11/03”,empresa:“EUROTEXTIL”,nroNota:“NF 30821”,valor:“3078.16”,descricao:””,_boletoid:185},
{data:“11/03”,empresa:“EUROTEXTIL”,nroNota:“NF 32155”,valor:“1835.44”,descricao:””,_boletoid:186},
{data:“12/03”,empresa:“EUROTEXTIL”,nroNota:“NF 30515”,valor:“7375.35”,descricao:””,_boletoid:187},
{data:“12/03”,empresa:“EUROTEXTIL”,nroNota:“NF 531627”,valor:“485.7”,descricao:””,_boletoid:188},
{data:“12/03”,empresa:“EUROTEXTIL”,nroNota:“NF 30494”,valor:“1202.54”,descricao:””,_boletoid:189},
{data:“12/03”,empresa:“EUROTEXTIL”,nroNota:“NF 32204”,valor:“1831.92”,descricao:””,_boletoid:190},
{data:“12/03”,empresa:“EUROTEXTIL”,nroNota:“NF536716”,valor:“2137.86”,descricao:””,_boletoid:191},
{data:“12/03”,empresa:“EUROTEXTIL”,nroNota:“NF 531636”,valor:“1653.21”,descricao:””,_boletoid:192},
{data:“12/03”,empresa:“EUROTEXTIL”,nroNota:“NF 32205”,valor:“1977.93”,descricao:””,_boletoid:193},{data:“12/03”,empresa:“EUROTEXTIL”,nroNota:“NF32201”,valor:“1350.01”,descricao:””,_boletoid:194},
{data:“12/03”,empresa:“EUROTEXTIL”,nroNota:“NF 32198”,valor:“2075.79”,descricao:””,_boletoid:195},
{data:“13/03”,empresa:“EUROTEXTIL”,nroNota:“NF 30531”,valor:“2006.38”,descricao:””,*boletoid:196},
],
“Oficinas Costura”: [
{data:“05/03”,prestador:“DILMO”,valor:“20056.5”,descricao:””},
{data:“05/03”,prestador:“JOAQUIM”,valor:“3560.0”,descricao:””},
{data:“05/03”,prestador:“BELTRAO”,valor:“2920.0”,descricao:””},
{data:“06/03”,prestador:“ABAD”,valor:“2640.0”,descricao:””},
{data:“06/03”,prestador:“ROBERO BELEM”,valor:“33406.0”,descricao:””},
{data:“06/03”,prestador:“GIMENA”,valor:“12912.0”,descricao:””},
{data:“09/03”,prestador:“senon”,valor:“5659.0”,descricao:””},
{data:“09/03”,prestador:“oscar”,valor:“6850.0”,descricao:””},
{data:“10/03”,prestador:“roberto ita”,valor:“7936.0”,descricao:””},
{data:“13/03”,prestador:“dilmo”,valor:“18709.0”,descricao:””},
{data:“13/03”,prestador:“hever”,valor:“3828.0”,descricao:””},
{data:“13/03”,prestador:“joaquim”,valor:“3264.0”,descricao:””},
{data:“13/03”,prestador:“paola”,valor:“3528.0”,descricao:””},
{data:“13/03”,prestador:“GIMENA”,valor:“3580.0”,descricao:””},
{data:“13/03”,prestador:“roberto belem”,valor:“30104.0”,descricao:””},
{data:“13/03”,prestador:“reinaldo belem”,valor:“6400.0”,descricao:””},
],
“Piloteiro”: [{data:””,valor:“1000”,descricao:””}],
“Aviamentos”: [
{data:“05/03”,valor:“485.64”,descricao:“ZIPERES - XR”},
{data:“05/03”,valor:“262.22”,descricao:“BOTOES - ANFREA”},
{data:“06/03”,valor:“625.71”,descricao:“BOTOES - DANIEL”},
{data:“11/03”,valor:“8423.0”,descricao:“diversos - nara”},
{data:“11/03”,valor:“590.22”,descricao:“diversos - andrea”},
{data:“11/03”,valor:“597.12”,descricao:“diversos - zr”},
],
“Etiquetas/Tags”: [{data:””,valor:“8755.29”,descricao:“etiqueta/bandeirinha/tag”}],
“Gastos Diários Loja e Fábrica”: [{data:””,valor:“3000”,descricao:“festa/confraternização”}],
“Gastos Carro”: [{data:””,valor:“2000”,descricao:“revisão/seguro/gasolina”}],
“Reforma Loja e Equipamentos”: [{data:””,valor:“15000”,descricao:””}],
“Embalagens”: [{data:””,valor:“6500”,descricao:“sacolas”},{data:””,valor:“200”,descricao:“mktplaces”}],
“Aluguel”: [{data:””,valor:“39192.50”,descricao:“José Paulino”},{data:””,valor:“13536”,descricao:“Loja 07”}],
“Representantes”: [{data:””,valor:“3000”,descricao:“comissão representante”}],
“Contabilidade”: [{data:””,valor:“2200”,descricao:“INSS/FGTS”}],
“Concessionárias”: [{data:””,valor:“950”,descricao:“telefone/internet/luz”}],
“Marketing”: [{data:””,valor:“12000”,descricao:“agência marketing/tráfego pago”}],
“Modelos Fotos”: [{data:””,valor:“4930”,descricao:“modelos/fotos/provador”}],
“Sistemas”: [{data:””,valor:“8000”,descricao:””}],
“Pró-Labore”: [{data:””,valor:“58100”,descricao:””}],
};
// ── Boletos Março 2026 (Tecidos)
const BOLETOS_MAR = [
{id:100,data:“02/03”,mes:3,empresa:“EURO”,nroNota:””,valor:“3438.8”,pago:true},
{id:101,data:“02/03”,mes:3,empresa:“EUROTEXTIL”,nroNota:“NF 30062”,valor:“1582.87”,pago:true},
{id:102,data:“02/03”,mes:3,empresa:“EUROTEXTIL”,nroNota:“NF 529592”,valor:“3442.3”,pago:true},
{id:103,data:“02/03”,mes:3,empresa:“EUROTEXTIL”,nroNota:“NF 529132”,valor:“1459.86”,pago:true},
{id:104,data:“02/03”,mes:3,empresa:“EUROTEXTIL”,nroNota:“NF 529295”,valor:“1458.4”,pago:true},
{id:105,data:“02/03”,mes:3,empresa:“EUROTEXTIL”,nroNota:“NF 529305”,valor:“500.28”,pago:true},
{id:106,data:“02/03”,mes:3,empresa:“EUROTEXTIL”,nroNota:“NF 529307”,valor:“2211.4”,pago:true},
{id:107,data:“02/03”,mes:3,empresa:“EUROTEXTIL”,nroNota:“NF 30263”,valor:“1578.93”,pago:true},
{id:108,data:“02/03”,mes:3,empresa:“EUROTEXTIL”,nroNota:“NF 30515”,valor:“7375.83”,pago:true},
{id:109,data:“02/03”,mes:3,empresa:“EUROTEXTIL”,nroNota:“NF 531345”,valor:“1691.66”,pago:true},
{id:110,data:“02/03”,mes:3,empresa:“EUROTEXTIL”,nroNota:“NF 531627”,valor:“485.7”,pago:true},
{id:111,data:“02/03”,mes:3,empresa:“DIAGONAL TEXTIL”,nroNota:“NF 80778”,valor:“2263.68”,pago:true},
{id:112,data:“02/03”,mes:3,empresa:“EUROTEXTIL”,nroNota:“NF 30494”,valor:“1202.54”,pago:true},
{id:113,data:“02/03”,mes:3,empresa:“EUROTEXTIL”,nroNota:“NF 532936”,valor:“906.11”,pago:true},
{id:114,data:“02/03”,mes:3,empresa:“EUROTEXTIL”,nroNota:“NF 532901”,valor:“1597.52”,pago:true},
{id:115,data:“02/03”,mes:3,empresa:“EUROTEXTIL”,nroNota:“NF 32112”,valor:“1222.52”,pago:true},
{id:116,data:“02/03”,mes:3,empresa:“EUROTEXTIL”,nroNota:“NF 32138”,valor:“7969.46”,pago:true},
{id:117,data:“02/03”,mes:3,empresa:“EUROTEXTIL”,nroNota:“NF 32059”,valor:“1028.98”,pago:true},
{id:118,data:“02/03”,mes:3,empresa:“EUROTEXTIL”,nroNota:“NF 32204”,valor:“1831.92”,pago:true},
{id:119,data:“02/03”,mes:3,empresa:“MARLES”,nroNota:“NF316851”,valor:“3401.0”,pago:true},
{id:120,data:“02/03”,mes:3,empresa:“EUROTEXTIL”,nroNota:“NF 531636”,valor:“1653.21”,pago:true},
{id:121,data:“02/03”,mes:3,empresa:“EUROTEXTIL”,nroNota:“NF 31130”,valor:“1802.56”,pago:true},
{id:122,data:“02/03”,mes:3,empresa:“EUROTEXTIL”,nroNota:“NF 30821”,valor:“3078.16”,pago:true},
{id:123,data:“02/03”,mes:3,empresa:“EUROTEXTIL”,nroNota:“NF 32205”,valor:“1977.93”,pago:true},
{id:124,data:“02/03”,mes:3,empresa:“EUROTEXTIL”,nroNota:“NF32201”,valor:“1350.01”,pago:true},
{id:125,data:“02/03”,mes:3,empresa:“EUROTEXTIL”,nroNota:“NF 32198”,valor:“2075.79”,pago:true},
{id:126,data:“03/03”,mes:3,empresa:“EUROTEXTIL”,nroNota:“NF 530050”,valor:“1892.17”,pago:true},
{id:127,data:“03/03”,mes:3,empresa:“EUROTEXTIL”,nroNota:“NF 530040”,valor:“5832.73”,pago:true},
{id:128,data:“03/03”,mes:3,empresa:“EUROTEXTIL”,nroNota:“NF 30531”,valor:“2006.38”,pago:true},
{id:129,data:“03/03”,mes:3,empresa:“NOUVEAU”,nroNota:“NF 18304”,valor:“3090.27”,pago:true},
{id:130,data:“04/03”,mes:3,empresa:“EUROTEXTIL”,nroNota:“NF 30705”,valor:“8554.77”,pago:true},
{id:131,data:“04/03”,mes:3,empresa:“EUROTEXTIL”,nroNota:“NF 532022”,valor:“1425.61”,pago:true},
{id:132,data:“04/03”,mes:3,empresa:“EUROTEXTIL”,nroNota:“NF 31665”,valor:“1752.77”,pago:true},
{id:133,data:“04/03”,mes:3,empresa:“EUROTEXTIL”,nroNota:“NF532822”,valor:“1425.61”,pago:true},
{id:134,data:“04/03”,mes:3,empresa:“EUROTEXTIL”,nroNota:“NF 32626”,valor:“1321.94”,pago:true},
{id:135,data:“05/03”,mes:3,empresa:“matex”,nroNota:””,valor:“12847.0”,pago:true},
{id:136,data:“06/03”,mes:3,empresa:“romana”,nroNota:””,valor:“1309.0”,pago:true},
{id:137,data:“06/03”,mes:3,empresa:“MARLES”,nroNota:””,valor:“4541.0”,pago:true},
{id:138,data:“05/03”,mes:3,empresa:“euro”,nroNota:””,valor:“1344.63”,pago:true},
{id:139,data:“05/03”,mes:3,empresa:“EUROTEXTIL”,nroNota:“NF 30263”,valor:“1578.86”,pago:true},
{id:140,data:“05/03”,mes:3,empresa:“EUROTEXTIL”,nroNota:“NF 531345”,valor:“1691.66”,pago:true},
{id:141,data:“05/03”,mes:3,empresa:“EUROTEXTIL”,nroNota:“NF 30260”,valor:“1790.32”,pago:true},
{id:142,data:“05/03”,mes:3,empresa:“EUROTEXTIL”,nroNota:“NF 532936”,valor:“906.11”,pago:true},
{id:143,data:“05/03”,mes:3,empresa:“EUROTEXTIL”,nroNota:“NF 532901”,valor:“1597.52”,pago:true},
{id:144,data:“05/03”,mes:3,empresa:“EUROTEXTIL”,nroNota:“NF 31712”,valor:“545.19”,pago:true},
{id:145,data:“05/03”,mes:3,empresa:“EUROTEXTIL”,nroNota:“NF 31705”,valor:“1363.07”,pago:true},{id:146,data:“05/03”,mes:3,empresa:“EUROTEXTIL”,nroNota:“NF 31711”,valor:“1085.16”,pago:true},
{id:147,data:“06/03”,mes:3,empresa:“EUROTEXTIL”,nroNota:“NF 32112”,valor:“1222.52”,pago:true},
{id:148,data:“06/03”,mes:3,empresa:“EUROTEXTIL”,nroNota:“NF 534800”,valor:“9583.09”,pago:true},
{id:149,data:“06/03”,mes:3,empresa:“EUROTEXTIL”,nroNota:“NF 30821”,valor:“3078.16”,pago:true},
{id:150,data:“06/03”,mes:3,empresa:“MARLES”,nroNota:“NF 317339”,valor:“4541.9”,pago:true},
{id:151,data:“06/03”,mes:3,empresa:“PIX CARLINHOS”,nroNota:””,valor:“7594.5”,pago:true},
{id:152,data:“09/03”,mes:3,empresa:“EUROTEXTIL”,nroNota:“NF 530050”,valor:“1892.02”,pago:true},
{id:153,data:“09/03”,mes:3,empresa:“EUROTEXTIL”,nroNota:“NF 530040”,valor:“5832.28”,pago:true},
{id:154,data:“09/03”,mes:3,empresa:“EUROTEXTIL”,nroNota:“NF 30515”,valor:“7375.83”,pago:true},
{id:155,data:“09/03”,mes:3,empresa:“EUROTEXTIL”,nroNota:“NF 30705”,valor:“8554.77”,pago:true},
{id:156,data:“09/03”,mes:3,empresa:“EUROTEXTIL”,nroNota:“NF 531627”,valor:“485.7”,pago:true},
{id:157,data:“09/03”,mes:3,empresa:“EUROTEXTIL”,nroNota:“NF 30494”,valor:“1202.54”,pago:true},
{id:158,data:“09/03”,mes:3,empresa:“EUROTEXTIL”,nroNota:“NF 31414”,valor:“1820.93”,pago:true},
{id:159,data:“09/03”,mes:3,empresa:“EUROTEXTIL”,nroNota:“NF 32204”,valor:“1831.92”,pago:true},
{id:160,data:“09/03”,mes:3,empresa:“EUROTEXTIL”,nroNota:“NF 532022”,valor:“1425.61”,pago:true},
{id:161,data:“09/03”,mes:3,empresa:“EUROTEXTIL”,nroNota:“NF 532402”,valor:“1575.0”,pago:true},
{id:162,data:“09/03”,mes:3,empresa:“EUROTEXTIL”,nroNota:“NF 531636”,valor:“1653.21”,pago:true},
{id:163,data:“09/03”,mes:3,empresa:“EUROTEXTIL”,nroNota:“NF 31665”,valor:“1752.77”,pago:true},
{id:164,data:“09/03”,mes:3,empresa:“EUROTEXTIL”,nroNota:“NF532822”,valor:“1425.61”,pago:true},
{id:165,data:“09/03”,mes:3,empresa:“EUROTEXTIL”,nroNota:“NF 33123”,valor:“1565.89”,pago:true},
{id:166,data:“09/03”,mes:3,empresa:“MEDTEXTIL”,nroNota:“NF 14978”,valor:“1561.51”,pago:true},
{id:167,data:“09/03”,mes:3,empresa:“MEDTEXTIL”,nroNota:“NF 192935”,valor:“6482.5”,pago:true},
{id:168,data:“09/03”,mes:3,empresa:“EUROTEXTIL”,nroNota:“NF 32205”,valor:“1977.93”,pago:true},
{id:169,data:“09/03”,mes:3,empresa:“EUROTEXTIL”,nroNota:“NF32201”,valor:“1350.01”,pago:true},
{id:170,data:“09/03”,mes:3,empresa:“euro”,nroNota:””,valor:“1715.36”,pago:true},
{id:171,data:“10/03”,mes:3,empresa:“euro”,nroNota:””,valor:“2708.22”,pago:true},
{id:172,data:“11/03”,mes:3,empresa:“euro”,nroNota:””,valor:“1486.5”,pago:true},
{id:173,data:“12/03”,mes:3,empresa:“euro”,nroNota:””,valor:“2137.86”,pago:true},
{id:174,data:“10/03”,mes:3,empresa:“DIAGONAL TEXTIL”,nroNota:“NF 80262”,valor:“2011.7”,pago:true},
{id:175,data:“10/03”,mes:3,empresa:“EUROTEXTIL”,nroNota:“NF 531345”,valor:“1691.66”,pago:true},
{id:176,data:“10/03”,mes:3,empresa:“EUROTEXTIL”,nroNota:“NF 532936”,valor:“906.11”,pago:true},
{id:177,data:“10/03”,mes:3,empresa:“EUROTEXTIL”,nroNota:“NF 532901”,valor:“1597.52”,pago:true},
{id:178,data:“10/03”,mes:3,empresa:“EUROTEXTIL”,nroNota:“NF 32059”,valor:“1028.98”,pago:true},
{id:179,data:“10/03”,mes:3,empresa:“HOODORY”,nroNota:“NF 5728”,valor:“5072.26”,pago:true},
{id:180,data:“10/03”,mes:3,empresa:“euro”,nroNota:””,valor:“1344.63”,pago:true},
{id:181,data:“11/03”,mes:3,empresa:“EUROTEXTIL”,nroNota:“NF 32112”,valor:“1222.52”,pago:true},
{id:182,data:“11/03”,mes:3,empresa:“EUROTEXTIL”,nroNota:“NF 32138”,valor:“7969.46”,pago:true},
{id:183,data:“11/03”,mes:3,empresa:“ACT COMERCIO DE TECIDOS”,nroNota:“NF 135355”,valor:“2597.71”,pago:true},
{id:184,data:“11/03”,mes:3,empresa:“EUROTEXTIL”,nroNota:“NF 31130”,valor:“1802.56”,pago:true},
{id:185,data:“11/03”,mes:3,empresa:“EUROTEXTIL”,nroNota:“NF 30821”,valor:“3078.16”,pago:true},
{id:186,data:“11/03”,mes:3,empresa:“EUROTEXTIL”,nroNota:“NF 32155”,valor:“1835.44”,pago:true},
{id:187,data:“12/03”,mes:3,empresa:“EUROTEXTIL”,nroNota:“NF 30515”,valor:“7375.35”,pago:true},
{id:188,data:“12/03”,mes:3,empresa:“EUROTEXTIL”,nroNota:“NF 531627”,valor:“485.7”,pago:true},
{id:189,data:“12/03”,mes:3,empresa:“EUROTEXTIL”,nroNota:“NF 30494”,valor:“1202.54”,pago:true},
{id:190,data:“12/03”,mes:3,empresa:“EUROTEXTIL”,nroNota:“NF 32204”,valor:“1831.92”,pago:true},
{id:191,data:“12/03”,mes:3,empresa:“EUROTEXTIL”,nroNota:“NF536716”,valor:“2137.86”,pago:true},
{id:192,data:“12/03”,mes:3,empresa:“EUROTEXTIL”,nroNota:“NF 531636”,valor:“1653.21”,pago:true},{id:193,data:“12/03”,mes:3,empresa:“EUROTEXTIL”,nroNota:“NF 32205”,valor:“1977.93”,pago:true},
{id:194,data:“12/03”,mes:3,empresa:“EUROTEXTIL”,nroNota:“NF32201”,valor:“1350.01”,pago:true},
{id:195,data:“12/03”,mes:3,empresa:“EUROTEXTIL”,nroNota:“NF 32198”,valor:“2075.79”,pago:true},
{id:196,data:“13/03”,mes:3,empresa:“EUROTEXTIL”,nroNota:“NF 30531”,valor:“2006.38”,pago:true},
];
const AUX_INICIAL = {
“Funcionários”: [
{nome:“Ana Paula”, salario:“4200”,comissao:””,extra:””,alimentacao:“400”,vale:“220”,ferias:””,rescisao:””},
{nome:“Carla Lima”,salario:“3800”,comissao:””,extra:””,alimentacao:“400”,vale:“180”,ferias:””,rescisao:””},
{nome:“Márcia R.”, salario:“3500”,comissao:””,extra:””,alimentacao:“400”,vale:“200”,ferias:””,rescisao:””},
],
…AUX_VAZIO,
“Free Lances”: [{data:””,valor:“3500”, descricao:“free lances”}],
“Passadoria”: [{data:””,prestador:””,valor:“18265.70”,descricao:“passadoria total”}],
“Salas Corte”: [{data:””,prestador:””,valor:“7368”, descricao:“corte fora”}],
“Caseado”: [{data:””,valor:“2500”, descricao:“caseado/estamparia”}],
“Carreto”: [{data:””,valor:“3000”, descricao:“carreto”}],
“Tecidos”: [{data:””,valor:“254578.73”,descricao:“NFs diversas”}],
“Oficinas Costura”: [{data:””,prestador:””,valor:“165352.50”,descricao:“total oficinas”}],
“Piloteiro”: [{data:””,valor:“1000”, descricao:””}],
“Aviamentos”: [{data:””,valor:“10983.91”,descricao:””}],
“Etiquetas/Tags”: [{data:””,valor:“8755.29”, descricao:“etiqueta/bandeirinha/tag”}],
“Gastos Diários Loja e Fábrica”: [{data:””,valor:“3000”, descricao:””}],
“Gastos Carro”: [{data:””,valor:“2000”, descricao:“revisão/seguro/gasolina”}],
“Reforma Loja e Equipamentos”: [{data:””,valor:“15000”, descricao:””}],
“Sistemas”: [{data:””,valor:“8000”, descricao:””}],
“Pró-Labore”: [{data:””,valor:“58100”, descricao:””}],
“Contabilidade”: [{data:””,valor:“2200”, descricao:“INSS/FGTS”}],
“Representantes”: [{data:””,valor:“3000”, descricao:“comissão representante”}],
“Concessionárias”: [{data:””,valor:“950”, descricao:“telefone/internet/luz”}],
“Aluguel”: [{data:””,valor:“39192.50”,descricao:“José Paulino”},{data:””,valor:“13536”,descricao:“Loja 07”}],
“Marketing”: [{data:””,valor:“12000”, descricao:“agência marketing/tráfego pago”}],
“Modelos Fotos”: [{data:””,valor:“4930”, descricao:“modelos/fotos/provador”}],
“Embalagens”: [{data:””,valor:“6700”, descricao:“6500 sacolas + 200 mktplaces”}],
};
const AUX_JAN = {
“Funcionários”: [{nome:”(ver planilha)”,salario:“46529”,comissao:””,extra:””,alimentacao:””,ferias:””,rescisao:””}],
…Object.fromEntries(CATS.filter(c=>!SEM_AUX.includes(c)&&c!==“Funcionários”).map(c=>[c,[]])),
“Free Lances”: [{data:””,valor:“6500”, descricao:“free lances”}],
“Passadoria”: [{data:””,prestador:””,valor:“17095”, descricao:“passadoria total”}],
“Caseado”: [{data:””,valor:“2400”, descricao:“caseado/estamparia”}],
“Tecidos”: [{data:””,valor:“613996”, descricao:“NFs diversas”}],
“Oficinas Costura”: [{data:””,prestador:””,valor:“193160”, descricao:“total oficinas”}],
“Salas Corte”: [{data:””,prestador:””,valor:“8760”, descricao:“corte fora”}],
“Modelista”: [{data:””,valor:“3650”, descricao:””}],
“Piloteiro”: [{data:””,valor:“1000”, descricao:””}],“Aviamentos”: [{data:””,valor:“30403”, descricao:””}],
“Gastos Diários Loja e Fábrica”: [{data:””,valor:“6000”, descricao:””}],
“Gastos Carro”: [{data:””,valor:“7500”, descricao:“revisão/seguro/gasolina”}],
“Reforma Loja e Equipamentos”: [{data:””,valor:“5000”, descricao:””}],
“Sistemas”: [{data:””,valor:“4400”, descricao:””}],
“Pró-Labore”: [{data:””,valor:“101500”, descricao:””}],
“Giro Empréstimo”: [{data:“15”,valor:“11089”,descricao:“dia 15”}],
“Contabilidade”: [{data:””,valor:“16043”, descricao:“INSS/FGTS”}],
“Impostos DAS”: [{data:””,valor:“83661”, descricao:””}],
“Representantes”: [{data:””,valor:“3000”, descricao:“comissão representante”}],
“Concessionárias”: [{data:””,valor:“9650”, descricao:“telefone/internet/luz”}],
“Aluguel”: [{data:””,valor:“38811”, descricao:“José Paulino”},{data:””,valor:“13280”,descricao:“Loja 07”}],
“Marketing”: [{data:””,valor:“12000”, descricao:“agência marketing/tráfego pago”}],
“Modelos Fotos”: [{data:””,valor:“11500”, descricao:“modelos/fotos/provador”}],
“Embalagens”: [{data:””,valor:“10500”, descricao:“8500 sacolas + 2000 mktplaces”}],
};
const AUX_FEV = {
“Funcionários”: [{nome:”(ver planilha)”,salario:“70155”,comissao:””,extra:””,alimentacao:””,ferias:””,rescisao:””}],
…Object.fromEntries(CATS.filter(c=>!SEM_AUX.includes(c)&&c!==“Funcionários”).map(c=>[c,[]])),
“Free Lances”: [{data:””,valor:“8500”, descricao:“free lances”}],
“Passadoria”: [{data:””,prestador:””,valor:“18955”, descricao:“passadoria total”}],
“Carreto”: [{data:””,valor:“4500”, descricao:“carreto”}],
“Caseado”: [{data:””,valor:“3000”, descricao:“caseado/estamparia”}],
“Tecidos”: [{data:””,valor:“587302”, descricao:“NFs diversas”}],
“Oficinas Costura”: [{data:””,prestador:””,valor:“261158”, descricao:“total oficinas”}],
“Salas Corte”: [{data:””,prestador:””,valor:“7920”, descricao:“corte fora”}],
“Modelista”: [{data:””,valor:“3450”, descricao:””}],
“Piloteiro”: [{data:””,valor:“1300”, descricao:””}],
“Aviamentos”: [{data:””,valor:“28281”, descricao:””}],
“Gastos Diários Loja e Fábrica”: [{data:””,valor:“6500”, descricao:””}],
“Gastos Carro”: [{data:””,valor:“5153”, descricao:“revisão/seguro/gasolina”}],
“Reforma Loja e Equipamentos”: [{data:””,valor:“15000”, descricao:””}],
“Sistemas”: [{data:””,valor:“9000”, descricao:””}],
“Pró-Labore”: [{data:””,valor:“106000”, descricao:””}],
“Giro Empréstimo”: [{data:“15”,valor:“11089”,descricao:“dia 15”}],
“Contabilidade”: [{data:””,valor:“16681”, descricao:“INSS/FGTS”}],
“Impostos DAS”: [{data:””,valor:“69121”, descricao:””}],
“Representantes”: [{data:””,valor:“4500”, descricao:“comissão representante”}],
“Concessionárias”: [{data:””,valor:“9950”, descricao:“telefone/internet/luz”}],
“Aluguel”: [{data:””,valor:“39192.50”,descricao:“José Paulino”},{data:””,valor:“13286”,descricao:“Loja 07”}],
“Marketing”: [{data:””,valor:“11000”, descricao:“agência marketing/tráfego pago”}],
“Modelos Fotos”: [{data:””,valor:“18000”, descricao:“modelos/fotos/provador”}],
“Embalagens”: [{data:””,valor:“7300”, descricao:“6000 sacolas + 1300 mktplaces”}],
};
// FIX: RECEITAS_MAR declarada (estava solta no PDF sem const)
const RECEITAS_MAR = {
1:{silvaTeles:0, bomRetiro:0, marketplaces:550000},
2:{silvaTeles:7939, bomRetiro:16857,marketplaces:0},
3:{silvaTeles:5070, bomRetiro:21997,marketplaces:0},
4:{silvaTeles:5053, bomRetiro:10515,marketplaces:0},
5:{silvaTeles:9445, bomRetiro:12869,marketplaces:0},
6:{silvaTeles:2674, bomRetiro:7076, marketplaces:0},
7:{silvaTeles:0, bomRetiro:14537,marketplaces:0},
9:{silvaTeles:10780,bomRetiro:5491, marketplaces:0},
10:{silvaTeles:19307,bomRetiro:5839,marketplaces:0},
11:{silvaTeles:12512,bomRetiro:11308,marketplaces:0},
12:{silvaTeles:4041,bomRetiro:29456,marketplaces:0},
13:{silvaTeles:3716,bomRetiro:11688,marketplaces:0},
14:{silvaTeles:0, bomRetiro:9944, marketplaces:0},
};
const RECEITAS_JAN = {
1:{silvaTeles:0,bomRetiro:0,marketplaces:940000},
6:{silvaTeles:1666,bomRetiro:9073,marketplaces:0},7:{silvaTeles:1136,bomRetiro:5853,marketplaces:0},
8:{silvaTeles:4714,bomRetiro:12714,marketplaces:0},9:{silvaTeles:2949,bomRetiro:7600,marketplaces:0},
10:{silvaTeles:1,bomRetiro:7749,marketplaces:0},12:{silvaTeles:3520,bomRetiro:5594,marketplaces:0},
13:{silvaTeles:13666,bomRetiro:8385,marketplaces:0},14:{silvaTeles:6597,bomRetiro:11197,marketplaces:0},
15:{silvaTeles:13347,bomRetiro:6141,marketplaces:0},16:{silvaTeles:5866,bomRetiro:13199,marketplaces:0},
17:{silvaTeles:1,bomRetiro:6519,marketplaces:0},19:{silvaTeles:1352,bomRetiro:5846,marketplaces:0},
20:{silvaTeles:7715,bomRetiro:6979,marketplaces:0},21:{silvaTeles:9008,bomRetiro:3062,marketplaces:0},
22:{silvaTeles:4515,bomRetiro:12657,marketplaces:0},23:{silvaTeles:3976,bomRetiro:25667,marketplaces:0},
24:{silvaTeles:1,bomRetiro:6161,marketplaces:0},26:{silvaTeles:6393,bomRetiro:11703,marketplaces:0},
27:{silvaTeles:4850,bomRetiro:6940,marketplaces:0},28:{silvaTeles:6031,bomRetiro:14771,marketplaces:0},
29:{silvaTeles:5943,bomRetiro:11742,marketplaces:0},30:{silvaTeles:9203,bomRetiro:15539,marketplaces:0},
31:{silvaTeles:1,bomRetiro:6869,marketplaces:0},
};
const RECEITAS_FEV = {
1:{silvaTeles:0,bomRetiro:0,marketplaces:910000},
2:{silvaTeles:4519,bomRetiro:4317,marketplaces:0},3:{silvaTeles:9147,bomRetiro:3020,marketplaces:0},
4:{silvaTeles:2859,bomRetiro:8008,marketplaces:0},5:{silvaTeles:11750,bomRetiro:4575,marketplaces:0},
6:{silvaTeles:4647,bomRetiro:19835,marketplaces:0},7:{silvaTeles:1,bomRetiro:9950,marketplaces:0},
9:{silvaTeles:1,bomRetiro:5100,marketplaces:0},10:{silvaTeles:3163,bomRetiro:10536,marketplaces:0},
11:{silvaTeles:5369,bomRetiro:8648,marketplaces:0},12:{silvaTeles:3817,bomRetiro:5770,marketplaces:0},
13:{silvaTeles:7884,bomRetiro:2179,marketplaces:0},14:{silvaTeles:1,bomRetiro:7575,marketplaces:0},
18:{silvaTeles:4778,bomRetiro:5807,marketplaces:0},19:{silvaTeles:5996,bomRetiro:4582,marketplaces:0},
20:{silvaTeles:7204,bomRetiro:11496,marketplaces:0},21:{silvaTeles:1,bomRetiro:12706,marketplaces:0},
23:{silvaTeles:3637,bomRetiro:7370,marketplaces:0},24:{silvaTeles:39918,bomRetiro:12395,marketplaces:0},
25:{silvaTeles:3228,bomRetiro:6143,marketplaces:0},26:{silvaTeles:7525,bomRetiro:2187,marketplaces:0},
27:{silvaTeles:1194,bomRetiro:3567,marketplaces:0},28:{silvaTeles:1,bomRetiro:9824,marketplaces:0},
};
// FIX: RECEITAS_EXEMPLO definida (causava ReferenceError)
const RECEITAS_EXEMPLO = RECEITAS_MAR;// FIX: DADOS_MENSAIS com todos os campos completos
const DADOS_MENSAIS = {
0:{receita:1278579,despesa:1592870,silvaTeles:112451,bomRetiro:226128,marketplaces:940000,prolabore:101500,oficinas:193160,tecidos:613996},
1:{receita:1202230,despesa:1654416,silvaTeles:126640,bomRetiro:165590,marketplaces:910000,prolabore:106000,oficinas:261158,tecidos:587302},
2:{receita:788116, despesa:849396, silvaTeles:80539, bomRetiro:157577,marketplaces:550000,prolabore:58100, oficinas:165352,tecidos:254578},
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
const HISTORICO = {
2025:{
0:{receita:740743, despesa:834149, silvaTeles:93816, bomRetiro:191927,marketplaces:455000,prolabore:0,oficinas:0,tecidos:0},
1:{receita:826064, despesa:829657, silvaTeles:126186,bomRetiro:229878,marketplaces:470000,prolabore:0,oficinas:0,tecidos:0},
2:{receita:1053919,despesa:1066802,silvaTeles:192870,bomRetiro:261049,marketplaces:600000,prolabore:0,oficinas:0,tecidos:0},
3:{receita:1013511,despesa:1098930,silvaTeles:197422,bomRetiro:241089,marketplaces:575000,prolabore:0,oficinas:0,tecidos:0},
4:{receita:1084786,despesa:1154129,silvaTeles:202140,bomRetiro:262646,marketplaces:620000,prolabore:0,oficinas:0,tecidos:0},
5:{receita:956805, despesa:1082138,silvaTeles:183059,bomRetiro:238746,marketplaces:535000,prolabore:0,oficinas:0,tecidos:0},
6:{receita:1049845,despesa:1126522,silvaTeles:149586,bomRetiro:250259,marketplaces:650000,prolabore:0,oficinas:0,tecidos:0},
7:{receita:1362894,despesa:1260425,silvaTeles:290216,bomRetiro:272678,marketplaces:800000,prolabore:0,oficinas:0,tecidos:0},
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
HISTORICO[y]=Object.fromEntries(Array.from({length:12},(*,i)=>[i,{receita:0,despesa:0,silvaTeles:0,bomRetiro:0,marketplaces:0,prolabore:0,oficinas:0,tecidos:0}]));
});
const fmt=(v)=>{
if(v===0||v===null||v===undefined)return”—”;
const abs=“R$ “+Math.abs(Number(v)).toLocaleString(“pt-BR”,{minimumFractionDigits:2,maximumFractionDigits:2});
return v<0?”-”+abs:abs;
};
const ConfirmDialog=({confirm,onCancel,onConfirm})=>{
if(!confirm)return null;
return(

<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.4)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center"}}>
<div style={{background:"#fff",borderRadius:14,padding:"28px 32px",maxWidth:360,width:"90%",boxShadow:"0 8px 32px rgba(0,0,0,0.18)"}}>
<div style={{fontSize:15,color:"#2c3e50",marginBottom:20,lineHeight:1.5}}>{confirm}</div>
<div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
<button onClick={onCancel} style={{padding:"8px 18px",border:"1px solid #e8e2da",borderRadius:8,background:"#fff",color:"#6b7c8a",cursor:"pointer",fontSize:13}}>Cancelar</button>
<button onClick={onConfirm} style={{padding:"8px 18px",border:"none",borderRadius:8,background:"#c0392b",color:"#fff",cursor:"pointer",fontSize:13,fontWeight:600}}>Confirmar</button>
</div>
</div>
</div>
);
};
const SaveBadge=({status})=>{
if(!status)return null;
return(<span style={{fontSize:11,padding:"3px 10px",borderRadius:10,fontFamily:"Georgia,serif",background:status==="saving"?"#f7f4f0":"#eaf7ee",color:status==="saving"?"#a89f94":"#27ae60"}}>{status==="saving"?"Salvando…":"✓ Salvo"}</span>);
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
const maxVal=Math.max(...Object.values(dadosMensais).map(d=>Math.max(d.receita,d.despesa)),1);return(
<div style={{background:"#fff",borderRadius:12,padding:24,border:"1px solid #e8e2da",marginTop:16}}>
<div style={{fontSize:11,color:"#a89f94",letterSpacing:2,textTransform:"uppercase",marginBottom:16}}>Receita × Despesa 2026</div>
<div style={{display:"flex",alignItems:"flex-end",gap:6,height:120}}>
{MESES.map((mes,i)=>{
const d=dadosMensais[i]||{receita:0,despesa:0};
const rH=(d.receita/maxVal)*100;
const dH=(d.despesa/maxVal)*100;
return(
<div key={mes} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center"}}>
<div style={{width:"100%",display:"flex",gap:2,alignItems:"flex-end",height:100}}>
<div style={{flex:1,background:d.receita>0?"#4a7fa5":"#e8e2da",height:Math.max(rH,2)+"%",borderRadius:"3px 3px 0 0"}}/>
<div style={{flex:1,background:d.despesa>0?"#c0392b22":"#e8e2da",border:d.despesa>0?"1.5px solid #c0392b55":"none",height:Math.max(dH,2)+"%",borderRadius:"3px 3px 0 0"}}/>
</div>
<div style={{fontSize:10,color:"#a89f94",marginTop:4}}>{mes}</div>
</div>
);
})}
</div>
<div style={{display:"flex",gap:20,marginTop:12}}>
<div style={{display:"flex",alignItems:"center",gap:6,fontSize:11,color:"#6b7c8a"}}><div style={{width:10,height:10,background:"#4a7fa5",borderRadius:2}}/>Receita</div>
<div style={{display:"flex",alignItems:"center",gap:6,fontSize:11,color:"#6b7c8a"}}><div style={{width:10,height:10,border:"1.5px solid #c0392b",borderRadius:2}}/>Despesa</div>
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
<div style={{fontSize:11,color:"#a89f94",letterSpacing:2,textTransform:"uppercase",marginBottom:16}}>Evolução por Canal</div>
<div style={{display:"flex",alignItems:"flex-end",gap:10,height:140}}>
{mesesComDados.map(([i,d])=>(
<div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center"}}>
<div style={{width:"100%",display:"flex",gap:2,alignItems:"flex-end",height:110}}>
{canais.map(c=><div key={c.key} style={{flex:1,height:Math.max((d[c.key]/maxVal)*100,2)+"%",background:c.color,borderRadius:"3px 3px 0 0",opacity:0.85}}/>)}
</div>
<div style={{fontSize:10,color:"#a89f94",marginTop:4}}>{MESES[parseInt(i)]}</div>
</div>
))}
</div>
<div style={{display:"flex",gap:20,marginTop:14}}>
{canais.map(c=><div key={c.key} style={{display:"flex",alignItems:"center",gap:6,fontSize:11,color:"#6b7c8a"}}><div style={{width:10,height:10,background:c.color,borderRadius:2}}/>{c.label}</div>)}</div>
</div>
);
};
const DashboardContent=({dadosMensais=DADOS_MENSAIS, mesAtual=3})=>{
const [modo,setModo]=useState("mes");
const [mesSel,setMesSel]=useState(mesAtual-1);
const d = dadosMensais[mesSel]||{receita:0,despesa:0,silvaTeles:0,bomRetiro:0,marketplaces:0,prolabore:0,oficinas:0,tecidos:0};
const ant = dadosMensais[mesSel-1];
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
{varR&&<div style={{fontSize:12,color:Number(varR)>=0?"#27ae60":"#c0392b"}}>{Number(varR)>=0?"+":""}{varR}% vs mês ant.</div>}
</div>
<div style={{background:"#fff",borderRadius:12,padding:22,border:"1px solid #e8e2da"}}>
<div style={{fontSize:11,color:"#a89f94",letterSpacing:2,textTransform:"uppercase",marginBottom:8}}>Despesa</div>
<div style={{fontSize:24,fontWeight:700,color:"#6b7c8a",marginBottom:4}}>{fmt(d.despesa)}</div>
{varD&&<div style={{fontSize:12,color:Number(varD)<=0?"#27ae60":"#c0392b"}}>{Number(varD)>=0?"+":""}{varD}% vs mês ant.</div>}</div>
<div style={{background:"#fff",borderRadius:12,padding:22,border:"1px solid "+(saldo>=0?"#b8dfc8":"#f4b8b8")}}>
<div style={{fontSize:11,color:"#a89f94",letterSpacing:2,textTransform:"uppercase",marginBottom:8}}>Saldo</div>
<div style={{fontSize:24,fontWeight:700,color:saldo>=0?"#4a7fa5":"#c0392b",marginBottom:4}}>{fmt(saldo)}</div>
{d.receita>0&&<div style={{fontSize:12,color:"#8a9aa4"}}>Margem {margem}%</div>}
</div>
</div>
<div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:16,marginBottom:20}}>
{[{label:"Pro Labore",value:d.prolabore},{label:"Oficinas",value:d.oficinas},{label:"Tecidos",value:d.tecidos}].map(c=>(
<div key={c.label} style={{background:"#fff",borderRadius:12,padding:22,border:"1px solid #e8e2da"}}>
<div style={{fontSize:11,color:"#a89f94",letterSpacing:2,textTransform:"uppercase",marginBottom:8}}>{c.label}</div>
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
{[{label:"Receita Acumulada",value:totalAnual.receita,color:"#4a7fa5"},{label:"Despesa Acumulada",value:totalAnual.despesa,color:"#c0392b"},{label:"Saldo Acumulado",value:totalAnual.receita-totalAnual.despesa,color:totalAnual.receita>=totalAnual.despesa?"#27ae60":"#c0392b"}].map(c=>(
<div key={c.label} style={{background:"#fff",borderRadius:12,padding:22,border:"1px solid #e8e2da"}}>
<div style={{fontSize:11,color:"#a89f94",letterSpacing:2,textTransform:"uppercase",marginBottom:8}}>{c.label}</div>
<div style={{fontSize:24,fontWeight:700,color:c.color}}>{fmt(c.value)}</div>
<div style={{fontSize:12,color:"#8a9aa4",marginTop:4}}>Jan — {MESES[n-1]} 2026</div>
</div>
))}
</div>
<div style={{background:"#fff",borderRadius:12,border:"1px solid #e8e2da",overflow:"hidden",marginBottom:16}}>
<div style={{padding:"14px 20px",borderBottom:"1px solid #e8e2da",fontSize:11,color:"#a89f94",letterSpacing:2,textTransform:"uppercase"}}>Média mensal por canal</div>
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
<div style={{padding:"14px 16px",borderBottom:"1px solid #e8e2da",fontSize:11,color:"#a89f94",letterSpacing:2,textTransform:"uppercase"}}>Resumo mensal</div>
<table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
<thead><tr style={{background:"#f7f4f0"}}>{["Mês","Silva Teles","Bom Retiro","Marketplaces","Receita","Despesa","Saldo"].map((h,i)=><th key={h} style={{padding:"10px 14px",textAlign:i===0?"left":"right",color:"#a89f94",fontWeight:600,fontSize:11}}>{h}</th>)}</tr></thead>
<tbody>{MESES.map((mes,i)=>{const d=dadosMensais[i]||{receita:0,despesa:0,silvaTeles:0,bomRetiro:0,marketplaces:0};if(d.receita===0)return null;const s=d.receita-d.despesa;return(<tr key={mes} style={{borderTop:"1px solid #f0ebe4"}}><td style={{padding:"11px 14px",color:"#2c3e50",fontWeight:500}}>{mes} {ANO_ATUAL}</td><td style={{padding:"11px 14px",textAlign:"right",color:"#6b7c8a"}}>{fmt(d.silvaTeles)}</td><td style={{padding:"11px 14px",textAlign:"right",color:"#6b7c8a"}}>{fmt(d.bomRetiro)}</td><td style={{padding:"11px 14px",textAlign:"right",color:"#6b7c8a"}}>{fmt(d.marketplaces)}</td><td style={{padding:"11px 14px",textAlign:"right",color:"#4a7fa5",fontWeight:600}}>{fmt(d.receita)}</td><td style={{padding:"11px 14px",textAlign:"right",color:"#6b7c8a"}}>{fmt(d.despesa)}</td><td style={{padding:"11px 14px",textAlign:"right",color:s>=0?"#27ae60":"#c0392b",fontWeight:600}}>{fmt(s)}</td></tr>);})}</tbody>
</table>
</div><BarChart dadosMensais={dadosMensais}/><ChannelEvolutionChart dadosMensais={dadosMensais}/>
</>
)}
</div>
);
};
const calcTotalAux=(cat,auxData,recTotais,correcao={ativo:false,valor:10000})=>{
if(cat==="Taxas Cartão")return Math.round(recTotais.geral*0.01);
if(cat==="Taxas Marketplaces")return Math.round(recTotais.mkt*0.29);
if(cat==="Valor de Correção")return correcao.ativo?parseFloat(correcao.valor||0):0;
if(cat==="Funcionários"){const func=(auxData["Funcionários"]||[]).reduce((s,r)=>s+["salario","comissao","extra","alimentacao","vale","ferias","rescisao"].reduce((a,f)=>a+parseFloat(r[f]||0),0),0);return func+FIXOS_FUNC.reduce((s,f)=>s+f.valor,0);}
return(auxData[cat]||[]).reduce((s,r)=>s+parseFloat(r.valor||0),0);
};
const calcRowTotal=(row)=>["salario","comissao","extra","alimentacao","vale","ferias","rescisao"].reduce((s,f)=>s+parseFloat(row[f]||0),0);
const PrestadorInput=({row,listaPrest,onUpdate,inputStyle})=>{
const [busca,setBusca]=useState(row.prestador||"");
const [aberto,setAberto]=useState(false);
const sugestoes=busca.trim()?listaPrest.filter(p=>p.id.startsWith(busca)||p.nome.toLowerCase().includes(busca.toLowerCase())):listaPrest;
return(
<div style={{position:"relative"}}>
<input value={busca} onChange={e=>{setBusca(e.target.value);setAberto(true);onUpdate("prestador",e.target.value);}} onFocus={()=>setAberto(true)} onBlur={()=>setTimeout(()=>setAberto(false),150)} placeholder="Nº ou nome..." style={{...inputStyle,textAlign:"left"}}/>
{aberto&&sugestoes.length>0&&(
<div style={{position:"absolute",top:"100%",left:0,right:0,background:"#fff",border:"1px solid #c8d8e4",borderRadius:6,zIndex:100,boxShadow:"0 4px 16px rgba(0,0,0,0.1)",maxHeight:160,overflowY:"auto"}}>
{sugestoes.map(p=>(
<div key={p.id} onMouseDown={()=>{setBusca(p.nome);onUpdate("prestador",p.nome);setAberto(false);}} style={{padding:"8px 12px",cursor:"pointer",fontSize:13,display:"flex",gap:10,alignItems:"center"}} onMouseEnter={e=>e.currentTarget.style.background="#f0f6fb"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
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
<div onClick={()=>setAberto(p=>!p)} style={{padding:"9px 16px",background:"#f7f4f0",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
<span style={{fontSize:11,color:"#a89f94",letterSpacing:2,textTransform:"uppercase"}}>Gerenciar Prestadores</span><span style={{fontSize:12,color:"#a3bacc"}}>{aberto?"▲":"▼"}</span>
</div>
{aberto&&(
<div style={{padding:14,background:"#f9f7f5"}}>
<div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:12}}>
{lista.map(p=>(<div key={p.id} style={{display:"flex",alignItems:"center",gap:6,background:"#fff",border:"1px solid #e8e2da",borderRadius:20,padding:"4px 12px",fontSize:12}}><span style={{color:"#a3bacc",fontWeight:600,fontSize:11}}>{p.id}</span><span style={{color:"#2c3e50"}}>{p.nome}</span><span onClick={()=>remover(p.id)} style={{color:"#c0392b",cursor:"pointer",fontWeight:700,marginLeft:4}}>×</span></div>))}
</div>
<div style={{display:"flex",gap:8}}>
<input value={novoNome} onChange={e=>setNovoNome(e.target.value)} onKeyDown={e=>e.key==="Enter"&&adicionar()} placeholder="Nome do novo prestador..." style={{flex:1,border:"1px solid #a3bacc",borderRadius:6,padding:"6px 10px",fontSize:13,outline:"none"}}/>
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
const listaPrest=prestadores[auxAberta]||[];
const inputStyle={width:"100%",border:"1px solid #c8d8e4",borderRadius:4,padding:"4px 6px",fontSize:12,outline:"none",background:"#fff",fontFamily:"Georgia,serif"};
// Tecidos: data | empresa | nº nota | valor | ×
// Prestadores: data | prestador | valor | ×
// Demais: data | valor | descrição | ×
const gridCols=isTecidos?"80px 1fr 90px 100px 36px":temPrest?"90px 1fr 120px 36px":"90px 120px 1fr 36px";
const headers=isTecidos?["Data","Empresa","Nº Nota","Valor",""]
:temPrest?["Data","Prestador","Valor",""]
:["Data","Valor","Descrição",""];
return(
<>
{temPrest&&!isTecidos&&<GerenciarPrestadores cat={auxAberta} prestadores={prestadores} setPrestadores={setPrestadores}/>}
<div style={{display:"grid",gridTemplateColumns:gridCols,background:"#f7f4f0",borderBottom:"1px solid #e8e2da"}}>
{headers.map((h,i)=><div key={i} style={{padding:"9px 12px",fontSize:11,color:"#a89f94",letterSpacing:1,textTransform:"uppercase"}}>{h}</div>)}
</div>
<div style={{maxHeight:260,overflowY:"auto"}}>
{(auxData[auxAberta]||[]).map((row,idx)=>{
const fromBoleto=!!row._boletoid;
const rowStyle={display:"grid",gridTemplateColumns:gridCols,borderBottom:"1px solid #f0ebe4",background:fromBoleto?"#f0f6fb":"#fff"};
const dis={...inputStyle,background:fromBoleto?"#e8f0f8":"#fff",color:fromBoleto?"#4a7fa5":"#2c3e50"};
return(
<div key={idx} style={rowStyle}>
<div style={{padding:"6px 8px"}}><input value={row.data||""} onChange={e=>updateLinhaAux(auxAberta,idx,"data",e.target.value)} style={fromBoleto?dis:inputStyle} placeholder="dd/mm" readOnly={fromBoleto}/></div>
{isTecidos?(
<>
<div style={{padding:"6px 8px"}}><input value={row.empresa||""} onChange={e=>updateLinhaAux(auxAberta,idx,"empresa",e.target.value)} style={fromBoleto?dis:inputStyle} placeholder="Fornecedor" readOnly={fromBoleto}/></div>
<div style={{padding:"6px 8px"}}><input value={row.nroNota||""} onChange={e=>updateLinhaAux(auxAberta,idx,"nroNota",e.target.value)} style={fromBoleto?dis:inputStyle} placeholder="NF-001" readOnly={fromBoleto}/></div><div style={{padding:"6px 8px"}}><input value={row.valor||""} onChange={e=>updateLinhaAux(auxAberta,idx,"valor",e.target.value)} style={{...(fromBoleto?dis:inputStyle),textAlign:"right"}} placeholder="0,00" readOnly={fromBoleto}/></div>
</>
):temPrest?(
<>
<div style={{padding:"6px 8px"}}><PrestadorInput row={row} listaPrest={listaPrest} onUpdate={(f,v)=>updateLinhaAux(auxAberta,idx,f,v)} inputStyle={inputStyle}/></div>
<div style={{padding:"6px 8px"}}><input value={row.valor||""} onChange={e=>updateLinhaAux(auxAberta,idx,"valor",e.target.value)} style={{...inputStyle,textAlign:"right"}} placeholder="0,00"/></div>
</>
):(
<>
<div style={{padding:"6px 8px"}}><input value={row.valor||""} onChange={e=>updateLinhaAux(auxAberta,idx,"valor",e.target.value)} style={{...inputStyle,textAlign:"right"}} placeholder="0,00"/></div>
<div style={{padding:"6px 8px"}}><input value={row.descricao||""} onChange={e=>updateLinhaAux(auxAberta,idx,"descricao",e.target.value)} placeholder="Descrição" style={inputStyle}/></div>
</>
)}
<div style={{display:"flex",alignItems:"center",justifyContent:"center"}}>
{fromBoleto
?<span style={{fontSize:9,color:"#4a7fa5",padding:"2px 5px",background:"#daeaf7",borderRadius:3}}>boleto</span>
:<span onClick={()=>removeLinhaAux(auxAberta,idx)} style={{color:"#c0392b",cursor:"pointer",fontSize:18,lineHeight:1}}>×</span>
}
</div>
</div>
);
})}
{(auxData[auxAberta]||[]).length===0&&<div style={{padding:24,textAlign:"center",color:"#c0b8b0",fontSize:13}}>Nenhum lançamento</div>}
</div>
<div style={{padding:"12px 16px",background:"#f7f4f0",borderTop:"1px solid #e8e2da"}}>
<button onClick={()=>addLinhaAux(auxAberta)} style={{background:"#2c3e50",color:"#fff",border:"none",borderRadius:6,padding:"7px 16px",fontSize:12,cursor:"pointer",fontFamily:"Georgia,serif"}}>+ Adicionar linha</button>
</div>
</>
);
};
const LancamentosContent=({mes=3,receitas:recProp,setReceitas:setRecProp,auxData:auxProp,setAuxData:setAuxProp,categorias:catsProp,setCategorias:setCatsProp,boletos,setBoletos,prestadores,setPrestadores})=>{
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
const [auxAberta,setAuxAberta]=useState(null);
const hoje=new Date().getDate();const inputStyle={width:"100%",border:"1px solid #c8d8e4",borderRadius:4,padding:"4px 6px",fontSize:13,outline:"none",background:"#fff",fontFamily:"'Courier New',Courier,monospace",fontWeight:600,textAlign:"right"};
const totRec=Object.values(receitas).reduce((a,d)=>({st:a.st+parseFloat(d.silvaTeles||0),br:a.br+parseFloat(d.bomRetiro||0),mkt:a.mkt+parseFloat(d.marketplaces||0)}),{st:0,br:0,mkt:0});
const totalGeral=totRec.st+totRec.br+totRec.mkt;
const recTotais={geral:totalGeral,mkt:totRec.mkt};
const totalDesp=categorias.reduce((s,c)=>s+calcTotalAux(c,auxData,recTotais),0);
const salvarCelula=(dia,canal,val)=>setReceitas(prev=>({...prev,[dia]:{...(prev[dia]||{}),[canal]:parseFloat(val)||0}}));
const updateLinhaAux=(cat,idx,field,val)=>setAuxData(prev=>{const l=[...(prev[cat]||[])];l[idx]={...l[idx],[field]:val};return{...prev,[cat]:l};});
const removeLinhaAux=(cat,idx)=>setAuxData(prev=>{const l=[...(prev[cat]||[])];l.splice(idx,1);return{...prev,[cat]:l};});
const addLinhaAux=(cat)=>{
if(cat==="Funcionários")
setAuxData(prev=>({...prev,[cat]:[...(prev[cat]||[]),{nome:"",salario:"",comissao:"",extra:"",alimentacao:"",vale:"",ferias:"",rescisao:""}]}));
else if(cat==="Tecidos")
setAuxData(prev=>({...prev,[cat]:[...(prev[cat]||[]),{data:"",empresa:"",nroNota:"",valor:"",descricao:""}]}));
else if(CATS_PREST.includes(cat))
setAuxData(prev=>({...prev,[cat]:[...(prev[cat]||[]),{data:"",prestador:"",valor:"",descricao:""}]}));
else
setAuxData(prev=>({...prev,[cat]:[...(prev[cat]||[]),{data:"",valor:"",descricao:""}]}));
};
const adicionarCategoria=()=>{if(!novaCategoria.trim()||categorias.includes(novaCategoria.trim()))return;const nova=novaCategoria.trim();setCategorias(prev=>[...prev,nova]);setAuxData(prev=>({...prev,[nova]:[]}));setNovaCategoria("");};
const removerCategoria=(cat)=>{setCategorias(prev=>prev.filter(c=>c!==cat));setAuxData(prev=>{const n={...prev};delete n[cat];return n;});};
const totalFuncSomente=(auxData["Funcionários"]||[]).reduce((s,r)=>s+calcRowTotal(r),0);
const totalFuncGeral=totalFuncSomente+FIXOS_FUNC.reduce((s,f)=>s+f.valor,0);
return(
<div>
{!auxAberta&&(
<div style={{display:"flex",gap:8,marginBottom:6,background:"#fff",borderRadius:8,padding:"6px 12px",border:"1px solid #e8e2da"}}>
<div style={{flex:1,borderRight:"1px solid #e8e2da",paddingRight:10}}><span style={{fontSize:9,color:"#a89f94",letterSpacing:1,textTransform:"uppercase",marginRight:6}}>Receita</span><span style={{fontSize:13,fontWeight:700,color:"#4a7fa5"}}>{fmt(totalGeral)}</span></div>
<div style={{flex:1,borderRight:"1px solid #e8e2da",paddingRight:10,paddingLeft:6}}><span style={{fontSize:9,color:"#a89f94",letterSpacing:1,textTransform:"uppercase",marginRight:6}}>Despesa</span><span style={{fontSize:13,fontWeight:700,color:"#6b7c8a"}}>{fmt(totalDesp)}</span></div>
<div style={{flex:1,paddingLeft:6}}><span style={{fontSize:9,color:"#a89f94",letterSpacing:1,textTransform:"uppercase",marginRight:6}}>Saldo</span><span style={{fontSize:13,fontWeight:700,color:totalGeral-totalDesp>=0?"#4a7fa5":"#c0392b"}}>{fmt(totalGeral-totalDesp)}</span></div>
</div>
)}
<div style={{display:"flex",gap:0,borderBottom:"1px solid #e8e2da"}}>
<button onClick={()=>{setAba("receitas");setAuxAberta(null);}} style={{padding:"6px 16px",border:"none",borderBottom:aba==="receitas"?"2px solid #4a7fa5":"2px solid transparent",background:"transparent",cursor:"pointer",display:"flex",alignItems:"center",gap:6,fontSize:12,color:aba==="receitas"?"#4a7fa5":"#8a9aa4",fontFamily:"Georgia,serif"}}><IconReceitas ativo={aba==="receitas"}/> Receitas</button>
<button onClick={()=>{setAba("despesas");setAuxAberta(null);}} style={{padding:"6px 16px",border:"none",borderBottom:aba==="despesas"?"2px solid #c0392b":"2px solid transparent",background:"transparent",cursor:"pointer",display:"flex",alignItems:"center",gap:6,fontSize:12,color:aba==="despesas"?"#c0392b":"#8a9aa4",fontFamily:"Georgia,serif"}}><IconDespesas ativo={aba==="despesas"}/> Despesas</button>
<button onClick={()=>{setAba("geral");setAuxAberta(null);}} style={{padding:"6px 16px",border:"none",borderBottom:aba==="geral"?"2px solid #2c3e50":"2px solid transparent",background:"transparent",cursor:"pointer",display:"flex",alignItems:"center",gap:6,fontSize:12,color:aba==="geral"?"#2c3e50":"#8a9aa4",fontFamily:"Georgia,serif"}}> Visão Geral</button>
</div>
{aba==="receitas"&&(
<div style={{background:"#fff",borderRadius:"0 0 12px 12px",border:"1px solid #e8e2da",borderTop:"none"}}>
<div style={{display:"grid",gridTemplateColumns:"28px minmax(0,1fr) minmax(0,1fr) minmax(0,1fr)",background:"#4a7fa5",borderBottom:"1px solid #3a6f95"}}>
<div/>
{["Silva Teles","Bom Retiro","Marketplaces"].map(h=>(
<div key={h} style={{padding:"7px 10px",fontSize:11,color:"#fff",letterSpacing:0.5,textTransform:"uppercase",fontWeight:700,textAlign:"right"}}>{h}</div>
))}
</div>
<div style={{minHeight:300,maxHeight:580,overflowY:"auto"}}>
{Array.from({length:31},(_,i)=>i+1).map(dia=>{
const d=receitas[dia]||{};const isDom=DOMINGOS_MAR.includes(dia);
const futuro=dia>hoje;
return(
<div key={dia} style={{display:"grid",gridTemplateColumns:"28px minmax(0,1fr) minmax(0,1fr) minmax(0,1fr)",borderBottom:"1px solid #f0ebe4",background:isDom?"#e8e4df":futuro?"#fafafa":"#fff"}}>
<div style={{padding:"4px 2px",fontSize:10,color:isDom?"#6b5f54":dia===hoje?"#4a7fa5":"#2c3e50",fontWeight:isDom||dia===hoje?700:400,textAlign:"center",lineHeight:"22px"}}>{dia}</div>
{["silvaTeles","bomRetiro","marketplaces"].map((canal)=>{
const key=dia+"-"+canal;
return(
<div key={canal} style={{padding:"3px 8px",display:"flex",alignItems:"center"}}>
{editando===key?(
<input autoFocus defaultValue={d[canal]||""} style={{...inputStyle,width:"90%",padding:"2px 4px",fontSize:11}} onBlur={e=>{salvarCelula(dia,canal,e.target.value);setEditando(null);}} onKeyDown={e=>{if(e.key==="Enter"){salvarCelula(dia,canal,e.target.value);setEditando(null);}}}/>
):(
<div onClick={()=>!futuro&&setEditando(key)} style={{fontSize:13,color:d[canal]?"#2c3e50":"#d8d0c8",cursor:futuro?"default":"pointer",minWidth:50,fontWeight:d[canal]?700:400,fontFamily:d[canal]?"'Courier New',Courier,monospace":"Georgia,serif",textAlign:"right",width:"100%"}}>
{d[canal]?"R$ "+parseFloat(d[canal]).toLocaleString("pt-BR"):"—"}
</div>
)}
</div>
);
})}
</div>
);
})}
</div>
<div style={{display:"grid",gridTemplateColumns:"28px minmax(0,1fr) minmax(0,1fr) minmax(0,1fr)",background:"#f7f4f0",borderTop:"2px solid #e8e2da"}}>
<div style={{padding:"7px",fontSize:10,color:"#a89f94",display:"flex",alignItems:"center",justifyContent:"center"}}>Σ</div>
{[totRec.st,totRec.br,totRec.mkt].map((t,i)=><div key={i} style={{padding:"7px 10px",fontSize:14,fontWeight:700,color:"#2c3e50",fontFamily:"'Courier New',Courier,monospace",textAlign:"right"}}>{fmt(t)}</div>)}
</div>
</div>
)}
{aba==="despesas"&&!auxAberta&&(
<div style={{background:"#fff",borderRadius:"0 0 12px 12px",border:"1px solid #e8e2da",borderTop:"none"}}>
<div style={{display:"grid",gridTemplateColumns:"140px 1fr 30px",background:"#4a7fa5",borderBottom:"1px solid #3a6f95"}}>
{["Categoria","Valor",""].map((h,i)=><div key={i} style={{padding:"7px 12px",fontSize:11,color:"#fff",fontWeight:700,letterSpacing:0.5,textTransform:"uppercase",textAlign:i===1?"right":"left"}}>{h}</div>)}
</div>
<div style={{minHeight:300,maxHeight:580,overflowY:"auto"}}>
{categorias.map(cat=>{
const total=calcTotalAux(cat,auxData,recTotais);
const isAuto=SEM_AUX.includes(cat);
const regra=cat==="Taxas Cartão"?"1% receita total":cat==="Taxas Marketplaces"?"29% marketplaces":null;
const isDestaque=cat==="Tecidos"||cat==="Oficinas Costura";
return(
<div key={cat} style={{display:"grid",gridTemplateColumns:"140px 1fr 30px",borderBottom:"1px solid #f0ebe4",background:isDestaque?"#f7f9ff":"#fff"}}>
<div style={{padding:"7px 12px",display:"flex",flexDirection:"column",justifyContent:"center"}}>
<div style={{fontSize:isDestaque?13:12,fontWeight:isDestaque?700:400,color:"#2c3e50"}}>{cat}</div>
{regra&&<div style={{fontSize:9,color:"#a89f94"}}>{regra}</div>}
</div>
<div style={{padding:"7px 12px",fontSize:isDestaque?14:13,color:"#2c3e50",display:"flex",alignItems:"center",fontFamily:"'Courier New',Courier,monospace",fontWeight:isDestaque?700:600,justifyContent:"flex-end"}}>{fmt(total)}</div><div style={{display:"flex",alignItems:"center",justifyContent:"center"}}>{!isAuto&&<button onClick={()=>setAuxAberta(cat)} style={{background:"none",border:"none",cursor:"pointer",color:"#4a7fa5",fontSize:14,padding:"2px 6px"}}>›</button>}</div>
</div>
);
})}
</div>
<div style={{padding:"12px 16px",background:"#f7f4f0",borderTop:"2px solid #e8e2da",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
<div style={{fontSize:13,fontWeight:700,color:"#2c3e50"}}>Total: <span style={{color:"#c0392b",fontFamily:"'Courier New',Courier,monospace",fontSize:14}}>{fmt(totalDesp)}</span></div>
<button onClick={()=>setMostraCadastro(p=>!p)} style={{fontSize:11,color:"#4a7fa5",background:"none",border:"none",cursor:"pointer",fontFamily:"Georgia,serif"}}>{mostraCadastro?"✕ Fechar":"+ Gerenciar Categorias"}</button>
</div>
{mostraCadastro&&(
<div style={{padding:16,background:"#f0f6fb",borderTop:"1px solid #e8e2da"}}>
<div style={{display:"flex",gap:8,marginBottom:12}}>
<input value={novaCategoria} onChange={e=>setNovaCategoria(e.target.value)} placeholder="Nova categoria..." style={{flex:1,border:"1px solid #c8d8e4",borderRadius:6,padding:"6px 10px",fontSize:13,outline:"none",fontFamily:"Georgia,serif"}}/>
<button onClick={adicionarCategoria} style={{background:"#2c3e50",color:"#fff",border:"none",borderRadius:6,padding:"6px 14px",fontSize:12,cursor:"pointer",fontFamily:"Georgia,serif"}}>Adicionar</button>
</div>
<div style={{display:"flex",flexWrap:"wrap",gap:6}}>
{categorias.map(cat=>(
<div key={cat} style={{display:"flex",alignItems:"center",gap:6,background:"#fff",border:"1px solid #e8e2da",borderRadius:16,padding:"3px 10px",fontSize:12}}>
{cat}{!SEM_AUX.includes(cat)&&<span onClick={()=>removerCategoria(cat)} style={{color:"#c0392b",cursor:"pointer",fontWeight:700}}>×</span>}
</div>
))}
</div>
</div>
)}
</div>
)}
{aba==="despesas"&&auxAberta&&(
<div style={{background:"#fff",borderRadius:"0 0 12px 12px",border:"1px solid #e8e2da",borderTop:"none"}}>
<div style={{padding:"12px 16px",background:"#f0f6fb",borderBottom:"1px solid #e8e2da",display:"flex",alignItems:"center",gap:12}}>
<button onClick={()=>setAuxAberta(null)} style={{background:"none",border:"1px solid #a3bacc",borderRadius:6,padding:"4px 12px",fontSize:12,color:"#4a7fa5",cursor:"pointer",fontFamily:"Georgia,serif"}}>← Voltar</button>
<div style={{fontSize:14,fontWeight:600,color:"#2c3e50"}}>{auxAberta}</div>
<div style={{fontSize:12,color:"#a89f94",marginLeft:"auto"}}>Total: <strong style={{color:"#2c3e50"}}>{fmt(calcTotalAux(auxAberta,auxData,recTotais))}</strong></div>
</div>
{auxAberta==="Funcionários"?(
<>
<div style={{overflowX:"auto"}}>
<table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
<thead><tr style={{background:"#f7f4f0"}}>{["Nome","Salário","Comissão","Extra","Alimentação","Vale","Férias","Rescisão","Total",""].map((h,i)=><th key={h} style={{padding:"9px 10px",textAlign:i===0?"left":"right",color:"#a89f94",fontWeight:600,fontSize:11,whiteSpace:"nowrap"}}>{h}</th>)}</tr></thead>
<tbody>
{(auxData["Funcionários"]||[]).map((row,idx)=>{
const rowTotal=calcRowTotal(row);
return(
<tr key={idx} style={{borderBottom:"1px solid #f0ebe4"}}>
<td style={{padding:"6px 10px"}}><input value={row.nome||""} onChange={e=>updateLinhaAux("Funcionários",idx,"nome",e.target.value)} style={{border:"1px solid #c8d8e4",borderRadius:4,padding:"4px 6px",fontSize:12,outline:"none",width:100}}/></td>
{["salario","comissao","extra","alimentacao","vale","ferias","rescisao"].map(f=>(
<td key={f} style={{padding:"6px 6px"}}><input value={row[f]||""} onChange={e=>updateLinhaAux("Funcionários",idx,f,e.target.value)} style={{border:"1px solid #c8d8e4",borderRadius:4,padding:"4px 6px",fontSize:12,outline:"none",width:70,textAlign:"right"}}/></td>
))}<td style={{padding:"6px 10px",textAlign:"right",fontWeight:600,color:"#2c3e50",whiteSpace:"nowrap"}}>{fmt(rowTotal)}</td>
<td style={{padding:"6px 6px",textAlign:"center"}}><span onClick={()=>removeLinhaAux("Funcionários",idx)} style={{color:"#c0392b",cursor:"pointer",fontSize:18}}>×</span></td>
</tr>
);
})}
</tbody>
</table>
</div>
<div style={{padding:"10px 16px",background:"#f7f4f0",borderTop:"1px solid #e8e2da",fontSize:13,color:"#6b7c8a"}}>Subtotal colaboradores: <strong style={{color:"#2c3e50"}}>{fmt(totalFuncSomente)}</strong></div>
<div style={{borderTop:"2px dashed #e8e2da"}}>
<div style={{padding:"10px 16px 6px",fontSize:11,color:"#a89f94",letterSpacing:2,textTransform:"uppercase"}}>Benefícios Fixos</div>
{FIXOS_FUNC.map(f=>(<div key={f.label} style={{display:"flex",justifyContent:"space-between",padding:"8px 16px",borderBottom:"1px solid #f7f4f0"}}><span style={{fontSize:13,color:"#2c3e50"}}>{f.label}</span><span style={{fontSize:13,fontWeight:600,color:"#6b7c8a"}}>R$ {f.valor.toLocaleString("pt-BR")}</span></div>))}
<div style={{display:"flex",justifyContent:"space-between",padding:"12px 16px"}}><span style={{fontSize:14,fontWeight:700,color:"#2c3e50"}}>Total Geral Funcionários</span><span style={{fontSize:16,fontWeight:700,color:"#4a7fa5"}}>R$ {totalFuncGeral.toLocaleString("pt-BR")}</span></div>
</div>
<div style={{padding:"12px 16px",background:"#f7f4f0",borderTop:"1px solid #e8e2da"}}>
<button onClick={()=>addLinhaAux("Funcionários")} style={{background:"#2c3e50",color:"#fff",border:"none",borderRadius:6,padding:"7px 16px",fontSize:12,cursor:"pointer",fontFamily:"Georgia,serif"}}>+ Adicionar funcionário</button>
</div>
</>
):(
<AuxSimplesPanel auxAberta={auxAberta} auxData={auxData} updateLinhaAux={updateLinhaAux} removeLinhaAux={removeLinhaAux} addLinhaAux={addLinhaAux} prestadores={prestadores} setPrestadores={setPrestadores}/>
)}
</div>
)}
{aba==="geral"&&(
<div style={{display:"flex",flexWrap:"wrap",gap:28,alignItems:"flex-start",background:"#f7f4f0",borderRadius:"0 0 12px 12px",border:"1px solid #e8e2da",borderTop:"none",padding:"12px 16px"}}>
{/* RECEITAS — lado esquerdo */}
<div style={{flex:"1 1 320px",minWidth:0,background:"#fff",borderRadius:10,border:"1px solid #e8e2da",overflow:"hidden",boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}}>
<div style={{maxHeight:660,overflowY:"auto"}}>
{/* Header sticky dentro do scroll */}
<div style={{display:"grid",gridTemplateColumns:"32px minmax(0,1fr) minmax(0,1fr) minmax(0,1fr)",background:"#4a7fa5",position:"sticky",top:0,zIndex:1}}>
<div/>
{["Silva Teles","Bom Retiro","Marketplaces"].map(h=>(
<div key={h} style={{padding:"7px 10px",fontSize:10,color:"#fff",fontWeight:700,textTransform:"uppercase",textAlign:"right",letterSpacing:0.3}}>{h}</div>
))}
</div>
{Array.from({length:31},(_,i)=>i+1).map(dia=>{
const d=receitas[dia]||{};
const isDom=DOMINGOS_MAR.includes(dia);
const futuro=dia>hoje;
return(
<div key={dia} style={{display:"grid",gridTemplateColumns:"32px minmax(0,1fr) minmax(0,1fr) minmax(0,1fr)",borderBottom:"1px solid #f0ebe4",background:isDom?"#e8e4df":futuro?"#fafafa":"#fff"}}>
<div style={{padding:"4px 4px",fontSize:11,color:isDom?"#6b5f54":dia===hoje?"#4a7fa5":"#6b7c8a",fontWeight:isDom||dia===hoje?700:400,textAlign:"center",lineHeight:"22px"}}>{dia}</div>
{["silvaTeles","bomRetiro","marketplaces"].map((canal)=>{
const key="g"+dia+"-"+canal;
return(
<div key={canal} style={{padding:"3px 8px",display:"flex",alignItems:"center"}}>
{editando===key?(<input autoFocus defaultValue={d[canal]||""} style={{width:"100%",border:"1px solid #4a7fa5",borderRadius:3,padding:"2px 4px",fontSize:12,outline:"none",fontFamily:"'Courier New',Courier,monospace",fontWeight:600,textAlign:"right"}} onBlur={e=>{salvarCelula(dia,canal,e.target.value);setEditando(null);}} onKeyDown={e=>{if(e.key==="Enter"){salvarCelula(dia,canal,e.target.value);setEditando(null);}}}/>
):(
<div onClick={()=>!futuro&&setEditando(key)} style={{fontSize:12,color:d[canal]?"#2c3e50":"#e0dbd5",cursor:futuro?"default":"pointer",fontWeight:d[canal]?700:400,fontFamily:d[canal]?"'Courier New',Courier,monospace":"Georgia,serif",textAlign:"right",width:"100%"}}>
{d[canal]?parseFloat(d[canal]).toLocaleString("pt-BR"):"—"}
</div>
)}
</div>
);
})}
</div>
);
})}
</div>
<div style={{display:"grid",gridTemplateColumns:"32px minmax(0,1fr) minmax(0,1fr) minmax(0,1fr)",background:"#eaf3fb",borderTop:"2px solid #4a7fa5"}}>
<div style={{padding:"7px",fontSize:11,color:"#4a7fa5",textAlign:"center",fontWeight:700}}>Σ</div>
{[totRec.st,totRec.br,totRec.mkt].map((t,i)=><div key={i} style={{padding:"7px 10px",fontSize:13,fontWeight:700,color:"#2c3e50",fontFamily:"'Courier New',Courier,monospace",textAlign:"right"}}>{t>0?"R$ "+t.toLocaleString("pt-BR"):"—"}</div>)}
</div>
</div>
{/* DESPESAS — lado direito */}
<div style={{flex:"1 1 260px",minWidth:0,background:"#fff",borderRadius:10,border:"1px solid #e8e2da",overflow:"hidden",boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}}>
<div style={{maxHeight:660,overflowY:"auto"}}>
{/* Header sticky dentro do scroll — evita desalinhamento com scrollbar */}
<div style={{display:"grid",gridTemplateColumns:"1fr 150px 20px",background:"#4a7fa5",position:"sticky",top:0,zIndex:1}}>
<div style={{padding:"7px 12px",fontSize:10,color:"#fff",fontWeight:700,textTransform:"uppercase",letterSpacing:0.3}}>Categoria</div>
<div style={{padding:"7px 8px",fontSize:10,color:"#fff",fontWeight:700,textTransform:"uppercase",textAlign:"right",letterSpacing:0.3}}>Valor</div>
<div/>
</div>
{categorias.map(cat=>{
const total=calcTotalAux(cat,auxData,recTotais);
const isDestaque=cat==="Tecidos"||cat==="Oficinas Costura";
const isAuto=SEM_AUX.includes(cat);
return(
<div key={cat} style={{display:"grid",gridTemplateColumns:"1fr 150px 20px",alignItems:"center",borderBottom:"1px solid #f0ebe4",background:isDestaque?"#f7f9ff":"#fff",cursor:isAuto?"default":"pointer",minHeight:32}}
onClick={()=>{if(!isAuto){setAba("despesas");setAuxAberta(cat);}}}>
<span style={{fontSize:isDestaque?13:12,fontWeight:isDestaque?700:400,color:"#2c3e50",padding:"5px 8px 5px 12px"}}>{cat}</span>
<span style={{fontSize:isDestaque?13:12,fontWeight:isDestaque?700:600,color:total>0?"#2c3e50":"#d0c8c0",fontFamily:"'Courier New',Courier,monospace",textAlign:"right",whiteSpace:"nowrap",padding:"5px 8px"}}>
{total>0?"R$ "+total.toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2}):"—"}
</span>
<span style={{color:"#c8d0d8",fontSize:12,textAlign:"center"}}>{!isAuto?"›":""}</span>
</div>
);
})}
</div>
<div style={{padding:"8px 12px",background:"#fdeaea",borderTop:"2px solid #c0392b",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
<span style={{fontSize:11,color:"#c0392b",fontWeight:700,letterSpacing:0.5,textTransform:"uppercase"}}>Total Despesa</span>
<span style={{fontSize:14,fontWeight:700,color:"#c0392b",fontFamily:"'Courier New',Courier,monospace"}}>{fmt(totalDesp)}</span>
</div></div>
</div>
)}
</div>
);
};
const BoletosContent=({boletos,setBoletos,setAuxDataPorMes})=>{
const [mostraImport,setMostraImport]=useState(false);
const [mostraAdicionar,setMostraAdicionar]=useState(false);
const [novoB,setNovoB]=useState({data:"",mes:3,empresa:"",valor:"",nroNota:""});
const [pasteText,setPasteText]=useState("");
const [importError,setImportError]=useState("");
const [filtro,setFiltro]=useState(3);
const [mesAberto,setMesAberto]=useState(0); // 0 = todos os meses
const [saveStatus,setSaveStatus]=useState(null);
const [lixeira,setLixeira]=useState([]);
const [confirm,setConfirm]=useState(null);
const hoje=14;const mesHoje=3;
const diaNum=(d)=>parseInt((d||"99").split("/")[0]);
const isVencido=(b)=>!b.pago&&(b.mes<mesHoje||(b.mes===mesHoje&&diaNum(b.data)<hoje));
const mesesComBoletos=[...new Set(boletos.map(b=>b.mes))].sort((a,b)=>a-b);
const boletosFiltrados=filtro==="aberto"
?boletos.filter(b=>!b.pago&&(mesAberto===0||b.mes===mesAberto)).sort((a,b)=>a.mes-b.mes||diaNum(a.data)-diaNum(b.data))
:boletos.filter(b=>b.mes===filtro).sort((a,b)=>diaNum(a.data)-diaNum(b.data));
const mesFiltro=typeof filtro==="number"?filtro:mesHoje;
const totalPagoMes=boletos.filter(b=>b.pago&&b.mes===mesFiltro).reduce((s,b)=>s+parseFloat(b.valor||0),0);
const totalAPagar=boletos.filter(b=>!b.pago&&b.mes===mesHoje).reduce((s,b)=>s+parseFloat(b.valor||0),0);
const totalFiltro=boletosFiltrados.reduce((s,b)=>s+parseFloat(b.valor||0),0);
const markChange=()=>{setSaveStatus("saving");setTimeout(()=>setSaveStatus("saved"),600);};
const togglePago=(id)=>{
setBoletos(prev=>{
const b=prev.find(x=>x.id===id);
if(!b)return prev;
const novoPago=!b.pago;
// Sincroniza com Tecidos do mês correspondente
if(setAuxDataPorMes){
setAuxDataPorMes(mes=>{
const mesNum=b.mes;
const tecidos=[...(mes[mesNum]?.["Tecidos"]||[])];
if(novoPago){
// Adiciona linha em Tecidos com tag _boletoid para identificar origem
if(!tecidos.find(t=>t._boletoid===id)){
tecidos.push({data:b.data,empresa:b.empresa,nroNota:b.nroNota||"",valor:b.valor,descricao:"",_boletoid:id});
}
} else {
// Remove linha correspondente ao boleto
                const idx=tecidos.findIndex(t=>t._boletoid===id);
if(idx>=0)tecidos.splice(idx,1);
}
return {...mes,[mesNum]:{...(mes[mesNum]||{}),"Tecidos":tecidos}};
});
}
return prev.map(x=>x.id===id?{...x,pago:novoPago}:x);
});
markChange();
};
const remover=(id)=>{setConfirm({msg:"Apagar este boleto?",onYes:()=>{setBoletos(prev=>{const item=prev.find(b=>b.id===id);if(item)setLixeira(l=>[...l.slice(-4),item]);return prev.filter(b=>b.id!==id);});setConfirm(null);}});};
const desfazer=()=>{if(!lixeira.length)return;const u=lixeira[lixeira.length-1];setBoletos(prev=>[...prev,u]);setLixeira(l=>l.slice(0,-1));};
const parsePaste=()=>{
setImportError("");
const linhas=pasteText.trim().split("\n").filter(l=>l.trim());
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
novas.push({id:Date.now()+i,data:data||"—",mes:mesFiltro,empresa:empresa||("Boleto "+(i+1)),nroNota:nroNota||"",valor,pago:false});
});
if(novas.length===0){setImportError("Formato inválido. Use: Data ; Valor ; Empresa");return;}
setBoletos(prev=>[...prev,...novas]);setPasteText("");setMostraImport(false);
if(erros>0)setImportError(novas.length+" importado(s). "+erros+" ignorado(s).");
};
const iStyle={border:"1px solid #c8d8e4",borderRadius:6,padding:"6px 10px",fontSize:13,outline:"none",fontFamily:"Georgia,serif",width:"100%",boxSizing:"border-box"};
return(
<div>
<ConfirmDialog confirm={confirm?confirm.msg:null} onCancel={()=>setConfirm(null)} onConfirm={confirm?.onYes}/>
<div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
<div style={{background:"#fff",borderRadius:8,padding:"5px 12px",border:"1px solid #e8e2da",display:"flex",alignItems:"center",gap:12}}>
<div><div style={{fontSize:9,color:"#a89f94",letterSpacing:1,textTransform:"uppercase"}}>Pago {MESES[mesFiltro-1]}</div><div style={{fontSize:13,fontWeight:700,color:"#27ae60"}}>R$ {totalPagoMes.toLocaleString("pt-BR")}</div></div>
<div style={{width:1,height:20,background:"#e8e2da"}}/>
<div style={{fontSize:11,color:"#a89f94"}}>{boletos.filter(b=>b.pago&&b.mes===mesFiltro).length} pago(s)</div>
<div style={{width:1,height:20,background:"#e8e2da"}}/>
<div><div style={{fontSize:9,color:"#a89f94",letterSpacing:1,textTransform:"uppercase"}}>A Pagar {MESES[mesHoje-1]}</div><div style={{fontSize:13,fontWeight:700,color:"#c0392b"}}>R$ {totalAPagar.toLocaleString("pt-BR")}</div></div>
</div>
</div><div style={{display:"flex",alignItems:"center",gap:0,flexWrap:"nowrap",overflowX:"auto",borderBottom:"1px solid #e8e2da"}}>
<button onClick={()=>setFiltro("aberto")} style={{padding:"5px 12px",border:"none",background:filtro==="aberto"?"#fdeaea":"transparent",cursor:"pointer",fontSize:11,color:filtro==="aberto"?"#c0392b":"#8a9aa4",borderBottom:filtro==="aberto"?"2px solid #c0392b":"2px solid transparent",fontFamily:"Georgia,serif",whiteSpace:"nowrap",fontWeight:filtro==="aberto"?700:400}}>⚠ Em aberto</button>
{filtro==="aberto"&&(
<select value={mesAberto} onChange={e=>setMesAberto(Number(e.target.value))}
style={{margin:"0 8px",border:"1px solid #e8e2da",borderRadius:5,padding:"3px 7px",fontSize:11,fontFamily:"Georgia,serif",color:"#c0392b",background:"#fdeaea",cursor:"pointer",outline:"none"}}>
<option value={0}>Todos os meses</option>
{mesesComBoletos.map(m=><option key={m} value={m}>{MESES[m-1]}</option>)}
</select>
)}
<div style={{width:1,height:20,background:"#e8e2da",margin:"0 4px",flexShrink:0}}/>
{mesesComBoletos.map(m=><button key={m} onClick={()=>setFiltro(m)} style={{padding:"5px 10px",border:"none",background:"transparent",cursor:"pointer",fontSize:11,color:filtro===m?"#2c3e50":"#8a9aa4",borderBottom:filtro===m?"2px solid #2c3e50":"2px solid transparent",fontFamily:"Georgia,serif",whiteSpace:"nowrap"}}>{MESES[m-1]}</button>)}
</div>
<div style={{background:"#fff",borderRadius:"0 0 12px 12px",border:"1px solid #e8e2da",borderTop:"none",overflow:"hidden"}}>
<div style={{minHeight:300,maxHeight:720,overflowY:"auto"}}>
<table style={{width:"100%",borderCollapse:"collapse",tableLayout:"fixed"}}>
<colgroup>
<col style={{width:"80px"}}/>
<col style={{width:"auto"}}/>
<col style={{width:"120px"}}/>
{filtro==="aberto"&&<col style={{width:"60px"}}/>}
<col style={{width:"130px"}}/>
<col style={{width:"50px"}}/>
<col style={{width:"30px"}}/>
</colgroup>
<thead><tr style={{background:"#4a7fa5"}}>{["Data","Empresa","Nº Nota",filtro==="aberto"?"Mês":null,"Valor","Pago",""].filter(Boolean).map((h,i)=><th key={i} style={{padding:"6px 12px",textAlign:h==="Valor"?"right":"left",color:"#fff",fontWeight:600,fontSize:11,whiteSpace:"nowrap"}}>{h}</th>)}</tr></thead>
<tbody>
{boletosFiltrados.length===0&&<tr><td colSpan={7} style={{padding:24,textAlign:"center",color:"#c0b8b0",fontSize:12}}>Nenhum boleto</td></tr>}
{boletosFiltrados.map(b=>{
const venc=isVencido(b);
return(
<tr key={b.id} style={{borderBottom:"1px solid #f0ebe4",background:b.pago?"#f6fbf6":"#fff"}}>
<td style={{padding:"7px 12px",fontSize:12,color:venc?"#c0392b":b.pago?"#a0a0a0":"#2c3e50",fontWeight:venc?600:400}}>{b.data}</td>
<td style={{padding:"7px 12px",fontSize:12,color:"#2c3e50",textDecoration:b.pago?"line-through":"none"}}>{b.empresa}</td>
<td style={{padding:"7px 12px",fontSize:11,color:"#8a9aa4"}}>{b.nroNota||"—"}</td>
{filtro==="aberto"&&<td style={{padding:"7px 12px",fontSize:11,color:"#8a9aa4"}}>{MESES[b.mes-1]}</td>}
<td style={{padding:"7px 12px",fontSize:13,fontWeight:700,textAlign:"right",color:venc?"#c0392b":"#2c3e50",fontFamily:"'Courier New',Courier,monospace"}}>R$ {parseFloat(b.valor).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
<td style={{padding:"7px 12px",textAlign:"center"}}><div onClick={()=>togglePago(b.id)} style={{width:18,height:18,borderRadius:4,background:b.pago?"#27ae60":"#fff",border:b.pago?"none":"2px solid #e8e2da",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto"}}>{b.pago&&<span style={{color:"#fff",fontSize:11,fontWeight:700,lineHeight:1}}>✓</span>}</div></td>
<td style={{padding:"7px 6px",textAlign:"center"}}><span onClick={()=>remover(b.id)} style={{color:"#d0c8c0",cursor:"pointer",fontSize:15,lineHeight:1}}>×</span></td>
</tr>
);
})}
</tbody>
</table>
</div>
<div style={{padding:"6px 14px",background:"#f7f4f0",borderTop:"1px solid #e8e2da",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
<div style={{display:"flex",gap:8,alignItems:"center"}}><SaveBadge status={saveStatus}/>{lixeira.length>0&&<button onClick={desfazer} style={{fontSize:10,color:"#4a7fa5",background:"none",border:"none",cursor:"pointer",fontFamily:"Georgia,serif"}}>↩ Desfazer</button>}</div>
<div style={{fontSize:12,color:"#8a9aa4"}}>Total: <strong style={{color:"#2c3e50"}}>{fmt(totalFiltro)}</strong></div></div>
<div style={{padding:"6px 14px",background:"#fff",borderTop:"1px solid #f0ebe4",display:"flex",gap:8}}>
<button onClick={()=>{setMostraAdicionar(p=>!p);setMostraImport(false);}} style={{background:mostraAdicionar?"#2c3e50":"#fff",color:mostraAdicionar?"#fff":"#2c3e50",border:"1px solid #2c3e50",borderRadius:5,padding:"4px 10px",fontSize:11,cursor:"pointer",fontFamily:"Georgia,serif"}}>{mostraAdicionar?"✕":"+ Boleto"}</button>
<button onClick={()=>{setMostraImport(p=>!p);setMostraAdicionar(false);setImportError("");}} style={{background:mostraImport?"#4a7fa5":"#fff",color:mostraImport?"#fff":"#4a7fa5",border:"1px solid #4a7fa5",borderRadius:5,padding:"4px 10px",fontSize:11,cursor:"pointer",fontFamily:"Georgia,serif"}}>{mostraImport?"✕":" Planilha"}</button>
</div>
{mostraAdicionar&&(
<div style={{padding:"8px 12px",background:"#f0f6fb",borderTop:"1px solid #e8e2da"}}>
<div style={{display:"grid",gridTemplateColumns:"70px 64px 1fr 90px 110px 70px",gap:6,alignItems:"end"}}>
<div><div style={{fontSize:10,color:"#a89f94",marginBottom:2}}>Data</div><input value={novoB.data} onChange={e=>setNovoB(p=>({...p,data:e.target.value}))} placeholder="dd/mm" style={{...iStyle,padding:"4px 7px",fontSize:11}}/></div>
<div><div style={{fontSize:10,color:"#a89f94",marginBottom:2}}>Mês</div><select value={novoB.mes} onChange={e=>setNovoB(p=>({...p,mes:parseInt(e.target.value)}))} style={{...iStyle,padding:"4px 7px",fontSize:11}}>{MESES.map((m,i)=><option key={i} value={i+1}>{m}</option>)}</select></div>
<div><div style={{fontSize:10,color:"#a89f94",marginBottom:2}}>Empresa</div><input value={novoB.empresa} onChange={e=>setNovoB(p=>({...p,empresa:e.target.value}))} style={{...iStyle,padding:"4px 7px",fontSize:11}}/></div>
<div><div style={{fontSize:10,color:"#a89f94",marginBottom:2}}>Nº Nota</div><input value={novoB.nroNota} onChange={e=>setNovoB(p=>({...p,nroNota:e.target.value}))} placeholder="NF-001" style={{...iStyle,padding:"4px 7px",fontSize:11}}/></div>
<div><div style={{fontSize:10,color:"#a89f94",marginBottom:2}}>Valor</div><input value={novoB.valor} onChange={e=>setNovoB(p=>({...p,valor:e.target.value}))} style={{...iStyle,padding:"4px 7px",fontSize:11}}/></div>
<button onClick={()=>{if(!novoB.empresa||!novoB.valor)return;setBoletos(p=>[...p,{id:Date.now(),data:novoB.data||"—",mes:novoB.mes,empresa:novoB.empresa,nroNota:novoB.nroNota||"",valor:novoB.valor,pago:false}]);setNovoB({data:"",mes:3,empresa:"",valor:"",nroNota:""});setMostraAdicionar(false);markChange();}} style={{background:"#4a7fa5",color:"#fff",border:"none",borderRadius:5,padding:"6px",fontSize:11,cursor:"pointer",fontFamily:"Georgia,serif"}}>Salvar</button>
</div>
</div>
)}
{mostraImport&&(
<div style={{padding:"8px 12px",background:"#f0f6fb",borderTop:"1px solid #e8e2da"}}>
<div style={{fontSize:11,color:"#8a9aa4",marginBottom:6}}>Cole da planilha (Data ; Valor ; Empresa):</div>
<textarea value={pasteText} onChange={e=>setPasteText(e.target.value)} placeholder={"14/03\tFornecedor SP\tNF-1234\t8400\n16/03\tAluguel Silva Teles\t\t6200"} style={{width:"100%",minHeight:64,border:"1px solid #c8d8e4",borderRadius:5,padding:7,fontSize:11,fontFamily:"monospace",outline:"none",resize:"vertical",boxSizing:"border-box"}}/>
{importError&&<div style={{fontSize:11,color:"#c0392b",marginTop:4}}>{importError}</div>}
<div style={{display:"flex",gap:6,marginTop:6}}>
<button onClick={parsePaste} style={{background:"#4a7fa5",color:"#fff",border:"none",borderRadius:5,padding:"4px 12px",fontSize:11,cursor:"pointer",fontFamily:"Georgia,serif"}}>Importar</button>
<button onClick={()=>{setPasteText("");setImportError("");}} style={{background:"#fff",color:"#6b7c8a",border:"1px solid #e8e2da",borderRadius:5,padding:"4px 12px",fontSize:11,cursor:"pointer",fontFamily:"Georgia,serif"}}>Limpar</button>
</div>
</div>
)}
</div>
</div>
);
};
const AGENDA_INICIAL=[
{id:1,dia:1,descricao:"Pró-Labore Muniam",feito:false},{id:2,dia:1,descricao:"Pensão — Mãe",feito:false},
{id:3,dia:3,descricao:"Parcela Casa",feito:false},{id:4,dia:4,descricao:"Correios",feito:false},
{id:5,dia:5,descricao:"Condomínio",feito:false},{id:6,dia:5,descricao:"Ideris",feito:false},
{id:7,dia:5,descricao:"Luz Silva Teles",feito:false},{id:8,dia:6,descricao:"Folha de Pagamento",feito:false},
{id:9,dia:7,descricao:"Mensalidade Site",feito:false},{id:10,dia:7,descricao:"Aluguel Silva Teles",feito:false},
{id:11,dia:8,descricao:"Mensalidade Contabilidade",feito:false},{id:12,dia:9,descricao:"Bling",feito:false},
{id:13,dia:9,descricao:"Cartão Amícia",feito:false},{id:14,dia:9,descricao:"Cartão Ailson",feito:false},
{id:15,dia:10,descricao:"Futura La Amícia",feito:false},{id:16,dia:10,descricao:"Parcela Apartamento",feito:false},
{id:17,dia:11,descricao:"Cartão Tamara",feito:false},{id:18,dia:15,descricao:"ADPM",feito:false},
{id:19,dia:17,descricao:"Estacionamento",feito:false},{id:20,dia:18,descricao:"Cestas Básicas",feito:false},
{id:21,dia:20,descricao:"Impostos DAS",feito:false},{id:22,dia:20,descricao:"FGTS / INSS",feito:false},
{id:23,dia:20,descricao:"Adiantamento Funcionários",feito:false},{id:24,dia:20,descricao:"Unimed",feito:false},
{id:25,dia:20,descricao:"Método Marketing",feito:false},{id:26,dia:23,descricao:"Luz José Paulino",feito:false},{id:27,dia:28,descricao:"Boa Vista",feito:false},{id:28,dia:28,descricao:"Metromed",feito:false},
{id:29,dia:29,descricao:"Futura Amícia",feito:false},{id:30,dia:30,descricao:"Aluguel José Paulino",feito:false},
{id:31,dia:30,descricao:"Guias Parcelamento",feito:false},{id:32,dia:30,descricao:"Guia DARF Ailson",feito:false},
{id:33,dia:30,descricao:"Aluguel Escritório",feito:false},{id:34,dia:20,descricao:"ECAD",feito:false},
];
const AgendaContent=()=>{
const hoje=14;
const [itens,setItens]=useState(AGENDA_INICIAL);
const [novoItem,setNovoItem]=useState({dia:"",descricao:""});
const [mostraAdd,setMostraAdd]=useState(false);
const [saveStatus,setSaveStatus]=useState(null);
const [lixeira,setLixeira]=useState([]);
const [confirm,setConfirm]=useState(null);
const markChange=()=>{setSaveStatus("saving");setTimeout(()=>setSaveStatus("saved"),600);};
const toggle=(id)=>{setItens(prev=>prev.map(i=>i.id===id?{...i,feito:!i.feito}:i));markChange();};
const remover=(id)=>{setConfirm({msg:"Apagar este compromisso?",onYes:()=>{setItens(prev=>{const item=prev.find(i=>i.id===id);if(item)setLixeira(l=>[...l.slice(-4),item]);return prev.filter(i=>i.id!==id);});setConfirm(null);}});};
const desfazer=()=>{if(!lixeira.length)return;const u=lixeira[lixeira.length-1];setItens(prev=>[...prev,u].sort((a,b)=>a.dia-b.dia));setLixeira(l=>l.slice(0,-1));};
const adicionar=()=>{if(!novoItem.dia||!novoItem.descricao.trim())return;setItens(prev=>[...prev,{id:Date.now(),dia:parseInt(novoItem.dia),descricao:novoItem.descricao.trim(),feito:false}].sort((a,b)=>a.dia-b.dia));setNovoItem({dia:"",descricao:""});setMostraAdd(false);markChange();};
const sorted=[...itens].sort((a,b)=>a.dia-b.dia);
const alertas=sorted.filter(i=>!i.feito&&i.dia<hoje);
const hojeItems=sorted.filter(i=>!i.feito&&i.dia===hoje);
const proximos=sorted.filter(i=>!i.feito&&i.dia>hoje);
const feitos=sorted.filter(i=>i.feito);
const ItemRow=({item,tipo})=>(
<div style={{display:"grid",gridTemplateColumns:"40px 1fr 36px 28px",borderBottom:"1px solid #f0ebe4",background:item.feito?"#fafaf8":"#fff"}}>
<div style={{padding:"8px 10px",fontSize:16,fontWeight:700,color:tipo==="alerta"?"#c0392b":tipo==="hoje"?"#4a7fa5":"#c8c0b8",textAlign:"center"}}>{item.dia}</div>
<div style={{padding:"8px 6px",fontSize:12,color:item.feito?"#a0a0a0":"#2c3e50",textDecoration:item.feito?"line-through":"none",display:"flex",alignItems:"center",gap:6}}>
{tipo==="alerta"&&<span style={{fontSize:10,color:"#c0392b",background:"#fdeaea",borderRadius:3,padding:"1px 5px"}}>Atrasado</span>}
{tipo==="hoje"&&<span style={{fontSize:10,color:"#4a7fa5",background:"#e8f0f8",borderRadius:3,padding:"1px 5px"}}>Hoje</span>}
{item.descricao}
</div>
<div style={{display:"flex",alignItems:"center",justifyContent:"center"}}><div onClick={()=>toggle(item.id)} style={{width:18,height:18,borderRadius:4,background:item.feito?"#27ae60":"#fff",border:item.feito?"none":"2px solid #e8e2da",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>{item.feito&&<span style={{color:"#fff",fontSize:11,fontWeight:700,lineHeight:1}}>✓</span>}</div></div>
<div style={{display:"flex",alignItems:"center",justifyContent:"center"}}><span onClick={()=>remover(item.id)} style={{color:"#d0c8c0",cursor:"pointer",fontSize:15,lineHeight:1}}>×</span></div>
</div>
);
return(
<div>
<ConfirmDialog confirm={confirm?confirm.msg:null} onCancel={()=>setConfirm(null)} onConfirm={confirm?.onYes}/>
{alertas.length>0&&(
<div style={{background:"#fdeaea",border:"1px solid #f4b8b8",borderRadius:8,padding:"5px 12px",marginBottom:6,display:"flex",gap:8,alignItems:"center"}}>
<span style={{fontSize:14}}>⚠️</span>
<span style={{fontSize:12,fontWeight:600,color:"#c0392b"}}>{alertas.length} vencido(s):</span>
<span style={{fontSize:11,color:"#c0392b",opacity:0.85,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{alertas.map(a=>a.descricao).join(" · ")}</span>
</div>
)}
<div style={{display:"flex",gap:8,marginBottom:8}}>{[{label:"Vencidos",value:alertas.length,color:alertas.length>0?"#c0392b":"#a89f94",bg:alertas.length>0?"#fdeaea":"#fff"},{label:"Hoje",value:hojeItems.length,color:"#4a7fa5",bg:"#f0f6fb"},{label:"Pendentes",value:proximos.length,color:"#2c3e50",bg:"#fff"}].map(c=>(
<div key={c.label} style={{background:c.bg,borderRadius:8,padding:"5px 12px",border:"1px solid #e8e2da",display:"flex",alignItems:"center",gap:8}}>
<span style={{fontSize:10,color:"#a89f94",letterSpacing:1,textTransform:"uppercase"}}>{c.label}</span>
<span style={{fontSize:16,fontWeight:700,color:c.color}}>{c.value}</span>
</div>
))}
</div>
<div style={{background:"#fff",borderRadius:12,border:"1px solid #e8e2da",overflow:"hidden"}}>
<div style={{display:"grid",gridTemplateColumns:"40px 1fr 36px 28px",background:"#f7f4f0",borderBottom:"1px solid #e8e2da"}}>
{["Dia","Descrição","✓",""].map((h,i)=><div key={i} style={{padding:"6px 10px",fontSize:10,color:"#a89f94",letterSpacing:1,textTransform:"uppercase",textAlign:i>=2?"center":"left"}}>{h}</div>)}
</div>
{alertas.map(i=><ItemRow key={i.id} item={i} tipo="alerta"/>)}
{hojeItems.map(i=><ItemRow key={i.id} item={i} tipo="hoje"/>)}
{proximos.length>0&&<div style={{padding:"8px 14px",background:"#f9f8f6",borderBottom:"1px solid #f0ebe4",fontSize:11,color:"#a89f94",letterSpacing:1,textTransform:"uppercase"}}>Próximos</div>}
{proximos.map(i=><ItemRow key={i.id} item={i} tipo="futuro"/>)}
{feitos.length>0&&<><div style={{padding:"8px 14px",background:"#f6fbf6",borderTop:"1px solid #e8e2da",fontSize:11,color:"#27ae60",letterSpacing:1,textTransform:"uppercase"}}>Concluídos</div>{feitos.map(i=><ItemRow key={i.id} item={i} tipo="feito"/>)}</>}
<div style={{padding:"5px 12px",background:"#f7f4f0",borderTop:"1px solid #e8e2da",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
<div style={{display:"flex",alignItems:"center",gap:8}}>
<SaveBadge status={saveStatus}/>
{lixeira.length>0&&<button onClick={desfazer} style={{fontSize:10,color:"#4a7fa5",background:"none",border:"none",cursor:"pointer",fontFamily:"Georgia,serif"}}>↩ Desfazer</button>}
<span style={{fontSize:10,color:"#a89f94"}}>{itens.length} item(s)</span>
</div>
<button onClick={()=>setMostraAdd(p=>!p)} style={{background:mostraAdd?"#2c3e50":"#4a7fa5",color:"#fff",border:"none",borderRadius:5,padding:"4px 10px",fontSize:11,cursor:"pointer",fontFamily:"Georgia,serif"}}>{mostraAdd?"✕":"+ Compromisso"}</button>
</div>
{mostraAdd&&(
<div style={{padding:"8px 12px",background:"#f0f6fb",borderTop:"1px solid #e8e2da"}}>
<div style={{display:"grid",gridTemplateColumns:"64px 1fr 80px",gap:8,alignItems:"end"}}>
<div><div style={{fontSize:10,color:"#a89f94",marginBottom:2}}>Dia</div><input value={novoItem.dia} onChange={e=>setNovoItem(p=>({...p,dia:e.target.value}))} placeholder="15" style={{width:"100%",border:"1px solid #c8d8e4",borderRadius:5,padding:"4px 7px",fontSize:12,outline:"none",fontFamily:"Georgia,serif"}}/></div>
<div><div style={{fontSize:10,color:"#a89f94",marginBottom:2}}>Descrição</div><input value={novoItem.descricao} onChange={e=>setNovoItem(p=>({...p,descricao:e.target.value}))} onKeyDown={e=>e.key==="Enter"&&adicionar()} placeholder="Nome do compromisso" style={{width:"100%",border:"1px solid #c8d8e4",borderRadius:5,padding:"4px 7px",fontSize:12,outline:"none",fontFamily:"Georgia,serif"}}/></div>
<button onClick={adicionar} style={{background:"#4a7fa5",color:"#fff",border:"none",borderRadius:5,padding:"6px",fontSize:11,cursor:"pointer",fontFamily:"Georgia,serif"}}>Adicionar</button>
</div>
</div>
)}
</div>
</div>
);
};
const HistoricoContent=({boletosShared,setBoletosShared,getReceitasMes,setReceitasMes,auxDataPorMes,setAuxDataPorMes,categoriasPorMes,setCategoriasPorMes,prestadores,setPrestadores,mesAtual,dadosMensais=DADOS_MENSAIS})=>{
const anoAtual=2026;
const anos=[2026,2025,2024,2023,2022,2021,2020,2019];
const [anoSel,setAnoSel]=useState(anoAtual);
const [mesSel,setMesSel]=useState(null);
const getDadosAno=(ano)=>ano===anoAtual?dadosMensais:(HISTORICO[ano]||{});
const dadosAno=getDadosAno(anoSel);
const mesesComDados=Object.values(dadosAno).filter(d=>d.receita>0);
const n=mesesComDados.length;const totalAno=mesesComDados.reduce((a,d)=>({receita:a.receita+d.receita,despesa:a.despesa+d.despesa}),{receita:0,despesa:0});
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
<button onClick={()=>setMesSel(null)} style={{background:"none",border:"1px solid #a3bacc",borderRadius:6,padding:"5px 14px",fontSize:12,color:"#4a7fa5",cursor:"pointer",fontFamily:"Georgia,serif"}}>← Histórico</button>
<div style={{fontSize:22,fontWeight:600,color:"#2c3e50"}}>{MESES[mesSel]} {anoSel}</div>
{!temDados&&<div style={{fontSize:12,color:"#a89f94",background:"#f7f4f0",padding:"4px 10px",borderRadius:6}}>Sem dados</div>}
</div>
<LancamentosContent mes={mesNum}
receitas={getReceitasMes(mesNum)} setReceitas={(fn)=>setReceitasMes(mesNum,fn)}
auxData={auxDataPorMes[mesNum]||{}} setAuxData={(fn)=>setAuxDataPorMes(prev=>({...prev,[mesNum]:typeof fn==="function"?fn(prev[mesNum]||{}):fn}))}
categorias={categoriasPorMes[mesNum]||[...CATS]} setCategorias={(fn)=>setCategoriasPorMes(prev=>({...prev,[mesNum]:typeof fn==="function"?fn(prev[mesNum]||[...CATS]):fn}))}
boletos={boletosShared} setBoletos={setBoletosShared} prestadores={prestadores} setPrestadores={setPrestadores}/>
</div>
);
}
return(
<div>
<div style={{display:"flex",alignItems:"center",gap:16,marginBottom:24}}>
<button onClick={()=>setMesSel(null)} style={{background:"none",border:"1px solid #a3bacc",borderRadius:6,padding:"5px 14px",fontSize:12,color:"#4a7fa5",cursor:"pointer",fontFamily:"Georgia,serif"}}>← Histórico</button>
<div style={{fontSize:22,fontWeight:600,color:"#2c3e50"}}>{MESES[mesSel]} {anoSel}</div>
{!temDados&&<div style={{fontSize:12,color:"#a89f94",background:"#f7f4f0",padding:"4px 10px",borderRadius:6}}>Sem dados</div>}
</div>
{temDados?(
<div style={{display:"flex",flexDirection:"column",gap:16}}>
<div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:16}}>
{[{label:"Receita Total",value:d.receita,color:"#4a7fa5"},{label:"Despesas",value:d.despesa,color:"#c0392b"},{label:"Saldo",value:saldo,color:saldo>=0?"#27ae60":"#c0392b"}].map(c=>(
<div key={c.label} style={{background:"#fff",borderRadius:12,padding:20,border:"1px solid #e8e2da"}}><div style={{fontSize:11,color:"#a89f94",letterSpacing:2,textTransform:"uppercase",marginBottom:8}}>{c.label}</div><div style={{fontSize:22,fontWeight:700,color:c.color}}>{fmt(c.value)}</div></div>
))}
</div>
<div style={{background:"#fff",borderRadius:12,border:"1px solid #e8e2da",overflow:"hidden"}}>
<div style={{padding:"12px 20px",borderBottom:"1px solid #e8e2da",fontSize:11,color:"#a89f94",letterSpacing:2,textTransform:"uppercase"}}>Por canal</div>
<div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr"}}>
{[{label:"Silva Teles",value:d.silvaTeles},{label:"Bom Retiro",value:d.bomRetiro},{label:"Marketplaces",value:d.marketplaces}].map((c,i)=>(
<div key={c.label} style={{padding:"16px 20px",borderRight:i<2?"1px solid #e8e2da":"none"}}><div style={{fontSize:11,color:"#a89f94",letterSpacing:1,textTransform:"uppercase",marginBottom:6}}>{c.label}</div><div style={{fontSize:18,fontWeight:600,color:"#4a7fa5"}}>{fmt(c.value)}</div>{d.receita>0&&<div style={{fontSize:11,color:"#a89f94",marginTop:4}}>{((c.value/d.receita)*100).toFixed(1)}% receita</div>}</div>
))}
</div>
</div>
</div>
):(<div style={{background:"#fff",borderRadius:12,padding:48,border:"1px solid #e8e2da",textAlign:"center",color:"#c0b8b0",fontSize:13}}>Sem dados para este mês</div>
)}
</div>
);
}
return(
<div>
<div style={{display:"flex",gap:4,marginBottom:24,flexWrap:"wrap"}}>
{anos.map(ano=>(
<button key={ano} onClick={()=>{setAnoSel(ano);setMesSel(null);}} style={{padding:"7px 16px",cursor:"pointer",fontSize:13,fontFamily:"Georgia,serif",background:anoSel===ano?"#2c3e50":"#fff",color:anoSel===ano?"#fff":"#6b7c8a",border:"1px solid "+(anoSel===ano?"#2c3e50":"#e8e2da"),borderRadius:6}}>{ano}</button>
))}
</div>
{n>0&&(
<div style={{background:"#fff",borderRadius:12,border:"1px solid #e8e2da",overflow:"hidden",marginBottom:24}}>
<div style={{padding:"12px 20px",borderBottom:"1px solid #e8e2da",fontSize:11,color:"#a89f94",letterSpacing:2,textTransform:"uppercase"}}>Consolidado {anoSel}</div>
<div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)"}}>
{[{label:"Receita Total",value:totalAno.receita,color:"#4a7fa5"},{label:"Despesa Total",value:totalAno.despesa,color:"#c0392b"},{label:"Saldo Total",value:resultado,color:resultado>=0?"#27ae60":"#c0392b"},{label:"Meses c/ dados",value:n,raw:true,color:"#2c3e50"}].map((c,i)=>(
<div key={c.label} style={{padding:"18px 20px",borderRight:i<3?"1px solid #e8e2da":"none"}}><div style={{fontSize:10,color:"#a89f94",letterSpacing:2,textTransform:"uppercase",marginBottom:6}}>{c.label}</div><div style={{fontSize:18,fontWeight:700,color:c.color}}>{c.raw?c.value:fmt(c.value)}</div></div>
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
<div key={mes} onClick={()=>setMesSel(i)} style={{background:"#fff",borderRadius:12,padding:16,border:"1px solid "+(isAtual?"#4a7fa5":"#e8e2da"),cursor:"pointer",position:"relative"}} onMouseEnter={e=>e.currentTarget.style.boxShadow="0 2px 12px rgba(0,0,0,0.08)"} onMouseLeave={e=>e.currentTarget.style.boxShadow="none"}>
{isAtual&&<div style={{position:"absolute",top:8,right:10,fontSize:10,color:"#4a7fa5",fontWeight:600}}>Atual</div>}
<div style={{fontSize:15,fontWeight:600,color:"#2c3e50",marginBottom:10}}>{mes}</div>
{temDados?(
<>
<div style={{fontSize:13,color:"#4a7fa5",fontWeight:600,marginBottom:3}}>{fmt(d.receita)}</div>
<div style={{fontSize:11,color:"#8a9aa4",marginBottom:8}}>Receita</div>
<div style={{height:3,background:"#e8e2da",borderRadius:2,overflow:"hidden"}}><div style={{height:"100%",width:Math.min(Math.max((saldo/d.receita)*100,0),100)+"%",background:saldo>=0?"#27ae60":"#c0392b",borderRadius:2}}/></div>
<div style={{fontSize:11,color:saldo>=0?"#27ae60":"#c0392b",marginTop:6}}>Saldo {fmt(saldo)}</div>
</>
):(
<div style={{fontSize:12,color:"#c0b8b0",marginTop:6}}>{isFuturo?"Aguardando":"Sem dados"}</div>
)}
</div>
);
})}</div>
</div>
);
};
const TIPOS_REL=[
{id:"vendas",label:"Vendas",icon:"📊",desc:"Por canal e total"},
{id:"despesas",label:"Despesas",icon:"📋",desc:"Todas as categorias"},
{id:"resultado",label:"Resultado",icon:"💰",desc:"Receita · Despesa · Saldo · Margem"},
{id:"prestadores",label:"Prestadores",icon:"🧵",desc:"Oficinas · Salas de Corte · Passadoria"},
{id:"projecao",label:"Projeção",icon:"🔮",desc:"2 meses seguintes com base no histórico"},
{id:"copiar",label:"Copiar para análise",icon:"📋",desc:"Copia dados formatados · Cola direto no Claude para análise estratégica"},
];
const RelatorioContent=(props)=>{
const {auxDataPorMes={},receitasPorMes={},prestadores={},boletosShared=[],cortes=[],mesAtual=3}=props;
const [tipo,setTipo]=useState(null);
const [mesSel,setMesSel]=useState(3);
const [copiado,setCopiado]=useState(false);
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
if(c==="Funcionários")return s+(aux["Funcionários"]||[]).reduce((a,x)=>a+["salario","comissao","extra","alimentacao","vale","ferias","rescisao"].reduce((b,f)=>b+parseFloat(x[f]||0),0),0)+FIXOS_FUNC.reduce((a,f)=>a+f.valor,0);
return s+(aux[c]||[]).reduce((a,x)=>a+parseFloat(x.valor||0),0);
},0);
return{st,br,mkt,r,desp,saldo:r-desp,margem:r>0?(((r-desp)/r)*100).toFixed(1):0};
};
const R=(n)=>"R$ "+Math.round(n).toLocaleString("pt-BR");
let txt="";
txt+=`GRUPO AMÍCIA — DADOS PARA ANÁLISE\n`;
txt+=`Gerado em: ${new Date().toLocaleString("pt-BR")}\n`;
txt+=`Para análise: Cole este texto no Claude e peça análise estratégica\n`;
txt+=`${"─".repeat(50)}\n\n`;
txt+=`P&L MENSAL ${anoAtual}:\n`;
let rAno=0,dAno=0;
mesesDados.forEach(m=>{
const t=totMes(m);rAno+=t.r;dAno+=t.desp;const al=t.saldo<0?"⚠":t.margem<5?" ":"✓";
txt+=`${MESES[m-1]}: Receita ${R(t.r)} | ST ${R(t.st)} | BR ${R(t.br)} | MKT ${R(t.mkt)} | Desp ${R(t.desp)} | Saldo ${R(t.saldo)} | Margem ${t.margem}% ${al}\n`;
});
txt+=`TOTAL ANO: Receita ${R(rAno)} | Despesa ${R(dAno)} | Saldo ${R(rAno-dAno)}\n\n`;
txt+=`${"─".repeat(50)}\n`;
txt+=`DESPESAS POR CATEGORIA (${MESES[mesSel-1]}):\n`;
const auxM=auxDataPorMes[mesSel]||{};
CATS.forEach(cat=>{
const t=totMes(mesSel);
let v=0;
if(cat==="Taxas Cartão")v=Math.round(t.r*0.01);
else if(cat==="Taxas Marketplaces")v=Math.round(t.mkt*0.29);
else if(cat==="Funcionários")v=(auxM["Funcionários"]||[]).reduce((s,r)=>s+["salario","comissao","extra","alimentacao","vale","ferias","rescisao"].reduce((a,f)=>a+parseFloat(r[f]||0),0),0)+FIXOS_FUNC.reduce((s,f)=>s+f.valor,0);
else v=(auxM[cat]||[]).reduce((s,r)=>s+parseFloat(r.valor||0),0);
if(v>0)txt+=`${cat}: ${R(v)}${t.r>0?" ("+((v/t.r)*100).toFixed(1)+"% receita)":""}\n`;
});
txt+=`\n${"─".repeat(50)}\n`;
txt+=`FORNECEDORES TECIDOS (top concentração):\n`;
const fornMap={};
boletosShared.forEach(b=>{const k=(b.empresa||"?").trim();fornMap[k]=(fornMap[k]||0)+parseFloat(b.valor||0);});
const fornTot=Object.values(fornMap).reduce((a,v)=>a+v,0);
Object.entries(fornMap).sort((a,b)=>b[1]-a[1]).slice(0,8).forEach(([emp,val])=>{
const pct=fornTot>0?((val/fornTot)*100).toFixed(1):0;
const al=pct>30?"⚠ ALTA CONCENTRAÇÃO":pct>15?" ATENÇÃO":"";
txt+=`${emp}: ${R(val)} (${pct}%) ${al}\n`;
});
txt+=`\n${"─".repeat(50)}\n`;
txt+=`OFICINAS — STATUS ATUAL:\n`;
const ofMap={};
cortes.forEach(c=>{
if(!ofMap[c.oficina])ofMap[c.oficina]={env:0,entr:0,atr:0,val:0};
ofMap[c.oficina].env+=c.qtd||0;
ofMap[c.oficina].entr+=(c.qtdEntregue||c.qtd)||0;
if(!c.entregue&&!c.pago&&Math.floor((Date.now()-new Date(c.data))/86400000)>=30)ofMap[c.oficina].atr++;
if(c.pago)ofMap[c.oficina].val+=(c.qtdEntregue||c.qtd||0)*(c.valorUnit||0);
});
Object.entries(ofMap).forEach(([of,d])=>{
const perda=d.env>0?(((d.env-d.entr)/d.env)*100).toFixed(1):0;
const al=d.atr>0?`⚠ ${d.atr} ATRASADO(S)`:"✓";
txt+=`${of}: ${d.env} peças enviadas | ${d.entr} entregues | Perda ${perda}% | Pago ${R(d.val)} ${al}\n`;
});
if(cortes.length===0)txt+=`Sem cortes lançados\n`;
txt+=`\n${"─".repeat(50)}\n`;
txt+=`BOLETOS EM ABERTO:\n`;
const aberto=boletosShared.filter(b=>!b.pago);
const totAberto=aberto.reduce((s,b)=>s+parseFloat(b.valor||0),0);
txt+=`Total em aberto: ${R(totAberto)} (${aberto.length} boletos)\n`;aberto.slice(0,10).forEach(b=>txt+=`${b.data} | ${b.empresa} | ${R(parseFloat(b.valor||0))} | ${MESES[b.mes-1]}\n`);
if(aberto.length>10)txt+=`... e mais ${aberto.length-10} boletos\n`;
if(navigator.clipboard){
navigator.clipboard.writeText(txt).then(()=>{setCopiado(true);setTimeout(()=>setCopiado(false),3000);});
} else {
const el=document.createElement('textarea');
el.value=txt;document.body.appendChild(el);el.select();document.execCommand('copy');document.body.removeChild(el);
setCopiado(true);setTimeout(()=>setCopiado(false),3000);
}
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
if(cat==="Funcionários")return(auxMes["Funcionários"]||[]).reduce((s,r)=>s+["salario","comissao","extra","alimentacao","vale","ferias","rescisao"].reduce((a,f)=>a+parseFloat(r[f]||0),0),0)+FIXOS_FUNC.reduce((s,f)=>s+f.valor,0);
return(auxMes[cat]||[]).reduce((s,r)=>s+parseFloat(r.valor||0),0);
};
const totalDesp=CATS.reduce((s,c)=>s+calcDesp(c),0);
const resultado=totalVendas-totalDesp;
const margem=totalVendas>0?((resultado/totalVendas)*100).toFixed(1):0;
const MesFiltro=()=>(<div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",marginBottom:16}}><span style={{fontSize:11,color:"#a89f94",letterSpacing:1,textTransform:"uppercase"}}>Mês:</span>{MESES.map((m,i)=><button key={i} onClick={()=>setMesSel(i+1)} style={{padding:"4px 10px",border:"1px solid "+(mesSel===i+1?"#2c3e50":"#e8e2da"),borderRadius:6,background:mesSel===i+1?"#2c3e50":"#fff",color:mesSel===i+1?"#fff":"#6b7c8a",cursor:"pointer",fontSize:11,fontFamily:"Georgia,serif"}}>{m}</button>)}</div>);
const BackBtn=()=>(<button onClick={()=>setTipo(null)} style={{background:"none",border:"1px solid #a3bacc",borderRadius:6,padding:"5px 14px",fontSize:12,color:"#4a7fa5",cursor:"pointer",fontFamily:"Georgia,serif"}}>← Relatórios</button>);
if(!tipo)return(<div><div style={{fontSize:11,color:"#a89f94",letterSpacing:2,textTransform:"uppercase",marginBottom:16}}>Selecione um relatório</div><div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:12}}>{TIPOS_REL.map(t=>(<div key={t.id} onClick={()=>t.id==="copiar"?copiarDados():setTipo(t.id)} style={{background:t.id==="copiar"?"#eaf7ee":"#fff",borderRadius:12,padding:"16px 20px",border:t.id==="copiar"?"1px solid #b8dfc8":"1px solid #e8e2da",cursor:"pointer",display:"flex",gap:14,alignItems:"center",minHeight:80}} onMouseEnter={e=>e.currentTarget.style.boxShadow="0 2px 12px rgba(0,0,0,0.08)"} onMouseLeave={e=>e.currentTarget.style.boxShadow="none"}><span style={{fontSize:26,flexShrink:0,width:32,textAlign:"center"}}>{t.icon}</span><div style={{minWidth:0,flex:1}}><div style={{fontSize:14,fontWeight:600,color:t.id==="copiar"?(copiado?"#27ae60":"#2c3e50"):"#2c3e50",marginBottom:3,lineHeight:1.3}}>{t.id==="copiar"&&copiado?"✓ Copiado! Cole no Claude":t.label}</div><div style={{fontSize:11,color:"#a89f94",lineHeight:1.4,whiteSpace:"normal"}}>{t.desc}</div></div></div>))}</div></div>);
if(tipo==="vendas")return(<div><div style={{display:"flex",gap:16,alignItems:"center",marginBottom:24}}><BackBtn/><div style={{fontSize:20,fontWeight:600,color:"#2c3e50"}}>Vendas</div></div><MesFiltro/><div style={{background:"#fff",borderRadius:12,padding:20,border:"1px solid #e8e2da"}}><div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:16}}>{[{label:"Total Geral",value:totalVendas,color:"#2c3e50",pct:null},{label:"Silva Teles",value:totalST,color:"#4a7fa5",pct:totalVendas>0?((totalST/totalVendas)*100).toFixed(1):0},{label:"Bom Retiro",value:totalBR,color:"#27ae60",pct:totalVendas>0?((totalBR/totalVendas)*100).toFixed(1):0},{label:"Marketplaces",value:totalMKT,color:"#e67e22",pct:totalVendas>0?((totalMKT/totalVendas)*100).toFixed(1):0}].map(c=>(<div key={c.label} style={{background:"#fff",borderRadius:12,padding:18,border:"1px solid #e8e2da"}}><div style={{fontSize:10,color:"#a89f94",letterSpacing:2,textTransform:"uppercase",marginBottom:6}}>{c.label}</div><div style={{fontSize:20,fontWeight:700,color:c.color}}>{fmt(c.value)}</div>{c.pct!==null&&<div style={{fontSize:11,color:"#a89f94",marginTop:4}}>{c.pct}% do total</div>}</div>))}</div></div></div>);
if(tipo==="despesas")return(<div><div style={{display:"flex",gap:16,alignItems:"center",marginBottom:24}}><BackBtn/><div style={{fontSize:20,fontWeight:600,color:"#2c3e50"}}>Despesas</div></div><MesFiltro/><div style={{background:"#fff",borderRadius:12,border:"1px solid #e8e2da",overflow:"hidden"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}><thead><tr style={{background:"#f7f4f0",borderBottom:"2px solid #e8e2da"}}>{["Categoria","Valor","% Total"].map(h=><th key={h} style={{padding:"10px 16px",textAlign:h==="Categoria"?"left":"right",color:"#a89f94",fontWeight:600,fontSize:11}}>{h}</th>)}</tr></thead><tbody>{CATS.map(cat=>{const v=calcDesp(cat);if(v===0)return null;const pct=totalDesp>0?((v/totalDesp)*100).toFixed(1):0;return(<tr key={cat} style={{borderBottom:"1px solid #f0ebe4"}}><td style={{padding:"11px 16px",color:"#2c3e50"}}>{cat}</td><td style={{padding:"11px 16px",textAlign:"right",color:"#2c3e50",fontWeight:500}}>{fmt(v)}</td><td style={{padding:"11px 16px",textAlign:"right",color:"#a89f94"}}>{pct}%</td></tr>);})}</tbody><tfoot><tr style={{background:"#f7f4f0",borderTop:"2px solid #e8e2da"}}><td style={{padding:"12px 16px",fontWeight:700,color:"#2c3e50"}}>Total</td><td style={{padding:"12px 16px",textAlign:"right",fontWeight:700,color:"#c0392b"}}>{fmt(totalDesp)}</td><td style={{padding:"12px 16px",textAlign:"right",color:"#a89f94"}}>100%</td></tr></tfoot></table></div></div>);
if(tipo==="resultado")return(<div><div style={{display:"flex",gap:16,alignItems:"center",marginBottom:24}}><BackBtn/><div style={{fontSize:20,fontWeight:600,color:"#2c3e50"}}>Resultado</div></div><MesFiltro/><div style={{background:"#fff",borderRadius:12,padding:20,border:"1px solid #e8e2da"}}><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>{[{label:"Receita Total",value:totalVendas,color:"#4a7fa5"},{label:"Despesa Total",value:totalDesp,color:"#c0392b"},{label:"Saldo",value:resultado,color:resultado>=0?"#27ae60":"#c0392b"},{label:"Margem",value:margem+"%",color:"#2c3e50",raw:true}].map(c=>(<div key={c.label} style={{background:"#fff",borderRadius:12,padding:22,border:"1px solid #e8e2da"}}><div style={{fontSize:11,color:"#a89f94",letterSpacing:2,textTransform:"uppercase",marginBottom:8}}>{c.label}</div><div style={{fontSize:26,fontWeight:700,color:c.color}}>{c.raw?c.value:fmt(c.value)}</div></div>))}</div></div></div>);
if(tipo==="prestadores")return(<div><div style={{display:"flex",gap:16,alignItems:"center",marginBottom:24}}><BackBtn/><div style={{fontSize:20,fontWeight:600,color:"#2c3e50"}}>Prestadores</div></div><MesFiltro/><div style={{background:"#fff",borderRadius:12,padding:20,border:"1px solid #e8e2da"}}>{CATS_PREST.map(cat=>{const linhas=auxMes[cat]||[];const total=linhas.reduce((s,r)=>s+parseFloat(r.valor||0),0);return(<div key={cat} style={{marginBottom:20}}><div style={{fontSize:13,fontWeight:600,color:"#2c3e50",marginBottom:8,display:"flex",justifyContent:"space-between"}}>{cat}<span style={{color:"#4a7fa5"}}>{fmt(total)}</span></div>{linhas.length>0?(<table style={{width:"100%",borderCollapse:"collapse",fontSize:13,border:"1px solid #e8e2da",borderRadius:8,overflow:"hidden"}}><thead><tr style={{background:"#f7f4f0"}}>{["Data","Prestador","Valor"].map(h=><th key={h} style={{padding:"8px 12px",textAlign:h==="Valor"?"right":"left",fontSize:11,color:"#a89f94",fontWeight:600}}>{h}</th>)}</tr></thead><tbody>{linhas.map((r,i)=><tr key={i} style={{borderTop:"1px solid #f0ebe4"}}><td style={{padding:"9px 12px",color:"#8a9aa4"}}>{r.data||"—"}</td><td style={{padding:"9px 12px",color:"#2c3e50"}}>{r.prestador||"—"}</td><td style={{padding:"9px 12px",textAlign:"right",fontWeight:500}}>{fmt(parseFloat(r.valor||0))}</td></tr>)}</tbody></table>):(<div style={{padding:16,color:"#c0b8b0",fontSize:13,background:"#f9f7f5",borderRadius:8}}>Sem lançamentos</div>)}</div>);})}</div></div>);
if(tipo==="projecao"){
// Sempre fixo: base = Jan + Fev (2 meses anteriores ao corrente Mar)
const mesesBase=[MES_ATUAL-2, MES_ATUAL-1].filter(m=>m>=1);
// Sempre fixo: projetar Abr + Mai (2 meses futuros ao corrente Mar)
const mesesProj=[MES_ATUAL+1, MES_ATUAL+2];
const calcDespMes=(cat,mesNum)=>{
const aux=auxDataPorMes[mesNum]||{};
const rec=receitasPorMes[mesNum]||{};
const totalVendasMes=Object.values(rec).reduce((s,d)=>s+parseFloat(d.silvaTeles||0)+parseFloat(d.bomRetiro||0)+parseFloat(d.marketplaces||0),0);
const totalMktMes=Object.values(rec).reduce((s,d)=>s+parseFloat(d.marketplaces||0),0);
if(cat==="Taxas Cartão")return Math.round(totalVendasMes*0.01);
if(cat==="Taxas Marketplaces")return Math.round(totalMktMes*0.29);
if(cat==="Valor de Correção")return 10000;
if(cat==="Funcionários"){const func=(aux["Funcionários"]||[]).reduce((s,r)=>s+["salario","comissao","extra","alimentacao","vale","ferias","rescisao"].reduce((a,f)=>a+parseFloat(r[f]||0),0),0);return func+FIXOS_FUNC.reduce((s,f)=>s+f.valor,0);}
return(aux[cat]||[]).reduce((s,r)=>s+parseFloat(r.valor||0),0);};
// Média dos 2 meses anteriores por categoria
const mediaCat=(cat)=>{
const vals=mesesBase.map(m=>calcDespMes(cat,m)).filter(v=>v>0);
return vals.length>0?Math.round(vals.reduce((s,v)=>s+v,0)/vals.length):0;
};
// Boletos do mês = valor real de Tecidos (substituem a média dessa categoria)
const boletosDoMes=(mesNum)=>boletosShared.filter(b=>b.mes===mesNum).reduce((s,b)=>s+parseFloat(b.valor||0),0);
// Tecidos usa boletos reais se houver, senão cai na média
const projetarCat=(cat,mesNum)=>{
if(cat==="Tecidos"){const bol=boletosDoMes(mesNum);return bol>0?bol:mediaCat(cat);}
return mediaCat(cat);
};
const totalProj=(mesNum)=>CATS.reduce((s,c)=>s+projetarCat(c,mesNum),0);
return(
<div>
<div style={{display:"flex",gap:16,alignItems:"center",marginBottom:24}}><BackBtn/><div style={{fontSize:20,fontWeight:600,color:"#2c3e50"}}>Projeção</div></div>
<div style={{background:"#fff8e8",border:"1px solid #f0d080",borderRadius:12,padding:"12px 20px",marginBottom:20,display:"flex",gap:12,alignItems:"center"}}>
<span>💡</span>
<div style={{fontSize:13,color:"#8a6500"}}>
<strong>Base:</strong> média de {mesesBase.map(m=>MESES[m-1]).join(" + ")} por categoria.
{" "}Tecidos usa o valor dos boletos lançados quando disponível.
</div>
</div>
<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:24}}>
{mesesProj.map(mesNum=>{
const bol=boletosDoMes(mesNum);
const tecidos=projetarCat("Tecidos",mesNum);
return(
<div key={mesNum} style={{background:"#fff",borderRadius:12,padding:22,border:"1px solid #e8e2da"}}>
<div style={{fontSize:11,color:"#a89f94",letterSpacing:2,textTransform:"uppercase",marginBottom:8}}>{MESES[mesNum-1]}</div>
<div style={{fontSize:26,fontWeight:700,color:"#c0392b",marginBottom:8}}>{fmt(totalProj(mesNum))}</div>
<div style={{display:"flex",flexDirection:"column",gap:4}}>
<div style={{fontSize:12,color:"#8a9aa4"}}>
Tecidos: <strong style={{color:"#2c3e50"}}>{fmt(tecidos)}</strong>
{bol>0&&<span style={{fontSize:11,color:"#4a7fa5",marginLeft:6}}>← boletos reais</span>}
{bol===0&&<span style={{fontSize:11,color:"#a89f94",marginLeft:6}}>← média</span>}
</div>
</div>
</div>
);
})}
</div>
<div style={{background:"#fff",borderRadius:12,border:"1px solid #e8e2da",overflow:"hidden"}}>
<table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
<thead>
<tr style={{background:"#f7f4f0",borderBottom:"2px solid #e8e2da"}}><th style={{padding:"10px 16px",textAlign:"left",fontSize:11,color:"#a89f94",fontWeight:600}}>Categoria</th>
<th style={{padding:"10px 16px",textAlign:"right",fontSize:11,color:"#a89f94",fontWeight:600}}>Média base</th>
{mesesProj.map(m=><th key={m} style={{padding:"10px 16px",textAlign:"right",fontSize:11,color:"#a89f94",fontWeight:600}}>{MESES[m-1]} (proj.)</th>)}
</tr>
</thead>
<tbody>
{CATS.map(cat=>{
const media=mediaCat(cat);
const vals=mesesProj.map(m=>projetarCat(cat,m));
if(media===0&&vals.every(v=>v===0))return null;
const isTecidos=cat==="Tecidos";
return(
<tr key={cat} style={{borderBottom:"1px solid #f0ebe4",background:isTecidos?"#f7f9ff":"#fff"}}>
<td style={{padding:"11px 16px",color:"#2c3e50",fontWeight:isTecidos?600:400}}>{cat}</td>
<td style={{padding:"11px 16px",textAlign:"right",color:"#a89f94"}}>{fmt(media)}</td>
{mesesProj.map((m,j)=>{
const v=vals[j];
const usouBoleto=isTecidos&&boletosDoMes(m)>0;
return(
<td key={m} style={{padding:"11px 16px",textAlign:"right",color:usouBoleto?"#4a7fa5":"#6b7c8a",fontWeight:usouBoleto?600:400}}>
{fmt(v)}{usouBoleto&&<span style={{fontSize:10,marginLeft:4}}> </span>}
</td>
);
})}
</tr>
);
})}
</tbody>
<tfoot>
<tr style={{background:"#f7f4f0",borderTop:"2px solid #e8e2da"}}>
<td style={{padding:"12px 16px",fontWeight:700,color:"#2c3e50"}}>Total Projetado</td>
<td style={{padding:"12px 16px",textAlign:"right",fontWeight:700,color:"#6b7c8a"}}>{fmt(CATS.reduce((s,c)=>s+mediaCat(c),0))}</td>
{mesesProj.map(m=><td key={m} style={{padding:"12px 16px",textAlign:"right",fontWeight:700,color:"#c0392b"}}>{fmt(totalProj(m))}</td>)}
</tr>
</tfoot>
</table>
</div>
</div>
);
}
return null;
};
// ── Módulo Oficinas ───────────────────────────────────────────────────────────
const OFICINAS_CAD_INICIAL = PRESTADORES_INICIAL["Oficinas Costura"].map((p,i)=>({
codigo: String(i+1).padStart(2,"0"), descricao: p.nome}));
const STATUS_COR = {amarelo:"#f0b429",vermelho:"#c0392b",azul:"#4a7fa5",verde:"#27ae60"};
const STATUS_BG = {amarelo:"#fffbea",vermelho:"#fdeaea",azul:"#eaf3fb",verde:"#eafbf0"};
const STATUS_LABEL= {amarelo:"Na oficina",vermelho:"Atrasado",azul:"Entregue",verde:"Pago"};
const getStatusCorte=(c)=>{
if(c.pago)return"verde";
if(c.entregue)return"azul";
const dias=Math.floor((Date.now()-new Date(c.data))/(86400000));
return dias>=30?"vermelho":"amarelo";
};
const getDias=(c)=>Math.floor((Date.now()-new Date(c.data))/(86400000));
const ORDEM_STATUS={amarelo:0,vermelho:1,azul:2,verde:3};
const EstrelaScore=({n})=>(
<span style={{color:"#f0b429",fontSize:12}}>
{[1,2,3,4,5].map(i=><span key={i} style={{opacity:i<=n?1:0.25}}>★</span>)}
</span>
);
const OficinasContent=({cortes,setCortes,produtos,setProdutos,oficinasCAD,setOficinasCAD,logTroca,setLogTroca,setAuxDataPorMes,mesAtual})=>{
const [aba,setAba]=useState("cortes");
const [cadAba,setCadAba]=useState("produtos");
const [filtroOf,setFiltroOf]=useState("todas");
const [filtroMarca,setFiltroMarca]=useState("todas");
const [filtroStatus,setFiltroStatus]=useState("todos");
const [filtroPago,setFiltroPago]=useState("todos");
const [mostraForm,setMostraForm]=useState(false);
const [editId,setEditId]=useState(null);
const [form,setForm]=useState({nCorte:"",ref:"",descricao:"",marca:"Amícia",qtd:"",valorUnit:"",oficina:"",data:new Date().toISOString().slice(0,10)});
const [refBusca,setRefBusca]=useState("");
// cadastros
const [formProd,setFormProd]=useState({ref:"",descricao:"",marca:"Amícia",valorUnit:""});
const [formOf,setFormOf]=useState({codigo:"",descricao:""});
const [editProdRef,setEditProdRef]=useState(null);
const [editOfCod,setEditOfCod]=useState(null);
// troca ref
const [trocaDe,setTrocaDe]=useState("");
const [trocaPara,setTrocaPara]=useState("");
const [trocaMsg,setTrocaMsg]=useState("");
// dashboard
const [dashPeriodo,setDashPeriodo]=useState("ano");
const [dashDe,setDashDe]=useState("");
const [dashAte,setDashAte]=useState("");
const [dashMarca,setDashMarca]=useState("todas");const [alertaVer,setAlertaVer]=useState(false);
const [verValores,setVerValores]=useState(false);
const [confirm,setConfirm]=useState(null);
const iStyle={border:"1px solid #c8d8e4",borderRadius:6,padding:"5px 9px",fontSize:12,outline:"none",fontFamily:"Georgia,serif",background:"#fff"};
// ordenação
const cortesOrdenados=[...cortes].sort((a,b)=>{
const sa=ORDEM_STATUS[getStatusCorte(a)],sb=ORDEM_STATUS[getStatusCorte(b)];
if(sa!==sb)return sa-sb;
return new Date(a.data)-new Date(b.data);
});
const cortesFiltrados=cortesOrdenados.filter(c=>{
if(filtroOf!=="todas"&&c.oficina!==filtroOf)return false;
if(filtroMarca!=="todas"&&c.marca!==filtroMarca)return false;
if(filtroPago==="pago"&&!c.pago)return false;
if(filtroPago==="naopago"&&c.pago)return false;
if(filtroStatus!=="todos"){
const st=getStatusCorte(c);
if(filtroStatus!==st)return false;
}
return true;
});
// buscar produto por ref
const buscarProd=(ref)=>produtos.find(p=>p.ref===String(ref).trim());
// ao digitar ref no form
const handleRefChange=(v)=>{
setRefBusca(v);
const p=buscarProd(v);
if(p)setForm(prev=>({...prev,ref:v,descricao:p.descricao,marca:p.marca,valorUnit:String(p.valorUnit)}));
else setForm(prev=>({...prev,ref:v}));
};
// salvar corte
const salvarCorte=()=>{
if(!form.ref||!form.oficina||!form.qtd||!form.valorUnit)return;
const qtd=parseFloat(form.qtd)||0,vu=parseFloat(form.valorUnit)||0;
const item={id:editId||Date.now(),nCorte:form.nCorte,ref:form.ref,descricao:form.descricao,
marca:form.marca,qtd,valorUnit:vu,valorTotal:Math.round(qtd*vu*100)/100,
oficina:form.oficina,data:form.data,
qtdEntregue:qtd,entregue:false,dataEntrega:null,pago:false,dataPagamento:null,obs:""};
if(editId)setCortes(prev=>prev.map(c=>c.id===editId?item:c));
else setCortes(prev=>[...prev,item]);
setForm({nCorte:"",ref:"",descricao:"",marca:"Amícia",qtd:"",valorUnit:"",oficina:"",data:new Date().toISOString().slice(0,10)});
setRefBusca(""); setMostraForm(false); setEditId(null);};
const iniciarEdicao=(c)=>{
setEditId(c.id);
setForm({nCorte:c.nCorte,ref:c.ref,descricao:c.descricao,marca:c.marca,qtd:String(c.qtd),valorUnit:String(c.valorUnit),oficina:c.oficina,data:c.data});
setRefBusca(c.ref); setMostraForm(true);
};
const deletarCorte=(id)=>setConfirm({msg:"Apagar este corte?",onYes:()=>{setCortes(prev=>prev.filter(c=>c.id!==id));setConfirm(null);}});
const toggleEntregue=(id)=>{
setCortes(prev=>prev.map(c=>{
if(c.id!==id)return c;
const ne=!c.entregue;
// Se desfazer entrega, desfaz pago também
return{...c,entregue:ne,dataEntrega:ne?new Date().toLocaleDateString("pt-BR"):null,pago:ne?c.pago:false,dataPagamento:ne?c.dataPagamento:null};
}));
};
const togglePago=(id)=>{
setCortes(prev=>prev.map(c=>{
if(c.id!==id||!c.entregue)return c;
const np=!c.pago;
if(np&&setAuxDataPorMes){
const hoje=new Date(),mes=hoje.getMonth()+1;
const dd=`${String(hoje.getDate()).padStart(2,"0")}/${String(mes).padStart(2,"0")}`;
const vl=String(Math.round((c.qtdEntregue||c.qtd)*(c.valorUnit||0)*100)/100);
setAuxDataPorMes(m=>{
const aux=m[mes]||{},ofs=[...(aux["Oficinas Costura"]||[])];
ofs.push({data:dd,prestador:c.oficina,valor:vl,descricao:`REF ${c.ref} - ${c.descricao}`});
return{...m,[mes]:{...aux,"Oficinas Costura":ofs}};
});
}
return{...c,pago:np,dataPagamento:np?new Date().toLocaleDateString("pt-BR"):null};
}));
};
const editarQtdEntregue=(id,v)=>setCortes(prev=>prev.map(c=>c.id===id?{...c,qtdEntregue:parseFloat(v)||0}:c));
// troca de referência
const executarTroca=()=>{
if(!trocaDe||!trocaPara){setTrocaMsg("Preencha os dois campos.");return;}
if(trocaDe===trocaPara){setTrocaMsg("As referências são iguais.");return;}
setProdutos(prev=>prev.map(p=>p.ref===trocaDe?{...p,ref:trocaPara}:p));
setCortes(prev=>prev.map(c=>c.ref===trocaDe?{...c,ref:trocaPara}:c));
const hoje=new Date().toLocaleDateString("pt-BR");
setLogTroca(prev=>[{de:trocaDe,para:trocaPara,data:hoje},...prev]);setTrocaMsg(`✓ REF ${trocaDe} → ${trocaPara} atualizada em tudo.`);
setTrocaDe("");setTrocaPara("");
};
// ── DASHBOARD helpers ─────────────────────────────────────────────────────
const hoje=new Date();
const anoStr=String(hoje.getFullYear());
const filtroPeriodo=(c)=>{
if(dashPeriodo==="ano")return c.data.startsWith(anoStr);
if(dashPeriodo==="custom"&&dashDe&&dashAte)return c.data>=dashDe&&c.data<=dashAte;
return true;
};
const cortesDash=cortes.filter(c=>filtroPeriodo(c)&&(dashMarca==="todas"||c.marca===dashMarca));
const oficinasUnicas=[...new Set(cortes.map(c=>c.oficina))].filter(Boolean);
const kpiOficina=(of)=>{
const cs=cortesDash.filter(c=>c.oficina===of);
const totalEnviadas=cs.reduce((s,c)=>s+c.qtd,0);
const totalEntregues=cs.reduce((s,c)=>s+(c.qtdEntregue||c.qtd),0);
const totalValor=cs.filter(c=>c.pago).reduce((s,c)=>s+(c.qtdEntregue||c.qtd)*c.valorUnit,0);
const entregues=cs.filter(c=>c.entregue||c.pago);
const prazos=entregues.filter(c=>c.dataEntrega).map(c=>Math.floor((new Date(c.dataEntrega.split("/").reverse().join("-"))-new Date(c.data))/(86400000)));
const prazoMedio=prazos.length>0?Math.round(prazos.reduce((a,v)=>a+v,0)/prazos.length):null;
const pontualidade=entregues.length>0?Math.round(entregues.filter(c=>{const d=getDias(c);return d<=30;}).length/entregues.length*100):null;
const perda=totalEnviadas>0?Math.round((totalEnviadas-totalEntregues)/totalEnviadas*100):0;
// nota 1-5
const np=pontualidade!=null?pontualidade/100:0.5;
const nm=prazoMedio!=null?Math.max(0,1-prazoMedio/60):0.5;
const npe=Math.max(0,1-perda/20);
const nota=Math.round((np*0.4+nm*0.3+npe*0.3)*5);
// aberto atual
const emAberto=cortes.filter(c=>c.oficina===of&&!c.entregue&&!c.pago).reduce((s,c)=>s+c.qtd,0);
return{totalEnviadas,totalEntregues,totalValor,prazoMedio,pontualidade,perda,nota,emAberto,total:cs.length};
};
// histórico médio p/ alerta de carga
const historicoMedioOf=(of)=>{
const cs=cortes.filter(c=>c.oficina===of);
if(cs.length===0)return 0;
// média de peças por mês ao longo de todo histórico
const meses=new Set(cs.map(c=>c.data.slice(0,7)));
return Math.round(cs.reduce((s,c)=>s+c.qtd,0)/Math.max(meses.size,1));
};
const emAbertoPorOf=(of)=>cortes.filter(c=>c.oficina===of&&!c.entregue&&!c.pago).reduce((s,c)=>s+c.qtd,0);
const alertas=oficinasUnicas.map(of=>{
const med=historicoMedioOf(of),aberto=emAbertoPorOf(of);
if(med===0)return null;const pct=Math.round((aberto-med)/med*100);
if(pct>=50)return{of,tipo:"sobrecarga",pct};
if(pct<=-30)return{of,tipo:"ociosa",pct};
return null;
}).filter(Boolean);
// exportar cortes em aberto
const exportarAberto=()=>{
const linhas=["Nº Corte;Ref;Descrição;Marca;Qtd;Vl.Unit;Total;Oficina;Data;Dias"];
cortesFiltrados.filter(c=>!c.pago).forEach(c=>{
const st=getStatusCorte(c);
linhas.push(`${c.nCorte};${c.ref};${c.descricao};${c.marca};${c.qtd};${c.valorUnit};${c.valorTotal};${c.oficina};${c.data};${getDias(c)} dias (${STATUS_LABEL[st]})`);
});
const blob=new Blob([linhas.join("\n")],{type:"text/csv;charset=utf-8;"});
const url=URL.createObjectURL(blob);
const a=document.createElement("a");a.href=url;a.download="cortes_aberto.csv";a.click();
URL.revokeObjectURL(url);
};
// ── RENDER ────────────────────────────────────────────────────────────────
const TabBtn=({id,label,icon})=>(
<button onClick={()=>setAba(id)} style={{padding:"7px 18px",border:"none",background:"transparent",cursor:"pointer",fontSize:13,fontFamily:"Georgia,serif",color:aba===id?"#2c3e50":"#8a9aa4",borderBottom:aba===id?"2px solid #2c3e50":"2px solid transparent",display:"flex",alignItems:"center",gap:7}}>
<span style={{fontSize:18}}>{icon}</span>{label}
</button>
);
return(
<div>
<ConfirmDialog confirm={confirm?confirm.msg:null} onCancel={()=>setConfirm(null)} onConfirm={confirm?.onYes}/>
{/* Tabs */}
<div style={{display:"flex",borderBottom:"1px solid #e8e2da",marginBottom:16}}>
<TabBtn id="cortes" label="Cortes" icon="✂️"/>
<TabBtn id="dashboard" label="Dashboard" icon="📊"/>
<TabBtn id="cadastros" label="Cadastros" icon="📦"/>
</div>
{/* ── ABA CORTES ── */}
{aba==="cortes"&&(
<div>
{/* Barra única: filtros + ações */}
<div style={{display:"flex",gap:6,marginBottom:8,alignItems:"center",flexWrap:"wrap"}}>
<select value={filtroOf} onChange={e=>setFiltroOf(e.target.value)} style={{...iStyle,flex:2,minWidth:110}}>
<option value="todas">Todas as oficinas</option>
{oficinasCAD.map(o=><option key={o.codigo} value={o.descricao}>{o.descricao}</option>)}
</select>
<select value={filtroMarca} onChange={e=>setFiltroMarca(e.target.value)} style={{...iStyle,flex:1,minWidth:80}}><option value="todas">Marca</option>
<option value="Amícia">Amícia</option>
<option value="Meluni">Meluni</option>
</select>
<select value={filtroStatus} onChange={e=>setFiltroStatus(e.target.value)} style={{...iStyle,flex:1,minWidth:90}}>
<option value="todos">Status</option>
<option value="amarelo"> Na oficina</option>
<option value="vermelho"> Atrasado</option>
<option value="azul"> Entregue</option>
<option value="verde"> Pago</option>
</select>
<select value={filtroPago} onChange={e=>setFiltroPago(e.target.value)} style={{...iStyle,flex:1,minWidth:80}}>
<option value="todos">Pagto</option>
<option value="pago">✓ Pago</option>
<option value="naopago"> Não pago</option>
</select>
<button onClick={exportarAberto} style={{background:"#fff",border:"1px solid #4a7fa5",color:"#4a7fa5",borderRadius:6,padding:"5px 10px",fontSize:11,cursor:"pointer",fontFamily:"Georgia,serif",whiteSpace:"nowrap"}}> Exportar</button>
<button onClick={()=>{setMostraForm(p=>!p);setEditId(null);setForm({nCorte:"",ref:"",descricao:"",marca:"Amícia",qtd:"",valorUnit:"",oficina:"",data:new Date().toISOString().slice(0,10)});setRefBusca("");}} style={{background:mostraForm?"#2c3e50":"#4a7fa5",color:"#fff",border:"none",borderRadius:6,padding:"5px 12px",fontSize:11,cursor:"pointer",fontFamily:"Georgia,serif",whiteSpace:"nowrap"}}>
{mostraForm?"✕":"+ Novo"}
</button>
</div>
{/* Formulário novo corte */}
{mostraForm&&(
<div style={{background:"#f0f6fb",border:"1px solid #c8d8e4",borderRadius:10,padding:14,marginBottom:12}}>
<div style={{display:"grid",gridTemplateColumns:"0.7fr 0.6fr 2fr 0.9fr 0.5fr 0.6fr 1.2fr 1fr 0.6fr",gap:6,alignItems:"end"}}>
<div>
<div style={{fontSize:11,color:"#2c3e50",marginBottom:2,fontWeight:700}}>Nº Corte</div>
<input value={form.nCorte} onChange={e=>setForm(p=>({...p,nCorte:e.target.value}))} style={{...iStyle,width:"100%"}}/>
</div>
<div>
<div style={{fontSize:11,color:"#2c3e50",marginBottom:2,fontWeight:700}}>Ref</div>
<input value={refBusca} onChange={e=>handleRefChange(e.target.value)} style={{...iStyle,width:"100%"}}/>
</div>
<div>
<div style={{fontSize:11,color:"#2c3e50",marginBottom:2,fontWeight:700}}>Descrição</div>
<input value={form.descricao} onChange={e=>setForm(p=>({...p,descricao:e.target.value}))} style={{...iStyle,width:"100%"}}/>
</div>
<div>
<div style={{fontSize:11,color:"#2c3e50",marginBottom:2,fontWeight:700}}>Marca</div>
<select value={form.marca} onChange={e=>setForm(p=>({...p,marca:e.target.value}))} style={{...iStyle,width:"100%"}}>
<option>Amícia</option><option>Meluni</option>
</select>
</div>
<div>
<div style={{fontSize:11,color:"#2c3e50",marginBottom:2,fontWeight:700}}>Qtd</div>
<input value={form.qtd} onChange={e=>setForm(p=>({...p,qtd:e.target.value}))} style={{...iStyle,width:"100%"}}/></div>
<div>
<div style={{fontSize:11,color:"#2c3e50",marginBottom:2,fontWeight:700}}>Vl.Unit</div>
<input value={form.valorUnit} onChange={e=>setForm(p=>({...p,valorUnit:e.target.value}))} style={{...iStyle,width:"100%"}}/>
</div>
<div>
<div style={{fontSize:11,color:"#2c3e50",marginBottom:2,fontWeight:700}}>Oficina</div>
<select value={form.oficina} onChange={e=>setForm(p=>({...p,oficina:e.target.value}))} style={{...iStyle,width:"100%"}}>
<option value="">Selecionar</option>
{oficinasCAD.map(o=><option key={o.codigo} value={o.descricao}>{o.descricao}</option>)}
</select>
</div>
<div>
<div style={{fontSize:11,color:"#2c3e50",marginBottom:2,fontWeight:700}}>Data envio</div>
<input type="date" value={form.data} onChange={e=>setForm(p=>({...p,data:e.target.value}))} style={{...iStyle,width:"100%"}}/>
</div>
<div style={{display:"flex",alignItems:"flex-end",justifyContent:"flex-end"}}>
<button onClick={salvarCorte} style={{background:"#4a7fa5",color:"#fff",border:"none",borderRadius:6,padding:"8px 14px",fontSize:12,cursor:"pointer",fontFamily:"Georgia,serif"}}>
{editId?"Atualizar":"Salvar"}
</button>
</div>
</div>
{refBusca&&!buscarProd(refBusca)&&(
<div style={{marginTop:8,padding:"6px 12px",background:"#fff8e8",border:"1px solid #f0d080",borderRadius:6,fontSize:11,color:"#8a6500"}}>
⚠ REF {refBusca} não cadastrada.
<button onClick={()=>{setCadAba("produtos");setAba("cadastros");setFormProd(p=>({...p,ref:refBusca}));}} style={{marginLeft:8,background:"none",border:"none",color:"#4a7fa5",cursor:"pointer",fontSize:11,textDecoration:"underline"}}>Cadastrar agora</button>
</div>
)}
</div>
)}
{/* Lista de cortes */}
<div style={{background:"#fff",borderRadius:12,border:"1px solid #e8e2da",overflow:"hidden"}}>
<div style={{overflowX:"auto",WebkitOverflowScrolling:"touch"}}>
<div style={{overflowY:"auto",maxHeight:760,minWidth:900}}>
{/* Header sticky dentro do scroll — evita desalinhamento com scrollbar */}
<div style={{display:"grid",gridTemplateColumns:"10px 80px 60px minmax(160px,1fr) 100px 60px 80px 100px 100px 52px 52px 80px 70px 30px",background:"#4a7fa5",borderBottom:"2px solid #3a6f95",minWidth:900,position:"sticky",top:0,zIndex:1}}>
{["","Nº Corte","Ref","Descrição · Marca","Oficina","Qtd","Vl.Unit","Total","Data","Entregue","Pago","Qtd.Entr","Faltante",""].map((h,i)=>(
<div key={i} style={{padding:"7px 8px",fontSize:10,color:"#fff",fontWeight:600,letterSpacing:0.5,textAlign:i>=5&&i<=7||i>=11?"right":"left",whiteSpace:"nowrap"}}>{h}</div>
))}
</div>
{cortesFiltrados.length===0&&<div style={{padding:32,textAlign:"center",color:"#c0b8b0",fontSize:13}}>Nenhum corte lançado</div>}
{cortesFiltrados.map(c=>{
const st=getStatusCorte(c);
const qtdEntr=c.qtdEntregue!=null?c.qtdEntregue:(c.entregue?c.qtd:null);
const faltante=c.entregue&&qtdEntr!=null?c.qtd-qtdEntr:null;
return(<div key={c.id} style={{display:"grid",gridTemplateColumns:"10px 80px 60px 1fr 100px 60px 80px 100px 100px 52px 52px 80px 70px 30px",borderBottom:"1px solid #f0ebe4",background:STATUS_BG[st],alignItems:"center"}}>
<div style={{height:"100%",background:STATUS_COR[st],minHeight:36}}/>
<div style={{padding:"5px 8px",fontSize:11,fontWeight:600,color:"#2c3e50"}}>{c.nCorte}</div>
<div style={{padding:"5px 8px",fontSize:12,fontWeight:700,color:"#2c3e50"}}>{c.ref}</div>
<div style={{padding:"5px 8px"}}>
<div style={{fontSize:12,color:"#2c3e50"}}>{c.descricao}</div>
<span style={{fontSize:9,color:"#fff",background:c.marca==="Meluni"?"#9b59b6":"#4a7fa5",borderRadius:3,padding:"1px 5px"}}>{c.marca}</span>
</div>
<div style={{padding:"5px 8px",fontSize:11,color:"#2c3e50"}}>{c.oficina}</div>
<div style={{padding:"5px 8px",fontSize:12,textAlign:"right",color:"#2c3e50",fontFamily:"'Courier New',Courier,monospace",fontWeight:600}}>{c.qtd}</div>
<div style={{padding:"5px 8px",fontSize:12,textAlign:"right",color:"#2c3e50",fontFamily:"'Courier New',Courier,monospace",fontWeight:600}}>{fmt(c.valorUnit)}</div>
<div style={{padding:"5px 8px",fontSize:12,textAlign:"right",fontWeight:700,color:"#2c3e50",fontFamily:"'Courier New',Courier,monospace"}}>{fmt(c.valorTotal)}</div>
<div style={{padding:"5px 8px",fontSize:11,color:"#6b7c8a"}}>{new Date(c.data).toLocaleDateString("pt-BR")}</div>
{/* Entregue */}
<div style={{display:"flex",alignItems:"center",justifyContent:"center"}}>
<div onClick={()=>!c.pago&&toggleEntregue(c.id)}
title={c.entregue&&!c.pago?"Clique para desfazer entrega":""}
style={{width:18,height:18,borderRadius:4,background:c.entregue||c.pago?"#4a7fa5":"#fff",border:c.entregue||c.pago?"none":"2px solid #c8d8e4",cursor:c.pago?"default":"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>
{(c.entregue||c.pago)&&<span style={{color:"#fff",fontSize:11,fontWeight:700}}>✓</span>}
</div>
</div>
{/* Pago */}
<div style={{display:"flex",alignItems:"center",justifyContent:"center"}}>
<div onClick={()=>c.entregue&&togglePago(c.id)}
title={c.pago?"Clique para desfazer pagamento":""}
style={{width:18,height:18,borderRadius:4,background:c.pago?"#27ae60":"#fff",border:c.pago?"none":c.entregue?"2px solid #27ae60":"2px solid #e0e0e0",cursor:c.entregue?"pointer":"default",display:"flex",alignItems:"center",justifyContent:"center"}}>
{c.pago&&<span style={{color:"#fff",fontSize:11,fontWeight:700}}>✓</span>}
</div>
</div>
{/* Qtd Entregue — editável quando entregue=true */}
<div style={{padding:"3px 6px"}}>
{c.entregue?(
<input
type="number" min="0" max={c.qtd}
value={qtdEntr??""}
onChange={e=>editarQtdEntregue(c.id,e.target.value)}
style={{width:"100%",border:"1px solid #c8d8e4",borderRadius:4,padding:"3px 5px",fontSize:12,textAlign:"right",fontFamily:"'Courier New',Courier,monospace",fontWeight:700,outline:"none",background:faltante>0?"#fff8e8":"#fff",color:faltante>0?"#b7791f":"#2c3e50"}}
/>
):(
<div style={{textAlign:"right",fontSize:12,color:"#d0c8c0",fontFamily:"'Courier New',Courier,monospace"}}>—</div>
)}
</div>
{/* Faltante — calculado */}
<div style={{padding:"5px 8px",textAlign:"right"}}>
{faltante!=null?(
<span style={{fontSize:12,fontWeight:700,fontFamily:"'Courier New',Courier,monospace",color:faltante>0?"#c0392b":faltante===0?"#27ae60":"#6b7c8a"}}>
{faltante>0?`-${faltante}`:faltante===0?"✓":faltante}</span>
):(
<span style={{fontSize:12,color:"#d0c8c0"}}>—</span>
)}
</div>
{/* Ações */}
<div style={{display:"flex",flexDirection:"column",gap:2,alignItems:"center",padding:"2px 4px"}}>
{!c.pago&&<span onClick={()=>iniciarEdicao(c)} style={{cursor:"pointer",fontSize:12,color:"#4a7fa5"}}>✏</span>}
<span onClick={()=>deletarCorte(c.id)} style={{cursor:"pointer",fontSize:13,color:"#d0c8c0"}}>×</span>
</div>
</div>
);
})}
</div>
</div>{/* end overflowY */}
</div>{/* end overflowX */}
{/* Legenda */}
<div style={{padding:"7px 16px",background:"#f7f4f0",borderTop:"1px solid #e8e2da",display:"flex",gap:16,alignItems:"center"}}>
{Object.entries(STATUS_LABEL).map(([k,v])=>(
<div key={k} style={{display:"flex",alignItems:"center",gap:5,fontSize:10,color:"#6b7c8a"}}>
<div style={{width:10,height:10,borderRadius:2,background:STATUS_COR[k]}}/>
{v}
</div>
))}
<div style={{marginLeft:"auto",fontSize:11,color:"#a89f94"}}>{cortesFiltrados.length} corte(s)</div>
</div>
</div>
)}
{/* ── ABA DASHBOARD ── */}
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
// valores (hidden behind click)
const totalEntregueNP=cortesDash.filter(c=>c.entregue&&!c.pago).reduce((s,c)=>s+c.qtd,0);
const totalAPagar=cortesDash.filter(c=>c.entregue&&!c.pago).reduce((s,c)=>s+(c.qtdEntregue||c.qtd)*c.valorUnit,0);
const totalPago=cortesDash.filter(c=>c.pago).reduce((s,c)=>s+(c.qtdEntregue||c.qtd)*c.valorUnit,0);const perda=totalEnviadas>0?totalEnviadas-totalEntregues:0;
const pctPerda=totalEnviadas>0?((perda/totalEnviadas)*100).toFixed(1):0;
// tempo médio por ref
const refMap={};
cortesDash.filter(c=>c.entregue||c.pago).forEach(c=>{
if(!c.dataEntrega)return;
const d=Math.floor((new Date(c.dataEntrega.split("/").reverse().join("-"))-new Date(c.data))/(86400000));
if(!refMap[c.ref])refMap[c.ref]={soma:0,n:0,desc:c.descricao};
refMap[c.ref].soma+=d;refMap[c.ref].n++;
});
const refsMedias=Object.entries(refMap).map(([ref,v])=>({ref,media:Math.round(v.soma/v.n),desc:v.desc})).sort((a,b)=>b.media-a.media);
return(
<div>
{/* Filtros */}
<div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap",alignItems:"center"}}>
<div style={{display:"flex",background:"#e8e2da",borderRadius:8,padding:3}}>
{[{id:"ano",label:"Ano corrente"},{id:"custom",label:"Período"}].map(o=>(
<button key={o.id} onClick={()=>setDashPeriodo(o.id)} style={{padding:"5px 14px",border:"none",borderRadius:6,cursor:"pointer",fontSize:11,fontFamily:"Georgia,serif",background:dashPeriodo===o.id?"#2c3e50":"transparent",color:dashPeriodo===o.id?"#fff":"#6b7c8a"}}>{o.label}</button>
))}
</div>
{dashPeriodo==="custom"&&<><input type="date" value={dashDe} onChange={e=>setDashDe(e.target.value)} style={{...iStyle}}/><span style={{fontSize:11,color:"#a89f94"}}>até</span><input type="date" value={dashAte} onChange={e=>setDashAte(e.target.value)} style={{...iStyle}}/></>}
<select value={dashMarca} onChange={e=>setDashMarca(e.target.value)} style={{...iStyle}}>
<option value="todas">Todas as marcas</option><option>Amícia</option><option>Meluni</option>
</select>
</div>
{/* Cards principais — foco em peças */}
<div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:16}}>
{[
{label:"Peças em produção",pcs:totalEmAberto,sub:`${nCortesAberto} corte${nCortesAberto!==1?"s":""}`,color:"#f0b429",bg:"#fffbea",bord:"#f5d57a"},
{label:"Peças em atraso",pcs:totalAtrasado,sub:`${nCortesAtrasado} corte${nCortesAtrasado!==1?"s":""}`,color:"#c0392b",bg:"#fdeaea",bord:"#f4b8b8"},
{label:"Entregues · últ. 30 dias",pcs:totalEntregue30d,sub:`${nCortes30d} corte${nCortes30d!==1?"s":""}`,color:"#27ae60",bg:"#eafbf0",bord:"#b8dfc8"},
{label:"Peças não entregues",pcs:nNaoEntregue,sub:`${pctNaoEntregue}% do total enviado`,color:Number(pctNaoEntregue)>10?"#c0392b":"#8a9aa4",bg:"#f7f4f0",bord:"#e8e2da"},
].map((c,i)=>(
<div key={i} style={{background:c.bg,borderRadius:12,padding:"16px 18px",border:`1px solid ${c.bord}`}}>
<div style={{fontSize:9,color:"#a89f94",letterSpacing:2,textTransform:"uppercase",marginBottom:8}}>{c.label}</div>
<div style={{fontSize:28,fontWeight:700,color:c.color,lineHeight:1}}>{c.pcs}</div>
<div style={{fontSize:10,color:"#8a9aa4",marginTop:6,fontWeight:500}}>{c.sub}</div>
</div>
))}
</div>
{/* Valores financeiros — colapsável */}
<div style={{marginBottom:16}}>
<button onClick={()=>setVerValores(p=>!p)} style={{background:"#fff",border:"1px solid #e8e2da",borderRadius:8,padding:"7px 16px",fontSize:11,cursor:"pointer",color:"#6b7c8a",fontFamily:"Georgia,serif",display:"flex",alignItems:"center",gap:8}}>{verValores?"Ocultar valores financeiros":"Ver valores financeiros"}
<span style={{fontSize:10}}>{verValores?"▲":"▼"}</span>
</button>
{verValores&&(
<div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,marginTop:10}}>
{[
{label:"A pagar (entregue)",value:fmt(totalAPagar),sub:totalEntregueNP+" pç aguardando pagamento",color:"#4a7fa5"},
{label:"Total pago no período",value:fmt(totalPago),color:"#27ae60"},
{label:"Perda estimada",value:perda+" peças",sub:pctPerda+"% do enviado",color:perda>0?"#c0392b":"#27ae60"},
].map((c,i)=>(
<div key={i} style={{background:"#fff",borderRadius:10,padding:"14px 16px",border:"1px solid #e8e2da"}}>
<div style={{fontSize:9,color:"#a89f94",letterSpacing:2,textTransform:"uppercase",marginBottom:6}}>{c.label}</div>
<div style={{fontSize:18,fontWeight:700,color:c.color}}>{c.value}</div>
{c.sub&&<div style={{fontSize:10,color:"#8a9aa4",marginTop:4}}>{c.sub}</div>}
</div>
))}
</div>
)}
</div>
{/* Alerta de carga */}
{alertas.length>0&&(
<div style={{marginBottom:16}}>
<div onClick={()=>setAlertaVer(p=>!p)} style={{background:"#fff8e8",border:"1px solid #f0d080",borderRadius:10,padding:"10px 16px",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
<span style={{fontSize:12,fontWeight:600,color:"#8a6500"}}>⚠ {alertas.length} alerta(s) de capacidade nas oficinas</span>
<span style={{fontSize:11,color:"#8a6500"}}>{alertaVer?"▲":"▼"}</span>
</div>
{alertaVer&&(
<div style={{background:"#fff",border:"1px solid #f0d080",borderTop:"none",borderRadius:"0 0 10px 10px",padding:12}}>
{alertas.map((a,i)=>(
<div key={i} style={{display:"flex",gap:10,alignItems:"center",padding:"6px 0",borderBottom:"1px solid #f7f4f0"}}>
<span style={{fontSize:16}}>{a.tipo==="sobrecarga"?"🔴":"⚪"}</span>
<span style={{fontSize:13,color:"#2c3e50",fontWeight:600}}>{a.of}</span>
<span style={{fontSize:12,color:a.tipo==="sobrecarga"?"#c0392b":"#b7791f"}}>
{a.tipo==="sobrecarga"?`${a.pct}% acima do histórico — possível sobrecarga`:`${Math.abs(a.pct)}% abaixo do histórico — oficina ociosa`}
</span>
</div>
))}
</div>
)}
</div>
)}
{/* Ranking por oficina */}
<div style={{background:"#fff",borderRadius:12,border:"1px solid #e8e2da",overflow:"hidden",marginBottom:16}}>
<div style={{padding:"12px 16px",borderBottom:"1px solid #e8e2da",fontSize:11,color:"#a89f94",letterSpacing:2,textTransform:"uppercase"}}>Ranking de Oficinas</div>
<table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}><thead><tr style={{background:"#f7f4f0"}}>
{["Oficina","Peças fabricadas","Valor pago","Prazo médio","Pontualidade","% Perda","Eficiência"].map(h=>(
<th key={h} style={{padding:"8px 12px",textAlign:h==="Oficina"?"left":"center",fontSize:10,color:"#a89f94",fontWeight:600}}>{h}</th>
))}
</tr></thead>
<tbody>
{oficinasUnicas.sort((a,b)=>kpiOficina(b).nota-kpiOficina(a).nota).map(of=>{
const k=kpiOficina(of);
return(
<tr key={of} style={{borderBottom:"1px solid #f0ebe4"}}>
<td style={{padding:"9px 12px",fontWeight:600,color:"#2c3e50"}}>{of}</td>
<td style={{padding:"9px 12px",textAlign:"center",color:"#2c3e50"}}>{k.totalEntregues}<span style={{fontSize:10,color:"#a89f94"}}>/{k.totalEnviadas}</span></td>
<td style={{padding:"9px 12px",textAlign:"center",color:"#27ae60",fontWeight:600}}>{fmt(k.totalValor)}</td>
<td style={{padding:"9px 12px",textAlign:"center",color:"#2c3e50"}}>{k.prazoMedio!=null?k.prazoMedio+"d":"—"}</td>
<td style={{padding:"9px 12px",textAlign:"center",color:k.pontualidade>=80?"#27ae60":k.pontualidade>=50?"#f0b429":"#c0392b"}}>{k.pontualidade!=null?k.pontualidade+"%":"—"}</td>
<td style={{padding:"9px 12px",textAlign:"center",color:k.perda>5?"#c0392b":"#27ae60"}}>{k.perda}%</td>
<td style={{padding:"9px 12px",textAlign:"center"}}><EstrelaScore n={k.nota}/></td>
</tr>
);
})}
{oficinasUnicas.length===0&&<tr><td colSpan={7} style={{padding:24,textAlign:"center",color:"#c0b8b0"}}>Sem dados no período</td></tr>}
</tbody>
</table>
</div>
{/* Tempo médio por referência */}
{refsMedias.length>0&&(
<div style={{background:"#fff",borderRadius:12,border:"1px solid #e8e2da",overflow:"hidden"}}>
<div style={{padding:"12px 16px",borderBottom:"1px solid #e8e2da",fontSize:11,color:"#a89f94",letterSpacing:2,textTransform:"uppercase"}}>Tempo médio por referência</div>
<div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:0}}>
{refsMedias.slice(0,8).map((r,i)=>(
<div key={r.ref} style={{padding:"12px 16px",borderRight:i%4<3?"1px solid #e8e2da":"none",borderBottom:"1px solid #f0ebe4"}}>
<div style={{fontSize:13,fontWeight:700,color:"#2c3e50"}}>REF {r.ref}</div>
<div style={{fontSize:10,color:"#a89f94",marginBottom:4}}>{r.desc}</div>
<div style={{fontSize:16,fontWeight:700,color:r.media>30?"#c0392b":"#4a7fa5"}}>{r.media}d</div>
<div style={{fontSize:10,color:"#a89f94"}}>prazo médio</div>
</div>
))}
</div>
</div>
)}
</div>
);
})()}
{/* ── ABA CADASTROS ── */}
{aba==="cadastros"&&(<div>
<div style={{display:"flex",gap:4,borderBottom:"1px solid #e8e2da",marginBottom:16}}>
{[{id:"produtos",label:"Produtos"},{ id:"oficinas",label:"Oficinas"},{id:"troca",label:"Troca de Referência"},{id:"log",label:"Log de Trocas"}].map(t=>(
<button key={t.id} onClick={()=>setCadAba(t.id)} style={{padding:"6px 14px",border:"none",background:"transparent",cursor:"pointer",fontSize:11,fontFamily:"Georgia,serif",color:cadAba===t.id?"#2c3e50":"#8a9aa4",borderBottom:cadAba===t.id?"2px solid #2c3e50":"2px solid transparent"}}>{t.label}</button>
))}
</div>
{/* Produtos */}
{cadAba==="produtos"&&(
<div>
<div style={{background:"#f0f6fb",border:"1px solid #c8d8e4",borderRadius:10,padding:12,marginBottom:12}}>
<div style={{display:"grid",gridTemplateColumns:"80px 1fr 120px 110px 130px",gap:6,alignItems:"end"}}>
<div><div style={{fontSize:11,color:"#2c3e50",marginBottom:2,fontWeight:700}}>Ref</div><input value={formProd.ref} onChange={e=>setFormProd(p=>({...p,ref:e.target.value.replace(/\D/g,"").slice(0,5)}))} style={{...iStyle,width:"100%"}}/></div>
<div><div style={{fontSize:11,color:"#2c3e50",marginBottom:2,fontWeight:700}}>Descrição</div><input value={formProd.descricao} onChange={e=>setFormProd(p=>({...p,descricao:e.target.value}))} style={{...iStyle,width:"100%"}}/></div>
<div><div style={{fontSize:11,color:"#2c3e50",marginBottom:2,fontWeight:700}}>Marca</div><select value={formProd.marca} onChange={e=>setFormProd(p=>({...p,marca:e.target.value}))} style={{...iStyle,width:"100%"}}><option>Amícia</option><option>Meluni</option></select></div>
<div><div style={{fontSize:11,color:"#2c3e50",marginBottom:2,fontWeight:700}}>Vl. Unit</div><input value={formProd.valorUnit} onChange={e=>setFormProd(p=>({...p,valorUnit:e.target.value.replace(/\D/g,"").replace(/^(\d+)(\d{2})$/,"$1,$2")}))} onBlur={e=>{const v=parseFloat(e.target.value.replace(",","."));if(!isNaN(v))setFormProd(p=>({...p,valorUnit:v.toFixed(2).replace(".",",")}));}} placeholder="0,00" style={{...iStyle,width:"100%",textAlign:"right",fontFamily:"'Courier New',Courier,monospace",fontWeight:600}}/></div>
<button onClick={()=>{
if(!formProd.ref||!formProd.descricao||!formProd.valorUnit)return;
if(editProdRef)setProdutos(prev=>prev.map(p=>p.ref===editProdRef?{...formProd,valorUnit:parseFloat(formProd.valorUnit)||0}:p));
else if(produtos.find(p=>p.ref===formProd.ref)){alert("Ref já cadastrada!");}
else setProdutos(prev=>[...prev,{...formProd,valorUnit:parseFloat(formProd.valorUnit)||0}]);
setFormProd({ref:"",descricao:"",marca:"Amícia",valorUnit:""});setEditProdRef(null);
}} style={{background:"#4a7fa5",color:"#fff",border:"none",borderRadius:6,padding:"7px",fontSize:11,cursor:"pointer",fontFamily:"Georgia,serif"}}>{editProdRef?"Atualizar":"Incluir Produto"}</button>
</div>
</div>
<div style={{background:"#fff",borderRadius:12,border:"1px solid #e8e2da",overflow:"hidden"}}>
<table style={{width:"100%",borderCollapse:"collapse",fontSize:12,tableLayout:"fixed"}}>
<colgroup>
<col style={{width:"80px"}}/>
<col/>
<col style={{width:"120px"}}/>
<col style={{width:"110px"}}/>
<col style={{width:"60px"}}/>
</colgroup>
<thead><tr style={{background:"#4a7fa5"}}>{["Ref","Descrição","Marca","Vl. Unitário",""].map(h=><th key={h} style={{padding:"8px 12px",textAlign:h==="Vl. Unitário"?"right":"left",fontSize:11,color:"#fff",fontWeight:600}}>{h}</th>)}</tr></thead>
<tbody>
{produtos.length===0&&<tr><td colSpan={5} style={{padding:24,textAlign:"center",color:"#c0b8b0"}}>Nenhum produto cadastrado</td></tr>}
{produtos.map(p=>(
<tr key={p.ref} style={{borderBottom:"1px solid #f0ebe4"}}>
<td style={{padding:"8px 12px",fontWeight:700,color:"#2c3e50"}}>{p.ref}</td>
<td style={{padding:"8px 12px",color:"#2c3e50"}}>{p.descricao}</td>
<td style={{padding:"8px 12px"}}><span style={{fontSize:10,color:"#fff",background:p.marca==="Meluni"?"#9b59b6":"#4a7fa5",borderRadius:3,padding:"2px 6px"}}>{p.marca}</span></td>
<td style={{padding:"8px 12px",textAlign:"right",color:"#2c3e50",fontWeight:700,fontFamily:"'Courier New',Courier,monospace"}}>{fmt(p.valorUnit)}</td>
<td style={{padding:"8px 8px",textAlign:"center"}}>
<span onClick={()=>{
const vStr=Number(p.valorUnit).toFixed(2).replace(".",",");
setFormProd({ref:p.ref,descricao:p.descricao,marca:p.marca,valorUnit:vStr});setEditProdRef(p.ref);
}} style={{cursor:"pointer",color:"#4a7fa5",fontSize:13,marginRight:8}}>✏</span>
<span onClick={()=>setProdutos(prev=>prev.filter(x=>x.ref!==p.ref))} style={{cursor:"pointer",color:"#d0c8c0",fontSize:15}}>×</span>
</td>
</tr>
))}
</tbody>
</table>
</div>
</div>
)}
{/* Oficinas */}
{cadAba==="oficinas"&&(
<div>
<div style={{background:"#f0f6fb",border:"1px solid #c8d8e4",borderRadius:10,padding:12,marginBottom:12}}>
<div style={{display:"grid",gridTemplateColumns:"80px 1fr 80px",gap:8,alignItems:"end"}}>
<div><div style={{fontSize:10,color:"#a89f94",marginBottom:2}}>Código</div><input value={formOf.codigo} onChange={e=>setFormOf(p=>({...p,codigo:e.target.value}))} placeholder="01" style={{...iStyle,width:"100%"}}/></div>
<div><div style={{fontSize:10,color:"#a89f94",marginBottom:2}}>Descrição / Nome</div><input value={formOf.descricao} onChange={e=>setFormOf(p=>({...p,descricao:e.target.value}))} placeholder="Roberto Belém" style={{...iStyle,width:"100%"}}/></div>
<button onClick={()=>{
if(!formOf.codigo||!formOf.descricao)return;
if(editOfCod)setOficinasCAD(prev=>prev.map(o=>o.codigo===editOfCod?{...formOf}:o));
else setOficinasCAD(prev=>[...prev,{...formOf}]);
setFormOf({codigo:"",descricao:""});setEditOfCod(null);
}} style={{background:"#4a7fa5",color:"#fff",border:"none",borderRadius:6,padding:"7px",fontSize:11,cursor:"pointer",fontFamily:"Georgia,serif"}}>{editOfCod?"Atualizar":"+ Oficina"}</button>
</div>
</div>
<div style={{background:"#fff",borderRadius:12,border:"1px solid #e8e2da",overflow:"hidden"}}>
<table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
<thead><tr style={{background:"#f7f4f0"}}>{["Código","Descrição","Cortes em aberto",""].map(h=><th key={h} style={{padding:"8px 12px",textAlign:"left",fontSize:10,color:"#a89f94",fontWeight:600}}>{h}</th>)}</tr></thead>
<tbody>
{oficinasCAD.length===0&&<tr><td colSpan={4} style={{padding:24,textAlign:"center",color:"#c0b8b0"}}>Nenhuma oficina</td></tr>}
{oficinasCAD.map(o=>{
const aberto=cortes.filter(c=>c.oficina===o.descricao&&!c.entregue&&!c.pago).length;
return(
<tr key={o.codigo} style={{borderBottom:"1px solid #f0ebe4"}}>
<td style={{padding:"8px 12px",fontWeight:700,color:"#2c3e50"}}>{o.codigo}</td>
<td style={{padding:"8px 12px",color:"#2c3e50"}}>{o.descricao}</td>
<td style={{padding:"8px 12px"}}>{aberto>0?<span style={{background:"#fffbea",color:"#b7791f",borderRadius:4,padding:"2px 8px",fontSize:11}}>{aberto} aberto(s)</span>:"—"}</td>
<td style={{padding:"8px 8px",textAlign:"center"}}>
<span onClick={()=>{setFormOf({codigo:o.codigo,descricao:o.descricao});setEditOfCod(o.codigo);}} style={{cursor:"pointer",color:"#4a7fa5",fontSize:13,marginRight:8}}>✏</span>
<span onClick={()=>setOficinasCAD(prev=>prev.filter(x=>x.codigo!==o.codigo))} style={{cursor:"pointer",color:"#d0c8c0",fontSize:15}}>×</span>
</td>
</tr>
);
})}
</tbody></table>
</div>
</div>
)}
{/* Troca de referência */}
{cadAba==="troca"&&(
<div style={{maxWidth:480}}>
<div style={{background:"#fff8e8",border:"1px solid #f0d080",borderRadius:10,padding:"12px 16px",marginBottom:16,fontSize:12,color:"#8a6500"}}>
⚠ A troca atualiza <strong>todos os cortes e o cadastro de produto</strong> com a referência antiga para a nova. Ação irreversível (registrada no log).
</div>
<div style={{display:"grid",gridTemplateColumns:"1fr 40px 1fr 100px",gap:8,alignItems:"end",marginBottom:12}}>
<div><div style={{fontSize:10,color:"#a89f94",marginBottom:2}}>Referência antiga</div><input value={trocaDe} onChange={e=>setTrocaDe(e.target.value.replace(/\D/g,"").slice(0,5))} placeholder="1234" style={{...iStyle,width:"100%"}}/></div>
<div style={{textAlign:"center",fontSize:18,color:"#a89f94",paddingBottom:4}}>→</div>
<div><div style={{fontSize:10,color:"#a89f94",marginBottom:2}}>Nova referência</div><input value={trocaPara} onChange={e=>setTrocaPara(e.target.value.replace(/\D/g,"").slice(0,5))} placeholder="1235" style={{...iStyle,width:"100%"}}/></div>
<button onClick={executarTroca} style={{background:"#c0392b",color:"#fff",border:"none",borderRadius:6,padding:"7px",fontSize:11,cursor:"pointer",fontFamily:"Georgia,serif"}}>Executar troca</button>
</div>
{trocaMsg&&<div style={{padding:"8px 14px",background:"#eafbf0",border:"1px solid #b8dfc8",borderRadius:6,fontSize:12,color:"#27ae60"}}>{trocaMsg}</div>}
</div>
)}
{/* Log de trocas */}
{cadAba==="log"&&(
<div style={{background:"#fff",borderRadius:12,border:"1px solid #e8e2da",overflow:"hidden"}}>
<div style={{padding:"12px 16px",borderBottom:"1px solid #e8e2da",fontSize:11,color:"#a89f94",letterSpacing:2,textTransform:"uppercase"}}>Histórico de trocas de referência</div>
{logTroca.length===0?<div style={{padding:32,textAlign:"center",color:"#c0b8b0",fontSize:13}}>Nenhuma troca registrada</div>:(
<table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
<thead><tr style={{background:"#f7f4f0"}}>{["Data","Ref anterior","Nova ref"].map(h=><th key={h} style={{padding:"8px 14px",textAlign:"left",fontSize:10,color:"#a89f94",fontWeight:600}}>{h}</th>)}</tr></thead>
<tbody>{logTroca.map((l,i)=><tr key={i} style={{borderBottom:"1px solid #f0ebe4"}}><td style={{padding:"9px 14px",color:"#8a9aa4"}}>{l.data}</td><td style={{padding:"9px 14px",color:"#c0392b",fontWeight:700}}>REF {l.de}</td><td style={{padding:"9px 14px",color:"#27ae60",fontWeight:700}}>REF {l.para}</td></tr>)}</tbody>
</table>
)}
</div>
)}
</div>
)}
</div>
);
};
// ── Usuários iniciais ─────────────────────────────────────────────────────────
const TODOS_MODULOS = ["dashboard","lancamentos","boletos","agenda","historico","relatorio","oficinas","configuracoes"];
const USUARIOS_INICIAL = [
{id:1, usuario:"admin", senha:"1234", modulos:[...TODOS_MODULOS,"usuarios"], admin:true},
{id:2, usuario:"corte", senha:"1234", modulos:["oficinas"], admin:false},
{id:3, usuario:"financeiro",senha:"1234", modulos:["boletos"], admin:false},
];// ── Tela de Login ─────────────────────────────────────────────────────────────
const LoginScreen=({usuarios,onLogin})=>{
const [user,setUser]=useState("");
const [senha,setSenha]=useState("");
const [erro,setErro]=useState(false);
const [mostraSenha,setMostraSenha]=useState(false);
const tentar=()=>{
const u=user.replace(/\s/g,"").toLowerCase();
const s=senha.replace(/\s/g,"");
if(!u||!s){setErro(true);return;}
const found=(usuarios||[]).find(x=>x.usuario.toLowerCase()===u && x.senha===s);
if(found){onLogin(found);setErro(false);}
else{setErro(true);}
};
return(
<div style={{height:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"#f7f4f0",fontFamily:"Georgia,serif"}}>
<div style={{background:"#fff",borderRadius:16,padding:"40px 36px",width:320,boxShadow:"0 8px 40px rgba(0,0,0,0.12)"}}>
<div style={{textAlign:"center",marginBottom:28}}>
<div style={{fontSize:11,color:"#a89f94",letterSpacing:3,textTransform:"uppercase",marginBottom:6}}>Grupo</div>
<div style={{fontSize:26,fontWeight:700,color:"#2c3e50",letterSpacing:1}}>Amícia</div>
<div style={{width:40,height:2,background:"#4a7fa5",margin:"12px auto 0"}}/>
</div>
<div style={{marginBottom:14}}>
<div style={{fontSize:11,color:"#a89f94",marginBottom:5}}>Usuário</div>
<input value={user} onChange={e=>{setUser(e.target.value);setErro(false);}}
onKeyDown={e=>e.key==="Enter"&&tentar()}
placeholder="Digite seu usuário"
autoCapitalize="none" autoCorrect="off" autoComplete="off" spellCheck="false"
style={{width:"100%",border:"1px solid "+(erro?"#f4b8b8":"#c8d8e4"),borderRadius:8,padding:"9px 12px",fontSize:13,outline:"none",fontFamily:"Georgia,serif",boxSizing:"border-box",background:erro?"#fdeaea":"#fff"}}/>
</div>
<div style={{marginBottom:20}}>
<div style={{fontSize:11,color:"#a89f94",marginBottom:5}}>Senha</div>
<div style={{position:"relative"}}>
<input
type={mostraSenha?"text":"password"}
value={senha}
onChange={e=>{setSenha(e.target.value);setErro(false);}}
onKeyDown={e=>e.key==="Enter"&&tentar()}
placeholder="Digite sua senha"
autoComplete="off"
style={{width:"100%",border:"1px solid "+(erro?"#f4b8b8":"#c8d8e4"),borderRadius:8,padding:"9px 40px 9px 12px",fontSize:13,outline:"none",fontFamily:"Georgia,serif",boxSizing:"border-box",background:erro?"#fdeaea":"#fff"}}/>
<span onClick={()=>setMostraSenha(p=>!p)}
style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",cursor:"pointer",fontSize:16,userSelect:"none"}}>
{mostraSenha?"🔒":"👁"}
</span>
</div></div>
{erro&&<div style={{fontSize:12,color:"#c0392b",textAlign:"center",marginBottom:14}}>
{(!user.trim()||!senha.trim())?"Preencha usuário e senha":"Usuário ou senha incorretos"}
</div>}
<button onClick={tentar} style={{width:"100%",background:"#2c3e50",color:"#fff",border:"none",borderRadius:8,padding:"11px",fontSize:14,cursor:"pointer",fontFamily:"Georgia,serif",fontWeight:600,letterSpacing:0.5}}>
Entrar
</button>
</div>
</div>
);
};
// ── Módulo Usuários ───────────────────────────────────────────────────────────
const UsuariosContent=({usuarios,setUsuarios})=>{
const [form,setForm]=useState({usuario:"",senha:"",modulos:[],admin:false});
const [editId,setEditId]=useState(null);
const [erro,setErro]=useState("");
const toggleMod=(mod)=>setForm(p=>({...p,modulos:p.modulos.includes(mod)?p.modulos.filter(m=>m!==mod):[...p.modulos,mod]}));
const toggleAdmin=()=>setForm(p=>{
const na=!p.admin;
return{...p,admin:na,modulos:na?[...TODOS_MODULOS,"usuarios"]:p.modulos};
});
const salvar=()=>{
if(!form.usuario.trim()||!form.senha.trim()){setErro("Preencha usuário e senha.");return;}
if(!editId&&usuarios.find(u=>u.usuario===form.usuario.trim().toLowerCase())){setErro("Usuário já existe.");return;}
if(form.modulos.length===0){setErro("Selecione ao menos um módulo.");return;}
if(editId){
setUsuarios(prev=>prev.map(u=>u.id===editId?{...u,...form,usuario:form.usuario.trim().toLowerCase()}:u));
} else {
setUsuarios(prev=>[...prev,{id:Date.now(),...form,usuario:form.usuario.trim().toLowerCase()}]);
}
setForm({usuario:"",senha:"",modulos:[],admin:false});
setEditId(null);setErro("");
};
const editar=(u)=>{setForm({usuario:u.usuario,senha:u.senha,modulos:[...u.modulos],admin:u.admin});setEditId(u.id);setErro("");};
const deletar=(id)=>{
if(usuarios.find(u=>u.id===id)?.admin){setErro("Não é possível excluir o admin.");return;}
setUsuarios(prev=>prev.filter(u=>u.id!==id));
};
const iStyle={border:"1px solid #c8d8e4",borderRadius:6,padding:"6px 10px",fontSize:12,outline:"none",fontFamily:"Georgia,serif",background:"#fff"};
return(
<div>{/* Formulário */}
<div style={{background:"#fff",borderRadius:12,border:"1px solid #e8e2da",padding:20,marginBottom:16}}>
<div style={{fontSize:11,color:"#a89f94",letterSpacing:2,textTransform:"uppercase",marginBottom:14}}>
{editId?"Editar usuário":"Novo usuário"}
</div>
<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}}>
<div>
<div style={{fontSize:11,color:"#a89f94",marginBottom:4}}>Usuário</div>
<input value={form.usuario} onChange={e=>setForm(p=>({...p,usuario:e.target.value}))} placeholder="nome_usuario" style={{...iStyle,width:"100%",boxSizing:"border-box"}}/>
</div>
<div>
<div style={{fontSize:11,color:"#a89f94",marginBottom:4}}>Senha</div>
<input value={form.senha} onChange={e=>setForm(p=>({...p,senha:e.target.value}))} placeholder="senha" style={{...iStyle,width:"100%",boxSizing:"border-box"}}/>
</div>
</div>
{/* Admin toggle */}
<div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
<div onClick={toggleAdmin} style={{width:40,height:22,borderRadius:11,background:form.admin?"#2c3e50":"#c8c0b8",cursor:"pointer",position:"relative",transition:"background .2s"}}>
<div style={{position:"absolute",top:3,left:form.admin?20:3,width:16,height:16,borderRadius:"50%",background:"#fff",transition:"left .2s"}}/>
</div>
<span style={{fontSize:13,color:form.admin?"#2c3e50":"#a89f94",fontWeight:form.admin?600:400}}>
{form.admin?"Administrador (acesso total)":"Usuário limitado"}
</span>
</div>
{/* Módulos */}
{!form.admin&&(
<div style={{marginBottom:14}}>
<div style={{fontSize:11,color:"#a89f94",marginBottom:8}}>Módulos com acesso</div>
<div style={{display:"flex",flexWrap:"wrap",gap:8}}>
{modules.filter(m=>m.id!=="usuarios").map(m=>{
const ativo=form.modulos.includes(m.id);
return(
<div key={m.id} onClick={()=>toggleMod(m.id)}
style={{display:"flex",alignItems:"center",gap:6,padding:"6px 12px",borderRadius:8,cursor:"pointer",fontSize:12,fontFamily:"Georgia,serif",border:"1px solid "+(ativo?"#4a7fa5":"#e8e2da"),background:ativo?"#eaf3fb":"#fff",color:ativo?"#4a7fa5":"#8a9aa4",userSelect:"none"}}>
<span>{m.icon}</span>
<span style={{fontWeight:ativo?600:400}}>{m.label}</span>
{ativo&&<span style={{fontSize:11,color:"#4a7fa5"}}>✓</span>}
</div>
);
})}
</div>
</div>
)}
{erro&&<div style={{fontSize:12,color:"#c0392b",marginBottom:10}}>{erro}</div>}<div style={{display:"flex",gap:8}}>
<button onClick={salvar} style={{background:"#2c3e50",color:"#fff",border:"none",borderRadius:6,padding:"8px 20px",fontSize:12,cursor:"pointer",fontFamily:"Georgia,serif"}}>
{editId?"Salvar alterações":"Criar usuário"}
</button>
{editId&&<button onClick={()=>{setForm({usuario:"",senha:"",modulos:[],admin:false});setEditId(null);setErro("");}} style={{background:"#fff",color:"#6b7c8a",border:"1px solid #e8e2da",borderRadius:6,padding:"8px 16px",fontSize:12,cursor:"pointer",fontFamily:"Georgia,serif"}}>Cancelar</button>}
</div>
</div>
{/* Lista de usuários */}
<div style={{background:"#fff",borderRadius:12,border:"1px solid #e8e2da",overflow:"hidden"}}>
<div style={{padding:"12px 16px",borderBottom:"1px solid #e8e2da",fontSize:11,color:"#a89f94",letterSpacing:2,textTransform:"uppercase"}}>Usuários cadastrados</div>
<table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
<thead><tr style={{background:"#f7f4f0"}}>
{["Usuário","Perfil","Módulos com acesso",""].map(h=><th key={h} style={{padding:"8px 14px",textAlign:"left",fontSize:10,color:"#a89f94",fontWeight:600}}>{h}</th>)}
</tr></thead>
<tbody>
{usuarios.map(u=>(
<tr key={u.id} style={{borderBottom:"1px solid #f0ebe4"}}>
<td style={{padding:"10px 14px",fontWeight:600,color:"#2c3e50"}}>{u.usuario}</td>
<td style={{padding:"10px 14px"}}>
{u.admin
?<span style={{background:"#2c3e50",color:"#fff",borderRadius:4,padding:"2px 8px",fontSize:11}}>Admin</span>
:<span style={{background:"#f0f6fb",color:"#4a7fa5",borderRadius:4,padding:"2px 8px",fontSize:11}}>Usuário</span>}
</td>
<td style={{padding:"10px 14px"}}>
<div style={{display:"flex",flexWrap:"wrap",gap:4}}>
{u.admin
?<span style={{fontSize:11,color:"#a89f94"}}>Todos os módulos</span>
:u.modulos.map(mid=>{const m=modules.find(x=>x.id===mid);return m?<span key={mid} style={{fontSize:11,color:"#6b7c8a",background:"#f7f4f0",borderRadius:3,padding:"1px 6px"}}>{m.icon} {m.label}</span>:null;})}
</div>
</td>
<td style={{padding:"10px 10px",textAlign:"center"}}>
<span onClick={()=>editar(u)} style={{cursor:"pointer",color:"#4a7fa5",fontSize:13,marginRight:10}}>✏</span>
{!u.admin&&<span onClick={()=>deletar(u.id)} style={{cursor:"pointer",color:"#d0c8c0",fontSize:15}}>×</span>}
</td>
</tr>
))}
</tbody>
</table>
</div>
</div>
);
};
const ConfiguracoesContent=({codigoFonte="",dadosBackup=null,onRestaurar=null,isAdmin=false})=>{
const [bling,setBling]=useState(()=>{
try{const s=localStorage.getItem("amica_bling");return s?JSON.parse(s):{exitus:"",lumia:"",muniam:""};}catch{return{exitus:"",lumia:"",muniam:""};}
});
const [mire,setMire]=useState({token:"",idSilvaTeles:"",idBomRetiro:""});
const [statusBling,setStatusBling]=useState({});
const [statusMire,setStatusMire]=useState(null);
const [saved,setSaved]=useState(false);
const [backupMsg,setBackupMsg]=useState("");
const [confirmRestore,setConfirmRestore]=useState(false);
const [pastaHandle,setPastaHandle]=useState(null);
const [pastaNome,setPastaNome]=useState(localStorage.getItem("amica_backup_folder_name")||"");
const [ultimoBackup,setUltimoBackup]=useState(localStorage.getItem("amica_ultimo_backup")||"");
// Auto-backup: verifica ao montar se faz 7+ dias
useEffect(()=>{
if(!isAdmin||!dadosBackup)return;
if(!ultimoBackup)return;
const dias=Math.floor((Date.now()-new Date(ultimoBackup))/86400000);
if(dias>=7)fazerBackupAuto();
},[]);
const gerarJson=()=>JSON.stringify({versao:"1.0",data:new Date().toISOString(),...dadosBackup},null,2);
const nomeArquivo=()=>`Amica_Backup_${new Date().toLocaleDateString("pt-BR").replace(/\//g,"-")}.json`;
const fazerBackupAuto=async()=>{
if(!dadosBackup)return;
const json=gerarJson();
// Tenta salvar na pasta definida se disponível
if(pastaHandle){
try{
const fh=await pastaHandle.getFileHandle(nomeArquivo(),{create:true});
const w=await fh.createWritable();
await w.write(json);await w.close();
const agora=new Date().toISOString();
setUltimoBackup(agora);localStorage.setItem("amica_ultimo_backup",agora);
setBackupMsg("✓ Backup automático salvo em: "+pastaNome);
setTimeout(()=>setBackupMsg(""),5000);
return;
}catch{}
}
// Fallback: download normal
const blob=new Blob([json],{type:"application/json"});
const url=URL.createObjectURL(blob);
const a=document.createElement("a");a.href=url;a.download=nomeArquivo();a.click();
URL.revokeObjectURL(url);
const agora=new Date().toISOString();
setUltimoBackup(agora);localStorage.setItem("amica_ultimo_backup",agora);
setBackupMsg("✓ Backup automático realizado (Downloads)");setTimeout(()=>setBackupMsg(""),5000);
};
const escolherPasta=async()=>{
if(!window.showDirectoryPicker){
setBackupMsg("⚠ Seu navegador não suporta seleção de pasta. Use Chrome ou Edge no PC.");
setTimeout(()=>setBackupMsg(""),5000);
return;
}
try{
const handle=await window.showDirectoryPicker({mode:"readwrite"});
setPastaHandle(handle);
setPastaNome(handle.name);
localStorage.setItem("amica_backup_folder_name",handle.name);
setBackupMsg("✓ Pasta definida: "+handle.name);
setTimeout(()=>setBackupMsg(""),3000);
}catch(e){
if(e.name!=="AbortError")setBackupMsg("⚠ Não foi possível acessar a pasta. Tente novamente.");
setTimeout(()=>setBackupMsg(""),4000);
}
};
const fazerBackup=async()=>{
if(!dadosBackup){setBackupMsg("Sem dados para backup.");return;}
const json=gerarJson();
if(pastaHandle){
try{
const fh=await pastaHandle.getFileHandle(nomeArquivo(),{create:true});
const w=await fh.createWritable();
await w.write(json);await w.close();
const agora=new Date().toISOString();
setUltimoBackup(agora);localStorage.setItem("amica_ultimo_backup",agora);
setBackupMsg("✓ Salvo em: "+pastaNome+" / "+nomeArquivo());
setTimeout(()=>setBackupMsg(""),4000);return;
}catch{setBackupMsg("Erro ao salvar na pasta. Fazendo download...");}
}
// Download normal
const blob=new Blob([json],{type:"application/json"});
const url=URL.createObjectURL(blob);
const a=document.createElement("a");a.href=url;a.download=nomeArquivo();a.click();
URL.revokeObjectURL(url);
const agora=new Date().toISOString();
setUltimoBackup(agora);localStorage.setItem("amica_ultimo_backup",agora);
setBackupMsg("✓ Backup salvo em Downloads!");
setTimeout(()=>setBackupMsg(""),3000);
};
const restaurarBackup=(e)=>{
const file=e.target.files[0];if(!file)return;
const reader=new FileReader();
reader.onload=(ev)=>{
try{
const dados=JSON.parse(ev.target.result);
if(onRestaurar)onRestaurar(dados);
setBackupMsg("✓ Backup restaurado com sucesso!");
setConfirmRestore(false);setTimeout(()=>setBackupMsg(""),3000);
}catch{
setBackupMsg("✗ Arquivo inválido. Use um backup gerado por este app.");
setTimeout(()=>setBackupMsg(""),4000);
}
};
reader.readAsText(file);e.target.value="";
};
const diasDesdeBackup=ultimoBackup?Math.floor((Date.now()-new Date(ultimoBackup))/86400000):null;
const [correcao,setCorrecao]=useState({ativo:true,valor:"10000"});
const [regras,setRegras]=useState({devolucao:"10"});
const [verCodigo,setVerCodigo]=useState(false);
const [copiado,setCopiado]=useState(false);
const testarBling=async(marca)=>{
setStatusBling(prev=>({...prev,[marca]:"testando"}));
const token=bling[marca];
if(!token){setStatusBling(prev=>({...prev,[marca]:"erro"}));return;}
try{
const resp=await fetch("/api/bling",{
method:"POST",headers:{"Content-Type":"application/json"},
body:JSON.stringify({tokens:{[marca]:token},devolucao:0})
});
const data=await resp.json();
if(data.erros&&data.erros.some(e=>e.startsWith(marca))){
setStatusBling(prev=>({...prev,[marca]:"erro"}));
} else {
setStatusBling(prev=>({...prev,[marca]:"ok"}));
}
}catch{
setStatusBling(prev=>({...prev,[marca]:"erro"}));
}
};
const testarMire=()=>{setStatusMire("testando");setTimeout(()=>setStatusMire(mire.token?"aguardando_deploy":"erro"),1500);};
const salvar=()=>{
localStorage.setItem("amica_bling",JSON.stringify(bling));
setSaved(true);setTimeout(()=>setSaved(false),2500);
};
const StatusBadge=({status})=>{if(!status)return null;const cfg={testando:{bg:"#f7f4f0",color:"#a89f94",text:"Testando…"},ok:{bg:"#eafbf0",color:"#27ae60",text:"✓ Token válido"},erro:{bg:"#fdeaea",color:"#c0392b",text:"✗ Token inválido ou sem permissão"}};const c=cfg[status]||cfg.testando;return<span style={{fontSize:11,padding:"3px 10px",borderRadius:10,background:c.bg,color:c.color}}>{c.text}</span>;};
const Section=({title,subtitle,children})=>(<div style={{background:"#fff",borderRadius:12,border:"1px solid #e8e2da",overflow:"hidden",marginBottom:16}}><div style={{padding:"16px 24px",borderBottom:"1px solid #e8e2da",background:"#f7f4f0"}}><div style={{fontSize:14,fontWeight:600,color:"#2c3e50"}}>{title}</div>{subtitle&&<div style={{fontSize:12,color:"#a89f94",marginTop:3}}>{subtitle}</div>}</div><div style={{padding:24}}>{children}</div></div>);
const iStyle={border:"1px solid #c8d8e4",borderRadius:6,padding:"7px 12px",fontSize:13,outline:"none",fontFamily:"Georgia,serif",flex:1};
return(
<div>
<div style={{fontSize:11,color:"#a89f94",letterSpacing:2,textTransform:"uppercase",marginBottom:16}}>Configurações</div>
<Section title="Bling — Marketplaces" subtitle="3 contas separadas · Exitus · Lumia · Muniam">
{[{key:"exitus",label:"Token API — Exitus",hint:"Bling → Configurações → API → Gerar token"},{key:"lumia",label:"Token API — Lumia",hint:null},{key:"muniam",label:"Token API — Muniam",hint:null}].map(f=>(
<div key={f.key} style={{marginBottom:20}}>
<div style={{fontSize:12,fontWeight:600,color:"#2c3e50",marginBottom:4}}>{f.label}</div>
{f.hint&&<div style={{fontSize:11,color:"#a89f94",marginBottom:8}}>{f.hint}</div>}
<div style={{display:"flex",gap:8}}><input value={bling[f.key]} onChange={e=>setBling(prev=>({...prev,[f.key]:e.target.value}))} type="password" placeholder="Token..." style={iStyle}/><button onClick={()=>testarBling(f.key)} style={{background:"transparent",color:"#4a7fa5",border:"1px solid #4a7fa5",borderRadius:6,padding:"7px 14px",fontSize:12,cursor:"pointer",whiteSpace:"nowrap",fontFamily:"Georgia,serif"}}>Testar</button></div>
<div style={{marginTop:6}}><StatusBadge status={statusBling[f.key]}/></div>
</div>
))}
</Section>
<Section title="Miré — Lojas Físicas" subtitle="Silva Teles e Bom Retiro">
<div style={{marginBottom:20}}>
<div style={{fontSize:12,fontWeight:600,color:"#2c3e50",marginBottom:4}}>Token API Miré</div>
<div style={{fontSize:11,color:"#a89f94",marginBottom:8}}>Miré → Configurações → Integrações → API</div>
<div style={{display:"flex",gap:8}}><input value={mire.token} onChange={e=>setMire(prev=>({...prev,token:e.target.value}))} type="password" placeholder="Token..." style={iStyle}/><button onClick={testarMire} style={{background:"transparent",color:"#4a7fa5",border:"1px solid #4a7fa5",borderRadius:6,padding:"7px 14px",fontSize:12,cursor:"pointer",fontFamily:"Georgia,serif"}}>Testar</button></div>
<div style={{marginTop:6}}><StatusBadge status={statusMire}/></div>
</div>
<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
{[{label:"ID Loja — Silva Teles",field:"idSilvaTeles",ph:"Ex: 1 ou ST"},{label:"ID Loja — Bom Retiro",field:"idBomRetiro",ph:"Ex: 2 ou BR"}].map(f=>(
<div key={f.field}><div style={{fontSize:12,fontWeight:600,color:"#2c3e50",marginBottom:4}}>{f.label}</div><input value={mire[f.field]} onChange={e=>setMire(prev=>({...prev,[f.field]:e.target.value}))} placeholder={f.ph} style={{...iStyle,flex:"unset",width:"100%",boxSizing:"border-box"}}/></div>
))}
</div>
</Section>
<Section title="Valor de Correção" subtitle="Reserva para ajustes de fechamento mensal">
<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
<div>
<div style={{fontSize:12,fontWeight:600,color:"#2c3e50",marginBottom:4}}>Valor mensal (R$)</div>
<div style={{display:"flex",alignItems:"center",gap:8}}><span style={{fontSize:13,color:"#6b7c8a"}}>R$</span><input value={correcao.valor} onChange={e=>setCorrecao(p=>({...p,valor:e.target.value}))} style={iStyle}/></div>
</div>
<div style={{display:"flex",flexDirection:"column",justifyContent:"center",gap:10}}>
<div style={{display:"flex",alignItems:"center",gap:10}}>
<div onClick={()=>setCorrecao(p=>({...p,ativo:!p.ativo}))} style={{width:40,height:22,borderRadius:11,background:correcao.ativo?"#4a7fa5":"#c8c0b8",cursor:"pointer",position:"relative",transition:"background .2s"}}><div style={{position:"absolute",top:3,left:correcao.ativo?20:3,width:16,height:16,borderRadius:"50%",background:"#fff",transition:"left .2s"}}/></div>
<span style={{fontSize:13,color:correcao.ativo?"#4a7fa5":"#a89f94",fontWeight:correcao.ativo?600:400}}>{correcao.ativo?"Ativo":"Inativo"}</span>
</div>
</div>
</div>
</Section>
<Section title="Regras de Dedução — Marketplaces" subtitle="Aplicadas automaticamente sobre receita bruta">
<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
<div>
<div style={{fontSize:12,fontWeight:600,color:"#2c3e50",marginBottom:4}}>% Devolução</div>
<div style={{fontSize:11,color:"#a89f94",marginBottom:8}}>Deduzido do valor bruto de marketplaces</div><div style={{display:"flex",alignItems:"center",gap:8}}><input value={regras.devolucao} onChange={e=>setRegras(p=>({...p,devolucao:e.target.value}))} style={{...iStyle,flex:"unset",width:60}}/><span style={{fontSize:14,color:"#6b7c8a",fontWeight:600}}>%</span><span style={{fontSize:11,color:"#a89f94"}}>(padrão: 10%)</span></div>
</div>
</div>
</Section>
<div style={{display:"flex",justifyContent:"flex-end",alignItems:"center",gap:12}}>
{saved&&<span style={{fontSize:12,color:"#27ae60",fontFamily:"Georgia,serif"}}>✓ Configurações salvas</span>}
<button onClick={salvar} style={{background:"#2c3e50",color:"#fff",border:"none",borderRadius:8,padding:"10px 28px",fontSize:13,cursor:"pointer",fontFamily:"Georgia,serif",fontWeight:600}}>Salvar configurações</button>
</div>
{/* Backup e Restauração — só admin */}
{isAdmin&&(
<div style={{background:"#fff",borderRadius:12,border:"1px solid #e8e2da",overflow:"hidden",marginBottom:16}}>
<div style={{padding:"14px 20px",background:"#f7f4f0",borderBottom:"1px solid #e8e2da",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
<div>
<div style={{fontSize:14,fontWeight:600,color:"#2c3e50"}}>💾 Backup e Restauração</div>
<div style={{fontSize:12,color:"#a89f94",marginTop:3}}>Salva todos os dados e configurações do app</div>
</div>
{diasDesdeBackup!==null&&(
<div style={{fontSize:11,color:diasDesdeBackup>=7?"#c0392b":"#27ae60",fontWeight:600,textAlign:"right"}}>
{diasDesdeBackup===0?"Backup hoje":diasDesdeBackup===1?"Último backup: ontem":`Último backup: há ${diasDesdeBackup} dias`}
{diasDesdeBackup>=7&&" "}
</div>
)}
</div>
<div style={{padding:20}}>
{/* Pasta definida */}
<div style={{display:"flex",gap:10,alignItems:"center",marginBottom:14,padding:"10px 14px",background:"#f7f4f0",borderRadius:8,border:"1px solid #e8e2da"}}>
<span style={{fontSize:18}}>📁</span>
<div style={{flex:1}}>
<div style={{fontSize:11,color:"#a89f94",marginBottom:2}}>Pasta de backup</div>
<div style={{fontSize:13,fontWeight:pastaNome?600:400,color:pastaNome?"#2c3e50":"#a89f94"}}>{pastaNome||"Nenhuma pasta definida — usará Downloads"}</div>
</div>
<button onClick={escolherPasta} style={{background:"#2c3e50",color:"#fff",border:"none",borderRadius:6,padding:"7px 14px",fontSize:12,cursor:"pointer",fontFamily:"Georgia,serif",whiteSpace:"nowrap"}}>
{pastaNome?"Alterar pasta":"Escolher pasta"}
</button>
</div>
{/* Botões */}
<div style={{display:"flex",gap:12,flexWrap:"wrap",alignItems:"center",marginBottom:12}}>
<button onClick={fazerBackup} style={{background:"#4a7fa5",color:"#fff",border:"none",borderRadius:8,padding:"10px 20px",fontSize:13,cursor:"pointer",fontFamily:"Georgia,serif",fontWeight:600,display:"flex",alignItems:"center",gap:8}}>
💾 Fazer Backup Agora
</button>
<div>
<input type="file" accept=".json" id="restore-input" style={{display:"none"}} onChange={restaurarBackup}/>
{!confirmRestore
?<button onClick={()=>setConfirmRestore(true)} style={{background:"#fff",color:"#c0392b",border:"1px solid #c0392b",borderRadius:8,padding:"10px 20px",fontSize:13,cursor:"pointer",fontFamily:"Georgia,serif",fontWeight:600}}>
⬆️ Restaurar Backup
</button>:<div style={{display:"flex",gap:8,alignItems:"center"}}>
<span style={{fontSize:12,color:"#c0392b"}}>⚠ Isso substituirá todos os dados atuais.</span>
<label htmlFor="restore-input" style={{background:"#c0392b",color:"#fff",border:"none",borderRadius:8,padding:"8px 16px",fontSize:12,cursor:"pointer",fontFamily:"Georgia,serif"}}>Confirmar e escolher arquivo</label>
<button onClick={()=>setConfirmRestore(false)} style={{background:"#fff",border:"1px solid #e8e2da",borderRadius:8,padding:"8px 14px",fontSize:12,cursor:"pointer",color:"#6b7c8a",fontFamily:"Georgia,serif"}}>Cancelar</button>
</div>
}
</div>
</div>
{backupMsg&&<div style={{fontSize:12,padding:"8px 12px",borderRadius:6,background:backupMsg.startsWith("✓")?"#eafbf0":"#fdeaea",color:backupMsg.startsWith("✓")?"#27ae60":"#c0392b",marginBottom:10}}>{backupMsg}</div>}
<div style={{fontSize:11,color:"#a89f94",lineHeight:1.6}}>
Backup automático semanal — ao abrir o app após 7 dias sem backup, salva automaticamente<br/>
Inclui: lançamentos · receitas · despesas · boletos · cortes · usuários · configurações
</div>
</div>
</div>
)}
{/* Código fonte */}
<div style={{background:"#fff",borderRadius:12,border:"1px solid #e8e2da",overflow:"hidden",marginTop:16}}>
<div style={{padding:"14px 20px",borderBottom:verCodigo?"1px solid #e8e2da":"none",display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer",background:"#f7f4f0"}} onClick={()=>setVerCodigo(p=>!p)}>
<div>
<div style={{fontSize:14,fontWeight:600,color:"#2c3e50"}}>💾 Código Fonte do App</div>
<div style={{fontSize:12,color:"#a89f94",marginTop:2}}>Copie para deploy no StackBlitz / Vercel</div>
</div>
<span style={{fontSize:12,color:"#a89f94"}}>{verCodigo?"▲":"▼"}</span>
</div>
{verCodigo&&(
<div style={{padding:16}}>
<div style={{display:"flex",gap:8,marginBottom:10}}>
<button onClick={()=>{
const el=document.getElementById("codigo-fonte-app");
if(el){
const range=document.createRange();
range.selectNodeContents(el);
const sel=window.getSelection();
sel.removeAllRanges();
sel.addRange(range);
}
}} style={{background:"#4a7fa5",color:"#fff",border:"none",borderRadius:6,padding:"6px 14px",fontSize:11,cursor:"pointer",fontFamily:"Georgia,serif"}}>
Selecionar tudo
</button>
{navigator.clipboard&&<button onClick={()=>{
navigator.clipboard.writeText(codigoFonte).then(()=>{setCopiado(true);setTimeout(()=>setCopiado(false),2000);});
}} style={{background:"#27ae60",color:"#fff",border:"none",borderRadius:6,padding:"6px 14px",fontSize:11,cursor:"pointer",fontFamily:"Georgia,serif"}}>
{copiado?"✓ Copiado!":" Copiar código"}
</button>}
</div><div style={{fontSize:11,color:"#a89f94",marginBottom:8}}>
Cole em <strong>src/App.jsx</strong> no StackBlitz ou Vercel
</div>
<textarea
id="codigo-fonte-app"
readOnly
value={codigoFonte}
style={{width:"100%",height:200,fontFamily:"monospace",fontSize:10,border:"1px solid #e8e2da",borderRadius:6,padding:10,background:"#f9f9f9",resize:"vertical",boxSizing:"border-box",color:"#2c3e50"}}
/>
</div>
)}
</div>
</div>
);
};
// ── Detecção automática do mês/ano corrente ────────────────────────────────
const _HOJE = new Date();
const MES_ATUAL = _HOJE.getMonth() + 1; // 1=Jan … 12=Dez
const ANO_ATUAL = _HOJE.getFullYear(); // 2026
// ── Computa totais de um mês a partir do estado vivo ──────────────────────
const calcDadosMes = (mesNum, recMes={}, auxMes={}) => {
const st = Object.values(recMes).reduce((s,d)=>s+parseFloat(d.silvaTeles||0),0);
const br = Object.values(recMes).reduce((s,d)=>s+parseFloat(d.bomRetiro||0),0);
const mkt = Object.values(recMes).reduce((s,d)=>s+parseFloat(d.marketplaces||0),0);
const receita = st+br+mkt;
const recTotais = {geral:receita, mkt};
const despesa = CATS.reduce((s,c)=>s+calcTotalAux(c,auxMes,recTotais),0);
const prolabore = (auxMes["Pró-Labore"]||[]).reduce((s,r)=>s+parseFloat(r.valor||0),0);
const oficinas = (auxMes["Oficinas Costura"]||[]).reduce((s,r)=>s+parseFloat(r.valor||0),0);
const tecidos = (auxMes["Tecidos"]||[]).reduce((s,r)=>s+parseFloat(r.valor||0),0);
return {receita,despesa,silvaTeles:st,bomRetiro:br,marketplaces:mkt,prolabore,oficinas,tecidos};
};
// ── Inicializa mês novo com todas as categorias zeradas ──────────────────
const inicializarMesNovo = () => {
const novo = {};
CATS.forEach(cat => { novo[cat] = []; });
return novo;
};
export default function App(){
const [active,setActive]=useState("dashboard");
const [usuarioLogado,setUsuarioLogado]=useState(null);
const [menuUser,setMenuUser]=useState(false);
const [usuarios,setUsuarios]=useState(USUARIOS_INICIAL);const [prestadores,setPrestadores]=useState(PRESTADORES_INICIAL);
// Módulo Oficinas
const [cortes,setCortes]=useState([]);
const [produtos,setProdutos]=useState([]);
const [oficinasCAD,setOficinasCAD]=useState(OFICINAS_CAD_INICIAL);
const [logTroca,setLogTroca]=useState([]);
// Boletos — inclui os de Março reais
const [boletosShared,setBoletosShared]=useState([...BOLETOS_MAR]);
// Receitas por mês — meses conhecidos pré-carregados
const receitasIniciais = {1:RECEITAS_JAN, 2:RECEITAS_FEV, 3:RECEITAS_MAR};
const [receitasPorMes,setReceitasPorMes]=useState(receitasIniciais);
// Aux por mês — meses conhecidos pré-carregados + mês atual inicializado
const auxIniciais = {1:AUX_JAN, 2:AUX_FEV, 3:AUX_MAR};
const [auxDataPorMes,setAuxDataPorMes]=useState(()=>{
if(MES_ATUAL>3 && !auxIniciais[MES_ATUAL]){
auxIniciais[MES_ATUAL] = inicializarMesNovo();
}
return auxIniciais;
});
const [categoriasPorMes,setCategoriasPorMes]=useState(()=>{
const base = {1:[...CATS],2:[...CATS],3:[...CATS]};
if(MES_ATUAL>3) base[MES_ATUAL]=[...CATS];
return base;
});
const [blingStatus,setBlingStatus]=useState(null); // null | "importando" | {ok, msg}
// ── Auto-importação Bling ao abrir o app ────────────────────────────────
useEffect(()=>{
const hoje=new Date().toISOString().slice(0,10);
const ultimaImport=localStorage.getItem("amica_bling_ultima");
if(ultimaImport===hoje)return; // já importou hoje
try{
const tokens=JSON.parse(localStorage.getItem("amica_bling")||"{}");
if(!tokens.exitus&&!tokens.lumia&&!tokens.muniam)return; // sem tokens configurados
setBlingStatus("importando");
fetch("/api/bling",{
method:"POST",
headers:{"Content-Type":"application/json"},
body:JSON.stringify({tokens,devolucao:10})
})
.then(r=>r.json())
.then(data=>{if(data.erro){setBlingStatus({ok:false,msg:"Bling: "+data.erro});return;}
const val=data.totalLiquido||0;
// Lança em marketplaces do dia 1 do mês atual (lump sum)
setReceitasPorMes(prev=>{
const mesAtual=prev[MES_ATUAL]||{};
const diaAtual=new Date().getDate();
return{
...prev,
[MES_ATUAL]:{
...mesAtual,
[diaAtual]:{
...(mesAtual[diaAtual]||{}),
marketplaces:String(val)
}
}
};
});
localStorage.setItem("amica_bling_ultima",hoje);
setBlingStatus({
ok:true,
msg:`✓ Bling: R$ ${val.toLocaleString("pt-BR")} (${data.totalPedidos} pedidos · ${data.pctDevolucao}% dev.)`
});
setTimeout(()=>setBlingStatus(null),8000);
})
.catch(e=>{
setBlingStatus({ok:false,msg:"Erro Bling: "+e.message});
setTimeout(()=>setBlingStatus(null),6000);
});
}catch{}
},[]);
// ── DADOS_MENSAIS computado dinamicamente do estado ─────────────────────
// Substitui o objeto estático — sempre reflete os dados reais
const dadosMensais = Object.fromEntries(
Array.from({length:12},(_,i)=>{
const mesNum = i+1;
if(mesNum < MES_ATUAL){
// Mês encerrado — computa do estado (histórico real)
const rec = receitasPorMes[mesNum]||{};
const aux = auxDataPorMes[mesNum]||{};
const temDados = Object.keys(rec).length>0 || Object.keys(aux).length>0;
if(!temDados) return [i, DADOS_MENSAIS[i]]; // fallback para dado estático
return [i, calcDadosMes(mesNum, rec, aux)];
} else if(mesNum === MES_ATUAL){
// Mês corrente — computa do estado vivo
return [i, calcDadosMes(mesNum, receitasPorMes[mesNum]||{}, auxDataPorMes[mesNum]||{})];
} else {return [i, {receita:0,despesa:0,silvaTeles:0,bomRetiro:0,marketplaces:0,prolabore:0,oficinas:0,tecidos:0}];
}
})
);
const getReceitasMes=(m)=>receitasPorMes[m]||{};
const setReceitasMes=(m,fn)=>setReceitasPorMes(prev=>({...prev,[m]:typeof fn==="function"?fn(prev[m]||{}):fn}));
const setAuxMes=(m,fn)=>setAuxDataPorMes(prev=>({...prev,[m]:typeof fn==="function"?fn(prev[m]||{}):fn}));
const setCatsMes=(m,fn)=>setCategoriasPorMes(prev=>({...prev,[m]:typeof fn==="function"?fn(prev[m]||[...CATS]):fn}));
// Login screen
if(!usuarioLogado){
return <LoginScreen usuarios={usuarios} onLogin={(u)=>{setUsuarioLogado(u);setActive(u.modulos[0]||"dashboard");}}/>;
}
const modulosVisiveis=modules.filter(m=>usuarioLogado.modulos.includes(m.id));
return(
<div style={{height:"100vh",display:"flex",flexDirection:"column",fontFamily:"Georgia,serif",background:"#f7f4f0"}}>
{blingStatus&&(
<div style={{background:blingStatus==="importando"?"#f0f6fb":blingStatus.ok?"#eafbf0":"#fdeaea",borderBottom:"1px solid "+(blingStatus==="importando"?"#c8d8e4":blingStatus.ok?"#b8dfc8":"#f0b8b8"),padding:"5px 16px",fontSize:12,color:blingStatus==="importando"?"#4a7fa5":blingStatus.ok?"#27ae60":"#c0392b",display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
{blingStatus==="importando"?<>⏳ Importando dados do Bling…</>:<>{blingStatus.msg}</>}
</div>
)}
<div style={{background:"#fff",borderBottom:"1px solid #e8e2da",padding:"6px 12px",display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
<div style={{flexShrink:0,marginRight:8}}>
<div style={{fontSize:8,color:"#a89f94",letterSpacing:2,textTransform:"uppercase",lineHeight:1}}>Grupo</div>
<div style={{fontSize:13,color:"#2c3e50",fontWeight:700,lineHeight:1.2}}>Amícia</div>
</div>
<div style={{display:"flex",gap:1,overflowX:"auto",flex:1,scrollbarWidth:"none",msOverflowStyle:"none"}}>
{modulosVisiveis.map(m=>(
<button key={m.id} onClick={()=>setActive(m.id)}
style={{display:"flex",flexDirection:"column",alignItems:"center",padding:"4px 10px",border:"none",background:active===m.id?"#f0f6fb":"transparent",borderRadius:6,cursor:"pointer",borderBottom:active===m.id?"2px solid #4a7fa5":"2px solid transparent",flexShrink:0,minWidth:0}}>
<span style={{fontSize:22}}>{m.icon}</span>
<span style={{fontSize:10,marginTop:2,color:active===m.id?"#4a7fa5":"#8a9aa4",fontWeight:active===m.id?600:400,whiteSpace:"nowrap"}}>{m.label}</span>
</button>
))}
</div>
<div style={{position:"relative",flexShrink:0}} id="user-menu">
<div onClick={()=>setMenuUser(p=>!p)}
style={{width:30,height:30,borderRadius:"50%",background:"#2c3e50",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0}}>
<span style={{fontSize:14}}>👤</span>
</div>
{menuUser&&(
<div style={{position:"absolute",right:0,top:36,background:"#fff",borderRadius:10,boxShadow:"0 4px 20px rgba(0,0,0,0.15)",border:"1px solid #e8e2da",minWidth:140,zIndex:999}}>
<div style={{padding:"10px 14px",borderBottom:"1px solid #f0ebe4"}}>
<div style={{fontSize:10,color:"#a89f94",letterSpacing:1,textTransform:"uppercase"}}>Conectado como</div><div style={{fontSize:13,fontWeight:600,color:"#2c3e50",marginTop:2}}>{usuarioLogado.usuario}</div>
</div>
<div onClick={()=>{setUsuarioLogado(null);setActive("dashboard");setMenuUser(false);}}
style={{padding:"10px 14px",cursor:"pointer",fontSize:13,color:"#c0392b",display:"flex",alignItems:"center",gap:8}}
onMouseEnter={e=>e.currentTarget.style.background="#fdeaea"}
onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
Sair
</div>
</div>
)}
</div>
</div>
<div style={{flex:1,background:"#f7f4f0",padding:active==="oficinas"||active==="lancamentos"?"12px 12px":"16px 20px",overflowY:"auto"}}>
{active==="dashboard"&&<DashboardContent dadosMensais={dadosMensais} mesAtual={MES_ATUAL}/>}
{active==="lancamentos"&&<LancamentosContent mes={MES_ATUAL} receitas={getReceitasMes(MES_ATUAL)} setReceitas={(fn)=>setReceitasMes(MES_ATUAL,fn)} auxData={auxDataPorMes[MES_ATUAL]||{}} setAuxData={(fn)=>setAuxMes(MES_ATUAL,fn)} categorias={categoriasPorMes[MES_ATUAL]||[...CATS]} setCategorias={(fn)=>setCatsMes(MES_ATUAL,fn)} boletos={boletosShared} setBoletos={setBoletosShared} prestadores={prestadores} setPrestadores={setPrestadores}/>}
{active==="boletos"&&<BoletosContent boletos={boletosShared} setBoletos={setBoletosShared} setAuxDataPorMes={setAuxMes}/>}
{active==="agenda"&&<AgendaContent/>}
{active==="historico"&&<HistoricoContent boletosShared={boletosShared} setBoletosShared={setBoletosShared} getReceitasMes={getReceitasMes} setReceitasMes={setReceitasMes} auxDataPorMes={auxDataPorMes} setAuxDataPorMes={setAuxMes} categoriasPorMes={categoriasPorMes} setCategoriasPorMes={setCatsMes} prestadores={prestadores} setPrestadores={setPrestadores} mesAtual={MES_ATUAL} dadosMensais={dadosMensais}/>}
{active==="relatorio"&&<RelatorioContent auxDataPorMes={auxDataPorMes} receitasPorMes={receitasPorMes} prestadores={prestadores} boletosShared={boletosShared} cortes={cortes} mesAtual={MES_ATUAL}/>}
{active==="oficinas"&&<OficinasContent cortes={cortes} setCortes={setCortes} produtos={produtos} setProdutos={setProdutos} oficinasCAD={oficinasCAD} setOficinasCAD={setOficinasCAD} logTroca={logTroca} setLogTroca={setLogTroca} setAuxDataPorMes={setAuxMes} mesAtual={MES_ATUAL}/>}
{active==="usuarios"&&<UsuariosContent usuarios={usuarios} setUsuarios={setUsuarios}/>}
{active==="configuracoes"&&<ConfiguracoesContent
codigoFonte={document.currentScript?.ownerDocument?.body?.innerText||""}
isAdmin={usuarioLogado?.admin===true}
dadosBackup={{receitasPorMes,auxDataPorMes,categoriasPorMes,boletosShared,cortes,produtos,oficinasCAD,logTroca,usuarios,prestadores}}
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
}}
/>}
</div>
</div>
);
}