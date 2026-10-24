import { useState } from 'react';
import { Link } from 'react-router-dom';
import { apiDownload, qs, saveBlob } from './api';
import { t } from './i18n';
import { can } from './permissions';
import { ErrorNotice } from './ui';

/**
 * "Download (Excel)" and "Upload from Excel" for a list screen. Download exports the current data of one Excel template
 * (one ship when `shipId` is given); upload opens the Excel screen on that template, where the file is previewed before saving.
 */
export function ExcelButtons({ template, shipId }: { template: string; shipId?: string | undefined }) {
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  async function download() {
    setBusy(true);
    try {
      const f = await apiDownload(`/api/v1/excel/templates/${template}/file${qs({ kind: 'data', format: 'xlsx', shipId: shipId || undefined })}`);
      saveBlob(f.blob, f.fileName);
      setError(null);
    } catch (e) { setError(e as Error); } finally { setBusy(false); }
  }
  return (
    <>
      {can('xls.export.run') ? <button onClick={() => void download()} disabled={busy} title={t(shipId ? 'excel.download_ship_hint' : 'excel.download_all_hint')}>{t('excel.download')}</button> : null}
      {can('xls.import.preview') ? <Link className="button" to={`/xls${qs({ template })}`}>{t('excel.upload')}</Link> : null}
      {error ? <ErrorNotice error={error} /> : null}
    </>
  );
}
