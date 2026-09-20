/**
 * bling-jwt-diag.js — SO LEITURA. Migracao JWT do Bling (prazo 15/10/2026).
 * Pra cada conta: formato do token guardado (opaco 40 chars x JWT "eyJ…") e se
 * uma chamada simples aceita o header enable-jwt:1 com o token ATUAL.
 */
import { supabase, refreshBlingToken, jwtLigadoPara } from './_bling-helpers.js';
export const config = { maxDuration: 20 };
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const out = { contas: {}, chave: null };
  try {
    const { data: cfg } = await supabase.from('saude_config').select('valor').eq('chave', 'bling_jwt_contas').maybeSingle();
    out.chave = cfg?.valor ?? null;
    for (const conta of ['exitus', 'lumia', 'muniam']) {
      const r = { jwt_ligado: await jwtLigadoPara(conta) };
      try {
        const token = await refreshBlingToken(conta);
        r.formato = token.startsWith('eyJ') ? 'JWT' : 'opaco'; r.tamanho = token.length;
        const teste = async (extra) => { const x = await fetch('https://api.bling.com.br/Api/v3/situacoes/modulos', { headers: { Authorization: `Bearer ${token}`, ...extra } }); return { http: x.status, corpo: (await x.text()).slice(0, 120) }; };
        r.sem_header = await teste({});
        r.com_header = await teste({ 'enable-jwt': '1' });
        // chamada REAL (o wrapper do fetch poe o header sozinho quando o token e JWT)
        const real = await fetch('https://api.bling.com.br/Api/v3/pedidos/vendas?limite=1', { headers: { Authorization: `Bearer ${token}` } });
        const rb = await real.text(); let rj = null; try { rj = JSON.parse(rb); } catch {}
        r.chamada_real_pedidos = { http: real.status, pedidos: Array.isArray(rj?.data) ? rj.data.length : null, corpo: real.ok ? undefined : rb.slice(0, 120) };
      } catch (e) { r.erro = String(e?.message || e).slice(0, 160); }
      out.contas[conta] = r;
    }
    return res.status(200).json(out);
  } catch (e) { return res.status(500).json({ erro: String(e?.message || e) }); }
}
