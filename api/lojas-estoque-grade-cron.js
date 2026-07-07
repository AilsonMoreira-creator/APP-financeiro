// api/lojas-estoque-grade-cron.js
// Importa o estoque FINO (ref + cor + tamanho) da planilha mais recente
// estoque_*.csv na pasta Produtos do Drive -> tabela lojas_estoque_grade.
// Cron 1x/dia 07:00 BRT (10:00 UTC). Tambem pode ser chamado manual (GET) pra
// disparar uma importacao na hora. Ailson 09/06/2026.
//
// Regras (Ailson 09/06):
//   - ref = coluna REFERENCIA (NAO o CODIGO, que e o SKU)
//   - ignora ref que comeca com '0', EXCETO 0020 e 0050 (basicas validas)
//   - ignora linha com COR ou TAM = '*' ou vazio (registros legados consolidados)
//   - disponivel = coluna DISPONIVEL (= saldo - pedido; pode ser <= 0)
//   - normaliza ref sem zeros a esquerda (0020 -> 20, 0050 -> 50)
//   - substitui a tabela inteira a cada importacao (snapshot do dia)

import { listarArquivosDrive, baixarArquivoDrive, parseCSV } from './_lojas-drive-helpers.js';
import { supabase } from './_lojas-whats-helpers.js';
import { enviarPushSofia } from './_push-helpers.js';

const WHITELIST_ZERO = new Set(['0020', '0050']);

const normalizarChave = s => String(s || '')
  .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z]/g, '').trim();

const refSemZero = r => (String(r || '').trim().replace(/^0+/, '') || '0');

// inteiro preservando sinal (DISPONIVEL pode ser negativo). "-1"->-1, "1,00"->1
function parseInteiro(v) {
  const m = String(v ?? '').trim().match(/^-?\d+/);
  return m ? parseInt(m[0], 10) : 0;
}

// acha a chave real do cabecalho por nome normalizado (aguenta acento e truncado)
function acharChave(chaves, alvoNorm) {
  return chaves.find(k => normalizarChave(k) === alvoNorm)
      || chaves.find(k => normalizarChave(k).startsWith(alvoNorm));
}

// estoque_08.06.2026.csv -> Date(2026-06-08)
function dataDoNome(nome) {
  const m = String(nome).match(/(\d{2})\.(\d{2})\.(\d{4})/);
  return m ? new Date(`${m[3]}-${m[2]}-${m[1]}T00:00:00Z`) : null;
}

export default async function handler(req, res) {
  try {
    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    if (!folderId) return res.status(500).json({ error: 'GOOGLE_DRIVE_FOLDER_ID nao configurado no Vercel' });

    const arquivos = await listarArquivosDrive(folderId);
    const estoques = (arquivos || []).filter(a => !a.isFolder && /^estoque_.*\.csv$/i.test(a.name || ''));
    if (!estoques.length) return res.status(404).json({ error: 'nenhum estoque_*.csv encontrado na pasta' });

    // mais recente: data no nome (primario) -> modifiedTime (fallback)
    estoques.sort((a, b) => {
      const da = dataDoNome(a.name), db = dataDoNome(b.name);
      if (da && db && da.getTime() !== db.getTime()) return db - da;
      return new Date(b.modifiedTime || 0) - new Date(a.modifiedTime || 0);
    });
    const arq = estoques[0];

    const conteudo = await baixarArquivoDrive(arq.id);
    const linhas = parseCSV(conteudo);
    if (!linhas.length) return res.status(422).json({ error: 'csv vazio', arquivo: arq.name });

    const chaves = Object.keys(linhas[0]);
    const kRef = acharChave(chaves, 'referencia');
    const kCor = acharChave(chaves, 'cor');
    const kTam = acharChave(chaves, 'tam');
    const kDisp = acharChave(chaves, 'disponiv');
    if (!kRef || !kCor || !kTam || !kDisp) {
      return res.status(422).json({ error: 'cabecalhos nao encontrados', chaves, mapeado: { kRef, kCor, kTam, kDisp } });
    }

    const dataArq = dataDoNome(arq.name);
    const dataArqISO = dataArq ? dataArq.toISOString().slice(0, 10) : null;

    let igZero = 0, igAster = 0, igSemRef = 0;
    const mapa = new Map(); // ref|cor|tam -> row (dedup, last-wins)

    for (const l of linhas) {
      const refRaw = String(l[kRef] || '').trim();
      if (!refRaw) { igSemRef++; continue; }
      if (/^0/.test(refRaw) && !WHITELIST_ZERO.has(refRaw)) { igZero++; continue; }
      const cor = String(l[kCor] || '').trim();
      const tam = String(l[kTam] || '').trim();
      if (!cor || !tam || cor === '*' || tam === '*') { igAster++; continue; }
      const ref = refSemZero(refRaw);
      mapa.set(`${ref}|${cor}|${tam}`, {
        ref, cor, tam,
        disponivel: parseInteiro(l[kDisp]),
        arquivo: arq.name,
        data_arquivo: dataArqISO,
      });
    }

    const rows = Array.from(mapa.values());

    // substitui a tabela inteira (snapshot do dia)
    const del = await supabase.from('lojas_estoque_grade').delete().not('ref', 'is', null);
    if (del.error) throw del.error;

    let inseridas = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const ins = await supabase.from('lojas_estoque_grade').insert(rows.slice(i, i + 500));
      if (ins.error) throw ins.error;
      inseridas += Math.min(500, rows.length - i);
    }

    // ── ALERTA DE REPOSIÇÃO (Ailson 07/07/2026) ─────────────────────────────
    // Fonte correta (Ailson): vw_lojas_reposicoes_auto = corte da Amícia
    // ENTREGUE pela oficina (janela 5-10d, 7-12d com caseado) de REF que já
    // vendia. NÃO usar "disponivel > 0" no snapshot: no atacado a grade quase
    // nunca zera (sempre sobram pontas de tamanho/cor), então estoque > 0 não
    // significa que a peça foi reposta. Conversa com tag 'reposicao' cuja REF
    // aparece na view ganha reposicao_alerta_em (card sobe) + push.
    let alertasReposicao = 0;
    try {
      const { data: comTag } = await supabase.from('lojas_whats_conversas')
        .select('id, nome_cliente, tags')
        .contains('tags', JSON.stringify([{ id: 'reposicao' }]))
        .is('reposicao_alerta_em', null)
        .limit(500);
      if ((comTag || []).length > 0) {
        const { data: repoRaw } = await supabase.from('vw_lojas_reposicoes_auto').select('ref');
        const refsRepostas = new Set((repoRaw || []).map(r => refSemZero(r.ref)));
        for (const c of comTag) {
          const tRep = (c.tags || []).find(t => t.id === 'reposicao' && t.ref);
          if (!tRep) continue;
          if (!refsRepostas.has(refSemZero(tRep.ref))) continue;
          const { error: eAl } = await supabase.from('lojas_whats_conversas')
            .update({ reposicao_alerta_em: new Date().toISOString(), atualizado_em: new Date().toISOString() })
            .eq('id', c.id);
          if (!eAl) {
            alertasReposicao++;
            enviarPushSofia({
              titulo: '📦 Reposição chegou',
              mensagem: `REF ${tRep.ref} voltou da oficina — avisar ${c.nome_cliente || 'cliente'} (card subiu no painel)`,
              url: '/?modulo=sofia',
            }).catch(() => {});
          }
        }
      }
    } catch (eRep) {
      console.warn('[estoque-grade-cron] alerta reposicao falhou (nao bloqueia import):', eRep?.message);
    }

    return res.status(200).json({
      ok: true,
      arquivo: arq.name,
      data_arquivo: dataArqISO,
      linhas_csv: linhas.length,
      importadas: inseridas,
      alertas_reposicao: alertasReposicao,
      refs_distintas: new Set(rows.map(r => r.ref)).size,
      ignoradas: { ref_zero: igZero, cor_ou_tam_asterisco: igAster, sem_ref: igSemRef },
      cabecalhos_usados: { ref: kRef, cor: kCor, tam: kTam, disponivel: kDisp },
    });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
