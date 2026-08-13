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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const contas = String(req.query?.contas || CONTAS_PADRAO.join(',')).split(',').map(c => c.trim()).filter(Boolean);
  const limite = Math.min(parseInt(req.query?.limite) || 40, 120);
  const dry = req.query?.dry === '1';
  const transmitir = req.query?.sefaz !== '0';
  const inicio = Date.now();
  const resumo = { contas, dry, gerados: 0, autorizados: 0, ja_tinham: 0, rejeitados: 0, erros: 0, pulados: 0, detalhe: [] };

  try {
    for (const conta of contas) {
      let token = null;
      try { token = await refreshBlingToken(conta); } catch (e) { resumo.detalhe.push({ conta, erro: `token: ${e.message}` }); continue; }
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
        if (resumo.gerados >= limite) break;

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
          await espera(2500);
          gerR = await fetch(`https://api.bling.com.br/Api/v3/pedidos/vendas/${p.pedido_id}/gerar-nfe`, { method: 'POST', headers: headersPost, body: '{}' });
          ger = await gerR.json().catch(() => ({}));
        }
        await espera(PAUSA);
        const nfId = ger?.data?.idNotaFiscal || ger?.data?.id || null;
        if (!nfId) {
          resumo.erros++;
          await log({ conta, pedido_id: p.pedido_id, numero: p.numero, etapa: 'gerar', http: gerR.status, resultado: 'erro', mensagem: JSON.stringify(ger).slice(0, 500) });
          continue;
        }
        resumo.gerados++;
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
        await espera(1200);
        const s2R = await blingFetch(`https://api.bling.com.br/Api/v3/nfe/${nfId}`, headers);
        const s2 = typeof s2R.json === 'function' ? await s2R.json().catch(() => ({})) : {};
        const sitF = s2?.data?.situacao;
        await supabase.from('wms_pedidos').update({ nf_situacao: sitF, nf_checado_em: new Date().toISOString() }).eq('pedido_id', p.pedido_id);
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
    }
    resumo.segundos = Math.round((Date.now() - inicio) / 1000);
    return res.status(200).json(resumo);
  } catch (e) {
    resumo.erro_geral = e.message;
    return res.status(500).json(resumo);
  }
}
