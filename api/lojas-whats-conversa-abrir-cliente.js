// ═══════════════════════════════════════════════════════════════════════════
// /api/lojas-whats-conversa-abrir-cliente — abre (acha ou cria) a conversa de
// um cliente do módulo Clientes, pra abrir o MESMO chat do Sofia.
// ═══════════════════════════════════════════════════════════════════════════
// POST { cliente_id } → { conversa_id, criada }
//
// - Se já existe conversa NÃO-terminal pra esse cliente_id, reusa (a mais recente).
// - Senão cria uma conversa ZERADA (sem mensagem) em etapa 'processando'.
//   POST aceita { cliente_id, etapa }.
//   Seguro: cron-selecionar parte de carrinhos (não de conversas) e cron-responder
//   só age qdo ultima_msg_direcao='entrada'. Conversa zerada fica parada até alguém
//   clicar no 🤖 (ia-disparar-manual) → fora da janela 24h vira template + Aprovar.
//   Etapa própria do módulo ('feedback'/'inativo') → fica fora do funil do Sofia.
// ═══════════════════════════════════════════════════════════════════════════

import { supabase, normalizarTelefone } from './_lojas-whats-helpers.js';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  try {
    const { cliente_id, etapa } = req.body || {};
    if (!cliente_id) return res.status(400).json({ error: 'cliente_id_obrigatorio' });
    // etapa própria do módulo Clientes (mantém fora do funil do Sofia)
    const ETAPAS_OK = ['feedback', 'inativo'];
    const etapaFinal = ETAPAS_OK.includes(etapa) ? etapa : 'feedback';

    // 1) Reusa conversa não-terminal existente
    const { data: existentes, error: e0 } = await supabase
      .from('lojas_whats_conversas')
      .select('id, etapa, atualizado_em')
      .eq('cliente_id', cliente_id)
      .not('etapa', 'in', '(vendeu,perdida)')
      .order('atualizado_em', { ascending: false })
      .limit(1);
    if (e0) throw e0;
    if (existentes && existentes.length > 0) {
      return res.status(200).json({ conversa_id: existentes[0].id, criada: false });
    }

    // 2) Carrega cadastro do cliente
    const { data: cli, error: e1 } = await supabase
      .from('lojas_clientes')
      .select('telefone_principal, razao_social, comprador_nome')
      .eq('id', cliente_id)
      .single();
    if (e1 || !cli) return res.status(404).json({ error: 'cliente_nao_encontrado' });

    const tel = normalizarTelefone(cli.telefone_principal);
    if (!tel) return res.status(400).json({ error: 'telefone_invalido' });

    // 3) Cria conversa zerada
    const nome = cli.razao_social || cli.comprador_nome || null;
    const { data: nova, error: e2 } = await supabase
      .from('lojas_whats_conversas')
      .insert({ cliente_id, telefone: tel, nome_cliente: nome, etapa: etapaFinal })
      .select('id')
      .single();
    if (e2) throw e2;

    return res.status(200).json({ conversa_id: nova.id, criada: true });
  } catch (e) {
    console.error('[lojas-whats-conversa-abrir-cliente]', e.message);
    return res.status(500).json({ error: e.message });
  }
}
