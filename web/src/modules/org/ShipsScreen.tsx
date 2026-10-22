import { useState } from 'react';
import { api, type Rec } from '../../platform/api';
import { FormModal, type FieldDef } from '../../platform/form';
import { t } from '../../platform/i18n';
import { can } from '../../platform/permissions';
import { ReasonModal } from '../../platform/reason';
import { useSystem } from '../../platform/system';
import { toLocalDisplay, utcIsoToLocalInput } from '../../platform/time';
import { ErrorNotice, Modal } from '../../platform/ui';
import { useList } from '../../platform/useList';
import { ORG, ResourceScreen, useRefOptions, type RefDef } from './ResourceScreen';
import { shipConfig } from './resources';

const COMMAND_REF: Record<string, RefDef> = {
  commands: { collection: 'commands', label: (r) => `${String(r.code)} – ${String(r.name)}`, filter: (r) => r.status === 'active' },
};

/** Ships plus the command-attachment actions: assign/reassign (dated) and history/correction. */
export function ShipsScreen() {
  const { info, tz } = useSystem();
  const refs = useRefOptions(COMMAND_REF);
  const [assigning, setAssigning] = useState<{ ship: Rec; reload(): void } | null>(null);
  const [history, setHistory] = useState<Rec | null>(null);
  const hub = info?.installation?.kind === 'hub';
  const canAssign = hub && can('org.ship_command_assignment.create') && can('org.ship_command_assignment.update');

  const assignFields: FieldDef[] = [
    { key: 'commandId', labelKey: 'org.field.commandId', type: 'select', required: true, options: refs.commands ?? [] },
    { key: 'effectiveFrom', labelKey: 'org.field.effectiveFrom', type: 'datetime', required: true, hintKey: 'org.hint.effective_from' },
    { key: 'reason', labelKey: 'org.field.reason', type: 'textarea', maxLength: 500 },
  ];

  return (
    <>
      <ResourceScreen
        config={shipConfig}
        rowActions={(row, reload) => (
          <>
            {canAssign ? <button onClick={() => setAssigning({ ship: row, reload })}>{t('org.ship.assign')}</button> : null}
            <button onClick={() => setHistory(row)}>{t('org.ship.history')}</button>
          </>
        )}
      />
      {assigning ? (
        <FormModal
          title={t('org.ship.assign_title', { name: String(assigning.ship.name) })}
          fields={assignFields}
          record={null}
          tz={tz}
          defaults={{ effectiveFrom: utcIsoToLocalInput(new Date().toISOString(), tz) }}
          submitKey="org.ship.assign_submit"
          extra={<p className="help">{t('org.ship.assign_help')}</p>}
          onClose={() => setAssigning(null)}
          onSubmit={async (body) => {
            await api('POST', `${ORG}/ships/${assigning.ship.id}/reassign`, body);
            assigning.reload();
          }}
        />
      ) : null}
      {history ? <HistoryModal ship={history} onClose={() => setHistory(null)} /> : null}
    </>
  );
}

function HistoryModal({ ship, onClose }: { ship: Rec; onClose(): void }) {
  const { info, tz } = useSystem();
  const list = useList(`${ORG}/ship-command-assignments`, { shipId: ship.id });
  const commands = useList(`${ORG}/commands`);
  const refs = useRefOptions({ commands: { collection: 'commands', label: (r) => `${String(r.code)} – ${String(r.name)}` } });
  const [correcting, setCorrecting] = useState<Rec | null>(null);
  const [removing, setRemoving] = useState<Rec | null>(null);
  const hub = info?.installation?.kind === 'hub';
  const nameOf = (id: unknown) => commands.items.find((c) => c.id === id)?.name as string | undefined;
  const now = new Date().toISOString();
  const rows = [...list.items].sort((a, b) => String(b.effectiveFrom).localeCompare(String(a.effectiveFrom)));

  const fields: FieldDef[] = [
    { key: 'commandId', labelKey: 'org.field.commandId', type: 'select', required: true, options: refs.commands ?? [] },
    { key: 'effectiveFrom', labelKey: 'org.field.effectiveFrom', type: 'datetime', required: true, hintKey: 'org.hint.effective_from' },
    { key: 'effectiveTo', labelKey: 'org.field.effectiveTo', type: 'datetime', hintKey: 'org.hint.effective_to' },
    { key: 'reason', labelKey: 'org.field.reason', type: 'textarea', maxLength: 500 },
  ];

  return (
    <Modal title={t('org.ship.history_title', { name: String(ship.name) })} onClose={onClose} wide>
      <ErrorNotice error={list.error} />
      {rows.length === 0 && !list.loading ? <p>{t('org.ship.history_empty')}</p> : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">{t('org.field.commandId')}</th>
                <th scope="col">{t('org.field.effectiveFrom')}</th>
                <th scope="col">{t('org.field.effectiveTo')}</th>
                <th scope="col">{t('org.field.reason')}</th>
                <th scope="col" className="actions-col">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isCurrent = String(r.effectiveFrom) <= now && (!r.effectiveTo || String(r.effectiveTo) > now);
                return (
                  <tr key={r.id}>
                    <td>{nameOf(r.commandId) ?? '—'} {isCurrent ? <span className="chip ok">{t('org.ship.current')}</span> : null}</td>
                    <td>{toLocalDisplay(String(r.effectiveFrom), tz)}</td>
                    <td>{r.effectiveTo ? toLocalDisplay(String(r.effectiveTo), tz) : ''}</td>
                    <td>{String(r.reason ?? '')}</td>
                    <td className="actions">
                      {hub && can('org.ship_command_assignment.update') ? <button onClick={() => setCorrecting(r)}>{t('org.ship.correct')}</button> : null}
                      {hub && can('org.ship_command_assignment.remove') ? <button className="link-danger" onClick={() => setRemoving(r)}>{t('common.remove')}</button> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {correcting ? (
        <FormModal
          title={t('org.ship.correct_title')}
          fields={fields}
          record={correcting}
          tz={tz}
          onClose={() => setCorrecting(null)}
          onFetchLatest={() => api<Rec>('GET', `${ORG}/ship-command-assignments/${correcting.id}`)}
          onSubmit={async (body) => {
            await api('PATCH', `${ORG}/ship-command-assignments/${correcting.id}`, body);
            list.reload();
          }}
        />
      ) : null}
      {removing ? (
        <ReasonModal
          title={t('org.remove.record', { name: nameOf(removing.commandId) ?? '' })}
          onClose={() => setRemoving(null)}
          onConfirm={async (reason) => {
            await api('POST', `${ORG}/ship-command-assignments/${removing.id}/tombstone`, { expectedVersion: removing.version, reason });
            list.reload();
          }}
        />
      ) : null}
    </Modal>
  );
}
