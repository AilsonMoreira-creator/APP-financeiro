// /api/meluni-novidade-teste — envia o template de novidade (foto+nome+botao)
// pra UM numero, pra teste visual. GET ?force=1&tel=11947233547 [&nome=Ailson]
// [&cfg=lara_templates_novidade] [&versao=moletinho]. Ailson 23/06/2026.
import { cfgMeluni } from './_meluni-whats-helpers.js';
import { enviarTemplateLara } from './_meluni-whats-meta.js';

const soDigitos = (s) => String(s || '').replace(/\D/g, '');
function canonTel(s) { let d = soDigitos(s); if (d.length >= 12 && d.startsWith('55')) d = d.slice(2); return d; }
function primeiroNome(nome) {
  const t = String(nome || '').trim().split(/\s+/)[0] || '';
  return t ? t.charAt(0).toUpperCase() + t.slice(1).toLowerCase() : '';
}

export default async function handler(req, res) {
  if (req.query?.force !== '1') return res.status(403).json({ erro: 'Use ?force=1&tel=...' });
  const tel = canonTel(req.query?.tel);
  if (!tel || tel.length < 10) return res.status(400).json({ erro: 'tel invalido (ex: 11947233547)' });

  const chaveCfg = req.query?.cfg || 'lara_templates_novidade';
  const spec = await cfgMeluni(chaveCfg, null);
  const tpls = spec?.templates || {};
  const versao = req.query?.versao || Object.keys(tpls)[0];
  const tpl = versao ? tpls[versao] : null;
  if (!tpl?.name) return res.status(404).json({ erro: `template ${chaveCfg}/${versao || '?'} nao encontrado` });

  const headerImage = tpl.header?.format === 'IMAGE' ? tpl.header?.sample_url : null;
  const lang = spec.idioma || tpl.language || 'pt_BR';
  const nome = primeiroNome(req.query?.nome) || 'Ailson';

  try {
    const r = await enviarTemplateLara('55' + tel, tpl.name, [nome], { language: lang, headerImage });
    return res.status(200).json({ ok: true, para: '55' + tel, template: tpl.name, nome, meta: r });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: String(e?.message || e) });
  }
}
