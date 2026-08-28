// Disparo de teste (Ailson 28/08/2026) — manda um template aprovado pro numero
// dele antes de soltar pra base. Usado na Config da Sofia (marca="sofia") e na
// tela Treinar Lara do Meluni (marca="lara"). Nao grava em conversa nenhuma.
import React from 'react';

const TEL_PADRAO = '(11) 94723-3547';

export default function TesteDisparo({ marca, palette, FONT }) {
  const p = palette || {};
  const ink = p.ink || '#2c3e50';
  const muted = p.inkMuted || '#7b8794';
  const beige = p.beige || '#e8e2da';
  const fonte = FONT || 'Georgia, serif';

  const [tpls, setTpls] = React.useState([]);
  const [carregando, setCarregando] = React.useState(true);
  const [template, setTemplate] = React.useState('');
  const [telefone, setTelefone] = React.useState(TEL_PADRAO);
  const [nome, setNome] = React.useState('Ailson');
  const [enviando, setEnviando] = React.useState(false);
  const [msg, setMsg] = React.useState(null); // {tipo:'ok'|'erro', texto}

  React.useEffect(() => {
    let vivo = true;
    setCarregando(true);
    fetch(`/api/whats-teste-disparo?marca=${marca}`)
      .then(r => r.json())
      .then(j => {
        if (!vivo) return;
        if (j?.ok) setTpls(j.templates || []);
        else setMsg({ tipo: 'erro', texto: j?.erro || 'nao consegui listar os templates' });
        setCarregando(false);
      })
      .catch(() => { if (vivo) { setCarregando(false); setMsg({ tipo: 'erro', texto: 'falha ao listar templates' }); } });
    return () => { vivo = false; };
  }, [marca]);

  const escolhido = tpls.find(t => t.name === template) || null;

  const enviar = async () => {
    if (!template || enviando) return;
    setEnviando(true); setMsg(null);
    try {
      const r = await fetch('/api/whats-teste-disparo', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ marca, template, telefone, nome }),
      });
      const j = await r.json();
      if (j?.ok) setMsg({ tipo: 'ok', texto: `Enviado pra ${j.telefone}. Confere no WhatsApp.` });
      else setMsg({ tipo: 'erro', texto: j?.erro || 'falhou' });
    } catch (e) {
      setMsg({ tipo: 'erro', texto: String(e?.message || e) });
    }
    setEnviando(false);
  };

  const inputSt = {
    padding: '9px 11px', borderRadius: 9, border: `1.5px solid ${beige}`,
    fontSize: 14, fontFamily: fonte, color: ink, width: '100%', boxSizing: 'border-box',
  };

  return (
    <div style={{ background: '#fff', border: `1.5px solid ${beige}`, borderRadius: 13, padding: 14, marginBottom: 12 }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: ink, marginBottom: 4 }}>🧪 Disparo de teste</div>
      <div style={{ fontSize: 11.5, color: muted, marginBottom: 10 }}>
        Manda um template aprovado pro seu número pra você ver como a cliente recebe. Não entra em conversa nenhuma e não conta como campanha.
      </div>

      {carregando ? (
        <div style={{ fontSize: 12.5, color: muted }}>Carregando templates aprovados…</div>
      ) : (
        <>
          <div style={{ display: 'grid', gap: 8, marginBottom: 8 }}>
            <select value={template} onChange={e => { setTemplate(e.target.value); setMsg(null); }} style={inputSt}>
              <option value="">Escolha o template…</option>
              {tpls.map(t => (
                <option key={t.name} value={t.name}>
                  {t.name}{t.tem_imagem ? ' 🖼' : ''}{t.variaveis ? ` · ${t.variaveis} var` : ''}
                </option>
              ))}
            </select>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={telefone} onChange={e => setTelefone(e.target.value)} placeholder="(11) 90000-0000"
                inputMode="numeric" style={{ ...inputSt, flex: 1 }} />
              <input value={nome} onChange={e => setNome(e.target.value)} placeholder="Nome"
                style={{ ...inputSt, flex: 1 }} />
            </div>
          </div>

          {escolhido?.preview && (
            <div style={{ fontSize: 12, color: ink, background: p.cream || '#f7f4f0', border: `1px solid ${beige}`,
              borderRadius: 9, padding: '9px 11px', marginBottom: 9, whiteSpace: 'pre-wrap', maxHeight: 190, overflow: 'auto' }}>
              {escolhido.preview
                .replace(/\{\{1\}\}/g, escolhido.variaveis >= 2 ? 'Boa noite' : (nome || 'Ailson'))
                .replace(/\{\{2\}\}/g, nome || 'Ailson')}
            </div>
          )}

          <button onClick={enviar} disabled={!template || enviando}
            style={{ width: '100%', padding: '12px', borderRadius: 11, border: 'none',
              background: !template || enviando ? '#9bb0c4' : '#1e8e4e', color: '#fff',
              fontSize: 14.5, fontWeight: 800, cursor: !template || enviando ? 'default' : 'pointer', fontFamily: fonte }}>
            {enviando ? 'Enviando…' : '📲 Enviar teste'}
          </button>

          {msg && (
            <div style={{ marginTop: 9, fontSize: 12.5, fontWeight: 700,
              color: msg.tipo === 'ok' ? '#1e8e4e' : '#c0392b' }}>
              {msg.tipo === 'ok' ? '✓ ' : '⚠ '}{msg.texto}
            </div>
          )}
        </>
      )}
    </div>
  );
}
