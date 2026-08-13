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
  .grade { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1.4vw; margin-bottom: 1.6vh; }
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
</style>
</head>
<body>
  <header>
    <h1>📦 EXPEDIÇÃO</h1>
    <span class="sync" id="sync">carregando…</span>
    <span class="relogio" id="relogio">--:--</span>
  </header>

  <div class="grade">
    <div class="card"><div class="rotulo">Pra separar</div><div class="numero azul" id="abertos">–</div><div class="sub" id="pecas">&nbsp;</div></div>
    <div class="card"><div class="rotulo">Em separação</div><div class="numero ambar" id="sep">–</div><div class="sub" id="nf">&nbsp;</div></div>
    <div class="card"><div class="rotulo">Prontos hoje</div><div class="numero verde" id="fin">–</div><div class="sub" id="ritmo">&nbsp;</div></div>
    <div class="card"><div class="rotulo">Falta pro corte</div><div class="numero" id="corte">–</div><div class="sub" id="corteh">&nbsp;</div></div>
  </div>

  <div id="alertas" style="display:grid;gap:1.2vh;margin-bottom:1.6vh"></div>

  <div class="faixa">
    <div class="painel">
      <div class="rotulo" style="margin-bottom:1vh">Por empresa</div>
      <div id="contas"></div>
    </div>
    <div class="painel">
      <div class="rotulo" style="margin-bottom:1vh">Atenção</div>
      <div id="pendencias"></div>
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
    document.getElementById('pecas').textContent = n(t.pecas_abertas) + ' peças' + (n(t.pra_amanha) ? ' · ' + n(t.pra_amanha) + ' pra amanhã' : '');
    document.getElementById('sep').textContent = n(t.em_separacao);
    var prev = n(t.em_separacao_com_nf_prevista), comNf = n(t.em_separacao_nf);
    document.getElementById('nf').textContent = prev ? ('NF ' + comNf + ' de ' + prev) : '\\u00a0';
    document.getElementById('fin').textContent = n(t.finalizados_hoje);

    // falta pro corte
    var corteEm = d.corte_em ? new Date(d.corte_em) : null;
    var elC = document.getElementById('corte');
    if (corteEm) {
      var min = Math.round((corteEm.getTime() - Date.now())/60000);
      if (min > 0) {
        elC.textContent = min >= 60 ? (Math.floor(min/60) + 'h' + String(min%60).padStart(2,'0')) : (min + 'min');
        elC.className = 'numero ' + (min <= 30 ? 'vermelho' : min <= 60 ? 'ambar' : 'verde');
        document.getElementById('corteh').textContent = 'corte às ' + fmtHora(corteEm);
      } else {
        elC.textContent = 'PASSOU';
        elC.className = 'numero vermelho';
        elC.style.fontSize = '7vh';
        document.getElementById('corteh').textContent = 'corte era ' + fmtHora(corteEm);
      }
    }

    // ritmo do dia
    var agora = new Date(Date.now() - 3*3600000);
    var horas = Math.max(0.5, (agora.getUTCHours() + agora.getUTCMinutes()/60) - 8.67);
    var ritmo = Math.round(n(t.finalizados_hoje) / horas);
    document.getElementById('ritmo').textContent = ritmo ? (ritmo + ' pedidos/hora') : '\\u00a0';

    // por empresa
    var cont = document.getElementById('contas'); cont.innerHTML = '';
    var nomes = { exitus:'Exitus', lumia:'Lumia', muniam:'Muniam' };
    Object.keys(d.por_conta || {}).forEach(function(k){
      var c = d.por_conta[k];
      var linha = document.createElement('div');
      linha.className = 'linha';
      linha.innerHTML = '<span style="flex:1">' + (nomes[k]||k) + '</span>' +
        '<b class="azul">' + n(c.abertos) + '</b><span style="opacity:.5">separar</span>' +
        '<b class="ambar">' + n(c.em_separacao) + '</b><span style="opacity:.5">na mão</span>' +
        '<b class="verde">' + n(c.finalizados_hoje) + '</b><span style="opacity:.5">prontos</span>';
      cont.appendChild(linha);
    });

    // pendências
    var p = document.getElementById('pendencias'); p.innerHTML = '';
    function linhaP(txt, valor, classe){
      var l = document.createElement('div'); l.className = 'linha';
      l.innerHTML = '<span style="flex:1">' + txt + '</span><b class="' + classe + '">' + valor + '</b>';
      p.appendChild(l);
    }
    linhaP('⏳ Aguardando mercadoria', n(t.aguardando), n(t.aguardando) ? 'ambar' : 'verde');
    linhaP('⚡ Flex em separação', n(t.em_separacao_flex), 'azul');
    if (prev) linhaP('📄 NF faltando', Math.max(0, prev - comNf), (prev - comNf) ? 'ambar' : 'verde');
    linhaP('📅 Entraram após o corte', n(t.pra_amanha), 'azul');

    // alertas grandes
    document.getElementById('alertas').innerHTML = '';
    var restante = n(t.abertos) + n(t.em_separacao);
    if (corteEm) {
      var min2 = Math.round((corteEm.getTime() - Date.now())/60000);
      if (min2 > 0 && min2 <= 45 && restante > 0)
        alerta('vermelho', '⏰ FALTAM ' + min2 + ' MIN PRO CORTE — ainda tem ' + restante + ' pedido(s) na fila');
      else if (min2 <= 0 && restante > 0)
        alerta('ambar', '⏰ CORTE PASSOU — ' + restante + ' pedido(s) ainda na fila');
      else if (restante === 0 && n(t.finalizados_hoje) > 0)
        alerta('verde', '✅ FILA ZERADA — ' + n(t.finalizados_hoje) + ' pedidos prontos hoje. Mandou bem, time!');
    }
    if (n(t.aguardando) >= 10)
      alerta('ambar', '⏳ ' + n(t.aguardando) + ' pedidos esperando mercadoria da passadoria');

    var s = d.ultimo_sync ? new Date(d.ultimo_sync) : null;
    document.getElementById('sync').textContent = s ? ('atualizado ' + fmtHora(s)) : '';
  }

  function carregar(){
    fetch(API + '?acao=dashboard')
      .then(function(r){ return r.json(); })
      .then(function(d){ if (d && d.ok) pintar(d); })
      .catch(function(){ document.getElementById('sync').textContent = 'sem conexão — tentando de novo'; });
  }
  carregar();
  setInterval(carregar, 60000);
  setInterval(function(){ location.reload(); }, 3600000); // recarrega de hora em hora
</script>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).send(html);
}
