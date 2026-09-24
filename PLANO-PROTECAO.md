# PLANO — App fechado (fase de proteção)

> Registrado em 23/09/2026 (noite). Substitui a ordem do PLANO-MIGRACAO.md para a parte de acesso.
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
| **Aparelhos em sombra** | ✅ 23/09 (`a7966ec`) — começa a semana |
| Fase 1 — trava por token nos endpoints de ação | ⏳ |
| Template com botões + webhook + tela de pendentes + device_id no login | ⏳ (front) |
| Ligar aparelhos (`aparelhos_modo = ativo`) | ⏳ depois da semana |
| Fase 2 — SAC e Meta Ads | ⏳ |
| Fase 3 — dados (token aceito pelo Supabase + RLS por módulo) | ⏳ |

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

## Fase 1 — trava nos endpoints de ação (próxima)
Achado de 23/09: **nenhum** endpoint de ação confere quem chama. O porteiro mostra que hoje só são chamados com token válido ou por cron.
Cada um ganha no topo a conferência de token + módulo (`exigirSessao` do `_sessao.js`) ou o `CRON_SECRET` (já existe no Vercel). O registro de "quem fez" passa a usar o usuário do token. 1 dia em modo aviso antes de ligar; chave de volta sem deploy.
1. **Estoque Bling:** `bling-estoque-set`, `bling-estoque-acrescentar-corte`, `bling-estoque-zerar-filhos`, `bling-localizacao-set`; apagar `bling-fix-corte-9876`; tirar gravação anônima da tabela `bling_estoque` (a tela só lê; `bling_estoque_locks` fica).
2. **WhatsApp:** envios do Sofia (`lojas-whats-mensagem-enviar`, `template-disparo`, `clientes-massa`, `followup-disparo-massa`, `pesquisa-enviar`, `midia-enviar-local`, `aprovar`, `encaminhar`, `ia-disparar-manual`) e da Lara (`meluni-whats-enviar`, `midia-enviar`, `carrinho-disparo`, `aprovar`, `template-criar`), e-mail mkt, `whats-teste-disparo`. Conferir assinatura da Meta nos webhooks de entrada.
3. **NF:** `wms-nfe-auto` e a esteira (`_wms-esteira.js`) provando cron pelo `CRON_SECRET`; `wms-etiquetas` só a trava no topo (sem tocar montagem/ZPL, com autorização dele); fechar `wms_print_jobs`. Nunca em dia de operação; testar com `?dry=1`.
- Crons em geral: hoje reconhecidos pelo User-Agent (`vercel-cron`), que qualquer um manda — trocar por `CRON_SECRET`.

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
- 4 produtos duplicados por espaço no fim da REF (3164 com descrições diferentes, 3217, 3226, 3237) — decisão dele.
- `sombra_historico` crescendo ~60 MB/dia (Oficinas) — precisa de retenção.
- Save da gaveta `ailson_cortes` sem trava de versão (espelho e restauração automática seguram).
- 7 gavetas de backup antigo no `amicia_data` (financeiro completo, abertas).
- Revogar o token do GitHub `ghp_LC6sKI4x…` ao fim desta fase.
- Rate limit das APIs no Firewall do Vercel (principalmente as que chamam IA).
