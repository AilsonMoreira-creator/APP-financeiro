# WMS — esteira da madrugada (definida com o Ailson em 21/09/2026)

Meta: todo pedido que chegou ate as **07:40** tem NF autorizada e etiqueta preparada
ate as **08:00**, quando a equipe imprime o lote. Dimensionado pra segunda de dezembro
com ~1.200 pedidos. Horarios abaixo em **Brasilia** (no vercel.json estao em UTC, +3h).

**Um so cron** dispara a varredura a cada 10 min (04:00 → 07:50) com `?encadear=1`, e cada
passo chama o proximo **quando termina** (nunca ha dois passos batendo no Bling pela
mesma conta ao mesmo tempo):

`wms-sync` → `wms-nfe-auto?limite=120` → `wms-classificar` → `wms-preparar-lote?limite=150`

Se um passo falhar, a rodada seguinte (10 min depois) recomeca do zero. As 3 contas rodam
em paralelo dentro do nfe-auto (o limite do Bling e por conta). Codigo: `api/_wms-esteira.js`.

Capacidade: o Bling permite ~3 req/s **por conta**. NF ≈ 5 chamadas/pedido -> uma rodada
de 120 pedidos cabe em < 5 min; 6 rodadas/h = 720 pedidos/conta/h. Em 3h50 de janela a
Exitus sozinha faz > 2.500 pedidos. O preparo (≈ 3 chamadas/pedido) acompanha 10 min atras.

Protecoes:
- **Travas**: `wms_config.nfe_lock_em` e `preparo_lock_em` (4 min) — duas rodadas do mesmo
  job nunca rodam juntas (era isso que gerava 429 em cascata).
- **429 do Bling**: `blingFetch` espera 1, 2, 4, 8 s e registra cada ocorrencia em
  `app_erros` (modulo `bling-429`). Se o historico mostrar 429 recorrente num horario,
  escalonar as cadencias (ex.: preparo a cada 15 min).
- Os webhooks do Bling (`bling-webhook-pedidos`) continuam trazendo pedido novo na hora;
  a varredura e a rede de seguranca.

Depois das 08:00 a esteira continua em cadencia menor (varredura 15 min, NF/preparo nos
horarios do vercel.json) pros pedidos que chegam durante o dia.
