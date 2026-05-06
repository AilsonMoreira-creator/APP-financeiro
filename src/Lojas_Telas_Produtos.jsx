// ═══════════════════════════════════════════════════════════════════════════
// Lojas_Telas_Produtos.jsx — Aba "Produtos" (raio-x admin)
// ═══════════════════════════════════════════════════════════════════════════
//
// Sprint Ailson 05/05/2026.
//
// ISOLADO: zero dependencia/alteracao em arquivos de vendedora.
// Importa apenas:
//   - palette, FONT, FotoProdutoLojas de Lojas_Shared
//   - state via prop (userId, isAdmin)
//
// 4 paineis em tabs:
//   1. Top vendidas (45d, top 30)
//   2. Primeira compra (45d, toggle Geral/Vesti, top 15 cada)
//   3. Recompra (90d, top 15)
//   4. Top matches (dropdown ref top 30, mostra refs cooccorrentes)
//
// Filtro de loja afeta paineis 1, 2, 3. Matches sempre agregado.
// ═══════════════════════════════════════════════════════════════════════════
import React, { useState, useEffect, useMemo } from 'react';
import { palette, FONT, FotoProdutoLojas } from './Lojas_Shared.jsx';

const ProdutosTab = ({ userId }) => {
  const [loja, setLoja] = useState('todas');     // 'todas' | 'BR' | 'ST'
  const [aba, setAba] = useState('vendidas');    // 'vendidas' | 'compras' | 'primeira' | 'recompra' | 'matches'
  const [primeiraTipo, setPrimeiraTipo] = useState('geral'); // 'geral' | 'vesti'
  const [refSelMatch, setRefSelMatch] = useState(null);
  const [data, setData] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);
  const [ajudaAberta, setAjudaAberta] = useState(null); // null | 'vendidas' | 'compras' | 'primeira' | 'recompra' | 'matches'

  useEffect(() => {
    let cancelado = false;
    setCarregando(true);
    setErro(null);
    fetch(`/api/lojas-produtos-raiox?loja=${loja}`, {
      headers: { 'X-User': userId || 'ailson' },
    })
      .then(r => r.json().then(d => ({ ok: r.ok, data: d })))
      .then(({ ok, data: d }) => {
        if (cancelado) return;
        if (!ok) {
          setErro(d.error || 'Erro ao carregar');
          setCarregando(false);
          return;
        }
        setData(d);
        setCarregando(false);
        // Auto-seleciona 1ª ref pra matches
        if (d.top_vendidas?.length && !refSelMatch) {
          setRefSelMatch(d.top_vendidas[0].ref);
        }
      })
      .catch(e => { if (!cancelado) { setErro(e.message); setCarregando(false); } });
    return () => { cancelado = true; };
  }, [loja, userId]);

  if (carregando) return <Loader />;
  if (erro) return <ErroBox msg={erro} />;
  if (!data) return null;

  return (
    <div style={{ padding: 16, fontFamily: FONT, color: palette.ink }}>
      <Header loja={loja} setLoja={setLoja} />
      <Tabs aba={aba} setAba={setAba} />
      <div style={{ marginTop: 14 }}>
        {aba === 'vendidas' && (
          <>
            <SubtitleJanela
              texto="📅 Últimos 60 dias · top 30 refs · peças vendidas"
              onAjuda={() => setAjudaAberta('vendidas')}
            />
            <ListaProdutos
              itens={data.top_vendidas}
              metricaLabel="peças vendidas"
              metricaCampo="pecas"
              mostrarPosicao
            />
          </>
        )}
        {aba === 'compras' && (
          <>
            <SubtitleJanela
              texto={`📅 Últimos 60 dias · top 15 refs ${primeiraTipo === 'vesti' ? '(canal Vesti)' : '(todos canais)'} · primeira compra do período (cliente pode ser antigo)`}
              onAjuda={() => setAjudaAberta('compras')}
            />
            <ToggleGeralVesti tipo={primeiraTipo} setTipo={setPrimeiraTipo} />
            <ListaProdutos
              itens={data.compras_periodo[primeiraTipo]}
              metricaLabel="clientes"
              metricaCampo="clientes"
              mostrarPosicao
            />
          </>
        )}
        {aba === 'primeira' && (
          <>
            <SubtitleJanela
              texto={`📅 Últimos 60 dias · top 15 refs ${primeiraTipo === 'vesti' ? '(canal Vesti)' : '(todos canais)'} · clientes que NUNCA compraram antes (lookback até jan/2025)`}
              onAjuda={() => setAjudaAberta('primeira')}
            />
            <ToggleGeralVesti tipo={primeiraTipo} setTipo={setPrimeiraTipo} />
            <ListaProdutos
              itens={data.primeira_compra[primeiraTipo]}
              metricaLabel="clientes novos"
              metricaCampo="clientes"
              mostrarPosicao
            />
          </>
        )}
        {aba === 'recompra' && (
          <>
            <SubtitleJanela
              texto="📅 Últimos 90 dias · top 15 refs · refs em múltiplas compras"
              onAjuda={() => setAjudaAberta('recompra')}
            />
            <ListaProdutos
              itens={data.recompra}
              metricaLabel="ocorrências"
              metricaCampo="ocorrencias"
              mostrarPosicao
            />
          </>
        )}
        {aba === 'matches' && (
          <>
            <SubtitleJanela
              texto="📅 Últimos 90 dias · top 30 refs · mín. 5 co-ocorrências"
              onAjuda={() => setAjudaAberta('matches')}
            />
            <PainelMatches
              data={data}
              refSel={refSelMatch}
              setRefSel={setRefSelMatch}
            />
          </>
        )}
      </div>
      {/* Modal de ajuda — abre quando clica no '?' */}
      <ModalAjuda aba={ajudaAberta} onClose={() => setAjudaAberta(null)} />
    </div>
  );
};

// ─── Subtitle com janela aplicada + botão de ajuda (Ailson 05/05/2026) ────
const SubtitleJanela = ({ texto, onAjuda }) => (
  <div style={{
    display: 'flex', alignItems: 'center', gap: 6,
    marginBottom: 10, flexWrap: 'wrap',
  }}>
    <div style={{
      fontSize: 11, color: palette.inkMuted, fontFamily: FONT,
      background: palette.beigeSoft, padding: '6px 10px', borderRadius: 6,
      display: 'inline-block',
    }}>
      {texto}
    </div>
    {onAjuda && (
      <button
        onClick={onAjuda}
        title="Como esse dado é calculado?"
        style={{
          background: 'transparent', border: `1px solid ${palette.beige}`,
          borderRadius: '50%', width: 22, height: 22,
          cursor: 'pointer', fontSize: 12, color: palette.inkSoft,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: FONT, fontWeight: 700, padding: 0,
        }}
      >?</button>
    )}
  </div>
);

// ─── Modal de ajuda (explica como cada análise é feita) ───────────────────
const ModalAjuda = ({ aba, onClose }) => {
  if (!aba) return null;

  const conteudos = {
    vendidas: {
      titulo: '📊 Top 30 vendidas',
      janela: 'Últimos 60 dias',
      o_que_mostra: 'As 30 referências que mais venderam peças no período (somando todas as compras).',
      como_calcula: 'Soma a quantidade total de peças (qtd) vendidas por referência em todos os pedidos dos últimos 60 dias. Cada peça conta — se um cliente comprou 3 peças da mesma ref, conta 3.',
      filtro_loja: 'Quando filtra por loja (BR ou ST), só conta vendas daquela loja.',
      o_que_significa: 'Mostra os produtos com maior giro em volume. Útil pra identificar best-sellers e priorizar estoque.',
    },
    compras: {
      titulo: '🛒 Compras (primeira do período)',
      janela: 'Últimos 60 dias',
      o_que_mostra: 'As 15 referências que mais aparecem na PRIMEIRA compra de cada cliente DENTRO do período.',
      como_calcula: 'Pra cada cliente que comprou nos últimos 60 dias, identifica a venda mais antiga dentro dessa janela. Lista as refs que estavam nessa venda e conta quantos clientes diferentes tiveram cada ref nessa "primeira compra do período".',
      atencao: '⚠️ "Primeira compra do período" NÃO significa "primeira da vida". Cliente antigo que voltou após 2 meses entra como se fosse primeira (porque é a primeira dele dentro da janela de 60d).',
      filtro_loja: 'Quando filtra por loja, considera só vendas daquela loja como "primeira do período".',
      toggle_vesti: 'Toggle Geral/Vesti: Geral conta todos os canais. Vesti só conta clientes cuja primeira compra do período veio pelo Vesti.',
      o_que_significa: 'Mostra que produto "abre" relacionamento ou recompra com a loja em geral. Diferente da aba Primeira compra, que filtra só clientes verdadeiramente novos.',
    },
    primeira: {
      titulo: '🆕 Primeira compra (cliente novo de verdade)',
      janela: 'Últimos 60 dias · lookback total: jan/2025',
      o_que_mostra: 'As 15 referências que mais aparecem na primeira compra de clientes que NUNCA compraram antes.',
      como_calcula: 'Identifica clientes que: (1) compraram pelo menos uma vez nos últimos 60 dias E (2) NÃO têm nenhuma venda registrada antes desse período (lookback até 06/01/2025, primeira data registrada). Pra cada um desses clientes verdadeiramente novos, lista refs da primeira venda da vida deles.',
      atencao: 'Como temos dados desde jan/2025, qualquer cliente sem venda anterior a 60d é considerado novo. A confiabilidade aumenta quanto mais histórico temos.',
      filtro_loja: 'Quando filtra por loja, considera só clientes novos cuja primeira compra foi naquela loja.',
      toggle_vesti: 'Toggle Geral/Vesti: Vesti mostra só clientes novos cuja primeira compra foi pelo canal Vesti.',
      o_que_significa: 'Mostra qual produto está "trazendo" cliente novo pra dentro da Amícia. Útil pra entender o que atrai público novo e calibrar marketing.',
    },
    recompra: {
      titulo: '🔄 Recompra',
      janela: 'Últimos 90 dias',
      o_que_mostra: 'As 15 referências que mais aparecem em compras recorrentes (refs com 2+ ocorrências).',
      como_calcula: 'Conta quantas COMPRAS DISTINTAS (numero_pedido + loja) tiveram cada ref nos últimos 90 dias. Filtra só refs com pelo menos 2 ocorrências em compras diferentes. Ordena pela quantidade de ocorrências.',
      detalhe: 'Cada compra é única. Se o mesmo cliente comprou a ref X em 2 datas diferentes, conta 2 ocorrências.',
      filtro_loja: 'Quando filtra por loja, só conta compras daquela loja.',
      o_que_significa: 'Indica refs de "giro frequente" — produtos que clientes voltam pra comprar. Sinal de produto fidelizador.',
    },
    matches: {
      titulo: '🔗 Top matches (refs compradas juntas)',
      janela: 'Últimos 90 dias',
      o_que_mostra: 'Pra cada uma das 30 refs mais vendidas, quais OUTRAS refs aparecem na mesma compra com mais frequência.',
      como_calcula: 'Pega as top 30 refs mais vendidas (60d). Pra cada uma, identifica todas as compras dos últimos 90 dias que tiveram essa ref. Lista as outras refs que apareceram nessas mesmas compras (mesmo numero_pedido + loja). Filtra só pares com pelo menos 5 co-ocorrências. Calcula: % das compras da ref X que tiveram a ref Y junto.',
      exemplo: 'Exemplo: se a ref 1871 apareceu em 50 compras nos últimos 90d, e em 14 dessas a ref 395 também estava junto, então o match "1871 → 395" tem pct=28% (14/50) e coocorrencias=14.',
      filtro_loja: 'Matches são SEMPRE agregados (não filtra por loja) — pra ter volume estatístico suficiente.',
      o_que_significa: 'Útil pra recomendação cruzada: se cliente compra ref X, sugerir ref Y junto. Maior pct = match mais forte.',
      atualizacao: 'Atualizado todo dia 03:00 BRT (cron diário).',
    },
  };

  const c = conteudos[aba];
  if (!c) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 9999, padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: palette.surface, borderRadius: 12, padding: 20,
          maxWidth: 500, width: '100%', maxHeight: '85vh', overflow: 'auto',
          fontFamily: FONT, color: palette.ink,
          boxShadow: '0 10px 40px rgba(0,0,0,0.3)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: palette.ink, flex: 1 }}>
            {c.titulo}
          </h3>
          <button
            onClick={onClose}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              fontSize: 22, color: palette.inkMuted, padding: 0,
            }}
          >×</button>
        </div>

        <Bloco titulo="📅 Janela" texto={c.janela} />
        <Bloco titulo="📋 O que mostra" texto={c.o_que_mostra} />
        <Bloco titulo="🔍 Como é calculado" texto={c.como_calcula} />
        {c.detalhe && <Bloco titulo="📌 Detalhe" texto={c.detalhe} />}
        {c.exemplo && <Bloco titulo="💡 Exemplo" texto={c.exemplo} />}
        {c.atencao && <Bloco titulo="⚠️ Atenção" texto={c.atencao} alerta />}
        {c.filtro_loja && <Bloco titulo="🏪 Filtro de loja" texto={c.filtro_loja} />}
        {c.toggle_vesti && <Bloco titulo="🔀 Toggle Geral/Vesti" texto={c.toggle_vesti} />}
        <Bloco titulo="🎯 O que significa" texto={c.o_que_significa} destaque />
        {c.atualizacao && <Bloco titulo="🔁 Atualização" texto={c.atualizacao} />}

        <button
          onClick={onClose}
          style={{
            width: '100%', marginTop: 16, padding: '10px 16px',
            background: palette.accent, color: 'white',
            border: 'none', borderRadius: 8, fontSize: 13,
            fontFamily: FONT, fontWeight: 600, cursor: 'pointer',
          }}
        >Entendi</button>
      </div>
    </div>
  );
};

const Bloco = ({ titulo, texto, alerta, destaque }) => (
  <div style={{
    marginBottom: 12,
    background: alerta ? '#fff8e1' : (destaque ? palette.beigeSoft : 'transparent'),
    padding: alerta || destaque ? 10 : 0,
    borderRadius: 6,
    borderLeft: alerta ? `3px solid ${palette.warn || '#e89c2a'}` : (destaque ? `3px solid ${palette.accent}` : 'none'),
  }}>
    <div style={{
      fontSize: 11, fontWeight: 700, color: palette.inkSoft,
      textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4,
    }}>
      {titulo}
    </div>
    <div style={{ fontSize: 13, color: palette.ink, lineHeight: 1.5 }}>
      {texto}
    </div>
  </div>
);

// ─── Header (filtro de loja) ───────────────────────────────────────────────
const Header = ({ loja, setLoja }) => {
  const opcoes = [
    { id: 'todas', label: 'Todas' },
    { id: 'BR', label: 'Bom Retiro' },
    { id: 'ST', label: 'Silva Teles' },
  ];
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14, flexWrap: 'wrap',
    }}>
      <div style={{ fontSize: 18, fontWeight: 700, color: palette.ink }}>
        📊 Raio-X de Produtos
      </div>
      <div style={{ flex: 1 }} />
      <div style={{ display: 'flex', gap: 4 }}>
        {opcoes.map(o => (
          <button
            key={o.id}
            onClick={() => setLoja(o.id)}
            style={{
              background: loja === o.id ? palette.accent : 'transparent',
              color: loja === o.id ? 'white' : palette.inkSoft,
              border: `1px solid ${loja === o.id ? palette.accent : palette.beige}`,
              borderRadius: 6, padding: '5px 12px',
              fontSize: 12, fontFamily: FONT, fontWeight: 500, cursor: 'pointer',
            }}
          >{o.label}</button>
        ))}
      </div>
    </div>
  );
};

// ─── Tabs (4 paineis) ──────────────────────────────────────────────────────
const Tabs = ({ aba, setAba }) => {
  const tabs = [
    { id: 'vendidas', label: 'Top 30 vendidas' },
    { id: 'compras', label: 'Compras' },
    { id: 'primeira', label: 'Primeira compra' },
    { id: 'recompra', label: 'Recompra' },
    { id: 'matches', label: 'Top matches' },
  ];
  return (
    <div style={{
      display: 'flex', gap: 4, borderBottom: `1px solid ${palette.beige}`,
      flexWrap: 'wrap', rowGap: 4,
    }}>
      {tabs.map(t => (
        <button
          key={t.id}
          onClick={() => setAba(t.id)}
          style={{
            background: 'transparent',
            color: aba === t.id ? palette.accent : palette.inkSoft,
            border: 'none',
            borderBottom: `2px solid ${aba === t.id ? palette.accent : 'transparent'}`,
            padding: '8px 14px',
            fontSize: 13, fontFamily: FONT,
            fontWeight: aba === t.id ? 700 : 500,
            cursor: 'pointer',
          }}
        >{t.label}</button>
      ))}
    </div>
  );
};

// ─── Toggle Geral / Vesti (painel primeira compra) ─────────────────────────
const ToggleGeralVesti = ({ tipo, setTipo }) => (
  <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
    {[{ id: 'geral', label: 'Geral' }, { id: 'vesti', label: 'Vesti' }].map(o => (
      <button
        key={o.id}
        onClick={() => setTipo(o.id)}
        style={{
          background: tipo === o.id ? palette.purple : 'transparent',
          color: tipo === o.id ? 'white' : palette.inkSoft,
          border: `1px solid ${tipo === o.id ? palette.purple : palette.beige}`,
          borderRadius: 6, padding: '4px 12px',
          fontSize: 12, fontFamily: FONT, fontWeight: 600, cursor: 'pointer',
        }}
      >{o.label}</button>
    ))}
  </div>
);

// ─── Lista de produtos (linha = card horizontal) ───────────────────────────
const ListaProdutos = ({ itens, metricaLabel, metricaCampo, mostrarPosicao }) => {
  if (!itens || itens.length === 0) {
    return <Vazio msg="Sem dados pra esse filtro." />;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {itens.map((item, idx) => (
        <CardProduto
          key={item.ref}
          item={item}
          posicao={mostrarPosicao ? (item.posicao || idx + 1) : null}
          metricaLabel={metricaLabel}
          metricaValor={item[metricaCampo]}
        />
      ))}
    </div>
  );
};

const CardProduto = ({ item, posicao, metricaLabel, metricaValor }) => (
  <div style={{
    display: 'flex', alignItems: 'center', gap: 12,
    background: palette.surface, borderRadius: 10,
    border: `1px solid ${palette.beige}`, padding: 10,
  }}>
    {posicao != null && (
      <div style={{
        minWidth: 32, fontSize: 18, fontWeight: 800,
        color: posicao <= 3 ? palette.accent : palette.inkMuted,
        fontFamily: FONT, textAlign: 'center',
      }}>{posicao}</div>
    )}
    <FotoProdutoLojas refProd={item.ref} size={56} />
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: palette.ink }}>
        REF {item.ref}
      </div>
      {item.descricao && (
        <div style={{
          fontSize: 12, color: palette.inkSoft, marginTop: 2,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{item.descricao}</div>
      )}
      <div style={{ fontSize: 10, color: palette.inkMuted, marginTop: 3 }}>
        {item.categoria || '—'}
        {item.qtd_estoque > 0 && (
          <span style={{ marginLeft: 8 }}>· {item.qtd_estoque} em estoque</span>
        )}
      </div>
    </div>
    <div style={{ textAlign: 'right', minWidth: 100 }}>
      <div style={{ fontSize: 18, fontWeight: 800, color: palette.ink, fontFamily: FONT }}>
        {Number(metricaValor || 0).toLocaleString('pt-BR')}
      </div>
      <div style={{ fontSize: 9, color: palette.inkMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {metricaLabel}
      </div>
    </div>
  </div>
);

// ─── Painel Matches (busca + lista filtrada) ──────────────────────────────
const PainelMatches = ({ data, refSel, setRefSel }) => {
  const [busca, setBusca] = useState('');

  const refsDisponiveis = useMemo(() => {
    const setRefs = new Set(Object.keys(data.matches || {}));
    return (data.top_vendidas || []).filter(t => setRefs.has(t.ref));
  }, [data]);

  // Filtro de busca: aceita ref ou descrição (case insensitive)
  const refsFiltradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return refsDisponiveis;
    return refsDisponiveis.filter(t =>
      String(t.ref).toLowerCase().includes(q) ||
      String(t.descricao || '').toLowerCase().includes(q) ||
      String(t.categoria || '').toLowerCase().includes(q)
    );
  }, [refsDisponiveis, busca]);

  if (refsDisponiveis.length === 0) {
    return <Vazio msg="Nenhum match encontrado (precisa de pelo menos 5 co-ocorrências)." />;
  }

  const matches = (data.matches || {})[refSel] || [];
  const refSelInfo = (data.top_vendidas || []).find(t => t.ref === refSel);

  return (
    <>
      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 12, color: palette.inkSoft, marginBottom: 4, display: 'block' }}>
          Buscar uma ref:
        </label>
        {/* Campo de busca com lupa (Ailson 05/05/2026) */}
        <div style={{ position: 'relative', maxWidth: 400, marginBottom: 8 }}>
          <span style={{
            position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
            fontSize: 14, color: palette.inkMuted, pointerEvents: 'none',
          }}>🔍</span>
          <input
            type="text"
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="Digite ref, descrição ou categoria..."
            style={{
              width: '100%', padding: '8px 12px 8px 32px', borderRadius: 6,
              border: `1px solid ${palette.beige}`,
              fontSize: 13, fontFamily: FONT,
              background: palette.surface, color: palette.ink,
              boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Lista filtrada de refs (clica pra selecionar) */}
        <div style={{
          maxHeight: 200, overflowY: 'auto',
          border: `1px solid ${palette.beige}`, borderRadius: 6,
          background: palette.surface, maxWidth: 400,
        }}>
          {refsFiltradas.length === 0 ? (
            <div style={{ padding: 12, fontSize: 12, color: palette.inkMuted, textAlign: 'center' }}>
              Nenhuma ref encontrada com "{busca}"
            </div>
          ) : (
            refsFiltradas.map(t => (
              <div
                key={t.ref}
                onClick={() => setRefSel(t.ref)}
                style={{
                  padding: '8px 12px', cursor: 'pointer',
                  borderBottom: `1px solid ${palette.beigeSoft}`,
                  background: refSel === t.ref ? palette.accentSoft || palette.beigeSoft : 'transparent',
                  fontSize: 12, color: palette.ink,
                  display: 'flex', alignItems: 'center', gap: 8,
                }}
              >
                <span style={{ fontWeight: 700, minWidth: 60 }}>REF {t.ref}</span>
                {t.descricao && (
                  <span style={{ flex: 1, color: palette.inkSoft, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t.descricao}
                  </span>
                )}
                {refSel === t.ref && <span style={{ color: palette.accent, fontSize: 12 }}>✓</span>}
              </div>
            ))
          )}
        </div>
      </div>

      {refSelInfo && matches.length > 0 && (
        <div style={{
          background: palette.beigeSoft, borderRadius: 8, padding: 10, marginBottom: 12,
          fontSize: 13, color: palette.inkSoft,
        }}>
          Clientes que compraram <strong>REF {refSelInfo.ref}</strong> também compraram:
          <span style={{ marginLeft: 6, fontSize: 11, color: palette.inkMuted }}>
            (baseado em {matches[0]?.total_compras || 0} compras nos últimos 90 dias)
          </span>
        </div>
      )}

      {refSel && matches.length === 0 ? (
        <Vazio msg="Sem matches pra essa ref (mín. 5 co-ocorrências)." />
      ) : matches.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {matches.map((m, idx) => (
            <CardMatch key={m.ref_match} match={m} posicao={idx + 1} />
          ))}
        </div>
      ) : (
        <div style={{
          padding: 16, textAlign: 'center', fontSize: 12,
          color: palette.inkMuted, fontStyle: 'italic',
        }}>
          Selecione uma ref acima pra ver os matches.
        </div>
      )}
    </>
  );
};

const CardMatch = ({ match, posicao }) => (
  <div style={{
    display: 'flex', alignItems: 'center', gap: 12,
    background: palette.surface, borderRadius: 10,
    border: `1px solid ${palette.beige}`, padding: 10,
  }}>
    <div style={{
      minWidth: 32, fontSize: 16, fontWeight: 800,
      color: posicao <= 3 ? palette.accent : palette.inkMuted,
      fontFamily: FONT, textAlign: 'center',
    }}>{posicao}</div>
    <FotoProdutoLojas refProd={match.ref_match} size={56} />
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: palette.ink }}>
        REF {match.ref_match}
      </div>
      {match.descricao && (
        <div style={{
          fontSize: 12, color: palette.inkSoft, marginTop: 2,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{match.descricao}</div>
      )}
      <div style={{ fontSize: 10, color: palette.inkMuted, marginTop: 3 }}>
        {match.categoria || '—'}
        {match.qtd_estoque > 0 && (
          <span style={{ marginLeft: 8 }}>· {match.qtd_estoque} em estoque</span>
        )}
      </div>
    </div>
    <div style={{ textAlign: 'right', minWidth: 100 }}>
      <div style={{ fontSize: 22, fontWeight: 800, color: palette.purple, fontFamily: FONT }}>
        {match.pct}%
      </div>
      <div style={{ fontSize: 9, color: palette.inkMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {match.coocorrencias} compras juntas
      </div>
    </div>
  </div>
);

// ─── States auxiliares ─────────────────────────────────────────────────────
const Loader = () => (
  <div style={{ padding: 20, textAlign: 'center', color: palette.inkMuted, fontFamily: FONT }}>
    Carregando raio-x…
  </div>
);

const ErroBox = ({ msg }) => (
  <div style={{
    margin: 16, padding: 14, borderRadius: 8,
    background: '#fef0f0', border: '1px solid #f4b8b8',
    color: '#8e3a3a', fontFamily: FONT, fontSize: 13,
  }}>
    ⚠ Erro: {msg}
  </div>
);

const Vazio = ({ msg }) => (
  <div style={{
    padding: 30, textAlign: 'center',
    color: palette.inkMuted, fontFamily: FONT, fontSize: 13,
    background: palette.beigeSoft, borderRadius: 8,
  }}>
    {msg}
  </div>
);

export default ProdutosTab;
