// Vercel Serverless Function — proxy para trocar code/refresh_token com o Bling
// Evita CORS: browser → Vercel → Bling

export default async function handler(req, res) {
  // Permitir CORS do próprio domínio
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ erro: "Use POST" });

  try {
    const { client_id, client_secret, grant_type, code, refresh_token, redirect_uri } = req.body;

    if (!client_id || !client_secret || !grant_type) {
      return res.status(400).json({ erro: "Faltam client_id, client_secret ou grant_type" });
    }

    const creds = Buffer.from(`${client_id}:${client_secret}`).toString("base64");

    let bodyParams = `grant_type=${grant_type}`;
    if (grant_type === "authorization_code") {
      if (!code || !redirect_uri) return res.status(400).json({ erro: "Faltam code ou redirect_uri" });
      bodyParams += `&code=${encodeURIComponent(code)}&redirect_uri=${encodeURIComponent(redirect_uri)}`;
    } else if (grant_type === "refresh_token") {
      if (!refresh_token) return res.status(400).json({ erro: "Falta refresh_token" });
      bodyParams += `&refresh_token=${encodeURIComponent(refresh_token)}`;
    }

    const resp = await fetch("https://www.bling.com.br/Api/v3/oauth/token", {
      method: "POST",
      headers: {
        "Authorization": "Basic " + creds,
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
      },
      body: bodyParams,
    });

    const data = await resp.json();

    if (!resp.ok) {
      return res.status(resp.status).json({ erro: "Bling retornou erro", status: resp.status, detalhes: data });
    }

    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ erro: "Erro interno: " + e.message });
  }
}
