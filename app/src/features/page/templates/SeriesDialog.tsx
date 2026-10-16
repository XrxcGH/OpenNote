// The Series pane: every page of the series the shown page belongs to, oldest first, each a link that opens it.
import { useEffect, useState } from 'react';
import { commandContext } from '../../../commands/registry';
import { t } from '../../../strings/t';
import { Dialog } from '../../../ui';
import { maybeSearchClient, openPage } from '../../search';
import styles from '../qol/qol.module.css';
import { rowOf, seriesPages } from './seriesList';
import type { SeriesRow } from './seriesList';

export function SeriesDialog(props: { series: string; current: string; onClose(): void }) {
  const { series, current, onClose } = props;
  const extras = maybeSearchClient()?.extras;
  const [rows, setRows] = useState<SeriesRow[] | null>(extras ? null : []);
  useEffect(() => {
    let live = true;
    if (!extras) return;
    extras
      .pageFacts(null)
      .then((facts) => live && setRows(seriesPages(facts.map(rowOf), series)))
      .catch(() => live && setRows([]));
    return () => {
      live = false;
    };
  }, [series, extras]);
  const open = (page: string) => {
    onClose();
    void openPage(commandContext('menu').notes, page);
  };
  return (
    <Dialog
      title={t('pageExtras.series.paneTitle')}
      description={t('pageExtras.series.paneDescription')}
      actions={[
        { id: 'close', label: t('common.close'), variant: 'secondary', leastDestructive: true, onPress: onClose },
      ]}
      onDismiss={onClose}
    >
      {rows === null ? null : rows.length === 0 ? (
        <p>{t('pageExtras.series.paneEmpty')}</p>
      ) : (
        <ol className={styles.pickList} aria-label={t('pageExtras.series.paneTitle')}>
          {rows.map((row) => (
            <li key={row.page}>
              <button
                type="button"
                className={styles.pickRow}
                aria-current={row.page === current ? 'page' : undefined}
                onClick={() => open(row.page)}
              >
                {row.title.trim() || t('pageExtras.templates.untitled')}
              </button>
            </li>
          ))}
        </ol>
      )}
    </Dialog>
  );
}

export default SeriesDialog;
