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
  const [aba, setAba] = useState('vendidas');    // 'vendidas' | 'primeira' | 'recompra' | 'matches'
  const [primeiraTipo, setPrimeiraTipo] = useState('geral'); // 'geral' | 'vesti'
  const [refSelMatch, setRefSelMatch] = useState(null);
  const [data, setData] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);

  useEffect(() => {
    let cancelado = false;
    setCarregando(true);
    setErro(null);
    fetch(`/api/lojas-produtos-raiox?loja=${loja}`, {
      headers: { 'x-user-id': userId || 'ailson' },
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
          <ListaProdutos
            itens={data.top_vendidas}
            metricaLabel="peças vendidas"
            metricaCampo="pecas"
            mostrarPosicao
          />
        )}
        {aba === 'primeira' && (
          <>
            <ToggleGeralVesti tipo={primeiraTipo} setTipo={setPrimeiraTipo} />
            <ListaProdutos
              itens={data.primeira_compra[primeiraTipo]}
              metricaLabel="clientes"
              metricaCampo="clientes"
              mostrarPosicao
            />
          </>
        )}
        {aba === 'recompra' && (
          <ListaProdutos
            itens={data.recompra}
            metricaLabel="ocorrências"
            metricaCampo="ocorrencias"
            mostrarPosicao
          />
        )}
        {aba === 'matches' && (
          <PainelMatches
            data={data}
            refSel={refSelMatch}
            setRefSel={setRefSelMatch}
          />
        )}
      </div>
    </div>
  );
};

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

// ─── Painel Matches (dropdown + lista) ─────────────────────────────────────
const PainelMatches = ({ data, refSel, setRefSel }) => {
  const refsDisponiveis = useMemo(() => {
    const setRefs = new Set(Object.keys(data.matches || {}));
    return (data.top_vendidas || []).filter(t => setRefs.has(t.ref));
  }, [data]);

  if (refsDisponiveis.length === 0) {
    return <Vazio msg="Nenhum match encontrado (precisa de pelo menos 5 co-ocorrências)." />;
  }

  const matches = (data.matches || {})[refSel] || [];
  const refSelInfo = (data.top_vendidas || []).find(t => t.ref === refSel);

  return (
    <>
      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 12, color: palette.inkSoft, marginBottom: 4, display: 'block' }}>
          Selecione uma ref:
        </label>
        <select
          value={refSel || ''}
          onChange={e => setRefSel(e.target.value)}
          style={{
            width: '100%', maxWidth: 400,
            padding: '8px 12px', borderRadius: 6,
            border: `1px solid ${palette.beige}`,
            fontSize: 13, fontFamily: FONT,
            background: palette.surface, color: palette.ink,
          }}
        >
          {refsDisponiveis.map(t => (
            <option key={t.ref} value={t.ref}>
              REF {t.ref}{t.descricao ? ` — ${t.descricao}` : ''}
            </option>
          ))}
        </select>
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

      {matches.length === 0 ? (
        <Vazio msg="Sem matches pra essa ref (mín. 5 co-ocorrências)." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {matches.map((m, idx) => (
            <CardMatch key={m.ref_match} match={m} posicao={idx + 1} />
          ))}
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
