/**
 * MLDetalhe.jsx — tela "Detalhar" do card Mercado Livre no OS Amícia
 * (Ailson 10/08/2026). Soma as 3 contas (Exitus, Lumia, Muniam).
 *
 * Mesmo desenho do TikTokDetalhe: janelas mês/30/60/90, KPIs, DRE com
 * explicação ao toque, repasses pela ótica da LIBERAÇÃO do Mercado Pago
 * (o cálculo usa o líquido já definido; a liberação confirma o depósito).
 */
import { useCallback, useEffect, useState } from 'react';

export default function MLDetalhe({ usuario, onFechar, C, SERIF, CALIBRI }) {
  const [dados, setDados] = useState(null);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState(null);
  const [janela, setJanela] = useState('mes');
  const [expAberta, setExpAberta] = useState(null);

  const carregar = useCallback(async (j) => {
    setLoading(true); setErro(null);
    try {
      const r = await fetch(`/api/ml-detalhe?janela=${j}`, { headers: { 'X-User': usuario } });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setDados(d);
    } catch (e) { setErro(e.message); }
    finally { setLoading(false); }
  }, [usuario]);
  useEffect(() => { carregar(janela); }, [carregar, janela]);

  const fmt = (v) => (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fdata = (d) => d ? d.split('-').reverse().slice(0, 2).join('/') : '—';
  const pct = (v, base) => base > 0 ? `${((v / base) * 100).toFixed(1)}%` : '—';

  const Secao = ({ titulo, children, nota }) => (
    <div style={{ background: '#fff', border: `1px solid ${C.cream}`, borderRadius: 10, padding: 16, marginBottom: 12 }}>
      <div style={{ fontSize: 11, color: C.muted, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 10, fontFamily: SERIF }}>{titulo}</div>
      {children}
      {nota && <div style={{ fontSize: 10, color: C.muted, marginTop: 8, fontStyle: 'italic' }}>{nota}</div>}
    </div>
  );

  const CORES = {
    amarelo_ml: { bg: '#fff159', fg: '#2d3277' },
    azul: { bg: '#dbe9f6', fg: '#1f4e79' },
    verde: { bg: '#1f7a48', fg: '#fff' },
    aguarda: { bg: '#f7ecd0', fg: '#8a6a1a' },
    neutro: { bg: '#f7f4f0', fg: C.iaDarker },
  };
  const Kpi = ({ label, valor, sub, cor }) => (
    <div style={{ background: CORES[cor || 'neutro'].bg, color: CORES[cor || 'neutro'].fg, borderRadius: 8, padding: 12 }}>
      <div style={{ fontSize: 9, opacity: 0.75, letterSpacing: 1, textTransform: 'uppercase', fontFamily: SERIF }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 800, marginTop: 2, fontFamily: CALIBRI, whiteSpace: 'nowrap' }}>{valor}</div>
      {sub && <div style={{ fontSize: 10, opacity: 0.8, marginTop: 2, lineHeight: 1.35 }}>{sub}</div>}
    </div>
  );

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
  const NOME_CONTA = { exitus: 'Exitus', lumia: 'Lumia', muniam: 'Muniam' };
  const NOME_LOG = { full: 'Full', flex: 'Flex', outros: 'Correios/agência', sem_dado: 'Sem dado ainda' };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(20,15,10,0.55)', zIndex: 400, display: 'flex', justifyContent: 'center', overflowY: 'auto', padding: '20px 8px' }} onClick={onFechar}>
      <div style={{ background: '#f7f4f0', borderRadius: 14, maxWidth: 680, width: '100%', height: 'fit-content', padding: 18, fontFamily: SERIF }} onClick={e => e.stopPropagation()}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 10, color: C.muted, letterSpacing: 1.5, textTransform: 'uppercase' }}>Mercado Livre · Exitus + Lumia + Muniam</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: C.iaDarker }}>Detalhamento do canal</div>
          </div>
          <button onClick={onFechar} style={{ background: 'transparent', border: `1px solid ${C.cream}`, borderRadius: 8, padding: '6px 14px', cursor: 'pointer', color: C.muted, fontFamily: SERIF }}>✕ Fechar</button>
        </div>

        <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
          {[['mes', 'Mês atual'], ['30', '30 dias'], ['60', '60 dias'], ['90', '90 dias']].map(([v, l]) => (
            <button key={v} onClick={() => setJanela(v)} disabled={loading}
              style={{ flex: 1, padding: '7px 0', borderRadius: 8, border: `1px solid ${janela === v ? '#2d3277' : C.cream}`,
                background: janela === v ? '#fff159' : '#fff', color: janela === v ? '#2d3277' : C.muted,
                fontSize: 12, fontWeight: janela === v ? 800 : 400, cursor: 'pointer', fontFamily: SERIF }}>{l}</button>
          ))}
        </div>

        {erro && <div style={{ color: C.critical, fontSize: 13, padding: 14 }}>❌ {erro}</div>}
        {loading && <div style={{ color: C.muted, fontSize: 13, padding: 14, textAlign: 'center' }}>Somando as 3 contas…</div>}

        {d && !loading && (
          <>
            <Secao titulo={`Vendas · ${d.de} → ${d.ate} · 3 contas`}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 }}>
                <Kpi label="Pedidos" valor={d.resumo.pedidos} sub={`${d.resumo.unidades} un`} cor="azul" />
                <Kpi label="Vendas" valor={`R$ ${fmt(d.resumo.vendas)}`} sub={`ticket R$ ${fmt(d.resumo.ticket_medio)}`} />
                <Kpi label="Cancelados" valor={d.cancelamentos.qtd} sub={`R$ ${fmt(d.cancelamentos.valor)} · fora do funil`} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 8 }}>
                {Object.entries(d.por_conta).map(([conta, c]) => (
                  <Kpi key={conta} label={NOME_CONTA[conta] || conta} valor={c.pedidos} sub={`R$ ${fmt(c.vendas)}`} cor="amarelo_ml" />
                ))}
              </div>
            </Secao>

            <Secao titulo="Repasses · liberação do Mercado Pago" nota={`Cobertura: ${d.repasses.cobertura}. O cálculo do lucro usa o líquido já definido — a liberação confirma o depósito.`}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
                <Kpi label="Liberado" valor={`R$ ${fmt(d.repasses.liberado_valor)}`} sub={`${d.repasses.liberados} pedidos · já na conta`} cor="verde" />
                <Kpi label="A liberar" valor={`R$ ${fmt(d.repasses.a_liberar_valor)}`} sub={`${d.repasses.a_liberar} pedidos · valor já definido`} cor="aguarda" />
                <Kpi label="Próxima liberação" valor={fdata(d.repasses.proxima_liberacao)} sub={d.repasses.prazo_medio_dias != null ? `prazo médio ${d.repasses.prazo_medio_dias} dias` : ''} />
              </div>
            </Secao>

            {fin && fin.venda > 0 && (
              <Secao titulo="Detalhamento de valores · DRE" nota="Toque numa linha ⓘ pra ver a explicação. Sem linha de agência — os 5% são só do TikTok.">
                <Linha label="Valor de venda" valor={fin.venda} positivo forte
                  exp="Soma dos produtos vendidos (preço real do anúncio, cancelados fora) nos pedidos com dado do Mercado Pago." />
                <Linha label="Tarifa de venda (comissão + fixo)" valor={fin.charge_tarifas || fin.sale_fee} base={fin.venda}
                  exp="A tarifa exata debitada no pagamento: comissão do ML mais a taxa de processamento do MP." />
                {fin.parcelamento > 0.5 && <Linha label="Parcelamento (só o que sobra pra você)" valor={fin.parcelamento} base={fin.venda}
                  exp="No Clássico o CLIENTE paga o acréscimo do parcelamento — esse custo se anula e não entra. Aqui só fica o que realmente sai de você: taxa mínima de recebimento e parcelas sem juros dos anúncios Premium." />}
                <Linha label="Frete pago por você" valor={fin.frete_liquido_vendedor} base={fin.venda}
                  exp="Só o SEU custo de envio nos pagamentos — a parte que o comprador paga fica fora da conta (nem soma nem subtrai). Média de ~R$ 12-16 por pedido. O frete dos pedidos Flex não aparece aqui: é cobrado na fatura, na linha de tarifas de faturamento." />
                {(fin.ajustes || 0) <= -1 && <Linha label="Ajustes do pagamento" valor={fin.ajustes} base={fin.venda}
                  exp="Débitos residuais do pagamento ainda não classificados." />}
                <Linha label="Resultado das vendas no Mercado Pago" valor={fin.liquido_vendas} base={fin.venda} positivo forte
                  exp="O que as vendas rendem de verdade: pago − frete − tarifas − promoções. Os débitos avulsos abaixo saem DEPOIS, e não são custo da venda." />
                {fin.debitos_avulsos > 0.5 && <Linha label="Débitos avulsos descontados (crédito/dívidas)" valor={fin.debitos_avulsos} base={fin.venda}
                  exp="Valores que o Mercado Pago abate dos repasses pra quitar outras obrigações (Mercado Crédito, antecipações, dívidas de tarifas). Reduzem o caixa, mas NÃO são custo da venda — por isso ficam fora do resultado final." />}
                <Linha label="Imposto (11% da venda)" valor={fin.imposto} base={fin.venda}
                  exp="Sua régua: 11% sobre a venda. Aplicado sobre o resultado das vendas (antes dos débitos avulsos)." />
                <Linha label="Total após imposto" valor={fin.total_pos_imposto} base={fin.venda} positivo forte />
                <Linha label="CMV · custo da mercadoria" valor={fin.cmv?.total || 0} base={fin.venda}
                  exp="Custo de produção (calculadora) das peças, pelo vínculo com o Bling." />
                {fin.cmv?.estimado > 0 && (
                  <div style={{ fontSize: 10.5, color: C.muted, padding: '2px 0', fontFamily: CALIBRI }}>
                    → R$ {fmt(fin.cmv.exato)} exato ({fin.cmv.un_com_custo} un) + R$ {fmt(fin.cmv.estimado)} estimado ({fin.cmv.sem_vinculo} pedidos sem vínculo)
                  </div>
                )}
                <Linha label="Custo de operação (R$ 5/un)" valor={fin.custo_operacao || 0} base={fin.venda}
                  exp={`R$ 5 fixos por unidade vendida (${fin.custo_operacao_un || 0} un): embalagem, etiqueta, mão de obra da expedição.`} />
                {fin.tarifas_faturamento > 0.5 && <Linha label="Serviços faturados (Full e outros) · 2%" valor={fin.tarifas_faturamento} base={fin.venda}
                  exp={`Régua fixa de 2% da venda (armazenagem/coleta Full, devoluções e outras tarifas fora do pagamento). Observado no extrato até agora: R$ ${fmt(fin.tarifas_faturamento_det?.observado_extrato || 0)}.`} />}
                <Linha label="Publicidade (Product Ads) · 6%" valor={fin.publicidade || 0} base={fin.venda}
                  exp={`Régua fixa de 6% da venda. O extrato de faturamento do ML só fecha os gastos recentes por volta do dia 18, então o valor "real" ficava parado por dias.${fin.publicidade_observada > 0.5 ? ` Observado no extrato até agora: R$ ${fmt(fin.publicidade_observada)}.` : ''}`} />
                <Linha label="Resultado final" valor={fin.resultado_final} base={fin.venda} positivo={fin.resultado_final >= 0} forte
                  exp="O que sobra: líquido do Mercado Pago − imposto − custo da mercadoria − custo de operação − publicidade." />
                {fin.creditos_pagamento > 0.5 && (
                  <div style={{ fontSize: 11, color: C.muted, marginTop: 6, fontFamily: CALIBRI }}>
                    ℹ Créditos do pagamento (reposições e afins): R$ {fmt(fin.creditos_pagamento)} — fora do resultado.
                  </div>
                )}
                {fin.bonus_flex > 0.5 && (
                  <div style={{ fontSize: 11, color: C.muted, marginTop: 6, fontFamily: CALIBRI }}>
                    ℹ Bônus Flex: R$ {fmt(fin.bonus_flex)} repostos pelo ML — neutros (repõem a entrega que você já pagou), fora do resultado.
                  </div>
                )}
                {(fin.desconto_vendedor > 0 || fin.desconto_plataforma > 0) && (
                  <div style={{ fontSize: 11, color: '#1f7a48', marginTop: 8, fontFamily: CALIBRI, lineHeight: 1.5 }}>
                    ℹ Promoções: R$ {fmt(fin.desconto_vendedor)} suas (já refletidas no preço de venda acima — não descontam duas vezes) e R$ {fmt(fin.desconto_plataforma)} bancadas pelo ML e repostas a você.
                  </div>
                )}
              </Secao>
            )}

            <Secao titulo="Por logística">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 }}>
                {Object.entries(d.por_logistica).map(([k, l]) => (
                  <Kpi key={k} label={NOME_LOG[k] || k} valor={l.pedidos} sub={`R$ ${fmt(l.vendas)}`} />
                ))}
              </div>
            </Secao>
          </>
        )}
      </div>
    </div>
  );
}
