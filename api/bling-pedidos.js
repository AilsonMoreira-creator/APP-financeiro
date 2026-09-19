import https from "https";
// 19/09 (auditoria): a tela nao manda mais access_token — manda a CONTA e o
// servidor pega o token (chave de servico, com refresh automatico). O modo
// antigo (access_token no corpo) continua aceito pra nao quebrar nada.
import { refreshBlingToken } from './_bling-helpers.js';

function getBling(accessToken, path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "api.bling.com.br",
      path: path,
      method: "GET",
      headers: {
        "Authorization": "Bearer " + accessToken,
        "Accept": "application/json"
      }
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (c) => { data += c; });
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on("error", (e) => reject(e));
    req.end();
  });
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ erro: "Use POST" });

  try {
    const body = req.body || {};
    const { data_inicial, data_final, pagina = 1, limite = 100 } = body;
    let access_token = body.access_token;
    if (!access_token && body.conta) {
      const c = String(body.conta).toLowerCase();
      if (!['exitus', 'lumia', 'muniam'].includes(c)) return res.status(400).json({ erro: 'conta inválida' });
      try { access_token = await refreshBlingToken(c); }
      catch (e) { return res.status(400).json({ erro: 'conta sem token válido: ' + String(e?.message || e).slice(0, 80) }); }
    }

    if (!access_token || !data_inicial) {
      return res.status(400).json({ erro: "Faltam conta/access_token ou data_inicial" });
    }

    const df = data_final || data_inicial;
    const path = "/Api/v3/pedidos/vendas?situacaoId=9&dataInicial=" + data_inicial + "&dataFinal=" + df + "&pagina=" + pagina + "&limite=" + limite;
    const result = await getBling(access_token, path);
    return res.status(result.status).json(result.body);
  } catch (e) {
    return res.status(500).json({ erro: "Erro proxy: " + e.message });
  }
}
