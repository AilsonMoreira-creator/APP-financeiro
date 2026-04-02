import https from "https";

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
    const { access_token, data_inicial, data_final, pagina = 1, limite = 100 } = body;

    if (!access_token || !data_inicial) {
      return res.status(400).json({ erro: "Faltam access_token ou data_inicial" });
    }

    const df = data_final || data_inicial;
    const path = "/Api/v3/pedidos/vendas?situacaoId=9&dataInicial=" + data_inicial + "&dataFinal=" + df + "&pagina=" + pagina + "&limite=" + limite;
    const result = await getBling(access_token, path);
    return res.status(result.status).json(result.body);
  } catch (e) {
    return res.status(500).json({ erro: "Erro proxy: " + e.message });
  }
}
