import https from "https";

function postBling(creds, bodyStr) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "www.bling.com.br",
      path: "/Api/v3/oauth/token",
      method: "POST",
      headers: {
        "Authorization": "Basic " + creds,
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
        "Content-Length": Buffer.byteLength(bodyStr)
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
    req.write(bodyStr);
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
    const { client_id, client_secret, grant_type, code, refresh_token, redirect_uri } = body;

    if (!client_id || !client_secret || !grant_type) {
      return res.status(400).json({ erro: "Faltam parametros", keys: Object.keys(body) });
    }

    const creds = Buffer.from(client_id + ":" + client_secret).toString("base64");
    let postBody = "grant_type=" + grant_type;

    if (grant_type === "authorization_code") {
      postBody += "&code=" + encodeURIComponent(code) + "&redirect_uri=" + encodeURIComponent(redirect_uri);
    } else if (grant_type === "refresh_token") {
      postBody += "&refresh_token=" + encodeURIComponent(refresh_token);
    }

    const result = await postBling(creds, postBody);
    return res.status(result.status).json(result.body);
  } catch (e) {
    return res.status(500).json({ erro: "Erro proxy: " + e.message });
  }
}
