// Componente unificado dos icones do modulo SAC.
// Cada icone e um <img> apontando pro PNG em /public/sac-icons/.
//
// Os PNGs foram cortados de uma imagem master com auto-detect (bounding box)
// e padronizados em canvas 256x256 com padding ~14% pra ter mesmo tamanho
// visual. Ver preview-icones-sac-final.html pro contexto.
//
// Uso:
//   import { SacIcon } from './SacIcons';
//   <SacIcon name="urgente" size={22} />
//
// 16 icones disponiveis: urgente, atencao, online, resolvido, sync, estoque,
// pendentes, rapidas, dashboard, config, perguntas, posvenda, relogio,
// sugestao_ia, usuario, observacao.

import React from 'react';

const ICON_PATHS = {
  urgente: '/sac-icons/urgente.png',
  atencao: '/sac-icons/atencao.png',
  online: '/sac-icons/online.png',
  resolvido: '/sac-icons/resolvido.png',
  sync: '/sac-icons/sync.png',
  estoque: '/sac-icons/estoque.png',
  pendentes: '/sac-icons/pendentes.png',
  rapidas: '/sac-icons/rapidas.png',
  dashboard: '/sac-icons/dashboard.png',
  config: '/sac-icons/config.png',
  perguntas: '/sac-icons/perguntas.png',
  posvenda: '/sac-icons/posvenda.png',
  relogio: '/sac-icons/relogio.png',
  sugestao_ia: '/sac-icons/sugestao_ia.png',
  usuario: '/sac-icons/usuario.png',
  observacao: '/sac-icons/observacao.png',
  // Novos (tela Config) - 26/04
  saude: '/sac-icons/saude.png',
  contas: '/sac-icons/contas.png',
  livros: '/sac-icons/livros.png',
  lua: '/sac-icons/lua.png',
  sino: '/sac-icons/sino.png',
  disquete: '/sac-icons/disquete.png',
  // Novos (templates, locks, avatar loja) - 26/04 tarde
  normal: '/sac-icons/normal.png',
  cadeado: '/sac-icons/cadeado.png',
  saudacao: '/sac-icons/saudacao.png',
  despedida: '/sac-icons/despedida.png',
  usuario_falando: '/sac-icons/usuario_falando.png',
  // Novos (Dashboard SAC) - 26/04 noite
  carrinho: '/sac-icons/carrinho.png',
  saco_dinheiro: '/sac-icons/saco_dinheiro.png',
  envelope: '/sac-icons/envelope.png',
};

export function SacIcon({ name, size = 16, style = {} }) {
  const src = ICON_PATHS[name];
  if (!src) return null;
  // Scale 1.2x aplicado em TODOS os icones SAC (aprovado pelo Ailson 26/04).
  // Renderiza o <img> 20% maior que o size pedido, com margin negativo
  // proporcional pra encaixar no slot original sem afetar layout dos vizinhos.
  const renderSize = Math.round(size * 1.2);
  const overhang = Math.round((renderSize - size) / 2);
  return (
    <img
      src={src}
      alt={name}
      width={renderSize}
      height={renderSize}
      style={{
        display: 'inline-block',
        verticalAlign: 'middle',
        objectFit: 'contain',
        flexShrink: 0,
        margin: `${-overhang}px`,
        ...style,
      }}
    />
  );
}

export default SacIcon;
