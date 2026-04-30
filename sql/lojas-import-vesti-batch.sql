-- ═══════════════════════════════════════════════════════════════════════════
-- IMPORT VESTI — clientes que compraram pelo app Vesti nos últimos 75 dias
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Origem: pedidos.json (75 transações, 63 documentos únicos: 21 CPF + 42 CNPJ)
-- Janela: jan-abr 2026
--
-- Comportamento:
--   1. Pra cada documento da lista, busca em lojas_clientes
--   2. Se acha → marca canal_cadastro='vesti' (e dispara recalculo de KPI
--      via trigger ou manual, depois)
--   3. Se NÃO acha → ignora (não cadastra novo cliente)
--   4. Mostra estatística no final
--
-- Idempotente: pode rodar várias vezes sem efeito colateral. Cliente que já
-- está com canal_cadastro='vesti' não é atualizado de novo.
-- ═══════════════════════════════════════════════════════════════════════════

WITH vesti_imports(documento) AS (
  VALUES
    ('00419147080'),
    ('00944207000114'),
    ('01119231663'),
    ('02950342000106'),
    ('02999297955'),
    ('03110709000138'),
    ('03633593000111'),
    ('03647736180'),
    ('03887789000132'),
    ('04102632000117'),
    ('04296557000172'),
    ('05558475609'),
    ('06259860676'),
    ('10682065000118'),
    ('10913383000142'),
    ('10932953689'),
    ('11648787000119'),
    ('12337249000176'),
    ('13548541000109'),
    ('14110652000193'),
    ('16519447000101'),
    ('16857565000120'),
    ('18718916805'),
    ('19062031803'),
    ('23319299000147'),
    ('23674486000149'),
    ('25185076000160'),
    ('25861942846'),
    ('26960587000174'),
    ('30492776881'),
    ('31189523000151'),
    ('31517362890'),
    ('32097031000107'),
    ('32354068000165'),
    ('32834147000173'),
    ('32966344873'),
    ('33989280000161'),
    ('34239885000106'),
    ('35409169204'),
    ('39861838000105'),
    ('45444744000133'),
    ('47954450287'),
    ('48246873000105'),
    ('49629580000170'),
    ('51421819000163'),
    ('51977238000102'),
    ('52370258000183'),
    ('52854019000107'),
    ('54847214587'),
    ('56091566000120'),
    ('60454873204'),
    ('61738021000101'),
    ('65102502000179'),
    ('65346230000152'),
    ('65490352000118'),
    ('65693240000164'),
    ('66119057315'),
    ('71612493000169'),
    ('79603289353'),
    ('86633278000111'),
    ('86719770000104'),
    ('90155068172'),
    ('91504970063')
),
-- Pra cada doc: existe? canal já é vesti? canal era outro?
status_atual AS (
  SELECT
    vi.documento,
    c.id AS cliente_id,
    c.razao_social,
    c.canal_cadastro AS canal_anterior,
    CASE
      WHEN c.id IS NULL THEN 'sem_cadastro'
      WHEN c.canal_cadastro = 'vesti' THEN 'ja_era_vesti'
      ELSE 'sera_atualizado'
    END AS status
  FROM vesti_imports vi
  LEFT JOIN lojas_clientes c ON c.documento = vi.documento
),
-- Atualiza só os que não eram Vesti
atualizados AS (
  UPDATE lojas_clientes
  SET canal_cadastro = 'vesti'
  WHERE id IN (SELECT cliente_id FROM status_atual WHERE status = 'sera_atualizado')
  RETURNING id, razao_social
)
-- Relatório final
SELECT
  status,
  COUNT(*) AS qtd,
  ARRAY_AGG(razao_social ORDER BY razao_social) FILTER (WHERE razao_social IS NOT NULL) AS clientes,
  ARRAY_AGG(documento ORDER BY documento) FILTER (WHERE status = 'sem_cadastro') AS docs_sem_cadastro
FROM status_atual
GROUP BY status
ORDER BY
  CASE status
    WHEN 'sera_atualizado' THEN 1
    WHEN 'ja_era_vesti' THEN 2
    WHEN 'sem_cadastro' THEN 3
  END;


-- ═══════════════════════════════════════════════════════════════════════════
-- PASSO 2 — recalcular KPIs dos clientes atualizados pra canal_dominante
-- virar 'vesti_dominante'. Rodar DEPOIS do UPDATE acima.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_cliente_id uuid;
  v_count int := 0;
BEGIN
  FOR v_cliente_id IN
    SELECT c.id
    FROM lojas_clientes c
    WHERE c.canal_cadastro = 'vesti'
      AND c.documento IN (
        '00419147080','00944207000114','01119231663','02950342000106',
        '02999297955','03110709000138','03633593000111','03647736180',
        '03887789000132','04102632000117','04296557000172','05558475609',
        '06259860676','10682065000118','10913383000142','10932953689',
        '11648787000119','12337249000176','13548541000109','14110652000193',
        '16519447000101','16857565000120','18718916805','19062031803',
        '23319299000147','23674486000149','25185076000160','25861942846',
        '26960587000174','30492776881','31189523000151','31517362890',
        '32097031000107','32354068000165','32834147000173','32966344873',
        '33989280000161','34239885000106','35409169204','39861838000105',
        '45444744000133','47954450287','48246873000105','49629580000170',
        '51421819000163','51977238000102','52370258000183','52854019000107',
        '54847214587','56091566000120','60454873204','61738021000101',
        '65102502000179','65346230000152','65490352000118','65693240000164',
        '66119057315','71612493000169','79603289353','86633278000111',
        '86719770000104','90155068172','91504970063'
      )
  LOOP
    PERFORM lojas_recalcular_kpis_cliente(v_cliente_id);
    v_count := v_count + 1;
  END LOOP;
  RAISE NOTICE 'KPIs recalculados pra % clientes Vesti', v_count;
END $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- PASSO 3 — validacao final: quantos clientes Vesti agora aparecem com
-- canal_dominante='vesti_dominante' nas KPIs?
-- ═══════════════════════════════════════════════════════════════════════════

SELECT
  k.canal_dominante,
  COUNT(*) AS qtd_clientes,
  ROUND(AVG(k.dias_sem_comprar)::numeric, 1) AS dias_medio_sem_comprar
FROM lojas_clientes c
JOIN lojas_clientes_kpis k ON k.cliente_id = c.id
WHERE c.canal_cadastro = 'vesti'
GROUP BY k.canal_dominante
ORDER BY qtd_clientes DESC;
