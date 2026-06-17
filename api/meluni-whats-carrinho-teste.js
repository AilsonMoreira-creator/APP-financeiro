// ============================================================================
// /api/meluni-whats-carrinho-teste — envio de teste de template de carrinho.
// GET ?force=1&telefone=55..&nome=Ailson&refs=2277&versao=leve
// Usa a engrenagem real: ref -> acha 1 sku -> resolverResumoItens. Ailson 16/06/2026.
// ============================================================================
import { supabase } from './_meluni-whats-helpers.js';
import { enviarTemplateLara } from './_meluni-whats-meta.js';
import { resolverResumoItens } from './_meluni-carrinho-resumo.js';

const refZ = (r) => String(r ?? '').replace(/^0+/, '') || '0';

export default async function handler(req, res) {
  if (req.query?.force !== '1') return res.status(403).json({ erro: 'Use ?force=1' });
  const telefone = String(req.query?.telefone || '').replace(/\D/g, '');
  if (!telefone) return res.status(400).json({ erro: 'telefone obrigatorio (só dígitos)' });
  const nome = req.query?.nome ? String(req.query.nome).trim() : null;
  const primeiroNome = nome ? nome.split(/\s+/)[0] : null;
  const refs = String(req.query?.refs || '').split(',').map(s => s.trim()).filter(Boolean);
  const versao = req.query?.versao || (primeiroNome ? 'leve' : 'sem_nome');

  // ref -> 1 sku (ml primeiro, bling fallback)
  const itens = [];
  for (const ref of refs) {
    const rz = refZ(ref);
    let sku = null;
    const { data: ml } = await supabase.from('ml_sku_ref_map').select('sku').eq('ref', rz).limit(1).maybeSingle();
    sku = ml?.sku || null;
    if (!sku) {
      const { data: bl } = await supabase.from('bling_estoque').select('bling_sku').eq('ref', rz).limit(1).maybeSingle();
      sku = bl?.bling_sku || null;
    }
    if (sku) itens.push({ sku, qtd: 1 });
  }

  const { resumo: resumoCalc, principalNome } = await resolverResumoItens(itens);
  const resumo = req.query?.resumo ? String(req.query.resumo) : resumoCalc;

  const nameTpl = versao === 'leve' ? 'meluni_carrinho_leve'
    : versao === 'elegante' ? 'meluni_carrinho_elegante' : 'meluni_carrinho_sem_nome';
  const bodyParams = versao === 'leve' ? [primeiroNome, resumo]
    : versao === 'elegante' ? [primeiroNome] : [resumo];

  if ((versao === 'leve' && (!primeiroNome || !resumo)) ||
      (versao === 'elegante' && !primeiroNome) ||
      (versao === 'sem_nome' && !resumo)) {
    return res.status(400).json({ erro: 'params insuficientes pra essa versao', versao, primeiroNome, resumo, principalNome });
  }

  try {
    const r = await enviarTemplateLara(telefone, nameTpl, bodyParams);
    return res.status(200).json({ ok: true, telefone, versao, nameTpl, bodyParams, resumo, meta_message_id: r?.messages?.[0]?.id || null });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: String(e?.message || e), versao, nameTpl, bodyParams });
  }
}
