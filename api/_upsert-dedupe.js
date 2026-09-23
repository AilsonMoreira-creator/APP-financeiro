/**
 * _upsert-dedupe.js — rede de seguranca GLOBAL pros upserts (23/09/2026).
 * "ON CONFLICT DO UPDATE command cannot affect row a second time" = o lote enviado tinha
 * a MESMA chave duas vezes (ex.: duas variacoes que normalizam pra mesma cor/tamanho, a API
 * externa devolvendo o mesmo item 2x). O Postgres recusa o lote INTEIRO — nada e gravado.
 * Aqui: antes de mandar, junta as linhas repetidas pela chave do onConflict (a ultima vence,
 * mesclando campos) e avisa no log qual tabela veio repetida, pra corrigir a origem depois.
 * Importado pelos helpers centrais — vale pra toda funcao que usa algum deles.
 */
import { PostgrestQueryBuilder } from '@supabase/postgrest-js';
const P = PostgrestQueryBuilder?.prototype;
if (P && P.upsert && !P.upsert.__dedupe) {
  const orig = P.upsert;
  P.upsert = function (values, opts = {}) {
    try {
      if (Array.isArray(values) && values.length > 1 && opts?.onConflict) {
        const cols = String(opts.onConflict).split(',').map(s => s.trim()).filter(Boolean);
        const m = new Map();
        for (const v of values) { const k = cols.map(c => JSON.stringify(v?.[c] ?? null)).join('|'); m.set(k, m.has(k) ? { ...m.get(k), ...v } : v); }
        if (m.size < values.length) {
          const tabela = String(this?.url?.pathname || '').split('/').pop();
          console.warn(`[upsert-dedupe] ${tabela}: ${values.length - m.size} linha(s) repetida(s) pela chave (${cols.join(',')}) — juntadas antes de gravar`);
          values = [...m.values()];
        }
      }
    } catch { /* nunca atrapalha o upsert */ }
    return orig.call(this, values, opts);
  };
  P.upsert.__dedupe = true;
}
export {};
