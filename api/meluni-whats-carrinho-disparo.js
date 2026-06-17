// ============================================================================
// /api/meluni-whats-carrinho-disparo — dispara template de carrinho abandonado.
// ----------------------------------------------------------------------------
// Lê meluni_carrinhos parados (status processando, com telefone + itens, dentro
// da janela de idade), escolhe versão A/B (leve x elegante), monta {{1}}/{{2}},
// envia via enviarTemplateLara e registra em meluni_mensagens + atualiza a conversa.
//
// GATE: só roda de verdade se config lara_carrinho_disparo_ativo=true (default
// false — liga só depois dos templates aprovados). ?force=1 ignora o cron-check
// mas continua respeitando o gate; ?force=1&teste=1 ignora o gate (dry/real teste).
//
// Idempotência: marca dados_extra.lara_template_enviado_em; o filtro pula quem já tem.
// Janela 24h: irrelevante p/ template (template é justamente o que reabre fora dela).
// Ailson 16/06/2026.
// ============================================================================
import { supabase, cfgMeluni } from './_meluni-whats-helpers.js';
import { enviarTemplateLara } from './_meluni-whats-meta.js';
import { resolverResumoItens, resolverPrimeiroNome } from './_meluni-carrinho-resumo.js';

const ETAPAS_FECHADAS = ['vendeu', 'perdida', 'resolvido'];

async function acharOuCriarConversa(telefone, nome) {
  const { data: ex } = await supabase.from('meluni_conversas').select('id, etapa')
    .eq('canal', 'whatsapp').eq('telefone', telefone)
    .order('ultima_msg_em', { ascending: false }).limit(1).maybeSingle();
  if (ex?.id) return ex;
  const { data: nova } = await supabase.from('meluni_conversas').insert({
    canal: 'whatsapp', telefone, externo_id: telefone, nome_cliente: nome || null,
    origem: 'carrinho', etapa: 'conversando',
    ultima_msg_direcao: 'saida', ultima_msg_em: new Date().toISOString(),
  }).select('id, etapa').single();
  return nova || null;
}

export default async function handler(req, res) {
  const ua = req.headers?.['user-agent'] || '';
  const ehCron = ua.startsWith('vercel-cron') || !!req.headers?.['x-vercel-cron'];
  const force = req.query?.force === '1';
  if (!ehCron && !force) return res.status(403).json({ erro: 'Cron only. Use ?force=1 pra teste.' });

  const ativo = (await cfgMeluni('lara_carrinho_disparo_ativo', false)) === true;
  const ignoraGate = force && req.query?.teste === '1';
  if (!ativo && !ignoraGate) {
    return res.status(200).json({ ok: true, gate: 'desligado', enviados: 0, nota: 'lara_carrinho_disparo_ativo=false; ?force=1&teste=1 ignora.' });
  }

  const idadeMinH = Number(await cfgMeluni('lara_carrinho_idade_min_horas', 2)) || 2;
  const idadeMaxD = Number(await cfgMeluni('lara_carrinho_idade_max_dias', 30)) || 30;
  const pctLeve = Number(await cfgMeluni('lara_carrinho_ab_pct_leve', 50));
  const lote = Number(await cfgMeluni('lara_carrinho_lote', 20)) || 20;
  const exigirNome = (await cfgMeluni('lara_carrinho_exigir_nome', true)) !== false;
  const limite = force ? Math.min(lote, Number(req.query?.n) || lote) : lote;

  const agora = Date.now();
  const teto = new Date(agora - idadeMinH * 3600e3).toISOString();   // mais velho que isso
  const piso = new Date(agora - idadeMaxD * 86400e3).toISOString();  // mais novo que isso

  let enviados = 0, pulados = 0, erros = 0;
  const detalhe = [];

  try {
    const { data: carts, error } = await supabase.from('meluni_carrinhos')
      .select('id, nome, telefone, itens, dados_extra, data_carrinho, status')
      .eq('status', 'processando')
      .not('telefone', 'is', null)
      .lte('data_carrinho', teto)
      .gte('data_carrinho', piso)
      .order('data_carrinho', { ascending: false })
      .limit(limite * 3); // folga: muitos serão pulados por já-enviado/sem-item
    if (error) throw error;

    for (const c of (carts || [])) {
      if (enviados >= limite) break;
      const itens = Array.isArray(c.itens) ? c.itens.filter(i => i?.sku) : [];
      if (!itens.length) { pulados++; continue; }
      if (c.dados_extra?.lara_template_enviado_em) { pulados++; continue; }

      const nome = await resolverPrimeiroNome(c.telefone, c.nome);
      if (!nome && exigirNome) { pulados++; detalhe.push({ id: c.id, pulado: 'sem_nome' }); continue; }
      const nome1 = nome || 'tudo bem'; // só usado se exigirNome=false

      const { resumo } = await resolverResumoItens(itens);

      // versão: leve precisa de {{2}}; se resumo não resolveu, cai pra elegante.
      let versao = Math.random() * 100 < pctLeve ? 'leve' : 'elegante';
      if (versao === 'leve' && !resumo) versao = 'elegante';
      const nameTpl = versao === 'leve' ? 'meluni_carrinho_leve' : 'meluni_carrinho_elegante';
      const bodyParams = versao === 'leve' ? [nome1, resumo] : [nome1];

      const conv = await acharOuCriarConversa(c.telefone, nome);
      if (conv && ETAPAS_FECHADAS.includes(conv.etapa)) { pulados++; detalhe.push({ id: c.id, pulado: 'conversa_fechada' }); continue; }

      try {
        const r = await enviarTemplateLara(c.telefone, nameTpl, bodyParams);
        const metaMsgId = r?.messages?.[0]?.id || null;
        const nowIso = new Date().toISOString();

        if (conv?.id) {
          await supabase.from('meluni_mensagens').insert({
            conversa_id: conv.id, direcao: 'saida', autor: 'lara_carrinho',
            tipo_midia: 'template', template_usado: nameTpl,
            texto: versao === 'leve' ? `[carrinho] ${nome1}: ${resumo}` : `[carrinho] ${nome1}`,
            meta_message_id: metaMsgId, enviada_em: nowIso,
          });
          await supabase.from('meluni_conversas').update({
            ultima_msg_direcao: 'saida', ultima_msg_em: nowIso, responder_em: null,
          }).eq('id', conv.id);
        }

        await supabase.from('meluni_carrinhos').update({
          dados_extra: { ...(c.dados_extra || {}), lara_template_enviado_em: nowIso, lara_template_versao: versao, lara_template_name: nameTpl },
        }).eq('id', c.id);

        enviados++;
        detalhe.push({ id: c.id, telefone: c.telefone, versao, resumo: versao === 'leve' ? resumo : null, meta_message_id: metaMsgId });
      } catch (e) {
        erros++;
        detalhe.push({ id: c.id, erro: String(e?.message || e) });
      }
    }

    return res.status(200).json({ ok: true, gate: ativo ? 'ligado' : 'teste', enviados, pulados, erros, limite, detalhe });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: String(e?.message || e), enviados, pulados, erros });
  }
}
