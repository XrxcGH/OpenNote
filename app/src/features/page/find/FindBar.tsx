// The Find bar (FEATURES.md, Find and replace on a page): Ctrl+F finds, Ctrl+H also replaces. It sits over the top of
// the page, counts the matches in a live status, highlights them on the page, and moves between them with Enter,
// Shift+Enter, F3, and Shift+F3. Replace and Replace all change the page as one step, so one Ctrl+Z undoes them.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useFlag } from '../../../app/flags';
import { useStore } from '../../../state/store';
import { t } from '../../../strings/t';
import { announce, Button, Switch, TextField } from '../../../ui';
import type { MountedPage } from '../mount';
import { closeFind, findRequest } from '../qol/stores';
import styles from '../qol/qol.module.css';
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

export function FindBar({ mounted }: { mounted: MountedPage }) {
  const enabled = useFlag('page.findReplace');
  const request = useStore(findRequest, (value) => value);
  const open = enabled && request.open;
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [matches, setMatches] = useState<FindMatch[]>([]);
  const [current, setCurrent] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const wantReveal = useRef(false);
  const options = useMemo(() => ({ caseSensitive, wholeWord }), [caseSensitive, wholeWord]);
  const editable = !mounted.page.readOnly;

  // Opening, or asking again, puts the caret in the Find field, with the selected word in it.
  useEffect(() => {
    if (!open) return;
    const word = selectedWord(mounted);
    // The word goes in on the next tick, so the field is filled before it is selected.
    const filled = word ? window.setTimeout(() => setQuery(word), 0) : 0;
    const input = root.current?.querySelector('input');
    input?.focus();
    input?.select();
    return () => window.clearTimeout(filled);
    // Only a new request matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.nonce, open]);

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

  const close = () => {
    const match = matches[current];
    closeFind();
    // The caret goes to the match that was current, so typing carries on from there.
    if (match) mounted.pool.mount(match.block, { kind: 'selection', anchor: match.from, head: match.to }, 'target');
  };

  const replace = async (all: boolean) => {
    const list = all ? matches : matches.slice(current, current + 1);
    const count = await replaceMatches(mounted, list, query, replacement).catch(() => 0);
    announce(count > 0 ? t('pageExtras.find.replaced', { count }) : t('pageExtras.find.none'));
    refresh();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'F3' || (event.key === 'Enter' && event.shiftKey)) {
      event.preventDefault();
      event.stopPropagation();
      go(event.shiftKey ? -1 : 1);
    }
  };

  if (!open) return null;
  const status =
    query === ''
      ? ''
      : matches.length === 0
        ? t('pageExtras.find.none')
        : t('pageExtras.find.count', { index: current + 1, total: matches.length });
  return (
    <div
      ref={root}
      className={styles.find}
      role="search"
      aria-label={t('pageExtras.find.bar')}
      onKeyDownCapture={onKeyDown}
    >
      <div className={styles.findField}>
        <TextField
          label={t('pageExtras.find.label')}
          value={query}
          onChange={(next) => {
            setQuery(next);
            setCurrent(0);
          }}
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
        <Switch label={t('pageExtras.find.matchCase')} checked={caseSensitive} onChange={setCaseSensitive} />
        <Switch label={t('pageExtras.find.wholeWord')} checked={wholeWord} onChange={setWholeWord} />
        <Button variant="quiet" onClick={close}>
          {t('pageExtras.find.close')}
        </Button>
      </div>
      {request.replace && (
        <>
          <div className={styles.findField}>
            <TextField
              label={t('pageExtras.find.replaceLabel')}
              value={replacement}
              onChange={setReplacement}
              onCommit={() => void replace(false)}
              onCancel={close}
              readOnly={!editable}
            />
          </div>
          <div className={styles.findRow}>
            <Button onClick={() => void replace(false)} disabled={matches.length === 0 || !editable}>
              {t('pageExtras.find.replaceOne')}
            </Button>
            <Button onClick={() => void replace(true)} disabled={matches.length === 0 || !editable}>
              {t('pageExtras.find.replaceAll')}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
