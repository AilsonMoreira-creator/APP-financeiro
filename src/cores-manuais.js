// Cores manuais (fora do ranking Bling), salvas no servidor e compartilhadas
// entre Oficina/Cortes e Sala de Cortes. Ailson 04/06/2026.

const URL = '/api/cortes-cores-manuais';

export async function listarCoresManuais() {
  try {
    const r = await fetch(URL);
    const j = await r.json();
    return Array.isArray(j.cores) ? j.cores : [];
  } catch {
    return [];
  }
}

export async function adicionarCorManual(nome, hex) {
  const r = await fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nome, hex: hex || '#888888' }),
  });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.error || 'erro ao salvar cor');
  return Array.isArray(j.cores) ? j.cores : [];
}

export async function removerCorManual(nome) {
  const r = await fetch(URL + '?nome=' + encodeURIComponent(nome), {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nome }),
  });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.error || 'erro ao remover cor');
  return Array.isArray(j.cores) ? j.cores : [];
}
