// ============================================================================
// MELUNI — DEBUG: puxa um contato cru do Bling Lumia e mostra o que volta.
// Serve pra ver se o contato traz CPF (numeroDocumento) ou se o escopo
// "Contatos" nao esta autorizado no app/integracao Lumia (status 401/403).
// Uso: /api/meluni-bling-debug            -> pega um comprador sem nome
//      /api/meluni-bling-debug?id=NNN     -> testa um contato_id especifico
//      /api/meluni-bling-debug?pedido=NNN -> mostra tb como o contato vem no pedido
// Ailson 15/06/2026.
// ============================================================================
import { supabase, refreshBlingToken, blingFetch } from './_bling-helpers.js';

const API = 'https://api.bling.com.br/Api/v3';
const mask = (s) => { if (!s) return s || null; const d = String(s); return d.length <= 5 ? '***' : d.slice(0, 3) + '***' + d.slice(-2); };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const q = req.query || {};
    const token = await refreshBlingToken('lumia');
    const headers = { Authorization: 'Bearer ' + token, Accept: 'application/json' };

    let contatoId = q.id || null;
    const pedidoId = q.pedido || null;
    if (!contatoId) {
      const { data } = await supabase.from('meluni_clientes')
        .select('bling_contato_id').not('bling_contato_id', 'is', null).is('nome', null).limit(1);
      contatoId = data?.[0]?.bling_contato_id || null;
    }

    const out = { conta: 'lumia', token_ok: !!token, contato_id_testado: contatoId };

    if (pedidoId) {
      const rp = await blingFetch(`${API}/pedidos/vendas/${pedidoId}`, headers);
      const jp = await rp.json().catch(() => null);
      out.pedido = { status: rp.status, situacao: jp?.data?.situacao || null, total: jp?.data?.total ?? null, data: jp?.data?.data || null, numeroLoja: jp?.data?.numeroLoja || null, contato_no_pedido: jp?.data?.contato || null, erro: jp?.error || null };
    }

    if (contatoId) {
      const rc = await blingFetch(`${API}/contatos/${contatoId}`, headers);
      const jc = await rc.json().catch(() => null);
      const d = jc?.data;
      out.contato = {
        status: rc.status,
        erro: jc?.error || null,             // <- se vier escopo nao autorizado, aparece aqui
        campos_presentes: d ? Object.keys(d) : null,
        nome: d?.nome || null,
        tipoPessoa: d?.tipo || d?.tipoPessoa || null,
        numeroDocumento_preview: mask(d?.numeroDocumento),
        tem_cpf: !!d?.numeroDocumento,
        celular_preview: mask(d?.celular),
        telefone_preview: mask(d?.telefone),
        email: d?.email || null,
      };
    } else {
      out.aviso = 'nenhum bling_contato_id sem nome encontrado; passa ?id=NNN';
    }

    return res.json(out);
  } catch (e) {
    return res.status(500).json({ ok: false, erro: e?.message || String(e) });
  }
}
