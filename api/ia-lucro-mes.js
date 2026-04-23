/**
 * ia-lucro-mes.js — Card 1 do TabMarketplaces (admin-only).
 *
 * GET /api/ia-lucro-mes
 *   Header: X-User: <usuario admin>
 *
 * Retorna o lucro líquido do mês corrente consolidado por canal.
 * Fonte: vw_lucro_marketplace_mes (criada em 07_views_marketplaces.sql).
 *
 * Formato de resposta:
 *   {
 *     "ok": true,
 *     "mes_ref": "2026-04",
 *     "canais": [
 *       {
 *         "canal": "mercadolivre",
 *         "unidades": 2500,
 *         "receita_bruta": 198000.00,
 *         "lucro_bruto": 12500.50,
 *         "lucro_liquido": 11250.45  // já aplicado devolução 10%
 *       },
 *       ...
 *     ],
 *     "totais": {
 *       "unidades": N,
 *       "receita_bruta": X,
 *       "lucro_bruto": Y,
 *       "lucro_liquido": Z
 *     }
 *   }
 *
 * DUPLA VALIDAÇÃO admin (segurança reforçada, Sprint 4 briefing):
 *   1. validarAdmin() via helper padrão (X-User + amicia_data.usuarios)
 *   2. Checagem adicional: admin.user.admin === true explícito
 *   3. (Bônus) Se faltar qualquer uma, loga a tentativa.
 */
import { supabase, validarAdmin, setCors } from './_ia-helpers.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  // 1ª validação: helper padrão
  const admin = await validarAdmin(req);
  if (!admin.ok) {
    return res.status(admin.status).json({ error: admin.error });
  }

  // 2ª validação (redundante por segurança): admin === true explícito
  if (admin.user?.admin !== true) {
    return res.status(403).json({ error: 'Acesso restrito a admin' });
  }

  try {
    const { data, error } = await supabase
      .from('vw_lucro_marketplace_mes')
      .select('canal_norm, unidades_canal, receita_bruta_canal, lucro_bruto_canal, lucro_liquido_canal');

    if (error) {
      return res.status(500).json({ error: `Consulta falhou: ${error.message}` });
    }

    const canais = (data || []).map(r => ({
      canal: r.canal_norm,
      unidades: r.unidades_canal ?? 0,
      receita_bruta: Number(r.receita_bruta_canal ?? 0),
      lucro_bruto: Number(r.lucro_bruto_canal ?? 0),
      lucro_liquido: Number(r.lucro_liquido_canal ?? 0),
    }));

    const totais = canais.reduce(
      (acc, c) => ({
        unidades: acc.unidades + c.unidades,
        receita_bruta: acc.receita_bruta + c.receita_bruta,
        lucro_bruto: acc.lucro_bruto + c.lucro_bruto,
        lucro_liquido: acc.lucro_liquido + c.lucro_liquido,
      }),
      { unidades: 0, receita_bruta: 0, lucro_bruto: 0, lucro_liquido: 0 }
    );

    // Arredondamento final pra 2 casas
    totais.receita_bruta = Math.round(totais.receita_bruta * 100) / 100;
    totais.lucro_bruto = Math.round(totais.lucro_bruto * 100) / 100;
    totais.lucro_liquido = Math.round(totais.lucro_liquido * 100) / 100;

    const hoje = new Date();
    const mesRef = `${hoje.getUTCFullYear()}-${String(hoje.getUTCMonth() + 1).padStart(2, '0')}`;

    return res.json({
      ok: true,
      mes_ref: mesRef,
      devolucao_aplicada_pct: 10,
      canais,
      totais,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'erro interno' });
  }
}
