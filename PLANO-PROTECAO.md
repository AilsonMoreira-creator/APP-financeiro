# PLANO — App fechado (fase de proteção)

> Registrado em 23/09/2026 (noite) — atualizado no fim da mesma noite (Fase 1: estoque ativo, NF em aviso). Substitui a ordem do PLANO-MIGRACAO.md para a parte de acesso.
> O PLANO-MIGRACAO.md continua valendo para a saída do `amicia_data` (sombras, espelhos, virada por módulo).

## Prioridades do Ailson (nesta ordem)
1. Ninguém de fora mexe no **estoque do Bling**, gera **NF no Bling** ou responde pelo **nosso WhatsApp**.
2. Fechar o **SAC** (mensagens e pós-venda ML) e impedir ações na conta de **Meta Ads** pela API.
3. Os **dados**: clientes, histórico de vendas, cortes, boletos e o resto do financeiro.

## Regra de acesso (decidida por ele)
- **Aparelho conhecido entra de qualquer lugar.** A aprovação vale por aparelho (não por usuário): usuário em outro aparelho conhecido da empresa entra normal.
- **Aparelho novo dentro da empresa** (IP onde 3+ usuários diferentes usam na semana — aprendido sozinho, porque os IPs das lojas mudam): entra e vira aprovado.
- **Aparelho novo fora da empresa:** fica pendente. **Só ailson/admin liberam** — WhatsApp com botões Liberar/Recusar (template novo na Meta, resposta interceptada no webhook do Sofia antes da IA, só aceita do número dele, pedido vence em 24 h) ou tela Usuários.
- Pânico: só o botão de bloquear usuário na tela Usuários.
- Fora do escopo por decisão dele: freio por volume (futuro), avisos/resumo diário, códigos de recuperação (a chave mestra é o acesso dele ao Supabase/Vercel/GitHub — manter 2FA nos três).
- Sombra de **1 semana** antes de ligar.

## Estado

| Etapa | Estado |
|---|---|
| `shopee_auth`, `tts_auth` fechadas; 9 funções security definer sem acesso anônimo | ✅ 23/09 |
| Espelho de cadastros: 1 registro por chave (REF com espaço duplicava e travava o lote) | ✅ 23/09 (`1aec87a`, SW v277) |
| **Fase 0** — admin pelo TOKEN (não pelo `X-User`) | ✅ 23/09 (`a7966ec`) |
| **Aparelhos em sombra** | ✅ 23/09 (`a7966ec`) — semana até 30/09 |
| **Fase 1 · estoque Bling** — trava por token, **ATIVA** | ✅ 23/09 (`574c43b`) |
| **Fase 1 · resto do Bling** (gtin, bling-contas, diag de NF) — **ATIVA** | ✅ 23/09 (`d444649`) |
| **Fase 1 · NF** (`wms-nfe-auto`) e consolidação das 5h | ✅ 23/09 (`d444649`) · **ATIVAS** desde 24/09 (NF 09:41; consolidação ~10h) — madrugada de 24/09: 130/130 NF ok, zero aviso |
| **Fase 1 · WhatsApp** (Sofia/Lara/e-mail mkt) — **AVISO** | ✅ 24/09 11:45 (`e47ee36`) → virar ativo depois de 1 dia sem aviso de gente legítima |
| Id do aparelho em 3 lugares (localStorage + IndexedDB + cookie do servidor) e id certo no login | ✅ 24/09 (`0939559`, SW v278) |
| Template com botões + webhook + tela de pendentes + device_id no login | ⏳ (front, fora das 08:00–09:30) |
| Ligar aparelhos (`aparelhos_modo = ativo`) | ⏳ depois de 30/09 |
| Fase 2 — SAC e Meta Ads | ⏳ |
| Fase 3 — dados (token aceito pelo Supabase + RLS por módulo) | ⏳ |

## Chaves (todas em `saude_config`, mudam sem deploy pelo SQL Editor)

| Chave | Valor hoje | O que faz | Voltar atrás |
|---|---|---|---|
| `admin_legado` | `off` | `on` volta a aceitar `X-User: ailson` como admin | `'on'` |
| `trava_estoque` | `ativo` | estoque, localização, gtin, renovar conta Bling | `'aviso'` |
| `trava_nf` | `ativo` | gerar/transmitir NF (`wms-nfe-auto`): só cron ou admin | `'aviso'` |
| `trava_cron_estoque` | `ativo` | consolidação das 5h: só cron ou admin | `'aviso'` |
| `trava_whats` | `aviso` | envios do Sofia (módulo sofia ou lojas), Lara e e-mail mkt (meluni), whats-teste (admin) | já em aviso |
| `aparelhos_modo` | `sombra` | aparelhos conhecidos (futuro `ativo`) | `'sombra'` |

Exemplo: `update saude_config set valor='aviso' where chave='trava_estoque';` (vale em até 1 min).
Modo **aviso** = registra em `app_erros` (módulo `seguranca`, texto "SERIA recusado") e deixa passar. **Ativo** = recusa com a mensagem "Sua sessão expirou. Saia e entre de novo no app. A alteração NÃO foi feita." (ou "sem acesso a este módulo").

### Fase 0 (no ar)
`api/_admin.js` → `exigirAdmin(req,res,contexto)`: token válido com `adm`, usuário ativo e mesma versão. Aplicado em:
`app-login` (sincronizar, desbloquear) · `saude-monitor` (POST, painel, teste — o cron só faz a leitura de rotina) · `saude-credito` (cron só sincroniza) · `saude-template-criar` · `cron-despachante ?rodar` · `ml-full-sku ?aplicar` (a chave temporária `full_sku_chave` foi apagada) · `app-sessao` (listar, revogar, liberar).
Toda recusa vai pra `app_erros` com `modulo='seguranca'`.
**Chave de volta:** `update saude_config set valor='on' where chave='admin_legado';` (volta a aceitar `X-User: ailson`, registrando cada uso).

### Aparelhos em sombra (no ar)
- `app_aparelhos` (device_id, status aprovado/pendente/recusado, origem, usuários, IPs) — **27 aprovados na carga inicial** (tudo que já usou o app desde 01/09).
- `app_aparelhos_sombra` — 1 linha por dia/aparelho/usuário com a decisão: `conhecido`, `novo_empresa`, `pendente`, `recusado`, `sem_device`.
- `app_ips_empresa(7, 3)` — IPs com 3+ usuários na semana (em 23/09: 5 IPs).
- Avaliado no `app-sessao` (login, ping, atividade; no máximo a cada 20 min por aparelho). **Não muda nenhuma resposta.**
- Chave: `saude_config.aparelhos_modo` = `sombra` (futuro: `ativo`).
- **Achado:** o login manda `amica_device_id`, que nunca é gravado (o id real é `localStorage.amica_device`). Por isso a sombra roda no `app-sessao`, que recebe o id certo. Antes de ligar: corrigir o login (front) e guardar o id em mais de um lugar do navegador (Safari apaga dados de site parados 7 dias). O mesmo nome errado está no `app-erro` e no `ocupado.ts`.

Consulta da semana:
```sql
select decisao, count(distinct device_id) aparelhos, string_agg(distinct usuario, ',') quem, sum(n) eventos
from app_aparelhos_sombra group by decisao;
select * from app_aparelhos where status <> 'aprovado' or origem <> 'carga_inicial' order by criado_em desc;
select criado_em, usuario, mensagem, assinatura from app_erros where modulo='seguranca' order by id desc limit 50;
```

## Fase 1 — trava nos endpoints de ação
Achado de 23/09: **nenhum** endpoint de ação conferia quem chama. Helper `api/_trava.js` → `travaAcao(req,res,{modulo, chave, contexto, apenasAdmin})`: passa quem tem token com o módulo (ou admin) e usuário ativo na mesma versão, ou cron provado pelo `CRON_SECRET` (o Vercel manda sozinho). O "quem fez" (`body.usuario`) vira o usuário do token.

### Feito
- **Estoque (ativo):** `bling-estoque-set`, `bling-estoque-acrescentar-corte`, `bling-estoque-zerar-filhos` (POST), `bling-localizacao-set` (gravar), `bling-localizacao-popular` (a `?key=` estava escrita na tela). Tabela `bling_estoque` só leitura pro navegador. `bling-fix-corte-9876` apagado. Módulo Bling hoje: cris, ingrid, sthefany, ailson, admin.
- **Resto do Bling (ativo):** `bling-gtin-gerar` (confirmar=1), `bling-gtin-drain` (a `?key=` estava na tela), `bling-contas` (credencial, iniciar autorização e gravar token = admin; renovar = token com módulo; `trocar_codigo`, que vem da página de retorno sem token, só vale até 15 min depois de um admin iniciar a autorização daquela conta).
- **`wms-etiquetas-diag` (ativo, só admin):** diagnóstico de agosto que criava, transmitia pra SEFAZ, editava e apagava NF por parâmetro na URL, sem trava. Nada no app chama.
- **NF (aviso):** `wms-nfe-auto` só cron ou admin (`?dry=1` segue livre, só lê). A esteira (`_wms-esteira.js`) passou a mandar o `CRON_SECRET` ao chamar o próximo passo.
- **Consolidação das 5h (aviso):** `bling-estoque-consolidar-cron` só cron ou admin.

### Conferir em 24/09 às 10h (antes de virar NF e consolidação pra ativo)
```sql
select to_char(criado_em at time zone 'America/Sao_Paulo','dd/MM HH24:MI') em, usuario, mensagem, assinatura
from app_erros where modulo='seguranca' and criado_em > now() - interval '18 hours' order by id desc;
```
Esperado: **nenhum** "SERIA recusado" de `wms-nfe-auto` nem de `bling-estoque-consolidar-cron` na madrugada, e as NFs saindo normalmente. Aí: `update saude_config set valor='ativo' where chave in ('trava_nf','trava_cron_estoque');`
Também conferir: nenhuma recusa de estoque de quem é legítimo (Cris etc.) no primeiro dia com todos logando de novo.

### WhatsApp (em aviso desde 24/09) — endpoints travados
Sofia: `lojas-whats-mensagem-enviar`, `template-disparo`, `clientes-massa`, `clientes-aprovar-lote`, `followup-disparo-massa`, `followup-pesquisa-enviar`, `pesquisa-enviar`, `midia-enviar-local`, `aprovar`, `encaminhar`, `ia-disparar-manual`, `template-submeter`. Lara/e-mail: `meluni-whats-enviar`, `midia-enviar`, `carrinho-disparo`, `carrinho-teste`, `aprovar`, `template-criar`, `meluni-email-mkt-disparar`, `mkt-enviar`, `mkt-auto`, `meluni-email-teste`. Admin: `whats-teste-disparo`. Pendente: assinatura da Meta nos webhooks de entrada; retorno OAuth do ML (`ml-auth`) só até 15 min após admin iniciar. Conferir assinatura da Meta nos webhooks de entrada (senão dá pra forjar mensagem recebida e a IA responder). Aviso 1 dia, depois ativo.

### Depois
- Crons em geral: hoje reconhecidos pelo User-Agent (`vercel-cron`), que qualquer um manda — trocar por `CRON_SECRET` aos poucos (cada cron que escreve em sistema externo).
- `wms-etiquetas`: só a trava no topo, sem tocar montagem/ZPL, **com autorização explícita dele**.
- Fechar `wms_print_jobs` (fila de impressão, sem RLS).

## Fase 2 — SAC e Meta Ads
- Trava nos `meta-ads-*` e no `ml-answer`, `ml-messages-reply`, `ml-attachment`, `ml-lock`.
- Meta: token do app com permissão mínima; token só leitura pra análise.
- Prova da Fase 3 nas 9 tabelas do SAC (poucas, 2 telas).

## Fase 3 — dados
- Verificado 23/09: o projeto ainda aceita tokens HS256 do segredo legado (chave anon legada ativa). Caminho: o `app-login` emite também um token aceito pelo Supabase (usuário + módulos), o front passa esse token no `supabase.js` e cada tabela ganha policy por módulo. Realtime continua funcionando; telas não mudam.
- Precisa: Ailson copiar o **Legacy JWT secret** (Supabase → Settings → JWT Keys) pra uma variável do Vercel.
- Ordem: clientes (Lojas/Sofia + views) → histórico de vendas → cortes → boletos/financeiro (`amicia_data` por último — 23 a 34 mil leituras/dia do navegador).
- Cada módulo leva junto suas **views** (as 94 não são `security_invoker` e furam o RLS) e o bucket `sofia-midias` (anônimo lista/grava/apaga).
- As 66 tabelas sem uso do navegador (logs de 5 dias em 17–23/09) fecham em lote depois de 7 dias seguidos de log limpo.

## Pendências registradas
- Front: o login manda `amica_device_id` (nunca gravado; o certo é `amica_device`) — corrigir junto com a parte de tela dos aparelhos. Mesmo erro em `app-erro` e `ocupado.ts`.
- Front: tela de localização mostra "ok, 0 gravados" se o `bling-localizacao-popular` recusar no meio (só acontece se o token vencer entre o preparar e o gravar).
- `app-sessao ?ativos=1` nunca respondeu (o GET cai no 405 antes) — a tela Saúde usa outro caminho; limpar quando mexer.
- 4 produtos duplicados por espaço no fim da REF (3164 com descrições diferentes, 3217, 3226, 3237) — decisão dele.
- `sombra_historico` crescendo ~60 MB/dia (Oficinas) — precisa de retenção.
- Save da gaveta `ailson_cortes` sem trava de versão (espelho e restauração automática seguram).
- 7 gavetas de backup antigo no `amicia_data` (financeiro completo, abertas).
- Revogar o token do GitHub `ghp_LC6sKI4x…` ao fim desta fase.
- Rate limit das APIs no Firewall do Vercel (principalmente as que chamam IA).
