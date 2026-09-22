/**
 * saleFila.ts — fila de envios em massa do Sale, em SEGUNDO PLANO (Ailson, 22/09/2026).
 *
 * Seleciona promoções, clica "enviar", fecha a tela e segue pra outro card: a fila
 * continua rodando aqui (fora do componente), um envio por vez. O servidor aplica
 * as MESMAS travas de sempre (teto 7% / 12%, convite ainda aberto, sem duplicar).
 * Resultado por REF: sucesso = só atualiza (vira ATIVA); erro = ⚠ no botão sale do card.
 * Enquanto houver envio pendente, marca o app como "ocupado" (não recarrega versão nova).
 */
import { marcarOcupado, liberarOcupado } from './ocupado';

export type SaleJob = { ref: string; conta: string; promo_key: string; promo_id?: string; promo_nome?: string; tipo: string; family_id?: string | null; itens: any[] };
type Erro = { promo: string; erro: string; em: string };
type Estado = { pendentes: Record<string, number>; erros: Record<string, Erro[]>; ultimos: Record<string, string> };

const estado: Estado = { pendentes: {}, erros: {}, ultimos: {} };
const fila: SaleJob[] = [];
const ouvintes = new Set<() => void>();
let rodando = false;

function avisar() { ouvintes.forEach(fn => { try { fn(); } catch { /* */ } }); }
export function assinarFila(fn: () => void) { ouvintes.add(fn); return () => { ouvintes.delete(fn); }; }
export function estadoFila(): Estado { return estado; }
export function limparErros(ref: string) { delete estado.erros[ref]; avisar(); }
export function jobNaFila(ref: string, promo_key: string) { return fila.some(j => j.ref === ref && j.promo_key === promo_key); }

function usuario() { try { return JSON.parse(localStorage.getItem('amica_session') || '{}')?.usuario || ''; } catch { return ''; } }

export function enfileirar(jobs: SaleJob[]) {
  for (const j of jobs) {
    if (jobNaFila(j.ref, j.promo_key)) continue;
    fila.push(j);
    estado.pendentes[j.ref] = (estado.pendentes[j.ref] || 0) + 1;
  }
  avisar();
  processar();
}

async function processar() {
  if (rodando) return;
  rodando = true;
  marcarOcupado('enviando promoções do Sale');
  try {
    while (fila.length) {
      const j = fila[0];
      let erro: string | null = null;
      try {
        const r = await fetch('/api/ml-sale', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-User': usuario() }, body: JSON.stringify({ acao: 'entrar', ...j }) });
        const d = await r.json().catch(() => ({}));
        if (d?.bloqueado) erro = d.erro || 'bloqueado pelo teto';
        else if (d?.expirado) erro = d.erro || 'convite expirado';
        else if (!d?.ok) {
          const falhas = (d?.resultados || []).filter((x: any) => !x.ok);
          erro = d?.erro || (falhas.length ? `${falhas.length} anúncio(s) recusado(s) pelo ML` : 'falha no envio');
        }
      } catch (e: any) { erro = 'sem conexão — tente de novo'; }
      if (erro) (estado.erros[j.ref] = estado.erros[j.ref] || []).push({ promo: j.promo_nome || j.tipo, erro, em: new Date().toISOString() });
      estado.pendentes[j.ref] = Math.max(0, (estado.pendentes[j.ref] || 1) - 1);
      if (!estado.pendentes[j.ref]) delete estado.pendentes[j.ref];
      estado.ultimos[j.ref] = new Date().toISOString();
      fila.shift();
      avisar();
    }
  } finally { rodando = false; liberarOcupado(); }
}
