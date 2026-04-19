/**
 * bling-produtos-recon.js — Endpoint de RECONHECIMENTO (não escreve nada).
 *
 * Objetivo: validar que a Lumia, depois da reautorização com scope Produtos,
 * consegue ler o catálogo completo (com variações + SKU + descrição parseável
 * pra ref/cor/tam). Se sim, justifica construir o cron Opção B.
 *
 * Uso:
 *   GET /api/bling-produtos-recon                 → 5 produtos da listagem + 1 detalhe
 *   GET /api/bling-produtos-recon?ref=2934        → tenta achar produto cuja descrição
 *                                                    contenha "ref 02934" e mostra o detalhe
 *   GET /api/bling-produtos-recon?id=12345        → detalhe específico de produto Bling
 *   GET /api/bling-produtos-recon?conta=lumia     → escolhe outra conta (default lumia)
 *
 * NÃO grava nada no Supabase. NÃO modifica produtos. Só lê e retorna o JSON cru.
 */
import { refreshBlingToken, blingFetch, parseDescricao, supabase } from './_bling-helpers.js';

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const conta = (req.query?.conta || 'lumia').toLowerCase();
  const refBusca = req.query?.ref ? String(req.query.ref).replace(/\D/g, '') : null;
  const idEspecifico = req.query?.id || null;

  const out = {
    ok: false,
    fase: 'init',
    conta,
    timestamp: new Date().toISOString(),
  };

  try {
    // ── FASE 1: token ────────────────────────────────────────────────────
    out.fase = 'token';
    const token = await refreshBlingToken(conta);
    out.token_ok = true;
    out.token_preview = token.slice(0, 12) + '...';

    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    };

    // ── FASE 2: detalhe específico se id fornecido ──────────────────────
    if (idEspecifico) {
      out.fase = 'detalhe_por_id';
      const url = `https://api.bling.com.br/Api/v3/produtos/${idEspecifico}`;
      const r = await blingFetch(url, headers);
      out.detalhe_status = r.status;
      const body = await r.json();
      out.detalhe_raw = body;
      out.ok = r.ok;
      return res.status(200).json(out);
    }

    // ── FASE 3: listagem (5 produtos) ───────────────────────────────────
    out.fase = 'listagem';
    const listUrl = 'https://api.bling.com.br/Api/v3/produtos?pagina=1&limite=5';
    const listResp = await blingFetch(listUrl, headers);
    out.list_status = listResp.status;

    if (!listResp.ok) {
      const errBody = await listResp.text().catch(() => '');
      out.list_error = errBody.slice(0, 500);
      return res.status(200).json(out);
    }

    const listJson = await listResp.json();
    out.list_raw_root_keys = Object.keys(listJson || {});
    const produtos = listJson?.data || listJson?.produtos || [];
    out.list_qtd = produtos.length;

    // Mostra estrutura crua dos primeiros 2 itens
    out.list_amostra = produtos.slice(0, 2);

    // Mostra só os campos chave dos 5
    out.list_resumo = produtos.map(p => ({
      id: p.id,
      codigo: p.codigo,
      nome: p.nome,
      tipo: p.tipo,
      formato: p.formato,
      campos_top_level: Object.keys(p),
    }));

    // ── FASE 4: detalhe do primeiro produto pra ver variações ──────────
    if (produtos.length > 0) {
      out.fase = 'detalhe_primeiro';
      const primeiroId = produtos[0].id;
      const detUrl = `https://api.bling.com.br/Api/v3/produtos/${primeiroId}`;
      const detResp = await blingFetch(detUrl, headers);
      out.det_status = detResp.status;

      if (detResp.ok) {
        const detJson = await detResp.json();
        const dados = detJson?.data || detJson;
        out.det_root_keys = Object.keys(dados || {});
        out.det_raw_full = dados; // detalhe completo do primeiro

        // Tenta identificar variações (Bling usa "variacoes" no v3)
        const variacoes = dados?.variacoes || dados?.variations || [];
        out.det_variacoes_qtd = Array.isArray(variacoes) ? variacoes.length : 0;
        out.det_variacao_amostra = Array.isArray(variacoes) && variacoes.length > 0
          ? variacoes[0]
          : null;

        // Aplica parseDescricao em algumas descrições pra confirmar formato
        if (Array.isArray(variacoes) && variacoes.length > 0) {
          out.parse_test = variacoes.slice(0, 3).map(v => ({
            descricao_bruta: v.nome || v.descricao || '(sem nome)',
            codigo: v.codigo,
            parse: parseDescricao(v.nome || v.descricao || ''),
          }));
        }
      }
    }

    // ── FASE 5 (opcional): busca por ref específica ─────────────────────
    if (refBusca) {
      out.fase = 'busca_por_ref';
      // Bling v3 suporta filtro por nome/codigo. Tentamos pegar até 30 candidatos.
      const buscaUrl = `https://api.bling.com.br/Api/v3/produtos?pagina=1&limite=30&criterio=2`;
      const buscaResp = await blingFetch(buscaUrl, headers);
      if (buscaResp.ok) {
        const bj = await buscaResp.json();
        const cands = bj?.data || [];
        // Filtra por descrição contendo a ref
        const padrao = new RegExp(`\\bref\\.?\\s*0*${refBusca}\\b`, 'i');
        const achou = cands.find(p => padrao.test(p.nome || p.descricaoCurta || ''));
        out.busca_total_pagina = cands.length;
        if (achou) {
          out.busca_match = { id: achou.id, codigo: achou.codigo, nome: achou.nome };
          // Pega detalhe do match
          const detResp2 = await blingFetch(
            `https://api.bling.com.br/Api/v3/produtos/${achou.id}`,
            headers
          );
          if (detResp2.ok) {
            const dj = await detResp2.json();
            out.busca_detalhe = dj?.data || dj;
          }
        } else {
          out.busca_match = null;
          out.busca_aviso = `Ref ${refBusca} não encontrada na primeira página (30 itens). Pode estar em página posterior.`;
        }
      }
    }

    out.ok = true;
    return res.status(200).json(out);

  } catch (e) {
    out.error = e.message;
    out.stack = e.stack?.split('\n').slice(0, 5);
    return res.status(500).json(out);
  }
}
