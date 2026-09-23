/**
 * backup-diario.js — backup AUTOMATICO e AUDITAVEL no Google Drive (Ailson, 22/09/2026).
 *
 * Todo dia (cron 03:30 BRT):
 *  1. EXPORTA cada modulo (amicia_data + tabelas espelho/cadastro importantes) num JSON gzip.
 *     Fica de fora o que e segredo (tokens, senha em hash, chaves) e o que e cache recalculavel.
 *  2. GRAVA no Drive da exclusivo@ (pasta "Backups App Amícia"), permissao drive.file.
 *  3. CONFERE: baixa de volta o arquivo, compara sha256 byte a byte e as contagens por modulo.
 *  4. RETENCAO: apaga os arquivos com mais de 30 dias (so os que o proprio app criou).
 *  5. REGISTRA tudo em backup_execucoes. Falha (ou falta de backup > 26 h) vira alerta no
 *     WhatsApp pelo saude-monitor.
 * Domingo: TESTE DE RESTAURACAO — pega o arquivo do Drive, restaura o amicia_data numa tabela
 * de teste e compara registro a registro com o banco real.
 * ?teste=1 forca o teste de restauracao; ?seco=1 exporta sem subir (diagnostico).
 */
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { supabase } from './_bling-helpers.js';
export const config = { maxDuration: 300 };

const PASTA = 'Backups App Amícia';
const RETENCAO_DIAS = 30;
const sha = (b) => createHash('sha256').update(b).digest('hex');
const segredo = async (ch) => (await supabase.from('app_segredos').select('valor').eq('chave', ch).maybeSingle()).data?.valor || '';

// ── o que entra ──
const AMICIA_FORA = /^(qz-sign-key|backup-diario|debug-|bling-cron-status|bling-produtos-sync-status|ml-last-sync|ml-estoque-status|bling-analise-cores|bling-vendas)$|-bkp-|^backup-/;
const TABELAS = {
  // modulo: [tabela, colunas (null = todas), ordem]
  cadastros: [['cadastro_produtos_espelho'], ['cadastro_tecidos_espelho'], ['cadastro_oficinas_espelho']],
  oficinas: [['oficinas_cortes_espelho'], ['oficinas_caseado'], ['oficinas_passadoria'], ['passadoria_precos']],
  sala_corte: [['salas_corte_espelho']],
  financeiro: [['financeiro_despesas_espelho']],
  calculadora: [['calculadora_cards_espelho']],
  agenda: [['agenda_itens_espelho']],
  estoque: [['bling_estoque'], ['ml_sku_ref_map'], ['ml_sale_config']],
  lojas: [['lojas_clientes'], ['lojas_vendedoras'], ['lojas_config']],
  usuarios: [['app_usuarios', 'usuario, modulos, admin, ativo, versao, criado_em, atualizado_em']],   // sem senha_hash
  sistema: [['cron_agenda'], ['sombra_rotas']],
};
const MOD_AMICIA = (uid) => /^(amicia-admin|despesas-config)$/.test(uid) ? 'financeiro' : /^historico/.test(uid) ? 'historico' : uid === 'agenda' ? 'agenda'
  : uid === 'usuarios' ? 'usuarios' : /^calc-/.test(uid) ? 'calculadora' : /^ficha/.test(uid) ? 'ficha_tecnica' : /^folha/.test(uid) ? 'folha'
  : /^salas-/.test(uid) ? 'sala_corte' : /cortes|caseado|passadoria/.test(uid) ? 'oficinas' : 'configuracoes';

async function lerTabela(t, cols) {
  const out = []; let de = 0;
  for (;;) {
    const { data, error } = await supabase.from(t).select(cols || '*').range(de, de + 999);
    if (error) throw new Error(`${t}: ${error.message}`);
    out.push(...(data || [])); if (!data || data.length < 1000) break; de += 1000;
  }
  return out;
}
async function exportar() {
  const dados = { gerado_em: new Date().toISOString(), versao: 1, amicia_data: [], tabelas: {} };
  const { data: am, error } = await supabase.from('amicia_data').select('user_id, payload');
  if (error) throw new Error(`amicia_data: ${error.message}`);
  dados.amicia_data = (am || []).filter(r => !AMICIA_FORA.test(r.user_id));
  for (const lista of Object.values(TABELAS)) for (const [t, cols] of lista) dados.tabelas[t] = await lerTabela(t, cols);
  // 22/09: ESTRUTURA do banco (tabelas, indices, views, funcoes, gatilhos, regras de acesso) + historico de migracoes
  const est = await supabase.rpc('backup_estrutura'); if (est.error) throw new Error(`estrutura: ${est.error.message}`);
  const mig = await supabase.rpc('backup_migracoes'); if (mig.error) throw new Error(`migracoes: ${mig.error.message}`);
  dados.estrutura = est.data; dados.migracoes = mig.data;
  // resumo por modulo (auditoria)
  const modulos = {};
  const add = (m, linhas, txt) => { const x = modulos[m] = modulos[m] || { linhas: 0, bytes: 0, partes: [] }; x.linhas += linhas; x.bytes += Buffer.byteLength(txt); x.partes.push(sha(txt)); };
  for (const r of dados.amicia_data) add(MOD_AMICIA(r.user_id), 1, JSON.stringify(r));
  for (const [m, lista] of Object.entries(TABELAS)) for (const [t] of lista) add(m, dados.tabelas[t].length, JSON.stringify(dados.tabelas[t]));
  add('estrutura', (est.data.tabelas || []).length, JSON.stringify(est.data)); add('migracoes', (mig.data || []).length, JSON.stringify(mig.data));
  for (const m of Object.values(modulos)) { m.sha256 = sha(m.partes.join('')); delete m.partes; }
  return { dados, modulos };
}

// ── Drive ──
async function tokenDrive() {
  const rt = await segredo('drive_backup_refresh');
  if (!rt) throw new Error('Drive do backup não autorizado (falta drive_backup_refresh)');
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: rt, client_id: (process.env.GOOGLE_OAUTH_CLIENT_ID || '').trim(), client_secret: (process.env.GOOGLE_OAUTH_CLIENT_SECRET || '').trim() }) });
  const j = await r.json(); if (!j.access_token) throw new Error(`token Drive: ${j.error_description || j.error || r.status}`);
  return j.access_token;
}
async function pasta(tk) {
  const q = encodeURIComponent(`name='${PASTA}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const l = await (await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`, { headers: { Authorization: `Bearer ${tk}` } })).json();
  if (l.files?.[0]?.id) return l.files[0].id;
  const c = await (await fetch('https://www.googleapis.com/drive/v3/files?fields=id', { method: 'POST', headers: { Authorization: `Bearer ${tk}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: PASTA, mimeType: 'application/vnd.google-apps.folder' }) })).json();
  if (!c.id) throw new Error('não consegui criar a pasta no Drive');
  return c.id;
}
async function subir(tk, pastaId, nome, buf) {
  const b = 'bkp' + Date.now();
  const corpo = Buffer.concat([
    Buffer.from(`--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: nome, parents: [pastaId] })}\r\n--${b}\r\nContent-Type: application/gzip\r\n\r\n`),
    buf, Buffer.from(`\r\n--${b}--`)]);
  const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,size,md5Checksum', { method: 'POST',
    headers: { Authorization: `Bearer ${tk}`, 'Content-Type': `multipart/related; boundary=${b}` }, body: corpo });
  const j = await r.json(); if (!j.id) throw new Error(`upload: ${JSON.stringify(j).slice(0, 200)}`);
  return j;
}
const baixar = async (tk, id) => Buffer.from(await (await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`, { headers: { Authorization: `Bearer ${tk}` } })).arrayBuffer());
async function listar(tk, pastaId) {
  const q = encodeURIComponent(`'${pastaId}' in parents and trashed=false`);
  return (await (await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&orderBy=createdTime desc&fields=files(id,name,createdTime,size)&pageSize=100`, { headers: { Authorization: `Bearer ${tk}` } })).json()).files || [];
}

// ── teste de restauracao ──
async function testarRestauracao(tk, pastaId) {
  const arq = (await listar(tk, pastaId)).find(f => /^backup-\d{4}/.test(f.name));
  if (!arq) throw new Error('nenhum backup no Drive pra testar');
  const d = JSON.parse(gunzipSync(await baixar(tk, arq.id)).toString('utf8'));
  await supabase.from('backup_teste_amicia_data').delete().neq('user_id', '');
  for (let i = 0; i < d.amicia_data.length; i += 20) {
    const { error } = await supabase.from('backup_teste_amicia_data').insert(d.amicia_data.slice(i, i + 20));
    if (error) throw new Error(`restaurar: ${error.message}`);
  }
  // compara: restaurado x arquivo (fidelidade) e restaurado x banco real (quanto mudou desde o backup)
  const { data: rest } = await supabase.from('backup_teste_amicia_data').select('user_id, payload');
  const { data: real } = await supabase.from('amicia_data').select('user_id, payload');
  const hArq = Object.fromEntries(d.amicia_data.map(r => [r.user_id, sha(JSON.stringify(r.payload))]));
  const hRest = Object.fromEntries((rest || []).map(r => [r.user_id, sha(JSON.stringify(r.payload))]));
  const hReal = Object.fromEntries((real || []).map(r => [r.user_id, sha(JSON.stringify(r.payload))]));
  const falhas = Object.keys(hArq).filter(k => hArq[k] !== hRest[k]);
  const mudaramDesde = Object.keys(hArq).filter(k => hReal[k] && hReal[k] !== hArq[k]);
  const tabelas = Object.fromEntries(Object.entries(d.tabelas).map(([t, v]) => [t, v.length]));
  await supabase.from('backup_teste_amicia_data').delete().neq('user_id', '');
  return { arquivo: arq.name, registros: d.amicia_data.length, restaurados: (rest || []).length, divergentes: falhas, mudaram_desde_o_backup: mudaramDesde.length, tabelas, ok: !falhas.length && (rest || []).length === d.amicia_data.length };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const teste = String(req.query?.teste || '') === '1' || (!req.query?.seco && new Date().getUTCDay() === 0);
  const { data: ex } = await supabase.from('backup_execucoes').insert({ tipo: 'diario' }).select('id').single();
  const fim = async (campos) => { await supabase.from('backup_execucoes').update({ terminado_em: new Date().toISOString(), ...campos }).eq('id', ex.id); };
  try {
    const { dados, modulos } = await exportar();
    const json = Buffer.from(JSON.stringify(dados));
    const gz = gzipSync(json, { level: 9 });
    const nome = `backup-${new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10)}.json.gz`;
    if (req.query?.seco) { await fim({ ok: true, arquivo: '(seco)', bytes: gz.length, sha256: sha(gz), modulos }); return res.status(200).json({ ok: true, seco: true, bytes_json: json.length, bytes_gz: gz.length, modulos }); }

    const tk = await tokenDrive();
    const pastaId = await pasta(tk);
    const up = await subir(tk, pastaId, nome, gz);
    // CONFERENCIA: baixa de volta e compara byte a byte + contagens
    const volta = await baixar(tk, up.id);
    const conf = { sha_igual: sha(volta) === sha(gz), bytes_drive: volta.length, bytes_enviados: gz.length };
    const relido = JSON.parse(gunzipSync(volta).toString('utf8'));
    conf.amicia_data = relido.amicia_data.length === dados.amicia_data.length;
    conf.tabelas = Object.entries(dados.tabelas).every(([t, v]) => (relido.tabelas[t] || []).length === v.length);
    conf.nao_vazio = dados.amicia_data.length > 10 && (dados.tabelas.lojas_clientes || []).length > 100;
    const ce = relido.estrutura?.contagem || {};
    conf.estrutura = { tabelas: `${relido.estrutura?.tabelas?.length}/${ce.tabelas}`, views: `${relido.estrutura?.views?.length}/${ce.views}`, gatilhos: `${relido.estrutura?.gatilhos?.length}/${ce.gatilhos}`, policies: `${relido.estrutura?.policies?.length}/${ce.policies}`, funcoes: relido.estrutura?.funcoes?.length, indices: relido.estrutura?.indices?.length, migracoes: relido.migracoes?.length };
    conf.estrutura_ok = relido.estrutura?.tabelas?.length === ce.tabelas && relido.estrutura?.views?.length === ce.views && relido.estrutura?.gatilhos?.length === ce.gatilhos && relido.estrutura?.policies?.length === ce.policies && ce.tabelas > 100;
    // compara com o backup anterior: queda brusca de linhas = suspeito
    const { data: ant } = await supabase.from('backup_execucoes').select('modulos').eq('ok', true).eq('tipo', 'diario').neq('arquivo', '(seco)').order('id', { ascending: false }).limit(1).maybeSingle();
    conf.quedas = ant?.modulos ? Object.entries(modulos).filter(([m, v]) => ant.modulos[m]?.linhas > 5 && v.linhas < ant.modulos[m].linhas * 0.7).map(([m, v]) => `${m}: ${ant.modulos[m].linhas}→${v.linhas}`) : [];
    let ok = conf.sha_igual && conf.amicia_data && conf.tabelas && conf.nao_vazio && conf.estrutura_ok && !conf.quedas.length;
    // RETENCAO
    const limite = Date.now() - RETENCAO_DIAS * 86400e3;
    const antigos = (await listar(tk, pastaId)).filter(f => /^backup-\d{4}/.test(f.name) && new Date(f.createdTime).getTime() < limite);
    for (const f of antigos) await fetch(`https://www.googleapis.com/drive/v3/files/${f.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${tk}` } });
    conf.apagados_retencao = antigos.length;
    // TESTE DE RESTAURACAO (domingo ou ?teste=1)
    if (teste) { try { conf.restauracao = await testarRestauracao(tk, pastaId); if (!conf.restauracao.ok) ok = false; } catch (e) { conf.restauracao = { ok: false, erro: String(e?.message || e) }; ok = false; } }
    const erro = ok ? null : [!conf.sha_igual && 'arquivo no Drive diferente do enviado', !conf.amicia_data && 'contagem amicia_data não bate', !conf.tabelas && 'contagem de tabelas não bate',
      !conf.nao_vazio && 'backup vazio/pequeno demais', !conf.estrutura_ok && 'estrutura do banco incompleta', conf.quedas.length && `queda brusca: ${conf.quedas.join(', ')}`, conf.restauracao && !conf.restauracao.ok && `teste de restauração falhou: ${conf.restauracao.erro || conf.restauracao.divergentes?.join(',')}`].filter(Boolean).join(' · ');
    await fim({ ok, tipo: teste ? 'teste_restauracao' : 'diario', arquivo: nome, drive_file_id: up.id, bytes: gz.length, sha256: sha(gz), modulos, conferencia: conf, erro });
    return res.status(200).json({ ok, arquivo: nome, bytes: gz.length, modulos, conferencia: conf, erro });
  } catch (e) {
    await fim({ ok: false, erro: String(e?.message || e) });
    return res.status(200).json({ ok: false, erro: String(e?.message || e) });
  }
}
