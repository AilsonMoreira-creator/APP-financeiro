/**
 * produtos-fotos.js — lista dos arquivos que EXISTEM no bucket "produtos" (23/09/2026).
 * As telas usavam tentativa-e-erro (ate 12 URLs por REF: 3260.jpg, .png, .webp, 03260...) e cada
 * tentativa errada vira um 400 no Storage (2.269 avisos em 24h). Com a lista, a tela pede direto
 * o arquivo certo — e REF sem foto nao gera nenhuma requisicao.
 */
import { supabase } from './_bling-helpers.js';
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=3600');
  const nomes = []; let de = 0;
  for (;;) {
    const { data, error } = await supabase.storage.from('produtos').list('', { limit: 1000, offset: de, sortBy: { column: 'name', order: 'asc' } });
    if (error) return res.status(500).json({ ok: false, erro: error.message });
    for (const f of data || []) if (f.name && f.id) nomes.push(f.name);
    if (!data || data.length < 1000) break; de += 1000;
  }
  return res.status(200).json({ ok: true, em: new Date().toISOString(), arquivos: nomes });
}
