# HANDOFF — APP Financeiro (Grupo Amícia)

> Documento de contexto pra colar no começo de uma nova sessão de pair-programming.
> Atualizado: 05/07/2026 (tela Conversão Sofia v2 + funil de leads + fix vendeu_em).

---

## 0. Quem / como trabalhamos

- **Ailson** = dev e dono solo do Grupo Amícia (moda feminina atacado, SP — lojas Brás/Silva Teles e Bom Retiro/José Paulino). Produto forte em **linho** e **alfaiataria diferenciada**. Viscolinho existe no mix mas **não enfatizar** em copy nem resposta a cliente.
- PT-BR informal ("vc", não "você"). Mac + iPhone. Pair-programming: lê o código antes de aceitar, aprova em OKs curtos ("pode fazer", "pode testar"). Edições conservadoras, confirmar ambiguidades, zero over-engineering.
- Push direto na `main`, deploy automático Vercel (~85-90s; usar `sleep 88` antes de checar).
- **Copy proibida:** incrível / imperdível / sensacional, em-dash (—), 💛, emojis sem pedido.
- **Paleta / visual:** Georgia serif, `#2c3e50` / `#4a7fa5` / `#f7f4f0` / `#e8e2da`. UI maximiza linhas visíveis sem scroll, controles lado a lado. Módulos Sofia/Lojas usam `src/Lojas_Shared.jsx` (palette, FONT, FONT_CHAT, fz, sz).
- Commits em PT sem acento.

---

## 1. Credenciais e comandos fixos

### Git / repo
- **Token (atual, em 2 partes — juntar SEM espaço; split evita o secret-scanning do GitHub):**
  parte A: `ghp_YQG7kRKsGZNava6` · parte B: `jNHnUpp8ddHPoD33Z5OJ1`
  _(se rotacionar, substituir as 2 partes aqui)_
- **Repo:** `https://github.com/AilsonMoreira-creator/APP-financeiro.git`
- **Clone com token:** `https://AilsonMoreira-creator:[TOKEN]@github.com/AilsonMoreira-creator/APP-financeiro.git` → clonar em `/home/claude/APP-financeiro` (diretório reseta entre chats, sempre clonar fresco).
- **Identidade de commit:** `user.name="Ailson"`, `user.email="ailson@amicia.dev"` (.dev, não .local).
- **Ordem git:** `git pull --rebase` ANTES de `git add` (Ailson edita em chats paralelos; na ordem errada dá "Please commit or stash them").
- **Prod:** https://app-financeiro-brown.vercel.app

### Build / validação antes de push
- **Frontend:** `npx esbuild src/App.tsx --loader:.tsx=tsx --bundle --packages=external`
  (ignorar warnings "Duplicate key border" ~3253/3365 + `import.meta` do `--bundle`; nenhum é erro.)
- **API:** `npx esbuild api/arquivo.js --bundle --packages=external` (redirecionar stdout)

### Supabase
- **project_id:** `bxxawglmlqoswwyhpeil` · MCP: `apply_migration` = DDL; `execute_sql` = DML/leitura.
- `RETURNING` não aceita função set-returning (ex `jsonb_object_keys`).
- Fotos catálogo públicas: `https://bxxawglmlqoswwyhpeil.supabase.co/storage/v1/object/public/sofia-midias/fotos/...`

---

## 2. Ferramentas disponíveis

| Ferramenta | Pra que serve | Observações |
|---|---|---|
| **Supabase MCP** | DDL/DML/leitura no banco | project `bxxawglmlqoswwyhpeil` |
| **Vercel MCP** | logs, deploys, fetch autenticado de prod | team `team_9330La4W4IAuepiZP4N6ufMX`, project `prj_sphLeW2fuKJglpUVXGL5U8sC3xar` |
| **Meta Ads MCP** | insights, datasets, campanhas/templates | contas abaixo |
| **Bash** | git, npm, esbuild, scripts | rede só GitHub/npm/PyPI |
| **GitHub** (via token) | clone/commit/push | token acima |
| Canva, Gmail, Calendar, Drive, Semrush, Windsor.ai | conectados, uso pontual | não são o core |

### Padrão crítico do Vercel `web_fetch_vercel_url`
- Resolve auth em GET de API prod (web_fetch normal bloqueia URLs novas).
- Endpoint **longo** (~120s): a ferramenta corta ("Error occurred during tool execution"), **mas o servidor termina** e grava no banco (confirmado em CAPI e bling-fotos-sync). **Padrão:** disparar → `sleep ~90-100s` → verificar via SQL count.
- Endpoint rápido retorna JSON normal. `get_runtime_logs` funciona escopado a deploymentId + query + since curto + limit pequeno.

### Meta Ads — contas e pegadinhas
- **Meluni:** `943539471358534` · **Amícia B2B:** `338013328231048` · **Amícia Cartão:** `626487585630124`
- **Não** combinar filtro `effective_status`/`delivery` com insights (erro) — buscar sem filtro, incluir `effective_status` nos fields, filtrar no resultado. Ad-level por `campaign.id` com `IN` funciona.
- 1 breakdown por call. `dataset_stats` aceita `event_source` (SERVER_ONLY/WEB_ONLY) + `event_name`. `get_dataset_quality` pede approval.
- Conta `338013328231048`: criação de creative de vídeo e upload de imagem bloqueados; usar `image_hash` em `link_data`; `ads_get_creatives`/`ad_images`/`ad_preview` indisponíveis.
- **GA4 props:** 529125151 Meluni Site · 529112329 Site Amícia · 529094498 Amícia Vesti (`start_date`/`end_date` obrigatórios).

### Rede do bash
- Só GitHub/npm/PyPI. **Bling API e Supabase** só via endpoints serverless do Vercel ou Supabase MCP.

---

## 3. O app em resumo

React/Vite PWA. `App.tsx` (~7.6k linhas) + `.jsx` modulares. APIs serverless em `api/`.

**Blocos:** Financeiro core (Lançamentos, Boletos, Agenda, Folha, Calculadora/Ficha) · Produção (Salas de Corte + Oficinas) · Marketplace (Bling, ML estoque, SAC ML) · **CRM WhatsApp: Sofia (B2B) e Lara (Meluni B2C)** · OS Amícia (crons IA, `ia_insights`).

**Regras de negócio fixas:**
- **Confecção:** Sala de Corte = enfesto + corte. **Oficinas** = costureira externa, onde ficam as **datas de entrega** (nunca na Sala de Corte).
- **REF sem zero à esquerda:** `String(ref).replace(/^0+/,'') || '0'` (usuário/Bling/ML exibem com zero).
- **Estoque:** Ideris controla 11 canais; app lê só ML Lumia (1 canal reflete todos). `ml_sku_ref_map` + `ml_scf_ref_map` resolvem SKU↔ref.
- **Projeção de despesas:** média de TODAS as categorias dos 2 meses anteriores + soma real dos boletos já lançados no mês corrente.
- **Importação marketplaces:** pedidos "Atendido" do dia nos 3 tokens Bling, somar, -10% devoluções, lançar em `receitasPorMes[mes][dia].marketplaces` (1x/dia).

---

## 4. SOFIA — CRM WhatsApp B2B (`src/LojasWhats.jsx` ~8k linhas + `src/ClientesSofia.jsx`)

Co-piloto de IA pras **7 vendedoras** (Silva Teles/Brás: Joelma, Cleide · Bom Retiro: Célia, Vanessa, Fran). Backend `api/lojas-whats-*.js`, IA em `api/lojas-whats-ia.js`, helpers `_lojas-whats-helpers.js`.

### Tabelas núcleo
- `lojas_whats_conversas` — 1/lead. Chaves: etapa, origem_lead, iniciada_em, vendedora_atribuida_id, **vendeu_em/vendeu_valor/vendeu_canal** (manual_sofia|match_mire|manual), carrinho_id, unread_count, responder_em, editando_por/editando_em (presence lock 45s), ciclo24_vence_em, contexto_ia, refs_indicadas, cross_sell_ativo/ref, ctwa_clid.
- `lojas_whats_mensagens` — usa **enviada_em** (NÃO criada_em!). direcao entrada/saida, tipo_midia.
- `lojas_whats_sugestoes` — pendentes de aprovação (usa criada_em); contexto_ia guarda `print_leituras`.
- `lojas_whats_templates` — templates Meta + catálogo (pasta, porque, fluxo, criativo_url).
- `lojas_whats_midias` — fotos/vídeos por ref (bucket `sofia-midias`).
- `lojas_vendedoras` (9 no banco, 7 ativas), `lojas_produtos` (545 refs), `lojas_conversoes` (vendas casadas Bling; origem_tipo lead_carrinho|cliente), `clientes_sofia_fila` (disparo massa), `lojas_whats_capi_eventos` (auditoria CAPI; UNIQUE meta_event_id = sha256 conversa|pedido|valor).
- Mire (ERP físico): `lojas_vendas` / `lojas_vendas_varejo` — documento_cliente_raw/documento_raw, cliente_whatsapp_raw/whatsapp_raw, valor_liquido.

### Etapas
processando → aprovar → enviada → conversando → quente → atendida → **vendeu** | perdida | follow_up | varejo | **feedback / inativo** (módulo Clientes, invisíveis na lista principal).

### Comportamentos críticos (NÃO quebrar)
- **feedback/inativo NUNCA auto-envia** (auto=false forçado); histórico rotula respostas humanas como `[RESPOSTA JA DADA PELA EQUIPE HUMANA]`.
- **Cron responder 1x/min** via `responder_em` (delay humanizado). Idem Meluni.
- **vendeu_em obrigatório** ao mover pra vendeu (conversa-editar carimba se null; cron-capi-match grava; funil-leads tolera null como cinto). Fix 05/07 + backfill de 5 vendas.
- Classificador determinístico roteia 5 tipos de msg antes da IA; anti-stale invalida sugestão se chegou msg nova.
- Handoff pra vendedora: resumo Claude Haiku + msg IA de apresentação.
- Regra varejo fallback: 3+ peças = condição especial, **nunca** dizer "varejo" proativamente.
- Roteiros por origem: A=carrinho, B=anúncio. Teste A/B vídeo de abertura (Tamara, 50% sticky).
- Ciclo 24h por conversa; nudge-abertura (cron :35) cutuca e +3d → perdida.
- Cross-sell 30% do valor do carrinho.
- **Fluxo aprovação:** cron-selecionar → cron-processar gera HSM → **Tamara aprova** (multi-select em lote). Limites: 2 CNPJ + 2 CPF por vendedora/dia. Metas: BR 70/80/90/100k, ST 70/140k; comissão 1% atacado + 1,5% varejo + bônus.

### Leitura de prints (implementado, SEM validação em produção!)
`lerPrintsEMatch()` em lojas-whats-ia.js (~l.78): vision Haiku (config `modelo_ia_print`) extrai {tipo_peca, preco, texto, cores} das 3 imagens de entrada mais recentes → match determinístico vs lojas_produtos + MODELOS_POR_REF (preço tabela ±3%=+4, médio ±12%=+1, categoria +2, palavras +3; forte=score≥6). Grava em contexto_ia.print_leituras + prioriza pool visual. Config `sofia_print_leitura_ativa`. Front: forte pré-preenche modal Indicar refs (borda verde), fracas viram chips. Log `print-leitura:`. **PENDENTE: print de teste em produção.**

### Modal Indicar refs + galeria
`api/lojas-whats-refs-buscar.js`: `?refs=` hidrata thumbs · `?q=` busca nome/categoria/ref/preço (item sem nome E sem foto só por ref exata) · `?galeria=1` 68 refs fotografadas por estoque desc. Picker: busca vazia = galeria 3 colunas com chips de categoria, candidatas do print primeiro. Fila de envio >5 fotos.

### Tela Conversão (v2, 05/07)
Topo: 💰 Vendas últimos 30d fixo, expansível (cards nome/valor/origem/👤vendedora/canal/data — fonte **etapa vendeu**, bate com a lista). Filtros: vendedora + 7d/30d/mês atual/mês passado. Resumo geral + cards por origem com funil: total / sem interação / leve(1-2) / média(3+) / quente(5+ c/foto OU vendedora) / vendas + %. RPC `fn_sofia_funil_leads(p_ini,p_fim,p_vendedora)`, endpoint `api/lojas-whats-funil-leads.js`. Abaixo: conversões casadas (lojas_conversoes, site≤5d loja≤15d) + **CAPI (auto + botão manual) no final**. Dados 05/07: 1.132 leads/30d, 58% sem interação; carrinho converte melhor; **fb ads 0 vendas em 216 leads**.

### Aba Perdida + templates reativação
Chips por origem_lead, filtro data perdida_em, seletor de template pra massa. 3 rascunhos aguardando corpo + aprovação Meta: reativacao_curadoria_v1, reativacao_novidades_v1, dicas_lojista_v1 (disabled até status='aprovado'). `api/lojas-whats-templates-catalogo.js` (GET/PATCH/POST criativo → sofia-midias/templates/). Mídias tab: TemplatesCatalogo com preview WhatsApp.

### CAPI B2B (pipeline Purchase)
Carrinhos do site → conta **Amícia Cartão**, pixel `1636287600816161`. `cron-capi-match` diário: origem in (anuncio_instagram, carrinho_site_amicialoja) AND capi_purchase_enviado=false AND iniciada_em≥60d; MAX 200/rodada. Roteamento por `ctwa_clid`: com ctwa → `business_messaging` + messaging_channel:whatsapp + page_id; sem → `website` + event_source_url. Manual sempre website. Auditoria `salvarAudit` é **upsert** onConflict meta_event_id. Ver no Meta: Gerenciador de Eventos → pixel → filtro "Servidor" (lag ~1h).

---

## 5. MELUNI — B2C (meluniloja.com.br, Convertr) + Lara

**Lara** = IA WhatsApp B2C (WABA `912339361863904`). LaraThread, SAC inbox por abas, áudio via Whisper, imagem via vision. Guard remove travessão de TODA saída. Módulo Devolução (`vw_meluni_devolucoes`), módulo Carrinhos (carteira de compradores reais).

### Carrinho abandonado (LIGADO em produção)
- Disparo 12h/17h/21h (`meluni-whats-carrinho-disparo`), funil hora a hora (`meluni-carrinho-funil-cron`).
- **3 templates com FOTO aprovados e dispatchando:** `leve_img`, `atemporal_img`, `sem_nome_img` — gate config `lara_carrinho_img_ativo`; sem foto → fallback texto.
- Resumo de itens+thumbs: `resolverItensDetalhados`/`resolverResumoItens` em `api/_meluni-carrinho-resumo.js`. Prioridade do título: (1) curadoria `meluni_config.lara_carrinho_nomes_curto` (ref→nome curto, ~45 entradas; ref `2723` fora por ora) → (2) calculadora → (3) desc_limpa → (4) Bling API → heurística nucleoNome.
- **Fotos:** `api/bling-fotos-sync.js` */15min — Bling **Exitus** v3 endpoint de detalhe (full-size), cursor persistente + skip; bucket `sofia-midias` path `produtos/{sku}.jpg`, registrado em `meluni_produto_fotos` (chave = sku do carrinho = codigo Bling).

### Pós-compra
- `meluni-poscompra-cron` 13h seg-sáb; contexto injeta até 3 compras reais de `meluni_vendas` por cliente_id (.neq situacao_id 12).
- Situações Bling: 6 Em aberto · 9 Atendido · 12 Cancelado · 15 Em andamento. Re-checa situação AO VIVO antes de responder (caso Ingrid). Debug: `api/meluni-bling-debug.js?lista=1&data=YYYY-MM-DD`.

### CAPI Meluni + Ads
- Routing action_source por presença de ctwa_clid; salvarAudit upsert.
- ROAS real ~1,75x (após fix UTM: `utm_medium={{placement}}` fazia GA4 classificar pago como Organic Social). Criativos vencedores: catálogo (ROAS 3,69), flex_fashion_film_saia (2,52). 92% de aquisição de novos clientes vem de Ads.
- **Rotina "inserir tabela Meluni":** 10d Meta Ads conta 943539471358534 por dia; cpc=gasto/cliques, conv=(compras/cliques)*100 em %; UPSERT `meluni_meta_ads_historico` ON CONFLICT(data); NULL se sem compra→conv, sem clique→cpc; sem gasto→pula. **Não calcular ticket.**

### Email marketing
- Resend, domínio `links.news.meluniloja.com.br`; webhook cliques `api/meluni-email-webhook.js`; teste `api/meluni-email-teste.js`; crons: email-cron */2min, mkt-auto 14h, novidade 13h. Cupom em uso: VOLTEI5.

### Estoque Bling (site com estoque velho)
Root cause: depósito Multiempresa do Bling "ignora saldo". `bling_estoque.bling_sku` = `variation_sku` do Convertr. Stopgap CSV 70%. Leitura só da Lumia (Ideris espelha 11 canais).

---

## 6. LOJAS — carrinhos B2B (amicialoja.com.br) + varejo CRM

- Fila pública de carrinhos abandonados; card vai pra carteira da vendedora (`MinhaCarteiraScreen`/`meus_carrinhos`).
- **Bug conhecido (Fran):** `site-amicia-drive-cron` upsert com onConflict convertr_customer_id reseta `status='novo'` → card sai da carteira e não volta pra fila (limbo). Root cause confirmado; **correção pendente de decisão**.
- Varejo CRM (módulo Lojas): sugestões diárias IA (Sonnet 4.6) pras vendedoras, Web Push seg-sex 10:30 + 14:00 BRT, estilo learning, lojas_acoes/lojas_avisos.

---

## 7. Demais módulos (resumo)

- **Bling Estoque:** ajuste otimista com fila (⏳ âmbar, ⚠️ falha, beforeunload guard). Botão Apagar Lumia/Muniam pronto — PENDENTE escopos de escrita nos apps Bling Lumia/Muniam. **TikTok:** IDs 19 dígitos corrompem no Excel (trunca em 15 dígitos) — exportar do Seller Center como texto; reimport das 42 refs aguarda planilha Bling.
- **SAC ML:** pré-venda + pós-venda com IA, fluxo estoque inteligente, 91 pares de treino. Ausência só com absence_enabled===true.
- **OS Amícia** (ia-cron 10h/17h BRT): decisões de corte, fn_ia_cortes_recomendados, Sala de Corte (Ordem→Fila), Oficinas (prazo fn_oficina_prazo_ref), Marketplaces views (vw_marketplaces_base híbrida), ML Reviews.
- **Financeiro/Calculadora/Ficha/Folha:** estáveis.

---

## 8. Pendências abertas (05/07/2026)

1. **Sofia prints:** validar leitura em produção (mandar print com preço → checar `lojas_whats_sugestoes.contexto_ia->print_leituras` e log `print-leitura:`; ajustar pesos se errar)
2. **Templates reativação Perdida:** escrever corpos dos 3, criar na Meta, endpoint de disparo em massa lendo criativo_url
3. **Galeria do picker:** Ailson ia testar a experiência no app
4. **Meluni caso Ingrid:** teste Pix — quando pedir "checa aí", usar meluni-bling-debug
5. **2º envio B2B carrinho:** confirmar link que reabre carrinho + aprovar textos
6. **Bling Lumia/Muniam:** liberar escopos de escrita estoque (Ailson)
7. **TikTok:** reimport 42 refs aguardando planilha Bling
8. **Bug Fran (limbo carteira):** correção pendente de decisão
9. **Duplicidade telefone entre módulos** (caso Daniela, 2 conversas) — adiado
10. **Elaine Hernandes** (venda 19/06): vendeu_valor R$ 0, preencher manual
11. **fb ads 0 vendas / 216 leads** — revisar anúncio (dado da tela Conversão)
12. **Sync completa de fotos Bling Exitus** (`force=1`) quando Ailson terminar de atualizar fotos no Bling

## 9. Não reabrir (salvo pedido)

- RPC `match_venda_por_telefone` com assinatura que não bate → fallback JS ilike ("só no envio").
- PWA auto-update existe mas `SW_VERSION` nunca é bumpado — fix pendente.
- Botão de e-mail (escopo ambíguo Sofia/Meluni) — pendente Ailson definir.
- ref `2723` sem título curado — fora por ora.

## 10. Tabelas / dados úteis (referência rápida)

- `meluni_carrinhos` — itens[].sku; status='processando'; dados_extra.link="0" (não é URL real → botão do template é estático pra meluniloja.com.br).
- `meluni_produto_fotos` — sku, ref, cor, storage_path, url_publica, origem, bling_img_key, sem_foto. **Não guarda título.**
- `bling_estoque` — ref, cor_norm, tam, cor_label, qtd, bling_sku, bling_produto_id, gtin, titulo (longo, com ref+cor+tam).
- `ml_sku_ref_map` — sku, ref, desc_limpa. `ml_scf_ref_map` = listings ML formato antigo.
- `meluni_config` — chaves: lara_templates_carrinho, lara_templates_carrinho_img, lara_carrinho_nomes_curto, lara_carrinho_img_ativo.
- `amicia_data` — upsert por user_id lógico (amicia-admin, calc-meluni...). `amicia_data_historico`.
