// The table of contents pane (FEATURES.md, Table of contents): the page's headings, pinned beside long pages. It is a
// navigation landmark with one button per heading; Up, Down, Home, and End move between them, and Enter or a click
// moves the caret to the heading and brings it to the top.
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useFlag } from '../../../app/flags';
import { t } from '../../../strings/t';
import { announce, Button } from '../../../ui';
import type { MountedPage } from '../mount';
import { setPrefs, usePrefs } from '../qol/prefs';
import styles from '../qol/qol.module.css';
import { goToHeading, pageHeadings, topLevel } from './headings';
import type { Heading } from './headings';

const REFRESH_MS = 300;

function sameHeadings(a: readonly Heading[], b: readonly Heading[]): boolean {
  return (
    a.length === b.length &&
    a.every((h, i) => h.block === b[i].block && h.pos === b[i].pos && h.text === b[i].text && h.level === b[i].level)
  );
}

export function TocPane({ mounted }: { mounted: MountedPage }) {
  const enabled = useFlag('page.toc');
  const wanted = usePrefs((prefs) => prefs.toc);
  const open = enabled && wanted;
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [current, setCurrent] = useState<number>(-1);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!open) return;
    let timer = 0;
    const refresh = () =>
      setHeadings((before) => {
        const next = pageHeadings(mounted);
        return sameHeadings(before, next) ? before : next;
      });
    const later = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(refresh, REFRESH_MS);
    };
    refresh();
    const stop = mounted.layer.onChange(later);
    const observer = new MutationObserver(later);
    observer.observe(mounted.viewport.world, { childList: true, subtree: true, characterData: true });
    return () => {
      window.clearTimeout(timer);
      stop();
      observer.disconnect();
    };
  }, [open, mounted]);

  // The heading nearest the top of the view is the current one.
  useEffect(() => {
    if (!open) return;
    const scroller = mounted.viewport.viewport;
    let frame = 0;
    const update = () => {
      frame = 0;
      const top = scroller.getBoundingClientRect().top + 48;
      let at = -1;
      headings.forEach((heading, index) => {
        const root = mounted.layer.view(heading.block)?.editRoot;
        const element = root?.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')[heading.index];
        if (element && element.getBoundingClientRect().top <= top) at = index;
      });
      setCurrent(at);
    };
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(update);
    };
    update();
    scroller.addEventListener('scroll', schedule, { passive: true });
    return () => {
      scroller.removeEventListener('scroll', schedule);
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [open, mounted, headings]);

  if (!open) return null;
  const base = topLevel(headings);
  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const buttons = [...(list.current?.querySelectorAll('button') ?? [])];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const move =
      event.key === 'ArrowDown'
        ? at + 1
        : event.key === 'ArrowUp'
          ? at - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? buttons.length - 1
              : null;
    if (move === null || buttons.length === 0) return;
    event.preventDefault();
    buttons[Math.min(buttons.length - 1, Math.max(0, move))]?.focus();
  };
  return (
    <nav className={styles.toc} aria-label={t('pageExtras.toc.label')}>
      <h2 className={styles.tocTitle}>{t('pageExtras.toc.title')}</h2>
      {headings.length === 0 ? (
        <p className={styles.tocEmpty}>{t('pageExtras.toc.empty')}</p>
      ) : (
        <ul ref={list} className={styles.tocList} onKeyDown={onKeyDown}>
          {headings.map((heading, index) => (
            <li key={`${heading.block}:${heading.index}`}>
              <button
                type="button"
                className={styles.tocLink}
                aria-current={index === current ? 'true' : undefined}
                style={{ paddingInlineStart: `calc(var(--space-2) + ${heading.level - base} * var(--space-3))` }}
                onClick={() => {
                  goToHeading(mounted, heading);
                  announce(t('pageExtras.toc.jumped', { title: heading.text }));
                }}
              >
                {heading.text}
              </button>
            </li>
          ))}
        </ul>
      )}
      <Button variant="quiet" onClick={() => setPrefs({ toc: false })}>
        {t('pageExtras.toc.close')}
      </Button>
    </nav>
  );
}
