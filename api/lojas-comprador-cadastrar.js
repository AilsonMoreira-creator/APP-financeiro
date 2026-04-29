/**
 * lojas-comprador-cadastrar.js
 *
 * Endpoint pra vendedora (e admins) cadastrarem o "nome do comprador" de um
 * cliente — pessoa física que atende na loja em nome do CNPJ.
 *
 * 2 ações:
 *   - GET  ?documento=12345678901  → busca cliente por CNPJ/CPF
 *                                    Retorna { encontrado, cliente: { documento,
 *                                    razao_social, nome_fantasia, comprador_nome,
 *                                    apelido, vendedora_nome } }
 *
 *   - POST { documento, comprador_nome }
 *                                  → atualiza apelido E comprador_nome (nas
 *                                    DUAS colunas) do cliente identificado pelo
 *                                    documento. NÃO cria cliente novo.
 *                                    NÃO altera vendedora_id (decisão Ailson:
 *                                    qualquer vendedora pode cadastrar comprador
 *                                    em qualquer cliente, sem mexer na carteira).
 *
 * Auth: usuário válido (vendedora OU admin). Não restrito a admin.
 *
 * Frontend chama via:
 *   GET  /api/lojas-comprador-cadastrar?documento=...
 *   POST /api/lojas-comprador-cadastrar  body: { documento, comprador_nome }
 */

import { supabase, setCors, validarUsuario } from './_lojas-helpers.js';

// Limpa só dígitos
function limparDocumento(doc) {
  return String(doc || '').replace(/\D/g, '');
}

// Detecta tipo pelo número de dígitos. CPF=11, CNPJ=14.
function detectarTipo(doc) {
  const limpo = limparDocumento(doc);
  if (limpo.length === 11) return 'cpf';
  if (limpo.length === 14) return 'cnpj';
  return null;
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Valida usuário
  const auth = await validarUsuario(req);
  if (!auth.ok) {
    return res.status(auth.status || 401).json({ error: auth.error });
  }

  try {
    if (req.method === 'GET') {
      return await handleBuscar(req, res);
    }
    if (req.method === 'POST') {
      return await handleSalvar(req, res, auth);
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('[lojas-comprador-cadastrar] erro fatal:', e);
    return res.status(500).json({ error: e.message || 'Erro interno' });
  }
}

// ─── GET: busca cliente por documento ───────────────────────────────────────

async function handleBuscar(req, res) {
  const docRaw = req.query?.documento || '';
  const doc = limparDocumento(docRaw);
  const tipo = detectarTipo(doc);

  if (!tipo) {
    return res.status(400).json({
      error: 'Documento inválido',
      detalhe: 'CPF deve ter 11 dígitos, CNPJ deve ter 14 dígitos.',
    });
  }

  const { data: cliente, error } = await supabase
    .from('lojas_clientes')
    .select(`
      id, documento, tipo_documento, razao_social, nome_fantasia,
      apelido, comprador_nome, telefone_principal, vendedora_id
    `)
    .eq('documento', doc)
    .maybeSingle();

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  if (!cliente) {
    return res.status(200).json({
      encontrado: false,
      documento: doc,
      tipo_documento: tipo,
      mensagem: `${tipo.toUpperCase()} ${formatarDocumento(doc, tipo)} não está cadastrado no sistema.`,
    });
  }

  // Busca nome da vendedora pra mostrar no UI
  let vendedoraNome = null;
  if (cliente.vendedora_id) {
    const { data: vend } = await supabase
      .from('lojas_vendedoras')
      .select('nome')
      .eq('id', cliente.vendedora_id)
      .maybeSingle();
    vendedoraNome = vend?.nome || null;
  }

  return res.status(200).json({
    encontrado: true,
    cliente: {
      id: cliente.id,
      documento: cliente.documento,
      tipo_documento: cliente.tipo_documento,
      documento_formatado: formatarDocumento(cliente.documento, cliente.tipo_documento),
      razao_social: cliente.razao_social,
      nome_fantasia: cliente.nome_fantasia,
      apelido: cliente.apelido,
      comprador_nome: cliente.comprador_nome,
      telefone_principal: cliente.telefone_principal,
      vendedora_id: cliente.vendedora_id,
      vendedora_nome: vendedoraNome,
    },
  });
}

// ─── POST: salva nome do comprador (atualiza apelido E comprador_nome) ─────

async function handleSalvar(req, res, auth) {
  const { documento, comprador_nome } = req.body || {};

  const doc = limparDocumento(documento);
  const tipo = detectarTipo(doc);

  if (!tipo) {
    return res.status(400).json({
      error: 'Documento inválido',
      detalhe: 'CPF deve ter 11 dígitos, CNPJ deve ter 14 dígitos.',
    });
  }

  const nome = String(comprador_nome || '').trim();
  if (!nome || nome.length < 2) {
    return res.status(400).json({
      error: 'Nome do comprador é obrigatório (mínimo 2 caracteres).',
    });
  }
  if (nome.length > 100) {
    return res.status(400).json({
      error: 'Nome do comprador muito longo (máximo 100 caracteres).',
    });
  }

  // Busca cliente
  const { data: cliente, error: errBusca } = await supabase
    .from('lojas_clientes')
    .select('id, documento, razao_social, vendedora_id')
    .eq('documento', doc)
    .maybeSingle();

  if (errBusca) return res.status(500).json({ error: errBusca.message });
  if (!cliente) {
    return res.status(404).json({
      error: 'Cliente não encontrado',
      detalhe: `${tipo.toUpperCase()} ${formatarDocumento(doc, tipo)} não está cadastrado no sistema.`,
    });
  }

  // Atualiza AMBAS as colunas (apelido + comprador_nome) com o mesmo valor.
  // Decisão Ailson 28/04/2026: schema mantém os 2 campos por compat, mas o
  // input via UI escreve nos dois. Não mexe em vendedora_id.
  const { data: atualizado, error: errUpdate } = await supabase
    .from('lojas_clientes')
    .update({
      apelido: nome,
      comprador_nome: nome,
      updated_at: new Date().toISOString(),
      updated_by: auth.userId,
    })
    .eq('id', cliente.id)
    .select('id, documento, razao_social, apelido, comprador_nome')
    .single();

  if (errUpdate) return res.status(500).json({ error: errUpdate.message });

  console.log(`[lojas-comprador-cadastrar] ${auth.userId} cadastrou comprador "${nome}" para ${cliente.documento} (${cliente.razao_social})`);

  return res.status(200).json({
    sucesso: true,
    cliente: atualizado,
    mensagem: `Comprador "${nome}" cadastrado para ${cliente.razao_social}.`,
  });
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatarDocumento(doc, tipo) {
  const d = String(doc || '').replace(/\D/g, '');
  if (tipo === 'cnpj' && d.length === 14) {
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  }
  if (tipo === 'cpf' && d.length === 11) {
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  }
  return d;
}
