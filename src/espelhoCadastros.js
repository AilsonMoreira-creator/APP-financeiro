/**
 * espelhoCadastros.js — espelho dos CADASTROS (produtos, tecidos, oficinas) e
 * dos cards da Calculadora. Ailson 18/09/2026.
 *
 * POR QUE: o payload `amicia_data` é salvo inteiro por cada aparelho. Um aparelho
 * com a tela aberta desde antes salva a versão dele por cima e leva junto o que
 * foi cadastrado em outro lugar — foi assim que as cores dos tecidos escolhidas
 * no celular sumiram em 17/09.
 *
 * DIFERENÇA PRO ESPELHO DE DESPESAS: aqui a restauração é AUTOMÁTICA. Cadastro é
 * pequeno e muda pouco, então registro que sumiu do payload volta sozinho e campo
 * divergente vale o do espelho (que tem carimbo mais novo).
 *
 * REGRAS:
 *  1. Espelho nunca some por ausência no payload — só com exclusão explícita,
 *     que grava `excluido_em` (mesmo desenho do espelho de cortes).
 *  2. Toda gravação leva carimbo; a restauração compara por carimbo, não por
 *     valor, pra não desfazer edição legítima nem gerar falso positivo.
 *  3. Best-effort: qualquer falha aqui é silenciosa e nunca trava a tela.
 */

const CFG = {
  produtos: { tabela: 'cadastro_produtos_espelho', chave: 'ref',    norm: r => String(r.ref || '').trim() },
  tecidos:  { tabela: 'cadastro_tecidos_espelho',  chave: 'id',     norm: r => r.id },
  oficinas: { tabela: 'cadastro_oficinas_espelho', chave: 'codigo', norm: r => String(r.codigo || '').trim() },
};

function quem() {
  try { const s = JSON.parse(localStorage.getItem('amica_session') || '{}'); return s.usuario || s.nome || null; }
  catch { return null; }
}

function linhaDe(tipo, reg) {
  const base = { dados: reg, atualizado_em: new Date().toISOString(), atualizado_por: quem() };
  if (tipo === 'produtos') return { ...base, ref: String(reg.ref || '').trim(), descricao: reg.descricao ?? null, marca: reg.marca ?? null, tecido: reg.tecido ?? null, valor_unit: Number(reg.valorUnit) || 0 };
  if (tipo === 'tecidos')  return { ...base, id: reg.id, descricao: reg.descricao ?? null, metragem_rolo: Number(reg.metragemRolo) || 0, valor_metro: Number(reg.valorMetro) || 0, cor: reg.cor ?? null };
  return { ...base, codigo: String(reg.codigo || '').trim(), descricao: reg.descricao ?? null };
}

/** Grava a lista inteira do cadastro no espelho (upsert, sem apagar nada). */
export async function gravarCadastro(supabase, tipo, lista) {
  const cfg = CFG[tipo]; if (!cfg) return false;
  try {
    const linhas = (lista || []).filter(r => cfg.norm(r) !== '' && cfg.norm(r) != null).map(r => linhaDe(tipo, r));
    if (!linhas.length) return false;
    const { error } = await supabase.from(cfg.tabela).upsert(linhas, { onConflict: cfg.chave });
    if (error) throw error;
    return true;
  } catch (e) { console.error(`espelho ${tipo} (gravacao):`, e?.message || e); return false; }
}

/** Marca exclusão explícita — só assim o registro para de ser restaurado. */
export async function marcarExcluido(supabase, tipo, chaveValor) {
  const cfg = CFG[tipo]; if (!cfg) return false;
  try {
    const { error } = await supabase.from(cfg.tabela)
      .update({ excluido_em: new Date().toISOString(), excluido_por: quem() })
      .eq(cfg.chave, chaveValor);
    if (error) throw error;
    return true;
  } catch (e) { console.error(`espelho ${tipo} (exclusao):`, e?.message || e); return false; }
}

/**
 * Lê o espelho e devolve a lista restaurada + o que mudou.
 * - registro do espelho que sumiu da tela → volta
 * - registro presente nos dois → vale o do espelho quando o carimbo dele é mais
 *   novo que a última gravação conhecida da tela (parâmetro `desdeISO`); sem esse
 *   dado, só completa campos que estão vazios/ausentes na tela (caso das cores).
 */
export async function restaurarCadastro(supabase, tipo, listaAtual, desdeISO = null) {
  const cfg = CFG[tipo]; if (!cfg) return { lista: listaAtual, restaurados: [], campos: [] };
  try {
    const { data, error } = await supabase.from(cfg.tabela).select('*').is('excluido_em', null);
    if (error) throw error;
    const porChave = new Map((listaAtual || []).map(r => [String(cfg.norm(r)), r]));
    const restaurados = [], campos = [];
    for (const linha of (data || [])) {
      const k = String(linha[cfg.chave]);
      const reg = linha.dados && typeof linha.dados === 'object' ? linha.dados : null;
      if (!reg) continue;
      const atual = porChave.get(k);
      if (!atual) { porChave.set(k, reg); restaurados.push(k); continue; }
      const maisNovo = desdeISO ? (linha.atualizado_em > desdeISO) : false;
      const merge = { ...atual };
      let mudou = false;
      for (const [campo, valor] of Object.entries(reg)) {
        const vazio = merge[campo] === undefined || merge[campo] === null || merge[campo] === '';
        if (valor !== undefined && valor !== null && valor !== '' && (vazio || (maisNovo && merge[campo] !== valor))) {
          merge[campo] = valor; mudou = true;
        }
      }
      if (mudou) { porChave.set(k, merge); campos.push(k); }
    }
    return { lista: [...porChave.values()], restaurados, campos };
  } catch (e) { console.error(`espelho ${tipo} (restauracao):`, e?.message || e); return { lista: listaAtual, restaurados: [], campos: [] }; }
}

// ── Calculadora: um card por REF ───────────────────────────────────────────────
export async function gravarCardsCalc(supabase, prods, origem = 'calc-meluni') {
  try {
    const linhas = (prods || []).filter(p => String(p.ref || '').trim()).map(p => ({
      origem, ref: String(p.ref).trim(), descricao: p.descricao ?? null, marca: p.marca ?? null,
      dados: p, atualizado_em: new Date().toISOString(), atualizado_por: quem(),
    }));
    if (!linhas.length) return false;
    const { error } = await supabase.from('calculadora_cards_espelho').upsert(linhas, { onConflict: 'origem,ref' });
    if (error) throw error;
    return true;
  } catch (e) { console.error('espelho calculadora (gravacao):', e?.message || e); return false; }
}

export async function restaurarCardsCalc(supabase, prods, origem = 'calc-meluni') {
  try {
    const { data, error } = await supabase.from('calculadora_cards_espelho')
      .select('*').eq('origem', origem).is('excluido_em', null);
    if (error) throw error;
    const porRef = new Map((prods || []).map(p => [String(p.ref || '').trim(), p]));
    const restaurados = [];
    for (const linha of (data || [])) {
      const ref = String(linha.ref);
      const reg = linha.dados && typeof linha.dados === 'object' ? linha.dados : null;
      if (!reg) continue;
      if (!porRef.has(ref)) { porRef.set(ref, reg); restaurados.push(ref); continue; }
      const atual = porRef.get(ref); const merge = { ...atual }; let mudou = false;
      for (const [campo, valor] of Object.entries(reg)) {
        const vazio = merge[campo] === undefined || merge[campo] === null || merge[campo] === '';
        if (vazio && valor !== undefined && valor !== null && valor !== '') { merge[campo] = valor; mudou = true; }
      }
      if (mudou) { porRef.set(ref, merge); restaurados.push(ref); }
    }
    return { prods: [...porRef.values()], restaurados };
  } catch (e) { console.error('espelho calculadora (restauracao):', e?.message || e); return { prods, restaurados: [] }; }
}
