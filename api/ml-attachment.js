/**
 * ml-attachment.js — Proxy pra baixar attachment do ML (imagens em mensagens)
 *
 * ML serve attachments em /messages/attachments/{filename}?tag=post_sale com
 * Authorization Bearer. Frontend não pode chamar direto (precisa do token
 * armazenado no Supabase). Esse endpoint busca via token e faz stream pro
 * navegador.
 *
 * GET /api/ml-attachment?filename={f}&conversation_id={id}
 *   → retorna o arquivo (image/*, application/pdf, etc) com header correto
 */
import { supabase, getValidToken, setCors } from './_ml-helpers.js';

const ML_API = 'https://api.mercadolibre.com';

export default async function handler(req, res) {
  try {
    setCors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).end();

    const { filename, conversation_id } = req.query;
    if (!filename || !conversation_id) {
      return res.status(400).json({ error: 'filename + conversation_id required' });
    }

    const { data: conv, error } = await supabase
      .from('ml_conversations')
      .select('brand')
      .eq('id', conversation_id)
      .single();
    if (error || !conv) return res.status(404).json({ error: 'Conversa não encontrada' });

    const token = await getValidToken(conv.brand);

    // ML attachment endpoint
    const url = `${ML_API}/messages/attachments/${encodeURIComponent(filename)}?tag=post_sale&site_id=MLB`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

    if (!r.ok) {
      const errText = await r.text().catch(() => '');
      console.error('[ml-attachment] ML API erro:', r.status, errText.slice(0, 200));
      return res.status(r.status).json({
        error: 'Falha ao baixar do ML',
        status: r.status,
        detail: errText.slice(0, 200),
      });
    }

    // Forward content-type e bytes
    const ct = r.headers.get('content-type') || 'application/octet-stream';
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader('Content-Type', ct);
    res.setHeader('Cache-Control', 'private, max-age=3600'); // cache 1h client-side
    return res.status(200).send(buf);
  } catch (e) {
    console.error('[ml-attachment]', e.message);
    return res.status(500).json({ error: e.message });
  }
}
