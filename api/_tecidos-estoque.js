/**
 * _tecidos-estoque.js — baixa e estorno do estoque de tecido (Ailson 13/08)
 *
 * Regra 1 combinada: a baixa acontece quando a ordem VAI PRA SALA (não na
 * criação, porque ordem criada ainda pode ser editada ou excluída) e é
 * DEVOLVIDA inteira se a ordem sair de lá (voltar status, ser excluída ou
 * cancelada). `ordens_corte.tecido_baixado_em` garante idempotência: baixa
 * uma vez só, estorna uma vez só.
 *
 * Regra 2 combinada: saldo insuficiente AVISA, nunca trava — o corte é a
 * realidade; o estoque se ajusta (fica negativo virtual = 0 e o aviso volta
 * na resposta pra tela mostrar).
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const n = (v) => Number(v) || 0;
const norm = (s) => String(s || '').trim().toLowerCase();

async function acharCores(tecidoNome, cores) {
  const { data: tecidos } = await supabase.from('tecidos').select('id, nome, metragem_rolo');
  const tecido = (tecidos || []).find(t => norm(t.nome) === norm(tecidoNome));
  if (!tecido) return { tecido: null, pares: [] };
  const { data: linhas } = await supabase.from('tecido_cores').select('*').eq('tecido_id', tecido.id);
  const pares = (cores || []).map(c => ({
    pedido: c,
    linha: (linhas || []).find(l => norm(l.nome) === norm(c.nome)) || null,
  }));
  return { tecido, pares };
}

/** Baixa o tecido da ordem. Devolve { baixou, avisos: [] } */
export async function baixarTecidoDaOrdem(ordem, usuario) {
  const avisos = [];
  if (!ordem || ordem.tecido_baixado_em) return { baixou: false, avisos };
  const { tecido, pares } = await acharCores(ordem.tecido, ordem.cores);
  if (!tecido) {
    return { baixou: false, avisos: [`"${ordem.tecido}" ainda não está no estoque de tecido — nada foi abatido.`] };
  }

  for (const { pedido, linha } of pares) {
    const querRolos = n(pedido.rolos);
    if (!querRolos) continue;
    if (!linha) {
      avisos.push(`${pedido.nome}: cor não cadastrada no estoque — não foi abatida.`);
      continue;
    }
    const antes = n(linha.rolos);
    const depois = Math.max(0, antes - querRolos);
    if (antes < querRolos) {
      avisos.push(`${pedido.nome}: pedia ${querRolos} rolo(s) e havia ${antes} — o corte segue, mas confira o estoque.`);
    }
    await supabase.from('tecido_cores').update({ rolos: depois }).eq('id', linha.id);
    await supabase.from('tecido_movimentos').insert({
      tecido_id: tecido.id, cor_id: linha.id, tecido_nome: tecido.nome, cor_nome: linha.nome,
      tipo: 'saida_corte', rolos: -querRolos, rolos_antes: antes, rolos_depois: depois,
      metragem_rolo: tecido.metragem_rolo, ordem_id: ordem.id,
      motivo: `corte REF ${ordem.ref}${ordem.sala ? ' · sala ' + ordem.sala : ''}`, usuario: usuario || 'sistema',
    });
  }
  await supabase.from('ordens_corte').update({ tecido_baixado_em: new Date().toISOString() }).eq('id', ordem.id);
  return { baixou: true, avisos };
}

/** Devolve ao estoque o que a ordem tinha baixado. */
export async function estornarTecidoDaOrdem(ordem, usuario, motivo) {
  if (!ordem || !ordem.tecido_baixado_em) return { estornou: false };
  const { tecido, pares } = await acharCores(ordem.tecido, ordem.cores);
  if (!tecido) return { estornou: false };

  for (const { pedido, linha } of pares) {
    const qtd = n(pedido.rolos);
    if (!qtd || !linha) continue;
    const antes = n(linha.rolos);
    const depois = antes + qtd;
    await supabase.from('tecido_cores').update({ rolos: depois }).eq('id', linha.id);
    await supabase.from('tecido_movimentos').insert({
      tecido_id: tecido.id, cor_id: linha.id, tecido_nome: tecido.nome, cor_nome: linha.nome,
      tipo: 'estorno_corte', rolos: qtd, rolos_antes: antes, rolos_depois: depois,
      metragem_rolo: tecido.metragem_rolo, ordem_id: ordem.id,
      motivo: motivo || `estorno da ordem REF ${ordem.ref}`, usuario: usuario || 'sistema',
    });
  }
  await supabase.from('ordens_corte').update({ tecido_baixado_em: null }).eq('id', ordem.id);
  return { estornou: true };
}
