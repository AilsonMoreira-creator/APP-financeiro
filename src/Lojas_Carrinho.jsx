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
  Filter, Search, ChevronRight, UserCheck,
} from 'lucide-react';

import {
  palette, FONT, fz, sz, TelefoneCopiavel,
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
// CarrinhoTab — componente raiz da tab
// ═══════════════════════════════════════════════════════════════════════════

const CarrinhoTab = ({ userId, isAdmin, onAbrirLead, onAbrirImportar }) => {
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
        {isAdmin && onAbrirImportar && (
          <button
            onClick={onAbrirImportar}
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

      <LeadsListagem userId={userId} isAdmin={isAdmin} onAbrirLead={onAbrirLead} />
    </div>
  );
};

export default CarrinhoTab;
