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
  ShoppingBag, Building2, User, MapPin, Phone, AlertCircle,
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
// ═══════════════════════════════════════════════════════════════════════════

const LeadCard = ({ lead, onClick }) => {
  const items = lead.ultimo_evento?.items_parsed || [];
  const valor = lead.valor_ultimo_carrinho || lead.ultimo_evento?.total || 0;
  const pecas = lead.qtd_pecas_ultimo_carrinho || lead.ultimo_evento?.items_count || 0;
  const isPJ = lead.tipo_pessoa === 'PJ';

  // Status visual
  let statusBadge = null;
  if (lead.status === 'mensagem_enviada') {
    statusBadge = { label: '✓ Mensagem enviada', cor: palette.ok, soft: palette.okSoft };
  } else if (lead.lock_ativo) {
    statusBadge = {
      label: lead.lock_e_minha
        ? '🔒 Você está atendendo'
        : `🔒 ${lead.vendedora_atendendo_nome || 'Outra vendedora'} atendendo`,
      cor: palette.warn,
      soft: palette.warnSoft,
    };
  }

  // Cliente já existe? Badge especial
  const jaCliente = lead.ja_e_cliente_lojas_id;

  return (
    <button
      onClick={onClick}
      style={{
        width: '100%', textAlign: 'left',
        background: palette.surface,
        border: `1px solid ${palette.beige}`,
        borderRadius: 12, padding: 14,
        cursor: onClick ? 'pointer' : 'default',
        fontFamily: FONT, marginBottom: 10,
        display: 'block',
      }}
    >
      {/* HEADER do card: tipo + nome + valor */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 8,
            background: isPJ ? palette.accentSoft : palette.purpleSoft,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            {isPJ ? (
              <Building2 size={sz(20)} color={palette.accent} />
            ) : (
              <User size={sz(20)} color={palette.purple} />
            )}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{
              fontSize: fz(15), fontWeight: 600, color: palette.ink, lineHeight: 1.2,
              overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {nomeLead(lead)}
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 2, flexWrap: 'wrap' }}>
              <span style={{
                fontSize: fz(11), fontWeight: 600, letterSpacing: 0.3,
                color: isPJ ? palette.accent : palette.purple,
                background: isPJ ? palette.accentSoft : palette.purpleSoft,
                padding: '2px 6px', borderRadius: 4,
              }}>
                {isPJ ? 'CNPJ' : 'CPF'}
              </span>
              {lead.uf_inferida && (
                <span style={{ fontSize: fz(12), color: palette.inkMuted, display: 'flex', alignItems: 'center', gap: 2 }}>
                  <MapPin size={sz(12)} /> {lead.uf_inferida}
                </span>
              )}
              {jaCliente && (
                <span style={{
                  fontSize: fz(11), fontWeight: 600, letterSpacing: 0.2,
                  color: palette.ok, background: palette.okSoft,
                  padding: '2px 6px', borderRadius: 4,
                }}>
                  ⭐ Já é cliente
                </span>
              )}
            </div>
          </div>
        </div>
        {/* Valor */}
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: fz(18), fontWeight: 700, color: palette.ink, lineHeight: 1 }}>
            {fmtMoeda(valor)}
          </div>
          <div style={{ fontSize: fz(11), color: palette.inkMuted, marginTop: 2 }}>
            {pecas} {pecas === 1 ? 'peça' : 'peças'}
          </div>
        </div>
      </div>

      {/* FOTOS das peças do carrinho */}
      {items.length > 0 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
          {items.slice(0, 4).map((item, i) => (
            <div key={i} style={{
              position: 'relative',
              width: 56, height: 56, borderRadius: 8,
              background: palette.beigeSoft, overflow: 'hidden',
              flexShrink: 0,
            }}>
              {item.foto_url && (
                <img
                  src={item.foto_url}
                  alt={item.ref_descricao || item.tipo_inferido || ''}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  loading="lazy"
                />
              )}
              {/* Badge REF sobreposto */}
              {item.ref && (
                <div style={{
                  position: 'absolute', bottom: 0, left: 0, right: 0,
                  background: 'rgba(0,0,0,0.7)', color: '#fff',
                  fontSize: fz(10), fontWeight: 700, letterSpacing: 0.3,
                  padding: '1px 3px', textAlign: 'center',
                }}>
                  {item.ref}
                </div>
              )}
            </div>
          ))}
          {items.length > 4 && (
            <div style={{
              width: 56, height: 56, borderRadius: 8,
              background: palette.beigeSoft,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: palette.inkSoft, fontSize: fz(14), fontWeight: 600,
              flexShrink: 0,
            }}>
              +{items.length - 4}
            </div>
          )}
        </div>
      )}

      {/* INFOS finais: telefone, hora, status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: fz(12), color: palette.inkSoft }}>
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
            padding: '2px 7px', borderRadius: 4,
            marginLeft: 'auto',
          }}>
            {statusBadge.label}
          </span>
        )}
      </div>
    </button>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// LeadsListagem — lista de cards (CNPJ pública / CPF meus)
// ═══════════════════════════════════════════════════════════════════════════

const LeadsListagem = ({ userId, isAdmin, onAbrirLead }) => {
  const [escopo, setEscopo] = useState('cnpj_publico');
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(null);
  const [data, setData] = useState({ leads: [], badge: {} });

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro(null);
    try {
      const r = await fetch(`/api/lojas-leads-listar?escopo=${escopo}`, {
        headers: { 'X-User': userId },
      });
      const json = await r.json();
      if (!r.ok || !json.ok) throw new Error(json.error || 'Erro ao carregar leads');
      setData({ leads: json.leads || [], badge: json.badge || {} });
    } catch (e) {
      setErro(e.message);
      setData({ leads: [], badge: {} });
    } finally {
      setLoading(false);
    }
  }, [escopo, userId]);

  useEffect(() => { carregar(); }, [carregar]);

  // ─── Toggle CNPJ / CPF ──────────────────────────────────────────
  const escoposVisiveis = useMemo(() => {
    const base = [
      { id: 'cnpj_publico', label: '🏢 CNPJs', desc: 'Fila pública pra todas' },
    ];
    base.push({ id: 'cpf_atribuidos', label: '👤 CPFs', desc: isAdmin ? 'Atribuídos' : 'Atribuídos pra você' });
    if (isAdmin) {
      base.push({ id: 'cpf_aguardando', label: '📋 Aguardando', desc: 'CPFs pra atribuir' });
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
              }}
            >
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

      {/* Badge — Resumo CNPJs pendentes (sempre visível, mas mais relevante na fila pública) */}
      {escopo === 'cnpj_publico' && data.badge.qtd_pj_com_carrinho_sem_msg > 0 && (
        <div style={{
          background: palette.accentSoft, border: `1px solid ${palette.accent}30`,
          borderRadius: 10, padding: 12, marginBottom: 14,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <Sparkles size={sz(20)} color={palette.accent} />
          <div style={{ fontSize: fz(13), color: palette.ink, lineHeight: 1.4 }}>
            <strong>{data.badge.qtd_pj_com_carrinho_sem_msg}</strong> CNPJ{data.badge.qtd_pj_com_carrinho_sem_msg > 1 ? 's' : ''} esperando atendimento
            {' · '}
            Soma pendente: <strong>{fmtMoeda(data.badge.soma_valor_pendente)}</strong>
            {data.badge.qtd_pj_alto_valor > 0 && (
              <>
                {' · '}
                <span style={{ color: palette.alert, fontWeight: 600 }}>
                  {data.badge.qtd_pj_alto_valor} alto valor (≥R$500)
                </span>
              </>
            )}
          </div>
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
          <ShoppingBag size={sz(40)} style={{ opacity: 0.3, marginBottom: 10 }} />
          <div style={{ fontSize: fz(14), fontFamily: FONT }}>
            {escopo === 'cnpj_publico' && 'Nenhum CNPJ aguardando atendimento'}
            {escopo === 'cpf_atribuidos' && (isAdmin ? 'Nenhum CPF atribuído' : 'Nenhum CPF atribuído a você')}
            {escopo === 'cpf_aguardando' && 'Nenhum CPF aguardando atribuição'}
          </div>
        </div>
      )}

      {!loading && !erro && data.leads.length > 0 && (
        <div>
          {data.leads.map(lead => (
            <LeadCard key={lead.id} lead={lead} onClick={() => onAbrirLead && onAbrirLead(lead)} />
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

const CarrinhoTab = ({ userId, isAdmin, onAbrirLead }) => {
  const [modalImportar, setModalImportar] = useState(false);
  const [modalAtribuir, setModalAtribuir] = useState(null); // lead a atribuir, null = fechado
  const [reloadKey, setReloadKey] = useState(0);

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

      <LeadsListagem
        key={reloadKey}
        userId={userId}
        isAdmin={isAdmin}
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
