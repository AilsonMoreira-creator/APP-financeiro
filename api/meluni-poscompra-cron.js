// ============================================================================
// /api/meluni-poscompra-cron — DISPARO AUTOMÁTICO pós-compra da Lara (WhatsApp).
// Manda a mensagem "ficou tudo certo?" (template aprovado, A/B curta x pessoal)
// pras clientes que compraram há 10–14 dias e ainda NÃO receberam.
//
// Elegível =
//   - ultima_compra entre 10 e 14 dias atrás
//   - NÃO bloqueada
//   - tem telefone/whatsapp válido + nome
//   - SEM devolução (não-cancelada) — casa por cliente_id / telefone / convertr_id
//   - NUNCA recebeu o template pós-compra (1 envio por cliente, dedupe permanente
//     via meluni_mensagens.template_usado nos nomes curta/pessoal)
//
// Janela de envio: seg a sábado, 10:00 BRT (cron `0 13 * * 1-6`). Domingo não roda.
// Liga/desliga global: meluni_config.lara_poscompra_auto = { ativo: bool }. Com
// OFF o cron não envia nada — é assim que o Ailson bloqueia no dia que vai fazer
// disparo de novidade/promoção pela mesma etapa.
//
// Segurança: só roda via cron (user-agent vercel-cron) OU ?force=1 OU ?dry=1.
//   ?dry=1  -> simula (não envia), mostra quem entraria, ignora o toggle/domingo.
//   ?force=1 -> envia ignorando toggle e dia (pra teste manual).
// Ailson 26/06/2026.
// ============================================================================
import { supabase, cfgMeluni } from './_meluni-whats-helpers.js';
import { enviarTemplateLara } from './_meluni-whats-meta.js';
import { refreshBlingToken, blingFetch } from './_bling-helpers.js';
import { chaveTel } from './_meluni-tel.js';
import { telefonesCongelados } from './_meluni-tags-core.js';

const API_BLING = 'https://api.bling.com.br/Api/v3';

const LOTE = 150;                 // teto de envios por execução
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const soDigitos = (s) => String(s || '').replace(/\D/g, '');
// canônico = sem o 55 da frente (igual inbound/disparo manual), pra casar conversa
function canonTel(s) { let d = soDigitos(s); if (d.length >= 12 && d.startsWith('55')) d = d.slice(2); return d; }
function primeiroNome(nome) {
  const t = String(nome || '').trim().split(/\s+/)[0] || '';
  return t ? t.charAt(0).toUpperCase() + t.slice(1).toLowerCase() : '';
}
function renderTpl(body, params) {
  let s = String(body || '');
  params.forEach((p, i) => { s = s.split('{{' + (i + 1) + '}}').join(String(p)); });
  return s;
}
// data ISO (YYYY-MM-DD) de N dias atrás, no fuso BRT (UTC-3)
function diaBRT(offsetDias) {
  const d = new Date(Date.now() - 3 * 3600e3 - offsetDias * 86400e3);
  return d.toISOString().slice(0, 10);
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

const ETAPAS_FECHADAS = ['conversao', 'ganho', 'perdido'];

export default async function handler(req, res) {
  const ua = String(req.headers['user-agent'] || '');
  const ehCron = ua.startsWith('vercel-cron');
  const force = req.query?.force === '1';
  const dry = req.query?.dry === '1';
  if (!ehCron && !force && !dry) {
    return res.status(403).json({ ok: false, erro: 'Cron only. Use ?dry=1 pra simular ou ?force=1.' });
  }

  try {
    // toggle global (default desligado). dry simula mesmo desligado; envio real exige ativo|force.
    const cfgAuto = (await cfgMeluni('lara_poscompra_auto', { ativo: false })) || {};
    const ativo = cfgAuto.ativo === true;
    if (!ativo && !force && !dry) {
      return res.status(200).json({ ok: true, pulado: 'toggle_desligado', enviados: 0 });
    }

    // domingo não roda (seg-sáb). 0=domingo no fuso BRT.
    const diaSemanaBRT = new Date(Date.now() - 3 * 3600e3).getUTCDay();
    if (diaSemanaBRT === 0 && !force && !dry) {
      return res.status(200).json({ ok: true, pulado: 'domingo', enviados: 0 });
    }

    // templates pós-compra (A/B) — mesmos do disparo manual
    const cfg = (await cfgMeluni('lara_templates_clientes', {})) || {};
    const tpls = cfg.templates || {};
    const curta = tpls.curta, pessoal = tpls.pessoal;
    if (!curta?.name || !pessoal?.name) return res.status(400).json({ ok: false, erro: 'templates_clientes nao configurados' });
    const pctCurta = Number(cfg.ab_pct_curta ?? 50);
    const lang = cfg.idioma || 'pt_BR';
    const nomesTpl = [curta.name, pessoal.name];

    // 1) candidatos: ultima_compra 10–14 dias atrás, não bloqueados
    const dMax = diaBRT(10);   // mais recente permitido (>= 10 dias)
    const dMin = diaBRT(14);   // mais antigo permitido (<= 14 dias)
    const { data: cands0 } = await supabase.from('meluni_clientes')
      .select('id, nome, telefone, whatsapp, convertr_id, bloqueado, ultima_compra')
      .gte('ultima_compra', dMin).lte('ultima_compra', dMax)
      .neq('bloqueado', true)
      .limit(1000);
    let cands = (cands0 || []).filter(c => {
      const tel = canonTel(c.whatsapp || c.telefone);
      return tel.length >= 10 && primeiroNome(c.nome);
    });

    // 2) exclui quem tem devolução NÃO-cancelada (por cliente_id / telefone / convertr_id)
    const { data: devs } = await supabase.from('meluni_devolucoes')
      .select('cliente_id, telefone, convertr_id, cancelada');
    const devCliId = new Set(), devTel = new Set(), devConv = new Set();
    (devs || []).forEach(d => {
      if (d.cancelada === true) return;
      if (d.cliente_id) devCliId.add(d.cliente_id);
      const t = canonTel(d.telefone); if (t.length >= 10) devTel.add(t);
      if (d.convertr_id) devConv.add(String(d.convertr_id));
    });
    cands = cands.filter(c => {
      const t = canonTel(c.whatsapp || c.telefone);
      if (devCliId.has(c.id)) return false;
      if (t && devTel.has(t)) return false;
      if (c.convertr_id && devConv.has(String(c.convertr_id))) return false;
      return true;
    });

    // 3) dedupe permanente: tira quem já recebeu o template pós-compra alguma vez.
    //    casa conversa por cliente_id OU telefone canônico; depois checa mensagens.
    if (cands.length) {
      const tels = [...new Set(cands.map(c => canonTel(c.whatsapp || c.telefone)).filter(Boolean))];
      const cliIds = cands.map(c => c.id);
      const { data: convs } = await supabase.from('meluni_conversas')
        .select('id, telefone, cliente_id')
        .or(`telefone.in.(${tels.join(',')}),cliente_id.in.(${cliIds.join(',')})`);
      const convIds = (convs || []).map(c => c.id);
      const jaTel = new Set(), jaCli = new Set();
      if (convIds.length) {
        // pode haver muitos conv_ids; busca em blocos de 200
        const blocos = [];
        for (let i = 0; i < convIds.length; i += 200) blocos.push(convIds.slice(i, i + 200));
        const convMap = new Map((convs || []).map(c => [c.id, c]));
        for (const bl of blocos) {
          const { data: msgs } = await supabase.from('meluni_mensagens')
            .select('conversa_id, template_usado')
            .in('conversa_id', bl).in('template_usado', nomesTpl);
          (msgs || []).forEach(m => {
            const cv = convMap.get(m.conversa_id);
            if (!cv) return;
            if (cv.telefone) jaTel.add(canonTel(cv.telefone));
            if (cv.cliente_id) jaCli.add(cv.cliente_id);
          });
        }
      }
      cands = cands.filter(c => {
        const t = canonTel(c.whatsapp || c.telefone);
        return !jaCli.has(c.id) && !(t && jaTel.has(t));
      });
    }

    const elegiveis = cands.slice(0, LOTE);

    // 3b) RE-CHECA no Bling a situação dos pedidos da janela de cada candidato.
    // O Convertr manda o pedido no checkout ANTES do pagamento e ele pode entrar
    // como Atendido; Pix não pago vira Cancelado (12) DEPOIS do sync — e o cache
    // é snapshot. Sem esse re-check, "cliente" de Pix nunca pago recebia o
    // pós-compra (caso Ingrid, 04/07/2026). Só envia se ≥1 pedido Atendido (9)
    // na janela. Poucos candidatos/dia -> barato (~3 req/s).
    let semCompraConfirmada = 0;
    if (elegiveis.length) {
      const token = await refreshBlingToken('lumia');
      const bHeaders = { Authorization: 'Bearer ' + token, Accept: 'application/json' };
      const confirmados = [];
      for (const c of elegiveis) {
        const { data: vendasJanela } = await supabase.from('meluni_vendas')
          .select('pedido_id').eq('cliente_id', c.id)
          .gte('data_pedido', dMin).lte('data_pedido', dMax).limit(5);
        let temAtendido = false;
        for (const v of (vendasJanela || [])) {
          try {
            await sleep(340);
            const rr = await blingFetch(`${API_BLING}/pedidos/vendas/${v.pedido_id}`, bHeaders);
            const jj = await rr.json().catch(() => null);
            const sid = jj?.data?.situacao?.id ?? null;
            await supabase.from('meluni_vendas').update({
              situacao_id: sid, situacao_verificada_em: new Date().toISOString(),
            }).eq('pedido_id', v.pedido_id);
            if (sid === 9) temAtendido = true;
          } catch { /* na dúvida não confirma por esse pedido */ }
        }
        if (temAtendido) confirmados.push(c);
        else semCompraConfirmada++;
      }
      elegiveis.length = 0;
      elegiveis.push(...confirmados);
    }

    if (dry) {
      return res.status(200).json({
        ok: true, dry: true, ativo, dia_semana_brt: diaSemanaBRT,
        janela: { de: dMin, ate: dMax }, total_candidatos: cands.length,
        sem_compra_confirmada: semCompraConfirmada,
        enviaria: elegiveis.length,
        amostra: elegiveis.slice(0, 20).map(c => ({ id: c.id, nome: c.nome, ultima_compra: c.ultima_compra, tel: canonTel(c.whatsapp || c.telefone) })),
      });
    }

    // 4) envia (A/B), cria/atualiza conversa, loga mensagem (autor lara_clientes -> dedupe futuro)
    let enviados = 0, pulados = 0, erros = 0;
    const congelados = await telefonesCongelados(supabase); // Atencao congela
    for (const c of elegiveis) {
      try {
        const tel = canonTel(c.whatsapp || c.telefone);
        if (congelados.has(chaveTel(c.whatsapp || c.telefone))) { pulados++; continue; }
        const nome = primeiroNome(c.nome);
        const conv = await acharOuCriarConversaCliente(tel, c.nome, c.id);
        if (conv && ETAPAS_FECHADAS.includes(conv.etapa)) { pulados++; continue; }

        const versao = (Math.random() * 100 < pctCurta) ? 'curta' : 'pessoal';
        const tpl = versao === 'curta' ? curta : pessoal;
        const r = await enviarTemplateLara('55' + tel, tpl.name, [nome], { language: lang });
        const metaMsgId = r?.messages?.[0]?.id || null;
        const nowIso = new Date().toISOString();

        if (conv?.id) {
          await supabase.from('meluni_mensagens').insert({
            conversa_id: conv.id, direcao: 'saida', autor: 'lara_clientes',
            tipo_midia: 'template', template_usado: tpl.name,
            texto: renderTpl(tpl.body, [nome]),
            meta_message_id: metaMsgId, enviada_em: nowIso,
          });
          await supabase.from('meluni_conversas').update({
            etapa: 'enviados', ultima_msg_direcao: 'saida', ultima_msg_em: nowIso, responder_em: null,
          }).eq('id', conv.id);
        }
        enviados++;
        await sleep(250);
      } catch (e) {
        erros++;
      }
    }

    return res.status(200).json({
      ok: true, ativo, janela: { de: dMin, ate: dMax },
      total_candidatos: cands.length, sem_compra_confirmada: semCompraConfirmada, enviados, pulados, erros, lote: LOTE,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: String(e?.message || e) });
  }
}
