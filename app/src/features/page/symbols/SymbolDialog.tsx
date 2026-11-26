// The Symbol dialog: search by name or code, groups, recent symbols, and a font to see its own glyphs in. It resolves
// the chosen character, or null when the person cancels. The name list loads when the dialog opens (ADR 0088).
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { t } from '../../../strings/t';
import { Dialog } from '../../../ui';
import type { DialogAction } from '../../../ui';
import {
  CATEGORY_IDS,
  MAX_RESULTS,
  SPECIAL,
  SPECIAL_KEYS,
  SYMBOL_FONTS,
  cssFamily,
  fontHasGlyph,
  gridMove,
  hexOf,
  installedFonts,
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

/** How long the font field rests before the glyph filter measures again. */
const FONT_DEBOUNCE_MS = 250;

function Fields(props: { filters: Filters; change(next: Partial<Filters>): void }) {
  const { filters, change } = props;
  const [fonts, setFonts] = useState<readonly string[]>(SYMBOL_FONTS);
  const asked = useRef(false);
  const [typed, setTyped] = useState(filters.font);
  useEffect(() => {
    const timer = setTimeout(() => change({ font: typed }), FONT_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- change is a new function on every render.
  }, [typed]);
  const loadFonts = () => {
    if (asked.current) return;
    asked.current = true;
    void installedFonts().then((list) => list.length > 0 && setFonts(list));
  };
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
            list="opennote-symbol-fonts"
            value={typed}
            placeholder={t('textSymbols.dialog.fontPlaceholder')}
            onFocus={loadFonts}
            onChange={(event) => setTyped(event.target.value)}
          />
          <datalist id="opennote-symbol-fonts" aria-label={t('textSymbols.dialog.fontList')}>
            {fonts.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
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

/** How many columns the grid shows now, read from the layout; a fixed width in tests, which have no layout. */
function columnsOf(grid: HTMLElement | null): number {
  const template = grid ? getComputedStyle(grid).gridTemplateColumns : '';
  const count = template.split(' ').filter((part) => part.endsWith('px')).length;
  return count > 0 ? count : 8;
}

/** One listbox of symbols with a single tab stop: the arrow keys move, Enter inserts. */
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
  const grid = useRef<HTMLUListElement>(null);
  const [active, setActive] = useState(0);
  // The tab stop is the chosen cell when this grid has it, otherwise the one the arrows last reached.
  const chosenAt = list.findIndex((e) => e.cp === chosen?.cp);
  const stop = Math.min(chosenAt >= 0 ? chosenAt : active, Math.max(0, list.length - 1));
  const move = (event: KeyboardEvent<HTMLUListElement>) => {
    const entry = list[stop];
    if (event.key === 'Enter' && entry) {
      event.preventDefault();
      event.stopPropagation();
      done(entry);
      return;
    }
    if (event.key === ' ' && entry) {
      event.preventDefault();
      pick(entry);
      return;
    }
    const to = gridMove(event.key, stop, list.length, columnsOf(grid.current));
    const target = to === null ? undefined : list[to];
    if (to === null || !target) return;
    event.preventDefault();
    setActive(to);
    pick(target);
    grid.current?.querySelectorAll<HTMLElement>('[role="option"]')[to]?.focus();
  };
  return (
    <ul ref={grid} className={styles.grid} role="listbox" aria-label={label} onKeyDown={move}>
      {list.map((e, index) => (
        <li
          key={e.cp}
          role="option"
          className={styles.cell}
          style={style}
          aria-label={labelOf(e)}
          aria-selected={chosen?.cp === e.cp}
          tabIndex={index === stop ? 0 : -1}
          title={labelOf(e)}
          onClick={() => {
            setActive(index);
            pick(e);
          }}
          onDoubleClick={() => done(e)}
        >
          {e.char}
        </li>
      ))}
    </ul>
  );
}

/** The five special characters, each one press from inserted. */
function Specials(props: { done(entry: SymbolEntry): void }) {
  return (
    <div role="group" aria-label={t('textSymbols.dialog.special')} className={styles.specials}>
      {(Object.keys(SPECIAL) as (keyof typeof SPECIAL)[]).map((id) => {
        const keys = SPECIAL_KEYS[id];
        const name = t(`textSymbols.specials.${id}`);
        const label = keys ? t('textSymbols.dialog.specialWithKeys', { name, keys }) : name;
        const char = SPECIAL[id];
        return (
          <button
            key={id}
            type="button"
            className={styles.special}
            onClick={() => props.done({ cp: char.codePointAt(0) ?? 0, char, name, category: 'punctuation', block: '' })}
          >
            {label}
          </button>
        );
      })}
    </div>
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
        <Specials done={done} />
        {recent.length > 0 ? cells(recent, t('textSymbols.dialog.recentGrid')) : null}
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
