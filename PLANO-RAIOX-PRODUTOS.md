# Sprint Raio-X Produtos (Módulo Lojas)

**Sessão Ailson 05/05/2026 — pronto pra executar (aguardando confirmação final)**

---

## 🎯 Objetivo

Criar uma aba "Produtos" no módulo Lojas (admin only) que funcione como **raio-x da loja física**, paralelo ao módulo Bling (que é pra marketplaces).

## 🧱 Princípio: ISOLAMENTO TOTAL

> "Quero fazer um arquivo separado pra não correr risco de mexer no código do módulo lojas (pras vendedoras não pararem)"

**Zero alterações** em:
- `Lojas_Telas_Vendedora.jsx`
- `Lojas_Telas_Admin.jsx`
- `Lojas_Shared.jsx`
- `lojas-ia.js`
- Tabelas existentes (`lojas_vendas`, `lojas_vendas_itens`, `lojas_produtos`)

**Arquivos NOVOS apenas:**
```
sql/lojas-produtos-raiox.sql                  ← 4 views (3 normais + 1 materialized)
api/lojas-produtos-raiox.js                   ← endpoint principal
api/lojas-produtos-raiox-refresh.js           ← cron diário pra refresh materialized
src/Lojas_Telas_Produtos.jsx                  ← componente isolado
```

**Mudanças MÍNIMAS** em:
- `src/Lojas.jsx` — adicionar 1 botão "Produtos" no header admin + roteamento (~5 linhas)
- `vercel.json` — adicionar 1 cron (madrugada)

---

## 📊 4 painéis

### Painel 1: Top 30 vendidas (45d)
```sql
SELECT ref, SUM(qtd) AS pecas
FROM lojas_vendas_itens
WHERE data_venda >= CURRENT_DATE - 45
GROUP BY ref ORDER BY pecas DESC LIMIT 30
```
Hidrata com `lojas_produtos` pra descrição/categoria + `resolverFotoUrl` no front pra foto.

### Painel 2: Top primeira compra (45d) — toggle Geral / Vesti
**Geral (15):**
- Pra cada cliente, pega a **primeira venda** no período
- Lista refs dessas primeiras vendas, conta, ordena

**Vesti (15):**
- Mesma lógica, mas filtra `lojas_vendas.canal_origem = 'vesti'`
- Mesmo limite (15) que Geral — Ailson 05/05/2026

UI: **toggle button** [Geral] [Vesti] alterna a lista.

### Painel 3: Top recompra (90d)
- Conta ocorrências de `(ref, cliente_id)` (cada compra é uma ocorrência distinta)
- "Recompra" = ref que aparece em múltiplas compras do mesmo cliente OU múltiplos clientes recorrentes
- **Decisão de critério:** ordenar por COUNT total de aparições (= mais "girada")

### Painel 4: Top matches
**Funcionalidade:** dropdown pra escolher 1 ref → mostra refs que mais aparecem junto.

**Lógica:**
- Domínio: top 30 refs mais vendidas (45d)
- Janela: 90d
- Co-ocorrência: mesmo `numero_pedido + loja` (= mesma compra)
- Mínimo: 5 coocorrências
- Métrica: `% das compras da ref X que tem a ref Y` ordenado DESC

UI:
```
Selecione uma ref: [▼ REF 1871]
Clientes que compraram 1871 também compraram:
🖼 REF 395  → 28%  (12 compras junto)
🖼 REF 2920 → 18%  (8 compras junto)
...
```

---

## 🗂️ Schema das views

### `vw_lojas_top_vendidas_45d`
```sql
SELECT 
  i.ref,
  SUM(i.qtd) AS pecas,
  COUNT(DISTINCT i.cliente_id) AS clientes_distintos,
  ROW_NUMBER() OVER (ORDER BY SUM(i.qtd) DESC) AS posicao,
  p.descricao, p.categoria
FROM lojas_vendas_itens i
LEFT JOIN lojas_produtos p ON p.ref = i.ref
WHERE i.data_venda >= CURRENT_DATE - 45
GROUP BY i.ref, p.descricao, p.categoria
ORDER BY pecas DESC
LIMIT 30;
```

### `vw_lojas_primeira_compra_45d`
```sql
WITH primeira_venda AS (
  SELECT DISTINCT ON (cliente_id)
    id AS venda_id, cliente_id, canal_origem
  FROM lojas_vendas
  WHERE data_venda >= CURRENT_DATE - 45
    AND cliente_id IS NOT NULL
  ORDER BY cliente_id, data_venda ASC
)
SELECT i.ref, pv.canal_origem, COUNT(*) AS aparicoes
FROM primeira_venda pv
JOIN lojas_vendas_itens i ON i.venda_id = pv.venda_id
GROUP BY i.ref, pv.canal_origem;
```
(Frontend filtra Geral vs Vesti via `canal_origem`)

### `vw_lojas_recompra_90d`
```sql
SELECT 
  i.ref,
  COUNT(*) AS ocorrencias,
  COUNT(DISTINCT i.cliente_id) AS clientes_distintos
FROM lojas_vendas_itens i
WHERE i.data_venda >= CURRENT_DATE - 90
  AND i.cliente_id IS NOT NULL
GROUP BY i.ref
HAVING COUNT(*) >= 2  -- mínimo pra contar como recompra
ORDER BY ocorrencias DESC
LIMIT 15;
```

### `mv_lojas_matches_90d` (MATERIALIZED)
```sql
WITH top_refs AS (
  SELECT ref FROM vw_lojas_top_vendidas_45d
),
compras_top AS (
  SELECT i.numero_pedido, i.loja, i.ref AS ref_top, i.data_venda
  FROM lojas_vendas_itens i
  WHERE i.ref IN (SELECT ref FROM top_refs)
    AND i.data_venda >= CURRENT_DATE - 90
),
total_compras_por_top AS (
  SELECT ref_top, COUNT(DISTINCT (numero_pedido, loja)) AS total_compras
  FROM compras_top
  GROUP BY ref_top
)
SELECT 
  ct.ref_top,
  i2.ref AS ref_match,
  COUNT(DISTINCT (ct.numero_pedido, ct.loja)) AS coocorrencias,
  tc.total_compras,
  ROUND(100.0 * COUNT(DISTINCT (ct.numero_pedido, ct.loja)) / tc.total_compras, 1) AS pct
FROM compras_top ct
JOIN lojas_vendas_itens i2 
  ON i2.numero_pedido = ct.numero_pedido 
  AND i2.loja = ct.loja
  AND i2.ref != ct.ref_top
JOIN total_compras_por_top tc ON tc.ref_top = ct.ref_top
GROUP BY ct.ref_top, i2.ref, tc.total_compras
HAVING COUNT(DISTINCT (ct.numero_pedido, ct.loja)) >= 5
ORDER BY ct.ref_top, pct DESC;
```

**Refresh:** `REFRESH MATERIALIZED VIEW mv_lojas_matches_90d;`

**Cron:** todo dia 03:00 BRT (`0 6 * * *`) — hora morta, não bate com importer Drive (5h).

---

## 🌐 Endpoints

### `GET /api/lojas-produtos-raiox?loja=...`
Auth: admin only. Retorna **tudo de uma vez** (4 painéis em 1 request, mais simples).

```json
{
  "top_vendidas": [{ ref, posicao, pecas, descricao, categoria, ... }],
  "primeira_compra": {
    "geral": [...],
    "vesti": [...]
  },
  "recompra": [...],
  "matches": {
    "1871": [{ ref_match, coocorrencias, pct }, ...],
    "395": [...],
    ...
  },
  "ultima_atualizacao_matches": "2026-05-06T03:00:00Z"
}
```
Filtro `loja=BR|ST|todas` aplicado em painéis 1, 2, 3 (matches sempre geral).

### `POST /api/lojas-produtos-raiox-refresh` (cron)
Auth: cron header (`vercel-cron/1.0`) ou `?user=ailson`. Executa `REFRESH MATERIALIZED VIEW`.

---

## 🎨 Frontend `Lojas_Telas_Produtos.jsx`

```jsx
const ProdutosTab = () => {
  const [loja, setLoja] = useState('todas'); // 'todas' | 'BR' | 'ST'
  const [aba, setAba] = useState('vendidas'); // 'vendidas' | 'primeira' | 'recompra' | 'matches'
  const [primeiraTipo, setPrimeiraTipo] = useState('geral'); // toggle dentro de "primeira"
  const [refSelMatch, setRefSelMatch] = useState(null);
  const [data, setData] = useState(null);
  
  // fetch /api/lojas-produtos-raiox?loja={loja}
  // ...
  
  return (
    <div>
      {/* Header: filtro loja */}
      <FiltroLoja value={loja} onChange={setLoja} />
      
      {/* Tabs */}
      <Tabs aba={aba} onChange={setAba} />
      
      {aba === 'vendidas' && <ListaProdutos itens={data.top_vendidas} />}
      {aba === 'primeira' && (
        <>
          <ToggleGeralVesti tipo={primeiraTipo} onChange={setPrimeiraTipo} />
          <ListaProdutos itens={data.primeira_compra[primeiraTipo]} />
        </>
      )}
      {aba === 'recompra' && <ListaProdutos itens={data.recompra} />}
      {aba === 'matches' && (
        <>
          <DropdownRef refs={data.top_vendidas} value={refSelMatch} onChange={setRefSelMatch} />
          {refSelMatch && <ListaMatches matches={data.matches[refSelMatch]} />}
        </>
      )}
    </div>
  );
};
```

**Componente `ListaProdutos`** (reusável): card com foto + posição + ref + descrição + categoria + métrica.

---

## 🔌 Adicionar botão no Lojas.jsx (mudança mínima)

```jsx
// No header admin, junto dos outros tabs:
{state.isAdmin && (
  <button onClick={() => setActiveTab('produtos')}>📊 Produtos</button>
)}

// No render:
{activeTab === 'produtos' && state.isAdmin && (
  <ProdutosTab />  // import de ./Lojas_Telas_Produtos.jsx
)}
```

---

## ✅ Riscos analisados

| Risco | Mitigação |
|-------|-----------|
| Cron quebrar produção | Endpoint isolado `lojas-produtos-raiox-refresh.js`, isolado dos crons IA/Drive |
| Materialized view pesada na 1ª criação | Tabelas têm índices; primeira execução pode demorar 30-60s mas só 1x |
| Refresh diário gera lock | `REFRESH MATERIALIZED VIEW CONCURRENTLY` precisa unique index — vou criar |
| Dados começam só em 01/03/2026 | Janela 90d cobre tudo. View calcula "what's there" |
| `lojas_produtos` não tem foto | Frontend usa `resolverFotoUrl(ref)` (já testado, busca bucket Storage) |
| Botão admin só pra admin | Já protegido via `state.isAdmin` (mesmo padrão dos outros) |

---

## 📋 Checklist de execução

1. **SQL:** `sql/lojas-produtos-raiox.sql` (4 views + unique index)
2. **Backend:** endpoint principal + endpoint refresh
3. **Frontend:** componente isolado + botão no Lojas.jsx
4. **Cron:** registrar em vercel.json
5. **Roda primeira refresh manual** pra popular materialized view
6. **Testes:** abrir tela, validar com dados reais

---

## ⏱️ Estimativa

- SQL: 30 min
- Backend: 30 min
- Frontend: 1h30 (4 painéis + filtros + dropdown matches)
- Setup cron: 15 min
- Testes manuais: 30 min
- **Total: ~3h30**

---

## 🚦 Pode rodar?

Confirmação dos pontos finais:
1. ✅ Top matches via dropdown (opção A)
2. ✅ Toggle Geral/Vesti em primeira compra
3. ✅ Cron diário 03:00 BRT
4. ✅ Matches sempre geral (não filtra loja)

**Falta só você dar o "vai".** Posso começar?
