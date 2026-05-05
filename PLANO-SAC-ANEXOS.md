# Plano FINAL: SAC pós-venda enviar anexos
**Sessão Ailson 04/05/2026 — pesquisa profunda concluída, pronto pra executar**

---

## 🆕 NOVAS DESCOBERTAS DA SEGUNDA PESQUISA (05/05 madrugada)

### 1. MIME types completos aceitos pelo ML
A doc oficial lista MAIS formatos do que eu tinha (não é só JPG/PNG/PDF/TXT):

| MIME type | Extensão | Uso |
|---|---|---|
| `text/plain` | .txt | Texto simples |
| `image/png` | .png | Imagem |
| `image/jpeg` | .jpg, .jpeg | Imagem |
| `image/heif`, `image/heic` | .heic | **iPhone (Live Photo)** ← útil pra Sthefany/Cris |
| `application/pdf` | .pdf | PDF |
| `application/msword` | .doc | Word antigo |
| `application/vnd.ms-excel` | .xls | Excel antigo |
| `text/xml`, `application/xml` | .xml | **XML aceito SIM** ← reconsiderar plano NFe |
| `application/octet-stream` | qualquer | Genérico |

**MUITO IMPORTANTE:** XML está na lista! Logo, **podemos enviar XML de NFe direto na mensagem** sem precisar do canal `/packs/{id}/fiscal_documents`. Simplifica muito.

### 2. Bloqueios de mensagem (lista completa)

| Causa | Significado | Mensagem UI |
|---|---|---|
| `blocked_by_cancelled_order` | Pedido cancelado | "Pedido cancelado, não dá pra responder" |
| `blocked_by_buyer` | Comprador bloqueou | "Comprador bloqueou mensagens" |
| `blocked_by_mediation` | Mediação em curso | "Em mediação — use claims" |
| `blocked_by_fulfillment` | Venda Full | "Venda Full — usar fluxo de motivos" |
| `blocked_by_conversation_expired` | 18 meses do pedido | "Conversa expirada (18 meses)" |
| `blocked_by_refund` | Reembolso feito | "Pedido com reembolso" |
| `blocked_by_claim_change_closed` | Troca encerrada | "Troca de produto encerrada" |
| `blocked_by_guest_shops` | mShops guest | "Compra mShops sem cadastro" |
| `blocked_by_deactivated_account` | Conta deletada | "Conta deletada" |
| `blocked_by_restrictions` | Restrição ML | "Restrição ML" |

### 3. Endpoints corretos (com `?tag=post_sale&site_id=MLB`)

- Upload: `POST /messages/attachments?tag=post_sale&site_id=MLB`
- Mensagem: `POST /messages/packs/{PACK_ID}/sellers/{SELLER_ID}?tag=post_sale`

A versão `/marketplace/messages/...` é pra Global Selling (cross-border), não nosso caso.

### 4. Atributo `attachments_validations` na resposta
Quando ML processa anexos, retorna validações:
```json
"attachments_validations": {
  "invalid_size": [],
  "invalid_extension": [],
  "forbidden": [],
  "internal_error": []
}
```
Se algum array vier preenchido, mostrar erro claro.

### 5. HTML básico funciona
- `<a href="url">texto</a>` — link clicável
- Quebras de linha automáticas

### 6. NFe pelo canal alternativo (vantagens)
- ML notifica comprador automaticamente por email
- NFe fica vinculada ao pedido (não anexo solto)
- **Restrições:** não funciona pra Full / cross_docking / xd_drop_off
- **Erro 409** se anexar tipo duplicado

**Decisão:** implementar AMBOS:
- **Padrão (anexar tudo):** funciona sempre, anexo aparece na conversa
- **Alternativo NFe (botão extra):** quando admin quer email automático

---

## ✅ PLANO DE EXECUÇÃO

### FASE 1 — Backend

#### 1.1 Setup
```bash
npm install formidable
```
ESM-compatível, lida com multipart até 25MB sem carregar tudo na memória.

#### 1.2 `api/ml-upload-attachment.js` (novo)

```js
import { supabase, getValidToken, setCors } from './_ml-helpers.js';
import formidable from 'formidable';
import fs from 'fs/promises';

export const config = {
  api: { bodyParser: false },
  maxDuration: 60,
};

const ML_API = 'https://api.mercadolibre.com';

const ACCEPTED_MIMES = [
  'text/plain', 'image/png', 'image/jpeg', 'image/heif', 'image/heic',
  'application/pdf', 'application/msword', 'application/vnd.ms-excel',
  'text/xml', 'application/xml', 'application/octet-stream',
];
const MAX_SIZE = 25 * 1024 * 1024;

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });

  let tmpPath = null;
  try {
    const form = formidable({ maxFileSize: MAX_SIZE });
    const [fields, files] = await form.parse(req);
    
    const conversationId = fields.conversation_id?.[0];
    const file = files.file?.[0];
    if (!conversationId || !file) {
      return res.status(400).json({ error: 'Falta conversation_id ou file' });
    }
    tmpPath = file.filepath;
    
    const mime = file.mimetype || 'application/octet-stream';
    if (!ACCEPTED_MIMES.includes(mime)) {
      return res.status(400).json({
        error: `Formato ${mime} não aceito pelo ML.`,
      });
    }
    
    const { data: conv } = await supabase
      .from('ml_conversations')
      .select('brand')
      .eq('id', conversationId).single();
    if (!conv) return res.status(404).json({ error: 'Conversa não encontrada' });
    
    const token = await getValidToken(conv.brand);
    
    const fileBuffer = await fs.readFile(file.filepath);
    const blob = new Blob([fileBuffer], { type: mime });
    const formData = new FormData();
    formData.append('file', blob, file.originalFilename || 'anexo');
    
    const r = await fetch(
      `${ML_API}/messages/attachments?tag=post_sale&site_id=MLB`,
      { method: 'POST', headers: { 'Authorization': `Bearer ${token}` }, body: formData }
    );
    
    if (!r.ok) {
      const text = await r.text();
      let detail;
      try { detail = JSON.parse(text); } catch { detail = text.slice(0, 300); }
      return res.status(r.status).json({ error: 'Falha upload pro ML', detail });
    }
    
    const result = await r.json();
    const attachmentId = typeof result === 'string' ? result : (result.id || result);
    
    return res.json({
      attachment_id: attachmentId,
      filename: file.originalFilename,
      size: file.size,
      mime,
    });
  } catch (e) {
    if (e?.code === 'LIMIT_FILE_SIZE' || /maxFileSize/i.test(e?.message || '')) {
      return res.status(413).json({ error: 'Arquivo maior que 25MB' });
    }
    return res.status(500).json({ error: e?.message || 'Erro upload' });
  } finally {
    if (tmpPath) { try { await fs.unlink(tmpPath); } catch {} }
  }
}
```

#### 1.3 Atualizar `api/ml-messages-reply.js`

Mudanças mínimas (4):

**A. Aceitar attachments no body (linha 14):**
```js
const { conversation_id, text, sent_via = 'manual', attachments = [] } = req.body;
if (!conversation_id) return res.status(400).json({ error: 'Falta conversation_id' });
if (!text && (!Array.isArray(attachments) || attachments.length === 0)) {
  return res.status(400).json({ error: 'Falta text ou attachments' });
}
```

**B. Garantir text mesmo vazio:** linha do `textoLimpo`:
```js
if (!textoLimpo && attachments.length === 0) {
  return res.status(400).json({ error: 'Texto vazio depois da limpeza' });
}
// Se vazio mas tem anexo, usar 1 espaço (ML exige text não-vazio)
const textoFinal = textoLimpo || ' ';
```

**C. Incluir attachments no body do POST pro ML:**
```js
const bodyPayload = {
  from: { user_id: String(sellerId) },
  to: { user_id: String(buyerId) },
  text: textoFinal,
};
if (Array.isArray(attachments) && attachments.length > 0) {
  bodyPayload.attachments = attachments;
}
// fetch ... body: JSON.stringify(bodyPayload)
```

**D. Tratar `attachments_validations` na resposta:**
```js
const result = await r.json();
const validations = result?.attachments_validations;
if (validations && (
  validations.invalid_size?.length ||
  validations.invalid_extension?.length ||
  validations.forbidden?.length ||
  validations.internal_error?.length
)) {
  return res.status(400).json({ error: 'ML rejeitou anexos', validations });
}
```

#### 1.4 `api/ml-upload-nfe.js` (opcional)

Mesma estrutura mas usa `/packs/{pack_id}/fiscal_documents` e aceita 2 arquivos (pdf + xml). Tratar erros 403 (logística Full) e 409 (NFe duplicada).

---

### FASE 2 — Frontend (`src/MLPosVenda.jsx`)

#### 2.1 Estado novo
```js
const [pendingAttachments, setPendingAttachments] = useState([]);
const [uploadingFile, setUploadingFile] = useState(false);
const [showNfeModal, setShowNfeModal] = useState(false);
```

#### 2.2 Constantes e função upload
```js
const ACCEPTED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'heic', 'heif', 'pdf', 'doc', 'xls', 'txt', 'xml'];
const MAX_SIZE_BYTES = 25 * 1024 * 1024;

const handleAttachFile = async (file) => {
  if (!file) return;
  
  const ext = (file.name || '').split('.').pop().toLowerCase();
  if (!ACCEPTED_EXTENSIONS.includes(ext)) {
    alert(`Formato .${ext} não aceito.\n\nAceitos: ${ACCEPTED_EXTENSIONS.join(', ').toUpperCase()}`);
    return;
  }
  if (file.size > MAX_SIZE_BYTES) {
    const sizeMb = (file.size / 1024 / 1024).toFixed(1);
    alert(`Arquivo ${sizeMb}MB. Limite ML: 25MB.`);
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
      alert('Erro upload: ' + (data.error || `HTTP ${r.status}`));
      return;
    }
    
    setPendingAttachments(prev => [...prev, {
      attachment_id: data.attachment_id,
      filename: data.filename,
      size: data.size,
      mime: data.mime,
    }]);
  } catch (e) {
    alert('Erro de rede: ' + e.message);
  } finally {
    setUploadingFile(false);
  }
};

const removeAttachment = (id) => {
  setPendingAttachments(prev => prev.filter(a => a.attachment_id !== id));
};
```

#### 2.3 sendReply atualizado
```js
const sendReply = async () => {
  if ((!replyText.trim() && pendingAttachments.length === 0) || !selected || sending) return;
  setSending(true);
  
  try {
    const r = await fetch('/api/ml-messages-reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversation_id: selected.id,
        text: replyText.trim(),
        sent_via: pendingAttachments.length > 0 ? 'manual_attach' : 'manual',
        attachments: pendingAttachments.map(a => a.attachment_id),
      }),
    });
    
    if (r.ok) {
      setReplyText('');
      setPendingAttachments([]);
      fetchMsgs(selected);
      fetchConvs();
    } else {
      const e = await r.json().catch(() => ({}));
      if (e.validations) {
        const erros = [];
        if (e.validations.invalid_size?.length) erros.push('Tamanho inválido');
        if (e.validations.invalid_extension?.length) erros.push('Extensão inválida');
        if (e.validations.forbidden?.length) erros.push('Anexo proibido');
        if (e.validations.internal_error?.length) erros.push('Erro interno ML');
        alert('ML rejeitou anexo:\n' + erros.join('\n'));
      } else {
        const detalhe = e.detail?.message || e.detail?.error 
          || (typeof e.detail === 'string' ? e.detail : null)
          || (e.detail ? JSON.stringify(e.detail).slice(0, 200) : null)
          || e.error || `HTTP ${r.status}`;
        alert(`Erro ao enviar pro ML:\n\n${detalhe}`);
      }
    }
  } catch (e) {
    alert('Erro de rede: ' + e.message);
  } finally {
    setSending(false);
  }
};
```

#### 2.4 UI

Acima do textarea (chips de anexos pendentes):
```jsx
{pendingAttachments.length > 0 && (
  <div style={{
    display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8,
    padding: 8, background: '#f7f4f0', borderRadius: 6,
  }}>
    {pendingAttachments.map(a => {
      const sizeKb = (a.size / 1024).toFixed(0);
      const isImg = (a.mime || '').startsWith('image/');
      return (
        <div key={a.attachment_id} style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: 'white', border: '1px solid #ddd',
          borderRadius: 6, padding: '4px 8px', fontSize: 12,
        }}>
          <span>{isImg ? '🖼️' : '📎'} {a.filename}</span>
          <span style={{ color: '#888', fontSize: 10 }}>{sizeKb}KB</span>
          <button onClick={() => removeAttachment(a.attachment_id)} style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: '#c0392b', padding: 0, marginLeft: 4,
            fontWeight: 700, fontSize: 14,
          }} title="Remover">✕</button>
        </div>
      );
    })}
  </div>
)}
```

Botões "Anexar" + "NFe" próximo do botão Enviar:
```jsx
<label style={{
  background: '#f7f4f0', padding: '6px 10px',
  borderRadius: 6, cursor: uploadingFile ? 'wait' : 'pointer',
  fontSize: 12, fontWeight: 600,
  display: 'inline-flex', alignItems: 'center', gap: 4,
  opacity: uploadingFile ? 0.5 : 1,
  border: '1px solid #ddd',
}}>
  {uploadingFile ? '⏳ Enviando…' : '📎 Anexar'}
  <input type="file"
    accept=".jpg,.jpeg,.png,.heic,.heif,.pdf,.doc,.xls,.txt,.xml"
    onChange={e => {
      const f = e.target.files?.[0];
      if (f) handleAttachFile(f);
      e.target.value = '';  // permite reanexar mesmo arquivo
    }}
    style={{ display: 'none' }}
    disabled={uploadingFile}
  />
</label>

<button onClick={() => setShowNfeModal(true)} style={{
  background: '#f7f4f0', padding: '6px 10px',
  borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600,
  border: '1px solid #ddd',
}}>📋 NFe (canal oficial)</button>
```

#### 2.5 Componente ModalEnviarNfe
(Ver código completo no plano original — sem mudanças)

---

## ⚠️ ATENÇÕES CRÍTICAS

### Vercel
1. **`bodyParser: false` + `maxDuration: 60`** no config — sem isso, body limitado em 4.5MB.
2. **Cold start** 5-10s na primeira req.

### ML API
3. **`site_id=MLB` hardcoded** OK por ora. Se abrir Argentina/México, refatorar.
4. **Rate limit 500 req/min** compartilhado. Throttle 200ms entre uploads se necessário.
5. **`tag=post_sale` é OBRIGATÓRIO** no querystring.
6. **Texto vazio com anexo:** mandar 1 espaço pra evitar erro.

### Conversa
7. **10 motivos de bloqueio** — tratar todos com mensagem clara.
8. **Conversa expirada (18 meses)** — bloquear UI antes de tentar enviar.

### Performance/UX
9. **Validar client-side ANTES** do upload — poupa banda.
10. **Reset `e.target.value = ''`** pra permitir reanexar mesmo arquivo.

### NFe
11. Sem pack_id → modal NFe mostra erro antes de tentar.
12. **Erro 409 conflict** — orientar admin remover pelo painel ML.
13. **Email automático** SÓ no canal `/fiscal_documents`, não em mensagem com XML.

### Segurança
14. **Sem auth nos endpoints novos** — herdar abordagem do `ml-messages-reply.js`. **TODO futuro:** validar perfil 'sac'.

---

## 📋 CHECKLIST

### Backend
- [ ] `npm install formidable`
- [ ] Criar `api/ml-upload-attachment.js`
- [ ] Atualizar `api/ml-messages-reply.js` (4 mudanças A/B/C/D)
- [ ] Criar `api/ml-upload-nfe.js`

### Frontend `src/MLPosVenda.jsx`
- [ ] 3 states (pendingAttachments, uploadingFile, showNfeModal)
- [ ] Constantes ACCEPTED_EXTENSIONS, MAX_SIZE_BYTES
- [ ] `handleAttachFile` + `removeAttachment`
- [ ] sendReply (atualizar)
- [ ] UI: chips anexos pendentes
- [ ] UI: botão "📎 Anexar"
- [ ] UI: botão "📋 NFe"
- [ ] Componente `ModalEnviarNfe`

### Testes
- [ ] JPG simples + texto
- [ ] 3 anexos numa msg
- [ ] PDF 24MB → passa
- [ ] PDF 30MB → erro client-side
- [ ] .exe → erro client-side
- [ ] Só anexo, sem texto
- [ ] Remover anexo do chip
- [ ] Reanexar mesmo arquivo
- [ ] HEIC do iPhone
- [ ] Conversa cancelada (403)
- [ ] Modal NFe sucesso
- [ ] Modal NFe duplicada (409)
- [ ] Modal NFe Full (403)

### Pós-deploy
- [ ] Avisar Sthefany / Cris / Gabrielly / Ingrid

---

## ⏱ ESTIMATIVA

- Backend (3 endpoints): 1h30
- Frontend: 2h
- Testes: 1h
- **Total: 4-5 horas**

Sem dependência SQL — pode ir direto.

## ✨ DIFERENCIAL DESTE PLANO V2

- MIME types completos (HEIC iPhone, XML, DOC, XLS — não só PDF/JPG/PNG/TXT)
- 10 bloqueios de conversa pra tratar
- `attachments_validations` na resposta ML
- `?tag=post_sale` confirmado obrigatório
- 14 atenções críticas (vs 10 do V1)
- Pronto pra executar sem reabrir doc ML
