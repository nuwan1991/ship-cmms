/** Matters (file threads): every letter, reply and minute sheet of one matter in date order (FR-K3). */
import { useState } from 'react';
import { api, type Rec } from '../../platform/api';
import { FormModal, type FieldDef } from '../../platform/form';
import { t } from '../../platform/i18n';
import { can } from '../../platform/permissions';
import { useSystem } from '../../platform/system';
import { ErrorNotice, Modal, StatusChip } from '../../platform/ui';
import { OFC, OfficePicker, show, useGet, useOffice, type Page } from './binding';
import { CorrespondenceDetail } from './CorrespondenceScreen';
import { RecordPanel } from './RecordPanel';

export function MattersScreen() {
  const { tz } = useSystem();
  const office = useOffice();
  const C = office.commandId;
  const list = useGet<Page>(C ? `${OFC}/matters` : null, { commandId: C });
  const units = useGet<Page>(C ? `${OFC}/units` : null, { commandId: C });
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<Rec | 'new' | null>(null);
  const fields: FieldDef[] = [
    { key: 'title', labelKey: 'ofc.field.title', type: 'text', required: true, maxLength: 160 },
    { key: 'fileRef', labelKey: 'ofc.field.fileRef', type: 'text', maxLength: 80 },
    { key: 'unitId', labelKey: 'ofc.field.unit', type: 'select', options: (units.data?.items ?? []).map((u) => ({ value: String(u.id), label: String(u.path) })) },
    { key: 'status', labelKey: 'ofc.field.status', type: 'select', options: ['open', 'closed'].map((s) => ({ value: s, label: t(`ofc.mstatus.${s}`) })), showWhen: () => editing !== 'new' },
    { key: 'remarks', labelKey: 'ofc.field.remarks', type: 'textarea', maxLength: 2000 },
    { key: 'reason', labelKey: 'ofc.field.correctionReason', type: 'text', maxLength: 500, showWhen: () => editing !== 'new', hintKey: 'ofc.hint.correction' },
  ];
  return (
    <section>
      <div className="page-head">
        <h1>{t('ofc.title.matters')}</h1>
        <div className="tools">
          <OfficePicker office={office} />
          {can('ofc.correspondence.create') && C ? <button className="primary" onClick={() => setEditing('new')}>{t('ofc.new.matter')}</button> : null}
        </div>
      </div>
      <ErrorNotice error={list.error} />
      <div className="table-wrap">
        <table>
          <thead><tr><th scope="col">{t('ofc.field.refNo')}</th><th scope="col">{t('ofc.field.title')}</th><th scope="col">{t('ofc.field.fileRef')}</th><th scope="col">{t('ofc.field.letters')}</th><th scope="col">{t('ofc.field.pendingReplies')}</th><th scope="col">{t('ofc.field.latest')}</th><th scope="col">{t('ofc.field.status')}</th></tr></thead>
          <tbody>
            {(list.data?.items ?? []).map((m) => (
              <tr key={m.id}>
                <td><button className="link" onClick={() => setOpen(m.id)}>{String(m.refNo)}</button></td><td>{String(m.title)}</td><td>{show(m.fileRef)}</td>
                <td>{String(m.letterCount)}</td><td>{Number(m.pendingCount) ? <span className="chip warn">{String(m.pendingCount)}</span> : '0'}</td><td>{show(m.latestDate)}</td>
                <td><StatusChip value={String(m.status)} labelPrefix="ofc.mstatus" /></td>
              </tr>
            ))}
            {!list.loading && C && (list.data?.items.length ?? 0) === 0 ? <tr><td colSpan={7} className="empty">{t('ofc.matters.empty')}</td></tr> : null}
          </tbody>
        </table>
      </div>
      {open ? <MatterDetail id={open} units={units.data?.items ?? []} matters={list.data?.items ?? []} onEdit={setEditing} onClose={() => setOpen(null)} /> : null}
      {editing ? (
        <FormModal title={editing === 'new' ? t('ofc.new.matter') : t('ofc.edit.record', { name: String(editing.refNo) })} fields={fields} record={editing === 'new' ? null : editing} tz={tz} onClose={() => setEditing(null)}
          onSubmit={async (body) => {
            if (editing === 'new') await api('POST', `${OFC}/matters`, { ...body, commandId: C });
            else await api('PATCH', `${OFC}/matters/${editing.id}`, body);
            list.reload();
          }} />
      ) : null}
    </section>
  );
}

function MatterDetail({ id, units, matters, onEdit, onClose }: { id: string; units: Rec[]; matters: Rec[]; onEdit(m: Rec): void; onClose(): void }) {
  const thread = useGet<{ matter: Rec; letters: Rec[] }>(`${OFC}/matters/${id}`);
  const [letter, setLetter] = useState<string | null>(null);
  const m = thread.data?.matter;
  return (
    <Modal title={m ? `${String(m.refNo)} – ${String(m.title)}` : t('common.loading')} onClose={onClose} wide>
      <ErrorNotice error={thread.error} />
      {m && can('ofc.correspondence.update') ? <div className="actions"><button onClick={() => { onClose(); onEdit(m); }}>{t('common.edit')}</button></div> : null}
      <ol className="timeline">
        {(thread.data?.letters ?? []).map((l) => (
          <li key={l.id}>
            <small className="muted">{show(l.letterDate ?? l.receivedDate ?? l.sentDate)} · {t(`ofc.kind.${String(l.kind)}`)} · {t(`ofc.cstatus.${String(l.status)}`)}</small>
            <div><button className="link" onClick={() => setLetter(l.id)}>{String(l.refNo)}</button> {show(l.officialRef)} – {String(l.subject)}</div>
          </li>
        ))}
        {thread.data && thread.data.letters.length === 0 ? <li className="muted">{t('ofc.matter.no_letters')}</li> : null}
      </ol>
      {m ? <RecordPanel type="ofc.matter" id={id} /> : null}
      {letter ? <CorrespondenceDetail id={letter} matters={matters} units={units} onOpen={setLetter} onClose={() => setLetter(null)} onChanged={thread.reload} onReply={() => setLetter(null)} /> : null}
    </Modal>
  );
}
