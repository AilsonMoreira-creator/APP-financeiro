// /api/lojas-catalogo-reenvio — reenvia o catálogo PRINCIPAL pras conversas
// cujo envio de documento FALHOU nas últimas 24h (status 'erro' sem
// meta_message_id), com trava anti-duplicado: quem recebeu QUALQUER catálogo
// (automático ou manual) nas últimas 24h fica de fora. Ailson 19/08/2026,
// criado pro incidente do catálogo Verão 27 (6,8MB matando o envio).
// GET ?executar=1 roda; sem o parâmetro só lista quem receberia (prévia seca).
import { supabase, setCors, resolverCatalogos, log, logErro } from './_lojas-whats-helpers.js';
import { enviarMidiaSofia } from './_lojas-whats-midia-sender.js';

export const config = { maxDuration: 300 };
const espera = (ms) => new Promise(r => setTimeout(r, ms));

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const executar = String(req.query?.executar || '') === '1';
    const desde = new Date(Date.now() - 24 * 3600e3).toISOString();

    // 1. conversas com envio de documento FALHO nas últimas 24h
    const { data: falhas } = await supabase.from('lojas_whats_mensagens')
      .select('conversa_id')
      .eq('tipo_midia', 'document').eq('status', 'erro')
      .is('meta_message_id', null)
      .gte('enviada_em', desde);
    const idsFalha = [...new Set((falhas || []).map(f => f.conversa_id).filter(Boolean))];
    if (!idsFalha.length) return res.status(200).json({ ok: true, alvo: 0, msg: 'nenhuma falha nas ultimas 24h' });

    // 2. trava: quem JÁ recebeu documento com sucesso nas últimas 24h sai
    const { data: sucessos } = await supabase.from('lojas_whats_mensagens')
      .select('conversa_id')
      .eq('tipo_midia', 'document')
      .not('meta_message_id', 'is', null)
      .gte('enviada_em', desde)
      .in('conversa_id', idsFalha);
    const jaRecebeu = new Set((sucessos || []).map(s => s.conversa_id));
    const alvoIds = idsFalha.filter(id => !jaRecebeu.has(id));

    // 3. dados das conversas (pula sem telefone e descartadas)
    const { data: convs } = await supabase.from('lojas_whats_conversas')
      .select('id, telefone, nome_cliente, etapa')
      .in('id', alvoIds);
    const alvos = (convs || []).filter(c => c.telefone && c.etapa !== 'descartada');

    if (!executar) {
      return res.status(200).json({ ok: true, previa: true, alvo: alvos.length, pulados_ja_receberam: jaRecebeu.size, conversas: alvos.map(c => ({ id: c.id, nome: c.nome_cliente, etapa: c.etapa })) });
    }

    // 4. catálogo principal (verão quando existir)
    const { principal } = await resolverCatalogos();
    if (!principal) return res.status(500).json({ ok: false, erro: 'nenhum catalogo ativo' });

    let enviados = 0, erros = 0;
    const detalhe = [];
    for (const conv of alvos) {
      // mensagem no histórico ANTES (mesmo padrão dos outros caminhos)
      const { data: msg } = await supabase.from('lojas_whats_mensagens').insert({
        conversa_id: conv.id, direcao: 'saida', autor: 'assistente',
        enviada_modo: 'reenvio_falha', tipo_midia: 'document', texto: '',
        midia_url: `https://bxxawglmlqoswwyhpeil.supabase.co/storage/v1/object/public/sofia-midias/${principal.storage_path}`,
        status: 'enviando', enviada_em: new Date().toISOString(),
      }).select('id').single();

      try {
        const r = await enviarMidiaSofia({
          telefone: conv.telefone, midia: principal,
          conversaId: conv.id, mensagemId: msg?.id, decididaPor: 'reenvio_falha',
        });
        if (r?.ok && r?.message_id) {
          await supabase.from('lojas_whats_mensagens').update({ meta_message_id: r.message_id }).eq('id', msg.id);
          enviados++;
          detalhe.push({ conversa: conv.id, nome: conv.nome_cliente, ok: true });
        } else {
          throw new Error(r?.erro || 'sem message_id');
        }
      } catch (e) {
        erros++;
        if (msg?.id) await supabase.from('lojas_whats_mensagens').update({ status: 'erro' }).eq('id', msg.id);
        detalhe.push({ conversa: conv.id, nome: conv.nome_cliente, ok: false, erro: String(e.message).slice(0, 120) });
        logErro('catalogo-reenvio', e);
      }
      await espera(400);
    }

    log('catalogo-reenvio', `enviados=${enviados} erros=${erros} pulados=${jaRecebeu.size}`);
    return res.status(200).json({ ok: true, enviados, erros, pulados_ja_receberam: jaRecebeu.size, detalhe });
  } catch (e) {
    logErro('catalogo-reenvio', e);
    return res.status(500).json({ ok: false, erro: e.message });
  }
}
