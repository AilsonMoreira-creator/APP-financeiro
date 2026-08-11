/**
 * meluni-clientes-envio.js — ALIAS do meluni-clientes-novidade-disparo
 * (Ailson 11/08/2026). O path original termina em "-disparo" e NUNCA registra
 * um hit vindo dos aparelhos dele (desktop E celular), enquanto todos os
 * outros endpoints do app funcionam — cheiro forte de filtro de conteúdo /
 * adblock / DNS bloqueando a URL pelo padrão. Mesmo handler, nome neutro.
 */
export { default } from './meluni-clientes-novidade-disparo.js';
export const config = { maxDuration: 300 };
