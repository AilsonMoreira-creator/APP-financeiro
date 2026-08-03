// ============================================================================
// MELUNI — cron diário do Google Drive.
// ----------------------------------------------------------------------------
// Lê as planilhas da pasta  lojas_app / Site Meluni  e popula:
//   carrinhos_DD.MM.YYYY  -> meluni_carrinhos   (upsert por uuid/planilha_ref, insert-only)
//   clientes_DD.MM.YYYY   -> meluni_clientes    (upsert por convertr_id, atualiza cadastro)
//   devolucoes_DD.MM.YYYY -> meluni_devolucoes  (upsert por convertr_id+ref, insert-only)
//
// Idempotente. Por padrão processa os arquivos dos últimos `dias` (default 7).
// Reusa os helpers de Drive do módulo Lojas (OAuth via env GOOGLE_*). A pasta
// raiz é GOOGLE_DRIVE_FOLDER_ID (lojas_app); filtra pela subpasta "Site Meluni".
// Ailson 13/06/2026.
// ============================================================================
import { listarArquivosDrive, baixarArquivoDrive } from './_lojas-drive-helpers.js';
import { supabase } from './_bling-helpers.js';

export const config = { maxDuration: 300 };

const norm = (s) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const dig = (s) => { const d = String(s || '').replace(/\D/g, ''); return d || null; };
const num = (s) => { const n = parseFloat(String(s ?? '').replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) ? n : null; };

// CSV robusto (campos com aspas, vírgulas e quebras de linha dentro de aspas)
function parseCSV(text) {
  text = String(text || '').replace(/^\uFEFF/, '');
  const rows = []; let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r') { /* ignora */ }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}
function toObjects(text) {
  const rows = parseCSV(text);
  if (!rows.length) return [];
  const head = rows[0].map(h => h.trim());
  return rows.slice(1)
    .filter(r => r.some(v => (v || '').trim() !== ''))
    .map(r => { const o = {}; head.forEach((h, i) => { o[h] = r[i] !== undefined ? r[i] : ''; }); return o; });
}

const tipoDoNome = (nome) => {
  const n = norm(nome);                       // norm tira acento e cedilha (ç->c)
  if (n.startsWith('carrinho')) return 'carrinhos';   // carrinho(s)
  if (n.startsWith('cliente')) return 'clientes';     // cliente(s)
  if (n.startsWith('devolu')) return 'devolucoes';    // devolução / devolucoes / devolucao
  if (n.startsWith('newsletter')) return 'newsletter'; // newsletter_DD.MM.AAAA (Ailson 03/08/2026)
  return null;
};
const dataDoNome = (nome) => { const m = String(nome).match(/(\d{2})[._\-/](\d{2})[._\-/](\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };

// ── mapeamentos CSV -> linha da tabela ──
function mapCliente(r) {
  const tel = dig(r.phone);
  const nome = [r.first_name, r.last_name].map(x => (x || '').trim()).filter(Boolean).join(' ') || null;
  return {
    convertr_id: r.id || null, nome, cpf: dig(r.taxvat), email: (r.email || '').trim() || null,
    telefone: tel, whatsapp: tel, origem_cadastro: 'convertr',
    dados_extra: { convertr_id: r.id, grupo: r.group, endereco: r.address },
    atualizado_em: new Date().toISOString(),
  };
}
function mapCarrinho(r) {
  const itens = [...String(r.produtos || '').matchAll(/(\d+)x\s*(\S+)/g)].map(m => ({ qtd: +m[1], sku: m[2] }));
  const cr = String(r.created_at || '').replace(', ', 'T').replace(/\//g, '-') || null;
  return {
    planilha_ref: r.uuid || null, nome: null, telefone: dig(r.customer_phone), email: (r.customer_email || '').trim() || null,
    valor: num(r.total), itens, data_carrinho: cr, status: 'processando',
    dados_extra: { convertr_id: r.id, customer_id: r.customer_id || null, link: r.link, items_count: r.items_count },
  };
}
// Newsletter do Convertr (Ailson 03/08/2026): entra na MESMA meluni_carrinhos
// com origem='newsletter' e segue o funil do carrinho. Regras dele:
// - so importa quem tem WhatsApp (coluna whatsapp, fallback phone)
// - quem ja tem carrinho (qualquer situacao) e ignorado no importarTabela
// - quem ja comprou e ignorado no importarTabela
function mapNewsletter(r) {
  const tel = dig(r.whatsapp) || dig(r.phone);
  return {
    planilha_ref: tel ? 'news_' + tel : null,
    nome: (r.name || '').trim() || null,
    telefone: tel || null,
    email: (r.email || '').trim().toLowerCase() || null,
    valor: 0, itens: [],
    data_carrinho: (r.created_at || '').trim() || null,
    status: 'processando', origem: 'newsletter',
    dados_extra: { referrer: r.referrer || null, fonte: 'newsletter' },
  };
}

function mapDevolucao(r) {
  const m = String(r.created_at || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
  const nome = [r.customer_first_name, r.customer_last_name].map(x => (x || '').trim()).filter(Boolean).join(' ') || null;
  return {
    convertr_id: r.id || null, nome, telefone: dig(r.customer_phone), pedido_ref: r.order_increment_id || null,
    produto: r.items_item_name || null, ref: r.items_item_sku || null, motivo: r.reason || null,
    status: r.status || null, valor: num(r.items_item_price), data_devolucao: m ? `${m[3]}-${m[2]}-${m[1]}` : null,
    dados_extra: {
      convertr_id: r.id, order_id: r.order_id, tipo: r.refund_type, mensagem: r.message,
      tamanho: r.items_item_options, cpf: dig(r.customer_taxvat), email: r.customer_email,
      order_total: r.order_total, historico: r.historico,
    },
  };
}

async function importarTabela(tipo, linhas) {
  if (!linhas.length) return 0;
  if (tipo === 'clientes') {
    const { error } = await supabase.from('meluni_clientes').upsert(linhas.map(mapCliente), { onConflict: 'convertr_id' });
    if (error) throw new Error('clientes: ' + error.message);
  } else if (tipo === 'carrinhos') {
    const { error } = await supabase.from('meluni_carrinhos').upsert(linhas.map(mapCarrinho), { onConflict: 'planilha_ref', ignoreDuplicates: true });
    if (error) throw new Error('carrinhos: ' + error.message);
  } else if (tipo === 'newsletter') {
    // Regras Ailson 03/08/2026: so com WhatsApp; ignora quem ja tem carrinho
    // (qualquer status/origem) e quem ja comprou (telefone right-10 ou email).
    let novas = linhas.map(mapNewsletter).filter(l => l.telefone && l.planilha_ref);
    if (!novas.length) return 0;

    // telefones ja presentes em meluni_carrinhos (qualquer origem)
    const tels = [...new Set(novas.map(l => l.telefone))];
    const jaTem = new Set();
    for (let i = 0; i < tels.length; i += 200) {
      const chunk = tels.slice(i, i + 200);
      const { data } = await supabase.from('meluni_carrinhos').select('telefone').in('telefone', chunk);
      (data || []).forEach(r => jaTem.add(r.telefone));
    }

    // compradores (n_compras>0): match por right-10 do telefone OU email
    const telsR10 = new Set(), emailsCompra = new Set();
    {
      const { data } = await supabase.from('meluni_clientes').select('whatsapp,email').gt('n_compras', 0).limit(20000);
      (data || []).forEach(r => {
        const d = String(r.whatsapp || '').replace(/\D/g, '');
        if (d.length >= 10) telsR10.add(d.slice(-10));
        const e = String(r.email || '').trim().toLowerCase();
        if (e) emailsCompra.add(e);
      });
    }

    novas = novas.filter(l =>
      !jaTem.has(l.telefone) &&
      !telsR10.has(l.telefone.slice(-10)) &&
      !(l.email && emailsCompra.has(l.email))
    );
    if (!novas.length) return 0;

    const { error } = await supabase.from('meluni_carrinhos').upsert(novas, { onConflict: 'planilha_ref', ignoreDuplicates: true });
    if (error) throw new Error('newsletter: ' + error.message);
    return novas.length;
  } else if (tipo === 'devolucoes') {
    // update-on-conflict (NAO ignoreDuplicates): o planilha e fonte da verdade do
    // STATUS (Aprovado/Produto recebido/Completo) + historico. mapDevolucao so grava
    // campos do planilha, entao os campos de workflow do app (etiqueta/recebido/
    // conferido/estornado/avisado) sao preservados. Ailson 22/06/2026.
    const { error } = await supabase.from('meluni_devolucoes').upsert(linhas.map(mapDevolucao), { onConflict: 'convertr_id,ref' });
    if (error) throw new Error('devolucoes: ' + error.message);
  }
  return linhas.length;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const q = { ...(req.query || {}), ...(req.body || {}) };
  const dias = Math.max(1, parseInt(q.dias || '7', 10) || 7);
  const corteData = new Date(Date.now() - dias * 86400000).toISOString().slice(0, 10);

  try {
    // pasta lojas_app / Site Meluni (ID do Drive). Override por env se mudar.
    const folderMeluni = process.env.MELUNI_DRIVE_FOLDER_ID || '1o1MDKt6B765x7TGtPGsZ1EVP6FEFffAW';

    const arquivos = await listarArquivosDrive(folderMeluni, { includeSubfolders: false });
    // só as planilhas conhecidas (carrinhos / clientes / devolucoes), nome tolerante a acento/ç
    const meluni = (arquivos || []).filter(a => tipoDoNome(a.name));
    if (!meluni.length) return res.json({ ok: true, msg: 'nenhuma planilha reconhecida na pasta Site Meluni', total: 0 });

    // janela de dias (pela data no nome); sem data no nome -> processa
    const naJanela = meluni.filter(a => { const d = dataDoNome(a.name); return !d || d >= corteData; });

    const resumo = {};
    const erros = [];
    for (const arq of naJanela) {
      const tipo = tipoDoNome(arq.name);
      try {
        const texto = await baixarArquivoDrive(arq.id);
        const linhas = toObjects(texto);
        const n = await importarTabela(tipo, linhas);
        resumo[arq.name] = { tipo, linhas: n };
      } catch (e) {
        erros.push({ arquivo: arq.name, erro: e?.message || String(e) });
      }
    }
    // casa carrinho/devolucao com o cadastro (telefone/cliente_id) apos importar
    let reconciliado = false;
    try { await supabase.rpc('fn_meluni_reconciliar_contatos'); reconciliado = true; }
    catch (e) { erros.push({ etapa: 'reconciliacao', erro: e?.message || String(e) }); }

    return res.json({ ok: erros.length === 0, processados: Object.keys(resumo).length, reconciliado, resumo, erros });
  } catch (e) {
    console.error('[meluni-drive-cron] ERRO:', e?.message || e);
    return res.status(500).json({ ok: false, erro: e?.message || String(e) });
  }
}
