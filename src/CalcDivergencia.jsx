/**
 * CalcDivergencia.jsx — preço praticado nos anúncios × preço da calculadora
 * (Ailson 08/08/2026).
 *
 * Regras vindas dele: vale o MENOR preço entre os anúncios da REF; se o produto
 * está em campanha considera o preço NORMAL; divergência é mais de 2% pra cima
 * ou pra baixo. Toda a conta mora em api/precos-divergencia.js.
 */
import React, { useState, useCallback, useEffect } from 'react';

const FONT = 'Georgia,serif';
const INK = '#2c3e50';
const ACC = '#4a7fa5';
const BEG = '#e8e2da';
const MUT = '#a89f94';
const VERM = '#c0392b';
const VERDE = '#1f7a48';

const brl = (v) => v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const btn = (ativo) => ({
  background: ativo ? INK : '#fff', color: ativo ? '#fff' : INK,
  border: ativo ? 'none' : `1px solid ${BEG}`, borderRadius: 8,
  padding: '7px 13px', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: FONT,
});

function Bloco({ titulo, dados, tol }) {
  if (!dados) return null;
  if (dados.erro) {
    return (
      <div style={{ background: '#fff', border: `1px solid ${BEG}`, borderRadius: 12, padding: 16, marginBottom: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: INK, marginBottom: 6 }}>{titulo}</div>
        <div style={{ fontSize: 12.5, color: VERM }}>Não deu pra ler: {dados.erro}{dados.mensagem ? ` · ${dados.mensagem}` : ''}</div>
      </div>
    );
  }
  const div = dados.divergentes || [];
  return (
    <div style={{ background: '#fff', border: `1px solid ${BEG}`, borderRadius: 12, padding: 16, marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: INK }}>{titulo}</div>
        <div style={{ fontSize: 11.5, color: MUT }}>
          {dados.anuncios} anúncios · {dados.refs} refs · <b style={{ color: div.length ? VERM : VERDE }}>{div.length} fora da faixa</b> · {dados.ok} dentro
        </div>
      </div>

      {div.length === 0 ? (
        <div style={{ fontSize: 12.5, color: VERDE }}>Tudo dentro dos {tol}%.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: FONT }}>
            <thead>
              <tr style={{ fontSize: 10.5, color: MUT, textTransform: 'uppercase', letterSpacing: 0.6 }}>
                <th style={{ textAlign: 'left', padding: '5px 6px' }}>Ref</th>
                <th style={{ textAlign: 'left', padding: '5px 6px' }}>Produto</th>
                <th style={{ textAlign: 'right', padding: '5px 6px' }}>Praticado</th>
                <th style={{ textAlign: 'right', padding: '5px 6px' }}>Calculadora</th>
                <th style={{ textAlign: 'right', padding: '5px 6px' }}>Dif</th>
                <th style={{ textAlign: 'center', padding: '5px 6px' }}>Anúncios</th>
              </tr>
            </thead>
            <tbody>
              {div.map(l => {
                const abaixo = (l.dif_pct || 0) < 0;
                return (
                  <tr key={l.ref} style={{ borderTop: `1px solid ${BEG}`, fontSize: 12.5, color: INK }}>
                    <td style={{ padding: '7px 6px', fontFamily: "Calibri,'Segoe UI',Arial,sans-serif", fontWeight: 800 }}>{l.ref}</td>
                    <td style={{ padding: '7px 6px' }}>
                      {l.descricao || l.titulo || '—'}
                      {l.promo && <span style={{ marginLeft: 6, fontSize: 9.5, background: '#fdf3e2', color: '#8a6500', borderRadius: 4, padding: '1px 5px', fontWeight: 700 }}>em campanha</span>}
                    </td>
                    <td style={{ padding: '7px 6px', textAlign: 'right', fontWeight: 700 }}>{brl(l.praticado)}</td>
                    <td style={{ padding: '7px 6px', textAlign: 'right', color: MUT }}>{brl(l.calculadora)}</td>
                    <td style={{ padding: '7px 6px', textAlign: 'right', fontWeight: 800, color: abaixo ? VERM : '#8a6500' }}>
                      {abaixo ? '' : '+'}{l.dif_pct}%
                    </td>
                    <td style={{ padding: '7px 6px', textAlign: 'center', color: MUT }}>{l.anuncios}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {(dados.sem_preco_calc?.length || dados.anuncios_sem_ref) ? (
        <div style={{ marginTop: 10, fontSize: 11.5, color: MUT, lineHeight: 1.6 }}>
          {dados.sem_preco_calc?.length ? <div>Sem preço na calculadora (ficaram fora da conta): <b>{dados.sem_preco_calc.join(', ')}</b></div> : null}
          {dados.anuncios_sem_ref ? <div>{dados.anuncios_sem_ref} anúncio(s) sem REF mapeada.</div> : null}
        </div>
      ) : null}
    </div>
  );
}

export default function CalcDivergencia({ onVoltar, mobile }) {
  const [tol, setTol] = useState(2);
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');

  const carregar = useCallback(async (t) => {
    setCarregando(true); setErro('');
    try {
      const r = await fetch(`/api/precos-divergencia?canal=todos&tol=${t}`);
      const j = await r.json();
      if (!j.ok) throw new Error(j.erro || 'falhou');
      setDados(j);
    } catch (e) {
      setErro(e?.message || 'falhou');
    }
    setCarregando(false);
  }, []);

  useEffect(() => { carregar(tol); }, [carregar, tol]);

  return (
    <div style={{ fontFamily: FONT, padding: mobile ? 12 : 20, maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 10, color: MUT, letterSpacing: 2, textTransform: 'uppercase' }}>Calculadora</div>
          <div style={{ fontSize: mobile ? 19 : 22, fontWeight: 700, color: INK }}>Divergência de preços</div>
          <div style={{ fontSize: 11, color: '#8a9aa4', marginTop: 2 }}>
            Menor preço entre os anúncios da REF, ignorando desconto de campanha
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: MUT }}>tolerância</span>
          {[2, 5, 10].map(t => (
            <button key={t} onClick={() => setTol(t)} style={btn(tol === t)}>{t}%</button>
          ))}
          <button onClick={() => carregar(tol)} disabled={carregando} style={{ ...btn(false), opacity: carregando ? 0.6 : 1 }}>
            {carregando ? 'lendo…' : '↻ Atualizar'}
          </button>
          <button onClick={onVoltar} style={btn(false)}>← Voltar</button>
        </div>
      </div>

      {carregando && !dados && (
        <div style={{ background: '#fff', border: `1px solid ${BEG}`, borderRadius: 12, padding: 24, textAlign: 'center', color: MUT, fontSize: 12.5 }}>
          Lendo os anúncios no Mercado Livre e na Shopee… leva alguns segundos.
        </div>
      )}
      {erro && (
        <div style={{ background: '#fff', border: `1px solid ${VERM}`, borderRadius: 12, padding: 14, marginBottom: 14, fontSize: 12.5, color: VERM }}>
          {erro} · <button onClick={() => carregar(tol)} style={{ ...btn(false), marginLeft: 6 }}>Tentar de novo</button>
        </div>
      )}

      {dados && (
        <>
          <Bloco titulo="Mercado Livre · Exitus" dados={dados.mercado_livre} tol={tol} />
          <Bloco titulo="Shopee · Exitus" dados={dados.shopee} tol={tol} />
          <div style={{ fontSize: 11, color: MUT }}>
            Lido em {new Date(dados.gerado_em).toLocaleString('pt-BR')} · preço negativo significa anúncio
            mais barato que a calculadora manda.
          </div>
        </>
      )}
    </div>
  );
}
