// The Find bar: Ctrl+F finds, Ctrl+H also replaces. It sits over the top of the page, counts the matches in a live
// status, and highlights them on the page. Enter, Shift+Enter, F3, and Shift+F3 move between them. Replace and
// Replace all change the page as one step, so one Ctrl+Z undoes them.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, RefObject } from 'react';
import { useFlag } from '../../../app/flags';
import { useStore } from '../../../state/store';
import { t } from '../../../strings/t';
import { announce, Button, openMenu, Switch, TextField } from '../../../ui';
import type { MountedPage } from '../mount';
import { closeFind, findRequest } from '../qol/stores';
import styles from '../qol/qol.module.css';
import { ANY, criterionOf, FORMAT_KINDS, invalidCriteria } from './format';
import type { FormatCriterion, FormatKind } from './format';
import type { FindOptions } from './match';
import { MAX_PATTERN_LENGTH } from './pattern';
import { PEN_COLORS } from '../../../editor/schema/constants';
import { clearHighlights, highlight, replaceMatches, reveal, searchPageAsync } from './search';
import type { FindMatch, SearchResult } from './search';

/** The formats typed into a format editor: a value per kind, `on` for bold, italic, and underline, empty for none. */
type FormatState = Readonly<Partial<Record<FormatKind, string>>>;

function criteriaOf(state: FormatState): FormatCriterion[] {
  return FORMAT_KINDS.flatMap(({ id }) => {
    const value = state[id] ?? '';
    const criterion = value === '' ? null : criterionOf(id, value);
    return criterion ? [criterion] : [];
  });
}

/** The special characters of plain text and wildcard queries, with the text each one adds to the query. */
const SPECIAL_CHARS = [
  ['paragraph', '^p'],
  ['tab', '^t'],
  ['any', '^?'],
  ['digit', '^#'],
  ['letter', '^$'],
  ['lineBreak', '^l'],
  ['nbsp', '^s'],
  ['caret', '^^'],
] as const;

/** The page's text changes while the bar is open (typing, undo, a box mounting); matches follow it this often. */
const REFRESH_MS = 200;

function selectedWord(mounted: MountedPage): string {
  const editor = mounted.pool.active()?.editor;
  if (!editor || editor.state.selection.empty) return '';
  const { from, to } = editor.state.selection;
  const text = editor.state.doc.textBetween(from, to, ' ', ' ');
  return text.length <= 100 && !text.includes('\n') ? text : '';
}

interface Caret {
  block: string;
  anchor: number;
  head: number;
}

/** Opening, or asking again, puts the caret in the Find field, with the selected word in it. */
function useOpenFocus(
  mounted: MountedPage,
  open: boolean,
  nonce: number,
  root: RefObject<HTMLDivElement | null>,
  originRef: RefObject<Caret | null>,
) {
  const [word, setWord] = useState('');
  useEffect(() => {
    if (!open) return;
    // Where the caret was, so closing with no match puts it back.
    const active = mounted.pool.active();
    if (active?.editor && !root.current?.contains(document.activeElement)) {
      const { anchor, head } = active.editor.state.selection;
      originRef.current = { block: active.block, anchor, head };
    }
    // The word goes in on the next tick, so the field is filled before it is selected.
    const found = selectedWord(mounted);
    const filled = found ? window.setTimeout(() => setWord(found), 0) : 0;
    const input = root.current?.querySelector('input');
    input?.focus();
    input?.select();
    return () => window.clearTimeout(filled);
    // Only a new request matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce, open]);
  return word;
}

/** The matches for the query, kept up to date while the page changes, and drawn on the page. */
function useMatches(
  mounted: MountedPage,
  open: boolean,
  query: string,
  options: FindOptions,
  formats: readonly FormatCriterion[],
) {
  const [matches, setMatches] = useState<FindMatch[]>([]);
  const [problem, setProblem] = useState<SearchResult['problem']>(null);
  const [current, setCurrent] = useState(0);
  const wantReveal = useRef(false);
  const latest = useRef(0);
  const refresh = useCallback(() => {
    // Only the newest search is shown: a slower, older one that ends later is dropped.
    const run = ++latest.current;
    void searchPageAsync(mounted, query, options, formats).then((next) => {
      if (run !== latest.current) return;
      setMatches(next.matches);
      setProblem(next.problem);
      setCurrent((at) => (next.matches.length === 0 ? 0 : Math.min(at, next.matches.length - 1)));
    });
  }, [mounted, query, options, formats]);

  useEffect(() => {
    if (!open) return;
    wantReveal.current = true;
    let timer = window.setTimeout(refresh, 0);
    const later = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(refresh, REFRESH_MS);
    };
    const observer = new MutationObserver(later);
    observer.observe(mounted.viewport.world, { childList: true, subtree: true, characterData: true });
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
      clearHighlights();
    };
  }, [open, mounted, refresh]);

  useEffect(() => {
    if (!open) return;
    highlight(mounted, matches, current);
    if (wantReveal.current && matches[current]) {
      wantReveal.current = false;
      reveal(mounted, matches[current]);
    }
  }, [open, mounted, matches, current]);

  const go = (step: number) => {
    if (matches.length === 0) return;
    wantReveal.current = true;
    setCurrent((at) => (at + step + matches.length) % matches.length);
  };
  return { matches, problem, current, setCurrent, go, refresh };
}

interface RowProps {
  query: string;
  onQuery(next: string): void;
  options: FindOptions;
  onOptions(next: FindOptions): void;
  matches: readonly FindMatch[];
  problem: SearchResult['problem'];
  formats: FormatState;
  onFormats(next: FormatState): void;
  current: number;
  go(step: number): void;
  close(): void;
}

function FormatEditor(props: {
  state: FormatState;
  onChange(next: FormatState): void;
  label: string;
  /** Find may ask for any value of a mark; Replace needs a value to set. */
  allowAny?: boolean;
}) {
  const { state, onChange, label, allowAny } = props;
  const set = (id: FormatKind, value: string) => onChange({ ...state, [id]: value });
  const invalid = invalidCriteria(criteriaOf(state).filter((criterion) => !allowAny || criterion.attrs)).length > 0;
  return (
    <div role="group" aria-label={label}>
      <div className={styles.findOptions}>
        {FORMAT_KINDS.filter((kind) => kind.key === null).map(({ id }) => (
          <Switch
            key={id}
            label={t(`textFind.kind.${id}`)}
            checked={(state[id] ?? '') !== ''}
            onChange={(on) => set(id, on ? 'on' : '')}
          />
        ))}
      </div>
      {FORMAT_KINDS.filter((kind) => kind.key !== null).map(({ id }) => {
        const any = allowAny && state[id] === ANY;
        return (
          <div key={id} className={styles.findField}>
            {!any && (
              <TextField
                label={t(`textFind.kind.${id}`)}
                value={state[id] ?? ''}
                onChange={(value) => set(id, value)}
              />
            )}
            {allowAny && (
              <Switch
                label={t('textFind.formatAny', { kind: t(`textFind.kind.${id}`) })}
                checked={!!any}
                onChange={(on) => set(id, on ? ANY : '')}
              />
            )}
          </div>
        );
      })}
      <span>{t('textFind.formatColors', { names: PEN_COLORS.join(', ') })}</span>
      {invalid && <span role="status">{t('textFind.formatInvalid')}</span>}
      <Button variant="quiet" onClick={() => onChange({})}>
        {t('textFind.formatClear')}
      </Button>
    </div>
  );
}

function SearchSwitches({ options, onOptions }: { options: FindOptions; onOptions(next: FindOptions): void }) {
  return (
    <>
      <Switch
        label={t('pageExtras.find.matchCase')}
        checked={options.caseSensitive || (!!options.wildcards && !options.regex)}
        disabled={!!options.wildcards && !options.regex}
        onChange={(caseSensitive) => onOptions({ ...options, caseSensitive })}
      />
      <Switch
        label={t('pageExtras.find.wholeWord')}
        checked={options.wholeWord}
        onChange={(wholeWord) => onOptions({ ...options, wholeWord })}
      />
      <Switch
        label={t('textFind.regex')}
        checked={!!options.regex}
        onChange={(regex) => onOptions({ ...options, regex, wildcards: regex ? false : options.wildcards })}
      />
      <Switch
        label={t('textFind.wildcards')}
        checked={!!options.wildcards}
        onChange={(wildcards) => onOptions({ ...options, wildcards, regex: wildcards ? false : options.regex })}
      />
    </>
  );
}

function FindRow(props: RowProps) {
  const { query, matches, current, go, close, options, problem } = props;
  const [formatOpen, setFormatOpen] = useState(false);
  const hasFormats = criteriaOf(props.formats).length > 0;
  const status =
    query === '' && !hasFormats
      ? ''
      : matches.length === 0
        ? t('pageExtras.find.none')
        : t('pageExtras.find.count', { index: current + 1, total: matches.length });
  return (
    <>
      <div className={styles.findField}>
        <TextField
          label={t('pageExtras.find.label')}
          value={query}
          onChange={props.onQuery}
          onCommit={() => go(1)}
          onCancel={close}
          error={problem ? t(`textFind.problem.${problem}`, { max: MAX_PATTERN_LENGTH }) : undefined}
        />
      </div>
      <div className={styles.findRow}>
        <Button onClick={() => go(-1)} disabled={matches.length === 0}>
          {t('pageExtras.find.previous')}
        </Button>
        <Button onClick={() => go(1)} disabled={matches.length === 0}>
          {t('pageExtras.find.next')}
        </Button>
        <span className={styles.findCount} role="status">
          {status}
        </span>
      </div>
      <div className={styles.findOptions}>
        <SearchSwitches options={options} onOptions={props.onOptions} />
        <Button
          disabled={!!options.regex}
          onClick={(event) => {
            const anchor = event.currentTarget as HTMLElement;
            void openMenu({
              label: t('textFind.specialMenu'),
              anchor,
              items: SPECIAL_CHARS.map(([id, code]) => ({
                id: code,
                label: t('textFind.specialItem', { label: t(`textFind.chars.${id}`), code }),
              })),
            }).then((code) => code && props.onQuery(query + code));
          }}
        >
          {t('textFind.special')}
        </Button>
        <Button aria-expanded={formatOpen} onClick={() => setFormatOpen(!formatOpen)}>
          {formatOpen ? t('textFind.formatHide') : t('textFind.formatShow')}
        </Button>
        <Button variant="quiet" onClick={close}>
          {t('pageExtras.find.close')}
        </Button>
      </div>
      {formatOpen && (
        <FormatEditor label={t('textFind.formatFind')} state={props.formats} onChange={props.onFormats} allowAny />
      )}
    </>
  );
}

interface ReplaceProps {
  value: string;
  onChange(next: string): void;
  enabled: boolean;
  empty: boolean;
  replace(all: boolean): void;
  close(): void;
  formats: FormatState;
  onFormats(next: FormatState): void;
}

function ReplaceRow({ value, onChange, enabled, empty, replace, close, formats, onFormats }: ReplaceProps) {
  const [formatOpen, setFormatOpen] = useState(false);
  return (
    <>
      <div className={styles.findField}>
        <TextField
          label={t('pageExtras.find.replaceLabel')}
          value={value}
          onChange={onChange}
          onCommit={() => replace(false)}
          onCancel={close}
          readOnly={!enabled}
        />
      </div>
      <div className={styles.findRow}>
        <Button onClick={() => replace(false)} disabled={empty || !enabled}>
          {t('pageExtras.find.replaceOne')}
        </Button>
        <Button onClick={() => replace(true)} disabled={empty || !enabled}>
          {t('pageExtras.find.replaceAll')}
        </Button>
        <Button aria-expanded={formatOpen} onClick={() => setFormatOpen(!formatOpen)}>
          {formatOpen ? t('textFind.formatHide') : t('textFind.formatShow')}
        </Button>
      </div>
      {formatOpen && <FormatEditor label={t('textFind.formatReplace')} state={formats} onChange={onFormats} />}
    </>
  );
}

export function FindBar({ mounted }: { mounted: MountedPage }) {
  const enabled = useFlag('page.findReplace');
  const request = useStore(findRequest, (value) => value);
  const open = enabled && request.open;
  const [typed, setTyped] = useState('');
  const [replacement, setReplacement] = useState('');
  const [options, setOptions] = useState<FindOptions>({ caseSensitive: false, wholeWord: false });
  const [findFormats, setFindFormats] = useState<FormatState>({});
  const [replaceFormats, setReplaceFormats] = useState<FormatState>({});
  const criteria = useMemo(() => criteriaOf(findFormats), [findFormats]);
  const root = useRef<HTMLDivElement>(null);
  const originRef = useRef<Caret | null>(null);
  const selected = useOpenFocus(mounted, open, request.nonce, root, originRef);
  // A word picked up from the selection replaces what was typed, once, when the bar opens.
  const [seen, setSeen] = useState('');
  if (selected !== seen) {
    setSeen(selected);
    if (selected) setTyped(selected);
  }
  const { matches, problem, current, setCurrent, go, refresh } = useMatches(mounted, open, typed, options, criteria);

  const close = () => {
    const match = matches[current];
    closeFind();
    // The caret goes to the match that was current, so typing carries on from there; with no match, back to
    // where it was before the bar opened. Either way the editor gets the focus back, as Escape promises.
    const caret = match ? { block: match.block, anchor: match.from, head: match.to } : originRef.current;
    originRef.current = null;
    if (!caret) return;
    const editor = mounted.pool.mount(
      caret.block,
      { kind: 'selection', anchor: caret.anchor, head: caret.head },
      'target',
    );
    editor?.commands.focus();
  };
  const replace = async (all: boolean) => {
    const list = all ? matches : matches.slice(current, current + 1);
    // No replacement text with formats chosen keeps the found text and sets the formats on it.
    const formats = criteriaOf(replaceFormats);
    const spec = { text: replacement === '' && formats.length > 0 ? null : replacement, formats, options };
    const count = await replaceMatches(mounted, list, spec).catch(() => 0);
    announce(count > 0 ? t('pageExtras.find.replaced', { count }) : t('pageExtras.find.none'));
    refresh();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'F3' && !(event.key === 'Enter' && event.shiftKey)) return;
    event.preventDefault();
    event.stopPropagation();
    go(event.shiftKey ? -1 : 1);
  };

  if (!open) return null;
  return (
    <div
      ref={root}
      className={styles.find}
      role="search"
      aria-label={t('pageExtras.find.bar')}
      onKeyDownCapture={onKeyDown}
    >
      <FindRow
        query={typed}
        onQuery={(next) => {
          setTyped(next);
          setCurrent(0);
        }}
        options={options}
        onOptions={setOptions}
        matches={matches}
        problem={problem}
        formats={findFormats}
        onFormats={setFindFormats}
        current={current}
        go={go}
        close={close}
      />
      {request.replace && (
        <ReplaceRow
          value={replacement}
          onChange={setReplacement}
          enabled={!mounted.page.readOnly}
          empty={matches.length === 0}
          formats={replaceFormats}
          onFormats={setReplaceFormats}
          replace={(all) => void replace(all)}
          close={close}
        />
      )}
    </div>
  );
}
