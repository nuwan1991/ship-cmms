import { useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, type Rec } from './api';
import { t } from './i18n';
import { ConflictDialog, ErrorNotice, Modal } from './ui';
import { localInputToUtcIso, utcIsoToLocalInput } from './time';

export interface FieldDef {
  key: string;
  labelKey: string;
  type: 'text' | 'number' | 'select' | 'checkbox' | 'datetime' | 'textarea';
  required?: boolean;
  /** Static options, or resolved at render time (e.g. from a loaded list). */
  options?: Array<{ value: string; label: string }> | ((values: Values) => Array<{ value: string; label: string }>);
  /** Only on create (identity-defining fields). */
  createOnly?: boolean;
  showWhen?: (values: Values) => boolean;
  hintKey?: string;
  maxLength?: number;
}
export type Values = Record<string, string | boolean>;

/** Record → form values (everything is a string/boolean in the form; dates become display-zone local input values). */
export function toFormValues(fields: readonly FieldDef[], rec: Partial<Rec> | null, tz: string, defaults: Values = {}): Values {
  const out: Values = {};
  for (const f of fields) {
    const raw = rec?.[f.key];
    if (f.type === 'checkbox') out[f.key] = raw === undefined ? ((defaults[f.key] as boolean | undefined) ?? false) : Boolean(raw);
    else if (f.type === 'datetime') out[f.key] = raw ? utcIsoToLocalInput(String(raw), tz) : ((defaults[f.key] as string | undefined) ?? '');
    else out[f.key] = raw === undefined || raw === null ? ((defaults[f.key] as string | undefined) ?? '') : String(raw);
  }
  return out;
}

/**
 * Form values → API payload. On create empty optional fields are omitted; on update they become null so a value can be cleared.
 * Hidden (showWhen=false) fields are sent as null on update when the stored value is non-empty, so e.g. changing a
 * workshop from "command" to "specialist" clears its command.
 */
export function toPayload(fields: readonly FieldDef[], values: Values, original: Partial<Rec> | null, tz: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const editing = original !== null;
  for (const f of fields) {
    if (editing && f.createOnly) continue;
    const shown = f.showWhen ? f.showWhen(values) : true;
    const v = values[f.key];
    if (!shown) {
      if (editing && original?.[f.key] != null) out[f.key] = null;
      continue;
    }
    if (f.type === 'checkbox') out[f.key] = Boolean(v);
    else if (v === '' || v === undefined) {
      if (editing && original?.[f.key] != null) out[f.key] = null;
    } else if (f.type === 'number') out[f.key] = Number(v);
    else if (f.type === 'datetime') out[f.key] = localInputToUtcIso(String(v), tz);
    else out[f.key] = typeof v === 'string' ? v.trim() : v;
  }
  return out;
}

export function FormModal(props: {
  title: string;
  fields: readonly FieldDef[];
  /** Record being edited (null = create). */
  record: Rec | null;
  tz: string;
  defaults?: Values;
  submitKey?: string;
  extra?: ReactNode;
  /** Receives the payload (including expectedVersion when editing). */
  onSubmit(payload: Record<string, unknown>): Promise<void>;
  /** Fetch the latest copy of the record (used by the conflict dialog). */
  onFetchLatest?: () => Promise<Rec>;
  onClose(): void;
}) {
  const { fields, record, tz } = props;
  const [values, setValues] = useState<Values>(() => toFormValues(fields, record, tz, props.defaults));
  const [version, setVersion] = useState(record?.version ?? 0);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [conflict, setConflict] = useState<number | undefined | false>(false);
  const [busy, setBusy] = useState(false);

  const set = (k: string, v: string | boolean) => setValues((p) => ({ ...p, [k]: v }));

  async function submit(e?: FormEvent, forceVersion?: number) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = toPayload(fields, values, record, tz);
      for (const f of fields) if (f.type === 'datetime' && body[f.key] === null && values[f.key]) throw new Error(t('error.bad_datetime'));
      if (record) body.expectedVersion = forceVersion ?? version;
      await props.onSubmit(body);
      props.onClose();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'VERSION_CONFLICT') setConflict(err.currentVersion);
      else setError(err as Error);
    } finally {
      setBusy(false);
    }
  }

  async function reloadLatest() {
    if (!props.onFetchLatest) return;
    try {
      const latest = await props.onFetchLatest();
      setValues(toFormValues(fields, latest, tz, props.defaults));
      setVersion(latest.version);
      setConflict(false);
    } catch (err) {
      setConflict(false);
      setError(err as Error);
    }
  }

  return (
    <Modal title={props.title} onClose={props.onClose}>
      <form onSubmit={(e) => void submit(e)}>
        {props.extra}
        {fields.map((f) => {
          if (f.createOnly && record) return null;
          if (f.showWhen && !f.showWhen(values)) return null;
          const id = `f-${f.key}`;
          const v = values[f.key];
          const label = (
            <label htmlFor={id}>
              {t(f.labelKey)}
              {f.required ? <span aria-hidden> *</span> : null}
            </label>
          );
          const opts = typeof f.options === 'function' ? f.options(values) : f.options;
          return (
            <div className="field" key={f.key}>
              {f.type === 'checkbox' ? (
                <label className="check">
                  <input id={id} type="checkbox" checked={Boolean(v)} onChange={(e) => set(f.key, e.target.checked)} /> {t(f.labelKey)}
                </label>
              ) : (
                label
              )}
              {f.type === 'select' ? (
                <select id={id} value={String(v)} required={f.required} onChange={(e) => set(f.key, e.target.value)}>
                  <option value="">{t('common.choose')}</option>
                  {(opts ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : f.type === 'textarea' ? (
                <textarea id={id} value={String(v)} maxLength={f.maxLength} onChange={(e) => set(f.key, e.target.value)} />
              ) : f.type === 'checkbox' ? null : (
                <input
                  id={id}
                  type={f.type === 'datetime' ? 'datetime-local' : f.type}
                  value={String(v)}
                  required={f.required}
                  maxLength={f.maxLength}
                  {...(f.type === 'number' ? { min: 0, step: 1 } : {})}
                  onChange={(e) => set(f.key, e.target.value)}
                />
              )}
              {f.hintKey ? <small>{t(f.hintKey)}</small> : null}
            </div>
          );
        })}
        <ErrorNotice error={error} />
        <footer>
          <button type="button" onClick={props.onClose}>{t('common.cancel')}</button>
          <button type="submit" className="primary" disabled={busy}>{t(props.submitKey ?? 'common.save')}</button>
        </footer>
      </form>
      {conflict !== false ? (
        <ConflictDialog currentVersion={conflict} onCancel={() => setConflict(false)} onReload={() => void reloadLatest()} onOverwrite={() => { const v = conflict; setConflict(false); void submit(undefined, v); }} />
      ) : null}
    </Modal>
  );
}
