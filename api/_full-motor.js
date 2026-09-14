/**
 * _full-motor.js — recomendação de envio pro Full do ML (Ailson 17/08/2026)
 *
 * As regras são DELE, e ficam em full_regras (editáveis sem mexer no código):
 *   demanda  = venda/dia dos últimos 14 dias somando TODAS as plataformas
 *              (a REF 2782 rosa vende no Clássico e nunca foi pro Full — se
 *              olhasse só o Full, nunca seria recomendada)
 *   alvo     = 14 dias + 5 de trânsito (20 + 5 pra bege e preto)
 *   ideal    = demanda × alvo × fator sazonal − estoque no Full − em trânsito
 *   possível = min(ideal, teto do estoque da fábrica)
 *   teto     = 25% do estoque do SKU · 50% se há corte chegando em ≤5 dias E o
 *              que sobra cobre a loja até o corte chegar
 *   piso     = 3 peças (abaixo disso não envia)
 *   arredonda (14/09): final 1/2/6 desce, 3/4/7/8/9 sobe, múltiplos de 5
 */
import { supabase } from './_bling-helpers.js';

const n = (v) => Number(v) || 0;
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

export function arredondar(q, ehBasica = false) {
  // 14/09 (regra dele, substitui a de 18/08): 6 vira 5 · 7 vira 10 · final 1
  // arredonda pra baixo (41 → 40). Regra geral pelo último algarismo:
  // 1, 2 e 6 descem pro múltiplo de 5 anterior · 3, 4, 7, 8 e 9 sobem pro
  // próximo · 0 e 5 ficam. Piso de 3 continua (menos de 3 não vai);
  // 3 fica 3 (preto e bege, sempre múltiplo de 5: 3 e 4 viram 5).
  q = Math.round(Number(q) || 0);
  if (q < 3) return 0;
  if (q === 3) return ehBasica ? 5 : 3;
  const d = q % 10;
  if (d === 0 || d === 5) return q;
  if (d === 1 || d === 2 || d === 6) return Math.floor(q / 5) * 5;
  return Math.ceil(q / 5) * 5;
}

export async function lerRegras() {
  const { data } = await supabase.from('full_regras').select('chave, valor');
  const r = {};
  for (const x of (data || [])) r[x.chave] = x.valor;
  return r;
}

/** fator sazonal do dia + reforço de cores da janela de Natal */
export function fatorSazonal(regras, cor, hoje = new Date()) {
  const md = `${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;
  const dentro = (de, ate) => (de <= ate ? (md >= de && md <= ate) : (md >= de || md <= ate));
  let fator = 1;
  const nota = [];
  for (const j of (regras.calendario || [])) {
    if (!dentro(j.de, j.ate)) continue;
    if (j.cores && !j.cores.some(c => norm(cor).includes(norm(c)))) continue;
    fator *= n(j.fator) || 1;
    nota.push(j.nome);
  }
  return { fator, janelas: nota };
}

/** marrom e marinho fora de estação: só seguem com venda mínima */
export function foraDeEstacao(regras, cor, hoje = new Date()) {
  const fim = String(regras.fim_inverno || '09-01').replace(/"/g, '');
  const md = `${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;
  const invernoAcabou = md >= fim && md < '12-21';
  const ehInverno = /marrom|marinho/.test(norm(cor));
  return invernoAcabou && ehInverno;
}

/**
 * Calcula a linha de um SKU.
 * dados: { cor, tam, vendaDia, estoqueFull, estoqueFabrica, emTransito,
 *          corteChegando, diasAteCorte, jaNoFull }
 */
export function calcularLinha(dados, regras, hoje = new Date()) {
  const {
    cor, tam, vendaDia, estoqueFull, estoqueFabrica,
    emTransito = 0, corteChegando = 0, diasAteCorte = 99, jaNoFull = true,
    vendaSemanaCor = null,   // venda da COR inteira (soma dos tamanhos)
  } = dados;

  // 17/08 (correção): os gatilhos de entrada no Full e de permanência fora de
  // estação são POR COR, somando os tamanhos — foi assim que ele descreveu
  // ("uma cor que vender 12 peças/semana no geral já vale ir pro Full").
  // Aplicando por SKU, a Rosa Claro (22/semana espalhados nos 4 tamanhos)
  // era barrada em todos eles.
  const semanaCor = vendaSemanaCor != null ? vendaSemanaCor : vendaDia * 7;

  const basicas = (regras.cores_basicas || ['bege', 'preto']).map(norm);
  const ehBasica = basicas.some(b => norm(cor).includes(b));
  const cobertura = n(ehBasica ? regras.cobertura_basicas : regras.cobertura_dias) || 14;
  const transito = n(regras.transito_dias) || 5;
  const alvoDias = cobertura + transito;                 // o trânsito soma

  const { fator, janelas } = fatorSazonal(regras, cor, hoje);
  const motivos = [];

  // fora de estação: marrom e marinho só com venda mínima na semana
  if (foraDeEstacao(regras, cor, hoje)) {
    const minSemana = n(regras.manter_fora_estacao_semana) || 6;
    if (semanaCor < minSemana) {
      return {
        cor, tam, vendaDia, estoqueFull, estoqueFabrica,
        cobertura_atual: vendaDia > 0 ? +(estoqueFull / vendaDia).toFixed(1) : null,
        qtd_ideal: 0, qtd_possivel: 0, qtd_sugerida: 0,
        motivo: `fora de estação: a cor vende ${semanaCor.toFixed(1)}/semana (mínimo ${minSemana}) — não repor`,
      };
    }
    motivos.push('fora de estação, mas mantém venda');
  }

  // cor que ainda não está no Full precisa de venda mínima pra entrar
  if (!jaNoFull) {
    const minEntrada = n(regras.entrada_nova_cor_semana) || 12;
    if (semanaCor < minEntrada) {
      return {
        cor, tam, vendaDia, estoqueFull, estoqueFabrica,
        cobertura_atual: null, qtd_ideal: 0, qtd_possivel: 0, qtd_sugerida: 0,
        motivo: `cor fora do Full vendendo ${semanaCor.toFixed(1)}/semana (entra com ${minEntrada})`,
      };
    }
    motivos.push('cor nova no Full: vende bem nos outros canais');
  }

  // ── ideal ──
  const necessario = vendaDia * alvoDias * fator;
  const idealBruto = Math.max(0, necessario - estoqueFull - emTransito);
  const qtd_ideal = Math.ceil(idealBruto);

  // ── teto do estoque da fábrica ──
  const temCorteProximo = corteChegando > 0 && diasAteCorte <= 5;
  let tetoPct = n(regras.teto_estoque_pct) || 25;
  if (temCorteProximo) {
    // só sobe pra 50% se o que sobrar cobrir a loja até o corte chegar
    const sobraCom50 = estoqueFabrica * 0.5;
    const precisaAteCorte = vendaDia * diasAteCorte;
    if (sobraCom50 >= precisaAteCorte) {
      tetoPct = n(regras.teto_com_corte_pct) || 50;
      motivos.push(`corte de ${corteChegando} chega em ${diasAteCorte}d — pode enviar até ${tetoPct}%`);
    } else {
      motivos.push('corte a caminho, mas o estoque não cobre a loja até lá');
    }
  }
  const teto = Math.floor(estoqueFabrica * (tetoPct / 100));
  const qtd_possivel = Math.max(0, Math.min(qtd_ideal, teto));
  let qtd_sugerida = arredondar(qtd_possivel, ehBasica);
  // 13/09 (regra dele): quando JA VAI TER ENVIO, a quantidade tem que cobrir
  // pelo menos as vendas dos proximos 10 dias — sempre que o estoque da
  // fabrica (teto) permitir.
  const piso10 = Math.ceil(vendaDia * 10);
  if (qtd_sugerida > 0 && qtd_sugerida < piso10) {
    const alvo = Math.min(piso10, teto);
    if (alvo > qtd_sugerida) {
      qtd_sugerida = Math.max(qtd_sugerida, arredondar(alvo, ehBasica));   // 14/09: o arredondamento vale também depois do piso (41 → 40, 6 → 5)
      motivos.push(`subiu pra cobrir os próximos 10 dias (${piso10} pç)`);
    }
  }

  // ── motivo em uma frase ──
  const coberturaAtual = vendaDia > 0 ? +(estoqueFull / vendaDia).toFixed(1) : null;
  if (qtd_ideal > qtd_possivel && qtd_possivel > 0) {
    motivos.unshift(`limitado pelo estoque: ideal ${qtd_ideal}, teto ${tetoPct}% da fábrica`);
  } else if (qtd_sugerida === 0 && qtd_ideal > 0) {
    motivos.unshift(qtd_possivel < 3 ? 'daria menos de 3 peças — não compensa enviar' : 'sem estoque na fábrica');
  } else if (qtd_sugerida > 0) {
    motivos.unshift(`cobre ${(alvoDias)}d vendendo ${vendaDia.toFixed(1)}/dia`);
  } else {
    motivos.unshift(`já tem ${coberturaAtual ?? '—'} dias no Full`);
  }
  if (janelas.length) motivos.push(janelas.join(' + '));
  if (ehBasica) motivos.push('cor básica: cobertura de 20 dias');

  return {
    cor, tam, vendaDia: +vendaDia.toFixed(2), estoqueFull, estoqueFabrica, emTransito,
    cobertura_atual: coberturaAtual, alvo_dias: alvoDias, fator_sazonal: +fator.toFixed(2),
    qtd_ideal, qtd_possivel, qtd_sugerida,
    motivo: motivos.join(' · '),
  };
}
