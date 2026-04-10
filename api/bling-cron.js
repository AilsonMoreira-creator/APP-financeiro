/**
 * bling-cron.js — Cron job (Vercel Pro: cada 10 min)
 * Busca pedidos novos do Bling e cacheia detalhes no Supabase
 * Tabela: bling_vendas_detalhe
 * 
 * Estratégia:
 * 1. Para cada conta (exitus, lumia, muniam), lista pedidos de hoje e ontem
 * 2. Filtra pedidos já cacheados no Supabase
 * 3. Busca detalhes dos novos (com delay + backoff em 429)
 * 4. Insere no Supabase
 * 
 * maxDuration: 300s (Vercel Pro)
 */
import { supabase, parseDescricao, parseCanal, blingFetch, refreshBlingToken } from './_bling-helpers.js';

const CONTAS = ['exitus', 'lumia', 'muniam'];
const DELAY_MS = 500; // 500ms entre requests = 2 req/s (bem abaixo do limite de 3/s)

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  // Cron chama GET; permite POST para teste manual
  if (req.method === 'OPTIONS') return res.status(200).end();

  const inicio = Date.now();
  const hoje = new Date().toISOString().slice(0, 10);
  const ontem = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const datas = [hoje, ontem]; // Sempre sincroniza hoje + ontem (backfill)

  const resumo = { processados: 0, novos: 0, erros: 0, porConta: {} };

  try {
    // Busca mapa de lojas uma vez por conta (pra identificar canais)
    for (const conta of CONTAS) {
      const contaResumo = { pedidosTotal: 0, novosInseridos: 0, erros: 0, detalhe: "" };
      resumo.porConta[conta] = contaResumo;

      // Obtém token válido
      let token;
      try {
        token = await refreshBlingToken(conta);
      } catch (e) {
        contaResumo.detalhe = "refreshToken erro: " + e.message;
        contaResumo.erros++;
        continue;
      }
      if (!token) {
        contaResumo.detalhe = "sem token válido (ver logs Vercel)";
        contaResumo.erros++;
        continue;
      }

      const headers = { "Authorization": "Bearer " + token, "Accept": "application/json" };

      // Busca mapa de lojas (pra saber nomes dos canais)
      let lojaMap = {};
      try {
        const lojasResp = await blingFetch("https://api.bling.com.br/Api/v3/lojas?limite=100", headers);
        if (lojasResp.ok) {
          const lojasData = await lojasResp.json();
          for (const loja of (lojasData.data || [])) {
            lojaMap[loja.id] = loja.descricao || loja.nome || "";
          }
        } else {
          console.log(`[bling-cron] ⚠ ${conta}: lojas retornou ${lojasResp.status}, continuando sem mapa de lojas`);
        }
      } catch (e) {
        console.log(`[bling-cron] ⚠ ${conta}: erro buscando lojas: ${e.message}`);
      }

      // Para cada data (hoje + ontem)
      for (const data of datas) {
        // 1. Lista pedidos do dia
        let pedidosLista = [];
        let pagina = 1;
        while (true) {
          const url = `https://api.bling.com.br/Api/v3/pedidos/vendas?situacaoId=9&dataInicial=${data}&dataFinal=${data}&pagina=${pagina}&limite=100`;
          const resp = await blingFetch(url, headers);
          if (!resp.ok) {
            console.log(`[bling-cron] ${conta}/${data}: lista pedidos HTTP ${resp.status}`);
            contaResumo.erros++;
            break;
          }
          const d = await resp.json();
          if (!d.data || d.data.length === 0) break;

          for (const p of d.data) {
            // Filtra pela data exata (API pode retornar pedidos adjacentes)
            if (p.data && !p.data.startsWith(data)) continue;
            const lojaObj = p.loja || {};
            let lojaNome = lojaObj.descricao || lojaObj.nome || "";
            if (!lojaNome && lojaObj.id && lojaMap[lojaObj.id]) lojaNome = lojaMap[lojaObj.id];
            pedidosLista.push({ id: p.id, lojaNome });
          }

          if (d.data.length < 100) break;
          pagina++;
          await new Promise(r => setTimeout(r, DELAY_MS));
        }

        if (pedidosLista.length === 0) continue;
        contaResumo.pedidosTotal += pedidosLista.length;

        // 2. Filtra pedidos já cacheados
        const ids = pedidosLista.map(p => p.id);
        const { data: existentes } = await supabase
          .from('bling_vendas_detalhe')
          .select('pedido_id')
          .eq('conta', conta)
          .in('pedido_id', ids);

        const existentesSet = new Set((existentes || []).map(e => e.pedido_id));
        const novos = pedidosLista.filter(p => !existentesSet.has(p.id));

        if (novos.length === 0) {
          console.log(`[bling-cron] ${conta}/${data}: ${pedidosLista.length} pedidos, todos já cacheados ✓`);
          continue;
        }

        console.log(`[bling-cron] ${conta}/${data}: ${novos.length} novos de ${pedidosLista.length} total`);

        // 3. Busca detalhes dos novos
        for (const pedido of novos) {
          // Verifica tempo restante (para em 280s pra ter margem)
          if (Date.now() - inicio > 280000) {
            console.log(`[bling-cron] ⚠ timeout safety, parando (${conta}/${data})`);
            break;
          }

          await new Promise(r => setTimeout(r, DELAY_MS));

          try {
            const dr = await blingFetch(
              `https://api.bling.com.br/Api/v3/pedidos/vendas/${pedido.id}`,
              headers,
              { maxRetries: 2, baseDelay: 2000 }
            );

            if (!dr.ok) {
              console.log(`[bling-cron] ${conta}: pedido ${pedido.id} HTTP ${dr.status}`);
              contaResumo.erros++;
              continue;
            }

            const det = await dr.json();
            const ped = det.data || det;

            // Parse canal
            const canal = parseCanal(pedido.lojaNome);

            // Parse itens
            const itensParsed = [];
            for (const item of (ped.itens || [])) {
              const p = parseDescricao(item.descricao);
              itensParsed.push({
                codigo: item.codigo || "",
                descricao: item.descricao || "",
                quantidade: parseInt(item.quantidade) || 1,
                valor: parseFloat(item.valor) || 0,
                ref: p.ref,
                tamanho: p.tamanho,
                cor: p.cor,
                descLimpa: p.descLimpa
              });
            }

            // Insert no Supabase
            const { error } = await supabase.from('bling_vendas_detalhe').upsert({
              conta,
              pedido_id: pedido.id,
              data_pedido: data,
              canal_geral: canal.geral,
              canal_detalhe: canal.detalhe,
              total_produtos: parseFloat(ped.totalProdutos || 0),
              total_pedido: parseFloat(ped.total || 0),
              itens: itensParsed,
              loja_nome: pedido.lojaNome
            }, { onConflict: 'conta,pedido_id' });

            if (error) {
              console.error(`[bling-cron] insert error ${pedido.id}:`, error.message);
              contaResumo.erros++;
            } else {
              contaResumo.novosInseridos++;
              resumo.novos++;
            }
          } catch (e) {
            console.error(`[bling-cron] ${conta}: erro pedido ${pedido.id}:`, e.message);
            contaResumo.erros++;
          }
        }
      }

      resumo.processados += contaResumo.pedidosTotal;
    }

    const duracao = ((Date.now() - inicio) / 1000).toFixed(1);
    console.log(`[bling-cron] ✓ concluído em ${duracao}s — ${resumo.novos} novos, ${resumo.erros} erros`);

    return res.status(200).json({
      ok: true,
      duracao: duracao + "s",
      ...resumo
    });

  } catch (e) {
    console.error("[bling-cron] erro fatal:", e);
    return res.status(500).json({ ok: false, erro: e.message });
  }
}
