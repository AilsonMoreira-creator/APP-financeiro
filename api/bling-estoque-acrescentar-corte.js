/**
 * bling-estoque-acrescentar-corte.js — Acrescenta um corte ao estoque Bling.
 *
 * Difere do bling-estoque-set (que SETA saldo absoluto célula a célula):
 * aqui recebe a MATRIZ EDITADA de um corte e, por célula, faz
 *   nova = saldo_atual_no_bling + valor_da_matriz   (SOMA)
 * gravando o balanço no Bling, espelhando em bling_estoque e logando
 * (origem 'acrescentar_corte'). No fim grava um registro em
 * bling_cortes_inseridos pra: (1) sumir o corte da projeção, (2) selo
 * "adicionado", (3) guardar a matriz editada ("alterado").
 *
 * NÃO toca o payload ailson_cortes (a matriz original da oficina fica
 * intacta — Ailson 27/06/2026).
 *
 * POST body: {
 *   conta?='exitus', ref, corte_id, corte_n?, usuario?, deposito?,
 *   matriz: [ { cor_nome, cells: { "P": 10, "M": 10, ... } } ]
 * }
 *   - cells = quantidade a ACRESCENTAR por tamanho (já vem editada do front)
 *   - cor sem cadastro no Bling (nenhuma linha em bling_estoque) → ignorada
 *     com aviso, não entra no estoque.
 *   - corte já adicionado antes → 409 (trava reinserção / não dobra estoque).
 */
import { refreshBlingToken, blingFetch, supabase } from './_bling-helpers.js';
import { zerarFilhosSku } from './_bling-filhos-helpers.js';

export const config = { maxDuration: 300 };
const API = 'https://api.bling.com.br/Api/v3';

const normCor = (s) =>
  String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'use POST' });
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }

  const conta = (body.conta || 'exitus').toLowerCase();
  const ref = String(body.ref || '').replace(/\D/g, '').replace(/^0+/, '');
  const corte_id = String(body.corte_id || '');
  const corte_n = body.corte_n != null ? String(body.corte_n) : '';
  const usuario = body.usuario ? String(body.usuario) : null;
  const matriz = Array.isArray(body.matriz) ? body.matriz : [];

  if (!ref || !corte_id || !matriz.length)
    return res.status(400).json({ error: 'ref, corte_id e matriz obrigatórios' });

  try {
    // ── 20/08 (caso Cris/corte 9876): SELO NO COMEÇO + RETOMADA POR CÉLULA.
    // Antes o registro só era gravado no FIM — a função morria no timeout,
    // o front ficava sem resposta e cada novo clique re-somava as mesmas
    // células (corte entrou 3x). Agora: selo 'processando' nasce antes do
    // loop (2º clique simultâneo leva 409), cada célula já aplicada em
    // tentativa anterior é PULADA (idempotência pelo log), e o selo só vira
    // 'ok' quando a matriz inteira terminar.
    const { data: jaTem } = await supabase.from('bling_cortes_inseridos')
      .select('id,inserido_em,status,atualizado_em').eq('ref_norm', ref).eq('corte_id', corte_id).maybeSingle();
    if (jaTem && jaTem.status !== 'processando')
      return res.status(409).json({ error: 'corte já adicionado ao estoque', inserido_em: jaTem.inserido_em });
    if (jaTem && jaTem.status === 'processando') {
      const idadeMs = Date.now() - new Date(jaTem.atualizado_em || jaTem.inserido_em).getTime();
      if (idadeMs < 45000)
        return res.status(409).json({ error: 'esse corte está sendo processado agora — aguarde uns segundos', em_andamento: true });
      // processamento morto (timeout anterior): segue como RETOMADA
    }
    const seloBase = { ref_norm: ref, corte_id, corte_n: corte_n || null, inserido_por: usuario, status: 'processando', atualizado_em: new Date().toISOString() };
    if (jaTem) await supabase.from('bling_cortes_inseridos').update(seloBase).eq('id', jaTem.id);
    else await supabase.from('bling_cortes_inseridos').insert({ ...seloBase, matriz_editada: matriz });

    // células já aplicadas em tentativa anterior deste MESMO corte → pular
    const motivoCorte = `corte ${corte_n || corte_id}`;
    const jaAplicadas = new Set();
    {
      const { data: logsAnt } = await supabase.from('bling_estoque_logs')
        .select('cor_norm,tam').eq('ref', ref).eq('origem', 'acrescentar_corte').eq('motivo', motivoCorte);
      (logsAnt || []).forEach(l => jaAplicadas.add(`${l.cor_norm}|${l.tam}`));
    }

    const token = await refreshBlingToken(conta);
    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' };

    // ── depósito geral (uma vez) ──
    let depositoId = body.deposito ? String(body.deposito) : null;
    if (!depositoId) {
      const { data: cfg } = await supabase.from('amicia_data').select('payload').eq('user_id', 'bling-estoque-config').maybeSingle();
      depositoId = cfg?.payload?.deposito_geral || null;
    }
    if (!depositoId) {
      const rd = await blingFetch(`${API}/depositos?pagina=1&limite=100`, headers);
      const jd = await rd.json().catch(() => ({}));
      const deps = jd.data || [];
      const pick = deps.find(d => d.padrao === true) || deps.find(d => /geral/i.test(d.descricao || '')) || deps[0];
      depositoId = pick ? String(pick.id) : null;
    }
    if (!depositoId) return res.status(502).json({ error: 'depósito geral não encontrado' });

    // cache de depósitos dos FILHOS (pro zerarFilhosSku). Ailson 08/07/2026.
    const { data: cfgFilhosRow } = await supabase.from('amicia_data').select('payload').eq('user_id', 'bling-estoque-config').maybeSingle();
    const cfgFilhos = cfgFilhosRow?.payload || {};
    let cfgFilhosMudou = false;

    const resultado = [];
    const cores_ignoradas = [];

    for (const cor of matriz) {
      const cor_nome = String(cor?.cor_nome || '').trim();
      const cor_norm = normCor(cor_nome);
      const cells = cor?.cells || {};
      if (!cor_norm) continue;

      // cor cadastrada no Bling? (qualquer tamanho dessa cor nesse ref)
      const { data: linhas } = await supabase.from('bling_estoque')
        .select('tam,qtd,qtd_lumia,qtd_muniam,bling_produto_id,bling_sku').eq('ref', ref).eq('cor_norm', cor_norm);
      if (!linhas || !linhas.length) { cores_ignoradas.push(cor_nome || cor_norm); continue; }
      const porTam = {};
      linhas.forEach(l => { porTam[String(l.tam || '').toUpperCase().trim()] = l; });

      for (const [tamRaw, addRaw] of Object.entries(cells)) {
        const tam = String(tamRaw || '').toUpperCase().trim();
        const add = Math.round(Number(addRaw) || 0);
        if (!tam || add <= 0) continue;

        const row = porTam[tam];
        if (!row) { resultado.push({ cor_nome, cor_norm, tam, add, ok: false, motivo: 'tamanho sem cadastro no Bling' }); continue; }

        if (jaAplicadas.has(`${cor_norm}|${tam}`)) {
          resultado.push({ cor_nome, cor_norm, tam, add, ok: true, pulada: true, motivo: 'já aplicada em tentativa anterior' });
          continue;
        }
        // selo respira a cada célula — o 409 de "em andamento" mede por aqui
        supabase.from('bling_cortes_inseridos').update({ atualizado_em: new Date().toISOString() })
          .eq('ref_norm', ref).eq('corte_id', corte_id).then?.(() => {}, () => {});
        let produtoId = row.bling_produto_id || null;
        if (!produtoId && row.bling_sku) {
          const rp = await blingFetch(`${API}/produtos?codigo=${encodeURIComponent(row.bling_sku)}`, headers);
          const jp = await rp.json().catch(() => ({}));
          produtoId = jp.data?.[0]?.id || null;
        }
        if (!produtoId) { resultado.push({ cor_nome, cor_norm, tam, add, ok: false, motivo: 'produto não encontrado no Bling' }); continue; }

        // Consolidação (Ailson 08/07/2026): o site da Meluni lê o Geral da
        // EXITUS, então o corte grava o VENDÁVEL: zera Lumia/Muniam (se
        // sujos) e nova = (exitus + lumia + muniam) + corte.
        const fLumia = Number(row.qtd_lumia) || 0;
        const fMuniam = Number(row.qtd_muniam) || 0;
        let filhosZerados = false;
        if ((fLumia !== 0 || fMuniam !== 0) && row.bling_sku) {
          const z = await zerarFilhosSku(row.bling_sku, cfgFilhos);
          if (z.cfgMudou) cfgFilhosMudou = true;
          filhosZerados = z.resultados.every(x => x.ok);
          if (!filhosZerados) {
            resultado.push({ cor_nome, cor_norm, tam, add, ok: false, motivo: 'falha ao zerar Lumia/Muniam: ' + z.resultados.filter(x => !x.ok).map(x => `${x.conta} ${x.erro}`).join('; ') });
            continue;
          }
        }
        const anterior = Number(row.qtd) || 0;
        const nova = anterior + fLumia + fMuniam + add;

        const r = await fetch(`${API}/estoques`, {
          method: 'POST', headers,
          body: JSON.stringify({ produto: { id: Number(produtoId) }, deposito: { id: Number(depositoId) }, operacao: 'B', quantidade: nova }),
        });
        if (!r.ok) {
          const txt = await r.text().catch(() => '');
          resultado.push({ cor_nome, cor_norm, tam, add, anterior, ok: false, motivo: `Bling HTTP ${r.status}`, detalhe: txt.slice(0, 160) });
          continue;
        }

        // espelha local + log
        await supabase.from('bling_estoque').upsert({
          ref, cor_norm, tam, cor_label: cor_nome || null, qtd: nova,
          ...(filhosZerados ? { qtd_lumia: 0, qtd_muniam: 0 } : {}),
          bling_produto_id: produtoId, atualizado_em: new Date().toISOString(), atualizado_por: usuario,
        }, { onConflict: 'ref,cor_norm,tam' });
        await supabase.from('bling_estoque_logs').insert({
          ref, cor_norm, tam, cor_label: cor_nome || null,
          // vendavel antes = exitus + filhos (capturados antes do zeramento);
          // assim "de + delta = ficou" fecha no log. Ailson 22/07/2026.
          qtd_anterior: anterior + fLumia + fMuniam, qtd_nova: nova, delta: add,
          motivo: `corte ${corte_n || corte_id}`, usuario, origem: 'acrescentar_corte',
        });
        resultado.push({ cor_nome, cor_norm, tam, add, anterior, nova, ok: true });
      }
    }

    const okCount = resultado.filter(r => r.ok).length;

    if (cfgFilhosMudou) {
      await supabase.from('amicia_data').upsert(
        { user_id: 'bling-estoque-config', payload: cfgFilhos, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      );
    }

    // nada acrescentado → apaga o selo (deixa corrigir cadastro e tentar de novo)
    if (okCount === 0) {
      await supabase.from('bling_cortes_inseridos').delete().eq('ref_norm', ref).eq('corte_id', corte_id).eq('status', 'processando');
      return res.status(200).json({ ok: false, gravado: false, okCount: 0, resultado, cores_ignoradas, msg: 'nenhuma variação acrescentada' });
    }

    // matriz completa → selo vira 'ok' (some da projeção, vira "adicionado")
    const { error: eIns } = await supabase.from('bling_cortes_inseridos').update({
      status: 'ok', matriz_editada: matriz, cores_ignoradas, resultado, atualizado_em: new Date().toISOString(),
    }).eq('ref_norm', ref).eq('corte_id', corte_id);
    if (eIns) return res.status(500).json({ error: 'gravou no Bling mas falhou o registro: ' + eIns.message, resultado, cores_ignoradas });

    const puladas = resultado.filter(r2 => r2.pulada).length;
    return res.status(200).json({ ok: true, gravado: true, okCount, puladas, retomada: puladas > 0, resultado, cores_ignoradas });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
}
