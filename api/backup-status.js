/** backup-status.js — SO LEITURA: saude do backup diario pra tela Configuracoes (22/09/2026). */
import { supabase } from './_bling-helpers.js';
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { data, error } = await supabase.from('backup_execucoes')
    .select('id, iniciado_em, terminado_em, tipo, ok, arquivo, bytes, erro, modulos, conferencia').neq('arquivo', '(seco)').order('id', { ascending: false }).limit(15);
  if (error) return res.status(500).json({ ok: false, erro: error.message });
  const lista = (data || []).map(e => ({
    em: e.terminado_em || e.iniciado_em, tipo: e.tipo, ok: e.ok, arquivo: e.arquivo, bytes: e.bytes, erro: e.erro,
    segundos: e.terminado_em ? Math.round((new Date(e.terminado_em) - new Date(e.iniciado_em)) / 1000) : null,
    modulos: e.modulos ? Object.keys(e.modulos).length : 0,
    estrutura: e.conferencia?.estrutura || null,
    restauracao: e.conferencia?.restauracao ? { ok: e.conferencia.restauracao.ok, registros: e.conferencia.restauracao.registros, divergentes: (e.conferencia.restauracao.divergentes || []).length } : null,
  }));
  const ultimoOk = lista.find(x => x.ok);
  const ultimoTeste = lista.find(x => x.restauracao);
  return res.status(200).json({ ok: true, ultimo: lista[0] || null, ultimo_ok: ultimoOk || null, ultimo_teste: ultimoTeste || null,
    horas_desde_ok: ultimoOk ? Math.round((Date.now() - new Date(ultimoOk.em)) / 3600e3) : null, execucoes: lista });
}
