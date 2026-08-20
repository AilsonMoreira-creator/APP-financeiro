/**
 * PickingWMS_Etiquetas.jsx — TELA de impressão de etiquetas (Ailson 12/08/2026)
 *
 * NÃO é modal: é uma tela do módulo, irmã da lista de separação, com os mesmos
 * filtros (empresa · loja · horário de corte · tipo) e a mesma linguagem visual
 * (azul marinho, azul claro, bege — nada fora da cartela).
 *
 * As etiquetas saem agrupadas por REFERÊNCIA e depois por LOCALIZAÇÃO:
 * todas as 2277 (loc A), todas as 2601 (loc A), todas as 2600 (loc B)… — o
 * casamento peça↔etiqueta acontece na arara, um grupo por vez.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { Printer, RefreshCw } from 'lucide-react';
import qzTray from 'qz-tray';
import { palette, FONT } from './Lojas_Shared.jsx';

const QZ_CERT = `-----BEGIN CERTIFICATE-----
MIIDtzCCAp+gAwIBAgIUR/CWjsg2m/FmkjQCJr0FViyCaSowDQYJKoZIhvcNAQEL
BQAwazELMAkGA1UEBhMCQlIxCzAJBgNVBAgMAlNQMRIwEAYDVQQHDAlTYW8gUGF1
bG8xFTATBgNVBAoMDEdydXBvIEFtaWNpYTEkMCIGA1UEAwwbQVBQIEZpbmFuY2Vp
cm8gR3J1cG8gQW1pY2lhMB4XDTI2MDgxOTExMjQwMFoXDTM2MDgxNjExMjQwMFow
azELMAkGA1UEBhMCQlIxCzAJBgNVBAgMAlNQMRIwEAYDVQQHDAlTYW8gUGF1bG8x
FTATBgNVBAoMDEdydXBvIEFtaWNpYTEkMCIGA1UEAwwbQVBQIEZpbmFuY2Vpcm8g
R3J1cG8gQW1pY2lhMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA42DV
IBm2q1f3vHfo5ysLmWqxlhKvfLlGiDZMHyEYGWDRyaDP3r/ZAfuSJPQhZMG1mfne
69Sv5y2LWs0TCMF63k9S8Er5lCLcqSKarYyfTUnvxXSMCm2dEziMuJFgfsGmfdW2
heI5WMQCPXNU2sibSX4mXXETJk66fzxSX163oV525XZgA5GzWlSbgBLUq0xyGmaI
r2FIksu5sZ2Wrdk5caIT0TQnsKZTKtj8L7Jh7rv4jjkSZXhbBqemsIR9/1lEpOV3
6MkPHHGbrVXIXa4+3WAt7OX91jBqoI+6X7dV2swoL0RBYhVr0eVlEVF4HGFBhhVJ
dYgSzu4WOYLPBLBV/QIDAQABo1MwUTAdBgNVHQ4EFgQUmw7s/jYdJ5+S/JQ9xuu/
8WU2H+gwHwYDVR0jBBgwFoAUmw7s/jYdJ5+S/JQ9xuu/8WU2H+gwDwYDVR0TAQH/
BAUwAwEB/zANBgkqhkiG9w0BAQsFAAOCAQEAg+FxgrjdJQZSYNb9gqCLXm1dcF1F
MPyjafhvSGms4ZNvQeANSTFqxwN27kmrivPIkjbNwuhxOZjiEjGVMSU42YM0eLVo
LHjV75H7UsFBa3R93LeeV9GgeWxgy+M9RKBYDSigRfc9oRQpk8SV1pHYIE3/z7c2
MF6IZjcw0J+G5ti7W+frRcfqZ/dfHhopbDNnXgPOakARkEOMTcSxOczB5p65nSYW
zh3mLwIIqB7dRe2RCm1Lr3Vqqugs/0e1gSTwt6wZWgMGrl3PD8H5eGLsqzFItg4v
fLPE8QepakxMu9EEprDLysaVQbS0hlvBIza2fPjC7pT+8CAjfM8XWGn0oA==
-----END CERTIFICATE-----`;

const CONTAS = ['exitus', 'lumia', 'muniam'];
const NOME_CONTA = { exitus: 'Exitus', lumia: 'Lumia', muniam: 'Muniam' };
const LOJAS = ['Mercado Livre', 'Shein', 'Shopee', 'TikTok', 'Magalu'];

export default function TelaEtiquetas({ API, corteHora = '12:30', onErro }) {
  const [fConta, setFConta] = useState('todas');
  const [fLoja, setFLoja] = useState('todas');
  const [fJanela, setFJanela] = useState('todos');   // todos | ate_corte
  const [fTipo, setFTipo] = useState('nf_transporte'); // nf_transporte | flex | meluni
  const [fRef, setFRef] = useState('');
  const [porEmpresa, setPorEmpresa] = useState(false);    // Exitus inteira → Lumia → Muniam
  const [reimprimir, setReimprimir] = useState(false);   // trava: só com escolha consciente
  const [verFinalizados, setVerFinalizados] = useState(false);
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(false);

  const qs = useCallback((extra = {}) => {
    const q = new URLSearchParams({ contas: fConta, loja: fLoja, tipo: fTipo, ...extra });
    if (fJanela === 'ate_corte') q.set('corte', corteHora);
    if (fRef.trim()) q.set('ref', fRef.trim());
    if (porEmpresa) q.set('por_empresa', '1');
    if (reimprimir) q.set('reimprimir', '1');
    if (verFinalizados) q.set('incluir_finalizados', '1');
    return q.toString();
  }, [fConta, fLoja, fTipo, fJanela, fRef, corteHora, reimprimir, verFinalizados, porEmpresa]);

  const [imprimindo, setImprimindo] = useState('');
  // PREPARO AUTOMÁTICO (17/08 — redesenho): ao abrir a tela o app já busca e
  // guarda as etiquetas em segundo plano, em fatias. O clique de imprimir só
  // consome o que está pronto. A Shein fica de fora (baixar a etiqueta dela
  // muda o status no marketplace) e é buscada no clique final.
  const [preparo, setPreparo] = useState(null);   // {rodando, prontos, faltam, msg}
  const [contadores, setContadores] = useState(null);   // badge por tipo de impressão
  const [impressoras, setImpressoras] = useState([]);
  const [impressoraSel, setImpressoraSel] = useState(
    (typeof localStorage !== 'undefined' && localStorage.getItem('wms_impressora')) || '');

  const prepararLote = useCallback(async (auto = false) => {
    // 18/08 (ele perguntou): não repetir o preparo a cada abertura. O que já
    // está guardado nunca é rebuscado, mas a varredura toda vez passava a
    // impressão de retrabalho. Agora o automático só roda se fizer mais de
    // 10 min desde o último — o botão "Preparar agora" ignora essa trava.
    const ultimo = Number(localStorage.getItem('wms_preparo_em') || 0);
    if (auto && Date.now() - ultimo < 10 * 60 * 1000) {
      const min = Math.max(1, Math.round((Date.now() - ultimo) / 60000));
      setPreparo({ rodando: false, msg: `etiquetas preparadas há ${min} min` });
      setTimeout(() => setPreparo(null), 6000);
      return;
    }
    setPreparo({ rodando: true, msg: auto ? 'conferindo se falta preparar alguma etiqueta…' : 'buscando as notas novas no Bling…' });
    // 18/08: nota gerada à mão no Bling não aparecia até o cron de 10 min
    // rodar. Agora o preparo puxa a cadeia inteira: situação das notas →
    // classificação → busca das etiquetas.
    try {
      await fetch(`${API}/wms-nf-sync?dias=2`);
      await fetch(`${API}/wms-classificar`);
    } catch { /* segue: o preparo ainda tenta o que dá */ }
    setPreparo({ rodando: true, msg: 'preparando etiquetas…' });
    let voltas = 0, prontos = 0;
    try {
      while (voltas < 6) {
        voltas++;
        const r = await fetch(`${API}/wms-preparar-lote?limite=120`);
        const j = await r.json();
        prontos += j.preparados || 0;
        setPreparo({
          rodando: (j.faltam || 0) > 0,
          msg: (j.faltam || 0) > 0
            ? `preparando… ${prontos} prontas, faltam ${j.faltam}`
            : (prontos > 0
              ? `${prontos} etiqueta(s) preparadas`
              : `nada novo pra preparar — ${j.ja_tinham || 0} já estavam prontas`),
        });
        if (!j.faltam) break;
      }
    } catch (e) {
      setPreparo({ rodando: false, msg: 'não consegui preparar agora — dá pra imprimir mesmo assim' });
    }
    localStorage.setItem('wms_preparo_em', String(Date.now()));
    carregar();
    setTimeout(() => setPreparo(p => (p && !p.rodando ? null : p)), 12000);
  }, []);

  // QZ Tray (já instalado na máquina da expedição): carrega a lib sob demanda
  // abrir o PDF: window.open depois de um await costuma ser BLOQUEADO pelo
  // navegador (perde o "gesto do usuário"). Um link clicado por código passa.
  const abrirPdf = (url) => {
    try {
      const a = document.createElement('a');
      a.href = url; a.target = '_blank'; a.rel = 'noopener';
      document.body.appendChild(a); a.click(); a.remove();
    } catch { window.location.href = url; }
  };

  // 18/08: a lib do QZ agora vem NO BUNDLE (import) — antes carregava de CDN
  // no clique e, se o CDN falhasse na máquina, caía pro PDF sem explicar.
  // 19/08: conexão ASSINADA com o certificado do Grupo Amícia — sem isso o QZ
  // trata como "anonymous request" e o Allow não fica salvo entre reinícios.
  const carregarQz = async () => {
    if (!qzTray.__amiciaAssinado) {
      qzTray.security.setCertificatePromise((resolve, reject) => {
        // 19/08: cert EMBUTIDO — o fetch podia cair no service worker e voltar
        // o HTML do app (identidade inválida => QZ pedia permissão a cada folha)
        resolve(QZ_CERT);
      });
      qzTray.security.setSignatureAlgorithm('SHA512');
      qzTray.security.setSignaturePromise((toSign) => (resolve, reject) => {
        fetch('/api/qz-sign', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ toSign }),
        }).then(r => r.json())
          .then(j => j.ok ? resolve(j.assinatura) : reject(j.erro || 'assinatura falhou'))
          .catch(reject);
      });
      qzTray.__amiciaAssinado = true;
    }
    return qzTray;
  };

  // Conecta no QZ Tray com paciência: a lib às vezes precisa de 2 tentativas
  // (o app local demora a subir o websocket). Se não conectar, quem chama cai
  // pro PDF — o botão nunca deixa a equipe na mão.
  // 18/08: pedir só a impressora PADRÃO do Windows falhava quando a padrão
  // era outra (ou não havia padrão) — a térmica estava instalada e mesmo
  // assim dava "não encontra a impressora". Agora: usa a lembrada, senão
  // detecta a térmica pelo nome, senão a padrão, senão a primeira da lista.
  const TERMICA = /zebra|zdesigner|zd\d|tsc|argox|elgin|gprinter|godex|bematech|thermal|etiq|label/i;

  const escolherImpressora = async (qz) => {
    let lista = [];
    try { lista = await qz.printers.find(); } catch { /* segue */ }
    if (!Array.isArray(lista)) lista = lista ? [lista] : [];
    setImpressoras(lista);

    const salva = localStorage.getItem('wms_impressora');
    if (salva && lista.includes(salva)) return salva;

    const termica = lista.find(x => TERMICA.test(x));
    if (termica) { localStorage.setItem('wms_impressora', termica); return termica; }

    try {
      const padrao = await qz.printers.getDefault();
      if (padrao) return padrao;
    } catch { /* sem padrão definida */ }
    return lista[0] || null;
  };

  const conectarQz = async () => {
    let qz;
    try { qz = await carregarQz(); } catch (e) { return { qz: null, motivo: e.message }; }
    if (qz.websocket.isActive()) return { qz, motivo: null };
    try {
      // 18/08: paciência maior — o aviso de permissão do QZ (Allow) precisa de
      // tempo pra pessoa clicar; antes desistia em 2s e caía pro PDF
      await qz.websocket.connect({ retries: 3, delay: 2 });
      return { qz, motivo: null };
    } catch (e1) {
      try { await qz.websocket.connect(); return { qz, motivo: null }; }
      catch (e2) {
        let motivo = String(e2?.message || e1?.message || 'conexão recusada');
        // Chrome 147+ (abr/2026): site público não fala mais com localhost sem
        // permissão — e ignorar o aviso 3x vira bloqueio PERMANENTE e mudo.
        if (/unable to establish connection/i.test(motivo)) {
          motivo += ' — provável bloqueio do Chrome: cadeado ao lado do endereço, Configurações do site, permitir "Apps neste dispositivo" (acesso à rede local) e recarregar';
        }
        return { qz: null, motivo };
      }
    }
  };

  // Diagnóstico na máquina da expedição: mostra cada passo da conexão
  const testarQz = async () => {
    setImprimindo('Testando o QZ Tray…');
    // 19/08: confere também o certificado e a assinatura — sem eles o QZ trata
    // o app como "anonymous" e pede permissão a CADA impressão
    let signOk = false;
    const certOk = QZ_CERT.includes('BEGIN CERTIFICATE');
    try {
      const rs = await fetch('/api/qz-sign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ toSign: 'teste' }) });
      signOk = (await rs.json())?.ok === true;
    } catch { /* segue */ }
    const { qz, motivo } = await conectarQz();
    if (!qz) { setImprimindo(`⚠ QZ não conectou: ${motivo}. Confira se o QZ Tray está aberto e se o site não está em Blocked no Site Manager.`); return; }
    let versao = '?';
    try { versao = await qz.api.getVersion(); } catch { /* segue */ }
    let lista = [];
    try { lista = await qz.printers.find(); } catch { /* segue */ }
    if (!Array.isArray(lista)) lista = lista ? [lista] : [];
    const id = certOk && signOk ? 'identidade Grupo Amícia OK' : `⚠ identidade com problema (cert ${certOk ? 'ok' : 'FALHOU'}, assinatura ${signOk ? 'ok' : 'FALHOU'}) — o QZ vai pedir permissão a cada impressão`;
    setImprimindo(lista.length
      ? `✅ QZ ${versao} conectado · ${id} · Impressoras: ${lista.join(' · ')}`
      : `⚠ QZ ${versao} conectado (${id}), mas nenhuma impressora apareceu. Confira em Dispositivos e Impressoras do Windows.`);
  };

  const imprimirTermica = async () => {
    // a etiqueta muda o status no marketplace — confirma antes (13/08)
    if (!window.confirm(`Imprimir ${vaiSair} etiqueta(s)?\n\nAo confirmar, elas são puxadas do Bling e os pedidos passam a constar como "aguardando coleta" nos marketplaces.`)) return;
    let jobId = null;
    try {
      setImprimindo('Preparando as etiquetas…');

      setImprimindo('Conectando na impressora…');
      const { qz, motivo } = await conectarQz();
      if (!qz) {
        // sem QZ (não instalado, fechado ou bloqueado) → PDF, sem travar —
        // mas agora DIZENDO o porquê, pra parar de adivinhar na expedição
        setImprimindo(`QZ Tray não conectou (${motivo}) — gerando o PDF… Imprima em escala 100%; se o código de barras sair com defeito, abra o PDF no Firefox.`);
        abrirPdf(`${API}/wms-etiquetas?${qs({ pdf: '1' })}`);
        setTimeout(() => { setImprimindo(''); carregar(); }, 9000);
        return;
      }
      const impressora = await escolherImpressora(qz);
      if (!impressora) throw new Error('Nenhuma impressora encontrada pelo QZ Tray. Confira se ela aparece em Dispositivos e Impressoras do Windows.');
      const config = qz.configs.create(impressora);
      const cfgPdf = qz.configs.create(impressora, {
        size: { width: 4, height: 6 }, units: 'in', scaleContent: true,
        rasterize: true, density: 203, interpolation: 'nearest-neighbor', margins: 0,
      });

      // 19/08: RODADAS. Com os pares, um lote grande estourava o tempo e o
      // teto de resposta do Vercel — agora o servidor manda ~15 pares por vez
      // e a gente repete até a fila zerar. Cada rodada já marca as suas, então
      // se cair no meio o que saiu não sai de novo.
      // 20/08: cada clique vira um PRINT JOB — pacote com número e histórico
      // (rodadas, falhas, fechamento) pra auditar o que saiu e o que travou.
      try {
        const rJ = await fetch(`${API}/wms-etiquetas?${qs({ job_criar: '1' })}`);
        jobId = (await rJ.json())?.job_id || null;
      } catch { /* job é auditoria, não trava a impressão */ }
      let totalGeral = 0; let semDanfeTotal = []; let rodadas = 0;
      while (rodadas < 40) {
        rodadas++;
        const rL = await fetch(`${API}/wms-etiquetas?${qs(jobId ? { zpl: '1', job: String(jobId) } : { zpl: '1' })}`);
        const bruto = await rL.text();
        let jL;
        try { jL = JSON.parse(bruto); }
        catch { throw new Error(`Servidor respondeu fora do padrão (${bruto.slice(0, 60)}). Tenta de novo em 1 min.`); }
        if (!rL.ok) throw new Error(jL.erro || `HTTP ${rL.status}`);
        if (jL.so_pdf) {   // NF agendada: é nota, sai em PDF
          setImprimindo('Abrindo as notas em PDF…');
          abrirPdf(`${API}/wms-etiquetas?${qs({ pdf: '1' })}`);
          setTimeout(() => { setImprimindo(''); carregar(); }, 6000);
          return;
        }
        if (!jL.total && !totalGeral) throw new Error('Nenhuma etiqueta pronta nesses filtros.');
        if (!jL.total) break;

        // pares na ordem do servidor: ZPL raw, PDF pixel 203dpi; trechos
        // consecutivos do mesmo formato viajam juntos
        const trechos = [];
        for (const b of jL.blocos) {
          const modo = b.pdf ? 'pixel' : (b.zpl ? 'raw' : null);
          if (!modo) continue;
          const ult = trechos[trechos.length - 1];
          if (ult && ult.modo === modo) ult.itens.push(b);
          else trechos.push({ modo, itens: [b] });
        }
        for (const t of trechos) {
          if (t.modo === 'raw') {
            await qz.print(config, t.itens.map(b => ({ type: 'raw', format: 'plain', data: b.zpl })));
          } else {
            await qz.print(cfgPdf, t.itens.map(b => ({ type: 'pixel', format: 'pdf', flavor: 'base64', data: b.pdf })));
          }
        }
        // só marca como impressa depois que a térmica aceitou o trabalho
        for (let i = 0; i < jL.ids.length; i += 30) {
          await fetch(`${API}/wms-etiquetas?marcar=1&ids=${jL.ids.slice(i, i + 30).join(',')}`);
        }
        totalGeral += jL.total;
        semDanfeTotal = semDanfeTotal.concat(jL.sem_danfe || []);
        if (!jL.restantes) break;
        setImprimindo(`Imprimindo em ${impressora}… ${totalGeral} enviadas, faltam ${jL.restantes}`);
      }

      if (jobId) fetch(`${API}/wms-etiquetas?job_fechar=${jobId}&total=${totalGeral}&sem_danfe=${semDanfeTotal.length}`).catch(() => {});
      const rotJob = jobId ? ` · pacote #${jobId}` : '';
      if (semDanfeTotal.length) {
        setImprimindo(`✅ ${totalGeral} enviadas${rotJob}. ⚠ Sem DANFE: ${semDanfeTotal.join(', ')} (etiqueta saiu, nota não)`);
      } else {
        setImprimindo(`✅ ${totalGeral} etiqueta(s) enviadas para ${impressora}${rotJob}`);
      }
      carregar();
      setTimeout(() => setImprimindo(''), 10000);
    } catch (e) {
      if (jobId) fetch(`${API}/wms-etiquetas?job_fechar=${jobId}&falha=${encodeURIComponent(String(e?.message || '').slice(0, 200))}`).catch(() => {});
      const problemaQz = /qz|websocket|connection/i.test(String(e?.message || ''));
      if (problemaQz) {
        setImprimindo(`QZ Tray falhou no meio (${String(e?.message || '').slice(0, 90)}) — gerando o PDF… Imprima em escala 100%; se o código de barras sair com defeito, abra o PDF no Firefox.`);
        abrirPdf(`${API}/wms-etiquetas?${qs({ pdf: '1' })}`);
        setTimeout(() => { setImprimindo(''); carregar(); }, 9000);
        return;
      }
      setImprimindo(`⚠ ${e.message}`);
      onErro?.(e.message);
      setTimeout(() => setImprimindo(''), 12000);
    }
  };

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const r = await fetch(`${API}/wms-etiquetas?${qs({ previa: '1' })}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.erro || `HTTP ${r.status}`);
      setDados(j);
    } catch (e) { onErro?.(e.message); setDados(null); }
    finally { setCarregando(false); }
  }, [API, qs, onErro]);

  useEffect(() => { carregar(); }, [carregar]);
  // contadores de cada botão de IMPRIMIR (leitura leve, só do banco)
  useEffect(() => {
    const buscar = () => fetch(`${API}/wms-etiquetas?contadores=1&contas=${fConta}`)
      .then(r => r.json()).then(j => { if (j?.ok) setContadores(j.contadores); }).catch(() => {});
    buscar();
    const t = setInterval(buscar, 60000);
    return () => clearInterval(t);
  }, [fConta, dados]);
  useEffect(() => { prepararLote(true); /* só na abertura */ }, []);   // eslint-disable-line
  // descobre as impressoras assim que a tela abre, pra equipe já ver qual será usada
  useEffect(() => {
    (async () => {
      try {
        const qz = await conectarQz();
        if (!qz) return;
        const escolhida = await escolherImpressora(qz);
        if (escolhida) setImpressoraSel(escolhida);
      } catch { /* sem QZ nesta máquina: o botão cai no PDF */ }
    })();
  }, []);   // eslint-disable-line



  // bolinha com o número de etiquetas esperando impressão naquele tipo
  const Badge = ({ n }) => (n ? (
    <span style={{ marginLeft: 6, background: palette.accent, color: '#fff', borderRadius: 999,
      padding: '1px 7px', fontSize: 11, fontWeight: 800, verticalAlign: 1 }}>{n}</span>
  ) : null);
  const btn = (ativo) => ({
    padding: '9px 14px', borderRadius: 10, cursor: 'pointer', fontFamily: FONT, fontSize: 13.5,
    fontWeight: ativo ? 800 : 600,
    border: ativo ? `1.5px solid ${palette.accent}` : `1px solid ${palette.beige}`,
    background: ativo ? palette.accentSoft : '#fff',
    color: ativo ? palette.ink : palette.inkSoft,
  });
  const rotulo = { fontSize: 11, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', color: palette.inkMuted, minWidth: 92 };

  const grupos = dados?.grupos || [];
  const totalPedidos = dados?.total_pedidos || 0;
  const prontas = dados?.prontas || 0;
  const aguardando = dados?.aguardando || 0;
  const jaImpressas = dados?.ja_impressas || 0;
  const vaiSair = reimprimir ? prontas + jaImpressas : prontas;

  return (
    <div style={{ padding: 16, maxWidth: 860, margin: '0 auto' }}>
      {/* filtros — mesma gramática da lista de separação */}
      <div style={{ background: '#fff', border: `1px solid ${palette.beige}`, borderRadius: 13, padding: 13, marginBottom: 14, display: 'grid', gap: 10 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <span style={rotulo}>Empresa</span>
          {['todas', ...CONTAS].map(c => (
            <button key={c} onClick={() => setFConta(c)} style={btn(fConta === c)}>{c === 'todas' ? 'Todas' : NOME_CONTA[c]}</button>
          ))}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <span style={rotulo}>Loja</span>
          <button onClick={() => setFLoja('todas')} style={btn(fLoja === 'todas')}>Todas</button>
          {LOJAS.map(l => (
            <button key={l} onClick={() => setFLoja(l)} style={btn(fLoja === l)}>{l}</button>
          ))}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <span style={rotulo}>Período</span>
          <button onClick={() => setFJanela('todos')} style={btn(fJanela === 'todos')}>Todos</button>
          <button onClick={() => setFJanela('ate_corte')} style={btn(fJanela === 'ate_corte')}>Até o corte ({corteHora})</button>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <span style={rotulo}>Imprimir</span>
          <button onClick={() => setFTipo('nf_transporte')} style={btn(fTipo === 'nf_transporte')}>NF + transporte<Badge n={contadores?.nf_transporte} /></button>
          <button onClick={() => setFTipo('flex')} style={btn(fTipo === 'flex')}>⚡ Flex<Badge n={contadores?.flex} /></button>
          <button onClick={() => setFTipo('meluni')} style={btn(fTipo === 'meluni')}>Meluni<Badge n={contadores?.meluni} /></button>
          <button onClick={() => setFTipo('nf_agendada')} style={btn(fTipo === 'nf_agendada')}
            title="Pedidos do Mercado Livre com envio programado: imprime só a NF, com a data de envio escrita em cima. A etiqueta sai no dia.">
            📅 NF agendadas<Badge n={contadores?.nf_agendada} />
          </button>
          <button onClick={() => setFTipo('etiqueta_liberada')} style={btn(fTipo === 'etiqueta_liberada')}
            title="Só as etiquetas logísticas que o Mercado Livre liberou pra postar hoje (a NF já foi impressa antes).">
            🏷 Etiquetas liberadas<Badge n={contadores?.etiqueta_liberada} />
          </button>
          <input value={fRef} onChange={e => setFRef(e.target.value)} placeholder="REF específica"
            style={{ padding: '9px 12px', borderRadius: 10, border: `1px solid ${palette.beige}`, fontFamily: FONT, fontSize: 13.5, width: 130, color: palette.ink }} />
        </div>
      </div>

      {/* impressora usada nesta máquina (fica lembrada) */}
      {impressoras.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, fontSize: 12, color: palette.inkSoft, fontFamily: FONT, flexWrap: 'wrap' }}>
          <span>🖨 Impressora:</span>
          <select value={impressoraSel || ''} onChange={e => { setImpressoraSel(e.target.value); localStorage.setItem('wms_impressora', e.target.value); }}
            style={{ padding: '6px 9px', borderRadius: 8, border: `1px solid ${palette.beige}`, fontFamily: FONT, fontSize: 12, maxWidth: 320 }}>
            {impressoras.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <span style={{ fontSize: 11, color: palette.inkMuted }}>fica salva nesta máquina</span>
        </div>
      )}

      {/* preparo em segundo plano: a equipe vê o que está acontecendo */}
      {preparo && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 10, padding: '9px 12px',
          borderRadius: 10, background: preparo.rodando ? '#fdf6e3' : palette.okSoft || '#e9f5ee',
          border: `1px solid ${preparo.rodando ? '#e8d9a8' : '#cfe6d8'}`, fontSize: 12.5, color: palette.inkSoft, fontFamily: FONT }}>
          <span>{preparo.rodando ? '⏳' : '✅'}</span>
          <span style={{ flex: 1 }}>{preparo.msg}</span>
        </div>
      )}

      {/* ação — UM botão só (15/08 → 17/08, ordem dele): tenta a térmica e,
          se o QZ Tray não estiver disponível, cai sozinho pro PDF */}
      <div style={{ display: 'flex', gap: 9, marginBottom: 14, flexWrap: 'wrap' }}>
        <button onClick={imprimirTermica} disabled={!vaiSair || !!imprimindo}
          style={{ flex: 1, minWidth: 240, padding: '14px', borderRadius: 12, border: 'none',
            background: (vaiSair && !imprimindo) ? palette.ink : '#c8c0b6', color: '#fff', fontSize: 15, fontWeight: 800,
            cursor: (vaiSair && !imprimindo) ? 'pointer' : 'default', fontFamily: FONT, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <Printer size={18} /> {imprimindo || `Imprimir etiquetas (${vaiSair})`}
        </button>
        <button onClick={() => prepararLote(false)} disabled={preparo?.rodando}
          title="Busca agora as etiquetas que ainda não foram preparadas (a Shein só é buscada no clique de imprimir)"
          style={{ padding: '14px 16px', borderRadius: 12, border: `1.5px solid ${palette.beige}`, background: '#fff', color: palette.inkSoft, cursor: preparo?.rodando ? 'default' : 'pointer', fontFamily: FONT, display: 'flex', alignItems: 'center', gap: 7, fontWeight: 700, opacity: preparo?.rodando ? .6 : 1 }}>
          <RefreshCw size={16} /> Preparar agora
        </button>
        <button onClick={() => abrirPdf(`${API}/wms-etiquetas?${qs({ previa_pdf: '1' })}`)}
          title="PDF de conferência com a sequência que vai sair (DANFE + etiquetas). Não puxa nada do marketplace: a Shein aparece como página 'Shein logística' e só é buscada na impressão de verdade."
          style={{ padding: '14px 16px', borderRadius: 12, border: `1.5px solid ${palette.beige}`, background: '#fff', color: palette.inkSoft, cursor: 'pointer', fontFamily: FONT, display: 'flex', alignItems: 'center', gap: 7, fontWeight: 700 }}>
          👁 Prévia
        </button>
        <button onClick={testarQz}
          title="Confere a conexão com o QZ Tray e lista as impressoras que ele enxerga"
          style={{ padding: '14px 16px', borderRadius: 12, border: `1.5px solid ${palette.beige}`, background: '#fff', color: palette.inkSoft, cursor: 'pointer', fontFamily: FONT, display: 'flex', alignItems: 'center', gap: 7, fontWeight: 700 }}>
          <Printer size={16} /> Testar QZ
        </button>
      </div>

      {/* grupos na ordem de impressão */}
      <div style={{ background: '#fff', border: `1px solid ${palette.beige}`, borderRadius: 13, padding: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: palette.ink, marginBottom: 3 }}>Ordem de impressão</div>
        <div style={{ fontSize: 12, color: palette.inkMuted, marginBottom: 10 }}>
          Por localização e, dentro dela, as referências de maior quantidade primeiro — cada grupo sai com uma folha separadora antes das etiquetas (NF + transporte).
        </div>
        {fTipo === 'nf_agendada' && (
          <div style={{ fontSize: 12, color: palette.inkSoft, background: '#fdf6e3', border: '1px solid #e8d9a8', borderRadius: 8, padding: '8px 11px', marginBottom: 10 }}>
            Envio programado do Mercado Livre: sai <b>só a nota</b>, com a data de envio no cabeçalho dela (mesma quantidade de folhas de sempre). Separe a mercadoria e guarde — no dia, use “Etiquetas liberadas”. A NF continua valendo.
          </div>
        )}
        {fTipo === 'etiqueta_liberada' && (
          <div style={{ fontSize: 12, color: palette.inkSoft, background: '#eef5fb', border: '1px solid #cfe0ee', borderRadius: 8, padding: '8px 11px', marginBottom: 10 }}>
            Só as etiquetas que o Mercado Livre liberou pra postagem — inclusive de pedidos guardados dias atrás. A nota desses já foi impressa antes.
          </div>
        )}
        {!!totalPedidos && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: palette.ok, background: palette.okSoft, padding: '6px 11px', borderRadius: 999 }}>
              {prontas} pronta{prontas === 1 ? '' : 's'} pra imprimir
            </span>
            {jaImpressas > 0 && (
              <span style={{ fontSize: 12, fontWeight: 700, color: palette.inkSoft, background: palette.beigeSoft, padding: '6px 11px', borderRadius: 999 }}>
                {jaImpressas} já impressa{jaImpressas === 1 ? '' : 's'}
              </span>
            )}
            {aguardando > 0 && (
              <span style={{ fontSize: 12, fontWeight: 700, color: palette.warn, background: palette.warnSoft, padding: '6px 11px', borderRadius: 999 }}>
                {aguardando} aguardando gerar NF no Bling
              </span>
            )}
          </div>
        )}
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 12 }}>
          <label style={{ fontSize: 12, color: palette.inkSoft, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontFamily: FONT }}>
            <input type="checkbox" checked={porEmpresa} onChange={e => setPorEmpresa(e.target.checked)} />
            Separar por empresa (Exitus → Lumia → Muniam)
          </label>
          <label style={{ fontSize: 12, color: palette.inkSoft, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontFamily: FONT }}>
            <input type="checkbox" checked={reimprimir} onChange={e => setReimprimir(e.target.checked)} />
            Incluir as impressas hoje (reimprimir)
          </label>
          <label style={{ fontSize: 12, color: palette.inkSoft, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontFamily: FONT }}>
            <input type="checkbox" checked={verFinalizados} onChange={e => setVerFinalizados(e.target.checked)} />
            Mostrar pedidos já finalizados
          </label>
        </div>

        {carregando && <div style={{ color: palette.inkMuted, fontSize: 13, padding: 10 }}>Carregando…</div>}
        {!carregando && !grupos.length && (
          <div style={{ color: palette.inkMuted, fontSize: 13, padding: 10 }}>Nenhum pedido nesses filtros.</div>
        )}

        {grupos.map((g, i) => (
          <div key={`${g.ref}-${g.loc}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 4px', borderBottom: i < grupos.length - 1 ? `1px solid ${palette.beigeSoft}` : 'none' }}>
            <div style={{ width: 26, height: 26, borderRadius: 8, background: palette.accentSoft, color: palette.accent, fontSize: 12, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONT }}>{i + 1}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14.5, fontWeight: 800, color: palette.ink }}>
                📍 {g.loc} <span style={{ fontWeight: 600, color: palette.inkSoft, fontSize: 13 }}>· REF {g.ref}</span>
                {g.empresa && <span style={{ fontWeight: 700, color: palette.accent, fontSize: 12 }}> · {NOME_CONTA[g.empresa] || g.empresa}</span>}
              </div>
              <div style={{ fontSize: 11.5, color: palette.inkMuted }}>{(g.canais || []).join(', ')}{g.contas?.length ? ` · ${g.contas.map(c => NOME_CONTA[c] || c).join(', ')}` : ''}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: g.prontas ? palette.ok : palette.inkMuted }}>{g.prontas || 0}/{g.pedidos}</div>
              <div style={{ fontSize: 10.5, color: palette.inkMuted }}>
                {g.impressas ? `${g.impressas} impressa${g.impressas === 1 ? '' : 's'}` : 'prontas'}
              </div>
            </div>
          </div>
        ))}

        {dados?.nota && <div style={{ fontSize: 11.5, color: palette.inkMuted, marginTop: 12 }}>{dados.nota}</div>}
      </div>

      <div style={{ fontSize: 11.5, color: palette.inkMuted, marginTop: 12, lineHeight: 1.6 }}>
        O botão tenta a impressora térmica (QZ Tray) e, se ela não estiver disponível nessa máquina, abre o PDF sozinho — a impressão nunca trava. A etiqueta só é puxada do Bling no momento em que você manda imprimir — antes disso o pedido continua pendente no marketplace (na Shein, baixar a etiqueta já muda o status pra "aguardando coleta"). Formato 10x15. Na térmica o ZPL vai direto pela QZ Tray (mais rápido e mais nítido, é o formato nativo que o Bling entrega); o PDF fica como alternativa pra impressora comum. O PDF sai limpo, só com separadores e etiquetas — nenhum aviso no papel. Cada etiqueta gerada fica registrada como impressa e não sai de novo sem você marcar "reimprimir". A etiqueta só existe depois de gerada no Bling (nasce junto com a NF); quem ainda não tem fica como "aguardando" aqui na tela e entra na próxima geração.
      </div>
    </div>
  );
}
