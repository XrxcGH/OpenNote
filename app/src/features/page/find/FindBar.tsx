// The Find bar: Ctrl+F finds, Ctrl+H also replaces. It sits over the top of the page, counts the matches in a live
// status, and highlights them on the page. Enter, Shift+Enter, F3, and Shift+F3 move between them. Replace and
// Replace all change the page as one step, so one Ctrl+Z undoes them.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, RefObject } from 'react';
import { useFlag } from '../../../app/flags';
import { useStore } from '../../../state/store';
import { t } from '../../../strings/t';
import { announce, Button, Switch, TextField } from '../../../ui';
import type { MountedPage } from '../mount';
import { closeFind, findRequest } from '../qol/stores';
import styles from '../qol/qol.module.css';
import type { FindOptions } from './match';
import { clearHighlights, collectMatches, highlight, replaceMatches, reveal } from './search';
import type { FindMatch } from './search';

/** The page's text changes while the bar is open (typing, undo, a box mounting); matches follow it this often. */
const REFRESH_MS = 200;

function selectedWord(mounted: MountedPage): string {
  const editor = mounted.pool.active()?.editor;
  if (!editor || editor.state.selection.empty) return '';
  const { from, to } = editor.state.selection;
  const text = editor.state.doc.textBetween(from, to, ' ', ' ');
  return text.length <= 100 && !text.includes('\n') ? text : '';
}

/** Opening, or asking again, puts the caret in the Find field, with the selected word in it. */
function useOpenFocus(mounted: MountedPage, open: boolean, nonce: number, root: RefObject<HTMLDivElement | null>) {
  const [word, setWord] = useState('');
  useEffect(() => {
    if (!open) return;
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
function useMatches(mounted: MountedPage, open: boolean, query: string, options: FindOptions) {
  const [matches, setMatches] = useState<FindMatch[]>([]);
  const [current, setCurrent] = useState(0);
  const wantReveal = useRef(false);
  const refresh = useCallback(() => {
    const next = collectMatches(mounted, query, options);
    setMatches(next);
    setCurrent((at) => (next.length === 0 ? 0 : Math.min(at, next.length - 1)));
  }, [mounted, query, options]);

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
  return { matches, current, setCurrent, go, refresh };
}

interface RowProps {
  query: string;
  onQuery(next: string): void;
  options: FindOptions;
  onOptions(next: FindOptions): void;
  matches: readonly FindMatch[];
  current: number;
  go(step: number): void;
  close(): void;
}

function FindRow(props: RowProps) {
  const { query, matches, current, go, close, options } = props;
  const status =
    query === ''
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
        <Switch
          label={t('pageExtras.find.matchCase')}
          checked={options.caseSensitive}
          onChange={(caseSensitive) => props.onOptions({ ...options, caseSensitive })}
        />
        <Switch
          label={t('pageExtras.find.wholeWord')}
          checked={options.wholeWord}
          onChange={(wholeWord) => props.onOptions({ ...options, wholeWord })}
        />
        <Button variant="quiet" onClick={close}>
          {t('pageExtras.find.close')}
        </Button>
      </div>
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
}

function ReplaceRow({ value, onChange, enabled, empty, replace, close }: ReplaceProps) {
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
      </div>
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
  const root = useRef<HTMLDivElement>(null);
  const selected = useOpenFocus(mounted, open, request.nonce, root);
  // A word picked up from the selection replaces what was typed, once, when the bar opens.
  const [seen, setSeen] = useState('');
  if (selected !== seen) {
    setSeen(selected);
    if (selected) setTyped(selected);
  }
  const { matches, current, setCurrent, go, refresh } = useMatches(mounted, open, typed, options);

  const close = () => {
    const match = matches[current];
    closeFind();
    // The caret goes to the match that was current, so typing carries on from there.
    if (match) mounted.pool.mount(match.block, { kind: 'selection', anchor: match.from, head: match.to }, 'target');
  };
  const replace = async (all: boolean) => {
    const list = all ? matches : matches.slice(current, current + 1);
    const count = await replaceMatches(mounted, list, typed, replacement).catch(() => 0);
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
          replace={(all) => void replace(all)}
          close={close}
        />
      )}
    </div>
  );
}
