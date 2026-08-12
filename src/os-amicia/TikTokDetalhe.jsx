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
    aguarda: { bg: '#f7ecd0', fg: '#8a6a1a' },     // a receber previsto (faltava — derrubava o módulo, 11/08)
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
                <Kpi label="Em aberto" valor={d.liquidacao.em_aberto} sub={`~R$ ${fmt(d.liquidacao.em_aberto_previsto)} previstos a receber`} cor="aguarda" />
                {d.liquidacao.em_atraso > 0 && (
                  <Kpi label="Liquidação em atraso" cor="amarelo" valor={d.liquidacao.em_atraso}
                    sub={`R$ ${fmt(d.liquidacao.em_atraso_vendas)} · em aberto há mais de ${d.liquidacao.atraso_limite_dias} dias (30% acima da média de ${d.liquidacao.prazo_medio_dias})`} />
                )}
                <Kpi label="Depositado últimos 30d" valor={`R$ ${fmt(d.liquidacao.depositado_30d)}`} sub={`${d.liquidacao.depositado_30d_pedidos} vendas`} />
                <Kpi label="Prazo médio" valor={d.liquidacao.prazo_medio_dias != null ? `${d.liquidacao.prazo_medio_dias} dias` : '—'} sub="pedido → depósito" />
              </div>
            </Secao>

            {fin?.mes_completo && (
              <Secao titulo="Detalhamento de valores · DRE do mês"
                nota={`${fmt(fin.mes_completo.pct_real)}% da venda já confirmada em repasse; o restante usa o valor oficial previsto pelo TikTok (unsettled) e o repasse confirma em ~7 dias.`}>
                <Linha label="Venda do mês (líquida dos seus descontos)" valor={fin.mes_completo.venda_total} base={fin.mes_completo.venda_total} positivo forte
                  exp={`Liquidado + em aberto (${fin.mes_completo.previsto.pedidos} pedidos abertos), JÁ descontados os R$ ${fmt(fin.mes_completo.descontos_abatidos)} de promoções suas — comissão, frete e as demais taxas aplicam sobre esta base.`} />
                <Linha label="Comissão + taxa fixa (real + prevista)" valor={-fin.mes_completo.comissao} base={fin.mes_completo.venda_total}
                  exp="Nos em aberto usa o TOTAL oficial de taxas do TikTok (comissão 6% + R$ 6 fixa + tarifas menores), sem afiliados, que têm linha própria." />
                <Linha label="Afiliados (real + previsto)" valor={-fin.mes_completo.afiliados} base={fin.mes_completo.venda_total} />
                <Linha label="Frete seu (real + previsto)" valor={-fin.mes_completo.frete} base={fin.mes_completo.venda_total}
                  exp="Frete real dos liquidados + oficial dos em aberto. Pedidos que o TikTok ainda não apurou (frete vem zerado até perto da entrega) entram pelo piso da régua: 6% − o que o cliente pagou." />
                <Linha label="Recebido + a receber" valor={fin.mes_completo.recebido} base={fin.mes_completo.venda_total} positivo forte
                  exp={`R$ ${fmt(fin.recebido)} já no bolso + R$ ${fmt(fin.mes_completo.previsto.liquido)} previstos.`} />
                <Linha label="Imposto (11%)" valor={-fin.mes_completo.imposto} base={fin.mes_completo.venda_total} />
                <Linha label="Agência (5%)" valor={-fin.mes_completo.agencia} base={fin.mes_completo.venda_total} />
                <Linha label="CMV · custo da mercadoria" valor={-fin.mes_completo.cmv_total} base={fin.mes_completo.venda_total}
                  exp={`Custo real das REFs via Bling (liquidadas + abertas).${fin.mes_completo.cmv_estimado_abertos > 0.5 ? ` R$ ${fmt(fin.mes_completo.cmv_estimado_abertos)} estimados pela proporção das liquidadas (pedidos ainda sem vínculo).` : ''}`} />
                <Linha label="Custo de operação (R$ 5/un)" valor={-fin.mes_completo.custo_operacao} base={fin.mes_completo.venda_total} />
                <Linha label="Resultado do mês (projetado)" valor={fin.mes_completo.resultado_final} base={fin.mes_completo.venda_total} positivo={fin.mes_completo.resultado_final >= 0} forte
                  exp="Mês inteiro: o que já liquidou (números reais) somado ao que ainda vai liquidar (oficial do TikTok + régua de reserva). Margem sobre a venda líquida." />
                <div style={{ fontSize: 11, color: '#1f7a48', marginTop: 8, fontFamily: CALIBRI, lineHeight: 1.5 }}>
                  ℹ Promoções: R$ {fmt(fin.mes_completo.descontos_abatidos)} suas (já abatidas da venda acima — não descontam duas vezes){fin.mes_completo.desconto_plataforma > 0.5 ? ` e R$ ${fmt(fin.mes_completo.desconto_plataforma)} bancadas pelo TikTok, fora do seu repasse` : ''}.
                </div>
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
