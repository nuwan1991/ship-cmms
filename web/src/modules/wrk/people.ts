import { useList } from '../../platform/useList';

const DIRECTORY = '/api/v1/identity/users/directory';

/** Active users to pick as requested by, supervisor or crew. Labels show rank and service number to tell people apart. */
export function usePeople() {
  const list = useList(DIRECTORY, { limit: '5000' });
  const label = (r: Record<string, unknown>) =>
    `${r.rank ? `${String(r.rank)} ` : ''}${String(r.displayName)}${r.serviceNumber ? ` (${String(r.serviceNumber)})` : ''}`;
  const options = list.items.map((r) => ({ value: String(r.id), label: label(r) }));
  const name = (id: unknown): string => {
    if (!id) return '—';
    const r = list.items.find((u) => u.id === id);
    return r ? label(r) : String(id);
  };
  return { options, name, error: list.error };
}
