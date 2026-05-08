/**
 * lojas-definir-aprende-com.js — Define vendedora B aprende_com vendedora A
 *
 * POST { vendedora_id: 'B', aprende_com: 'A' }   — define
 * POST { vendedora_id: 'B', aprende_com: null }  — remove (B volta ao estilo proprio)
 *
 * Salva em lojas_config chave 'aprende_com.<vendedora_id>'.
 * Auth: admin only.
 *
 * Decisao Ailson 07/05/2026 (3b): quando aprende_com != null, edicoes
 * da vendedora B sao IGNORADAS (nao atualizam estilo proprio dela).
 * Edicoes ainda sao gravadas em lojas_edicoes_mensagens pro audit, mas
 * lojas_estilo_vendedora dela fica congelado. Se admin desmarcar
 * aprende_com, edicoes futuras voltam a contabilizar.
 *
 * Sessao Ailson 07/05/2026.
 */
import { supabase, validarUsuario, setCors } from './_lojas-helpers.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });

  const auth = await validarUsuario(req);
  if (!auth.ok) return res.status(auth.status || 403).json({ error: auth.error });
  if (!auth.isAdmin) return res.status(403).json({ error: 'Apenas admin' });

  const { vendedora_id, aprende_com } = req.body || {};
  if (!vendedora_id) return res.status(400).json({ error: 'vendedora_id obrigatorio' });

  // Valida que ambas vendedoras existem (se aprende_com nao eh null)
  if (aprende_com) {
    if (aprende_com === vendedora_id) {
      return res.status(400).json({ error: 'Vendedora nao pode aprender com ela mesma' });
    }

    // Previne loop: A aprende com B, B aprende com A
    const { data: refDest } = await supabase
      .from('lojas_config')
      .select('valor')
      .eq('chave', `aprende_com.${aprende_com}`)
      .maybeSingle();
    if (refDest?.valor === vendedora_id) {
      return res.status(400).json({
        error: 'Loop detectado: vendedora referencia ja aprende com voce',
      });
    }

    const { data: ambas } = await supabase
      .from('lojas_vendedoras')
      .select('id')
      .in('id', [vendedora_id, aprende_com]);
    if (!ambas || ambas.length !== 2) {
      return res.status(404).json({ error: 'Vendedora ou referencia nao encontrada' });
    }
  }

  // Upsert config
  if (aprende_com) {
    await supabase
      .from('lojas_config')
      .upsert({
        chave: `aprende_com.${vendedora_id}`,
        valor: aprende_com,
      }, { onConflict: 'chave' });
  } else {
    // Remove (volta ao estilo proprio)
    await supabase
      .from('lojas_config')
      .delete()
      .eq('chave', `aprende_com.${vendedora_id}`);
  }

  return res.json({ ok: true, vendedora_id, aprende_com });
}
