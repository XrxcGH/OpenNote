// A live collection in a page: the pages a saved collection's rules choose, shown as a table, list, board, calendar, or
// gallery, redrawn as the notes change. The rules travel in the block, so the page keeps working on another device. The
// block shows the pages as they are now and writes to a page only when a property is edited in it.
import { useEffect, useMemo, useState } from 'react';
import { commandContext } from '../../../commands/registry';
import type { PageFact } from '../../../services/search/types';
import { t } from '../../../strings/t';
import { showToast } from '../../../ui';
import { maybeSearchClient } from '../../search';
import { groupRows, matches, propertyNames, sortRows, toRow, VIEW_KINDS } from '../engine';
import type { CollectionDef, Row } from '../engine';
import { setProperty } from '../store';
import { VIEWS } from '../views';
import type { ViewProps } from '../views';
import styles from '../collections.module.css';

interface Props {
  def: CollectionDef;
  readOnly: boolean;
  onChange(def: CollectionDef): void;
  /** Opens a page. */
  open(page: string): void;
}

/** The facts of every page, read again each time the index reports a change. */
function useFacts(): PageFact[] | null {
  const [facts, setFacts] = useState<PageFact[] | null>(null);
  const client = maybeSearchClient();
  useEffect(() => {
    const extras = client?.extras;
    if (!client || !extras) return;
    let current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = () =>
      void extras
        .pageFacts(null)
        .then((list) => current && setFacts(list))
        .catch(() => current && setFacts([]));
    run();
    // The index follows saves in batches; waiting a moment keeps a burst of edits to one redraw.
    const stop = client.onUpdate(() => {
      clearTimeout(timer);
      timer = setTimeout(run, 300);
    });
    return () => {
      current = false;
      clearTimeout(timer);
      stop();
    };
  }, [client]);
  return client?.extras ? facts : [];
}

/** The pages a search for the collection's words found, or null when it has no words. */
function useFound(text: string): ReadonlySet<string> | null {
  const [found, setFound] = useState<ReadonlySet<string>>(new Set());
  const words = text.trim();
  useEffect(() => {
    const client = maybeSearchClient();
    if (!words || !client) return;
    let current = true;
    void client
      .search({ text: words, limit: 100 })
      .then((response) => current && setFound(new Set(response.hits.map((hit) => hit.page))))
      .catch(() => current && setFound(new Set()));
    return () => {
      current = false;
    };
  }, [words]);
  return words ? found : null;
}

export function CollectionBlock({ def, readOnly, onChange, open }: Props) {
  const facts = useFacts();
  const found = useFound(def.text);
  const [version, setVersion] = useState(0);
  const rows = useMemo(() => (facts ?? []).map(toRow), [facts, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = useMemo(
    () =>
      sortRows(
        rows.filter((row) => matches(row, def, found)),
        def,
      ),
    [rows, def, found],
  );
  const names = useMemo(() => propertyNames(shown), [shown]);
  const words = {
    none: t('qolSearch.collections.noValue'),
    yes: t('qolSearch.collections.yes'),
    no: t('qolSearch.collections.no'),
  };
  const groups = useMemo(() => groupRows(shown, def, words), [shown, def]); // eslint-disable-line react-hooks/exhaustive-deps
  const View = VIEWS[def.view];
  const edit: ViewProps['onEdit'] = (row: Row, name, field, value, label) => {
    setProperty(commandContext('palette').platform.pages, row.page, name, field?.type ?? 'text', value, label)
      .then(() => setVersion((was) => was + 1))
      .catch(() => showToast({ message: t('qolSearch.collections.editFailed'), tone: 'danger' }));
  };
  const sort = (name: string) =>
    onChange(
      def.sortBy === name
        ? { ...def, sortDir: def.sortDir === 'asc' ? 'desc' : 'asc' }
        : { ...def, sortBy: name, sortDir: 'asc' },
    );
  return (
    <section className={styles.block} aria-label={t('qolSearch.collections.blockLabel', { name: def.name })}>
      <header className={styles.blockHeader}>
        <h3 className={styles.blockTitle}>{def.name}</h3>
        <span className={styles.muted} role="status">
          {facts === null ? t('qolSearch.collections.loading') : t('qolSearch.collections.pages', { count: shown.length })}
        </span>
        {readOnly ? null : (
          <label className={styles.pick}>
            <span>{t('qolSearch.collections.viewLabel')}</span>
            <select
              className={styles.cell}
              value={def.view}
              onChange={(event) => onChange({ ...def, view: event.target.value as CollectionDef['view'] })}
            >
              {VIEW_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {t(`qolSearch.collections.views.${kind}`)}
                </option>
              ))}
            </select>
          </label>
        )}
      </header>
      {facts !== null && shown.length === 0 ? (
        <p className={styles.muted}>{t('qolSearch.collections.nothing')}</p>
      ) : (
        <View
          groups={groups}
          rows={shown}
          names={names}
          def={def}
          onOpen={(row) => open(row.page)}
          onEdit={edit}
          onSort={sort}
        />
      )}
    </section>
  );
}
