// Marks where a search hit sits in the page's handwriting (A1-30). The index finds the page; this draws a soft box
// around each recognized word that matches, for a few seconds, over the ink. It never changes the page.
import { shownMounted } from '../../page';
import type { MountedPage } from '../../page';
import { announce } from '../../../ui';
import { t } from '../../../strings/t';
import { INK_BLOCK, inkWordsOf, matchingWords } from './handwriting';
import type { InkWord } from './handwriting';

const SHOW_MS = 5000;
const ATTEMPTS = 100;
const STEP_MS = 100;
let marks: HTMLElement[] = [];
let clear: ReturnType<typeof setTimeout> | null = null;

export function clearInkMarks(): void {
  if (clear) clearTimeout(clear);
  clear = null;
  marks.forEach((mark) => mark.remove());
  marks = [];
}

/** Draws the boxes over the world. Returns how many were drawn. */
export function drawInkMarks(mounted: MountedPage, found: readonly InkWord[]): number {
  clearInkMarks();
  const world = mounted.viewport.world;
  for (const word of found) {
    const mark = document.createElement('div');
    mark.setAttribute('data-ink-hit', INK_BLOCK);
    mark.setAttribute('aria-hidden', 'true');
    Object.assign(mark.style, {
      position: 'absolute',
      left: `${word.bounds.x}px`,
      top: `${word.bounds.y}px`,
      width: `${word.bounds.width}px`,
      height: `${word.bounds.height}px`,
      background: 'var(--color-selection-highlight)',
      outline: 'var(--size-focus-ring-width) solid var(--color-focus-ring)',
      borderRadius: 'var(--radius-sm)',
      pointerEvents: 'none',
    });
    world.append(mark);
    marks.push(mark);
  }
  if (found.length > 0) clear = setTimeout(clearInkMarks, SHOW_MS);
  return found.length;
}

/** Waits for the page to be shown, then marks the words that match the query. Resolves the number marked. */
export function markInkHits(page: string, query: string): Promise<number> {
  return new Promise((resolve) => {
    let tries = 0;
    const attempt = () => {
      const mounted = shownMounted.get();
      if (mounted && mounted.page.id === page && inkWordsOf(page).length > 0) {
        const count = drawInkMarks(mounted, matchingWords(inkWordsOf(page), query));
        if (count > 0) announce(t('intelMore.inkHit.marked', { count }));
        resolve(count);
      } else if (++tries >= ATTEMPTS) resolve(0);
      else setTimeout(attempt, STEP_MS);
    };
    attempt();
  });
}
