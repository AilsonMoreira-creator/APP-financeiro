import { toPng } from 'html-to-image';

// Gera um PNG de um elemento da tela e abre o compartilhamento nativo (no
// celular o sheet do iOS/Android com WhatsApp etc.) ou baixa o arquivo (desktop).
// Nós que tiverem data-noshot="1" (ex: botões de ação) são ignorados na imagem.
// Ailson 04/06/2026.
export async function compartilharElementoComoImagem(el, { filename = 'corte.png', titulo = '' } = {}) {
  if (!el) return { ok: false, erro: 'elemento não encontrado' };
  try {
    const dataUrl = await toPng(el, {
      pixelRatio: 2,
      backgroundColor: '#ffffff',
      cacheBust: true,
      filter: (node) => !(node && node.dataset && node.dataset.noshot === '1'),
    });

    const blob = await (await fetch(dataUrl)).blob();
    const file = new File([blob], filename, { type: 'image/png' });

    // Celular: Web Share API com arquivo — abre o sheet (WhatsApp aparece lá).
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: titulo });
        return { ok: true, via: 'share' };
      } catch (e) {
        if (e && e.name === 'AbortError') return { ok: true, via: 'cancelado' };
        // qualquer outro erro: cai pro download abaixo
      }
    }

    // Desktop / navegador sem share de arquivo: baixa o PNG.
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    return { ok: true, via: 'download' };
  } catch (e) {
    return { ok: false, erro: e?.message || 'erro ao gerar imagem' };
  }
}
