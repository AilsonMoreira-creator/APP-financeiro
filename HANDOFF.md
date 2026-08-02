# HANDOFF — APP Financeiro (Grupo Amícia)

> Documento de contexto pra colar no começo de uma nova sessão de pair-programming.
> Atualizado: 02/08/2026 (módulo Lojas anti-gaming + site Convertr na carteira da Cleide + Raio-X 30d + Sofia memória de produto + TikTok Shop API em andamento).

---

## 0. Quem / como trabalhamos

- **Ailson** = dev e dono solo do Grupo Amícia (moda feminina atacado, SP — lojas Brás/Silva Teles e Bom Retiro/José Paulino). Produto forte em **linho** e **alfaiataria diferenciada**. Viscolinho existe no mix mas **não enfatizar** em copy nem resposta a cliente.
- PT-BR informal ("vc", não "você"). Mac + iPhone. Pair-programming: lê o código antes de aceitar, aprova em OKs curtos ("pode fazer", "pode testar"). Edições conservadoras, confirmar ambiguidades, zero over-engineering.
- Push direto na `main`, deploy automático Vercel (~85-90s; usar `sleep 90` antes de checar).
- **Copy proibida:** incrível / imperdível / sensacional, em-dash (—), 💛, emojis sem pedido.
- **Paleta / visual:** Georgia serif, `#2c3e50` / `#4a7fa5` / `#f7f4f0` / `#e8e2da`. UI maximiza linhas visíveis sem scroll, controles lado a lado. Módulos Sofia/Lojas usam `src/Lojas_Shared.jsx` (palette, FONT, FONT_CHAT, fz, sz).
- Commits em PT sem acento.

---

## 1. Credenciais e comandos fixos

### Git / repo
- **Token (atual, em 2 partes — juntar SEM espaço; split evita o secret-scanning do GitHub):**
  parte A: `ghp_C0WjeTCadaC8R0v` · parte B: `25HitwBuCk5EjWP18KOuR`
  _(se rotacionar, substituir as 2 partes aqui)_
- **Repo:** `https://github.com/AilsonMoreira-creator/APP-financeiro.git`
- **Clone com token:** `https://AilsonMoreira-creator:[TOKEN]@github.com/AilsonMoreira-creator/APP-financeiro.git` → clonar em `/home/claude/APP-financeiro` (diretório reseta entre chats, sempre clonar fresco).
- **Identidade de commit:** `user.name="Ailson"`, `user.email="ailson@amicia.dev"` (.dev, não .local).
- **Ordem git:** `git pull --rebase` ANTES de `git add` (Ailson edita em chats paralelos; na ordem errada dá "Please commit or stash them").
- **Prod:** https://app-financeiro-brown.vercel.app

### Build / validação antes de push (ATUALIZADO 29/07 — regra dura)
- **Frontend: `npx vite build` COMPLETO é OBRIGATÓRIO** (npm install antes; `git checkout -- package-lock.json` depois). O esbuild solto NÃO pega referência de runtime nem TDZ e já deixou passar 3 crashes em produção no módulo Lojas.
- **API:** `npx esbuild api/arquivo.js --bundle --packages=external` (redirecionar stdout) continua ok pra serverless.
- **Lições dos 3 crashes (Lojas.jsx / Lojas_Telas_Vendedora.jsx):**
  1. `Lojas_Shared.jsx` importa React como namespace → hooks sempre `React.useState`, nunca solto.
  2. `Lojas.jsx` tem DOIS escopos: hook `useLojasModule` (~1314-2013, estados/handlers) vs componente `LojasModule` (2014+, screen/showModal, render). Estado do hook precisa ser exposto no objeto de retorno pra ser usado no render — conferir SEMPRE em qual escopo a variável vive.
  3. TDZ: deps de useCallback/useMemo avaliam no mount — estados declarados SEMPRE acima de quem os referencia no arquivo.

### Supabase
- **project_id:** `bxxawglmlqoswwyhpeil` · MCP: `apply_migration` = DDL; `execute_sql` = DML/leitura.
- `RETURNING` não aceita função set-returning (ex `jsonb_object_keys`).
- View/tabela nova criada por migration: rodar `notify pgrst, 'reload schema';` senão a API REST responde "não encontrada" (aconteceu nas views _30d do Raio-X).
- Fotos catálogo públicas: `https://bxxawglmlqoswwyhpeil.supabase.co/storage/v1/object/public/sofia-midias/fotos/...`

---

## 2. Ferramentas disponíveis

| Ferramenta | Pra que serve | Observações |
|---|---|---|
| **Supabase MCP** | DDL/DML/leitura no banco | project `bxxawglmlqoswwyhpeil` |
| **Vercel MCP** | logs, deploys, fetch autenticado de prod | team `team_9330La4W4IAuepiZP4N6ufMX`, project `prj_sphLeW2fuKJglpUVXGL5U8sC3xar` |
| **Meta Ads MCP** | insights, datasets, campanhas/templates | contas abaixo |
| **Bash** | git, npm, esbuild/vite, scripts | rede só GitHub/npm/PyPI |
| **GitHub** (via token) | clone/commit/push | token acima |
| Canva, Gmail, Calendar, Drive, Semrush, Windsor.ai | conectados, uso pontual | não são o core |

### Padrão crítico do Vercel `web_fetch_vercel_url`
- Resolve auth em GET de API prod (web_fetch normal bloqueia URLs novas). Endpoint com validação `X-User` não dá pra testar por aqui (não envia header) — validar via SQL.
- Endpoint **longo** (~120s): a ferramenta corta, **mas o servidor termina** e grava no banco. **Padrão:** disparar → `sleep ~90-100s` → verificar via SQL count.
- Import manual de vendas: `GET /api/lojas-drive-importar?modo=cron` roda a leva do Drive na hora.

### Meta Ads — contas e pegadinhas
- **Meluni:** `943539471358534` · **Amícia B2B:** `338013328231048` · **Amícia Cartão:** `626487585630124`
- **Não** combinar filtro `effective_status`/`delivery` com insights (erro) — buscar sem filtro, incluir `effective_status` nos fields, filtrar no resultado. Ad-level por `campaign.id` com `IN` funciona.
- Insights level=ad NÃO traz status do anúncio — o app enriquece via lote `?ids=...&fields=creative{thumbnail_url},effective_status` (api/meta-ads-analise.js, campo ad_effective_status).
- 1 breakdown por call. Conta `338013328231048`: criação de creative de vídeo e upload de imagem bloqueados; usar `image_hash` em `link_data`.
- **GA4 props:** 529125151 Meluni Site · 529112329 Site Amícia · 529094498 Amícia Vesti (`start_date`/`end_date` obrigatórios).

### Rede do bash
- Só GitHub/npm/PyPI. **Bling API e Supabase** só via endpoints serverless do Vercel ou Supabase MCP.

---

## 3. O app em resumo

React/Vite PWA. `App.tsx` (~7.6k linhas) + `.jsx` modulares. APIs serverless em `api/`.

**Blocos:** Financeiro core (Lançamentos, Boletos, Agenda, Folha, Calculadora/Ficha) · Produção (Salas de Corte + Oficinas) · Marketplace (Bling, ML estoque, SAC ML) · **CRM WhatsApp: Sofia (B2B) e Lara (Meluni B2C)** · **Módulo Lojas (co-piloto vendedoras físico)** · OS Amícia (crons IA, `ia_insights`) · TikTok Shop (em construção).

**Regras de negócio fixas:**
- **Confecção:** Sala de Corte = enfesto + corte. **Oficinas** = costureira externa, onde ficam as **datas de entrega** (nunca na Sala de Corte).
- **REF sem zero à esquerda:** `String(ref).replace(/^0+/,'') || '0'` (usuário/Bling/ML exibem com zero).
- **Estoque:** Ideris controla 11 canais; app lê só ML Lumia (1 canal reflete todos). `ml_sku_ref_map` + `ml_scf_ref_map` resolvem SKU↔ref.
- **Projeção de despesas:** média de TODAS as categorias dos 2 meses anteriores + soma real dos boletos já lançados no mês corrente.
- **Importação marketplaces:** pedidos "Atendido" do dia nos 3 tokens Bling, somar, -10% devoluções, lançar em `receitasPorMes[mes][dia].marketplaces` (1x/dia).
- **Site B2B (amicialoja.com.br / Convertr) — desde 30/07:** venda entra no Mire com vendedor **CONVERTR** (planilha `relatorio_vendas_st_DD.MM.csv` diária no Drive) → `resolverVendedoraVenda` atribui à **Cleide**; `REGRAS_FILTRO_VAREJO.vendedores_ignorar` está VAZIO (o bloqueio antigo de CONVERTR foi removido). Cliente cai na carteira da Cleide, KPI `qtd_compras_convertr` marca o canal.

---

## 4. SOFIA — CRM WhatsApp B2B (`src/LojasWhats.jsx` ~8k linhas + `src/ClientesSofia.jsx`)

Co-piloto de IA pras vendedoras. Backend `api/lojas-whats-*.js`, IA em `api/lojas-whats-ia.js`, helpers `_lojas-whats-helpers.js`. Aprovadoras de cards: Tamara e patricia (login).

### Tabelas núcleo
- `lojas_whats_conversas` — 1/lead. Chaves: etapa, origem_lead, iniciada_em, vendedora_atribuida_id, **vendeu_em/vendeu_valor/vendeu_canal** (manual_sofia|match_mire|manual), documento, carrinho_id, unread_count, responder_em, editando_por/editando_em (presence lock 45s), ciclo24_vence_em, contexto_ia, refs_indicadas, cross_sell_ativo/ref, ctwa_clid.
- `lojas_whats_mensagens` — usa **enviada_em** (NÃO criada_em!). direcao entrada/saida, tipo_midia, enviada_modo/enviada_login (autoria).
- `lojas_whats_sugestoes`, `lojas_whats_templates`, `lojas_whats_midias` (bucket `sofia-midias`; **mídia nomeada exige preencher a REF na tela** — vídeo de apresentação busca `ref ilike 'apresenta%'`).
- `lojas_vendedoras`, `lojas_produtos` (545 refs), `lojas_conversoes`, `clientes_sofia_fila`, `lojas_whats_capi_eventos`.
- Mire (ERP físico): `lojas_vendas` / `lojas_vendas_varejo`.

### Etapas
processando → aprovar → enviada → conversando → quente → atendida → **vendeu** | perdida | follow_up | varejo | **feedback / inativo**.

### Comportamentos críticos (NÃO quebrar)
- **feedback/inativo NUNCA auto-envia**; histórico rotula respostas humanas como `[RESPOSTA JA DADA PELA EQUIPE HUMANA]`.
- **Cron responder 1x/min** via `responder_em`. **vendeu_em obrigatório** ao mover pra vendeu.
- Classificador determinístico roteia antes da IA; anti-stale invalida sugestão se chegou msg nova.
- Regra varejo fallback: 3+ peças = condição especial, **nunca** dizer "varejo" proativamente.
- **MEMORIA DE PRODUTO NA CONVERSA (29/07, caso Maria Aparecida):** o que já foi informado (REF/cores/tamanhos/preço) é FATO — nunca re-analisar foto antiga, re-listar, nem pedir foto de novo; pergunta sobre modelo já identificado responde direto pela REF confirmada. **QUANDO NÃO SOUBER:** 1 frase curta ("Vou ver aqui e já te falo"), proibido parágrafo de suposição.
- **Guard [ASSISTENTE_ANEXAR:** aprovação de card com o marcador no texto retorna 422 pedindo edição (lojas-whats-aprovar.js) — mesmo guard do envio manual. O marcador é pedido interno da Sofia pra assistente, nunca pode ir pra cliente.
- Autoria no chat: toque no ícone abre alert "aprovada/escrita por {login}" (title não funciona no iPhone).
- Fluxo aprovação: cron-selecionar → cron-processar gera HSM → Tamara aprova. Limites 2 CNPJ + 2 CPF por vendedora/dia.

### Tela Conversão
Topo: 💰 Vendas 30d (etapa vendeu, inclui manuais + matches do site) + **card 🌐 "Site Convertr · compra direta"** (pedidos CONVERTR 30d SEM carrinho/conversa antes; dedup por documento E telefone contra a aba Vendeu — quem finalizou carrinho no site já conta em Vendeu e NÃO repete). Funil por origem via `fn_sofia_funil_leads` / `api/lojas-whats-funil-leads.js`.

### Aba Produtos (01/08)
Última aba da barra (depois de Clientes): abre o MESMO Raio-X de Produtos do módulo Lojas (import de `Lojas_Telas_Produtos.jsx`).

### Leitura de prints
`lerPrintsEMatch()` (vision Haiku) extrai dados das imagens → match vs lojas_produtos. Validação em produção parcial (fluxo REF por foto funcionou no caso Maria Aparecida).

---

## 5. MÓDULO LOJAS — co-piloto IA das vendedoras (Lojas.jsx + Lojas_Telas_Vendedora.jsx + Lojas_Telas_Produtos.jsx)

Sugestões diárias de mensagem (7/dia por vendedora, cron 7h), carteiras, Web Push. Vendedoras: Silva Teles (Joelma, Cleide, Tamires) · Bom Retiro (Célia = responsável, Vanessa, Fran). Vesti só Bom Retiro.

### Pacote anti-gaming (28-30/07, estreou 30/07)
- **Gates:** "Já enviei" exige mensagem_gerada E telefone; sem WhatsApp trava enviar E dispensar; badge 📵 clicável na carteira adiciona o número na hora.
- **"Dispensar"** com motivo escrito obrigatório (mín 5 chars) nos 2 modais.
- **Envio sem edição** → modal próprio (nome da vendedora, 4 variantes sorteadas VARIANTES_SEM_EDICAO, lembrete 💚 "atendimento humano = mais venda", "Vou personalizar" primário / "Enviar assim mesmo" secundário).
- **Alertas em camadas** (AlertaRajadaModal, botão libera em 6s, tudo registrado em lojas_acoes): 'rajada' (3 execuções <20s), 'leitura' (3 envios com <7s da msg pronta — o texto NÃO menciona os 7s), 'pendentes' (2+ sem fazer ontem → 1º clique de hoje).
- Faixa "⚠️ Falta pra concluir" + banner admin "N alertas 30d" + parabéns 🏆 segunda (≥10 execuções, gap ≥2min) + card roxo "👩‍💼 Avisos da loja" pra Célia (pendências/alertas de Vanessa e Fran).
- Cooldowns: carteira ≥100 clientes = 14d; sacola conta no cooldown; campanha Preview Verão ENCERROU 27/07.

### Raio-X de Produtos (aba Produtos; também na Sofia)
5 abas: Top 30 vendidas / Compras / Primeira compra (60d) · Recompra / Top matches (90d). **Toggle "30 dias" POR ABA** (31/07, troca de coleção): views gêmeas `_30d` no banco + `mv_lojas_matches_30d` (coocorrência mín. 3; refresh diário duplo via `refresh_matches_raiox`); endpoint `api/lojas-produtos-raiox.js?dias=30`; front busca payload 30d lazy. Fetch com erro mostra "Tentar de novo" (nunca loop de carregando).

### Fotos (31/07 — invertido)
`FotoProdutoLojas` (Lojas_Shared.jsx): fonte PRINCIPAL = mídias da aba Mídias da Sofia (bucket sofia-midias, busca no mount com cache por REF); bucket `produtos` = fallback; depois placeholder.

### Site Amícia no admin
Card "🌐 Site Amícia" no dashboard (gêmeo do Auditoria Vesti): clientes do site, carteira da Cleide, vendas CONVERTR importadas, sugestões citando amicialoja. Perfil IA `so_online` = cliente do site → mensagem SEMPRE oferece catálogo PDF / fotos de novidades / amicialoja.com.br ("o que ficar mais fácil pra vc").

- **Bug conhecido (Fran):** `site-amicia-drive-cron` upsert reseta `status='novo'` → card sai da carteira (limbo). Correção pendente de decisão.

---

## 6. MELUNI — B2C (meluniloja.com.br, Convertr) + Lara

**Lara** = IA WhatsApp B2C (WABA `912339361863904`). SAC inbox, áudio Whisper, imagem vision. Guard remove travessão de TODA saída.

- **Carrinho abandonado LIGADO:** disparo 12h/17h/21h, 3 templates com foto. Fotos via `api/bling-fotos-sync.js` (Bling Exitus, bucket sofia-midias/produtos/{sku}.jpg).
- **Devolução:** `vw_meluni_devolucoes`; timeline 6 etapas — **mobile (<760px) mostra só os nós + a etapa atual escrita embaixo** ("Recebida e conferida · 8d atraso"); desktop com rótulos completos.
- **Pós-compra** 13h seg-sáb; re-checa situação Bling ao vivo. Situações: 6 aberto · 9 Atendido · 12 Cancelado · 15 andamento.
- **E-mail (Resend):** webhook `api/meluni-email-webhook.js` trata opened/clicked/bounced/complained, MAS só clicked chega — **PENDENTE AILSON: ligar Open Tracking no domínio + marcar os eventos no webhook do painel Resend** (269 envios, 0 aberturas = tracking desligado). Aba Cliques funciona (5 cliques reais registrados).
- **Aba Marketing (CalcMetaAdsMeluni):** lista de criativos ordena ATIVOS primeiro (tag verde) e inativos depois (tag vermelha), via ad_effective_status.
- ROAS real ~1,75x. Rotina "inserir tabela Meluni": 10d conta 943539471358534, UPSERT `meluni_meta_ads_historico` ON CONFLICT(data). Não calcular ticket.
- Disparo WhatsApp em massa: Ailson quer começar (públicos na ordem: cupom não usado > compradoras por categoria > cliques e-mail > carrinhos; volume gradual, 1/semana por pessoa, opt-out). Módulo de campanhas ainda não pedido.

---

## 7. TIKTOK SHOP (em andamento, 02/08)

- Vende via afiliados, amostra grátis, lives (começando) e vitrine; entra em campanhas. Agência parceira; ranking PDF de apoio: `api/bling-ranking-tiktok.js` (25 itens, 3 páginas, preços da calculadora "ref|tiktok" com -5%/-10%, título "Grupo Meluni · Exitus"); troca de foto por REF: `api/bling-foto-ref.js?ref=NNN&run=1`.
- **App no Partner Center:** "App Exitus", Custom, App Key `6kr44ku62od2j`, mercado Brasil. **Scope `seller.customer_service` (Scope ID 480004) EM ANÁLISE** (dados sensíveis, aplicação enviada com justificativa + prints do SAC).
- **API mapeada** (base `open-api.tiktokglobalshop.com`, v202309, assinatura HMAC-SHA256 + header x-tts-access-token + shop_cipher; auth via `auth.tiktok-shops.com/api/v2/token/get|refresh`): Customer Service = get/send conversations+messages, read, upload image. **SEM webhook de mensagem** → SAC será por polling (cron ~5min). Métrica TikTok: 12-Hour Response Rate.
- **Quando aprovar:** Ailson gera link de autorização + manda App Secret + auth code (expira rápido) → construir conector, tabelas tts_conversas/tts_mensagens, cron sync e fonte "TikTok Shop" no módulo SAC.
- **Roadmap avaliado (Ailson pensando):** Central de Amostras (searchSampleApplications + reviewSampleApplications + ROI por amostra), Radar de Afiliados (searchSellerAffiliateOrders), Margem real por REF (Finance API × calculadora × custo), Performance de vídeos/lives (Analytics API). Scopes extras a solicitar: Affiliate Seller, Data, Finance, Promotion, Orders.

---

## 8. Demais módulos (resumo)

- **Bling Estoque:** ajuste otimista com fila. Botão Apagar Lumia/Muniam pronto — PENDENTE escopos de escrita nos apps Bling Lumia/Muniam. TikTok: IDs 19 dígitos corrompem no Excel — exportar como texto; reimport das 42 refs aguarda planilha.
- **SAC ML:** pré+pós-venda com IA, 91 pares de treino.
- **OS Amícia** (ia-cron 10h/17h BRT): decisões de corte, Sala de Corte, Oficinas, Marketplaces views, ML Reviews.
- **Financeiro/Calculadora/Ficha/Folha:** estáveis.

---

## 9. Pendências abertas (02/08/2026)

1. **TikTok Shop:** aguardando aprovação do scope customer service → construir SAC TikTok (passos combinados)
2. **Resend (Meluni e-mail):** Ailson ligar Open Tracking + marcar eventos opened/bounced/complained no webhook
3. **Telefone errado no balcão** (casos Rita/Rosineia): Ailson vai tratar com a equipe; alerta de DDD divergente oferecido, não pedido
4. **Bug Fran (limbo carteira site-amicia-drive-cron):** correção pendente de decisão
5. **Bling Lumia/Muniam:** liberar escopos de escrita estoque (Ailson)
6. **TikTok reimport 42 refs** aguardando planilha Bling
7. **SW_VERSION nunca bumpado** (PWA serve versão velha; usuário precisa fechar/reabrir o app)
8. **Disparo WhatsApp massa Meluni:** módulo de campanhas quando Ailson decidir (começar pelo público do cupom)
9. **Sofia prints:** validação fina em produção / ajustar pesos se errar
10. **fb ads 0 vendas / 216 leads** — revisar anúncio

## 10. Não reabrir (salvo pedido)

- RPC `match_venda_por_telefone` assinatura → fallback JS ilike.
- Botão de e-mail (escopo ambíguo Sofia/Meluni) — pendente Ailson definir.
- ref `2723` sem título curado — fora por ora.
- Crons demais no vercel.json — consolidação adiada.

## 11. Tabelas / dados úteis (referência rápida)

- `meluni_carrinhos` — itens[].sku; dados_extra.link="0" (botão do template é estático pra meluniloja.com.br).
- `meluni_produto_fotos` — sku, ref, storage_path, url_publica. Não guarda título.
- `bling_estoque` — ref, cor_norm, tam, qtd, bling_sku, titulo.
- `meluni_email_envios` — resend_id, aberto_em, clicado_em, status, origem (webhook carimba os 4 eventos).
- `lojas_whats_midias` — ref, tipo, storage_path, ativa (vídeo apresentação: ref='Apresentação').
- `meluni_config` — chaves lara_*.
- `amicia_data` — upsert por user_id lógico (amicia-admin, calc-meluni...).
