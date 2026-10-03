// The Markdown source view: the page as one piece of Markdown in a text area, with a colored copy of the same text
// behind it, so the colors follow every key without a second editor. Blocks other than text are comment lines that
// stay where they are. Escape, or the button, goes back to the page and keeps the caret.
import { useLayoutEffect, useMemo, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import { useFlag } from '../../../app/flags';
import { useStore } from '../../../state/store';
import { t } from '../../../strings/t';
import { Button } from '../../../ui';
import type { MountedPage } from '../mount';
import styles from '../qol/qol.module.css';
import { readingLock, sourceState } from '../qol/stores';
import { closeSource } from './controller';
import { tokenizeLine } from './model';

/** Past this size the colors are left out, so typing in a very long page stays quick. */
const COLOUR_LIMIT = 200_000;

const KIND_CLASS = {
  text: undefined,
  heading: styles.tokHeading,
  marker: styles.tokMarker,
  quote: styles.tokQuote,
  strong: styles.tokStrong,
  emphasis: styles.tokEmphasis,
  code: styles.tokCode,
  link: styles.tokLink,
  placeholder: styles.tokPlaceholder,
} as const;

export function SourceView({ mounted }: { mounted: MountedPage }) {
  const enabled = useFlag('page.markdownSource');
  const state = useStore(sourceState, (value) => value);
  const locked = useStore(readingLock, (value) => value);
  const input = useRef<HTMLTextAreaElement>(null);
  const opened = useRef(false);
  const text = state?.text ?? '';
  const colors = useMemo(
    () => (text.length > COLOUR_LIMIT ? null : text.split('\n').map((line) => tokenizeLine(line))),
    [text],
  );

  // The text area is as tall as its text, so the view scrolls as one and the colored copy lines up.
  useLayoutEffect(() => {
    const area = input.current;
    if (!area) return;
    area.style.height = 'auto';
    area.style.height = `${area.scrollHeight}px`;
  }, [text]);

  // Opening puts the caret where the text's caret was.
  useLayoutEffect(() => {
    const area = input.current;
    if (!state) {
      opened.current = false;
      return;
    }
    if (!area || opened.current) return;
    opened.current = true;
    area.focus({ preventScroll: true });
    area.setSelectionRange(state.caret, state.caret);
    const line = area.value.slice(0, state.caret).split('\n').length - 1;
    area.scrollIntoView?.({ block: 'nearest' });
    const lineHeight = parseFloat(getComputedStyle(area).lineHeight) || 24;
    area.parentElement?.parentElement?.scrollTo?.({ top: Math.max(0, line * lineHeight - 120) });
  }, [state]);

  if (!enabled || !state) return null;
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      void closeSource(mounted);
    }
  };
  const remember = () => {
    const area = input.current;
    if (area) sourceState.set((current) => (current ? { ...current, caret: area.selectionStart } : current));
  };
  return (
    <div className={styles.sourceWrap}>
      <div className={styles.sourceBar}>
        <span>{t('pageExtras.source.hint')}</span>
        <Button variant="quiet" onClick={() => void closeSource(mounted)}>
          {t('pageExtras.source.back')}
        </Button>
      </div>
      <div className={styles.source}>
        <div className={styles.sourceBox}>
          {colors && (
            <pre className={styles.sourceLayer} aria-hidden="true">
              {colors.map((tokens, index) => (
                <span key={index}>
                  {tokens.map((token, at) => (
                    <span key={at} className={KIND_CLASS[token.kind]}>
                      {token.text}
                    </span>
                  ))}
                  {'\n'}
                </span>
              ))}
            </pre>
          )}
          <textarea
            ref={input}
            className={styles.sourceInput}
            style={colors ? undefined : { color: 'var(--color-text-primary)' }}
            value={state.text}
            spellCheck={false}
            readOnly={mounted.page.readOnly !== null || locked}
            aria-label={t('pageExtras.source.label')}
            onChange={(event) => sourceState.set({ text: event.target.value, caret: event.target.selectionStart })}
            onSelect={remember}
            onKeyDown={onKeyDown}
          />
        </div>
      </div>
    </div>
  );
}
