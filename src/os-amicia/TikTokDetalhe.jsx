/**
 * TikTokDetalhe.jsx — tela "Detalhar" do card TikTok no OS Amícia
 * (Ailson 09/08/2026). Abre como overlay a partir do Card1LucroMes.
 *
 * Seções: resumo de vendas · liquidação (pago × em aberto) · detalhamento de
 * valores (venda − despesas = recebido) · devoluções (campo separado, decisão
 * de 08/08) · canais (orgânico × afiliado × afiliado ads — a API não separa
 * live de vitrine) · estados · top produtos.
 */
import { useCallback, useEffect, useState } from 'react';

export default function TikTokDetalhe({ usuario, onFechar, C, SERIF, CALIBRI }) {
  const [dados, setDados] = useState(null);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState(null);
  const [janela, setJanela] = useState('mes');

  const carregar = useCallback(async (j) => {
    setLoading(true); setErro(null);
    try {
      const r = await fetch(`/api/tts-detalhe?janela=${j}`, { headers: { 'X-User': usuario } });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setDados(d);
    } catch (e) { setErro(e.message); }
    finally { setLoading(false); }
  }, [usuario]);

  useEffect(() => { carregar(janela); }, [carregar, janela]);

  const fmt = (v) => (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pct = (v, base) => base > 0 ? `${((v / base) * 100).toFixed(1)}%` : '—';

  const Secao = ({ titulo, children, nota }) => (
    <div style={{ background: '#fff', border: `1px solid ${C.cream}`, borderRadius: 10, padding: 16, marginBottom: 12 }}>
      <div style={{ fontSize: 11, color: C.muted, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 10, fontFamily: SERIF }}>{titulo}</div>
      {children}
      {nota && <div style={{ fontSize: 10, color: C.muted, marginTop: 8, fontStyle: 'italic' }}>{nota}</div>}
    </div>
  );

  const KPI_CORES = {
    preto: { bg: '#010101', fg: '#fff' },
    azul: { bg: '#dbe9f6', fg: '#1f4e79' },       // pedidos (Ailson 09/08)
    verde: { bg: '#1f7a48', fg: '#fff' },          // vendas pagas
    amarelo: { bg: '#f7ecd0', fg: '#8a6a1a' },     // liquidação em atraso
    neutro: { bg: '#f7f4f0', fg: C.iaDarker },
  };
  const Kpi = ({ label, valor, sub, destaque, cor }) => (
    <div style={{ background: KPI_CORES[cor || (destaque ? 'preto' : 'neutro')].bg, color: KPI_CORES[cor || (destaque ? 'preto' : 'neutro')].fg, borderRadius: 8, padding: 12, border: cor === 'amarelo' ? '1px solid #c8a040' : 'none' }}>
      <div style={{ fontSize: 9, opacity: 0.7, letterSpacing: 1, textTransform: 'uppercase', fontFamily: SERIF }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, marginTop: 2, fontFamily: CALIBRI }}>{valor}</div>
      {sub && <div style={{ fontSize: 10, opacity: 0.75, marginTop: 2 }}>{sub}</div>}
    </div>
  );

  const [expAberta, setExpAberta] = useState(null);
  const Linha = ({ label, valor, base, positivo, forte, exp }) => (
    <div onClick={() => exp && setExpAberta(expAberta === label ? null : label)}
      style={{ padding: '5px 0', borderBottom: `1px dashed ${C.cream}`, fontFamily: CALIBRI, fontSize: 12.5, cursor: exp ? 'pointer' : 'default' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <span style={{ color: forte ? C.iaDarker : '#555', fontWeight: forte ? 700 : 400, flex: 1, minWidth: 0 }}>
          {label}{exp ? <span style={{ color: C.muted, fontSize: 10, marginLeft: 4 }}>ⓘ</span> : null}
        </span>
        <span style={{ fontWeight: forte ? 800 : 600, whiteSpace: 'nowrap', color: forte ? C.iaDarker : (positivo ? '#1f7a48' : '#a04040') }}>
          {positivo ? '+' : '−'} R$ {fmt(Math.abs(valor))}
          {base ? <span style={{ color: C.muted, fontWeight: 400, fontSize: 10.5, marginLeft: 5 }}>{pct(Math.abs(valor), base)}</span> : null}
        </span>
      </div>
      {exp && expAberta === label && (
        <div style={{ fontSize: 11, color: C.muted, marginTop: 4, lineHeight: 1.45, fontStyle: 'italic' }}>{exp}</div>
      )}
    </div>
  );

  const d = dados;
  const fin = d?.detalhamento;
  const freteLiquido = fin ? fin.frete_real - fin.frete_cliente - fin.subsidio_frete : 0;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(20,15,10,0.55)', zIndex: 400, display: 'flex', justifyContent: 'center', overflowY: 'auto', padding: '20px 8px' }} onClick={onFechar}>
      <div style={{ background: '#f7f4f0', borderRadius: 14, maxWidth: 680, width: '100%', height: 'fit-content', padding: 18, fontFamily: SERIF }} onClick={e => e.stopPropagation()}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 10, color: C.muted, letterSpacing: 1.5, textTransform: 'uppercase' }}>TikTok Shop · Exitus.Bras</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: C.iaDarker }}>Detalhamento do canal</div>
          </div>
          <button onClick={onFechar} style={{ background: 'transparent', border: `1px solid ${C.cream}`, borderRadius: 8, padding: '6px 14px', cursor: 'pointer', color: C.muted, fontFamily: SERIF }}>✕ Fechar</button>
        </div>

        <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
          {[['mes', 'Mês atual'], ['30', '30 dias'], ['60', '60 dias'], ['90', '90 dias']].map(([v, l]) => (
            <button key={v} onClick={() => setJanela(v)} disabled={loading}
              style={{ flex: 1, padding: '7px 0', borderRadius: 8, border: `1px solid ${janela === v ? '#010101' : C.cream}`,
                background: janela === v ? '#010101' : '#fff', color: janela === v ? '#fff' : C.muted,
                fontSize: 12, cursor: 'pointer', fontFamily: SERIF }}>{l}</button>
          ))}
        </div>

        {erro && <div style={{ color: C.critical, fontSize: 13, padding: 14 }}>❌ {erro}</div>}
        {loading && <div style={{ color: C.muted, fontSize: 13, padding: 14, textAlign: 'center' }}>Buscando na API do TikTok…</div>}

        {d && !loading && (
          <>
            <Secao titulo={`Vendas · ${d.de} → ${d.ate}`}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 }}>
                <Kpi label="Pedidos" valor={d.resumo.pagaveis} sub={`${d.resumo.unidades} un`} cor="azul" />
                <Kpi label="Vendas" valor={`R$ ${fmt(d.resumo.vendas)}`} sub={`ticket R$ ${fmt(d.resumo.ticket_medio)}`} />
                <Kpi label="Amostras grátis" valor={d.resumo.amostras} sub="fora do lucro" />
                <Kpi label="Devoluções no período" valor={`R$ ${fmt(d.devolucoes?.valor_devolvido || 0)}`} sub={`${d.devolucoes?.qtd || 0} devoluções · já fora da venda`} />
              </div>
            </Secao>

            <Secao titulo="Repasses · liquidação">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
                <Kpi label="Vendas pagas" valor={d.liquidacao.liquidados} sub={`R$ ${fmt(d.liquidacao.recebido)} recebidos`} cor="verde" />
                <Kpi label="Em aberto" valor={d.liquidacao.em_aberto} sub={`~R$ ${fmt(d.liquidacao.em_aberto_previsto)} previstos (${fmt(d.liquidacao.ratio_pago_pct)}% de R$ ${fmt(d.liquidacao.em_aberto_vendas)})`} />
                {d.liquidacao.em_atraso > 0 && (
                  <Kpi label="Liquidação em atraso" cor="amarelo" valor={d.liquidacao.em_atraso}
                    sub={`R$ ${fmt(d.liquidacao.em_atraso_vendas)} · em aberto há mais de ${d.liquidacao.atraso_limite_dias} dias (30% acima da média de ${d.liquidacao.prazo_medio_dias})`} />
                )}
                <Kpi label="Depositado últimos 30d" valor={`R$ ${fmt(d.liquidacao.depositado_30d)}`} sub={`${d.liquidacao.depositado_30d_pedidos} vendas`} />
                <Kpi label="Prazo médio" valor={d.liquidacao.prazo_medio_dias != null ? `${d.liquidacao.prazo_medio_dias} dias` : '—'} sub="pedido → depósito" />
              </div>
            </Secao>

            {fin && (
              <Secao titulo="Detalhamento de valores · vendas liquidadas" nota="Toque em uma linha ⓘ pra ver a explicação. Frete debitado já vem líquido do subsídio do TikTok e inclui a taxa fixa por item (R$ 4 até jul, R$ 6 em ago).">
                <Linha label="Valor de venda (líquido de devoluções)" valor={fin.venda} positivo forte
                  exp="Soma das vendas liquidadas no período, já sem as devolvidas. As devoluções aparecem no card do topo e na linha própria abaixo." />
                {fin.desconto_vendedor > 0 && <Linha label="Desconto do vendedor" valor={fin.desconto_vendedor} base={fin.venda}
                  exp="Desconto das SUAS campanhas (5%, 10% ou 15%). Sai do seu repasse. O desconto que o TikTok dá ao cliente não entra aqui — é bancado por eles." />}
                <Linha label="Comissão TikTok" valor={fin.comissao} base={fin.venda}
                  exp="Comissão da plataforma, ~6% sobre o preço cheio do produto." />
                {fin.afiliado_creator > 0 && <Linha label="Comissão de afiliado (creator)" valor={fin.afiliado_creator} base={fin.venda}
                  exp="Comissão do creator que vendeu por vídeo ou live. Você define o percentual — hoje ~10% nos produtos com afiliado." />}
                {fin.afiliado_ads > 0 && <Linha label="Comissão de afiliado (ads/parceiro)" valor={fin.afiliado_ads} base={fin.venda}
                  exp="Comissão de campanhas de afiliado via anúncios ou agência parceira." />}
                {fin.taxa_transacao > 0 && <Linha label="Taxa de transação" valor={fin.taxa_transacao} base={fin.venda}
                  exp="Tarifa de processamento do pagamento." />}
                <Linha label="Frete debitado pelo TikTok" valor={fin.frete_debitado} base={fin.venda}
                  exp="Frete real menos o subsídio do TikTok. A taxa fixa por item (R$ 4 até jul, R$ 6 em ago) está embutida aqui." />
                <div style={{ fontSize: 11, color: C.muted, padding: '4px 0', fontFamily: CALIBRI }}>
                  → frete real R$ {fmt(fin.frete_real)} · cliente pagou R$ {fmt(fin.frete_cliente)} · TikTok subsidiou R$ {fmt(fin.subsidio_frete)}
                </div>
                {Math.abs(fin.frete_cliente_e_ajustes || 0) >= 0.01 && <Linha label="Frete do cliente e ajustes" valor={fin.frete_cliente_e_ajustes} base={fin.venda} positivo={fin.frete_cliente_e_ajustes > 0}
                  exp="Créditos e débitos que o TikTok não abre em campo próprio — principalmente o frete pago pelo cliente, que é repassado a você, e tarifas ou subsídios menores." />}
                <Linha label="Recebido após todos os descontos" valor={fin.recebido} base={fin.venda} positivo forte
                  exp="O que o TikTok deposita pelas vendas pagas do período." />
                {fin.devolucoes_debito > 0 && <Linha label="Devoluções · estornos e logística reversa" valor={fin.devolucoes_debito} base={fin.venda}
                  exp="O que sai do seu bolso com as devoluções: frete reverso e débitos de estorno lançados pelo TikTok." />}
                <Linha label="Imposto (11% da venda)" valor={fin.imposto} base={fin.venda}
                  exp="Sua régua: 11% sobre a venda líquida de devoluções." />
                <Linha label="Agência (5% da venda)" valor={fin.agencia} base={fin.venda}
                  exp="Sua régua: 5% sobre a venda líquida, do contrato com a agência de TikTok." />
                <Linha label="Total após imposto e agência" valor={fin.liquido_pos_imposto} base={fin.venda} positivo forte />
                <Linha label="CMV · custo da mercadoria" valor={fin.cmv?.total || 0} base={fin.venda}
                  exp="Custo de produção (da calculadora) das peças vendidas e pagas. Mercadoria devolvida volta pro estoque e não entra." />
                {fin.cmv?.estimado > 0 && (
                  <div style={{ fontSize: 10.5, color: C.muted, padding: '2px 0', fontFamily: CALIBRI }}>
                    → R$ {fmt(fin.cmv.exato)} exato ({fin.cmv.un_com_custo} un) + R$ {fmt(fin.cmv.estimado)} estimado ({fin.cmv.vendas_sem_vinculo} vendas sem vínculo no Bling)
                  </div>
                )}
                <Linha label="Resultado final" valor={fin.resultado_final} base={fin.venda} positivo={fin.resultado_final >= 0} forte
                  exp="O que sobra no bolso depois de tudo: repasse − devoluções − imposto − agência − custo da mercadoria." />
                {fin.desconto_plataforma > 0 && (
                  <div style={{ fontSize: 11, color: '#1f7a48', marginTop: 8, fontFamily: CALIBRI }}>
                    ℹ Desconto da plataforma: R$ {fmt(fin.desconto_plataforma)} dados ao cliente — bancados pelo TikTok, não saem do seu repasse.
                  </div>
                )}
              </Secao>
            )}

            <Secao titulo="Devoluções · campo separado">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
                <Kpi label="Devoluções" valor={d.devolucoes.qtd} sub={pct(d.devolucoes.qtd, d.liquidacao.liquidados + d.devolucoes.qtd) + ' das liquidadas'} />
                <Kpi label="Estorno ao cliente" valor={`R$ ${fmt(d.devolucoes.estorno_cliente)}`} />
                <Kpi label="Frete reverso" valor={`R$ ${fmt(d.devolucoes.frete_reverso)}`} />
                <Kpi label="Total debitado" valor={`R$ ${fmt(Math.abs(d.devolucoes.total_debitado))}`} destaque />
              </div>
            </Secao>

            <Secao titulo="Canais de venda" nota={d.nota_canais}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
                {[['organico', 'Orgânico (vitrine + live)'], ['afiliado', 'Afiliado (creator)'], ['afiliado_ads', 'Afiliado ads / parceiro']].map(([k, label]) => (
                  <Kpi key={k} label={label} valor={`${d.canais[k].pedidos} ped`}
                    sub={`R$ ${fmt(d.canais[k].vendas)}${d.canais[k].comissao > 0 ? ` · comissão R$ ${fmt(d.canais[k].comissao)}` : ''}`} />
                ))}
              </div>
            </Secao>

          </>
        )}
      </div>
    </div>
  );
}
