import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api, type ApiError, type Rec } from '../../platform/api';
import { t } from '../../platform/i18n';
import { can, permissionMatches } from '../../platform/permissions';
import { ErrorNotice, Modal } from '../../platform/ui';
import { IDN, IdnResourceScreen } from './binding';
import { roleConfig } from './resources';

/** Permission catalogue grouped by module prefix. A role may hold `*`, `<prefix>.*` or exact codes. */
function RolePermissionsModal({ role, onClose }: { role: Rec; onClose(): void }) {
  const [catalogue, setCatalogue] = useState<string[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [busy, setBusy] = useState(false);
  const editable = can('idn.role_permission.update');

  useEffect(() => {
    Promise.all([
      api<{ permissions: string[] }>('GET', `${IDN}/permissions`),
      api<{ items: Rec[] }>('GET', `${IDN}/role-permissions?roleId=${String(role.id)}&limit=500`),
    ]).then(
      ([c, rp]) => { setCatalogue(c.permissions); setChosen(new Set(rp.items.map((i) => String(i.permission)))); },
      (e: Error) => setError(e),
    );
  }, [role.id]);

  const groups = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const c of catalogue ?? []) m.set(c.split('.')[0]!, [...(m.get(c.split('.')[0]!) ?? []), c]);
    return [...m.entries()];
  }, [catalogue]);

  const toggle = (code: string, on: boolean) => setChosen((p) => { const n = new Set(p); if (on) n.add(code); else n.delete(code); return n; });
  const covered = (code: string) => [...chosen].some((g) => g !== code && permissionMatches(g, code));

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('PUT', `${IDN}/roles/${String(role.id)}/permissions`, { permissions: [...chosen] });
      onClose();
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={t('idn.perm.title', { name: String(role.name) })} onClose={onClose} wide>
      <form onSubmit={(e) => void save(e)}>
        {catalogue === null && !error ? <p>{t('common.loading')}</p> : null}
        <label className="check">
          <input type="checkbox" disabled={!editable} checked={chosen.has('*')} onChange={(e) => toggle('*', e.target.checked)} /> {t('idn.perm.everything')}
        </label>
        {groups.map(([prefix, codes]) => (
          <fieldset key={prefix}>
            <legend>{t(`nav.group.${prefix}`) === `nav.group.${prefix}` ? prefix : t(`nav.group.${prefix}`)}</legend>
            <label className="check">
              <input type="checkbox" disabled={!editable || chosen.has('*')} checked={chosen.has(`${prefix}.*`)} onChange={(e) => toggle(`${prefix}.*`, e.target.checked)} /> {t('idn.perm.all_in', { prefix })}
            </label>
            <div className="perm-grid">
              {codes.map((c) => (
                <label key={c} className="check">
                  <input type="checkbox" disabled={!editable || covered(c)} checked={chosen.has(c) || covered(c)} onChange={(e) => toggle(c, e.target.checked)} /> {c}
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        <ErrorNotice error={error} />
        <footer>
          <button type="button" onClick={onClose}>{t('common.cancel')}</button>
          {editable ? <button type="submit" className="primary" disabled={busy || catalogue === null}>{t('common.save')}</button> : null}
        </footer>
      </form>
    </Modal>
  );
}

export function RolesScreen() {
  const [role, setRole] = useState<Rec | null>(null);
  return (
    <>
      <IdnResourceScreen config={roleConfig} rowActions={(row) => (can('idn.role_permission.view') ? <button onClick={() => setRole(row)}>{t('idn.perm.action')}</button> : null)} />
      {role ? <RolePermissionsModal role={role} onClose={() => setRole(null)} /> : null}
    </>
  );
}
