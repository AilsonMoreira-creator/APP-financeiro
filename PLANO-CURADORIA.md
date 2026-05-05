# Plano: Curadoria Mostrar Manual + Automático
**Sessão Ailson 04/05/2026 (planejamento) — execução amanhã**

## 🎯 OBJETIVO

Hoje a tela de Curadoria de Produtos (CuradoriaScreen) mostra SÓ os produtos manuais. A IA recebe automáticos por trás (vw_lojas_top_vendas_loja_fisica) sem o admin saber. Ailson pediu visibilidade total + poder excluir automáticos específicos.

**Decisões fechadas com Ailson:**
- Q1: Excluir automático = some até reativar manualmente (opção B)
- Q2: Diferenciação visual livre, mas tem que estar escrito **MANUAL** e **AUTOMÁTICO**
- Q3: Em alta = top 30 dos últimos 30 dias, **só físico** (não marketplace)
- Duplicata manual+auto = mostra só manual (ganha)

---

## 🔍 DIAGNÓSTICO ATUAL (auditado nesta sessão)

### Tabelas / colunas que existem
- `lojas_produtos.data_entrega_oficina` (DATE) — coluna existe, mas **NULL pra todos os produtos**. Pipeline nunca preencheu.
- `lojas_produtos.novidade_inicia_em` / `novidade_termina_em` — também NULL pra todos.
- `lojas_produtos_curadoria` — tabela ativa com manuais (best_seller, em_alta, novidade_manual, cores)
- `vw_lojas_top_vendas_loja_fisica` — existe, ATIVA. Hoje usa **45 dias** + curva A (top 10) + curva B (11-20). Só físico Mire (lojas_vendas_itens).

### Onde estão os dados de "novidade da oficina"
- Em `amicia_data` user_id=`ailson_cortes`, payload.cortes (253 cortes)
- Estrutura confirmada por amostra:
  ```json
  {
    "id": 1774537780753,
    "ref": "2601",
    "entregue": true,
    "dataEntrega": "27/03/2026",   // formato BR DD/MM/YYYY
    "qtdEntregue": 176,
    "marca": "Meluni"
  }
  ```
- `dataEntrega` é STRING formato BR (precisa converter pra ISO)

### Como a IA hoje classifica produtos (lojas-ia.js linha 1290)
```js
if (motivo === 'novidade_oficina' || curNov.has(p.ref)) {
  out.novidades.push(item);  // <- nunca cai no primeiro porque data_entrega_oficina=NULL
}
```
- `curNov` = curadoria manual (funciona)
- `motivo='novidade_oficina'` viria da view `vw_lojas_produtos_oferecveis` que precisa de `data_entrega_oficina` populado — **mas está NULL pra todo mundo**, logo nunca dispara
- **Confirmação da suspeita do Ailson:** novidade automática nunca rodou

### Em alta automática (linha 442-453)
```js
.from('vw_lojas_top_vendas_loja_fisica')
.in('curva', ['a', 'b'])
.limit(20);
bestSellersAuto = curva A (top 10);
emAltaAuto     = curva B (11-20);
```
- Funciona, mas com 45d e 20 produtos. Ailson quer 30d e top 30.

---

## 📐 PLANO DE EXECUÇÃO (amanhã)

### FASE 1 — SQL (rodar no Supabase antes do deploy)

#### 1.1 Tabela de exclusões
```sql
CREATE TABLE IF NOT EXISTS lojas_curadoria_exclusoes (
  ref         TEXT NOT NULL,
  tipo        TEXT NOT NULL CHECK (tipo IN ('novidade_manual', 'em_alta', 'best_seller')),
  excluida_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  excluida_por TEXT,
  motivo      TEXT,
  PRIMARY KEY (ref, tipo)
);

CREATE INDEX IF NOT EXISTS idx_curadoria_exclusoes_tipo
  ON lojas_curadoria_exclusoes(tipo);

COMMENT ON TABLE lojas_curadoria_exclusoes IS
  'Refs que foram excluídos manualmente da curadoria automatica. Ate que admin reative, nao aparecem como sugestao automatica.';
```

#### 1.2 Atualizar view top vendas (de 45d/20 pra 30d/30)
```sql
-- Primeiro verificar se a view atual ainda é usada além do lojas-ia.js
-- (provavelmente sim — checar antes de alterar!). Se sim, criar view NOVA
-- separada pra não quebrar:

CREATE OR REPLACE VIEW vw_lojas_em_alta_auto AS
WITH agregado AS (
  SELECT
    ref,
    SUM(qtd)                                AS pecas_30d,
    SUM(liquido_unit * qtd)                 AS receita_30d,
    COUNT(DISTINCT numero_pedido)           AS pedidos_30d,
    MAX(data_venda)                         AS ultima_venda
  FROM lojas_vendas_itens
  WHERE data_venda >= CURRENT_DATE - INTERVAL '30 days'
    AND ref IS NOT NULL AND ref != ''
    AND loja IN ('Silva Teles', 'Bom Retiro')   -- só físico, NUNCA marketplace
  GROUP BY ref
)
SELECT
  ref,
  pecas_30d,
  receita_30d,
  pedidos_30d,
  ultima_venda,
  ROW_NUMBER() OVER (ORDER BY pecas_30d DESC) AS posicao
FROM agregado
ORDER BY pecas_30d DESC
LIMIT 30;

COMMENT ON VIEW vw_lojas_em_alta_auto IS
  'Top 30 REFs vendidos na loja fisica nos ultimos 30 dias. Sprint curadoria 05/05/2026.';
```

#### 1.3 View novidades automáticas (calcula dinâmico do payload)
```sql
-- IMPORTANTE: lê amicia_data.payload.cortes (user_id='ailson_cortes')
-- dataEntrega vem como string BR "DD/MM/YYYY" — precisa converter

CREATE OR REPLACE VIEW vw_lojas_novidades_auto AS
WITH cortes_entregues AS (
  SELECT
    c->>'ref' AS ref,
    -- Converte "DD/MM/YYYY" pra DATE
    TO_DATE(c->>'dataEntrega', 'DD/MM/YYYY') AS data_entrega,
    (c->>'qtdEntregue')::int AS qtd_entregue,
    c->>'marca' AS marca
  FROM amicia_data,
       jsonb_array_elements(payload->'cortes') c
  WHERE user_id = 'ailson_cortes'
    AND (c->>'entregue')::boolean = true
    AND c->>'dataEntrega' IS NOT NULL
    AND c->>'dataEntrega' != ''
    AND c->>'ref' IS NOT NULL
),
mais_recente_por_ref AS (
  -- Se mesma REF tem múltiplos cortes, pega o mais recente
  SELECT DISTINCT ON (ref)
    ref, data_entrega, qtd_entregue, marca
  FROM cortes_entregues
  ORDER BY ref, data_entrega DESC
),
janela_novidade AS (
  SELECT
    r.*,
    CURRENT_DATE - r.data_entrega AS dias_apos_entrega
  FROM mais_recente_por_ref r
  WHERE r.data_entrega IS NOT NULL
    -- Janela: 5-12 dias (12-19 se tiver caseado, mas precisamos do flag — TODO)
    AND CURRENT_DATE - r.data_entrega BETWEEN 5 AND 12
)
SELECT
  jn.ref,
  jn.data_entrega,
  jn.dias_apos_entrega,
  jn.qtd_entregue,
  jn.marca
FROM janela_novidade jn
ORDER BY jn.data_entrega DESC;

COMMENT ON VIEW vw_lojas_novidades_auto IS
  'Refs que entregaram da oficina entre 5 e 12 dias atras. Sprint curadoria 05/05/2026.';
```

**Atenção sobre `tem_caseado`:** lojas_produtos.tem_caseado existe (BOOLEAN). Pra v2, ajustar a janela pra 12-19 dias se tem_caseado=true. Por simplicidade, **v1 é só 5-12 dias pra todo mundo**. Comentário na view já avisa.

---

### FASE 2 — BACKEND

#### 2.1 Novo endpoint: `api/lojas-curadoria-listar.js`
```js
// GET /api/lojas-curadoria-listar?tipo=novidade_manual
//
// Retorna lista MISTA de REFs (manual + automatico) pra tela de Curadoria.
// Aplica regra de duplicata: manual ganha sobre automatico.
//
// Response:
// {
//   tipo: 'novidade_manual',
//   itens: [
//     { ref, descricao, foto_url, origem: 'manual', motivo, adicionado_em, data_fim, id_curadoria },
//     { ref, descricao, foto_url, origem: 'automatica', dias_apos_entrega }   // novidade
//     { ref, descricao, foto_url, origem: 'automatica', posicao, pecas_30d }  // em_alta
//   ]
// }

import { setCors, getSupabaseAdmin, validarUsuario } from './_lojas-helpers.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  const auth = await validarUsuario(req);
  if (!auth.isAdmin) return res.status(403).json({ error: 'Apenas admin' });
  
  const tipo = req.query.tipo || 'novidade_manual';
  const supabase = getSupabaseAdmin();
  
  // 1. Manuais (já existente)
  const hoje = new Date().toISOString().slice(0, 10);
  const { data: manuais } = await supabase
    .from('lojas_produtos_curadoria')
    .select('id, ref, motivo, adicionado_em, data_fim')
    .eq('tipo', tipo)
    .eq('ativo', true)
    .or(`data_fim.is.null,data_fim.gte.${hoje}`);
  
  const refsManuais = new Set((manuais || []).map(m => m.ref));
  
  // 2. Automáticos por tipo
  let automaticos = [];
  if (tipo === 'novidade_manual') {
    // Note: tipo de curadoria é 'novidade_manual', mas auto vem da view
    const { data } = await supabase
      .from('vw_lojas_novidades_auto')
      .select('ref, data_entrega, dias_apos_entrega, qtd_entregue');
    automaticos = (data || []).map(a => ({ ...a, origem: 'automatica' }));
  } else if (tipo === 'em_alta' || tipo === 'best_seller') {
    const { data } = await supabase
      .from('vw_lojas_em_alta_auto')
      .select('ref, posicao, pecas_30d, receita_30d');
    // best_seller = top 10, em_alta = 11-30
    if (tipo === 'best_seller') {
      automaticos = (data || []).filter(d => d.posicao <= 10).map(a => ({ ...a, origem: 'automatica' }));
    } else {
      automaticos = (data || []).filter(d => d.posicao > 10).map(a => ({ ...a, origem: 'automatica' }));
    }
  }
  
  // 3. Excluídos
  const { data: excluidos } = await supabase
    .from('lojas_curadoria_exclusoes')
    .select('ref')
    .eq('tipo', tipo);
  const refsExcluidas = new Set((excluidos || []).map(e => e.ref));
  
  // 4. Filtra: remove auto que tem manual OU está excluído
  const automaticosFiltrados = automaticos.filter(
    a => !refsManuais.has(a.ref) && !refsExcluidas.has(a.ref)
  );
  
  // 5. Hidrata com descrição/foto de lojas_produtos
  const todasRefs = [
    ...(manuais || []).map(m => m.ref),
    ...automaticosFiltrados.map(a => a.ref),
  ];
  const { data: produtos } = await supabase
    .from('lojas_produtos')
    .select('ref, descricao, categoria, qtd_estoque')
    .in('ref', todasRefs);
  const prodMap = new Map((produtos || []).map(p => [p.ref, p]));
  
  // 6. Monta resposta unificada
  const itens = [
    ...(manuais || []).map(m => ({
      ref: m.ref,
      descricao: prodMap.get(m.ref)?.descricao || '(produto não encontrado)',
      origem: 'manual',
      motivo: m.motivo,
      adicionado_em: m.adicionado_em,
      data_fim: m.data_fim,
      id_curadoria: m.id,
    })),
    ...automaticosFiltrados.map(a => ({
      ref: a.ref,
      descricao: prodMap.get(a.ref)?.descricao || '(produto não encontrado)',
      origem: 'automatica',
      dias_apos_entrega: a.dias_apos_entrega || null,
      posicao: a.posicao || null,
      pecas_30d: a.pecas_30d || null,
    })),
  ];
  
  return res.json({ tipo, itens, manuais_count: manuais?.length || 0, auto_count: automaticosFiltrados.length });
}
```

#### 2.2 Novo endpoint: `api/lojas-curadoria-excluir.js`
```js
// POST /api/lojas-curadoria-excluir
// Body: { ref, tipo, motivo? }
// Adiciona ref à lojas_curadoria_exclusoes (some até admin reativar)

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });
  const auth = await validarUsuario(req);
  if (!auth.isAdmin) return res.status(403).json({ error: 'Apenas admin' });
  
  const { ref, tipo, motivo } = req.body || {};
  if (!ref || !tipo) return res.status(400).json({ error: 'ref e tipo obrigatorios' });
  if (!['novidade_manual', 'em_alta', 'best_seller'].includes(tipo)) {
    return res.status(400).json({ error: 'tipo invalido' });
  }
  
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from('lojas_curadoria_exclusoes')
    .upsert({
      ref, tipo, motivo,
      excluida_por: auth.userId,
      excluida_em: new Date().toISOString(),
    }, { onConflict: 'ref,tipo' });
  
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ ok: true });
}
```

#### 2.3 Novo endpoint: `api/lojas-curadoria-reativar.js`
```js
// POST /api/lojas-curadoria-reativar
// Body: { ref, tipo }
// Remove exclusão → ref volta a aparecer como sugestão automatica

export default async function handler(req, res) {
  // ... mesmo padrão
  const { ref, tipo } = req.body;
  await supabase
    .from('lojas_curadoria_exclusoes')
    .delete()
    .eq('ref', ref).eq('tipo', tipo);
  return res.json({ ok: true });
}
```

#### 2.4 Novo endpoint: `api/lojas-curadoria-listar-excluidas.js`
```js
// GET /api/lojas-curadoria-listar-excluidas?tipo=...
// Retorna refs excluídas pra mostrar no modal "Ver excluídos"
```

#### 2.5 Atualizar `lojas-ia.js` (linha 442-453)
**Antes:**
```js
.from('vw_lojas_top_vendas_loja_fisica')
.in('curva', ['a', 'b']).limit(20);
```
**Depois:**
```js
.from('vw_lojas_em_alta_auto')
.select('ref, posicao')
.order('posicao').limit(30);
// best_sellers = posicao <= 10, em_alta = 11-30

// E TAMBÉM excluir as que estão em lojas_curadoria_exclusoes:
const { data: excluidos } = await supabase
  .from('lojas_curadoria_exclusoes')
  .select('ref, tipo');
const setExcluidasBs = new Set(excluidos?.filter(e => e.tipo === 'best_seller').map(e => e.ref));
const setExcluidasAlta = new Set(excluidos?.filter(e => e.tipo === 'em_alta').map(e => e.ref));
const setExcluidasNov = new Set(excluidos?.filter(e => e.tipo === 'novidade_manual').map(e => e.ref));

bestSellersAuto = bestSellersAuto.filter(r => !setExcluidasBs.has(r));
emAltaAuto = emAltaAuto.filter(r => !setExcluidasAlta.has(r));
```

E a view `vw_lojas_produtos_oferecveis` que calcula `motivo_oferta='novidade_oficina'` precisa **NOVA condição**: incluir refs que aparecem em `vw_lojas_novidades_auto`. **MAS** essa view é complexa, melhor:

**Estratégia alternativa (mais simples):** Em `lojas-ia.js`, depois de buscar produtos da view, **adicionar manualmente** os de `vw_lojas_novidades_auto` (igual já faz com bestSellersAuto):

```js
const { data: novidadesAuto } = await supabase
  .from('vw_lojas_novidades_auto')
  .select('ref');
const refsNovidadesAuto = (novidadesAuto || []).map(r => r.ref);
// Filtra excluídas
const refsNovidadesAutoFiltradas = refsNovidadesAuto.filter(r => !setExcluidasNov.has(r));

// E adicionar essas refs em "todasExtras" (linha 466)
const todasExtras = [...new Set([
  ...bestSellersAuto, ...emAltaAuto, ...refsCuradoriaManual,
  ...refsNovidadesAutoFiltradas
])];

// E na lógica de motivo (linha 484), adicionar:
const setNovAuto = new Set(refsNovidadesAutoFiltradas);
// ...
if (tipoCurMan === 'novidade_manual') motivo = 'novidade_oficina';
else if (setNovAuto.has(p.ref)) motivo = 'novidade_oficina';   // NOVO
else if (...)
```

---

### FASE 3 — FRONTEND

#### 3.1 Modificar `CuradoriaScreen` (Lojas_Telas_Admin.jsx linha 1686)

**Mudanças no state:**
```js
const [itensMistos, setItensMistos] = useState([]);     // novo
const [carregando, setCarregando] = useState(false);    // novo
const [verExcluidos, setVerExcluidos] = useState(false); // novo
const [refsExcluidas, setRefsExcluidas] = useState([]); // novo
```

**Substituir leitura de `state.curadoria` por fetch novo:**
```js
useEffect(() => {
  if (activeTab === 'cores') return;  // cores tem fluxo próprio
  setCarregando(true);
  fetch(`/api/lojas-curadoria-listar?tipo=${activeTab === 'novidade_manual' ? 'novidade_manual' : activeTab}`)
    .then(r => r.json())
    .then(d => { setItensMistos(d.itens || []); setCarregando(false); })
    .catch(e => { setCarregando(false); });
}, [activeTab]);
```

**Novo render do item (linha 1846):**
```jsx
const ehAuto = item.origem === 'automatica';

return (
  <div style={{
    background: palette.surface, 
    border: `1px solid ${palette.beige}`,
    borderLeft: `3px solid ${ehAuto ? palette.inkMuted : tabAtiva.cor}`,  // borda cinza pra auto
    borderRadius: 10, padding: 12, ...
  }}>
    {/* Badge MANUAL ou AUTOMÁTICO no canto superior */}
    <div style={{ position: 'absolute', top: 6, right: 12, ... }}>
      <span style={{
        background: ehAuto ? palette.beigeSoft : palette.warnSoft,
        color: ehAuto ? palette.inkMuted : palette.warn,
        fontSize: 9, fontWeight: 700, letterSpacing: 0.5,
        padding: '2px 6px', borderRadius: 4,
      }}>
        {ehAuto ? 'AUTOMÁTICO' : 'MANUAL'}
      </span>
    </div>
    
    <FotoProdutoLojas refProd={item.ref} size={48} />
    
    <div style={{ flex: 1 }}>
      <div>REF {item.ref}</div>
      <div>{item.descricao}</div>
      
      {/* Info contextual diferente */}
      {ehAuto && item.dias_apos_entrega && (
        <div style={{ fontSize: 12, color: palette.inkSoft }}>
          Chegou da oficina há {item.dias_apos_entrega} dias
        </div>
      )}
      {ehAuto && item.posicao && (
        <div style={{ fontSize: 12, color: palette.inkSoft }}>
          {item.posicao}º mais vendida · {item.pecas_30d} peças (30d)
        </div>
      )}
      {!ehAuto && item.motivo && (
        <div style={{ fontStyle: 'italic' }}>{item.motivo}</div>
      )}
    </div>
    
    {/* Botão diferente: 🚫 pra auto, 🗑️ pra manual */}
    <button onClick={() => ehAuto ? excluirAuto(item) : remover(item)}>
      {ehAuto 
        ? <BellOff size={16} title="Não mostrar como sugestão automática" />
        : <Trash2 size={16} title="Remover da curadoria manual" />
      }
    </button>
  </div>
);
```

**Funções novas:**
```js
const excluirAuto = async (item) => {
  if (!confirm(`Remover REF ${item.ref} das sugestões automáticas?\n\nVai sumir até você reativar manualmente em "Ver excluídos".`)) return;
  await fetch('/api/lojas-curadoria-excluir', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-User': state.userId },
    body: JSON.stringify({ ref: item.ref, tipo: activeTab }),
  });
  // Recarrega lista
  setItensMistos(prev => prev.filter(i => i.ref !== item.ref));
};

const reativar = async (ref) => {
  await fetch('/api/lojas-curadoria-reativar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-User': state.userId },
    body: JSON.stringify({ ref, tipo: activeTab }),
  });
  // Recarrega lista de excluídas + lista principal
};
```

**Botão "Ver excluídos" no header:**
```jsx
<div style={{ display: 'flex', gap: 8 }}>
  <button onClick={() => setVerExcluidos(true)}>
    🚫 Ver excluídos
  </button>
  <button onClick={abrirModalAdicionar}>+ Adicionar</button>
</div>
```

**Modal "Ver excluídos":**
```jsx
{verExcluidos && (
  <div onClick={() => setVerExcluidos(false)} style={{ /* overlay */ }}>
    <div onClick={e => e.stopPropagation()}>
      <h3>Refs excluídas de "{tabAtiva.label}"</h3>
      {refsExcluidas.length === 0 && <p>Nenhuma.</p>}
      {refsExcluidas.map(item => (
        <div key={item.ref}>
          <FotoProdutoLojas refProd={item.ref} size={32} />
          REF {item.ref} · {item.descricao}
          <small>Excluída em {fmtData(item.excluida_em)} por {item.excluida_por}</small>
          <button onClick={() => reativar(item.ref)}>↺ Reativar</button>
        </div>
      ))}
    </div>
  </div>
)}
```

---

## ⚠️ ATENÇÕES CRÍTICAS PRA AMANHÃ

1. **NÃO mexer em `vw_lojas_top_vendas_loja_fisica`** — provavelmente outras coisas usam. Criar `vw_lojas_em_alta_auto` NOVA.

2. **`vw_lojas_novidades_auto` precisa de TO_DATE com formato BR.** Cuidado porque algum corte pode ter `dataEntrega` em outro formato (ISO, vazio, malformado). Adicionar try/catch usando regex pra validar antes:
   ```sql
   AND c->>'dataEntrega' ~ '^\d{2}/\d{2}/\d{4}$'
   ```

3. **A query do view busca de TODOS users do amicia_data com cortes** — só queremos `ailson_cortes` (auditado: 253 cortes lá; backup-diario tem outros 253; salas-corte tem 31 mas é OUTRO conceito — corte de tecido). FILTRAR `WHERE user_id = 'ailson_cortes'`.

4. **Recordar regra crítica do Ailson (constituição):** "Sala de Corte = corta tecido. Módulo Oficinas = recebe peças cortadas e entrega à costureira. Pra novidade da oficina sempre ir em **ailson_cortes**, NÃO em salas-corte."

5. **`tem_caseado`:** v1 ignorar (todos com janela 5-12d). Comentário no código avisando que v2 deve ajustar pra 12-19d se tem_caseado=true.

6. **REFs sem zero à esquerda:** o módulo lojas usa REF normalizado sem zero (ex: "2601"). O payload de cortes do amicia_data também usa "2601" (auditado). OK, sem normalização extra.

7. **Excluir do `lojas-ia.js` também:** quando admin exclui um auto da curadoria, **a IA também precisa parar de sugerir esse ref**. Por isso a Fase 2.5 atualiza o endpoint principal.

8. **Cores tab:** mantém comportamento atual (não mexer). A nova lógica é só pras 3 abas: best_seller, em_alta, novidade_manual.

9. **Performance:** `vw_lojas_novidades_auto` faz JSONB unnest em payload que pode crescer. Hoje 253 cortes, ok. Se crescer pra milhares, considerar materializar em tabela física.

---

## 📋 CHECKLIST PRA EXECUÇÃO

### SQL (Ailson roda no Supabase ANTES do deploy)
- [ ] CREATE TABLE lojas_curadoria_exclusoes
- [ ] CREATE VIEW vw_lojas_em_alta_auto (30d/30 produtos)
- [ ] CREATE VIEW vw_lojas_novidades_auto (5-12d cortes ailson_cortes)
- [ ] Validar com queries:
  ```sql
  SELECT COUNT(*) FROM vw_lojas_novidades_auto;  -- deve ter alguns
  SELECT COUNT(*) FROM vw_lojas_em_alta_auto;    -- esperado: 30
  ```

### Backend
- [ ] Criar api/lojas-curadoria-listar.js
- [ ] Criar api/lojas-curadoria-excluir.js
- [ ] Criar api/lojas-curadoria-reativar.js
- [ ] Criar api/lojas-curadoria-listar-excluidas.js
- [ ] Atualizar api/lojas-ia.js (linhas 442-499): trocar fonte top_vendas + filtrar exclusoes + incluir novidades_auto

### Frontend
- [ ] Atualizar CuradoriaScreen pra fetch novo endpoint
- [ ] Renderizar item com badge MANUAL/AUTOMÁTICO
- [ ] Renderizar info contextual diferente por origem
- [ ] Botão excluir auto vs remover manual
- [ ] Botão "Ver excluídos" no header
- [ ] Modal de excluídos com botão reativar

### Testes
- [ ] Aba Novidades: ver manuais + auto da janela 5-12d misturados
- [ ] Aba Em alta: ver manuais + auto top 11-30 misturados
- [ ] Aba Best-seller: ver manuais + auto top 1-10 misturados
- [ ] Excluir um auto → some da lista
- [ ] Abrir "Ver excluídos" → aparece com botão reativar
- [ ] Reativar → volta na lista principal
- [ ] Validar que IA (lojas-ia trigger) também respeita exclusões

---

## 🔚 DETALHE FINAL

Tudo isso resolve o pedido de hoje. Pra completar a curadoria automática 100%, também faltaria:
- Pipeline pra preencher `lojas_produtos.data_entrega_oficina` quando corte é marcado entregue (alternativa: deixar via view dinâmica como fizemos — funciona igual, sem pipeline)
- Considerar `tem_caseado` na janela
- Materializar view se ficar lenta

Mas isso é v2. V1 entrega o que Ailson pediu: **visibilidade + controle de exclusão** sobre os automáticos.

---

## 📌 ATUALIZAÇÃO 04/05/2026 noite (Ailson)

**Decisão revista:** manter `vw_lojas_top_vendas_loja_fisica` existente (45d, top 10 curva A + top 10 curva B). View já está rodando bem:
- 84 REFs distintos vendidos em 45d
- Bom Retiro 1.563 vendas + Silva Teles 1.439 = só físico ✅
- REF 376 lidera com 407 peças

**O que muda no plano:**
1. ❌ NÃO criar `vw_lojas_em_alta_auto` — usar `vw_lojas_top_vendas_loja_fisica` direto
2. **Em alta** = curva B (10 REFs) — não 30
3. **Best-seller** = curva A (10 REFs) — não 10 (mantém igual)
4. Endpoint `lojas-curadoria-listar` busca da view existente:
   ```js
   const { data: topVendas } = await supabase
     .from('vw_lojas_top_vendas_loja_fisica')
     .select('ref, curva, posicao_ranking, pecas_45d')
     .in('curva', ['a', 'b']);
   if (tipo === 'best_seller') {
     automaticos = topVendas.filter(d => d.curva === 'a');
   } else if (tipo === 'em_alta') {
     automaticos = topVendas.filter(d => d.curva === 'b');
   }
   ```
5. **Info contextual no card auto:** "10º mais vendida · 119 peças (45d)"
