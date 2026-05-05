# Plano: SAC pós-venda enviar anexos (foto / PDF / XML)
**Sessão Ailson 04/05/2026 (planejamento) — execução amanhã**

## 🎯 OBJETIVO

No módulo SAC, na aba Pós-Venda (MLPosVenda.jsx), permitir anexar arquivos junto da resposta texto. Foto/PDF pra mensagem comum + XML/NFe via canal correto do ML.

---

## 🔍 ESTADO ATUAL AUDITADO

### Onde está
- `src/MLPosVenda.jsx` (538 linhas) — componente da aba Pós-Venda
- Função `sendReply` linha 129 — envia SÓ texto hoje
- Endpoint `api/ml-messages-reply.js` — só processa text plain

### O que já existe pronto
- Renderização de attachments DE LEITURA (linha 336): mensagens recebidas do cliente que têm anexo aparecem com link clicável `📄 anexo.pdf` que chama `/api/ml-attachment?filename=...&conversation_id=...`
- Conversas têm `seller_id` + `buyer_id` resolvidos (com fallback automático)
- `pack_id` salvo na tabela `ml_conversations`

### O que falta
- Botão "📎 Anexar" no editor de resposta
- Upload pro ML (pega ID do anexo)
- Mandar IDs no `attachments` do POST de mensagem
- Exibir anexo escolhido enquanto edita (com botão "X" pra remover)
- **Caso especial NFe XML**: usar endpoint diferente (`/packs/.../fiscal_documents`)

---

## 📚 API ML CONFIRMADA (busca web 04/05/2026)

### Fluxo padrão (foto/PDF/TXT)

**Passo 1 — Upload do arquivo:**
```
POST https://api.mercadolibre.com/messages/attachments?tag=post_sale&site_id=MLB
Authorization: Bearer ${access_token}
Content-Type: multipart/form-data

file = <arquivo binario>
```

**Resposta:** `{ id: "415460047_a96d8dea-38cd-4402-938e-80a1c134fc5d.pdf" }`

**Passo 2 — Enviar mensagem com ID(s):**
```
POST https://api.mercadolibre.com/messages/packs/${PACK_ID}/sellers/${SELLER_ID}?tag=post_sale
Authorization: Bearer ${access_token}
Content-Type: application/json

{
  "from": { "user_id": "${SELLER_ID}" },
  "to":   { "user_id": "${BUYER_ID}" },
  "text": "Olá! Segue a foto.",
  "attachments": ["415460047_a96d8dea..."]
}
```

### Limites
| Item | Limite |
|---|---|
| Tamanho máximo | **25 MB por arquivo** |
| Formatos suportados | **JPG, PNG, PDF, TXT** |
| Múltiplos anexos | Sim (array) |
| Rate limit | 500 req/min compartilhado pra POST |

### Caso especial: NFe (XML + PDF DANFE juntos)

**A doc do ML diz claramente:**
> "Este recurso substitui as mensagens automáticas de pós venda e deve ser usado apenas para envio de notas fiscais nos pedidos."

**Endpoint correto pra NFe:**
```
POST https://api.mercadolibre.com/packs/${PACK_ID}/fiscal_documents
Authorization: Bearer ${access_token}
Content-Type: multipart/form-data

fiscal_document = NFe.pdf
fiscal_document = NFe.xml
```

**Resposta:** `{ ids: ["...uuid1", "...uuid2"] }`

**ATENÇÃO:**
- Não é permitido pra logística **fulfillment/cross_docking/xd_drop_off** no Brasil
- Se já tem NFe carregada do mesmo tipo, retorna 409 conflict — precisa remover antes
- ML manda email automaticamente pro comprador notificando

---

## 📐 PLANO DE EXECUÇÃO (amanhã)

### FASE 1 — Backend

#### 1.1 Endpoint upload de anexo: `api/ml-upload-attachment.js`
```js
// POST /api/ml-upload-attachment
// Body: multipart/form-data com 'file' + 'conversation_id' (no querystring ou body)
// Retorna: { attachment_id: "415460047_..." }

import { getValidToken, supabase, setCors } from './_ml-helpers.js';
import formidable from 'formidable';
import fs from 'fs';

export const config = { api: { bodyParser: false } };  // necessário pra multipart

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  // Parse multipart
  const form = formidable({ maxFileSize: 25 * 1024 * 1024 });  // 25MB
  const [fields, files] = await form.parse(req);
  
  const conversationId = fields.conversation_id?.[0];
  const file = files.file?.[0];
  
  if (!conversationId || !file) {
    return res.status(400).json({ error: 'falta conversation_id ou file' });
  }
  
  // Valida extensão (ML aceita só JPG/PNG/PDF/TXT)
  const ext = (file.originalFilename || '').toLowerCase().split('.').pop();
  if (!['jpg', 'jpeg', 'png', 'pdf', 'txt'].includes(ext)) {
    return res.status(400).json({ 
      error: `Formato nao suportado pelo ML (so JPG/PNG/PDF/TXT). Pra XML de NFe, use o botao "Enviar NFe" separado.` 
    });
  }
  
  // Busca conversa pra pegar brand → token
  const { data: conv } = await supabase
    .from('ml_conversations')
    .select('brand')
    .eq('id', conversationId)
    .single();
  if (!conv) return res.status(404).json({ error: 'Conversa nao encontrada' });
  
  const token = await getValidToken(conv.brand);
  
  // Upload pro ML usando FormData nativo
  const fileBuffer = fs.readFileSync(file.filepath);
  const blob = new Blob([fileBuffer], { type: file.mimetype });
  const formData = new FormData();
  formData.append('file', blob, file.originalFilename);
  
  const r = await fetch(
    `https://api.mercadolibre.com/messages/attachments?tag=post_sale&site_id=MLB`,
    {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData,
    }
  );
  
  fs.unlinkSync(file.filepath);  // limpa tmp
  
  if (!r.ok) {
    const detail = await r.json().catch(() => ({}));
    return res.status(r.status).json({ error: 'Falha upload ML', detail });
  }
  
  const result = await r.json();
  // ML retorna { id: "415460047_..." } ou { id: "..." } — verificar
  return res.json({ 
    attachment_id: result.id || result, 
    filename: file.originalFilename,
    size: file.size,
  });
}
```

**Dependência nova:** `formidable` (npm install formidable)

#### 1.2 Atualizar `api/ml-messages-reply.js` pra aceitar attachments
```js
// Adicionar no body parser:
const { conversation_id, text, sent_via = 'manual', attachments = [] } = req.body;

// E no body do POST pro ML:
body: JSON.stringify({
  from: { user_id: String(sellerId) },
  to: { user_id: String(buyerId) },
  text: textoLimpo,
  ...(attachments.length > 0 && { attachments }),  // só inclui se tiver
})
```

Manter retrocompatível — se não vier `attachments`, comportamento igual ao de hoje.

#### 1.3 Endpoint NFe separado: `api/ml-upload-nfe.js`
```js
// POST /api/ml-upload-nfe
// Body multipart: pdf (DANFE) + xml + conversation_id
// Usa endpoint /packs/{pack_id}/fiscal_documents (separado de mensagens)

export default async function handler(req, res) {
  // ... mesmo padrão de parse multipart
  // Espera 2 arquivos: pdf + xml
  
  const conv = await supabase.from('ml_conversations')
    .select('brand, pack_id, seller_id')
    .eq('id', conversationId).single();
  
  if (!conv.pack_id) {
    return res.status(400).json({ error: 'Conversa sem pack_id — impossivel enviar NFe' });
  }
  
  const token = await getValidToken(conv.brand);
  
  const fd = new FormData();
  fd.append('fiscal_document', new Blob([fs.readFileSync(pdf.filepath)], { type: 'application/pdf' }), pdf.originalFilename);
  fd.append('fiscal_document', new Blob([fs.readFileSync(xml.filepath)], { type: 'application/xml' }), xml.originalFilename);
  
  const r = await fetch(
    `https://api.mercadolibre.com/packs/${conv.pack_id}/fiscal_documents`,
    {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: fd,
    }
  );
  
  if (!r.ok) {
    const detail = await r.json().catch(() => ({}));
    // Trata erros conhecidos:
    // - 409 conflict (NFe ja anexada deste tipo)
    // - 403 forbidden (logistica fulfillment/cross_docking)
    return res.status(r.status).json({ error: detail.message || 'Falha NFe', detail });
  }
  
  const result = await r.json();
  return res.json({ ok: true, ids: result.ids });
}
```

---

### FASE 2 — Frontend (`src/MLPosVenda.jsx`)

#### 2.1 Estado novo
```js
const [pendingAttachments, setPendingAttachments] = useState([]);  
// [{ attachment_id, filename, size, uploading: false }]
const [uploadingFile, setUploadingFile] = useState(false);
const [showNfeModal, setShowNfeModal] = useState(false);
```

#### 2.2 Função de upload
```js
const handleAttachFile = async (file) => {
  // Valida tamanho client-side
  if (file.size > 25 * 1024 * 1024) {
    alert('Arquivo muito grande! Limite ML: 25MB');
    return;
  }
  // Valida extensao
  const ext = file.name.split('.').pop().toLowerCase();
  if (!['jpg', 'jpeg', 'png', 'pdf', 'txt'].includes(ext)) {
    if (ext === 'xml') {
      alert('Pra enviar XML de NFe, use o botao "📋 Enviar NFe" (anexa PDF + XML juntos pelo canal correto do ML)');
    } else {
      alert('Formato nao suportado. Use JPG, PNG, PDF ou TXT.');
    }
    return;
  }
  
  setUploadingFile(true);
  const fd = new FormData();
  fd.append('file', file);
  fd.append('conversation_id', selected.id);
  
  try {
    const r = await fetch('/api/ml-upload-attachment', { method: 'POST', body: fd });
    const data = await r.json();
    if (!r.ok) {
      alert('Erro upload: ' + (data.error || 'desconhecido'));
    } else {
      setPendingAttachments(prev => [...prev, {
        attachment_id: data.attachment_id,
        filename: data.filename,
        size: data.size,
      }]);
    }
  } catch (e) {
    alert('Erro rede: ' + e.message);
  } finally {
    setUploadingFile(false);
  }
};

const removeAttachment = (id) => {
  setPendingAttachments(prev => prev.filter(a => a.attachment_id !== id));
};
```

#### 2.3 Modificar `sendReply` pra incluir anexos
```js
const sendReply = async () => {
  if ((!replyText.trim() && pendingAttachments.length === 0) || !selected || sending) return;
  setSending(true);
  
  const r = await fetch('/api/ml-messages-reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      conversation_id: selected.id,
      text: replyText.trim() || ' ',  // ML pode exigir texto não-vazio
      sent_via: 'manual',
      attachments: pendingAttachments.map(a => a.attachment_id),
    }),
  });
  
  if (r.ok) {
    setReplyText('');
    setPendingAttachments([]);  // limpa anexos
    fetchMsgs(selected);
    fetchConvs();
  }
  // ... resto do handler de erro igual
};
```

#### 2.4 UI — área de anexos pendentes + botão upload
```jsx
{/* Mostra anexos pendentes ANTES do textarea */}
{pendingAttachments.length > 0 && (
  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
    {pendingAttachments.map(a => (
      <div key={a.attachment_id} style={{
        display: 'flex', alignItems: 'center', gap: 6,
        background: PALETTE.beigeSoft, borderRadius: 6, padding: '4px 8px',
        fontSize: 12,
      }}>
        📎 {a.filename}
        <button onClick={() => removeAttachment(a.attachment_id)} style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: PALETTE.red, padding: 0, marginLeft: 4,
        }}>✕</button>
      </div>
    ))}
  </div>
)}

{/* Botão "anexar" e "NFe" próximo do textarea */}
<div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
  <label style={{
    background: PALETTE.beigeSoft, padding: '6px 10px', borderRadius: 6,
    cursor: uploadingFile ? 'wait' : 'pointer', fontSize: 12, fontWeight: 600,
    display: 'flex', alignItems: 'center', gap: 4,
    opacity: uploadingFile ? 0.5 : 1,
  }}>
    {uploadingFile ? '⏳ Enviando...' : '📎 Anexar'}
    <input type="file" 
      accept=".jpg,.jpeg,.png,.pdf,.txt"
      onChange={e => e.target.files[0] && handleAttachFile(e.target.files[0])}
      style={{ display: 'none' }}
      disabled={uploadingFile}
    />
  </label>
  
  <button onClick={() => setShowNfeModal(true)} style={{
    background: PALETTE.beigeSoft, padding: '6px 10px', borderRadius: 6,
    cursor: 'pointer', fontSize: 12, fontWeight: 600, border: 'none',
  }}>
    📋 Enviar NFe
  </button>
</div>
```

#### 2.5 Modal NFe (separado)
```jsx
{showNfeModal && (
  <ModalEnviarNfe
    conversation={selected}
    onClose={() => setShowNfeModal(false)}
    onSent={() => { setShowNfeModal(false); fetchMsgs(selected); }}
  />
)}

// Componente ModalEnviarNfe novo:
function ModalEnviarNfe({ conversation, onClose, onSent }) {
  const [pdf, setPdf] = useState(null);
  const [xml, setXml] = useState(null);
  const [sending, setSending] = useState(false);
  
  const enviar = async () => {
    if (!pdf || !xml) {
      alert('Anexe PDF (DANFE) e XML pra enviar a NFe');
      return;
    }
    setSending(true);
    const fd = new FormData();
    fd.append('pdf', pdf);
    fd.append('xml', xml);
    fd.append('conversation_id', conversation.id);
    
    try {
      const r = await fetch('/api/ml-upload-nfe', { method: 'POST', body: fd });
      const data = await r.json();
      if (r.ok) {
        alert('NFe enviada! O ML notifica o comprador automaticamente.');
        onSent();
      } else {
        alert('Erro NFe: ' + (data.error || 'desconhecido'));
      }
    } catch (e) {
      alert('Erro rede: ' + e.message);
    }
    setSending(false);
  };
  
  return (
    <div style={{ /* overlay */ }}>
      <div>
        <h3>📋 Enviar NFe</h3>
        <p style={{ fontSize: 12, color: 'gray' }}>
          ML precisa do PDF (DANFE) E do XML juntos. Notifica comprador por email automaticamente.
        </p>
        
        <label>DANFE (PDF):
          <input type="file" accept=".pdf" onChange={e => setPdf(e.target.files[0])} />
          {pdf && <small>✓ {pdf.name}</small>}
        </label>
        
        <label>XML da NFe:
          <input type="file" accept=".xml" onChange={e => setXml(e.target.files[0])} />
          {xml && <small>✓ {xml.name}</small>}
        </label>
        
        <button onClick={enviar} disabled={sending || !pdf || !xml}>
          {sending ? 'Enviando...' : 'Enviar NFe'}
        </button>
        <button onClick={onClose}>Cancelar</button>
      </div>
    </div>
  );
}
```

---

## ⚠️ ATENÇÕES CRÍTICAS

1. **ML tem rate limit 500 req/min compartilhado pra POSTs.** Upload de anexo gasta 1 req. Mensagem com anexo gasta outra. NFe gasta 1. Pra uso normal de SAC ok, mas se Sthefany ou Cris fizer batch de muitas NFes, pode bater no limite.

2. **Tamanho 25MB.** Validar client-side ANTES de enviar pro nosso endpoint (poupa banda). Cliente mobile pode tentar mandar foto 30MB facilmente.

3. **Erro `invalid_extension`:** ML rejeita XML em mensagem comum. Por isso forçar XML pelo fluxo NFe.

4. **NFe + logística fulfillment/cross_docking/xd_drop_off:** ML retorna 403 forbidden. **Maioria das vendas Amícia é "envio normal"** mas se algum pedido vier com Full, vai falhar — tratar erro 403 com msg clara.

5. **NFe duplicada:** se já anexou PDF, não pode anexar outro PDF do mesmo pack. Erro 409 conflict. Tratar com msg clara.

6. **Vercel serverless tem limite 4.5MB no body por padrão.** Como vamos receber arquivos até 25MB, **precisa configurar `bodyParser: false` + `maxDuration: 60`** no `config` do endpoint:
   ```js
   export const config = {
     api: { bodyParser: false },
     maxDuration: 60,
   };
   ```

7. **`formidable` precisa ser instalado:** `npm install formidable` (verificar se já está nas deps antes; provavelmente não).

8. **A interface mostra anexos enviados** já tem suporte (linha 336 do MLPosVenda) — só precisa que o `fetchMsgs` retraga as mensagens depois do envio (já faz).

9. **Texto vazio com anexo:** ML pode exigir texto não-vazio. Por garantia, se vier vazio, mandar 1 espaço " ". Ou validar e exigir texto.

10. **Sthefany / Cris / Gabrielly / Ingrid usam o SAC.** Notificar elas do novo recurso quando subir.

---

## 📋 CHECKLIST PRA EXECUÇÃO

### Backend
- [ ] `npm install formidable` no projeto
- [ ] Criar `api/ml-upload-attachment.js` (upload normal de imagem/PDF/TXT)
- [ ] Criar `api/ml-upload-nfe.js` (upload NFe pelo canal fiscal_documents)
- [ ] Atualizar `api/ml-messages-reply.js` pra aceitar `attachments` no body

### Frontend (MLPosVenda.jsx)
- [ ] Adicionar state `pendingAttachments`, `uploadingFile`, `showNfeModal`
- [ ] Função `handleAttachFile`
- [ ] Função `removeAttachment`
- [ ] Modificar `sendReply` pra incluir attachments
- [ ] UI de anexos pendentes acima do textarea
- [ ] Botão "📎 Anexar"
- [ ] Botão "📋 Enviar NFe"
- [ ] Componente `ModalEnviarNfe`

### Testes
- [ ] Anexar uma foto JPG e enviar — chega no ML?
- [ ] Anexar um PDF e enviar
- [ ] Anexar arquivo > 25MB → erro client-side
- [ ] Anexar XML → erro com mensagem orientando usar botão NFe
- [ ] Anexar 3 fotos numa mensagem só
- [ ] Remover anexo antes de enviar (botão X)
- [ ] Enviar NFe com PDF + XML
- [ ] Tentar enviar NFe duplicada → erro 409 tratado com msg clara
- [ ] Tentar mandar NFe pra venda Full → erro 403 tratado

---

## ⏱ ESTIMATIVA: 4-5 HORAS

- Backend (3 endpoints): 1h30
- Frontend (componente + modal): 2h
- Testes manuais com SAC real: 1h
- Documentação inline: 30min

Mais simples que curadoria — pode encaixar no mesmo dia se der tempo.
