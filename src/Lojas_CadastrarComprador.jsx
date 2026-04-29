/**
 * Lojas_CadastrarComprador.jsx
 *
 * Tela única usada por:
 *   - Vendedora: acessa via botão "Cadastrar comprador" no header da
 *     MinhaCarteira (qualquer cliente, mesmo de outra carteira).
 *   - Admin (Ailson, Tamara): acessa via item "Cadastrar comprador" na
 *     ConfigTab.
 *
 * Fluxo:
 *   1. User digita CNPJ ou CPF (formatado live)
 *   2. Quando completa 11 (CPF) ou 14 (CNPJ) dígitos → busca automática
 *   3. Se encontrado: mostra razão social + nome atual + campo pra novo nome
 *   4. Se NÃO encontrado: mensagem de erro (não cria cliente novo)
 *   5. User digita nome do comprador → Salvar
 *   6. POST /api/lojas-comprador-cadastrar atualiza apelido E comprador_nome
 *   7. Atualiza cliente no state local via dispatch
 *
 * Comportamentos especiais:
 *   - NÃO altera vendedora_id do cliente (decisão Ailson 28/04/2026)
 *   - Atualiza ambas colunas (apelido + comprador_nome) com mesmo valor
 */

import { useState, useEffect, useRef } from 'react';
import { Search, Save, ArrowLeft, AlertCircle, CheckCircle2, Loader2, User } from 'lucide-react';
import {
  palette, FONT, Header,
  fz, sz,
  formatarDocumentoLive, limparDocumento, detectarTipoDocumento, formatarDocumento,
} from './Lojas_Shared.jsx';

export const CadastrarCompradorScreen = ({ lojas, onBack }) => {
  const { dispatch } = lojas;
  const [docInput, setDocInput] = useState('');
  const [buscando, setBuscando] = useState(false);
  const [resultado, setResultado] = useState(null); // { encontrado, cliente?, mensagem? }
  const [erro, setErro] = useState(null);
  const [nomeComprador, setNomeComprador] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [salvoOk, setSalvoOk] = useState(false);
  const buscaTimer = useRef(null);

  // Auto-busca quando atinge 11 (CPF) ou 14 (CNPJ) dígitos.
  useEffect(() => {
    const dig = limparDocumento(docInput);
    if (dig.length === 11 || dig.length === 14) {
      // Debounce 200ms pra evitar buscar enquanto user ainda tá digitando.
      clearTimeout(buscaTimer.current);
      buscaTimer.current = setTimeout(() => buscarCliente(dig), 200);
    } else {
      // Resetou: limpa estado anterior
      setResultado(null);
      setErro(null);
      setSalvoOk(false);
    }
    return () => clearTimeout(buscaTimer.current);
  }, [docInput]);

  async function buscarCliente(doc) {
    setBuscando(true);
    setErro(null);
    setResultado(null);
    setSalvoOk(false);
    try {
      const userId = lojas.state.userId || '';
      const r = await fetch(`/api/lojas-comprador-cadastrar?documento=${encodeURIComponent(doc)}`, {
        headers: { 'X-User': userId },
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setResultado(data);
      // Decisão Ailson 28/04/2026: campo SEMPRE vazio quando busca cliente.
      // Mostra o nome atual cadastrado em outro lugar (linha "Comprador atual"
      // dentro do card do cliente), e deixa o input em branco pra vendedora
      // digitar do zero. Evita confusão de "será que devo apagar e digitar?"
      setNomeComprador('');
    } catch (e) {
      setErro(e.message || 'Erro ao buscar cliente');
    } finally {
      setBuscando(false);
    }
  }

  async function salvar() {
    const nome = nomeComprador.trim();
    if (nome.length < 2) {
      setErro('Nome do comprador precisa ter ao menos 2 caracteres.');
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      const userId = lojas.state.userId || '';
      const r = await fetch('/api/lojas-comprador-cadastrar', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User': userId,
        },
        body: JSON.stringify({
          documento: limparDocumento(docInput),
          comprador_nome: nome,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      // Atualiza cliente no state local (espelha mudança das 2 colunas)
      dispatch({
        type: 'UPDATE_CLIENTE',
        cliente: { ...resultado.cliente, apelido: nome, comprador_nome: nome },
      });
      setSalvoOk(true);
      // Reset depois de 1.5s pra permitir cadastrar próximo
      setTimeout(() => {
        setDocInput('');
        setNomeComprador('');
        setResultado(null);
        setSalvoOk(false);
      }, 1800);
    } catch (e) {
      setErro(e.message || 'Erro ao salvar');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: palette.bg }}>
      <Header
        title="Cadastrar comprador"
        subtitle="Vincule o nome de quem atende ao CNPJ ou CPF"
        onBack={onBack}
      />

      <div style={{ padding: 16, paddingBottom: 32, maxWidth: 600, margin: '0 auto' }}>
        {/* Bloco explicativo */}
        <div style={{
          background: palette.accentSoft,
          border: `1px solid ${palette.accent}30`,
          borderRadius: 10, padding: 12, marginBottom: 16,
          fontSize: fz(14), color: palette.ink, lineHeight: 1.5,
        }}>
          💡 Digite o CNPJ ou CPF do cliente. Quando completar, eu busco a
          razão social. Aí é só colocar o nome do comprador (quem realmente
          atende na loja) e salvar.
        </div>

        {/* Input documento */}
        <label style={{
          display: 'block', fontSize: fz(13), color: palette.inkMuted,
          letterSpacing: 0.5, marginBottom: 6, fontWeight: 600,
          textTransform: 'uppercase',
        }}>
          CNPJ ou CPF
        </label>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: palette.surface, border: `1px solid ${palette.beige}`,
          borderRadius: 10, padding: '10px 12px', marginBottom: 16,
        }}>
          <Search size={sz(18)} color={palette.inkMuted} />
          <input
            value={docInput}
            onChange={e => setDocInput(formatarDocumentoLive(e.target.value))}
            placeholder="00.000.000/0000-00 ou 000.000.000-00"
            inputMode="numeric"
            autoFocus
            style={{
              flex: 1, border: 'none', background: 'transparent', outline: 'none',
              fontFamily: FONT, fontSize: fz(16), color: palette.ink,
            }}
          />
          {buscando && (
            <Loader2 size={sz(18)} style={{
              animation: 'spin 1s linear infinite', color: palette.accent,
            }} />
          )}
        </div>

        {/* Erro de busca */}
        {erro && !resultado && (
          <div style={{
            background: palette.alertSoft,
            border: `1px solid ${palette.alert}40`,
            borderRadius: 10, padding: 12, marginBottom: 16,
            display: 'flex', alignItems: 'flex-start', gap: 8,
            fontSize: fz(14), color: palette.alert,
          }}>
            <AlertCircle size={sz(18)} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>{erro}</span>
          </div>
        )}

        {/* Cliente NÃO encontrado */}
        {resultado && !resultado.encontrado && (
          <div style={{
            background: palette.warnSoft,
            border: `1px solid ${palette.warn}40`,
            borderRadius: 10, padding: 14,
            display: 'flex', alignItems: 'flex-start', gap: 10,
            fontSize: fz(14), color: palette.ink, lineHeight: 1.5,
          }}>
            <AlertCircle size={sz(20)} color={palette.warn} style={{ flexShrink: 0, marginTop: 1 }} />
            <div>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Cliente não encontrado</div>
              <div style={{ fontSize: fz(13), color: palette.inkSoft }}>
                {resultado.mensagem || 'Esse documento não está no sistema. Pra cadastrar um cliente novo, fale com o admin.'}
              </div>
            </div>
          </div>
        )}

        {/* Cliente encontrado: mostra dados + campo pra cadastrar nome */}
        {resultado && resultado.encontrado && (
          <>
            <div style={{
              background: palette.surface,
              border: `1px solid ${palette.beige}`,
              borderRadius: 12, padding: 14, marginBottom: 16,
            }}>
              <div style={{
                fontSize: fz(11), color: palette.inkMuted, letterSpacing: 1,
                textTransform: 'uppercase', marginBottom: 4, fontWeight: 600,
              }}>
                {resultado.cliente.tipo_documento === 'cnpj' ? 'CNPJ' : 'CPF'} encontrado
              </div>
              <div style={{
                fontSize: fz(16), color: palette.ink, fontWeight: 600, marginBottom: 6,
              }}>
                {resultado.cliente.razao_social}
              </div>
              <div style={{ fontSize: fz(13), color: palette.inkSoft }}>
                {resultado.cliente.documento_formatado}
                {resultado.cliente.vendedora_nome && (
                  <> · Carteira: <strong>{resultado.cliente.vendedora_nome}</strong></>
                )}
              </div>
              {(resultado.cliente.comprador_nome || resultado.cliente.apelido) && (
                <div style={{
                  marginTop: 8, paddingTop: 8,
                  borderTop: `1px solid ${palette.beige}`,
                  fontSize: fz(13), color: palette.inkSoft,
                }}>
                  Comprador atual: <strong style={{ color: palette.ink }}>
                    {resultado.cliente.comprador_nome || resultado.cliente.apelido}
                  </strong>
                </div>
              )}
            </div>

            {/* Campo nome comprador */}
            <label style={{
              display: 'block', fontSize: fz(13), color: palette.inkMuted,
              letterSpacing: 0.5, marginBottom: 6, fontWeight: 600,
              textTransform: 'uppercase',
            }}>
              Nome do comprador
            </label>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              background: palette.surface, border: `1px solid ${palette.beige}`,
              borderRadius: 10, padding: '10px 12px', marginBottom: 16,
            }}>
              <User size={sz(18)} color={palette.inkMuted} />
              <input
                value={nomeComprador}
                onChange={e => setNomeComprador(e.target.value)}
                placeholder=""
                maxLength={100}
                style={{
                  flex: 1, border: 'none', background: 'transparent', outline: 'none',
                  fontFamily: FONT, fontSize: fz(16), color: palette.ink,
                }}
              />
            </div>

            {/* Erro de salvar */}
            {erro && (
              <div style={{
                background: palette.alertSoft,
                border: `1px solid ${palette.alert}40`,
                borderRadius: 10, padding: 12, marginBottom: 16,
                display: 'flex', alignItems: 'flex-start', gap: 8,
                fontSize: fz(14), color: palette.alert,
              }}>
                <AlertCircle size={sz(18)} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>{erro}</span>
              </div>
            )}

            {/* Sucesso */}
            {salvoOk && (
              <div style={{
                background: palette.okSoft,
                border: `1px solid ${palette.ok}50`,
                borderRadius: 10, padding: 12, marginBottom: 16,
                display: 'flex', alignItems: 'center', gap: 8,
                fontSize: fz(14), color: palette.ok, fontWeight: 600,
              }}>
                <CheckCircle2 size={sz(18)} />
                <span>Comprador cadastrado com sucesso!</span>
              </div>
            )}

            {/* Botão salvar */}
            <button
              onClick={salvar}
              disabled={salvando || nomeComprador.trim().length < 2 || salvoOk}
              style={{
                width: '100%', padding: '14px 16px',
                background: salvando || salvoOk ? palette.beige : palette.accent,
                color: salvando || salvoOk ? palette.inkMuted : '#fff',
                border: 'none', borderRadius: 10,
                fontSize: fz(16), fontWeight: 600, fontFamily: FONT,
                cursor: salvando || nomeComprador.trim().length < 2 || salvoOk ? 'default' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}
            >
              {salvando ? (
                <>
                  <Loader2 size={sz(18)} style={{ animation: 'spin 1s linear infinite' }} />
                  Salvando…
                </>
              ) : salvoOk ? (
                <>
                  <CheckCircle2 size={sz(18)} />
                  Salvo!
                </>
              ) : (
                <>
                  <Save size={sz(18)} />
                  Salvar comprador
                </>
              )}
            </button>
          </>
        )}
      </div>
    </div>
  );
};
