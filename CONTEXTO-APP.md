# PROJETO AMÍCIA FINANCEIRO — HANDOFF DE CONTEXTO
## Atualizado: 05/07/2026 (foco: Sofia B2B + Meluni B2C, módulos em evolução rápida)

---

## DADOS DO PROJETO
- **App:** React/Vite + Supabase + Vercel PWA (multi-módulo)
- **Repo:** github.com/AilsonMoreira-creator/APP-financeiro (branch main, push direto)
- **Deploy:** app-financeiro-brown.vercel.app (auto-deploy ~85-90s pós-push; use `sleep 88`)
- **Supabase:** projeto `bxxawglmlqoswwyhpeil` (DDL via apply_migration, DML via execute_sql)
- **Owner:** Ailson, Grupo Amícia (atacado moda feminina, Brás + Bom Retiro/SP) — marcas Bling: Exitus, Lumia, Muniam. B2C: Meluni (meluniloja.com.br). B2B: site amicialoja.com.br

## FLUXO DE TRABALHO (obrigatório)
1. Clonar repo fresco (filesystem reseta entre chats). Token git: pedir ao Ailson ("preciso do token git pra fazer push, pode colar?")
2. Validar antes de push: `npx esbuild src/App.tsx --loader:.tsx=tsx --bundle --packages=external` e `npx esbuild api/arquivo.js --bundle --packages=external` (redirecionar stdout)
3. `git pull --rebase` ANTES de `git add` (Ailson edita em chats paralelos)
4. Testar endpoints em produção com `Vercel:web_fetch_vercel_url` (web_fetch normal bloqueia URLs novas; timeout ~25s mas o server conclui)
5. Ailson: PT-BR informal ("vc"), OKs curtos, prefere ler código antes de aceitar, edições conservadoras, confirma ambiguidades, zero over-engineering

## REGRAS PERMANENTES DE COPY (toda saída de IA/templates/mensagens)
- "vc" nunca "você" · sem em-dash (—) · sem "incrível/imperdível/sensacional" · sem 💛 · sem emojis não pedidos
- Nunca enfatizar viscolinho; foco sempre linho e alfaiataria diferenciada
- REF: normalizar sem zero à esquerda internamente (`String(ref).replace(/^0+/, '') || '0'`); usuário/Bling/ML exibem com zero
- Commits em PT sem acento

---

# 🤖 SOFIA — WHATSAPP B2B (módulo mais ativo)

Sofia é a IA que atende leads atacado no WhatsApp (linha própria). UI em `src/LojasWhats.jsx` (arquivo gigante, ~8k linhas) + `src/ClientesSofia.jsx` + `src/Lojas_Shared.jsx` (palette, FONT, fz, sz — UI Georgia serif). Backend `api/lojas-whats-*.js`, helpers em `api/_lojas-whats-helpers.js`, IA em `api/lojas-whats-ia.js`.

## Tabelas núcleo
- `lojas_whats_conversas` — 1 por lead. Campos-chave: etapa, origem_lead, iniciada_em, vendedora_atribuida_id, vendeu_em/vendeu_valor/vendeu_canal (manual_sofia|match_mire|manual), carrinho_id, unread_count, responder_em, editando_por/editando_em (presence lock 45s), ciclo24_vence_em, contexto_ia, refs_indicadas
- `lojas_whats_mensagens` — usa **enviada_em** (NÃO criada_em!). direcao entrada/saida, tipo_midia
- `lojas_whats_sugestoes` — sugestões IA pendentes (usa criada_em); contexto_ia jsonb guarda print_leituras
- `lojas_whats_templates` — templates Meta + catálogo (colunas pasta, porque, fluxo, criativo_url)
- `lojas_whats_midias` — fotos/vídeos por ref (bucket `sofia-midias`, fotos públicas em /storage/v1/object/public/sofia-midias/fotos/...)
- `lojas_vendedoras` (9), `lojas_produtos` (545 refs), `lojas_conversoes` (vendas casadas Bling, origem_tipo lead_carrinho|cliente), `clientes_sofia_fila` (disparos massa Clientes)
- Mire (ERP físico): `lojas_vendas` (atacado) / `lojas_vendas_varejo` — documento_cliente_raw/documento_raw, cliente_whatsapp_raw/whatsapp_raw, valor_liquido

## Etapas do funil
processando → aprovar → enviada → conversando → quente → atendida (vendedora) → vendeu | perdida | follow_up | varejo | feedback | inativo (últimas 2 = módulo Clientes, invisíveis na lista principal)

## Comportamentos críticos (NÃO quebrar)
- **feedback/inativo NUNCA auto-envia** (auto=false forçado em todos os caminhos); histórico dessas conversas rotula respostas humanas como `[RESPOSTA JA DADA PELA EQUIPE HUMANA]`
- **Cron responder roda 1x/min** via `responder_em` (delay humanizado). Idem Meluni
- **vendeu_em é obrigatório** ao mover pra etapa vendeu (conversa-editar carimba se null; cron-capi-match grava; funil tolera null como cinto)
- Classificador determinístico roteia 5 tipos de msg antes da IA; anti-stale invalida sugestão se chegou msg nova
- Presence lock: editando_por/editando_em TTL 45s evita 2 pessoas na mesma conversa
- Handoff pra vendedora: resumo Claude Haiku + msg IA de apresentação
- Origem A/B nos roteiros do prompt: A=carrinho, B=anúncio
- Ciclo 24h: relógio por conversa; nudge-abertura (cron :35) manda cutucada e +3d vira perdida
- Cross-sell 30% do carrinho ativo (cross_sell_ativo/cross_sell_ref)

## Leitura de prints (RECÉM-IMPLEMENTADO, ainda sem validação em produção!)
`lerPrintsEMatch()` em api/lojas-whats-ia.js (~linha 78): vision Haiku (config `modelo_ia_print`) extrai {tipo_peca, preco, texto, cores} das 3 imagens de entrada mais recentes → match determinístico contra lojas_produtos + MODELOS_POR_REF (preço tabela ±3%=+4pts, médio ±12%=+1, categoria +2, palavras +3, forte=score≥6). Resultado em contexto_ia.print_leituras da sugestão + prioriza pool visual. Config `sofia_print_leitura_ativa`. Front: candidata forte pré-preenche modal Indicar refs (borda verde), fracas viram chips. Log `print-leitura:`. **PENDENTE: Ailson mandar print de teste e conferir extração/pesos.**

## Modal Indicar refs + galeria
`api/lojas-whats-refs-buscar.js`: ?refs= (hidrata thumbs), ?q= (busca nome/categoria/ref/preço; item sem nome E sem foto só por ref exata), ?galeria=1 (68 refs fotografadas por estoque desc). Picker: busca vazia mostra galeria 3 colunas com chips de categoria, candidatas do print primeiro. Fila de envio >5 fotos.

## Tela Conversão (v2, 05/07)
Topo: 💰 Vendas últimos 30d fixo, expansível (cards com nome/valor/origem/👤vendedora/canal/data — fonte etapa vendeu, bate com a lista). Filtros: vendedora + 7d/30d/mês atual/mês passado. Resumo + cards por origem com funil: total/sem interação/leve(1-2)/média(3+)/quente(5+ c/foto OU vendedora)/vendas + %. RPC `fn_sofia_funil_leads(p_ini,p_fim,p_vendedora)`, endpoint `api/lojas-whats-funil-leads.js`. Abaixo: conversões casadas (lojas_conversoes, janela site≤5d loja≤15d) + CAPI (auto + manual) no final. Dados 05/07: 1.132 leads/30d, 58% sem interação; carrinho converte melhor; fb ads 0 vendas em 216 leads.

## Aba Perdida + templates reativação
Chips por origem_lead, filtro data perdida_em, seletor template massa. 3 rascunhos aguardando corpo+aprovação Meta: reativacao_curadoria_v1, reativacao_novidades_v1, dicas_lojista_v1 (disabled até status='aprovado'). `api/lojas-whats-templates-catalogo.js` (GET/PATCH/POST criativo → sofia-midias/templates/). Mídias tab tem TemplatesCatalogo com preview WhatsApp.

## Crons Sofia principais
responder */1min · rotacionar */5 · followup-quente :20 · nudge-abertura :35 · catalogo :15 · promover */4h · capi-match 6h · feedback 13h · pesquisa 17h · clientes-fila */1min · aprender 5h · varejo 0h/h

---

# 💛 LARA — MELUNI B2C (WhatsApp + carrinho + email)

Lara atende a Meluni (varejo online). Backend `api/meluni-*.js`. UI em módulo Meluni.

## Carrinho abandonado
- Disparo 12h/17h/21h (`meluni-whats-carrinho-disparo`), funil hora a hora (`meluni-carrinho-funil-cron`)
- 3 templates com FOTO aprovados Meta: `leve_img`, `atemporal_img`, `sem_nome_img` — gate config `lara_carrinho_img_ativo`; resumo de itens+thumbs via `api/_meluni-carrinho-resumo.js` (resolverItensDetalhados)
- Fotos produto: `api/bling-fotos-sync.js` */15min — Bling Exitus v3 detalhe (full-size), cursor persistente + skip

## Pós-compra
- `meluni-poscompra-cron` 13h seg-sáb; contexto injeta até 3 compras reais de `meluni_vendas` por cliente_id (.neq situacao_id 12/cancelado) — responde "qual foi minha compra" na hora
- Situações Bling: 6 Em aberto, 9 Atendido, 12 Cancelado, 15 Em andamento. Caso Ingrid: re-checa situação ao vivo antes de responder. Debug: `api/meluni-bling-debug.js?lista=1&data=YYYY-MM-DD`
- Guard remove travessão de TODA saída da Lara

## Meta CAPI Meluni
Routing por presença de ctwa_clid decide action_source; salvarAudit é upsert. Conta ads Meluni: 943539471358534. Rotina "inserir tabela Meluni": 10d Meta Ads, cpc=gasto/cliques, conv=(compras/cliques)*100, UPSERT meluni_meta_ads_historico ON CONFLICT(data), sem ticket.

## Email marketing
- Resend, domínio `links.news.meluniloja.com.br`; webhook cliques `api/meluni-email-webhook.js`; teste `api/meluni-email-teste.js`; crons email-cron */2min, mkt-auto 14h, novidade 13h
- UTM: campanhas Meluni tinham utm_medium={{placement}} quebrando GA4 (pago virava Organic Social) — corrigido; ROAS real ~1,75

---

# 📦 DEMAIS MÓDULOS (resumo)

- **Bling Estoque** (`src/` módulo estoque): ajuste otimista com fila (⏳ âmbar, ⚠️ falha, beforeunload guard). Botão Apagar Lumia/Muniam pronto — PENDENTE Ailson liberar escopo escrita estoque nos apps Bling Lumia/Muniam. TikTok: IDs 19 dígitos corrompem no Excel (truncar 15 dígitos) — exportar do Seller Center como texto; reimport das 42 refs aguarda planilha Bling do Ailson
- **SAC ML**: perguntas pré-venda + pós-venda com IA (Sonnet), fluxo estoque inteligente, 91 pares de treino. Ausência só com absence_enabled===true
- **OS Amícia** (ia-cron 10h/17h): decisões de corte, 10 views, fn_ia_cortes_recomendados, Sala de Corte (Ordem→Fila), Oficinas (prazo dinâmico fn_oficina_prazo_ref), Marketplaces views (vw_marketplaces_base híbrida), ML Reviews
- **Lojas (varejo CRM)**: sugestões diárias IA pras 7 vendedoras, push, estilo learning
- **Financeiro/Calculadora/Ficha/Folha**: estáveis, pouco mexidos
- **GA4 props**: 529125151 Meluni Site, 529112329 Site Amícia, 529094498 Amícia Vesti (start_date/end_date obrigatórios). **Meta Ads:** effective_status NÃO filtra em insights (filtrar depois); ad-level por campaign.id com IN funciona. Conta B2B Amícia: 626487585630124

---

# ⏳ PENDÊNCIAS ABERTAS (05/07/2026)

1. **Sofia prints**: validar leitura em produção (Ailson manda print com preço → checar lojas_whats_sugestoes.contexto_ia->print_leituras e log `print-leitura:`; ajustar pesos se errar)
2. **Templates reativação Perdida**: escrever corpos dos 3, criar na Meta, endpoint de disparo em massa lendo criativo_url
3. **Galeria do picker**: Ailson ia testar a experiência no app
4. **Meluni caso Ingrid**: teste Pix do Ailson — quando pedir "checa aí", usar meluni-bling-debug
5. **2º envio B2B carrinho**: confirmar link que reabre carrinho + aprovar textos
6. **Bling Lumia/Muniam**: escopos de escrita estoque (Ailson)
7. **TikTok**: reimport 42 refs aguardando planilha Bling
8. **Duplicidade telefone entre módulos** (caso Daniela, 2 conversas) — adiado
9. **Elaine Hernandes** (venda 19/06): vendeu_valor R$ 0, preencher manual se souber
10. **fb ads 0 vendas/216 leads** — revisar anúncio (dado da tela Conversão)
