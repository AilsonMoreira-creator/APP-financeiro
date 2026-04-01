// Vercel Serverless Function — proxy para trocar code/refresh_token com o Bling
const https = require('https');

function postBling(creds, bodyStr) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'www.bling.com.br',
      path: '/Api/v3/oauth/token',
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + creds,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', (e) => reject(e));
    req.write(bodyStr);
    req.end();
  });
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ erro: "Use POST" });

  try {
    const body = req.body || {};
    const { client_id, client_secret, grant_type, code, refresh_token, redirect_uri } = body;

    if (!client_id || !client_secret || !grant_type) {
      return res.status(400).json({ erro: "Faltam client_id, client_secret ou grant_type", recebido: Object.keys(body) });
    }

    const creds = Buffer.from(client_id + ':' + client_secret).toString("base64");

    let bodyParams = 'grant_type=' + grant_type;
    if (grant_type === "authorization_code") {
      if (!code || !redirect_uri) return res.status(400).json({ erro: "Faltam code ou redirect_uri" });
      bodyParams += '&code=' + encodeURIComponent(code) + '&redirect_uri=' + encodeURIComponent(redirect_uri);
    } else if (grant_type === "refresh_token") {
      if (!refresh_token) return res.status(400).json({ erro: "Falta refresh_token" });
      bodyParams += '&refresh_token=' + encodeURIComponent(refresh_token);
    }

    const result = await postBling(creds, bodyParams);

    return res.status(result.status).json(result.body);

  } catch (e) {
    return res.status(500).json({ erro: "Erro interno no proxy", mensagem: e.message, stack: e.stack });
  }
};
