/**
 * bling-backfill-numero-loja.js — preenche `numero_pedido_loja` nos pedidos que
 * já estão em bling_vendas_detalhe (Ailson 08/08/2026).
 *
 * Por que existe: o insert antigo lia `numeroPedidoLoja`, campo que o Bling v3
 * NUNCA preenche — o certo é `numeroLoja`. Resultado: 922 de 989 pedidos do ML
 * deste mês estão sem o número, e sem ele não dá pra cruzar com a API do
 * Mercado Livre (nem com a da Shopee) pra pegar taxa e desconto reais.
 *
 * A LISTAGEM de pedidos do v3 já devolve numeroLoja, então o backfill não
 * precisa re-detalhar pedido por pedido: 1 chamada por página de 100.
 *
 * Query:
 *   ?desde=YYYY-MM-DD  (default: 1º dia do mês corrente)
 *   ?ate=YYYY-MM-DD    (default: hoje)
 *   ?conta=exitus      (default: as 3)
 *   ?dry=1             só conta o que preencheria
 */
import { supabase, blingFetch, refreshBlingToken } from './_bling-helpers.js';

export const config = { maxDuration: 300 };

const CONTAS = ['exitus', 'lumia', 'muniam'];
const DELAY_MS = 120;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const inicio = Date.now();
  const hoje = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
  const desde = /^\d{4}-\d{2}-\d{2}$/.test(req.query?.desde || '')
    ? req.query.desde : hoje.slice(0, 8) + '01';
  const ate = /^\d{4}-\d{2}-\d{2}$/.test(req.query?.ate || '') ? req.query.ate : hoje;
  const contaFiltro = req.query?.conta || null;
  const dry = req.query?.dry === '1';

  const resumo = { janela: `${desde} a ${ate}`, dry, por_conta: {} };

  for (const conta of CONTAS) {
    if (contaFiltro && conta !== contaFiltro) continue;
    const r = { listados: 0, com_numero: 0, atualizados: 0, ja_tinham: 0, fora_do_banco: 0 };
    resumo.por_conta[conta] = r;

    let token;
    try { token = await refreshBlingToken(conta); } catch (e) { r.erro = e.message; continue; }
    if (!token) { r.erro = 'sem token'; continue; }
    const headers = { Authorization: 'Bearer ' + token, Accept: 'application/json' };

    // pedidos já gravados SEM número, pra saber quem precisa de update
    const pendentes = new Map();
    for (let off = 0; ; off += 1000) {
      const { data, error } = await supabase.from('bling_vendas_detalhe')
        .select('pedido_id')
        .eq('conta', conta).is('numero_pedido_loja', null)
        .gte('data_pedido', desde).lte('data_pedido', ate)
        .range(off, off + 999);
      if (error) { r.erro = error.message; break; }
      (data || []).forEach(x => pendentes.set(String(x.pedido_id), true));
      if (!data || data.length < 1000) break;
    }
    r.pendentes = pendentes.size;
    if (!pendentes.size) continue;

    // varre a janela pela LISTAGEM (numeroLoja vem aqui, sem re-detalhar)
    let pagina = 1;
    while (true) {
      if (Date.now() - inicio > 275000) { resumo.parcial = 'tempo esgotado — rode de novo pra continuar'; break; }
      const url = `https://api.bling.com.br/Api/v3/pedidos/vendas?dataInicial=${desde}&dataFinal=${ate}&pagina=${pagina}&limite=100`;
      const resp = await blingFetch(url, headers);
      if (!resp.ok) { r.erro = `listagem ${resp.status}`; break; }
      const d = await resp.json();
      const lote = d.data || [];
      if (!lote.length) break;
      r.listados += lote.length;

      for (const p of lote) {
        const id = String(p.id);
        if (!p.numeroLoja) continue;
        r.com_numero++;
        if (!pendentes.has(id)) { r.ja_tinham++; continue; }
        if (!dry) {
          const { error } = await supabase.from('bling_vendas_detalhe')
            .update({ numero_pedido_loja: String(p.numeroLoja) })
            .eq('conta', conta).eq('pedido_id', p.id);
          if (error) { r.erro = error.message; continue; }
        }
        r.atualizados++;
        pendentes.delete(id);
      }
      if (lote.length < 100) break;
      pagina++;
      await new Promise(x => setTimeout(x, DELAY_MS));
    }
    r.restaram_sem_numero = pendentes.size;
  }

  return res.status(200).json({ ok: true, ...resumo });
}
