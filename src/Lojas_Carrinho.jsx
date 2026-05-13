/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Lojas_Carrinho.jsx — Módulo Leads Carrinho Convertr (Onda 2 — Tela)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Tab "🛒 Carrinho" no header de Lojas (visível pra admin e vendedoras).
 *
 * Sub-tabs internas:
 *   - 🛒 Carrinhos (default)
 *      • CNPJs na fila pública (todas vendedoras veem)
 *      • CPFs atribuídos pra MIM (admin vê todos atribuídos)
 *   - 📋 CPFs aguardando atribuição (admin only — Onda 2.2, placeholder agora)
 *   - 📤 Importar planilhas (admin only — Onda 2.3, placeholder agora)
 *
 * Cards mostram:
 *   - Nome/Razão social, tipo (CNPJ/CPF), UF, telefone
 *   - Fotos das peças do último carrinho com REF + cor inferida
 *   - Valor + qtd peças
 *   - Status (novo, em atendimento, mensagem enviada)
 *   - "Cliente já cadastrada" (se ja_e_cliente_lojas_id setado)
 *
 * Ações na Onda 3 (não implementado aqui): "Pedir mensagem IA", "Marcar
 * enviado", lock mechanism. Por enquanto cards são read-only.
 *
 * Sessão Ailson 12/05/2026.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ShoppingCart, Building2, User, MapPin, Phone, AlertCircle,
  RefreshCw, Upload, Loader2, Tag, Sparkles, Clock, ExternalLink,
  Filter, Search, ChevronRight, UserCheck, X, Check, Send,
} from 'lucide-react';

import {
  palette, FONT, fz, sz, TelefoneCopiavel, supabase,
} from './Lojas_Shared.jsx';

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function fmtMoeda(v) {
  if (v == null || isNaN(v)) return '—';
  return 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function diasDesde(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  const hoje = new Date();
  return Math.floor((hoje - d) / 86400000);
}

function fmtHoras(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const hoje = new Date();
  const diffMs = hoje - d;
  const dias = Math.floor(diffMs / 86400000);
  const horas = Math.floor((diffMs % 86400000) / 3600000);
  if (dias === 0 && horas === 0) return 'agora';
  if (dias === 0) return `${horas}h atrás`;
  if (dias === 1) return 'ontem';
  return `${dias}d atrás`;
}

// Nome de display do lead — prioriza razão social (PJ) ou nome
function nomeLead(lead) {
  if (lead.tipo_pessoa === 'PJ' && lead.razao_social) {
    return lead.razao_social.replace(/\s+/g, ' ').trim();
  }
  return (lead.nome_completo || lead.first_name || lead.email || 'Lead').trim();
}

// ═══════════════════════════════════════════════════════════════════════════
// LeadCard — card individual de lead com carrinho
// Quando expandido (state interno): mostra IA gera mensagem + edição
// + botão "Enviar WhatsApp" (auto-marca como enviada) + observações livres.
// ═══════════════════════════════════════════════════════════════════════════

const LeadCard = ({ lead, userId, isAdmin, vendedoraId, vendedoraNome, limitesDiarios, onAcaoConcluida, onClickAdmin }) => {
  const items = lead.ultimo_evento?.items_parsed || [];
  const valor = lead.valor_ultimo_carrinho || lead.ultimo_evento?.total || 0;
  const pecas = lead.qtd_pecas_ultimo_carrinho || lead.ultimo_evento?.items_count || 0;
  const isPJ = lead.tipo_pessoa === 'PJ';

  // States internos do card
  const [expandido, setExpandido] = useState(false);
  const [mensagemIA, setMensagemIA] = useState('');
  const [textoEditavel, setTextoEditavel] = useState('');
  const [gerandoIA, setGerandoIA] = useState(false);
  const [erroIA, setErroIA] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [obsLivre, setObsLivre] = useState('');
  const [obsAberta, setObsAberta] = useState(false);
  const [obsCarregada, setObsCarregada] = useState(false);
  const [salvandoObs, setSalvandoObs] = useState(false);

  // Status visual
  let statusBadge = null;
  const jaEnviada = !!lead.ultima_msg_enviada_em;
  const convertido = lead.status === 'convertido';
  // Lock atualizado (do backend) OU detectado nesta sessão (lockInfo state)
  const outraAtendendo = (
    lead.lock_ativo && !lead.lock_e_minha
  ) || !!lockInfo;
  if (convertido) {
    statusBadge = {
      label: `✓ Converteu${lead.convertido_valor ? ' ' + fmtMoeda(lead.convertido_valor) : ''}`,
      cor: palette.ok, soft: palette.okSoft,
    };
  } else if (lead.status === 'mensagem_enviada' || jaEnviada) {
    statusBadge = {
      label: lead.ultima_msg_vendedora_nome
        ? `✓ Enviada por ${lead.ultima_msg_vendedora_nome}`
        : '✓ Mensagem enviada',
      cor: palette.ok, soft: palette.okSoft,
    };
  } else if (outraAtendendo) {
    // Lock de outra vendedora — mostra no card pra deixar claro
    const vNome = lockInfo?.vendedora || lead.vendedora_atendendo_nome || 'Outra vendedora';
    statusBadge = {
      label: `⏳ ${vNome} atendendo`,
      cor: palette.warn, soft: palette.warnSoft,
    };
  }

  const jaCliente = lead.ja_e_cliente_lojas_id;

  // Limite atingido pra esse tipo?
  const limiteAtingido = limitesDiarios && (
    (isPJ && limitesDiarios.pj_restante <= 0) ||
    (!isPJ && limitesDiarios.pf_restante <= 0)
  );

  // Estado do lock — Ailson 13/05/2026
  // Quando vendedora abre o card, tenta pegar lock de 30 min. Se outra
  // vendedora já tá atendendo, bloqueia (toast + não expande).
  const [tentandoLock, setTentandoLock] = useState(false);
  const [lockInfo, setLockInfo] = useState(null); // { vendedora_nome, expira }

  // ─── Handlers ────────────────────────────────────────────────
  const toggleExpandir = async () => {
    // Admin CPF aguardando atribuição: callback especial (modal atribuir)
    if (onClickAdmin && isAdmin && lead.status === 'aguardando_atribuicao') {
      onClickAdmin(lead);
      return;
    }

    // Se já tá expandido, só colapsa
    if (expandido) {
      setExpandido(false);
      return;
    }

    // Lead já com msg enviada / convertido / admin: expande SEM pegar lock
    // (status pós-atendimento = pode todas verem, sem travar)
    if (jaEnviada || convertido || !vendedoraId) {
      setExpandido(true);
      return;
    }

    // Tenta pegar o lock — só na fila pública / atribuído pra mim
    setTentandoLock(true);
    setLockInfo(null);
    try {
      const r = await fetch('/api/lojas-leads-pegar-lock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User': userId },
        body: JSON.stringify({ lead_id: lead.id }),
      });
      const json = await r.json();
      if (json.ok) {
        setExpandido(true);
      } else if (json.motivo === 'lock_de_outra_vendedora') {
        const expira = json.lock_expira_em ? new Date(json.lock_expira_em) : null;
        const horaExpira = expira
          ? expira.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
          : 'logo';
        alert(`${json.vendedora_atendendo_nome || 'Outra vendedora'} já tá atendendo esse lead até ${horaExpira} ⏳`);
        setLockInfo({ vendedora: json.vendedora_atendendo_nome, expira });
      } else {
        alert(json.error || 'Não foi possível abrir o lead agora');
      }
    } catch (e) {
      alert('Erro ao abrir lead: ' + e.message);
    } finally {
      setTentandoLock(false);
    }
  };

  const gerarMensagem = async () => {
    setGerandoIA(true);
    setErroIA(null);
    try {
      const r = await fetch('/api/lojas-leads-mensagem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User': userId },
        body: JSON.stringify({ action: 'gerar', lead_id: lead.id }),
      });
      const json = await r.json();
      if (!r.ok || !json.ok) throw new Error(json.error || 'Erro ao gerar');
      setMensagemIA(json.mensagem);
      setTextoEditavel(json.mensagem);
    } catch (e) {
      setErroIA(e.message);
    } finally {
      setGerandoIA(false);
    }
  };

  const enviarWhatsApp = async () => {
    if (!textoEditavel.trim()) {
      alert('Texto da mensagem está vazio');
      return;
    }
    if (!vendedoraId) {
      alert('Só vendedoras logadas podem enviar (admin não envia em nome de ninguém)');
      return;
    }
    setEnviando(true);
    try {
      const r = await fetch('/api/lojas-leads-mensagem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User': userId },
        body: JSON.stringify({
          action: 'marcar_enviada',
          lead_id: lead.id,
          texto: textoEditavel,
        }),
      });
      const json = await r.json();
      if (!r.ok || !json.ok) {
        if (r.status === 429) {
          alert(json.error);
          return;
        }
        throw new Error(json.error || 'Erro ao enviar');
      }
      // Abre WhatsApp em nova aba
      if (json.wa_me_url) {
        window.open(json.wa_me_url, '_blank');
      } else {
        alert('Mensagem registrada mas telefone inválido pra wa.me');
      }
      // Recarrega a lista (lead vai pra status enviada)
      onAcaoConcluida && onAcaoConcluida();
    } catch (e) {
      alert(`Erro: ${e.message}`);
    } finally {
      setEnviando(false);
    }
  };

  const carregarObs = async () => {
    if (obsCarregada) return;
    try {
      const r = await fetch(`/api/lojas-leads-observacao?lead_id=${lead.id}`, {
        headers: { 'X-User': userId },
      });
      const json = await r.json();
      if (r.ok && json.ok) setObsLivre(json.texto_livre || '');
    } catch {}
    setObsCarregada(true);
  };

  const toggleObs = () => {
    if (!obsAberta) carregarObs();
    setObsAberta(o => !o);
  };

  const salvarObs = async () => {
    setSalvandoObs(true);
    try {
      const r = await fetch('/api/lojas-leads-observacao', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User': userId },
        body: JSON.stringify({ lead_id: lead.id, texto: obsLivre }),
      });
      const json = await r.json();
      if (!r.ok || !json.ok) throw new Error(json.error || 'Erro');
    } catch (e) {
      alert(`Erro ao salvar: ${e.message}`);
    } finally {
      setSalvandoObs(false);
    }
  };

  // ─── Render ──────────────────────────────────────────────────
  return (
    <div style={{
      background: convertido ? palette.okSoft : palette.surface,
      border: `${convertido ? 2 : 1}px solid ${convertido ? palette.ok : palette.beige}`,
      borderRadius: 12, padding: 14,
      fontFamily: FONT, marginBottom: 10,
    }}>
      {/* HEADER do card — clicável pra expandir (com lock de 30 min) */}
      <div
        onClick={tentandoLock ? undefined : toggleExpandir}
        style={{
          cursor: tentandoLock ? 'wait' : 'pointer',
          opacity: tentandoLock ? 0.7 : 1,
          display: 'flex', alignItems: 'flex-start',
          justifyContent: 'space-between', gap: 10, marginBottom: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 8,
            background: isPJ ? palette.accentSoft : palette.purpleSoft,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            {isPJ ? <Building2 size={sz(20)} color={palette.accent} /> : <User size={sz(20)} color={palette.purple} />}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: fz(15), fontWeight: 600, color: palette.ink, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {nomeLead(lead)}
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 2, flexWrap: 'wrap' }}>
              <span style={{
                fontSize: fz(11), fontWeight: 600, letterSpacing: 0.3,
                color: isPJ ? palette.accent : palette.purple,
                background: isPJ ? palette.accentSoft : palette.purpleSoft,
                padding: '2px 6px', borderRadius: 4,
              }}>
                {isPJ ? 'CNPJ' : `CPF · ${pecas}pç`}
              </span>
              {lead.uf_inferida && (
                <span style={{ fontSize: fz(12), color: palette.inkMuted, display: 'flex', alignItems: 'center', gap: 2 }}>
                  <MapPin size={sz(12)} /> {lead.uf_inferida}
                </span>
              )}
              {jaCliente && (
                <span style={{
                  fontSize: fz(11), fontWeight: 600, color: palette.ok, background: palette.okSoft,
                  padding: '2px 6px', borderRadius: 4,
                }}>
                  ⭐ Já é cliente
                </span>
              )}
            </div>
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: fz(18), fontWeight: 700, color: palette.ink, lineHeight: 1 }}>{fmtMoeda(valor)}</div>
          <div style={{ fontSize: fz(11), color: palette.inkMuted, marginTop: 2 }}>{pecas} {pecas === 1 ? 'peça' : 'peças'}</div>
        </div>
      </div>

      {/* FOTOS das peças */}
      {items.length > 0 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
          {items.slice(0, expandido ? items.length : 4).map((item, i) => (
            <div key={i} style={{
              position: 'relative', width: 56, height: 56, borderRadius: 8,
              background: palette.beigeSoft, overflow: 'hidden', flexShrink: 0,
            }}>
              {item.foto_url && (
                <img src={item.foto_url} alt={item.ref_descricao || ''}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }} loading="lazy" />
              )}
              {item.ref && (
                <div style={{
                  position: 'absolute', bottom: 0, left: 0, right: 0,
                  background: 'rgba(0,0,0,0.7)', color: '#fff',
                  fontSize: fz(10), fontWeight: 700, padding: '1px 3px', textAlign: 'center',
                }}>
                  {item.ref}
                </div>
              )}
            </div>
          ))}
          {!expandido && items.length > 4 && (
            <div style={{
              width: 56, height: 56, borderRadius: 8, background: palette.beigeSoft,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: palette.inkSoft, fontSize: fz(14), fontWeight: 600, flexShrink: 0,
            }}>
              +{items.length - 4}
            </div>
          )}
        </div>
      )}

      {/* FOOTER infos */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        fontSize: fz(12), color: palette.inkSoft,
      }}>
        {lead.telefone_raw && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Phone size={sz(12)} /> {lead.telefone_raw}
          </span>
        )}
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <Clock size={sz(12)} /> {fmtHoras(lead.ultimo_carrinho_em)}
        </span>
        {statusBadge && (
          <span style={{
            fontSize: fz(11), fontWeight: 600,
            color: statusBadge.cor, background: statusBadge.soft,
            padding: '2px 7px', borderRadius: 4, marginLeft: 'auto',
          }}>
            {statusBadge.label}
          </span>
        )}
      </div>

      {/* CONTEÚDO EXPANDIDO — IA + Envio + Observações */}
      {expandido && (
        <div style={{
          marginTop: 12, paddingTop: 12,
          borderTop: `1px dashed ${palette.beige}`,
        }}>
          {/* Lista de peças com REF (texto) */}
          {items.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: fz(11), fontWeight: 600, letterSpacing: 1, color: palette.inkMuted, textTransform: 'uppercase', marginBottom: 6 }}>
                Peças no carrinho
              </div>
              <div style={{ fontSize: fz(13), color: palette.ink, lineHeight: 1.5 }}>
                {items.map((it, i) => (
                  <div key={i}>
                    • {it.ref ? <strong>REF {it.ref}</strong> : <em>(sem REF)</em>}
                    {' — '}
                    {it.ref_descricao || it.tipo_inferido || 'peça'}
                    {it.cor_inferida && <span style={{ color: palette.inkSoft }}> · {it.cor_inferida}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* BLOCO IA + ENVIO — sempre disponível (inclui follow-up) */}
          {vendedoraId && (
            <div style={{ marginBottom: 12 }}>
              {/* Se já enviou antes, mostra histórico curto */}
              {jaEnviada && (
                <div style={{
                  marginBottom: 10, padding: 10,
                  background: palette.okSoft, border: `1px solid ${palette.ok}40`,
                  borderRadius: 8, fontSize: fz(12), color: palette.ok,
                  display: 'flex', alignItems: 'center', gap: 6,
                }}>
                  <Check size={sz(14)} />
                  <div>
                    Mensagem enviada {fmtHoras(lead.ultima_msg_enviada_em)}
                    {lead.ultima_msg_vendedora_nome ? ` por ${lead.ultima_msg_vendedora_nome}` : ''}.
                    {' '}<strong>Pode gerar outra (follow-up).</strong>
                  </div>
                </div>
              )}

              {/* Mensagem amigável quando limite atingido — Ailson 13/05/2026 */}
              {limiteAtingido && !mensagemIA && (
                <div style={{
                  padding: '14px 16px',
                  background: palette.warnSoft,
                  border: `1px solid ${palette.warn}30`,
                  borderRadius: 10, fontSize: fz(13), color: palette.ink,
                  lineHeight: 1.5, fontFamily: FONT,
                }}>
                  Oiii{vendedoraNome ? ` ${vendedoraNome.split(' ')[0]}` : ''} 😉
                  {' '}por enquanto o limite é de <strong>1 lead CNPJ</strong> e <strong>1 CPF</strong> diários. Tenta de novo amanhã!
                </div>
              )}

              {!limiteAtingido && !mensagemIA && (
                <button
                  onClick={gerarMensagem}
                  disabled={gerandoIA}
                  style={{
                    width: '100%', padding: 12,
                    background: palette.accent, color: palette.bg,
                    border: 'none', borderRadius: 10, fontFamily: FONT,
                    fontSize: fz(14), fontWeight: 600,
                    cursor: gerandoIA ? 'not-allowed' : 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  }}
                >
                  {gerandoIA ? (
                    <><Loader2 size={sz(16)} style={{ animation: 'spin 0.8s linear infinite' }} /> Gerando…</>
                  ) : (
                    <><Sparkles size={sz(16)} /> {jaEnviada ? 'Gerar nova mensagem (follow-up)' : 'Gerar mensagem com IA'}</>
                  )}
                </button>
              )}

              {erroIA && (
                <div style={{
                  marginTop: 8, padding: 8, background: palette.alertSoft, color: palette.alert,
                  borderRadius: 8, fontSize: fz(12),
                }}>
                  {erroIA}
                </div>
              )}

              {mensagemIA && (
                <>
                  <div style={{ fontSize: fz(11), fontWeight: 600, letterSpacing: 1, color: palette.inkMuted, textTransform: 'uppercase', marginBottom: 4 }}>
                    Mensagem (edite se quiser)
                  </div>
                  <textarea
                    value={textoEditavel}
                    onChange={e => setTextoEditavel(e.target.value)}
                    rows={5}
                    style={{
                      width: '100%', boxSizing: 'border-box',
                      padding: 10, fontFamily: FONT, fontSize: fz(13),
                      border: `1px solid ${palette.beige}`, borderRadius: 8,
                      background: palette.bg, color: palette.ink, resize: 'vertical',
                    }}
                  />
                  <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                    <button
                      onClick={gerarMensagem}
                      disabled={gerandoIA}
                      style={{
                        padding: '10px 12px', fontFamily: FONT, fontSize: fz(13),
                        background: palette.surface, color: palette.inkSoft,
                        border: `1px solid ${palette.beige}`, borderRadius: 8,
                        cursor: gerandoIA ? 'not-allowed' : 'pointer',
                      }}
                    >
                      🔄 Gerar outra
                    </button>
                    <button
                      onClick={enviarWhatsApp}
                      disabled={enviando || !textoEditavel.trim() || limiteAtingido}
                      style={{
                        flex: 1, padding: '10px 12px', fontFamily: FONT, fontSize: fz(14), fontWeight: 600,
                        background: enviando || limiteAtingido ? palette.beige : '#25D366',
                        color: '#fff', border: 'none', borderRadius: 8,
                        cursor: enviando || !textoEditavel.trim() || limiteAtingido ? 'not-allowed' : 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      }}
                    >
                      {enviando ? (
                        <><Loader2 size={sz(16)} style={{ animation: 'spin 0.8s linear infinite' }} /> Enviando…</>
                      ) : (
                        <><Send size={sz(16)} /> Enviar WhatsApp</>
                      )}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Mensagem se admin (não pode enviar) */}
          {!jaEnviada && !vendedoraId && isAdmin && (
            <div style={{
              padding: 10, background: palette.warnSoft, color: palette.warn,
              borderRadius: 8, fontSize: fz(12), marginBottom: 12,
            }}>
              Admin não envia mensagem em nome de vendedora. Use o app como vendedora.
            </div>
          )}

          {/* BLOCO OBSERVAÇÕES LIVRES */}
          <div>
            <button
              onClick={toggleObs}
              style={{
                padding: '8px 12px', fontFamily: FONT, fontSize: fz(13), fontWeight: 600,
                background: palette.surface, color: palette.ink,
                border: `1px solid ${palette.beige}`, borderRadius: 8,
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              📝 Outras informações {obsAberta ? '▴' : '▾'}
            </button>
            {obsAberta && (
              <div style={{ marginTop: 8 }}>
                <textarea
                  value={obsLivre}
                  onChange={e => setObsLivre(e.target.value)}
                  rows={3}
                  placeholder="Notas livres sobre esse lead (não vai pra IA, só pra equipe)…"
                  style={{
                    width: '100%', boxSizing: 'border-box',
                    padding: 10, fontFamily: FONT, fontSize: fz(13),
                    border: `1px solid ${palette.beige}`, borderRadius: 8,
                    background: palette.bg, color: palette.ink, resize: 'vertical',
                  }}
                />
                <button
                  onClick={salvarObs}
                  disabled={salvandoObs}
                  style={{
                    marginTop: 6, padding: '8px 14px', fontFamily: FONT, fontSize: fz(13), fontWeight: 600,
                    background: palette.ink, color: palette.bg,
                    border: 'none', borderRadius: 8,
                    cursor: salvandoObs ? 'not-allowed' : 'pointer',
                  }}
                >
                  {salvandoObs ? 'Salvando…' : 'Salvar'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// LeadsListagem — lista de cards (CNPJ pública / CPF meus)
// ═══════════════════════════════════════════════════════════════════════════

const LeadsListagem = ({ userId, isAdmin, vendedoraId, vendedoraNome, onAbrirLead }) => {
  const [escopo, setEscopo] = useState('cnpj_publico');
  const [ordenar, setOrdenar] = useState('recentes'); // 'valor' | 'recentes' — padrao Ailson 13/05
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(null);
  const [data, setData] = useState({ leads: [], badge: {}, envios_hoje: {}, limites_diarios: {} });

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro(null);
    try {
      const r = await fetch(`/api/lojas-leads-listar?escopo=${escopo}&ordenar=${ordenar}`, {
        headers: { 'X-User': userId },
      });
      const json = await r.json();
      if (!r.ok || !json.ok) throw new Error(json.error || 'Erro ao carregar leads');
      setData({
        leads: json.leads || [],
        badge: json.badge || {},
        envios_hoje: json.envios_hoje || {},
        limites_diarios: json.limites_diarios || {},
      });
    } catch (e) {
      setErro(e.message);
      setData({ leads: [], badge: {}, envios_hoje: {}, limites_diarios: {} });
    } finally {
      setLoading(false);
    }
  }, [escopo, ordenar, userId]);

  useEffect(() => { carregar(); }, [carregar]);

  // ─── Toggle CNPJ / CPF ──────────────────────────────────────────
  // Labels Ailson 13/05/2026: 'Lista carrinhos' + 'Carrinho CPF'
  const escoposVisiveis = useMemo(() => {
    const base = [
      { id: 'cnpj_publico', label: 'Lista carrinhos', icon: ShoppingCart },
    ];
    base.push({ id: 'cpf_atribuidos', label: 'Carrinho CPF', icon: User });
    if (isAdmin) {
      base.push({ id: 'cpf_aguardando', label: 'Aguardando', icon: AlertCircle });
    }
    return base;
  }, [isAdmin]);

  return (
    <div style={{ padding: '14px 14px 80px 14px', fontFamily: FONT }}>
      {/* Toggle de escopo */}
      <div style={{
        display: 'flex', gap: 6, marginBottom: 14, overflowX: 'auto', WebkitOverflowScrolling: 'touch',
      }}>
        {escoposVisiveis.map(e => {
          const active = escopo === e.id;
          const Icon = e.icon;
          return (
            <button
              key={e.id}
              onClick={() => setEscopo(e.id)}
              style={{
                flexShrink: 0,
                background: active ? palette.ink : palette.surface,
                color: active ? palette.bg : palette.ink,
                border: `1px solid ${active ? palette.ink : palette.beige}`,
                borderRadius: 8, padding: '8px 14px',
                cursor: 'pointer', fontFamily: FONT,
                fontSize: fz(13), fontWeight: active ? 600 : 500,
                whiteSpace: 'nowrap', transition: 'all 0.15s',
                display: 'inline-flex', alignItems: 'center', gap: 6,
              }}
            >
              {Icon && <Icon size={sz(15)} />}
              {e.label}
            </button>
          );
        })}
        <button
          onClick={carregar}
          disabled={loading}
          style={{
            marginLeft: 'auto', flexShrink: 0,
            background: palette.surface, border: `1px solid ${palette.beige}`,
            borderRadius: 8, padding: '8px 12px',
            cursor: loading ? 'wait' : 'pointer', fontFamily: FONT,
            color: palette.inkSoft, display: 'flex', alignItems: 'center',
          }}
        >
          <RefreshCw size={sz(15)} style={{ animation: loading ? 'spin 0.8s linear infinite' : 'none' }} />
        </button>
      </div>

      {/* Ordenação — Ailson 13/05/2026 */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        marginBottom: 14, fontSize: fz(13), color: palette.inkSoft,
      }}>
        <Filter size={sz(14)} />
        <span>Ordenar:</span>
        <select
          value={ordenar}
          onChange={e => setOrdenar(e.target.value)}
          style={{
            flex: 1, padding: '6px 8px', borderRadius: 6,
            border: `1px solid ${palette.beige}`,
            fontFamily: FONT, fontSize: fz(13),
            color: palette.ink, background: palette.surface,
          }}
        >
          <option value="valor">Maior valor</option>
          <option value="recentes">Mais recentes</option>
        </select>
      </div>

      {/* Badge alegre — Ailson 13/05/2026 — tom 'oportunidade' em vez de 'pendente' */}
      {escopo === 'cnpj_publico' && data.badge.qtd_pj_com_carrinho_sem_msg > 0 && (
        <div style={{
          background: palette.accentSoft, border: `1px solid ${palette.accent}30`,
          borderRadius: 10, padding: 12, marginBottom: 14,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <Sparkles size={sz(20)} color={palette.accent} />
          <div style={{ fontSize: fz(13), color: palette.ink, lineHeight: 1.4 }}>
            <strong style={{ color: palette.accent }}>Oportunidade!!!</strong>
            {' '}
            <strong>{data.badge.qtd_pj_com_carrinho_sem_msg}</strong> {data.badge.qtd_pj_com_carrinho_sem_msg === 1 ? 'carrinho esperando' : 'carrinhos esperando'} mensagem
            {' · '}
            💰 <strong>{fmtMoeda(data.badge.soma_valor_pendente)}</strong>
            {data.badge.qtd_pj_alto_valor > 0 && (
              <>
                {' · '}
                <span style={{ color: palette.alert, fontWeight: 600 }}>
                  🔥 {data.badge.qtd_pj_alto_valor} alto valor
                </span>
              </>
            )}
          </div>
        </div>
      )}

      {/* Indicador de envios hoje da vendedora — só se vendedora logada */}
      {vendedoraId && (data.limites_diarios?.pj != null) && (
        <div style={{
          display: 'flex', gap: 8, marginBottom: 14,
          fontSize: fz(12), color: palette.inkSoft,
        }}>
          <span style={{
            padding: '6px 10px', background: palette.surface,
            border: `1px solid ${palette.beige}`, borderRadius: 8,
            fontFamily: FONT,
          }}>
            Hoje: <strong>{data.envios_hoje?.qtd_pj_hoje || 0}/{data.limites_diarios?.pj || 1}</strong> CNPJ
            {' · '}
            <strong>{data.envios_hoje?.qtd_pf_hoje || 0}/{data.limites_diarios?.pf || 1}</strong> CPF
          </span>
        </div>
      )}

      {/* Conteúdo */}
      {loading && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: 40 }}>
          <Loader2 size={sz(28)} color={palette.inkSoft} style={{ animation: 'spin 0.8s linear infinite' }} />
        </div>
      )}

      {!loading && erro && (
        <div style={{
          background: palette.alertSoft, border: `1px solid ${palette.alert}40`,
          borderRadius: 10, padding: 14,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <AlertCircle size={sz(20)} color={palette.alert} />
          <div style={{ fontSize: fz(13), color: palette.alert }}>{erro}</div>
        </div>
      )}

      {!loading && !erro && data.leads.length === 0 && (
        <div style={{ textAlign: 'center', padding: 40, color: palette.inkMuted }}>
          <ShoppingCart size={sz(40)} style={{ opacity: 0.3, marginBottom: 10 }} />
          <div style={{ fontSize: fz(14), fontFamily: FONT }}>
            {escopo === 'cnpj_publico' && 'Nenhum lead aguardando atendimento'}
            {escopo === 'cpf_atribuidos' && (isAdmin ? 'Nenhum CPF atribuído' : 'Nenhum CPF atribuído a você')}
            {escopo === 'cpf_aguardando' && 'Nenhum CPF aguardando atribuição'}
          </div>
        </div>
      )}

      {!loading && !erro && data.leads.length > 0 && (
        <div>
          {data.leads.map(lead => (
            <LeadCard
              key={lead.id}
              lead={lead}
              userId={userId}
              isAdmin={isAdmin}
              vendedoraId={vendedoraId}
              vendedoraNome={vendedoraNome}
              limitesDiarios={data.limites_diarios}
              onAcaoConcluida={carregar}
              onClickAdmin={onAbrirLead}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// ModalAtribuirCPF — admin escolhe vendedora pra atribuir um CPF
// ═══════════════════════════════════════════════════════════════════════════

const ModalAtribuirCPF = ({ lead, userId, onClose, onSucesso }) => {
  const [vendedoras, setVendedoras] = useState([]);
  const [selecionada, setSelecionada] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data, error } = await supabase
        .from('lojas_vendedoras')
        .select('id, nome, loja')
        .eq('ativa', true)
        .order('nome');
      if (alive && !error) setVendedoras(data || []);
    })();
    return () => { alive = false; };
  }, []);

  const confirmar = async () => {
    if (!selecionada) {
      setErro('Selecione uma vendedora');
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      const r = await fetch('/api/lojas-leads-atribuir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User': userId },
        body: JSON.stringify({ lead_id: lead.id, vendedora_id: selecionada }),
      });
      const json = await r.json();
      if (!r.ok || !json.ok) throw new Error(json.error || 'Erro ao atribuir');
      onSucesso && onSucesso(json);
      onClose();
    } catch (e) {
      setErro(e.message);
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 100, padding: 14, fontFamily: FONT,
    }}>
      <div style={{
        background: palette.surface, borderRadius: 14, maxWidth: 480, width: '100%',
        maxHeight: '90vh', overflow: 'auto',
      }}>
        {/* Header */}
        <div style={{ padding: '16px 18px 12px', borderBottom: `1px solid ${palette.beige}` }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
            <div>
              <div style={{ fontSize: fz(11), fontWeight: 600, letterSpacing: 1, color: palette.inkMuted, textTransform: 'uppercase' }}>
                Atribuir CPF a vendedora
              </div>
              <div style={{ fontSize: fz(18), fontWeight: 600, color: palette.ink, marginTop: 4 }}>
                {nomeLead(lead)}
              </div>
              <div style={{ fontSize: fz(12), color: palette.inkSoft, marginTop: 2 }}>
                {lead.uf_inferida && `${lead.uf_inferida} · `}
                {lead.qtd_pecas_ultimo_carrinho} {lead.qtd_pecas_ultimo_carrinho === 1 ? 'peça' : 'peças'} · {fmtMoeda(lead.valor_ultimo_carrinho)}
              </div>
            </div>
            <button onClick={onClose} style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              padding: 4, color: palette.inkSoft,
            }}>
              <X size={sz(22)} />
            </button>
          </div>
        </div>

        {/* Lista de vendedoras */}
        <div style={{ padding: 14 }}>
          <div style={{ fontSize: fz(13), color: palette.inkSoft, marginBottom: 10 }}>
            Selecione a vendedora que vai atender esse CPF:
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {vendedoras.map(v => {
              const active = selecionada === v.id;
              return (
                <button
                  key={v.id}
                  onClick={() => setSelecionada(v.id)}
                  style={{
                    background: active ? palette.accentSoft : palette.surface,
                    border: `1.5px solid ${active ? palette.accent : palette.beige}`,
                    borderRadius: 8, padding: '10px 12px',
                    cursor: 'pointer', fontFamily: FONT, textAlign: 'left',
                    display: 'flex', alignItems: 'center', gap: 10,
                  }}
                >
                  <div style={{
                    width: 28, height: 28, borderRadius: '50%',
                    background: active ? palette.accent : palette.beigeSoft,
                    color: active ? palette.bg : palette.ink,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontWeight: 700, fontSize: fz(12), letterSpacing: 0.3,
                    flexShrink: 0,
                  }}>
                    {v.nome.charAt(0).toUpperCase()}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: fz(14), fontWeight: 600, color: palette.ink }}>
                      {v.nome}
                    </div>
                    {v.loja && (
                      <div style={{ fontSize: fz(11), color: palette.inkMuted }}>
                        {v.loja}
                      </div>
                    )}
                  </div>
                  {active && <Check size={sz(18)} color={palette.accent} />}
                </button>
              );
            })}
          </div>

          {erro && (
            <div style={{
              background: palette.alertSoft, color: palette.alert,
              padding: 10, borderRadius: 8, fontSize: fz(13), marginTop: 10,
            }}>
              {erro}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: 14, borderTop: `1px solid ${palette.beige}`,
          display: 'flex', gap: 8,
        }}>
          <button
            onClick={onClose}
            disabled={salvando}
            style={{
              flex: 1, padding: 12, fontFamily: FONT, fontSize: fz(14), fontWeight: 600,
              background: palette.surface, color: palette.ink,
              border: `1px solid ${palette.beige}`, borderRadius: 8,
              cursor: salvando ? 'not-allowed' : 'pointer',
            }}
          >
            Cancelar
          </button>
          <button
            onClick={confirmar}
            disabled={salvando || !selecionada}
            style={{
              flex: 1.5, padding: 12, fontFamily: FONT, fontSize: fz(14), fontWeight: 600,
              background: salvando || !selecionada ? palette.beige : palette.ink,
              color: palette.bg,
              border: 'none', borderRadius: 8,
              cursor: salvando || !selecionada ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
          >
            {salvando ? <Loader2 size={sz(16)} style={{ animation: 'spin 0.8s linear infinite' }} /> : <Check size={sz(16)} />}
            {salvando ? 'Atribuindo…' : 'Atribuir'}
          </button>
        </div>
      </div>
    </div>
  );
};


// ═══════════════════════════════════════════════════════════════════════════
// ModalImportarPlanilhas — admin cola CSVs de clientes + carrinhos
// ═══════════════════════════════════════════════════════════════════════════

const ModalImportarPlanilhas = ({ userId, onClose, onSucesso }) => {
  const [clientesCsv, setClientesCsv] = useState('');
  const [carrinhosCsv, setCarrinhosCsv] = useState('');
  const [planilhaOrigem, setPlanilhaOrigem] = useState(
    `manual_${new Date().toISOString().slice(0, 10)}`
  );
  const [importando, setImportando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [erro, setErro] = useState(null);

  const importar = async () => {
    if (!clientesCsv.trim()) {
      setErro('Cole o CSV de clientes (obrigatório)');
      return;
    }
    setImportando(true);
    setErro(null);
    setResultado(null);
    try {
      const r = await fetch('/api/lojas-leads-importar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User': userId },
        body: JSON.stringify({
          clientes_csv: clientesCsv,
          carrinhos_csv: carrinhosCsv || null,
          planilha_origem: planilhaOrigem || `manual_${new Date().toISOString().slice(0, 10)}`,
        }),
      });
      const json = await r.json();
      if (!r.ok || !json.ok) throw new Error(json.error || 'Erro ao importar');
      setResultado(json);
      onSucesso && onSucesso(json);
    } catch (e) {
      setErro(e.message);
    } finally {
      setImportando(false);
    }
  };

  // Se já importou com sucesso, mostra resumo
  if (resultado) {
    const s = resultado.stats;
    return (
      <div style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 100, padding: 14, fontFamily: FONT,
      }}>
        <div style={{
          background: palette.surface, borderRadius: 14, maxWidth: 520, width: '100%',
          maxHeight: '90vh', overflow: 'auto',
        }}>
          <div style={{ padding: '20px 20px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <div style={{
                width: 40, height: 40, borderRadius: '50%',
                background: palette.okSoft, color: palette.ok,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Check size={sz(24)} />
              </div>
              <div>
                <div style={{ fontSize: fz(11), fontWeight: 600, letterSpacing: 1, color: palette.ok, textTransform: 'uppercase' }}>
                  Importação concluída
                </div>
                <div style={{ fontSize: fz(16), fontWeight: 600, color: palette.ink, marginTop: 2 }}>
                  {resultado.mensagem || `${s.clientes_processados} leads importados`}
                </div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <StatBox label="PJ (CNPJ)" valor={s.clientes_pj || 0} cor={palette.accent} />
              <StatBox label="PF (CPF)" valor={s.clientes_pf || 0} cor={palette.purple} />
              <StatBox label="Carrinhos válidos" valor={s.carrinhos_inseridos || 0} cor={palette.ok} />
              <StatBox label="Carrinhos vazios (skip)" valor={s.carrinhos_skipped_vazios || 0} cor={palette.inkMuted} />
              {(s.leads_matched_por_documento + s.leads_matched_por_telefone) > 0 && (
                <StatBox
                  label="Já são clientes"
                  valor={(s.leads_matched_por_documento || 0) + (s.leads_matched_por_telefone || 0)}
                  cor={palette.warn}
                />
              )}
            </div>
          </div>
          <div style={{
            padding: 14, borderTop: `1px solid ${palette.beige}`,
            display: 'flex', justifyContent: 'flex-end',
          }}>
            <button
              onClick={onClose}
              style={{
                padding: '10px 20px', fontFamily: FONT, fontSize: fz(14), fontWeight: 600,
                background: palette.ink, color: palette.bg,
                border: 'none', borderRadius: 8, cursor: 'pointer',
              }}
            >
              OK
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 100, padding: 14, fontFamily: FONT,
    }}>
      <div style={{
        background: palette.surface, borderRadius: 14, maxWidth: 720, width: '100%',
        maxHeight: '90vh', display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{ padding: '16px 18px 12px', borderBottom: `1px solid ${palette.beige}` }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
            <div>
              <div style={{ fontSize: fz(11), fontWeight: 600, letterSpacing: 1, color: palette.inkMuted, textTransform: 'uppercase' }}>
                Importar planilhas
              </div>
              <div style={{ fontSize: fz(18), fontWeight: 600, color: palette.ink, marginTop: 4 }}>
                Site Amícia · Convertr
              </div>
              <div style={{ fontSize: fz(12), color: palette.inkSoft, marginTop: 4, lineHeight: 1.4 }}>
                Cole o CSV de <strong>clientes</strong> (obrigatório) e <strong>carrinhos</strong> (opcional).
                Dedup automático por <code>customer_id</code> e <code>uuid</code> — pode importar
                várias vezes sem duplicar.
              </div>
            </div>
            <button onClick={onClose} style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              padding: 4, color: palette.inkSoft,
            }}>
              <X size={sz(22)} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: 14, overflow: 'auto', flex: 1 }}>
          {/* Nome da planilha */}
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: fz(12), fontWeight: 600, color: palette.inkSoft, display: 'block', marginBottom: 4 }}>
              Nome/origem (rastreabilidade)
            </label>
            <input
              type="text"
              value={planilhaOrigem}
              onChange={e => setPlanilhaOrigem(e.target.value)}
              placeholder="ex: clientes_carrinhos_12-05-2026"
              style={{
                width: '100%', boxSizing: 'border-box',
                padding: '8px 10px', fontSize: fz(13), fontFamily: FONT,
                border: `1px solid ${palette.beige}`, borderRadius: 8,
                color: palette.ink, background: palette.bg,
              }}
            />
          </div>

          {/* Textarea CLIENTES */}
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: fz(12), fontWeight: 600, color: palette.inkSoft, display: 'block', marginBottom: 4 }}>
              Planilha de CLIENTES (obrigatório)
              <span style={{ fontWeight: 400, color: palette.inkMuted, marginLeft: 6 }}>
                — colunas: id, email, taxvat, phone, first_name, last_name…
              </span>
            </label>
            <textarea
              value={clientesCsv}
              onChange={e => setClientesCsv(e.target.value)}
              placeholder="Cole o CSV aqui (incluindo a linha de header)…"
              rows={6}
              style={{
                width: '100%', boxSizing: 'border-box',
                padding: 10, fontSize: fz(11), fontFamily: 'Menlo, Monaco, monospace',
                border: `1px solid ${palette.beige}`, borderRadius: 8,
                color: palette.ink, background: palette.bg,
                resize: 'vertical',
              }}
            />
            <div style={{ fontSize: fz(11), color: palette.inkMuted, marginTop: 2 }}>
              {clientesCsv ? `${clientesCsv.split('\n').length - 1} linhas (sem header)` : '—'}
            </div>
          </div>

          {/* Textarea CARRINHOS */}
          <div>
            <label style={{ fontSize: fz(12), fontWeight: 600, color: palette.inkSoft, display: 'block', marginBottom: 4 }}>
              Planilha de CARRINHOS (opcional)
              <span style={{ fontWeight: 400, color: palette.inkMuted, marginLeft: 6 }}>
                — colunas: id, uuid, customer_id, items_count, total, items…
              </span>
            </label>
            <textarea
              value={carrinhosCsv}
              onChange={e => setCarrinhosCsv(e.target.value)}
              placeholder="Cole o CSV aqui se tiver carrinhos pra atualizar…"
              rows={6}
              style={{
                width: '100%', boxSizing: 'border-box',
                padding: 10, fontSize: fz(11), fontFamily: 'Menlo, Monaco, monospace',
                border: `1px solid ${palette.beige}`, borderRadius: 8,
                color: palette.ink, background: palette.bg,
                resize: 'vertical',
              }}
            />
            <div style={{ fontSize: fz(11), color: palette.inkMuted, marginTop: 2 }}>
              {carrinhosCsv ? `${carrinhosCsv.split('\n').length - 1} linhas (sem header)` : '—'}
            </div>
          </div>

          {erro && (
            <div style={{
              background: palette.alertSoft, color: palette.alert,
              padding: 10, borderRadius: 8, fontSize: fz(13), marginTop: 10,
              display: 'flex', alignItems: 'flex-start', gap: 8,
            }}>
              <AlertCircle size={sz(16)} style={{ flexShrink: 0, marginTop: 2 }} />
              <div>{erro}</div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: 14, borderTop: `1px solid ${palette.beige}`,
          display: 'flex', gap: 8,
        }}>
          <button
            onClick={onClose}
            disabled={importando}
            style={{
              flex: 1, padding: 12, fontFamily: FONT, fontSize: fz(14), fontWeight: 600,
              background: palette.surface, color: palette.ink,
              border: `1px solid ${palette.beige}`, borderRadius: 8,
              cursor: importando ? 'not-allowed' : 'pointer',
            }}
          >
            Cancelar
          </button>
          <button
            onClick={importar}
            disabled={importando || !clientesCsv.trim()}
            style={{
              flex: 2, padding: 12, fontFamily: FONT, fontSize: fz(14), fontWeight: 600,
              background: importando || !clientesCsv.trim() ? palette.beige : palette.ink,
              color: palette.bg,
              border: 'none', borderRadius: 8,
              cursor: importando || !clientesCsv.trim() ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
          >
            {importando ? (
              <Loader2 size={sz(16)} style={{ animation: 'spin 0.8s linear infinite' }} />
            ) : (
              <Upload size={sz(16)} />
            )}
            {importando ? 'Importando…' : 'Importar planilhas'}
          </button>
        </div>
      </div>
    </div>
  );
};

// StatBox helper pro resumo da importação
const StatBox = ({ label, valor, cor }) => (
  <div style={{
    background: palette.beigeSoft, borderRadius: 8, padding: 10,
    textAlign: 'center',
  }}>
    <div style={{ fontSize: fz(22), fontWeight: 700, color: cor, lineHeight: 1 }}>
      {valor}
    </div>
    <div style={{ fontSize: fz(11), color: palette.inkSoft, marginTop: 4, letterSpacing: 0.2 }}>
      {label}
    </div>
  </div>
);


// ═══════════════════════════════════════════════════════════════════════════
// CarrinhoTab — componente raiz da tab
// ═══════════════════════════════════════════════════════════════════════════

const CarrinhoTab = ({ userId, isAdmin, vendedoraId, vendedoraNome, onAbrirLead }) => {
  const [modalImportar, setModalImportar] = useState(false);
  const [modalAtribuir, setModalAtribuir] = useState(null); // lead a atribuir, null = fechado
  const [reloadKey, setReloadKey] = useState(0);

  // Conversões do mês — vendedora vê só SITE. Admin vê todas (site+manual).
  // Ailson 13/05/2026 — Opção A do feedback.
  const [conversoesMes, setConversoesMes] = useState(null);
  useEffect(() => {
    if (!userId) return;
    let cancelado = false;
    (async () => {
      try {
        const r = await fetch('/api/lojas-leads-conversoes-listar?periodo=mes_atual', {
          headers: { 'X-User': userId },
        });
        const d = await r.json();
        if (!cancelado && r.ok && d.ok) setConversoesMes(d);
      } catch {}
    })();
    return () => { cancelado = true; };
  }, [userId, reloadKey]);

  // Quando importa ou atribui, força reload da listagem
  const triggerReload = () => setReloadKey(k => k + 1);

  // Decide o que fazer ao clicar num card
  const handleAbrirLead = (lead) => {
    // CPF aguardando atribuição: admin → modal de atribuir
    if (isAdmin && lead.tipo_pessoa === 'PF' && lead.status === 'aguardando_atribuicao') {
      setModalAtribuir(lead);
      return;
    }
    // Outros casos: callback do pai (Onda 3 = detalhe completo)
    if (onAbrirLead) onAbrirLead(lead);
  };

  // Renderiza card de conversões só se tem alguma. Vendedora vê só site
  // (canal_pedido='site'); admin vê todas. Backend já filtra.
  const totalConv = conversoesMes?.total || 0;
  const valorConv = conversoesMes?.valor_total || 0;

  return (
    <div style={{ background: palette.bg, minHeight: '100vh' }}>
      {/* Header da tab */}
      <div style={{
        padding: '14px 14px 0 14px', fontFamily: FONT,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
      }}>
        <div>
          <div style={{ fontSize: fz(11), fontWeight: 600, letterSpacing: 1, color: palette.inkMuted, textTransform: 'uppercase' }}>
            Site Amícia · Convertr
          </div>
          <div style={{ fontSize: fz(20), fontWeight: 600, color: palette.ink, marginTop: 2 }}>
            Carrinhos abandonados
          </div>
        </div>
        {isAdmin && (
          <button
            onClick={() => setModalImportar(true)}
            style={{
              background: palette.ink, color: palette.bg,
              border: 'none', borderRadius: 10, padding: '10px 14px',
              cursor: 'pointer', fontFamily: FONT, fontSize: fz(13), fontWeight: 600,
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            <Upload size={sz(15)} /> Importar
          </button>
        )}
      </div>

      {/* Card 🎉 Conversões do mês — Ailson 13/05/2026 (Opção A)
          Aparece SE total > 0 no período mes_atual.
          Vendedora: vê só conversões SITE dela (canal_pedido='site').
          Admin: vê todas (site + manual). */}
      {totalConv > 0 && (
        <div style={{
          margin: '14px 14px 0 14px',
          background: palette.okSoft,
          border: `1px solid ${palette.ok}40`,
          borderRadius: 12, padding: '12px 14px',
          fontFamily: FONT,
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <div style={{
            width: 40, height: 40, borderRadius: '50%',
            background: palette.ok, color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: fz(20), flexShrink: 0,
          }}>
            🎉
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: fz(11), fontWeight: 700, letterSpacing: 0.5, color: palette.ok, textTransform: 'uppercase' }}>
              Conversões do mês
            </div>
            <div style={{ fontSize: fz(15), fontWeight: 600, color: palette.ink, lineHeight: 1.3, marginTop: 2 }}>
              {isAdmin ? (
                <>
                  <strong style={{ color: palette.ok }}>{totalConv}</strong> pedidos · <strong style={{ color: palette.ok }}>{fmtMoeda(valorConv)}</strong>
                  {conversoesMes?.por_canal && (
                    <span style={{ fontSize: fz(12), color: palette.inkSoft, fontWeight: 400 }}>
                      {' · '}
                      {conversoesMes.por_canal.site || 0} site · {conversoesMes.por_canal.manual || 0} whats
                    </span>
                  )}
                </>
              ) : (
                <>
                  Você converteu <strong style={{ color: palette.ok }}>{totalConv}</strong> {totalConv === 1 ? 'pedido' : 'pedidos'} do site
                  {' · '}
                  <strong style={{ color: palette.ok }}>{fmtMoeda(valorConv)}</strong>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <LeadsListagem
        key={reloadKey}
        userId={userId}
        isAdmin={isAdmin}
        vendedoraId={vendedoraId}
        vendedoraNome={vendedoraNome}
        onAbrirLead={handleAbrirLead}
      />

      {/* Modais */}
      {modalImportar && (
        <ModalImportarPlanilhas
          userId={userId}
          onClose={() => setModalImportar(false)}
          onSucesso={triggerReload}
        />
      )}
      {modalAtribuir && (
        <ModalAtribuirCPF
          lead={modalAtribuir}
          userId={userId}
          onClose={() => setModalAtribuir(null)}
          onSucesso={triggerReload}
        />
      )}
    </div>
  );
};

export default CarrinhoTab;
export { LeadCard };
