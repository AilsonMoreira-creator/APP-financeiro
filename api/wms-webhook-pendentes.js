/**
 * wms-webhook-pendentes.js — completa no espelho os pedidos que o WEBHOOK do
 * Bling anunciou mas que ainda não existiam aqui (evento com aplicado=false e
 * detalhe "pedido fora do espelho").
 *
 * Por que existe (Ailson 27/08/2026): o webhook responde em <5s e por isso não
 * chama o Bling — ele só registra o aviso. Sem este processador, pedido NOVO
 * dependia da varredura completa (minutos) e era o que deixava a tela de
 * impressão lenta ao abrir. Aqui a busca é CIRÚRGICA: 1 chamada por pedido
 * anunciado, poucas dezenas por dia, em vez de varrer as 3 contas inteiras.
 *
 * Roda por cron curto; é idempotente (marca o evento como aplicado) e nunca
 * duplica linha (upsert por conta+pedido_id, igual ao wms-sync).
 */
import { supabase, parseDescricao, parseCanal, blingFetch, refreshBlingToken } from './_bling-helpers.js';

const CONTAS = ['exitus', 'lumia', 'muniam'];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const r = { pendentes: 0, criados: 0, sem_conta: 0, erros: 0 };

  try {
    // eventos de pedido ainda não aplicados (o webhook marcou como novos)
    const { data: evs } = await supabase
      .from('bling_webhook_eventos')
      .select('id, recurso_id, company_id, conta, payload, criado_em')
      .eq('aplicado', false)
      .like('evento', 'order.%')
      .gte('criado_em', new Date(Date.now() - 6 * 3600000).toISOString())
      .order('criado_em', { ascending: true })
      .limit(40);

    const lista = evs || [];
    r.pendentes = lista.length;
    if (!lista.length) return res.status(200).json({ ok: true, ...r, msg: 'nada pendente' });

    // um pedido pode ter vários eventos (created + updated): processa uma vez
    const porRecurso = new Map();
    for (const e of lista) {
      if (!porRecurso.has(e.recurso_id)) porRecurso.set(e.recurso_id, []);
      porRecurso.get(e.recurso_id).push(e);
    }

    // aprende a conta pelo companyId já visto em eventos anteriores
    const contaDeCompany = new Map();
    const { data: jaSabidos } = await supabase
      .from('bling_webhook_eventos')
      .select('company_id, conta')
      .not('conta', 'is', null)
      .limit(200);
    for (const x of (jaSabidos || [])) if (x.company_id) contaDeCompany.set(x.company_id, x.conta);

    const tokens = {};
    for (const [recursoId, eventos] of porRecurso) {
      const ev = eventos[eventos.length - 1];   // o mais recente manda
      try {
        // já existe? (o cron pode ter criado no meio tempo)
        const { data: existe } = await supabase.from('wms_pedidos')
          .select('pedido_id').eq('pedido_id', recursoId).maybeSingle();
        if (existe) {
          await supabase.from('bling_webhook_eventos')
            .update({ aplicado: true, detalhe: 'ja estava no espelho' })
            .in('id', eventos.map(x => x.id));
          continue;
        }

        // descobre a conta: memorizada pelo companyId, senão tenta uma a uma
        const candidatas = contaDeCompany.has(ev.company_id)
          ? [contaDeCompany.get(ev.company_id)] : CONTAS;

        let criado = false;
        for (const conta of candidatas) {
          if (!tokens[conta]) tokens[conta] = await refreshBlingToken(conta);
          const headers = { Authorization: `Bearer ${tokens[conta]}` };
          const dr = await blingFetch(`https://api.bling.com.br/Api/v3/pedidos/vendas/${recursoId}`, headers, { maxRetries: 1, baseDelay: 1500 });
          if (!dr.ok) continue;                 // não é dessa conta (404) — tenta a próxima
          const det = await dr.json();
          const ped = det.data || det;
          if (!ped?.id) continue;

          const lj = ped.loja || {};
          // 27/08 (auditoria): o DETALHE do Bling nao devolve o nome da loja
          // (so o id) — sem isso a coluna ficava vazia. Cai pro canal detectado.
          let lojaNome = lj.descricao || lj.nome || '';
          const canal = parseCanal(lojaNome, {
            lojaId: lj.id, intermediador: ped.intermediador,
            numeroPedidoLoja: ped.numeroPedidoLoja, contato: ped.contato,
          });
          const itens = []; let qtdPecas = 0;
          for (const item of (ped.itens || [])) {
            const pp = parseDescricao(item.descricao);
            const qtd = parseInt(item.quantidade) || 1;
            qtdPecas += qtd;
            itens.push({
              codigo: item.codigo || '', descricao: item.descricao || '',
              quantidade: qtd, ref: pp.ref, cor: pp.cor, tamanho: pp.tamanho,
              estoque: pp.estoque, descLimpa: pp.descLimpa,
            });
          }
          const skusDistintos = new Set(itens.map(i => i.codigo || (i.ref + '|' + i.cor + '|' + i.tamanho))).size;
          if (!lojaNome) lojaNome = canal.detalhe || canal.geral || '';
          const sitId = Number(ped.situacao?.id ?? ev.payload?.data?.situacao?.id ?? 0) || null;
          const statusInicial = sitId === 9 ? 'finalizado' : 'aberto';
          // idem pro nome da situacao: o detalhe so traz o id
          const NOMES_SIT = { 6: 'em aberto', 9: 'atendido', 12: 'cancelado', 15: 'verificado', 24: 'em andamento' };
          const sitNome = ped.situacao?.nome ? String(ped.situacao.nome).toLowerCase() : (NOMES_SIT[sitId] || null);

          await supabase.from('wms_pedidos').upsert({
            status_wms: statusInicial,
            finalizado_em: statusInicial === 'finalizado' ? new Date().toISOString() : null,
            conta, pedido_id: ped.id, numero: String(ped.numero || ''),
            numero_loja: ped.numeroLoja || ped.numeroPedidoLoja || null,
            servico_frete: ped.transporte?.volumes?.[0]?.servico || null,
            data_pedido: (ped.data || '').slice(0, 10) || null,
            situacao_bling: sitId, situacao_nome: sitNome,
            loja_nome: lojaNome || '', loja_id: lj.id || null,
            canal_geral: canal.geral, canal_detalhe: canal.detalhe,
            cliente_nome: ped.contato?.nome || '',
            itens, qtd_skus: skusDistintos, qtd_pecas: qtdPecas,
            multi_sku: skusDistintos > 1,
            visto_em: new Date().toISOString(), atualizado_em: new Date().toISOString(),
          }, { onConflict: 'conta,pedido_id' });

          contaDeCompany.set(ev.company_id, conta);
          await supabase.from('bling_webhook_eventos')
            .update({ aplicado: true, conta, detalhe: `criado pelo webhook (pedido ${ped.numero})` })
            .in('id', eventos.map(x => x.id));
          r.criados++; criado = true;
          break;
        }
        if (!criado) { r.sem_conta++; }
        await new Promise(x => setTimeout(x, 300));
      } catch (e) {
        r.erros++;
        console.warn('[webhook-pendentes]', recursoId, e?.message);
      }
    }

    return res.status(200).json({ ok: true, ...r });
  } catch (e) {
    return res.status(500).json({ erro: e?.message || 'falhou' });
  }
}
