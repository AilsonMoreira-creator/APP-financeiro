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
  <!-- 02/09: TV Samsung (navegador Tizen) — som de campainha EMBUTIDO na
       pagina (WAV base64), tocado por <audio>: caminho mais aceito em TVs.
       O Web Audio fica como primeira opcao; se nao estiver liberado, toca
       este. -->
  <audio id="somAlerta" preload="auto" src="data:audio/wav;base64,UklGRmQfAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YUAfAACAx+XJgzsaNHnC5M2JQBwxc7zj0I9FHS1tt+HTlUsfKmex39abUSEoYazd2KFWJCZbptraplwnJFag19ysYiojUZrT3bFoLSJMlNDetW4xIUeOzN66dDUhQ4jI3r56OSE/gsPewoA+ITt8v93GhkMiOHa63MmMSCQ0cLXbzJJNJTJrsNnPl1InL2Wq19GcVyktYKXU06JdLCtbn9LVp2IvKlaaz9araDIpUZTL17BtNShNj8jXtHM5KEmJxNe4eT0oRYTA17x+QShBfrzXv4RFKT55t9bDiUoqO3Oz1caOTys4bq7TyJNTLTZpqdHKmFgvNGSkz8ydXTEyX5/NzqJiNDBbmsrPp2g2L1aVx9CrbTovUpDE0a9yPS5OisDRs3dALkqFvdG2fEQuR4C50bqBSC9Ee7XQvYZMMEF2sc/Ai1ExPnGszsKQVTI8bKjMxJVZNDpoo8rGml42OGOfyMieYzg3X5rGyaJoOzVblcPKpmw+NVeQwMuqcUE0U4u9y652RDRQh7rLsXtHNEyCtsu0f0s0SX2yyreETzVGeK/KuolSNkR0q8i8jVY3Qm+mx7+SWzlAa6LFwJZfOj5nnsTCmmM9PGOawcOeaD87X5W/xKJsQTpbkbzFpnFEOliMusWpdUc5VIi3xqx5SjlRg7PGr35NOk5/sMWyglE6S3utxLWHVDtJdqnEt4tYPEdypcK5j1w9RW6hwbuTYD9Dap2/vZdkQUJmmb2+m2hDQWOVu7+ebEVAX5G5wKJwRz9cjbbApXRKP1iJtMGoeE0+VYWxwat8UD9Tga7AroFTP1B8qsCwhVZATninv7KJWkBMdaS+tIxdQkpxoL22kGFDSG2du7iUZEVHaZm6uZdoRkVmlbi6m2xIRGORtruecEtEX42zu6F0TUNcirG8pHdPQ1qGrryne1JDV4KrvKl/VUNUfqm7rINYRFJ6pbuuhltFUHeiurCKXkZOc5+5so5iR01wnLizkWVIS2yYtrSUaEpKaZW0tZhsTElmkbK2m3BOSGOOsLeec1BIYIqut6B3Ukhdh6y4o3pUR1uDqbelfldIWICnt6iBWkhWfKS3qoVdSVR5obasiGBJUnWeta2LY0pRcpu0r49mTE9vmLOwkmlNTmyUsbGVbE9NaZGvsphvUE1mjq6zmnNSTGOLrLOddlRMYYeps6B5V0xehKezon1ZTFyBpbOkgFxMWn2is6aDXkxYeqCyqIZhTVZ3nbKqiWROVXSasauMZ09TcZevrI9pUFJulK6tkmxSUWuRra6Vb1NQaY6rr5hzVVBmi6mvmnZXUGSIp7CceVlPYYWlsJ98W09fgqOwoX9dUF1/oa+jgmBQW3yer6SFYlBaeZyupohlUVh2ma2nimdSV3OWrKmNalNWcJSrqpBtVFVukaqrknBWVGuOqKuVcldUaYunrJd1WVNniKWsmnhbU2SGo6yce11TYoOhrJ5+X1NggJ+sn4FhU199nayhg2NUXXqaq6OGZlRceJiqpIloVVp1lqmli2tWWXKTqKaObVdYcJGnp5BwWFhujqaok3JaV2uLpKiVdVtWaYmjqZd4XVZnhqGpmXpfVmWDn6mbfWFWY4GdqZ2AY1ZifpupnoJlV2B8maighWdXX3mXqKGHaVhdd5WnooprWVx0k6ajjG5aW3KQpaSOcFtbcI6kpZByXFpui6KlknVdWmyJoaaUd19ZaoefppZ6YFlohJ6mmHxiWWaCnKaaf2RZZH+appuBZlljfZilnYNoWmJ6lqWehmpaYHiUpJ+IbFtfdpKjoIpuXF50kKOhjHBdXnKOoaKOcl5dcIugopB1X1xuiZ+jkndhXGyHnqOUeWJcaoWco5Z8ZFxogpujl35lXGeAmaOZgGdcZX6Xo5qCaVxkfJWim4RrXWN5k6Kdh21eYneRoZ2Jb15hdY+gnotxX2BzjZ+fjXNgYHGLnqCOdWFfcImdoJB3Yl9uh5ygknlkXmyFm6GUe2Vea4OZoZV9Z15pgZihln9oX2h/lqCYgWpfZ32UoJmDbF9le5OgmoVtYGR5kZ+bh29gZHePnpyJcWFjdY2dnYtzYmJzi5ydjXVjYnGJm56Od2RhcIeanpB5ZWFuhZmekntnYW2DmJ6TfWhha4GWnpR/aWFqgJWeloBrYWl+k56XgmxhaHySnZiEbmJnepCdmYZwYmZ4jpyaiHFjZXaNnJqKc2RkdYubm4t1ZWRziZqbjXdmZHGHmZyOeGdjcIaYnJB6aGNvhJeckXxpY22ClZySfmpjbICUnJSAbGNrfpOclYFtY2p9kZuWg29kaXuQm5eFcGRoeY6al4dyZWd4jJqYiHNmZ3aLmZmKdWZmdImYmYt3Z2Zzh5eZjXhoZXKGlpqOemllcISVmo98amVvgpSakX1rZW6Bk5qSf21lbX+SmpOBbmVsfZCZlIJvZmt8j5mVhHFmanqOmZWGcmdpeYyYlod0Z2l3i5eXiHVoaHaJl5eKd2lodIeWl4t4amdzhpWYjXpqZ3KElJiOe2tncYOTmI99bWdwgZKYkH9uZ26AkZiRgG9nbn6QmJKCcGdtfY6Xk4NxaGx7jZeUhXNoa3qMl5SGdGlreIqWlYd1aWp3iZWViXdqanaHlZaKeGtpdIaUlot6bGlzhZOWjHttaXKDkpaNfW1pcYKRlo5+b2lwgJCWj39waW9/j5aQgXFpbn2OlpGCcmlufIyVkoRzam17i5WShXRqbHmKlZOGdmtseImUlIh3a2t3h5OUiXhsa3aGk5SKem1rdYWSlIt7bmpzg5GVjHxuanKCkJWNfm9qcoGPlY5/cGpxf46Uj4Bxa3B+jZSQgnJrb32MlJCDdGtue4uUkYR1bG56ipORhXZsbXmIk5KHd21teIeSkoh4bW13hpGTiXpubHaFkZOKe29sdYSQk4t8b2x0go+TjH1wbHOBjpONf3FscoCNk42Acmxxf4yTjoFzbHF9i5OPgnRtcHyKko+DdW1ve4mSkIV2bW96iJKQhndubnmHkZGHeG5ueIaQkYh6b253hZCRiXtwbnaEj5KKfHBtdYOOkot9cW10gY6Si35ybXOAjZKMf3Ntc3+Mko2AdG5yfouRjYJ1bnF9ipGOg3ZucXyJkY+Ed25we4iQj4V4b3B6h5CPhnlvb3mGj5CHenBveIWPkIh7cG93hI6QiXxxb3aDjpCJfXJvdYKNkIp+c290gYyQi39zb3R/i5CMgHRvc36KkIyBdW9yfYqQjYJ2b3J8iZCNg3dwcXuIj46EeHBxeoePjoV5cHF6ho6OhnpxcHmFjo+He3FweISNj4h8cnB3g42PiH1zcHaCjI+JfnNwdYGLj4p/dHB1gIuPi4B1cHR/io+LgXVwdH6Jj4yCdnBzfYiPjIJ3cXN8h46Ng3hxcnuHjo2EeXFyeoaOjYV6cnJ5hY2OhntycXmEjY6HfHNxeIOMjoh9c3F3gouOiH10cXaBi46JfnVxdoCKjop/dXF1f4mOioB2cXV+iY6LgXdxdH2IjouCd3J0fYeNjIN4cnN8ho2MhHlyc3uGjYyEenNzeoWMjIV7c3J5hIyNhnxzcnmDi42HfHRyeIKLjYd9dHJ3gYqNiH51cneAio2Jf3ZydoCJjYmAdnJ2f4iNioF3cnV+iI2KgXhydX2HjIqCeHN0fIaMi4N5c3R8hYyLhHpzdHuFi4uFe3RzeoSLjIV8dHN5g4uMhnx1c3mCioyHfXVzeIGKjId+dnN4gYmMiH92c3eAiYyIgHdzd3+IjImAd3N2foeMiYF4c3Z+h4yKgnl0dX2Gi4qDeXR1fIWLioN6dHV7hYuKhHt0dHuEiouFfHV0eoOKi4V8dXR5goqLhn12dHmCiYuGfnZ0eIGJi4d+d3R4gIiLh393dHd/iIuIgHh0d3+Hi4iBeHR2foaLiYF5dHZ9houJgnp1dn2FiomDenV2fISKioN7dXV7hIqKhHx1dXuDiYqFfHZ1eoKJioV9dnV6gomKhn53dXmBiIqGfnd1eYCIiod/eHV4gIeKh4B4dXh/h4qIgHl1d36GioiBeXV3foWKiIJ6dXd9hYqJgnp1dnyEiYmDe3Z2fISJiYN8dnZ7g4mJhHx2dnuCiImFfXd2eoKIiYV+d3Z6gYiJhn54dnmBh4mGf3h2eYCHiYZ/eHZ4f4aJh4B5dnh/homHgXl2eH6FiYeBenZ3fYWJiIJ7dnd9hImIgnt2d3yEiYiDfHd3fIOIiIN8d3d7goiJhH13dnuCiImEfXh2eoGHiYV+eHZ6gYeJhX94dnmAhomGf3l2eYCGiYaAeXZ5f4aJhoB6dnh+hYmHgXp3eH6FiIeBe3d4fYSIh4J7d3h9g4iIg3x3d3yDiIiDfHd3fIKHiIR9eHd7goeIhH14d3uBh4iEfnh3eoGGiIV+eXd6gIaIhX95d3qAhoiGgHp3eX+FiIaAend5f4WIhoF6d3l+hIiGgXt3eH6EiIeCe3d4fYOHh4J8eHh9g4eHg3x4eHyCh4eDfXh4fIKHh4N9eHh7gYaHhH55eHuBhoeEfnl4e4CGh4V/eXh6gIWHhX96eHp/hYeFgHp4en+Fh4aAe3h5foSHhoF7eHl+hIeGgXx4eX2Dh4aCfHh5fYOHhoJ8eHh9goeHg315eHyChoeDfXl4fIGGh4N+eXh7gYaHhH55eHuAhYeEf3p4e4CFh4R/enh6gIWHhYB6eHp/hIeFgHt4en+Eh4WBe3h6foSHhoF8eHl+g4aGgXx5eX2DhoaCfHl5fYKGhoJ9eXl9goaGg315eXyBhoaDfnp5fIGFhoN+enl7gYWGhH96eXuAhYaEf3p5e4CEhoR/e3l7f4SGhYB7eXp/hIaFgHt5en6DhoWBfHl6foOGhYF8eXp+g4aFgn15en2ChoaCfXl5fYKFhoJ9enl9gYWGg356eXyBhYaDfnp5fIGFhoN/enl8gISGhH97eXuAhIaEf3t5e3+EhoSAe3l7f4SGhIB8eXt/g4aFgXx5en6DhoWBfHl6foOFhYF9enp+goWFgn16en2ChYWCfXp6fYGFhYJ+enp9gYWFg356enyBhIWDfnt6fICEhYN/e3p8gISFg397enuAhIWEgHt6e3+DhYSAfHp7f4OFhIB8ent/g4WEgXx6e36ChYSBfXp6foKFhYF9enp9goWFgn16en2BhYWCfnp6fYGEhYJ+e3p9gYSFg357enyAhIWDf3t6fICEhYN/e3p8gIOFg398enx/g4WEgHx6e3+DhYSAfHp7f4OFhIB8ent+goWEgX16e36ChYSBfXp7foKEhIF9e3t9gYSEgn57e32BhISCfnt6fYGEhYJ+e3p9gISFgn97enyAhIWDf3x6fICDhYN/fHp8f7LX5di0g1AqGyZIeazT5Nq5iVYvHCREc6bO4ty+j1wzHiI/baDK4N3ClWM4ICE7Z5nF3t7Gm2k9IiE4YZPA29/JoG9CJSA0XI262N/MpnVHKCAxV4e11d7Pq3tNLCEvUoGw0d7Rr4FSLyItTXuqzt3TtIdYMyMrSXWkytvVuI1eOCQpRXCfxdrWvJJjPCYoQWqZwdjXwJdpQCkoPmWTvNXYw51vRSsnOmCNt9PYxqJ0Si4nOFuIstDYyaZ6TzEoNVaCrczXy6uAVDQoM1J9qMnWza+FWTgpMU53o8XVzrOKXzwrMEpynsHU0LePZEAsL0ZtmL3S0bqUaUQuLkNok7nQ0b2Zb0gxLkBjjrTN0cCedE0zLj1fibDL0cOieVE2Ljtag6vI0cWnflY5LjlWfqbE0Merg1s8LzdSeaLBz8iuiGBAMDZPdJ29zsqyjWVDMjVLcJi6zMu1kmpHNDRIa5O2ysu4lm9LNjRFZo6yyMy7m3NPODNDYomtxsy9n3hUOzRBXoSpw8u/o31YPTQ/Wn+lwMvBp4JcQDU9V3ugvcrDqoZhRDY8U3acusnErotmRzc6UHKXtsfFsY9qSjk6TW2Ts8XGs5RvTjs5SmmOr8PGtphzUj05SGWKq8HGuJx4Vj85RmGFp7/Gup98WkE5RF6Bo7zFvKOBXkQ6Qlp8n7nFvqaFYkc7QVd4m7bEv6mJZko8QFR0l7PCwKyNa009P1FwkrDBwK+Rb1E/Pk9sjqy/wbGVc1RBPkxoiqm9wbSZd1hDPkpkhqW7wbace1xFPkhhgqG4wLeggF9IP0defZ62wLmjhGNKQEZbeZqzv7qmh2dNQUVYdpawvruoi2tQQkRVcpKtvLyrj29TQ0NTbo6qu7ytk3NXRUNRa4qnubyvlndaR0NPZ4ajt7yxmXtdSUNNZIKgtbyznX9hS0NLYX+cs7u0oIJkTkRKXnuZsLu2ooZoUEVJW3eVrbq2pYpsU0ZIWXSSq7i3p41vVkdIV3COqLe4qpBzWUlHVG2KpbW4rJR3XEtHU2qHorS4rZd6X0xHUWeDnrK4r5p+Yk5IT2R/m6+3sJ2BZlFITmF8mK22sZ+FaVNJTV95lKu2sqKIbFZKTFx1kai1s6SLcFhLTFpyjqWzs6aOc1tMS1hviqOytKiRdl5OS1Zsh6CwtKqUemFQS1VphJ2utKuXfWRSTFNngJqss6yagGdUTFJkfZeqs66chGpWTVFiepSosq6fh21YTlBfd5Gmsa+hinBaT1BddI2jsLCjjXNdUE9bcYqhr7Clj3ZgUU9aboeerbCmknliU09Ya4Sbq7ColXxlVE9XaYGZqrCpl4BoVlBWZ36WqK+qmoJrWFBVZHuTpq6rnIVtWlFUYniQpK6snohwXVJTYHWNoa2soItzX1NTXnOKn6usoY52YVRTXXCHnaqso5B5ZFZTW26EmqmspJN8ZldTWmuCmKesppV/aVlTWWl/laWsp5eCa1tTWGd8kqOrqJmEbl1UV2V5kKKqqJuHcV9VV2N3jZ+qqZ2Kc2FWVmF0ip2pqZ+MdmNXVmByh5unqaCOeWVYVl5vhZmmqaGRfGdaVl1tgpalqaOTfmpbVlxrf5SjqaSVgWxdV1tpfZGhqKSXg29fV1pneo+gqKWZhnFgWFpleI2ep6aaiHRiWVlkdoqcpqaci3ZkWllic4iapaadjXlmW1lhcYWXpKafj3tpXFlgb4OVoqagkX5rXVlfbYCToaahk4BtX1lea36Rn6WilYJvYVpdaXuOnqWil4VyYlpcaHmMnKSjmId0ZFtcZneKmqOjmol2ZlxcZXWImKKjm4t5aF1cY3OFlqGjnI17al5cYnGDlKCjnY99bGBcYW+Bkp+jnpGAbmFcYG1+kJ2jn5OCcGJcYGt8jpyioJSEcmRdX2p6jJqioJaGdGZeX2h4ipmhoJeIdmdeXmd2h5egoZmKeWlfXmZ0hZWfoZqMe2tgXmVyg5OeoZuOfW1iXmRwgZGdoZyPf29jX2Nvf4+coJyRgXFkX2JtfY2aoJ2Tg3NmX2Jse4uZn56UhXVnYGFqeYmXn56Vh3dpYWFpd4eWnp6XiXlqYmFodYWUnZ6Yi3tsYmFndIOSnJ6ZjH1uY2FmcoGQm56Zjn9vZWFlcH+Pmp6aj4BxZmFkb36NmZ6bkYJzZ2JkbXyLl52bkoR1aGJjbHqJlp2ck4Z3amNja3iHlJyclYh5a2NjanaFk5uclol6bWRjaXWEkZqcl4t8b2VjaHOCkJmcl4x+cGZjZ3KAjpicmI6AcmdjZ3B+jJecmY+CdGlkZm98i5abmZGDdWpkZm57iZWbmpKFd2tlZW15h5OampOHeW1lZWx4hZKZmpSIem5mZWt2hJCZmpWKfG9nZWp1go+YmpaLfnFoZWlzgI2XmpaNgHJpZWhyf4yWmpeOgXRqZmhxfYqUmZePg3ZrZmhve4mTmZiQhHdsZmdueoeSmJiRhnluZ2dteIWRmJiSh3pvaGdsd4SPl5iTiXxwaGdsdoKOlpiUin5yaWdrdIGNlZiUi39zamdqc3+LlJiVjYF0a2dqcn6Kk5iVjoJ2bGhpcXyIkpeWj4R3bWhpcHuHkZeWkIV5b2lpb3mFkJaWkYZ6cGlpbniEj5WWkYh8cWppbXeCjZWWkol9cmtpbXWBjJSWk4p/dGxpbHR/i5OWk4uAdWxpa3N+iZKWlIyCdm1pa3J9iJGVlI2DeG5qa3F7h5CVlI6EeXBqanB6hY+VlY+GenFram95hI6UlZCHfHJram94g42TlZGIfXNsam52gYuTlZGJf3Rtam11gIqSlZKKgHVua210f4mRlJKLgXdva21zfYiQlJOMgnhva2xyfIaPlJONhHlwbGxye4WOk5OOhXpxbGxxeoSNk5OPhnxybWxweIOMkpOPh310bWxvd4GLkZOQiH51bmxvdoCKkZOQiYB2b2xudX+JkJORioF3cGxudH6Hj5ORi4J4cG1udH2GjpKRjIN5cW1tc3uFjZKSjYR7cm1tcnqEjJGSjYV8c25tcXmDi5GSjoZ9dG5tcXiCipCSj4d+dW9tcHeAiZCSj4h/dnBtcHZ/iI+Sj4mAd3Bub3V+h46RkIqBeHFub3V9ho2RkIuDenJub3R8hYyRkIuEe3Nvb3N7hIyQkIyFfHRvb3N6g4uQkI2GfXVwb3J5goqPkI2HfnZwb3F4gYmPkI6Hf3dxb3F3f4iOkI6IgHhxb3F2foeNkI+JgXlyb3B2fYaNkI+Kgnpzb3B1fIWMj4+Kg3t0cHB0e4SLj4+LhHx0cHB0e4OKj4+MhX11cXBzeoKJjo+Mhn52cXBzeYGIjo+Nh393cnByeICHjY+Nh4B4cnByd3+HjI+NiIF5c3Bydn6GjI+OiYJ6dHBxdn2Fi46OioN7dHFxdXyEio6OioN8dXFxdXuDio6Oi4R9dnJxdHqCiY2Oi4V+d3JxdHmBiI2OjIZ/d3Nxc3mAh4yOjIeAeHNxc3h/hoyOjIeAeXRxc3d+hYuOjYiBenRxcnd9hIqNjYmCe3VycnZ8hIqNjYmDfHZycnZ8g4mNjYqEfXZycnV7goiMjYqFfndzcnV6gYiMjYuFfnhzcnR5gIeLjYuGf3l0cnR5f4aLjYuHgHl0cnR4foWKjYyHgXp1cnN3foSKjIyIgnt2c3N3fYSJjIyIg3x2c3N2fIOIjIyJg313c3N2e4KIjIyJhH54dHN1e4GHi4yKhX54dHN1eoCGi4yKhX95dXN1eX+GioyKhoB6dXN0eX+FioyLh4F6dnN0eH6EiYyLh4F7dnR0eH2DiYuLiIJ8d3R0d32DiIuLiIN9d3R0d3yCh4uLiYR9eHR0dnuBh4qLiYR+eXV0dnuAhoqLiYV/eXV0dnqAhYqLioWAenZ0dXl/hYmLioaAe3Z0dXl+hImLioaBe3d0dXh+g4iLioeCfHd1dXh9g4iKioeCfXh1dXd8goeKioiDfXh1dXd8gYaKioiEfnl2dXd7gYaJioiEf3p2dXZ6gIWJiomFgHp2dXZ6f4SIiomFgHt3dXZ5f4SIiomGgXt3dXZ5foOIiomGgXx4dXZ5fYOHiomHgn14dnZ4fYKHiYqHg315dnV4fIGGiYqHg355dnV3e4GFiYqIhH96dnV3e4CFiImIhH96d3Z3en+EiImIhYB7d3Z3en+EiImIhYF8eHZ2en6Dh4mJhoF8eHZ2eX6Ch4mJhoJ9eXZ2eX2ChomJhoJ9eXZ2eHyBhoiJh4N+end2eHyBhYiJh4N/end2eHuAhYiJh4R/e3d2eHt/hIeJiISAe3h2d3p/hIeJiIWAfHh2d3p+g4eIiIWBfHl3d3p+goaIiIaBfXl3d3l9goaIiIaCfXl3d3l9gYWIiIaCfnp3d3l8gYWIiIaDf3p4d3h8gISHiIeDf3t4d3h7gISHiIeEgHt4d3h7f4OHiIeEgHx5d3h7f4OGiIeFgXx5d3h6foKGiIeFgX15d3h6foKFh4eFgn16eHh6fYGFh4eGgn56eHd5fYGFh4iGg357eHd5fICEh4eGg397eHh5fICEhoeGg4B8eXh5e3+DhoeHhIB8eXh4e3+DhoeHhIB9eXh4e36ChYeHhYF9enh4en6ChYeHhYF9enh4en2BhYeHhYJ+enh4en2BhIeHhYJ+e3l4en2AhIaHhoN/e3l4eXyAg4aHhoN/fHl4eXx/g4aHhoOAfHl4eXt/g4WHhoSAfXp4eXt+goWHhoSBfXp4eXt+goWGhoSBfnp5eXp+gYSGhoWCfnt5eXp9gYSGhoWCfnt5eXp9gISGhoWCf3x5eXp8gIOGhoWDf3x5eXp8f4OFhoWDgHx6eXl8f4KFhoaDgH16eXl7f4KFhoaEgX16eXl7foKEhoaEgX57eXl7foGEhoaEgX57eXl7fYGEhoaEgn57eXl6fYCDhYaFgn98enl6fYCDhYaFgn98enl6fICDhYaFg4B8enl6fH+ChYaFg4B9enl6fH+ChIaFg4B9e3l6fH6ChIaFhIF+e3p6e36BhIWFhIF+e3p6e36BhIWFhIF+fHp6e32Ag4WFhIJ/fHp6e32Ag4WFhIJ/fHp6e32Ag4WFhYKAfXp6enx/goSFhYOAfXt6enx/goSFhYOAfXt6enx/goSFhYOBfnt6enx+gYSFhYOBfnt6ent+gYOFhYSBfnx6ent+gIOFhYSCf3x6ent9gIOFhYSCf3x7ent9gIKEhYSCf317ent9f4KEhYSCgH17ent8f4KEhYSDgH17ent8f4GEhYSDgH57enp8foGDhYWDgX58enp8foGDhYWDgX58e3p8foCDhIWDgX98e3p7foCDhIWEgn99e3p7fYCChIWEgn99e3p7fQ=="></audio>
  <button id="somBtn" title="Liberar o som da TV pros alertas" style="position:fixed;top:1.2vh;right:1.2vw;z-index:50;border:1px solid rgba(255,255,255,.4);background:rgba(0,0,0,.35);color:#fff;border-radius:999px;padding:.6vh 1.2vw;font-size:1.8vh;cursor:pointer;font-family:inherit">🔕 som — clique uma vez pra liberar</button>

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
    try{ cfgAlertas = (d.config && Array.isArray(d.config.alertas)) ? d.config.alertas : []; checarTeste(d.config && d.config.alerta_teste_em); }catch(e){}
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
  document.getElementById('somBtn').addEventListener('click', function(){
    liberarSom();
    // aquece o <audio> no gesto (algumas TVs so tocam depois de um play iniciado por clique)
    try{ var el=document.getElementById('somAlerta'); el.volume=0.01; var p=el.play(); if(p&&p.then) p.then(function(){ el.pause(); el.currentTime=0; el.volume=1; }).catch(function(){ el.volume=1; }); }catch(e){}
  });
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
  function tocar(segundos){
    var el = document.getElementById('somAlerta');
    var fallback = function(){ if(audioCtx && audioCtx.state === 'running') campainha(segundos); };
    if(!el){ fallback(); return; }
    try{
      el.loop = true; el.currentTime = 0; el.volume = 1;
      var p = el.play();
      if(p && p.then){ p.then(function(){}).catch(function(){ fallback(); }); }
      setTimeout(function(){ try{ el.pause(); el.loop = false; }catch(e){} }, segundos * 1000);
    }catch(e){ fallback(); }
  }
  function dispararAlerta(a){
    var hh = new Date(Date.now() - 3*3600000).toISOString().slice(11,16);
    document.getElementById('alertaNome').textContent = a.nome;
    document.getElementById('alertaHora').textContent = hh;
    var el = document.getElementById('alerta'); el.style.display = 'flex';
    var dur = Math.max(1, Math.min(60, Number(a.duracao) || 5));
    // 03/09: <audio> embutido PRIMEIRO (o caminho confiavel na Samsung); o
    // Web Audio so se o play for recusado — "liberado" sem gesto podia ser
    // fantasma (contexto running, alto-falante mudo).
    tocar(dur);
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
      // 03/09 (tocava "as vezes"): a chave era por alerta+dia — mudar a hora
      // pra testar no mesmo dia nao tocava de novo. Agora inclui a hora.
      var chave = 'wms_alerta_' + a.id + '_' + dia + '_' + a.hora;
      try{ if(localStorage.getItem(chave)) return; localStorage.setItem(chave, '1'); }catch(e){}
      dispararAlerta(a);
    });
  }
  // teste disparado pela Config ("Tocar teste na TV agora"): a config traz
  // alerta_teste_em (epoch ms); se e recente e ainda nao tocou, toca 5s.
  var testeTocado = null;
  function checarTeste(t){
    if(!t || t === testeTocado) return;
    if(Date.now() - Number(t) > 3*60*1000) return;
    testeTocado = t;
    dispararAlerta({ nome: 'TESTE DO ALERTA', duracao: 5 });
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
