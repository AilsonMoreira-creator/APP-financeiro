-- ═══════════════════════════════════════════════════════════════════════════
-- Atualiza salario_fixo (base = salário a pagar + vale) dos 6 funcionários
-- não-vendedores em folha-pagamento. Lucia também tem o vale_pago ajustado.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Sessão Ailson 11/05/2026 — bug detectado na primeira revisão da Folha:
-- valor de salario_fixo estava sendo o "salário a pagar" em vez da BASE
-- (salário + vale). Cálculo `a_pagar = base − vale` ficava negativo/errado.
--
-- Aplica-se SOMENTE aos 6 não-vendedores. As 5 vendedoras (Cleide, Joelma,
-- Célia, Fran, Vanessa) já estão corretas (base = 2112).
--
-- Estrutura assumida (REGRAS_INICIAIS): salario_fixo é índice 0,
-- vale_pago é índice 1 em cada array regras[funcId].
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── ANTES (validação) ────────────────────────────────────────────────────
SELECT 
  func_id,
  (rule->>'tipo') AS tipo,
  (rule->'config'->>'valor')::numeric AS valor_atual
FROM amicia_data,
     jsonb_each(payload->'regras') AS func_regras(func_id, regras),
     jsonb_array_elements(regras) AS rule
WHERE user_id = 'folha-pagamento'
  AND func_id IN ('cristiane','stefany','gabrielly','ingrid','lucia','igor')
  AND rule->>'tipo' IN ('salario_fixo','vale_pago')
ORDER BY func_id, (rule->>'ordem')::int;

-- ─── UPDATE ────────────────────────────────────────────────────────────────
UPDATE amicia_data
SET payload = jsonb_set(
              jsonb_set(
              jsonb_set(
              jsonb_set(
              jsonb_set(
              jsonb_set(
              jsonb_set(
                payload,
                '{regras,cristiane,0,config,valor}', '2503'::jsonb),
                '{regras,stefany,0,config,valor}',   '2759'::jsonb),
                '{regras,gabrielly,0,config,valor}', '2334.86'::jsonb),
                '{regras,ingrid,0,config,valor}',    '2028'::jsonb),
                '{regras,lucia,0,config,valor}',     '2112'::jsonb),
                '{regras,lucia,1,config,valor}',     '845'::jsonb),
                '{regras,igor,0,config,valor}',      '1988'::jsonb),
    updated_at = NOW()
WHERE user_id = 'folha-pagamento';

-- ─── DEPOIS (confirmação) ─────────────────────────────────────────────────
SELECT 
  func_id,
  (rule->>'tipo') AS tipo,
  (rule->'config'->>'valor')::numeric AS valor_novo
FROM amicia_data,
     jsonb_each(payload->'regras') AS func_regras(func_id, regras),
     jsonb_array_elements(regras) AS rule
WHERE user_id = 'folha-pagamento'
  AND func_id IN ('cristiane','stefany','gabrielly','ingrid','lucia','igor')
  AND rule->>'tipo' IN ('salario_fixo','vale_pago')
ORDER BY func_id, (rule->>'ordem')::int;

-- Esperado:
--   cristiane | salario_fixo | 2503     |  vale_pago | 1002
--   gabrielly | salario_fixo | 2334.86  |  vale_pago |  934
--   igor      | salario_fixo | 1988     |  vale_pago |  848
--   ingrid    | salario_fixo | 2028     |  vale_pago |  892
--   lucia     | salario_fixo | 2112     |  vale_pago |  845
--   stefany   | salario_fixo | 2759     |  vale_pago | 1104
