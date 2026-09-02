/**
 * wms-tv.js — MODO TV do Picking WMS (Ailson 13/08/2026)
 *
 * Painel pra Smart TV da expedição. Devolve uma página HTML COMPLETA e
 * autossuficiente (sem app, sem login, sem service worker) porque navegador
 * de Smart TV é fraco: só HTML + CSS + um fetch a cada 60s.
 *
 * Abrir na TV:  /api/wms-tv?token=<TOKEN>
 * Opcional: &tema=claro (padrão é escuro, melhor pra tela grande de longe)
 *
 * Números vindos do MESMO dashboard do módulo (acao=dashboard) + andamento.
 */
export const config = { maxDuration: 30 };

const TOKEN = process.env.WMS_TV_TOKEN || 'amicia';

export default async function handler(req, res) {
  if (String(req.query?.token || '') !== TOKEN) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(401).send('<h1 style="font-family:sans-serif;padding:40px">Token inválido</h1>');
  }
  const claro = req.query?.tema === 'claro';

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Expedição · Amícia</title>
<style>
  @keyframes pisca { 0%,100%{background:rgba(0,0,0,.35)} 50%{background:rgba(192,57,43,.75)} }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Segoe UI', Calibri, sans-serif;
    background: ${claro ? '#f6f1e8' : '#141a22'};
    color: ${claro ? '#2c3e50' : '#eef3f8'};
    padding: 2vh 2vw; height: 100vh; overflow: hidden;
  }
  header { display: flex; align-items: baseline; gap: 2vw; margin-bottom: 1.6vh; }
  h1 { font-size: 3.4vh; font-weight: 800; letter-spacing: .5px; }
  .relogio { font-size: 3.4vh; font-weight: 800; margin-left: auto; }
  .sync { font-size: 1.7vh; opacity: .55; }
  .grade { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1.4vw; margin-bottom: 1.6vh; }
  .card {
    background: ${claro ? '#fff' : '#1e2733'};
    border: 1px solid ${claro ? '#e8dfd0' : '#2b3746'};
    border-radius: 1.6vh; padding: 2vh 1.6vw;
  }
  .rotulo { font-size: 1.9vh; text-transform: uppercase; letter-spacing: 1.2px; opacity: .6; font-weight: 700; }
  .numero { font-size: 11vh; font-weight: 800; line-height: 1; margin: .4vh 0; }
  .sub { font-size: 2vh; opacity: .65; }
  .azul { color: #6db1e8; } .verde { color: #4ed08a; } .ambar { color: #f0c064; } .vermelho { color: #ff6b6b; }
  .faixa {
    display: grid; grid-template-columns: 1fr 1fr; gap: 1.4vw;
  }
  .painel {
    background: ${claro ? '#fff' : '#1e2733'};
    border: 1px solid ${claro ? '#e8dfd0' : '#2b3746'};
    border-radius: 1.6vh; padding: 2vh 1.6vw;
  }
  .linha { display: flex; align-items: center; gap: 1vw; font-size: 2.6vh; padding: .9vh 0; }
  .linha b { font-size: 3.4vh; }
  .alerta {
    border-radius: 1.6vh; padding: 2.2vh 2vw; font-size: 3.4vh; font-weight: 800;
    display: flex; align-items: center; gap: 1.4vw; animation: pulsa 2.4s infinite;
  }
  .alerta.vermelho { background: #7a1f1f; color: #ffe2e2; }
  .alerta.ambar { background: #7a5c1a; color: #fff4d6; }
  .alerta.verde { background: #17492f; color: #d6ffe8; }
  @keyframes pulsa { 0%,100% { opacity: 1 } 50% { opacity: .82 } }
  .barra { height: 2.4vh; border-radius: 99px; background: ${claro ? '#e8dfd0' : '#2b3746'}; overflow: hidden; margin-top: 1vh; }
  .barra > div { height: 100%; background: #4ed08a; transition: width .6s; }
  /* calendario do mes (28/08) — entrou no lugar do painel "Por empresa" */
  .cal { display: grid; grid-template-columns: repeat(7, 1fr); gap: .35vw; }
  .cal .dow { font-size: 1.3vh; opacity: .5; text-align: center; padding-bottom: .4vh; }
  .cal .dia { border-radius: .7vh; padding: .5vh .2vw; text-align: center; background: ${claro ? '#f3ece1' : '#212b36'}; }
  .cal .dia.vazio { background: transparent; }
  .cal .dia .d { font-size: 1.2vh; opacity: .5 }
  .cal .dia .t { font-size: 2vh; font-weight: 800 }
  .cal .dia.hoje { outline: .3vh solid #4ed08a; }
</style>
</head>
<body>
  <header>
    <h1>📦 EXPEDIÇÃO</h1>
    <span class="sync" id="sync">carregando…</span>
    <span class="relogio" id="relogio">--:--</span>
  </header>

  <div class="grade" style="grid-template-columns:repeat(2,1fr)">
    <div class="card"><div class="rotulo">Pedidos abertos</div><div class="numero azul" id="abertos">–</div><div class="sub" id="pecas">&nbsp;</div></div>
    <div class="card"><div class="rotulo">Prontos hoje</div><div class="numero verde" id="fin">–</div><div class="sub" id="ritmo">&nbsp;</div></div>
  </div>

  <div id="alertas" style="display:grid;gap:1.2vh;margin-bottom:1.6vh"></div>

  <div class="faixa" style="margin-bottom:1.2vh">
    <div class="painel">
      <div class="rotulo" id="calrot" style="margin-bottom:1vh">Finalizados no mês</div>
      <div id="calendario"></div>
    </div>
    <div class="painel">
      <div id="pendencias"></div>
    </div>
  </div>

  <!-- 02/09 (pedido dele): ALERTA SONORO — overlay em tela cheia + campainha
       pelo som da TV. O Chrome so toca audio depois de UM clique na pagina:
       o botao 🔔 libera o som pra sessao inteira (fica verde). -->
  <div id="alerta" style="display:none;position:fixed;inset:0;z-index:99;background:rgba(160,40,20,.93);align-items:center;justify-content:center;flex-direction:column;color:#fff;text-align:center">
    <div style="font-size:14vh;line-height:1">🔔</div>
    <div id="alertaNome" style="font-size:9vh;font-weight:900;letter-spacing:.02em;margin-top:2vh;padding:0 4vw"></div>
    <div id="alertaHora" style="font-size:4vh;opacity:.85;margin-top:1.5vh"></div>
  </div>
  <button id="somBtn" title="Liberar o som da TV pros alertas" style="position:fixed;top:1.2vh;right:1.2vw;z-index:50;border:1px solid rgba(255,255,255,.4);background:rgba(0,0,0,.35);color:#fff;border-radius:999px;padding:.6vh 1.2vw;font-size:1.8vh;cursor:pointer;font-family:inherit">🔕 som desligado — clique pra liberar</button>

  <div id="lembrete" style="display:none;margin-bottom:1.2vh;padding:1.6vh 1.6vw;border:1px solid rgba(255,255,255,.3);border-radius:14px;color:#fff;font-size:3vh;font-weight:700;line-height:1.35"></div>

  <div style="display:flex;justify-content:flex-end">
    <div class="card" style="padding:1.2vh 1.4vw;display:flex;align-items:baseline;gap:1vw">
      <span class="rotulo" style="font-size:1.6vh">Falta pro corte</span>
      <span id="corte" style="font-size:3.4vh;font-weight:800">–</span>
      <span class="sub" id="corteh" style="font-size:1.6vh"></span>
    </div>
  </div>

<script>
  var API = '/api/wms-listas';
  function n(v){ return Number(v)||0; }
  function fmtHora(d){ return d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',timeZone:'America/Sao_Paulo'}); }

  function tick(){ document.getElementById('relogio').textContent = fmtHora(new Date()); }
  setInterval(tick, 1000); tick();

  function alerta(classe, texto){
    var d = document.createElement('div');
    d.className = 'alerta ' + classe;
    d.innerHTML = texto;
    document.getElementById('alertas').appendChild(d);
  }

  function pintar(d){
    var t = d.total || {};
    document.getElementById('abertos').textContent = n(t.abertos);
    // 01/09 (pedido dele): subtitulo abre a composicao do numero grande —
    // Flex (painel ML) e sem NF (fluxo manual do dia) — pra TV e as
    // auditorias falarem a mesma lingua.
    var subAb = [];
    if (n(t.pra_amanha)) subAb.push(n(t.pra_amanha) + ' pra amanhã');
    if (n(t.abertos_flex)) subAb.push('⚡ ' + n(t.abertos_flex) + ' Flex');
    if (n(t.abertos_sem_nf)) subAb.push('📄 ' + n(t.abertos_sem_nf) + ' sem NF');
    document.getElementById('pecas').textContent = subAb.length ? subAb.join(' · ') : '\u00a0';
    var prev = n(t.em_separacao_com_nf_prevista), comNf = n(t.em_separacao_nf);
    document.getElementById('fin').textContent = n(t.finalizados_hoje);

    // falta pro corte
    var corteEm = d.corte_em ? new Date(d.corte_em) : null;
    var elC = document.getElementById('corte');
    if (corteEm) {
      var min = Math.round((corteEm.getTime() - Date.now())/60000);
      if (min > 0) {
        elC.textContent = min >= 60 ? (Math.floor(min/60) + 'h' + String(min%60).padStart(2,'0')) : (min + 'min');
        elC.className = (min <= 30 ? 'vermelho' : min <= 60 ? 'ambar' : 'verde');
        document.getElementById('corteh').textContent = 'corte às ' + fmtHora(corteEm);
      } else {
        elC.textContent = 'ENCERRADO';
        elC.className = 'vermelho';
        document.getElementById('corteh').textContent = 'corte era ' + fmtHora(corteEm);
      }
    }

    // ritmo do dia
    var agora = new Date(Date.now() - 3*3600000);
    var horas = Math.max(0.5, (agora.getUTCHours() + agora.getUTCMinutes()/60) - 8.67);
    var ritmo = Math.round(n(t.finalizados_hoje) / horas);
    document.getElementById('ritmo').textContent = ritmo ? (ritmo + ' pedidos/hora') : '\\u00a0';

    // (o card "Em separação" e o painel "Por empresa" saíram a pedido dele em
    // 28/08 — no lugar deles entrou o calendário do mês)

    // pendências
    var p = document.getElementById('pendencias'); p.innerHTML = '';
    function linhaP(txt, valor, classe){
      var l = document.createElement('div'); l.className = 'linha';
      l.innerHTML = '<span style="flex:1">' + txt + '</span><b class="' + classe + '">' + valor + '</b>';
      p.appendChild(l);
    }
    // 28/08 (pedido dele): "Aguardando mercadoria" saiu; entrou Pedidos Full,
    // com a MESMA regra do histórico (conta no dia em que o pedido entrou).
    linhaP('📦 Pedidos Full', n((d.vendas_dia || {}).full), 'verde');
    // Flex em ABERTO — corte próprio de 12:30, não o da lista.
    linhaP('⚡ Flex em aberto', n(t.flex_abertos), n(t.flex_abertos) ? 'ambar' : 'verde');
    if (prev) linhaP('📄 NF faltando', Math.max(0, prev - comNf), (prev - comNf) ? 'ambar' : 'verde');
    // envios programados do ML Exitus (a etiqueta só libera no dia)
    linhaP('🗓 Agendados Mercado Livre', n(d.agendados_ml), n(d.agendados_ml) ? 'ambar' : 'verde');
    // 30/08 (pedido dele): liberadas HOJE, mesma regua do chip "Etiquetas
    // liberadas" da tela de impressao — TV e aba mostram o mesmo numero.
    linhaP('🏷 Etiquetas Meli liberadas hoje', n(d.etiquetas_liberadas_hoje), n(d.etiquetas_liberadas_hoje) ? 'ambar' : 'verde');
    linhaP('📅 Entraram após o corte', n(t.pra_amanha), 'azul');

    // alertas grandes
    document.getElementById('alertas').innerHTML = '';
    var restante = n(t.abertos) + n(t.em_separacao);
    if (corteEm) {
      var min2 = Math.round((corteEm.getTime() - Date.now())/60000);
      if (min2 > 0 && min2 <= 45 && restante > 0)
        alerta('vermelho', '⏰ FALTAM ' + min2 + ' MIN PRO CORTE — ainda tem ' + restante + ' pedido(s) na fila');
      else if (min2 <= 0 && restante > 0)
        alerta('ambar', '⏰ CORTE ENCERRADO — ' + restante + ' pedido(s) ainda na fila');
      else if (restante === 0 && n(t.finalizados_hoje) > 0)
        alerta('verde', '✅ FILA ZERADA — ' + n(t.finalizados_hoje) + ' pedidos prontos hoje. Mandou bem, time!');
    }
    if (n(t.aguardando) >= 10)
      alerta('ambar', '⏳ ' + n(t.aguardando) + ' pedidos esperando mercadoria da passadoria');

    // 30/08 (pedido dele): LEMBRETE em letras brancas no final da tela.
    // Aparece a partir da data/hora marcada na Config e some sozinho as
    // 23:59 BRT do dia marcado. textContent = sem risco de HTML no texto.
    try{ cfgAlertas = (d.config && Array.isArray(d.config.alertas)) ? d.config.alertas : []; }catch(e){}
    var lemEl = document.getElementById('lembrete');
    if (lemEl) {
      var cfgL = d.config || {};
      var lemTexto = String(cfgL.lembrete_texto || '').trim();
      var lemMs = cfgL.lembrete_em ? new Date(cfgL.lembrete_em).getTime() : NaN;
      // 30/08 (2a ordem dele): termino OPCIONAL — com ele, o lembrete persiste
      // ate a data/hora marcada (pode ser dias); sem ele, vale ate 23:59 do
      // dia do inicio, como antes.
      var lemFimMs = cfgL.lembrete_fim ? new Date(cfgL.lembrete_fim).getTime() : NaN;
      var mostra = false;
      if (lemTexto && !isNaN(lemMs)) {
        var fimMs;
        if (!isNaN(lemFimMs)) { fimMs = lemFimMs; }
        else {
          var diaBrt = new Date(lemMs - 3*3600000).toISOString().slice(0,10);
          fimMs = new Date(diaBrt + 'T23:59:59-03:00').getTime();
        }
        mostra = Date.now() >= lemMs && Date.now() <= fimMs;
      }
      lemEl.style.display = mostra ? 'block' : 'none';
      lemEl.textContent = mostra ? ('\ud83d\udccc ' + lemTexto) : '';
    }

    var s = d.ultimo_sync ? new Date(d.ultimo_sync) : null;
    document.getElementById('sync').textContent = s ? ('atualizado ' + fmtHora(s)) : '';
  }

  // CALENDÁRIO DO MÊS (28/08, pedido dele): mesma fonte da tela Histórico de
  // finalizados — acao=historico. Muda pouco, então recarrega de 10 em 10 min.
  function desenharCal(dias){
    var el = document.getElementById('calendario'); if (!el) return;
    var agora = new Date(Date.now() - 3*3600000);
    var ano = agora.getUTCFullYear(), mes = agora.getUTCMonth();
    var hojeISO = agora.toISOString().slice(0,10);
    var primeiro = new Date(Date.UTC(ano, mes, 1)).getUTCDay();
    var qtdDias = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
    var html = '<div class="cal">';
    ['D','S','T','Q','Q','S','S'].forEach(function(x){ html += '<div class="dow">' + x + '</div>'; });
    for (var i = 0; i < primeiro; i++) html += '<div class="dia vazio"></div>';
    for (var d = 1; d <= qtdDias; d++) {
      var iso = ano + '-' + String(mes+1).padStart(2,'0') + '-' + String(d).padStart(2,'0');
      var c = (dias || {})[iso] || null;
      var tot = c ? n(c.total) : 0;
      html += '<div class="dia' + (iso === hojeISO ? ' hoje' : '') + '">'
        + '<div class="d">' + d + '</div>'
        + '<div class="t">' + (tot || '·') + '</div>'
        + '</div>';
    }
    html += '</div>';
    el.innerHTML = html;
  }
  function carregarCal(){
    fetch(API + '?acao=historico')
      .then(function(r){ return r.json(); })
      .then(function(d){
        if (d && d.ok) {
          desenharCal(d.dias);
          var rot = document.getElementById('calrot');
          if (rot && d.mes) rot.textContent = 'Finalizados no mês — ' + d.mes.slice(5,7) + '/' + d.mes.slice(0,4);
        }
      })
      .catch(function(){ /* calendário é complemento: falha não derruba a TV */ });
  }

  // ── alertas sonoros ──
  var audioCtx = null, somLiberado = false, cfgAlertas = [];
  function liberarSom(){
    try{
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      audioCtx.resume().then(function(){
        somLiberado = true;
        var b = document.getElementById('somBtn');
        b.textContent = '🔔 som ligado'; b.style.background = 'rgba(30,142,78,.55)';
        bip(880, 0.12);
      });
    }catch(e){}
  }
  document.getElementById('somBtn').addEventListener('click', liberarSom);
  function bip(freq, dur){
    if(!audioCtx) return;
    var o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.6, audioCtx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
    o.connect(g); g.connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + dur + 0.02);
  }
  function campainha(segundos){
    // "din-don" a cada meio segundo pela duracao configurada
    var fim = Date.now() + segundos * 1000, n = 0;
    var t = setInterval(function(){
      if(Date.now() >= fim){ clearInterval(t); return; }
      bip(n % 2 ? 660 : 990, 0.35); n++;
    }, 500);
  }
  function dispararAlerta(a){
    var hh = new Date(Date.now() - 3*3600000).toISOString().slice(11,16);
    document.getElementById('alertaNome').textContent = a.nome;
    document.getElementById('alertaHora').textContent = hh + (somLiberado ? '' : '  ·  (som da TV não liberado)');
    var el = document.getElementById('alerta'); el.style.display = 'flex';
    var dur = Math.max(1, Math.min(60, Number(a.duracao) || 5));
    if(somLiberado) campainha(dur);
    setTimeout(function(){ el.style.display = 'none'; }, Math.max(dur, 5) * 1000);
  }
  function checarAlertas(){
    if(!cfgAlertas.length) return;
    var agora = new Date(Date.now() - 3*3600000);           // BRT
    var hhmm = agora.toISOString().slice(11,16);
    var dia = agora.toISOString().slice(0,10);
    var dow = agora.getUTCDay();
    cfgAlertas.forEach(function(a){
      if(a.ativo === false || a.hora !== hhmm) return;
      var bate = a.data ? (a.data === dia) : ((a.dias || []).indexOf(dow) >= 0);
      if(!bate) return;
      var chave = 'wms_alerta_' + a.id + '_' + dia;
      try{ if(localStorage.getItem(chave)) return; localStorage.setItem(chave, '1'); }catch(e){}
      dispararAlerta(a);
    });
  }
  setInterval(checarAlertas, 5000);

  function carregar(){
    fetch(API + '?acao=dashboard')
      .then(function(r){ return r.json(); })
      .then(function(d){ if (d && d.ok) pintar(d); })
      .catch(function(){ document.getElementById('sync').textContent = 'sem conexão — tentando de novo'; });
  }
  carregar(); carregarCal();
  setInterval(carregar, 60000);
  setInterval(carregarCal, 600000);
  // 02/09: o reload de hora em hora zerava a liberacao de som do Chrome (cada
  // pagina nova exige um clique). Agora so recarrega quando o HTML da TV
  // mudou (deploy novo) — comparando o ETag a cada 10 min.
  var etagTv = null;
  function checarVersao(){
    fetch(location.href, { method: 'HEAD', cache: 'no-store' }).then(function(r){
      var e = r.headers.get('etag');
      if(!e) return;
      if(etagTv && e !== etagTv){ location.reload(); }
      etagTv = e;
    }).catch(function(){});
  }
  checarVersao(); setInterval(checarVersao, 600000);
  // tenta liberar o som sozinho (funciona quando o Chrome da TV e aberto com
  // --autoplay-policy=no-user-gesture-required); senao, o botao fica piscando
  setTimeout(function(){
    liberarSom();
    setTimeout(function(){ if(!somLiberado){ var b=document.getElementById('somBtn'); b.style.animation='pisca 1.2s infinite'; } }, 1500);
  }, 800);
</script>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).send(html);
}
