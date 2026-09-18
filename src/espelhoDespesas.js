/**
 * espelhoDespesas.js — espelho dos VALORES das células da tela de Despesas.
 * Ailson 17/09/2026, na mesma linha do espelho de cortes (oficinas_cortes_espelho).
 *
 * POR QUE: o payload `amicia_data` pode ser sobrescrito por um save de tela antiga
 * e levar junto lançamentos. No módulo Oficinas isso foi resolvido guardando os
 * cortes numa tabela relacional FORA do payload. Aqui vale o mesmo, mas só com o
 * TOTAL de cada célula (ano + mês + categoria) — as abas auxiliares não são
 * espelhadas; se sumir uma linha de dentro, o total muda e a divergência aparece.
 *
 * REGRAS (pra não dar falso positivo e não seguir o erro):
 *  1. O espelho NUNCA é apagado por o valor sumir da tela. Se a célula zerar, o
 *     espelho mantém o valor e acusa a diferença.
 *  2. Só uma alteração do próprio usuário sobrescreve (gravação com carimbo novo).
 *  3. A comparação é por CARIMBO, não só por valor: uma edição legítima grava e
 *     não vira alerta; o alerta é pro caso do valor mudar sem passar por aqui.
 *  4. Tudo é best-effort: falha de rede aqui nunca atrapalha a tela.
 */

const TABELA = 'financeiro_despesas_espelho';

function usuarioAtual() {
  try { const s = JSON.parse(localStorage.getItem('amica_session') || '{}'); return s.usuario || s.nome || null; }
  catch { return null; }
}

/** Lê o espelho de um mês: { categoria: { valor, atualizado_em, atualizado_por } } */
export async function lerEspelhoMes(supabase, ano, mes) {
  try {
    const { data, error } = await supabase.from(TABELA)
      .select('categoria, valor, atualizado_em, atualizado_por')
      .eq('ano', ano).eq('mes', mes);
    if (error) throw error;
    const out = {};
    for (const r of (data || [])) {
      out[r.categoria] = { valor: Number(r.valor) || 0, atualizado_em: r.atualizado_em, atualizado_por: r.atualizado_por };
    }
    return out;
  } catch (e) { console.error('espelho despesas (leitura):', e?.message || e); return null; }
}

/** Grava/atualiza as células de um mês. `valores` = { categoria: total } */
export async function gravarEspelho(supabase, ano, mes, valores, origem = 'tela') {
  try {
    const linhas = Object.entries(valores || {})
      .filter(([cat]) => !!cat)
      .map(([categoria, valor]) => ({
        ano, mes, categoria,
        valor: Math.round((Number(valor) || 0) * 100) / 100,
        atualizado_em: new Date().toISOString(),
        atualizado_por: usuarioAtual(),
        origem,
      }));
    if (!linhas.length) return false;
    const { error } = await supabase.from(TABELA).upsert(linhas, { onConflict: 'ano,mes,categoria' });
    if (error) throw error;
    return true;
  } catch (e) { console.error('espelho despesas (gravacao):', e?.message || e); return false; }
}

/**
 * Compara a tela com o espelho. Devolve { [categoria]: { espelho, atual, diff, quando, quem } }
 * só das categorias em que o espelho tem valor MAIOR que a tela — que é o caso de
 * perda. Valor maior na tela é lançamento novo e não vira alerta.
 * `toleranciaCentavos` evita ruído de arredondamento.
 */
export function compararComEspelho(espelho, totaisAtuais, toleranciaCentavos = 1) {
  const out = {};
  if (!espelho) return out;
  for (const [cat, reg] of Object.entries(espelho)) {
    const esp = Number(reg?.valor) || 0;
    const atual = Number(totaisAtuais?.[cat]) || 0;
    const diff = Math.round((esp - atual) * 100) / 100;
    if (diff > toleranciaCentavos / 100) {
      out[cat] = { espelho: esp, atual, diff, quando: reg.atualizado_em, quem: reg.atualizado_por };
    }
  }
  return out;
}
