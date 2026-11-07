// The Symbol dialog: search by name or code, groups, recent symbols, and a font to see its own glyphs in. It resolves
// the chosen character, or null when the person cancels. The name list loads when the dialog opens (ADR 0088).
import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { t } from '../../../strings/t';
import { Dialog } from '../../../ui';
import type { DialogAction } from '../../../ui';
import {
  CATEGORY_IDS,
  MAX_RESULTS,
  cssFamily,
  fontHasGlyph,
  hexOf,
  loadSymbols,
  readRecent,
  searchSymbols,
} from './model';
import type { CategoryId, SymbolEntry } from './model';
import styles from './symbols.module.css';

interface Filters {
  query: string;
  category: CategoryId | null;
  font: string;
  onlyFont: boolean;
}

function Fields(props: { filters: Filters; change(next: Partial<Filters>): void }) {
  const { filters, change } = props;
  return (
    <>
      <div className={styles.row}>
        <label className={styles.field}>
          {t('textSymbols.dialog.search')}
          <input
            type="search"
            value={filters.query}
            placeholder={t('textSymbols.dialog.searchPlaceholder')}
            onChange={(event) => change({ query: event.target.value })}
          />
        </label>
        <label className={styles.field}>
          {t('textSymbols.dialog.category')}
          <select
            value={filters.category ?? ''}
            onChange={(event) => change({ category: (event.target.value || null) as CategoryId | null })}
          >
            <option value="">{t('textSymbols.category.all')}</option>
            {CATEGORY_IDS.map((id) => (
              <option key={id} value={id}>
                {t(`textSymbols.category.${id}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className={styles.row}>
        <label className={styles.field}>
          {t('textSymbols.dialog.font')}
          <input
            type="text"
            value={filters.font}
            placeholder={t('textSymbols.dialog.fontPlaceholder')}
            onChange={(event) => change({ font: event.target.value })}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={filters.onlyFont}
            onChange={(event) => change({ onlyFont: event.target.checked })}
          />{' '}
          {t('textSymbols.dialog.onlyFont')}
        </label>
      </div>
    </>
  );
}

const labelOf = (e: SymbolEntry) =>
  t('textSymbols.dialog.symbolLabel', { name: e.name.toLowerCase(), code: hexOf(e.cp) });

function Cells(props: {
  list: readonly SymbolEntry[];
  chosen: SymbolEntry | null;
  font: string;
  label: string;
  pick(entry: SymbolEntry): void;
  done(entry: SymbolEntry): void;
}) {
  const { list, chosen, font, label, pick, done } = props;
  const style = font.trim() ? { fontFamily: `${cssFamily(font.trim())}, inherit` } : undefined;
  return (
    <ul className={styles.grid} aria-label={label}>
      {list.map((e) => (
        <li key={e.cp}>
          <button
            type="button"
            className={styles.cell}
            style={style}
            aria-label={labelOf(e)}
            aria-pressed={chosen?.cp === e.cp}
            title={labelOf(e)}
            onClick={() => pick(e)}
            onDoubleClick={() => done(e)}
          >
            {e.char}
          </button>
        </li>
      ))}
    </ul>
  );
}

function useSymbols(): readonly SymbolEntry[] | null {
  const [all, setAll] = useState<readonly SymbolEntry[] | null>(null);
  useEffect(() => {
    let live = true;
    void loadSymbols().then((list) => live && setAll(list));
    return () => {
      live = false;
    };
  }, []);
  return all;
}

function statusLine(matches: number, chosen: SymbolEntry | null): string {
  if (matches > MAX_RESULTS) return t('textSymbols.dialog.truncated', { count: MAX_RESULTS });
  if (!chosen) return t('textSymbols.dialog.notChosen');
  return t('textSymbols.dialog.chosen', { name: chosen.name.toLowerCase(), code: hexOf(chosen.cp) });
}

export function Picker(props: { done(entry: SymbolEntry | null): void }) {
  const { done } = props;
  const all = useSymbols();
  const [filters, setFilters] = useState<Filters>({ query: '', category: null, font: '', onlyFont: false });
  const [chosen, setChosen] = useState<SymbolEntry | null>(null);
  const recent = useMemo(() => {
    const byCode = new Map((all ?? []).map((e) => [e.cp, e]));
    return readRecent()
      .map((cp) => byCode.get(cp))
      .filter((e): e is SymbolEntry => e !== undefined);
  }, [all]);
  const matches = useMemo(() => {
    if (!all) return [];
    const found = searchSymbols(all, filters.query, filters.category);
    const font = filters.font.trim();
    return filters.onlyFont && font ? found.filter((e) => fontHasGlyph(font, e.char)) : found;
  }, [all, filters]);
  const actions: DialogAction[] = [
    {
      id: 'cancel',
      label: t('textSymbols.dialog.cancel'),
      variant: 'secondary',
      leastDestructive: true,
      onPress: () => done(null),
    },
    {
      id: 'insert',
      label: t('textSymbols.dialog.insert'),
      variant: 'primary',
      disabled: !chosen,
      onPress: () => void (chosen && done(chosen)),
    },
  ];
  const cells = (list: readonly SymbolEntry[], label: string) => (
    <Cells list={list} chosen={chosen} font={filters.font} label={label} pick={setChosen} done={done} />
  );
  const note = (text: string) => (
    <p className={styles.note} role="status">
      {text}
    </p>
  );
  return (
    <Dialog
      title={t('textSymbols.dialog.title')}
      description={t('textSymbols.dialog.description')}
      actions={actions}
      size="large"
      onDismiss={() => done(null)}
    >
      <div className={styles.body}>
        <Fields filters={filters} change={(next) => setFilters((before) => ({ ...before, ...next }))} />
        {recent.length > 0 ? cells(recent, t('textSymbols.dialog.recent')) : null}
        {all === null ? note(t('textSymbols.dialog.loading')) : null}
        {all !== null && matches.length === 0 ? note(t('textSymbols.dialog.none')) : null}
        {matches.length > 0 ? cells(matches.slice(0, MAX_RESULTS), t('textSymbols.dialog.grid')) : null}
        {note(statusLine(matches.length, chosen))}
      </div>
    </Dialog>
  );
}

/** Opens the dialog and resolves the chosen symbol, or null. */
export function pickSymbol(): Promise<SymbolEntry | null> {
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  return new Promise((resolve) => {
    const done = (entry: SymbolEntry | null) => {
      queueMicrotask(() => {
        root.unmount();
        host.remove();
      });
      resolve(entry);
    };
    root.render(<Picker done={done} />);
  });
}
