/**
 * wms-nfe-auto.js — EMISSÃO AUTOMÁTICA DAS NFs (Ailson 12-13/08/2026)
 *
 * Roda às 7:00 (seg-sáb) só na LUMIA e na MUNIAM; a Exitus entra depois de
 * validado. Segue à risca o guia dele (bling_api_v3_cron_nfe_0700.txt):
 *
 *   GET /pedidos/vendas/{id}  → já tem notaFiscal.id? então NÃO gera
 *   POST /pedidos/vendas/{id}/gerar-nfe   (o BLING monta a nota)
 *   GET /nfe/{idNotaFiscal}   → confere a situação antes de transmitir
 *   POST /nfe/{id}/enviar?enviarEmail=false
 *   GET /nfe/{idNotaFiscal}   → registra o resultado real (nunca presumir)
 *
 * Regras de segurança:
 *  - falha fechada: detalhe do pedido ilegível (429/404) ABORTA aquele pedido
 *  - situação 5 (autorizada) ou 8 (aguardando protocolo) → não reenvia
 *  - erro de um pedido nunca interrompe os outros; tudo em wms_nfe_log
 *  - não emite pra Full, Flex e Meluni (não geram NF na operação dele)
 *
 * GET ?contas=lumia,muniam&limite=40[&dry=1][&sefaz=0]
 */
import { supabase, blingFetch, refreshBlingToken } from './_bling-helpers.js';

export const config = { maxDuration: 300 };

const CONTAS_PADRAO = ['lumia', 'muniam'];
const PAUSA = 500; // rate limit do Bling: 3 req/s — 380ms ainda batia no teto (3 quedas em 13/08)
const espera = (ms) => new Promise(r => setTimeout(r, ms));
const NOME_SIT = { 1: 'pendente', 4: 'rejeitada', 5: 'autorizada', 6: 'danfe emitida', 8: 'aguardando protocolo', 9: 'denegada', 11: 'bloqueada' };

async function log(linha) {
  try { await supabase.from('wms_nfe_log').insert(linha); } catch { /* auditoria não pode derrubar o fluxo */ }
}


// 24/08 (pedido dele): NF que falha por FALTA DE BAIRRO — a equipe corrigia na
// mao colocando "Centro" no cadastro e na nota. Automatizado: se o erro/rejeicao
// menciona bairro, completa o bairro VAZIO do contato com "Centro" (nunca
// sobrescreve bairro preenchido) e tenta gerar de novo. Tudo vai pro wms_nfe_log.
async function corrigirBairroContato(contatoId, headers, headersPost) {
  const r = await fetch(`https://api.bling.com.br/Api/v3/contatos/${contatoId}`, { headers });
  const j = await r.json().catch(() => ({}));
  const c = j?.data;
  if (!c?.id) return { ok: false, motivo: `contato ilegivel http ${r.status}` };
  const end = c.endereco || {};
  const geralVazio = !String(end?.geral?.bairro || '').trim();
  const cobrVazio = end?.cobranca && !String(end?.cobranca?.bairro || '').trim();
  if (!geralVazio && !cobrVazio) return { ok: false, motivo: 'bairro ja preenchido no cadastro' };
  const novo = { ...c, endereco: { ...end } };
  if (geralVazio) novo.endereco.geral = { ...(end.geral || {}), bairro: 'Centro' };
  if (cobrVazio) novo.endereco.cobranca = { ...(end.cobranca || {}), bairro: 'Centro' };
  const putR = await fetch(`https://api.bling.com.br/Api/v3/contatos/${contatoId}`, { method: 'PUT', headers: headersPost, body: JSON.stringify(novo) });
  if (putR.status >= 400) {
    const pe = await putR.json().catch(() => ({}));
    return { ok: false, motivo: `put contato http ${putR.status}: ${JSON.stringify(pe).slice(0, 160)}` };
  }
  return { ok: true, motivo: `bairro Centro no ${geralVazio ? 'geral' : ''}${geralVazio && cobrVazio ? '+' : ''}${cobrVazio ? 'cobranca' : ''}` };
}
const ehErroBairro = (txt) => /bairro/i.test(String(txt || ''));

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const contas = String(req.query?.contas || CONTAS_PADRAO.join(',')).split(',').map(c => c.trim()).filter(Boolean);
  const limite = Math.min(parseInt(req.query?.limite) || 40, 120);
  const dry = req.query?.dry === '1';
  const transmitir = req.query?.sefaz !== '0';
  const inicio = Date.now();
  const resumo = { contas, dry, gerados: 0, autorizados: 0, ja_tinham: 0, rejeitados: 0, erros: 0, pulados: 0, detalhe: [] };

  try {
    // 18/08 — as contas rodam EM PARALELO. O limite de 3 req/s do Bling é POR
    // CONTA, então nada se atropela, e a Exitus (que sozinha faz ~300 pedidos
    // por dia) deixa de consumir o tempo das outras duas. Antes era sequencial
    // e Lumia/Muniam ficavam sem nota nenhuma no dia.
    await Promise.all(contas.map(async (conta) => {
      // 18/08 — o limite era GLOBAL: a Exitus roda primeiro, tem o maior
      // volume e consumia a cota inteira; Lumia e Muniam ficavam sem emitir
      // nenhuma nota no dia. Agora cada conta tem a sua cota.
      let geradosNaConta = 0;
      let token = null;
      try { token = await refreshBlingToken(conta); } catch (e) { resumo.detalhe.push({ conta, erro: `token: ${e.message}` }); return; }
      const headers = { Authorization: 'Bearer ' + token, Accept: 'application/json' };
      const headersPost = { ...headers, 'Content-Type': 'application/json' };

      const { data: peds } = await supabase.from('wms_pedidos')
        .select('pedido_id, numero, canal_geral, ml_logistic_type, nf_id, status_wms')
        .eq('conta', conta)
        .in('status_wms', ['aberto', 'em_separacao'])
        .is('nf_id', null)
        .order('data_pedido', { ascending: true })
        .limit(limite * 2);

      for (const p of (peds || [])) {
        if (Date.now() - inicio > 250000) { resumo.detalhe.push({ conta, aviso: 'tempo esgotado — continua na próxima rodada' }); break; }
        if (geradosNaConta >= limite) break;

        // exclusões da operação: Full, Flex e Meluni não geram NF
        const flex = p.ml_logistic_type === 'self_service';
        const full = p.ml_logistic_type === 'fulfillment';
        const meluni = p.canal_geral === 'Meluni' || (conta === 'lumia' && p.canal_geral === 'Outros');
        if (flex || full || meluni) { resumo.pulados++; continue; }

        // 1. detalhe do pedido — falha fechada
        const detR = await blingFetch(`https://api.bling.com.br/Api/v3/pedidos/vendas/${p.pedido_id}`, headers);
        const det = typeof detR.json === 'function' ? await detR.json().catch(() => ({})) : {};
        await espera(PAUSA);
        if (!det?.data || !Object.keys(det.data).length) {
          resumo.erros++;
          await log({ conta, pedido_id: p.pedido_id, numero: p.numero, etapa: 'checagem', http: detR.status, resultado: 'erro', mensagem: 'detalhe do pedido ilegível — nada gerado' });
          continue;
        }
        const jaTem = det.data?.notaFiscal?.id;
        if (jaTem) {
          resumo.ja_tinham++;
          await supabase.from('wms_pedidos').update({ nf_id: jaTem, nf_checado_em: new Date().toISOString() }).eq('pedido_id', p.pedido_id);
          await log({ conta, pedido_id: p.pedido_id, numero: p.numero, nf_id: jaTem, etapa: 'checagem', resultado: 'ja_tem', mensagem: 'pedido já tinha NF' });
          continue;
        }
        if (dry) { resumo.detalhe.push({ conta, pedido: p.numero, acao: 'geraria' }); resumo.gerados++; continue; }

        // 2. gerar a NF a partir do pedido (o Bling monta)
        let gerR = await fetch(`https://api.bling.com.br/Api/v3/pedidos/vendas/${p.pedido_id}/gerar-nfe`, { method: 'POST', headers: headersPost, body: '{}' });
        let ger = await gerR.json().catch(() => ({}));
        // 429 = só velocidade, não é erro do pedido: espera e tenta de novo
        for (let tent = 0; tent < 2 && gerR.status === 429; tent++) {
          await espera(1800);
          gerR = await fetch(`https://api.bling.com.br/Api/v3/pedidos/vendas/${p.pedido_id}/gerar-nfe`, { method: 'POST', headers: headersPost, body: '{}' });
          ger = await gerR.json().catch(() => ({}));
        }
        await espera(PAUSA);
        let nfId = ger?.data?.idNotaFiscal || ger?.data?.id || null;
        if (!nfId) {
          // 24/08 (ele explicou): o motivo do erro NUNCA vem escrito — entao a
          // deteccao e por INSPECAO: falhou? olha o cadastro; bairro vazio =
          // completa com Centro e tenta de novo (nunca sobrescreve preenchido).
          const contatoId = det.data?.contato?.id;
          if (contatoId) {
            const fx = await corrigirBairroContato(contatoId, headers, headersPost);
            if (fx.ok || !/ja preenchido/.test(fx.motivo)) await log({ conta, pedido_id: p.pedido_id, numero: p.numero, etapa: 'bairro_fix', resultado: fx.ok ? 'ok' : 'erro', mensagem: fx.motivo });
            if (fx.ok) {
              await espera(PAUSA);
              gerR = await fetch(`https://api.bling.com.br/Api/v3/pedidos/vendas/${p.pedido_id}/gerar-nfe`, { method: 'POST', headers: headersPost, body: '{}' });
              ger = await gerR.json().catch(() => ({}));
              nfId = ger?.data?.idNotaFiscal || ger?.data?.id || null;
              await espera(PAUSA);
            }
          }
        }
        if (!nfId) {
          resumo.erros++;
          await log({ conta, pedido_id: p.pedido_id, numero: p.numero, etapa: 'gerar', http: gerR.status, resultado: 'erro', mensagem: JSON.stringify(ger).slice(0, 500) });
          continue;
        }
        resumo.gerados++;
        geradosNaConta++;
        await supabase.from('wms_pedidos').update({ nf_id: nfId, nf_checado_em: new Date().toISOString() }).eq('pedido_id', p.pedido_id);
        await log({ conta, pedido_id: p.pedido_id, numero: p.numero, nf_id: nfId, etapa: 'gerar', http: gerR.status, resultado: 'ok' });

        // 3. situação antes de transmitir
        const s1R = await blingFetch(`https://api.bling.com.br/Api/v3/nfe/${nfId}`, headers);
        const s1 = typeof s1R.json === 'function' ? await s1R.json().catch(() => ({})) : {};
        await espera(PAUSA);
        const sit1 = s1?.data?.situacao;
        if (!transmitir || sit1 === 5 || sit1 === 6 || sit1 === 8) {
          await log({ conta, pedido_id: p.pedido_id, numero: p.numero, nf_id: nfId, etapa: 'enviar', situacao: sit1, resultado: 'pulado', mensagem: `situação ${sit1} (${NOME_SIT[sit1] || '?'}) — não transmitido` });
          continue;
        }

        // 4. transmitir e conferir o resultado real
        const envR = await fetch(`https://api.bling.com.br/Api/v3/nfe/${nfId}/enviar?enviarEmail=false`, { method: 'POST', headers: headersPost, body: '{}' });
        const env = await envR.json().catch(() => ({}));
        await espera(900);
        const s2R = await blingFetch(`https://api.bling.com.br/Api/v3/nfe/${nfId}`, headers);
        const s2 = typeof s2R.json === 'function' ? await s2R.json().catch(() => ({})) : {};
        const sitF = s2?.data?.situacao;
        await supabase.from('wms_pedidos').update({ nf_situacao: sitF, nf_checado_em: new Date().toISOString() }).eq('pedido_id', p.pedido_id);
        if (sitF !== 5 && sitF !== 6 && sitF != null) {
          // 24/08: rejeitou/errou SEM motivo escrito (nunca vem) — inspeciona a
          // NOTA: bairro vazio no endereco dela? Completa Centro DENTRO da
          // propria nota (nada de excluir — furaria a numeracao), retransmite,
          // e corrige o cadastro junto pros proximos pedidos do cliente.
          const notaContato = s2?.data?.contato || {};
          const notaEnd = notaContato?.endereco || {};
          const bairroVazioNota = !String(notaEnd?.bairro || '').trim();
          if (bairroVazioNota && Object.keys(notaEnd).length) {
            const contatoId = det.data?.contato?.id;
            if (contatoId) {
              const fxc = await corrigirBairroContato(contatoId, headers, headersPost);
              await log({ conta, pedido_id: p.pedido_id, numero: p.numero, nf_id: nfId, etapa: 'bairro_fix', resultado: fxc.ok ? 'ok' : 'pulado', mensagem: `cadastro: ${fxc.motivo}` });
            }
            const notaEditada = { ...s2.data, contato: { ...notaContato, endereco: { ...notaEnd, bairro: 'Centro' } } };
            const putR = await fetch(`https://api.bling.com.br/Api/v3/nfe/${nfId}`, { method: 'PUT', headers: headersPost, body: JSON.stringify(notaEditada) });
            const putJ = await putR.json().catch(() => ({}));
            await log({ conta, pedido_id: p.pedido_id, numero: p.numero, nf_id: nfId, etapa: 'bairro_fix', resultado: putR.status < 400 ? 'ok' : 'erro', mensagem: putR.status < 400 ? 'bairro Centro gravado NA NOTA' : `put nota http ${putR.status}: ${JSON.stringify(putJ).slice(0, 160)}` });
            if (putR.status < 400) {
              await espera(PAUSA);
              await fetch(`https://api.bling.com.br/Api/v3/nfe/${nfId}/enviar?enviarEmail=false`, { method: 'POST', headers: headersPost, body: '{}' }).then(r => r.json().catch(() => ({}))).catch(() => ({}));
              await espera(900);
              const s3R = await blingFetch(`https://api.bling.com.br/Api/v3/nfe/${nfId}`, headers);
              const s3 = typeof s3R.json === 'function' ? await s3R.json().catch(() => ({})) : {};
              const sit3 = s3?.data?.situacao;
              await supabase.from('wms_pedidos').update({ nf_situacao: sit3, nf_checado_em: new Date().toISOString() }).eq('pedido_id', p.pedido_id);
              await log({ conta, pedido_id: p.pedido_id, numero: p.numero, nf_id: nfId, etapa: 'bairro_fix', situacao: sit3, resultado: (sit3 === 5 || sit3 === 6) ? 'ok' : 'erro', mensagem: `retransmitida pos-fix: ${NOME_SIT[sit3] || sit3}` });
              if (sit3 === 5 || sit3 === 6) { resumo.autorizados++; await espera(PAUSA); continue; }
            }
          }
        }
        if (sitF === 5 || sitF === 6) resumo.autorizados++;
        else if (sitF === 4 || sitF === 9) resumo.rejeitados++;
        await log({
          conta, pedido_id: p.pedido_id, numero: p.numero, nf_id: nfId, etapa: 'final',
          http: envR.status, situacao: sitF,
          resultado: (sitF === 5 || sitF === 6) ? 'ok' : (sitF === 4 || sitF === 9 ? 'erro' : 'pulado'),
          mensagem: `${NOME_SIT[sitF] || '?'}${envR.status >= 400 ? ' · ' + JSON.stringify(env).slice(0, 300) : ''}`,
        });
        await espera(PAUSA);
      }
    }));
    resumo.segundos = Math.round((Date.now() - inicio) / 1000);
    return res.status(200).json(resumo);
  } catch (e) {
    resumo.erro_geral = e.message;
    return res.status(500).json(resumo);
  }
}
