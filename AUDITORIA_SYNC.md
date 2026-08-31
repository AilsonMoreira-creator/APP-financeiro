# Auditoria de Sincronização — App Financeiro Amicia

**Data:** 07/04/2026  
**Arquivo analisado:** `src/App.tsx` (~6.488 linhas)  
**Escopo:** Fluxo de save/load entre localStorage e Supabase em ambiente multi-device

---

## 1. Resumo Executivo

O sistema de sincronização atual possui **2 bugs críticos** que podem causar perda permanente de dados em cenários multi-device. O principal problema é a função `flushPendente` (linhas 6006–6023), que falsifica timestamps antes da comparação local vs. remoto, e a ausência de checagem do flag `pending_sync` na decisão de qual fonte de dados prevalece.

---

## 2. Arquitetura Atual

### 2.1 Fontes de Dados

| Chave Supabase         | Conteúdo                                           |
|------------------------|----------------------------------------------------|
| `ailson_financeiro`    | Payload principal com 12 campos                    |
| `ailson_cortes`        | Cortes + produtos + oficinas + logTroca (redundante)|
| `salas-corte`          | Módulo independente                                |
| `calc-meluni`          | Módulo independente                                |
| `ficha-tecnica`        | Módulo independente                                |
| `bling-creds`          | Módulo independente                                |

### 2.2 localStorage

| Chave                  | Conteúdo                                           |
|------------------------|----------------------------------------------------|
| `amica_financeiro`     | Cache do payload + campo `_updated` (timestamp)    |
| `amica_pending_sync`   | Flag `"true"` / `"false"` — indica sync pendente   |
| `amica_cortes`         | Cache dos cortes                                   |

### 2.3 Fluxo de Save (3 camadas)

```
Edição do usuário
    │
    ▼
Camada 1: localStorage imediato (salvarLocal)
    │   → Grava payload + _updated: Date.now()
    │   → Seta pending_sync = "true"
    │
    ▼
Camada 2: Supabase com debounce 1.5s (salvarNoSupabase)
    │   → Upsert no Supabase com _updated: Date.now()
    │   → Se sucesso: pending_sync = "false"
    │
    ▼
Camada 3: Flush ao sair (pagehide / visibilitychange → hidden)
        → fetch com keepalive: true
        → Se sucesso: pending_sync = "false"
```

### 2.4 Fluxo de Load

```
App abre
    │
    ▼
Passo 1: Carrega localStorage → exibição instantânea
    │   (dbCarregado = false → auto-save bloqueado)
    │
    ▼
Passo 2 (código atual): flushPendente → envia local pro Supabase
    │
    ▼
Passo 3: Carrega Supabase → compara timestamps → decide vencedor
    │
    ▼
setDbCarregado(true) → auto-save liberado
```

---

## 3. Bugs Encontrados

### 3.1 BUG CRÍTICO — `flushPendente` falsifica timestamps

**Localização:** `src/App.tsx`, linhas 6006–6023

```javascript
const flushPendente = async () => {
  const pendente = localStorage.getItem("amica_pending_sync");
  const localRaw = localStorage.getItem("amica_financeiro");
  if (pendente === "true" && localRaw) {
    const localData = JSON.parse(localRaw);
    const payloadUp = {...localData, _updated: Date.now()}; // ← PROBLEMA
    await supabase.from('amicia_data').upsert({
      user_id: USER_ID, payload: payloadUp
    }, {onConflict: 'user_id'});
    // Atualiza localStorage com timestamp falsificado
    localStorage.setItem("amica_financeiro", JSON.stringify(payloadUp));
  }
};
```

**Problema:** Antes de comparar local vs. remoto, essa função:
1. Lê dados locais (possivelmente velhos, de horas/dias atrás)
2. Substitui `_updated` por `Date.now()` — fazendo dados velhos parecerem novos
3. Envia pro Supabase — **sobrescreve dados potencialmente mais recentes de outro device**
4. Atualiza localStorage com o timestamp falsificado

**Cenário de perda de dados:**

| Passo | Ação | Supabase `_updated` |
|-------|------|---------------------|
| 1 | MacBook edita às 23h, fecha (keepalive falha) | T0 (antigo) |
| 2 | Fábrica edita às 08h do dia seguinte | T2 (08:00) |
| 3 | MacBook abre às 09h → `flushPendente` roda | **T3 (09:00)** ← dados de ontem com timestamp de hoje |
| 4 | Comparação: localTs(T3) > remoteTs(T3, acabou de subir) | Local "vence" |
| 5 | **Dados da fábrica perdidos permanentemente** | — |

**Severidade:** CRÍTICA  
**Correção:** Remover `flushPendente` completamente.

---

### 3.2 BUG CRÍTICO — Comparação ignora `pending_sync`

**Localização:** `src/App.tsx`, linha 6038

```javascript
if (localTs > remoteTs && localRaw) {
  // Local vence
```

**Problema:** A comparação usa **apenas timestamp**, sem checar se há sync pendente. Isso significa que mesmo quando `pending_sync = "false"` (dados já foram sincronizados), o local pode "vencer" se tiver timestamp maior — o que pode acontecer por:
- `flushPendente` ter falsificado o timestamp (bug #1)
- Diferenças de relógio entre devices

**Correção proposta:**

```javascript
const pendente = localStorage.getItem("amica_pending_sync") === "true";

if (pendente && localTs > remoteTs) {
  // Local vence: edits não sincronizados + timestamp mais recente
  console.log("LOCAL vence: pending + timestamp mais novo");
  // NÃO sobrescreve estado (já carregou do localStorage no Passo 1)
} else {
  // Supabase vence
  console.log("SUPABASE vence");
  // Sobrescreve estado com dados do Supabase
  // Atualiza localStorage
}
```

**Tabela de decisão corrigida:**

| Cenário | pending | localTs vs remoteTs | Vencedor | Correto? |
|---------|---------|---------------------|----------|----------|
| Keepalive falhou, só eu editei | true | local > remote | Local | Sim |
| Keepalive falhou, outro editou depois | true | remote > local | Supabase | Sim |
| Keepalive OK, abro outro device | false | — | Supabase | Sim |
| Nunca editei neste device | false | — | Supabase | Sim |
| Primeiro uso neste device | false | local = 0 | Supabase | Sim |

---

### 3.3 BUG ALTO — keepalive pode falhar com payload > 64KB

**Localização:** `src/App.tsx`, linhas 6226–6231

```javascript
fetch(url, {
  body: JSON.stringify({user_id: USER_ID, payload: payloadComTs}),
  keepalive: true  // limite de 64KB
});
```

**Problema:** A especificação Fetch define um limite de **64KB** para requests com `keepalive: true`. Se o payload JSON exceder esse limite (plausível com 12 campos contendo meses de dados financeiros), o browser **silenciosamente descarta** o request — sem erro, sem log, sem callback.

**Impacto:** O usuário fecha a aba achando que salvou, mas o fetch foi descartado. `pending_sync` fica como `"true"`, e o retry de 30s é a única rede de segurança — mas só funciona se o app for reaberto antes que outro device edite.

**Alternativas:**
- `navigator.sendBeacon` — mesmo limite de 64KB, não resolve
- Comprimir payload com LZ-string antes do envio
- Aceitar a limitação e confiar no retry (abordagem atual)

**Diagnóstico recomendado:** Adicionar log para monitorar tamanho:
```javascript
const size = new Blob([JSON.stringify(payloadComTs)]).size;
console.log('Payload size:', size, 'bytes', size > 65536 ? '⚠️ EXCEDE 64KB' : '✅');
```

---

### 3.4 BUG MÉDIO — useEffect de retry re-registra listeners a cada mudança

**Localização:** `src/App.tsx`, linhas 6215–6265

O useEffect que registra `visibilitychange`, `pagehide`, `setInterval` e `setTimeout` tem **todos os 12 campos** como dependências. Cada vez que o usuário digita algo (após debounce do estado), esse useEffect:

1. Remove listeners antigos
2. Cria novos closures de `flushSave` e `retrySePendente`
3. Re-registra todos os listeners
4. Cria novo `setInterval` e `setTimeout`

**Impacto:** Performance — não causa dados incorretos, mas é desperdício de recursos em cada re-render com mudança de dados.

**Correção sugerida:** Usar refs para os dados em vez de capturar via closure:
```javascript
const dadosRef = useRef(dados);
dadosRef.current = dados;
// useEffect sem os 12 campos nas dependências
// flushSave/retrySePendente leem de dadosRef.current
```

---

### 3.5 BUG BAIXO — Auto-save re-envia dados do Supabase de volta

**Localização:** `src/App.tsx`, linhas 6180–6192

Quando o Supabase vence no load, os `setState` com dados remotos + `setDbCarregado(true)` disparam o auto-save, que re-envia os dados do Supabase de volta para o Supabase. Inofensivo, mas desnecessário.

---

## 4. Análises Solicitadas

### 4.1 Race Condition entre Passo 1 e Passo 2

**Confirmado: não há race condition.** O guard `if(!dbCarregado) return` (linha 6181) no auto-save previne que dados sejam enviados para o Supabase antes do load completar.

Os `setState` do Passo 1 (localStorage) não disparam o auto-save porque `dbCarregado` é `false`. Só após `setDbCarregado(true)` (linha 6079) o auto-save é liberado.

Adicionalmente, no React 18, os `setState` dentro de `.then()` (Promise callback) são batched automaticamente — todos os sets + `setDbCarregado(true)` resultam em um único re-render.

### 4.2 Retry com Dados Stale

**Não há risco de dados stale** no cenário normal. O `retryInicial` (setTimeout 3s) criado antes de `dbCarregado = true` é limpo pelo cleanup do useEffect, e um novo é criado quando o useEffect re-roda com `dbCarregado = true`. Nesse ponto, as closures capturam o estado pós-load.

O `setInterval` de 30s também é recriado com closures atualizadas a cada mudança de dependência (ver bug #4 sobre ineficiência).

### 4.3 Confiabilidade do keepalive

Ver seção 3.3. Resumo: **não é confiável para payloads > 64KB**, e em mobile (especialmente iOS Safari) os eventos `pagehide`/`visibilitychange` podem não disparar consistentemente ao fechar aba.

O mecanismo de retry (30s + visibilitychange visible) é a proteção real.

### 4.4 Riscos do Payload Monolítico

1. **Edição concorrente de campos diferentes causa perda.** MacBook edita `receitasPorMes`, fábrica edita `boletosShared` — quem salvar por último sobrescreve o outro.
2. **Amplificação de writes.** Cada edição de 1 campo envia todos os 12.
3. **Quota de localStorage** (~5-10MB). Pode ser atingida com dados acumulados.
4. **Corrupção por crash.** Se o browser crashar durante `JSON.stringify` + `setItem`, o localStorage pode ficar com JSON truncado.

---

## 5. Correção Recomendada

### Mudança mínima (resolve bugs #1 e #2):

```javascript
// ── LOAD DO SUPABASE NA ABERTURA ───────────────────────────────────────
useEffect(() => {
  if (!supabase) { setDbCarregado(true); return; }

  // Passo 1: carrega localStorage (exibição instantânea)
  // ... (manter como está) ...

  // ❌ REMOVER flushPendente completamente (linhas 6006-6023)
  // ❌ REMOVER flushPendente().then(() => {  (linha 6027)

  // Passo 2: carrega Supabase DIRETAMENTE
  setSyncStatus('loading');
  Promise.all([
    supabase.from('amicia_data').select('payload').eq('user_id', USER_ID).single(),
    supabase.from('amicia_data').select('payload').eq('user_id', 'ailson_cortes').single(),
  ]).then(([{data: df, error: ef}, {data: dc, error: ec}]) => {
    if (!ef && df?.payload) {
      const d = df.payload;
      const localRaw = localStorage.getItem("amica_financeiro");
      const localTs = localRaw ? JSON.parse(localRaw)._updated || 0 : 0;
      const remoteTs = d._updated || 0;
      const pendente = localStorage.getItem("amica_pending_sync") === "true";

      if (pendente && localTs > remoteTs) {
        // ✅ Local vence: edits pendentes + timestamp mais recente
        // Estado já foi setado no Passo 1, não precisa fazer nada
        // Auto-save vai enviar pro Supabase quando dbCarregado = true
        console.log("SYNC: LOCAL vence (pending + timestamp mais novo)");
      } else {
        // ✅ Supabase vence: sobrescreve estado
        console.log("SYNC: SUPABASE vence");
        // ... setState com dados remotos (manter como está) ...
        localStorage.setItem("amica_pending_sync", "false");
      }
    }
    // ... cortes (manter como está) ...
    setDbCarregado(true);
  });
}, []);
```

---

## 6. Recomendações de Arquitetura (Futuro)

### Curto prazo (esforço baixo):
- **Supabase Realtime** — receber mudanças de outros devices em tempo real
- **Log de tamanho do payload** — monitorar se ultrapassa 64KB

### Médio prazo (esforço moderado):
- **Merge por campo** — separar os 12 campos em linhas individuais no Supabase, permitindo sync granular sem conflito
- **Refs para dados no useEffect de retry** — eliminar re-registro de listeners

### Longo prazo (esforço alto):
- **CRDT** (Yjs/Automerge) — merge automático sem conflitos, overkill para o caso atual

---

## 7. Tabela de Bugs — Prioridade

| # | Severidade | Descrição | Linha(s) | Status |
|---|-----------|-----------|----------|--------|
| 1 | CRÍTICA | `flushPendente` falsifica timestamp | 6006–6023 | A corrigir |
| 2 | CRÍTICA | Comparação ignora `pending_sync` | 6038 | A corrigir |
| 3 | ALTA | keepalive falha silenciosamente > 64KB | 6226–6231 | Monitorar |
| 4 | MÉDIA | useEffect re-registra listeners excessivamente | 6215–6265 | Otimizar |
| 5 | BAIXA | Auto-save re-envia dados desnecessariamente | 6180–6192 | Aceitar |

---

*Documento gerado por auditoria automatizada do repositório APP-financeiro.*  
*Branch analisada: `claude/audit-sync-logic-8XGhb`*
