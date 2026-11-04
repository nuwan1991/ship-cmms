import { useMemo, useState } from 'react';
import { api, type Rec } from '../../platform/api';
import { categoryStyle } from '../../platform/colors';
import { FormModal, type FieldDef, type Values } from '../../platform/form';
import { t } from '../../platform/i18n';
import { can } from '../../platform/permissions';
import { ReasonModal } from '../../platform/reason';
import { useSystem } from '../../platform/system';
import { toLocalDisplay } from '../../platform/time';
import { ErrorNotice, FreshnessBanner, StatusChip } from '../../platform/ui';
import { useList } from '../../platform/useList';
import { normalizeTag } from './actions';
import { AST, ORG, WRK } from './binding';

const SEVERITIES = ['minor', 'major', 'critical'];

/** Live categories, split into main categories and subcategories by parent (D67). */
export function useCategories() {
  const list = useList(`${WRK}/defect-categories`, { limit: '500' });
  return useMemo(() => {
    const live = list.items.filter((c) => c.status !== 'inactive');
    const byId = new Map(list.items.map((c) => [c.id, c]));
    const mains = live.filter((c) => !c.parentId).sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder) || String(a.code).localeCompare(String(b.code)));
    const subsOf = (mainId: string) => live.filter((c) => c.parentId === mainId).sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder) || String(a.name).localeCompare(String(b.name)));
    return { all: list.items, byId, mains, subsOf, loaded: !list.loading };
  }, [list.items, list.loading]);
}

/** Coloured badge for a defect's main category (green Electrical, maroon Marine Engineering, light grey Weapon ...), with the subcategory under it. */
export function CategoryBadge({ main, sub }: { main: Rec | undefined; sub?: Rec | undefined }) {
  return (
    <>
      <span className="cat" style={categoryStyle(main ? String(main.color ?? '') || null : null)}>{main ? String(main.name) : t('wrk.category.none')}</span>
      {sub ? <span className="cat-sub">{String(sub.name)}</span> : null}
    </>
  );
}

/** Defects: something wrong, reported against a ship, a position or a piece of equipment. Triage turns a defect into a repair case, or dismisses it with a reason. */
export function DefectsScreen() {
  const { tz } = useSystem();
  const ships = useList(`${ORG}/ships`);
  const cats = useCategories();
  const [shipId, setShipId] = useState('');
  const [status, setStatus] = useState('open');
  const [categoryId, setCategoryId] = useState('');
  const [subcategoryId, setSubcategoryId] = useState('');
  const [q, setQ] = useState('');
  const list = useList(`${WRK}/defects`, { shipId: shipId || undefined, status: status || undefined, q: q || undefined, categoryId: categoryId || undefined, subcategoryId: subcategoryId || undefined });
  const [reporting, setReporting] = useState(false);
  const [categorising, setCategorising] = useState<Rec | null>(null);
  const [converting, setConverting] = useState<Rec | null>(null);
  const [dismissing, setDismissing] = useState<Rec | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const shipName = (id: unknown) => String(ships.items.find((s) => s.id === id)?.name ?? id ?? '');
  const hasCategories = cats.mains.length > 0;

  const mainOptions = cats.mains.map((m) => ({ value: m.id, label: String(m.name) }));
  const subOptions = (v: Values) => (v.categoryId ? cats.subsOf(String(v.categoryId)).map((s) => ({ value: s.id, label: String(s.name) })) : []);
  const categoryFields = (suggest: boolean): FieldDef[] => [
    { key: 'categoryId', labelKey: 'wrk.field.category', type: 'select', required: hasCategories && !suggest, options: mainOptions, hintKey: suggest ? 'wrk.hint.category_suggest' : 'wrk.hint.category' },
    { key: 'subcategoryId', labelKey: 'wrk.field.subcategory', type: 'select', options: subOptions, showWhen: (v) => Boolean(v.categoryId) },
  ];

  /** A subcategory left over from a previously chosen main category is dropped rather than sent (the server would refuse the mismatch). */
  const tidy = (body: Record<string, unknown>): Record<string, unknown> => {
    const sub = body.subcategoryId ? cats.byId.get(String(body.subcategoryId)) : undefined;
    return sub && body.categoryId && sub.parentId !== body.categoryId ? { ...body, subcategoryId: null } : body;
  };

  const fields: FieldDef[] = [
    { key: 'title', labelKey: 'wrk.field.title', type: 'text', required: true, maxLength: 160 },
    { key: 'shipId', labelKey: 'wrk.field.ship', type: 'select', hintKey: 'wrk.hint.defect_target', options: ships.items.map((s) => ({ value: String(s.id), label: `${String(s.code)} – ${String(s.name)}` })) },
    { key: 'assetTag', labelKey: 'wrk.field.assetTag', type: 'text', maxLength: 40, hintKey: 'wrk.hint.asset_tag' },
    ...(hasCategories ? categoryFields(true) : []),
    { key: 'severity', labelKey: 'wrk.field.severity', type: 'select', options: SEVERITIES.map((s) => ({ value: s, label: t(`wrk.severity.${s}`) })) },
    { key: 'description', labelKey: 'wrk.field.description', type: 'textarea', maxLength: 2000 },
  ];

  return (
    <section>
      <div className="page-head">
        <h1>{t('wrk.title.defects')}</h1>
        <div className="tools">
          <input type="search" aria-label={t('common.search')} placeholder={t('wrk.search')} value={q} onChange={(e) => setQ(e.target.value)} />
          <select aria-label={t('wrk.field.ship')} value={shipId} onChange={(e) => setShipId(e.target.value)}>
            <option value="">{t('wrk.filter.all_ships')}</option>
            {ships.items.map((s) => <option key={s.id} value={s.id}>{String(s.name)}</option>)}
          </select>
          <select aria-label={t('wrk.field.category')} value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setSubcategoryId(''); }}>
            <option value="">{t('wrk.filter.any_category')}</option>
            {cats.mains.map((m) => <option key={m.id} value={m.id}>{String(m.name)}</option>)}
          </select>
          {categoryId ? (
            <select aria-label={t('wrk.field.subcategory')} value={subcategoryId} onChange={(e) => setSubcategoryId(e.target.value)}>
              <option value="">{t('wrk.filter.any_subcategory')}</option>
              {cats.subsOf(categoryId).map((s) => <option key={s.id} value={s.id}>{String(s.name)}</option>)}
            </select>
          ) : null}
          <select aria-label={t('wrk.field.status')} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t('wrk.filter.any_status')}</option>
            {['open', 'converted', 'dismissed'].map((s) => <option key={s} value={s}>{t(`wrk.dstatus.${s}`)}</option>)}
          </select>
          {can('wrk.defect.create') ? <button className="primary" onClick={() => setReporting(true)}>{t('wrk.new.defect')}</button> : null}
        </div>
      </div>
      <FreshnessBanner freshness={list.freshness} />
      <ErrorNotice error={list.error ?? error} />
      <div className="table-wrap">
        <table>
          <thead><tr>
            <th scope="col">{t('wrk.field.number')}</th><th scope="col">{t('wrk.field.title')}</th><th scope="col">{t('wrk.field.ship')}</th><th scope="col">{t('wrk.field.category')}</th>
            <th scope="col">{t('wrk.field.severity')}</th><th scope="col">{t('wrk.field.reportedAt')}</th><th scope="col">{t('wrk.field.status')}</th><th scope="col" className="actions-col">{t('common.actions')}</th>
          </tr></thead>
          <tbody>
            {list.items.map((r) => (
              <tr key={r.id}>
                <td>{String(r.defectNo)}</td><td>{String(r.title)}</td><td>{shipName(r.homeScopeId)}</td>
                <td><CategoryBadge main={r.categoryId ? cats.byId.get(String(r.categoryId)) : undefined} sub={r.subcategoryId ? cats.byId.get(String(r.subcategoryId)) : undefined} /></td>
                <td><StatusChip value={String(r.severity)} labelPrefix="wrk.severity" /></td>
                <td>{toLocalDisplay(String(r.reportedAt), tz)}</td>
                <td><StatusChip value={String(r.status)} labelPrefix="wrk.dstatus" /></td>
                <td className="actions">
                  {hasCategories && can('wrk.defect.update') ? <button onClick={() => setCategorising(r)}>{t('wrk.defect.categorise')}</button> : null}
                  {r.status === 'open' && can('wrk.defect.convert') ? <button onClick={() => setConverting(r)}>{t('wrk.defect.convert')}</button> : null}
                  {r.status === 'open' && can('wrk.defect.dismiss') ? <button className="link-danger" onClick={() => setDismissing(r)}>{t('wrk.defect.dismiss')}</button> : null}
                </td>
              </tr>
            ))}
            {!list.loading && list.items.length === 0 ? <tr><td colSpan={8} className="empty">{t('wrk.defects.empty')}</td></tr> : null}
          </tbody>
        </table>
      </div>
      {list.hasMore ? <button onClick={list.loadMore}>{t('common.more')}</button> : null}

      {reporting ? (
        <FormModal title={t('wrk.new.defect')} fields={fields} record={null} tz={tz} defaults={{ severity: 'minor' }} submitKey="common.create" onClose={() => setReporting(false)}
          onSubmit={async (body) => {
            const { assetTag, ...rest } = body;
            const payload: Record<string, unknown> = tidy(rest);
            if (assetTag) {
              const a = await api<Rec>('GET', `${AST}/assets/resolve?tag=${encodeURIComponent(normalizeTag(String(assetTag)))}`);
              payload.assetId = a.id;
            }
            await api('POST', `${WRK}/defects`, payload);
            list.reload();
          }} />
      ) : null}
      {categorising ? (
        <FormModal title={t('wrk.defect.categorise_title', { name: String(categorising.defectNo) })} fields={categoryFields(false)} record={categorising} tz={tz} onClose={() => setCategorising(null)}
          onFetchLatest={() => api<Rec>('GET', `${WRK}/defects/${categorising.id}`)}
          onSubmit={async (body) => { await api('PATCH', `${WRK}/defects/${categorising.id}`, tidy(body)); list.reload(); }} />
      ) : null}
      {converting ? (
        <FormModal title={t('wrk.defect.convert_title', { name: String(converting.defectNo) })} fields={[{ key: 'title', labelKey: 'wrk.field.title', type: 'text', maxLength: 160, hintKey: 'wrk.hint.case_title' }]} record={null} tz={tz} submitKey="wrk.defect.convert" onClose={() => setConverting(null)}
          onSubmit={async (body) => { try { await api('POST', `${WRK}/defects/${converting.id}/convert`, { expectedVersion: converting.version, ...body }); setError(null); list.reload(); } catch (e) { setError(e as Error); throw e; } }} />
      ) : null}
      {dismissing ? (
        <ReasonModal title={t('wrk.defect.dismiss_title', { name: String(dismissing.defectNo) })} confirmKey="wrk.defect.dismiss" onClose={() => setDismissing(null)}
          onConfirm={async (reason) => { await api('POST', `${WRK}/defects/${dismissing.id}/dismiss`, { expectedVersion: dismissing.version, reason }); list.reload(); }} />
      ) : null}
    </section>
  );
}
