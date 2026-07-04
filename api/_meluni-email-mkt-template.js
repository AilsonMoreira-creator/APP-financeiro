// ============================================================================
// MELUNI — E-mail Mkt: render do HTML do e-mail (fonte única: preview + envio).
// renderEmailHtml({ campanha, carrinho, unsubscribeUrl }) -> string HTML.
// Tabela-based, <=600px, inline-styles (compatível com clientes de e-mail).
// Cores Meluni: roxo #9b59b6, escuro #2c3e50, fundo #f7f4f0.
// Ailson 20/06/2026.
// ============================================================================

export const EMAIL_DEFAULTS = {
  assunto: '',
  titulo: '',
  corpo: '',
  criativo_url: '',
  cta_label: 'Voltar pro meu carrinho',
  cta_url: 'https://meluniloja.com.br',
  cupom: '',
  cupom_validade: '',
  desconto: '10',
  utm: 'utm_source=email&utm_medium=carrinho&utm_campaign=recuperacao',
  assinatura: 'Equipe Meluni',
};

const ROXO = '#9b59b6', ESCURO = '#2c3e50', FUNDO = '#f7f4f0', BORDA = '#ece8e1', CINZA = '#8a8f98';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function primeiroNome(nome) {
  if (!nome) return '';
  const limpo = String(nome).trim();
  if (!limpo || /cliente do direct/i.test(limpo)) return '';
  const p = limpo.split(/\s+/)[0];
  return p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : '';
}

// substitui {{nome}} e limpa quando vazio ("Oi, !" -> "Oi!", " ," -> ",")
export function aplicarTokens(texto, nome) {
  let t = String(texto || '').replace(/\{\{\s*nome\s*\}\}/gi, nome || '');
  t = t.replace(/([,!?])\s*([,!?])/g, '$1')      // pontuação dupla
       .replace(/\s+,/g, ',').replace(/,\s*!/g, '!')
       .replace(/(Oi|Olá|Oie|Ei)\s*,\s*!/gi, '$1!')
       .replace(/(Oi|Olá|Oie|Ei)\s*,\s*\n/gi, '$1!\n')
       .replace(/[ \t]{2,}/g, ' ')
       .replace(/^\s*[,;]+\s*/, '')               // ", sua escolha..." -> "Sua escolha..." (nome era o 1º token)
       .replace(/\s*[,;]+\s*$/, '');              // "...por aqui," -> "...por aqui" (nome era o último token)
  // se a vírgula do começo caiu, capitaliza a 1ª letra
  t = t.trim();
  if (t) t = t.charAt(0).toUpperCase() + t.slice(1);
  return t;
}

function corpoToHtml(texto, nome) {
  const t = aplicarTokens(texto, nome);
  if (!t) return '';
  return t.split(/\n{2,}/).map(par => {
    const linhas = par.split(/\n/).map(esc).join('<br>');
    return `<p style="margin:0 0 14px;font-size:16px;line-height:1.6;color:${ESCURO};">${linhas}</p>`;
  }).join('');
}

function moeda(v) {
  const n = Number(v || 0);
  return 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function contarPecas(itens) {
  if (!Array.isArray(itens)) return 0;
  let n = 0;
  for (const it of itens) n += Number(it?.qtd || it?.quantidade || 1) || 1;
  return n || itens.length;
}

function urlComUtm(url, utm) {
  let base = String(url || EMAIL_DEFAULTS.cta_url).trim();
  if (!base) base = EMAIL_DEFAULTS.cta_url;
  if (!/^https?:\/\//i.test(base)) base = 'https://' + base;
  const u = String(utm || '').trim().replace(/^[?&]+/, '');
  if (!u) return base;
  return base + (base.includes('?') ? '&' : '?') + u;
}

export function renderEmailHtml({ campanha = {}, carrinho = {}, unsubscribeUrl = '#' } = {}) {
  const c = { ...EMAIL_DEFAULTS, ...campanha };
  const nome = primeiroNome(carrinho?.nome);
  const pecas = contarPecas(carrinho?.itens);
  const valor = carrinho?.valor;
  const resumoItens = carrinho?.resumo ? String(carrinho.resumo).trim() : '';

  const tituloHtml = aplicarTokens(c.titulo, nome);
  const corpoHtml = corpoToHtml(c.corpo, nome);
  const ctaHref = urlComUtm(c.cta_url, c.utm);
  const ctaLabel = aplicarTokens(c.cta_label || EMAIL_DEFAULTS.cta_label, nome) || EMAIL_DEFAULTS.cta_label;

  const criativo = c.criativo_url
    ? `<tr><td style="padding:0;"><img src="${esc(c.criativo_url)}" alt="" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0;"></td></tr>`
    : '';

  // Lista detalhada (até 3 itens com thumbnail): usa carrinho.itens_detalhados
  // [{ nome, foto, qtd }] quando presente. Thumb só renderiza se a foto existe
  // no cache (nunca aparece imagem quebrada); clique no thumb abre a foto em
  // tamanho cheio no navegador. Sem itens_detalhados, cai no resumo antigo.
  const itensDet = Array.isArray(carrinho?.itens_detalhados)
    ? carrinho.itens_detalhados.filter(i => i && (i.nome || i.foto)) : [];
  const restantes = Number(carrinho?.itens_restantes || 0);

  let blocoCarrinho = '';
  if (itensDet.length) {
    const linhas = itensDet.map((it, i) => {
      const nomeIt = esc(it.nome || 'Peça do seu carrinho');
      const qtd = Number(it.qtd) || 1;
      const qtdTxt = qtd > 1 ? ` <span style="color:${CINZA};font-size:13px;">x${qtd}</span>` : '';
      const thumb = it.foto
        ? `<td width="56" style="vertical-align:middle;"><a href="${esc(it.foto)}" target="_blank" style="text-decoration:none;"><img src="${esc(it.foto)}" alt="${nomeIt}" width="56" style="display:block;width:56px;height:auto;border:1px solid ${BORDA};border-radius:8px;"></a></td><td width="12" style="font-size:0;line-height:0;">&nbsp;</td>`
        : '';
      return `<tr><td style="padding:${i === 0 ? '12px' : '0'} 14px 12px;${i > 0 ? `border-top:1px solid ${BORDA};padding-top:12px;` : ''}">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          ${thumb}
          <td style="vertical-align:middle;font-size:15px;color:${ESCURO};line-height:1.4;">${nomeIt}${qtdTxt}</td>
        </tr></table>
      </td></tr>`;
    }).join('');
    const linhaRestantes = restantes > 0
      ? `<tr><td style="padding:0 14px 10px;font-size:13px;color:${CINZA};">e mais ${restantes} peça${restantes > 1 ? 's' : ''}</td></tr>` : '';
    const linhaTotal = valor
      ? `<tr><td style="padding:10px 14px;border-top:1px solid ${BORDA};font-size:15px;color:${ESCURO};">Total <span style="float:right;font-weight:700;color:${ROXO};">${esc(moeda(valor))}</span></td></tr>` : '';
    blocoCarrinho = `<tr><td style="padding:0 32px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${FUNDO};border:1px solid ${BORDA};border-radius:10px;margin:4px 0 18px;">
          ${linhas}${linhaRestantes}${linhaTotal}
        </table>
      </td></tr>`;
  } else if (resumoItens || pecas > 0 || valor) {
    blocoCarrinho = `<tr><td style="padding:0 32px;">
         <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${FUNDO};border:1px solid ${BORDA};border-radius:10px;margin:4px 0 18px;">
           <tr><td style="padding:14px 18px;font-size:15px;color:${ESCURO};">
             ${resumoItens
               ? esc(resumoItens)
               : (pecas > 0 ? `<strong>${pecas}</strong> peça${pecas > 1 ? 's' : ''} esperando vc` : 'Suas peças esperando vc')}
             ${valor ? `<span style="float:right;font-weight:700;color:${ROXO};">${esc(moeda(valor))}</span>` : ''}
           </td></tr>
         </table>
       </td></tr>`;
  }

  const descNum = String(c.desconto == null ? '' : c.desconto).replace(/[^\d]/g, '') || '10';
  const blocoCupom = c.cupom
    ? `<tr><td style="padding:0 32px 4px;">
         <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px dashed ${ROXO};border-radius:10px;margin:0 0 18px;">
           <tr><td align="center" style="padding:14px 12px;font-size:15px;color:${ESCURO};">
             Use o cupom <strong style="color:${ROXO};letter-spacing:.5px;">${esc(c.cupom)}</strong> e garanta <strong>até ${descNum}% no carrinho</strong>
             ${c.cupom_validade ? `<br><span style="font-size:12px;color:${CINZA};">válido por ${esc(c.cupom_validade)}</span>` : ''}
             <br><span style="font-size:11px;color:${CINZA};">até ${descNum}% é a soma deste cupom com os outros descontos da loja</span>
           </td></tr>
         </table>
       </td></tr>`
    : '';

  const cta = `<tr><td align="center" style="padding:6px 32px 8px;">
       <a href="${esc(ctaHref)}" style="display:inline-block;background:${ROXO};color:#fff;text-decoration:none;font-size:17px;font-weight:700;padding:15px 34px;border-radius:999px;">${esc(ctaLabel)}</a>
     </td></tr>`;

  const assinaturaHtml = c.assinatura
    ? `<tr><td style="padding:18px 32px 4px;font-size:15px;color:${ESCURO};line-height:1.5;">${aplicarTokens(c.assinatura, nome).split(/\n/).map(esc).join('<br>')}</td></tr>`
    : '';

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light only">
<title>${esc(c.assunto || 'Meluni')}</title></head>
<body style="margin:0;padding:0;background:${FUNDO};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(tituloHtml || c.assunto || 'Suas peças continuam aqui')}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${FUNDO};padding:24px 12px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 4px rgba(44,62,80,.08);">
      <tr><td align="center" style="padding:22px 32px 8px;">
        <span style="font-family:Georgia,'Times New Roman',serif;font-size:26px;letter-spacing:3px;color:${ESCURO};font-weight:700;">MELUNI</span>
      </td></tr>
      ${criativo}
      ${tituloHtml ? `<tr><td style="padding:22px 32px 6px;"><h1 style="margin:0;font-size:23px;line-height:1.3;color:${ESCURO};font-family:Georgia,serif;">${esc(tituloHtml)}</h1></td></tr>` : ''}
      ${corpoHtml ? `<tr><td style="padding:8px 32px 4px;">${corpoHtml}</td></tr>` : ''}
      ${blocoCarrinho}
      ${blocoCupom}
      ${cta}
      ${assinaturaHtml}
      <tr><td style="padding:16px 32px 20px;">
        <hr style="border:0;border-top:1px solid ${BORDA};margin:0 0 10px;">
        <p style="margin:0 0 4px;font-size:11px;color:${CINZA};line-height:1.45;">
          Vc recebeu este e-mail porque iniciou uma compra na Meluni, moda feminina elegante e atemporal.
        </p>
        <p style="margin:0;font-size:11px;color:${CINZA};">
          <a href="${esc(unsubscribeUrl)}" style="color:${CINZA};text-decoration:underline;">Não quero mais receber</a>
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}
