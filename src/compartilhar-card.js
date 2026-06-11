import { toPng } from 'html-to-image';

// Compartilhamento de cards como imagem (WhatsApp etc no celular, download no
// desktop). Nós com data-noshot="1" (botões de ação, checkbox) ficam fora do PNG.
// Ailson 04/06/2026 · reescrito 11/06/2026:
//  - FIX foto sumida: as <img> do card (Supabase Storage) eram rebuscadas pelo
//    html-to-image na hora do snapshot e falhavam no Safari/iOS — o PNG saía sem
//    a foto do produto. Agora as imagens são convertidas pra data URL ANTES do
//    snapshot (inlinarImagens) e restauradas depois.
//  - Passada dupla no Safari/iOS (bug conhecido: 1ª render sai sem recursos).
//  - Envio em massa: gerarPngDeElemento + compartilharArquivos aceitam vários
//    arquivos num único share sheet (WhatsApp manda todas as fotos juntas).

const IS_SAFARI = typeof navigator !== 'undefined'
  && /safari/i.test(navigator.userAgent)
  && !/chrome|crios|android/i.test(navigator.userAgent);

// Converte todas as <img> dentro do elemento pra data URL. Retorna função que
// restaura os src originais. Imagens que falharem ficam como estão (placeholder).
async function inlinarImagens(el) {
  const imgs = Array.from(el.querySelectorAll('img'));
  const restaurar = [];
  await Promise.all(imgs.map(async (img) => {
    const src = img.currentSrc || img.src;
    if (!src || src.startsWith('data:')) return;
    try {
      const resp = await fetch(src, { mode: 'cors', cache: 'force-cache' });
      if (!resp.ok) return;
      const blob = await resp.blob();
      const dataUrl = await new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result);
        fr.onerror = () => rej(new Error('read fail'));
        fr.readAsDataURL(blob);
      });
      restaurar.push([img, src]);
      img.src = dataUrl;
      if (img.decode) { try { await img.decode(); } catch { /* segue */ } }
    } catch { /* mantém src original; PNG sai com placeholder */ }
  }));
  return () => restaurar.forEach(([img, src]) => { img.src = src; });
}

// Gera um File PNG de um elemento da tela.
export async function gerarPngDeElemento(el, filename = 'corte.png') {
  if (!el) throw new Error('elemento não encontrado');
  const restaurar = await inlinarImagens(el);
  try {
    const opts = {
      pixelRatio: 2,
      backgroundColor: '#ffffff',
      cacheBust: true,
      filter: (node) => !(node && node.dataset && node.dataset.noshot === '1'),
    };
    let dataUrl = await toPng(el, opts);
    if (IS_SAFARI) dataUrl = await toPng(el, opts); // 2ª passada (bug Safari)
    const blob = await (await fetch(dataUrl)).blob();
    return new File([blob], filename, { type: 'image/png' });
  } finally {
    restaurar();
  }
}

// Compartilha 1+ arquivos via share sheet nativo; fallback = download.
// Retorno: { ok, via } · { ok:false, erro:'gesto', files } quando o iOS perdeu
// o gesto do usuário (geração demorou) — o caller guarda os files e pede um
// 2º toque, que chama de novo com os files prontos (share imediato funciona).
export async function compartilharArquivos(files, { titulo = '', texto = '' } = {}) {
  if (!files || files.length === 0) return { ok: false, erro: 'sem arquivos' };
  if (navigator.canShare && navigator.canShare({ files })) {
    try {
      // texto junto: alguns alvos (WhatsApp Android) usam como legenda;
      // outros ignoram — por isso quem chama também copia pro clipboard.
      const payload = { files, title: titulo };
      if (texto) payload.text = texto;
      await navigator.share(payload);
      return { ok: true, via: 'share' };
    } catch (e) {
      if (e && e.name === 'AbortError') return { ok: true, via: 'cancelado' };
      if (e && e.name === 'NotAllowedError') return { ok: false, erro: 'gesto', files };
      // qualquer outro erro: cai pro download abaixo
    }
  }
  // Desktop / navegador sem share de arquivo: baixa os PNGs.
  for (const f of files) {
    const url = URL.createObjectURL(f);
    const a = document.createElement('a');
    a.href = url;
    a.download = f.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  return { ok: true, via: 'download' };
}

// API original (compartilhar 1 card) — mantida pro botão individual.
export async function compartilharElementoComoImagem(el, { filename = 'corte.png', titulo = '' } = {}) {
  try {
    const file = await gerarPngDeElemento(el, filename);
    return await compartilharArquivos([file], { titulo });
  } catch (e) {
    return { ok: false, erro: e?.message || 'erro ao gerar imagem' };
  }
}
