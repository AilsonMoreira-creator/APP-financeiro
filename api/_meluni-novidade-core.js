// Núcleo do disparo de NOVIDADE da Lara (template foto+nome+botão), usado tanto
// pelo disparo manual (/api/meluni-clientes-novidade-disparo) quanto pelo cron
// agendado (/api/meluni-novidade-cron). Fonte única da lógica de envio.
// Ailson 23/06/2026.
import { supabase, cfgMeluni, telefonesComCampanhaRecente } from './_meluni-whats-helpers.js';
import { enviarTemplateLara } from './_meluni-whats-meta.js';
import { chaveTel } from './_meluni-tel.js';

export // conversao saiu daqui 04/08/2026: agora e so REGISTRO (meluni_conversoes)
// e a cliente segue livre pra novos ciclos de disparo
const ETAPAS_FECHADAS = ['ganho', 'perdido'];
export const MAX_POR_CHAMADA = 30;

const soDigitos = (s) => String(s || '').replace(/\D/g, '');
export function canonTel(s) { let d = soDigitos(s); if (d.length >= 12 && d.startsWith('55')) d = d.slice(2); return d; }
export function primeiroNome(nome) {
  const t = String(nome || '').trim().split(/\s+/)[0] || '';
  return t ? t.charAt(0).toUpperCase() + t.slice(1).toLowerCase() : '';
}
function renderTpl(body, params) {
  let s = String(body || '');
  params.forEach((p, i) => { s = s.split('{{' + (i + 1) + '}}').join(String(p)); });
  return s;
}
function diaISO(diasAtras) {
  const x = new Date(); x.setDate(x.getDate() - diasAtras);
  return x.toISOString().slice(0, 10);
}

async function acharOuCriarConversaCliente(tel, nome, clienteId) {
  const { data: ex } = await supabase.from('meluni_conversas').select('id, etapa, cliente_id')
    .eq('canal', 'whatsapp').eq('telefone', tel)
    .order('ultima_msg_em', { ascending: false }).limit(1).maybeSingle();
  if (ex?.id) {
    if (clienteId && !ex.cliente_id) await supabase.from('meluni_conversas').update({ cliente_id: clienteId }).eq('id', ex.id);
    return ex;
  }
  const { data: nova } = await supabase.from('meluni_conversas').insert({
    canal: 'whatsapp', telefone: tel, externo_id: tel, nome_cliente: nome || null,
    cliente_id: clienteId || null, origem: 'cliente', etapa: 'enviados',
    ultima_msg_direcao: 'saida', ultima_msg_em: new Date().toISOString(),
  }).select('id, etapa, cliente_id').single();
  return nova || null;
}

// Lê a spec do template de novidade do meluni_config.
export async function carregarTplNovidade(cfgKey, versao) {
  const spec = await cfgMeluni(cfgKey || 'lara_templates_novidade', null);
  const tpls = spec?.templates || {};
  // default: primeira versao ATIVA; arquivada nunca dispara (Ailson 03/08/2026)
  const v = versao || Object.keys(tpls).find(k => (tpls[k]?.status || 'ativo') === 'ativo');
  const tpl = v ? tpls[v] : null;
  if (!tpl?.name || !tpl?.body) return null;
  if ((tpl.status || 'ativo') === 'arquivado') return null;
  // 28/08 (pedido dele): quando o cadastro nao tem primeiro nome, em vez de
  // pular o cliente a campanha cai numa variante SEM variavel — configurada em
  // tpl.fallback (nome da outra versao dentro da mesma spec).
  const tplSemNome = tpl.fallback ? tpls[tpl.fallback] : null;
  return {
    tpl,
    tplSemNome: (tplSemNome?.name && tplSemNome?.body && (tplSemNome.status || 'ativo') !== 'arquivado') ? tplSemNome : null,
    lang: spec.idioma || tpl.language || 'pt_BR',
    headerImage: tpl.header?.format === 'IMAGE' ? (tpl.header?.sample_url || null) : null,
  };
}

// Seleciona clientes elegíveis: última compra há >= `dias` dias, com telefone e
// não bloqueados. A deduplicação (quem já recebeu o template) fica no loop de envio.
export async function selecionarElegiveis({ dias = 7, max = 500 } = {}) {
  const { data } = await supabase.from('meluni_clientes')
    .select('id, whatsapp, telefone, bloqueado, ultima_compra')
    .lte('ultima_compra', diaISO(dias))
    .order('ultima_compra', { ascending: false })
    .limit(max * 3);
  return (data || [])
    .filter(c => (c.whatsapp || c.telefone) && !c.bloqueado)
    .slice(0, max)
    .map(c => c.id);
}

// Dispara o template de novidade pros ids dados. Idempotente por nome de template
// (não manda a MESMA novidade 2x pro mesmo cliente).
export async function dispararNovidadeParaIds(ids, { cfg, versao, maxPorChamada = MAX_POR_CHAMADA, congelados = null, dry = false } = {}) {
  let alvo = Array.isArray(ids) ? ids.filter(Boolean) : [];
  if (!alvo.length) return { ok: false, erro: 'sem ids' };
  const cortado = alvo.length > maxPorChamada;
  if (cortado) alvo = alvo.slice(0, maxPorChamada);

  const conf = await carregarTplNovidade(cfg, versao);
  // anti-colisão 48h (Ailson 04/08): nenhuma cliente recebe 2 campanhas em <48h
  const campanhaRecente = await telefonesComCampanhaRecente(48).catch(() => new Set());
  if (!conf) return { ok: false, erro: `template ${cfg || 'lara_templates_novidade'}/${versao || '?'} nao configurado` };
  const { tpl, tplSemNome, lang, headerImage } = conf;

  const { data: clientes } = await supabase.from('meluni_clientes')
    .select('id, nome, telefone, whatsapp, bloqueado').in('id', alvo);
  const mapC = new Map((clientes || []).map(c => [c.id, c]));

  let enviados = 0, pulados = 0, erros = 0;
  const detalhe = [];

  for (const id of alvo) {
    const c = mapC.get(id);
    try {
      if (!c) { pulados++; detalhe.push({ id, status: 'nao_encontrado' }); continue; }
      if (c.bloqueado) { pulados++; detalhe.push({ id, status: 'bloqueado' }); continue; }
      const tel = canonTel(c.whatsapp || c.telefone);
      if (!tel || tel.length < 10) { pulados++; detalhe.push({ id, status: 'sem_telefone' }); continue; }
      if (congelados && congelados.has(chaveTel(c.whatsapp || c.telefone))) { pulados++; detalhe.push({ id, status: 'atencao' }); continue; }
      if (campanhaRecente.has(tel) || campanhaRecente.has('55' + tel)) { pulados++; detalhe.push({ id, status: 'campanha_48h' }); continue; }
      const nome = primeiroNome(c.nome);
      // 28/08: sem primeiro nome nao trava mais o disparo — cai na variante sem
      // variavel, se a spec tiver uma. Sem variante, continua pulando.
      let tplUso = tpl, params = [nome];
      if (!nome) {
        if (!tplSemNome) { pulados++; detalhe.push({ id, status: 'sem_nome' }); continue; }
        tplUso = tplSemNome; params = [];
      }

      const conv = await acharOuCriarConversaCliente(tel, c.nome, c.id);
      if (conv && ETAPAS_FECHADAS.includes(conv.etapa)) { pulados++; detalhe.push({ id, status: 'conversa_fechada' }); continue; }

      if (conv?.id) {
        const { data: jaMsg } = await supabase.from('meluni_mensagens')
          .select('id').eq('conversa_id', conv.id).eq('template_usado', tpl.name).limit(1).maybeSingle();
        if (jaMsg) { pulados++; detalhe.push({ id, status: 'ja_recebeu_novidade' }); continue; }
      }

      // dry: passa por TODAS as guardas e para antes da Meta (Ailson 07/08/2026,
      // pra dar pra testar o caminho sem mandar mensagem pra cliente de verdade)
      if (dry) { enviados++; detalhe.push({ id, status: 'enviaria', tel, nome: nome || '(sem nome)', template: tplUso.name }); continue; }
      const hdr = (tplUso.header?.format === 'IMAGE' ? (tplUso.header?.sample_url || null) : null) || headerImage;
      const r = await enviarTemplateLara('55' + tel, tplUso.name, params, { language: lang, headerImage: hdr });
      const metaMsgId = r?.messages?.[0]?.id || null;
      const nowIso = new Date().toISOString();

      if (conv?.id) {
        await supabase.from('meluni_mensagens').insert({
          conversa_id: conv.id, direcao: 'saida', autor: 'lara_clientes',
          tipo_midia: 'template', template_usado: tplUso.name,
          texto: renderTpl(tplUso.body, params), midia_url: hdr || null,
          botao: tplUso.botao?.url ? { text: tplUso.botao.text || 'Ver no site', url: tplUso.botao.url } : null,
          meta_message_id: metaMsgId, enviada_em: nowIso,
        });
        await supabase.from('meluni_conversas').update({
          etapa: 'enviados', ultima_msg_direcao: 'saida', ultima_msg_em: nowIso, responder_em: null,
        }).eq('id', conv.id);
      }
      enviados++; detalhe.push({ id, status: 'enviado', meta_message_id: metaMsgId });
    } catch (e) {
      erros++; detalhe.push({ id, status: 'erro', erro: String(e?.message || e) });
    }
  }

  return { ok: true, dry, enviados, pulados, erros, total: alvo.length, cortado, max: maxPorChamada, template: tpl.name, detalhe };
}
