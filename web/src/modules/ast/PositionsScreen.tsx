import { useMemo, useState } from 'react';
import { api, type Rec } from '../../platform/api';
import { FormModal, type FieldDef } from '../../platform/form';
import { t } from '../../platform/i18n';
import { can } from '../../platform/permissions';
import { ReasonModal } from '../../platform/reason';
import { useSystem } from '../../platform/system';
import { toLocalDisplay } from '../../platform/time';
import { buildTree } from '../../platform/tree';
import { ErrorNotice, FreshnessBanner, Modal, StatusChip } from '../../platform/ui';
import { useList } from '../../platform/useList';
import { AST, ORG, optionLabel } from './binding';

const LEVELS = ['system', 'equipment_group', 'equipment', 'component'];

/** Who is responsible for a position over time, and a hand-over to another department. Separate from where it is and which command the ship is attached to. */
function ResponsibilityModal({ position, onClose }: { position: Rec; onClose(): void }) {
  const { tz } = useSystem();
  const history = useList(`${AST}/position-responsibilities`, { positionId: position.id });
  const depts = useList(`${ORG}/departments`);
  const [open, setOpen] = useState(false);
  const name = (id: unknown) => String(depts.items.find((d) => d.id === id)?.name ?? id);
  const fields: FieldDef[] = [
    { key: 'departmentId', labelKey: 'ast.field.department', type: 'select', required: true, options: depts.items.map((d) => ({ value: d.id, label: optionLabel(d) })) },
    { key: 'effectiveFrom', labelKey: 'ast.field.effectiveFrom', type: 'datetime', required: true },
    { key: 'reason', labelKey: 'ast.field.reason', type: 'textarea', maxLength: 500 },
  ];
  return (
    <Modal title={t('ast.resp.title', { name: String(position.name) })} onClose={onClose} wide>
      <ErrorNotice error={history.error} />
      <div className="table-wrap">
        <table>
          <thead><tr><th scope="col">{t('ast.field.department')}</th><th scope="col">{t('ast.field.effectiveFrom')}</th><th scope="col">{t('ast.field.effectiveTo')}</th><th scope="col">{t('ast.field.reason')}</th></tr></thead>
          <tbody>
            {[...history.items].sort((a, b) => String(b.effectiveFrom).localeCompare(String(a.effectiveFrom))).map((r) => (
              <tr key={r.id}>
                <td>{name(r.departmentId)}</td><td>{toLocalDisplay(String(r.effectiveFrom), tz)}</td>
                <td>{r.effectiveTo ? toLocalDisplay(String(r.effectiveTo), tz) : t('ast.resp.current')}</td><td>{String(r.reason ?? '')}</td>
              </tr>
            ))}
            {!history.loading && history.items.length === 0 ? <tr><td colSpan={4} className="empty">{t('ast.resp.none')}</td></tr> : null}
          </tbody>
        </table>
      </div>
      <footer>
        <button type="button" onClick={onClose}>{t('common.close')}</button>
        {can('ast.position_responsibility.create') && can('ast.position_responsibility.update') ? <button className="primary" onClick={() => setOpen(true)}>{t('ast.resp.handover')}</button> : null}
      </footer>
      {open ? (
        <FormModal
          title={t('ast.resp.handover')} fields={fields} record={null} tz={tz} submitKey="common.save" onClose={() => setOpen(false)}
          onSubmit={async (body) => { await api('POST', `${AST}/position-responsibilities/reassign`, { ...body, positionId: position.id }); history.reload(); }}
        />
      ) : null}
    </Modal>
  );
}

/** Functional tree of one ship: system → equipment group → equipment → component. Assets are installed into these positions (see the asset register). */
export function PositionsScreen() {
  const { tz } = useSystem();
  const ships = useList(`${ORG}/ships`);
  const [shipId, setShipId] = useState('');
  const list = useList(shipId ? `${AST}/positions` : null, { shipId: shipId || undefined, limit: '500' });
  const classes = useList(`${AST}/classifications`);
  const [editing, setEditing] = useState<{ rec: Rec | null; parentId?: string } | null>(null);
  const [removing, setRemoving] = useState<Rec | null>(null);
  const [responsibility, setResponsibility] = useState<Rec | null>(null);
  const rows = useMemo(() => buildTree(list.items), [list.items]);
  const mayWrite = can('ast.position.create');

  const fields = (rec: Rec | null): FieldDef[] => {
    return [
      { key: 'positionTag', labelKey: 'ast.field.positionTag', type: 'text', required: true, maxLength: 40, hintKey: 'ast.hint.positionTag' },
      { key: 'name', labelKey: 'ast.field.name', type: 'text', required: true, maxLength: 120 },
      { key: 'classificationId', labelKey: 'ast.field.classification', type: 'select', options: classes.items.map((c) => ({ value: c.id, label: optionLabel(c) })) },
      { key: 'sortOrder', labelKey: 'ast.field.sortOrder', type: 'number' },
      ...(rec ? [{ key: 'status', labelKey: 'ast.field.status', type: 'select', options: [{ value: 'active', label: t('status.active') }, { value: 'inactive', label: t('status.inactive') }] } as FieldDef] : []),
    ];
  };
  const label = (r: Rec) => `${String(r.positionTag)} – ${String(r.name)}`;

  return (
    <section>
      <div className="page-head">
        <h1>{t('ast.title.positions')}</h1>
        <div className="tools">
          <label className="inline">
            {t('ast.field.ship')}
            <select value={shipId} onChange={(e) => setShipId(e.target.value)}>
              <option value="">{t('common.choose')}</option>
              {ships.items.map((s) => <option key={s.id} value={s.id}>{optionLabel(s)}</option>)}
            </select>
          </label>
          {shipId && mayWrite ? <button className="primary" onClick={() => setEditing({ rec: null })}>{t('ast.new.position')}</button> : null}
        </div>
      </div>
      {shipId ? <FreshnessBanner freshness={list.freshness} /> : <p className="help">{t('ast.pos.choose_ship')}</p>}
      <ErrorNotice error={list.error} />
      {shipId ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">{t('ast.field.name')}</th><th scope="col">{t('ast.field.positionTag')}</th><th scope="col">{t('ast.field.level')}</th>
                <th scope="col">{t('ast.field.status')}</th><th scope="col" className="actions-col">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ rec, depth }) => (
                <tr key={rec.id}>
                  <td><span className="indent" style={{ paddingLeft: `${depth * 1.25}rem` }}>{String(rec.name)}</span></td>
                  <td>{String(rec.positionTag)}</td>
                  <td>{t(`ast.level.${String(rec.level)}`)}</td>
                  <td><StatusChip value={String(rec.status)} labelPrefix="status" /></td>
                  <td className="actions">
                    {mayWrite && rec.level !== LEVELS[3] ? <button onClick={() => setEditing({ rec: null, parentId: rec.id })}>{t('ast.pos.add_child')}</button> : null}
                    {can('ast.position_responsibility.view') ? <button onClick={() => setResponsibility(rec)}>{t('ast.resp.action')}</button> : null}
                    {can('ast.position.update') ? <button onClick={() => setEditing({ rec })}>{t('common.edit')}</button> : null}
                    {can('ast.position.remove') ? <button className="link-danger" onClick={() => setRemoving(rec)}>{t('common.remove')}</button> : null}
                  </td>
                </tr>
              ))}
              {!list.loading && rows.length === 0 ? <tr><td colSpan={5} className="empty">{t('ast.pos.empty')}</td></tr> : null}
            </tbody>
          </table>
        </div>
      ) : null}

      {editing && shipId ? (
        <FormModal
          title={editing.rec ? t('ast.edit.record', { name: label(editing.rec) }) : t('ast.new.position')}
          fields={fields(editing.rec)} record={editing.rec} tz={tz}
          defaults={{ status: 'active', ...(editing.parentId ? { parentId: editing.parentId } : {}) }}
          submitKey={editing.rec ? 'common.save' : 'common.create'}
          onClose={() => setEditing(null)}
          onFetchLatest={editing.rec ? () => api<Rec>('GET', `${AST}/positions/${editing.rec?.id}`) : undefined}
          onSubmit={async (body) => {
            if (editing.rec) await api('PATCH', `${AST}/positions/${editing.rec.id}`, body);
            else await api('POST', `${AST}/positions`, { ...body, shipId, ...(editing.parentId ? { parentId: editing.parentId } : {}) });
            list.reload();
          }}
        />
      ) : null}
      {removing ? (
        <ReasonModal
          title={t('ast.remove.record', { name: label(removing) })} onClose={() => setRemoving(null)}
          onConfirm={async (reason) => { await api('POST', `${AST}/positions/${removing.id}/tombstone`, { expectedVersion: removing.version, reason }); list.reload(); }}
        />
      ) : null}
      {responsibility ? <ResponsibilityModal position={responsibility} onClose={() => setResponsibility(null)} /> : null}
    </section>
  );
}
