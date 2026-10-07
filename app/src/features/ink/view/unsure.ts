// The words the recognizer was unsure of. The writing pen and the lasso's Convert to text draw a thin amber line
// under each one, and each line gets a small button in the ink chrome over it: a tap, a click, or Enter opens the other
// readings (features/intel's alternativesFor), and choosing one replaces the word in the text box, with the line
// gone, as one undo step. The readings live in memory for this page view, so after the page is opened again the
// amber line stays as plain ink.
import { escapeParagraphText } from '../../../editor/markdown/escape';
import type { InkWord } from '../../../services/intel';
import { t } from '../../../strings/t';
import { announce, openMenu, showToast } from '../../../ui';
import type { InkHost } from './host';
import type { InkSurface } from './surface';

export interface UnsureMark {
  /** The amber line under the word. */
  readonly stroke: string;
  /** The text box the word went into. */
  readonly block: string;
  /** The word as the text box has it now. */
  readonly word: string;
  /** Which match of the word in the text box this is, from 0. */
  readonly occurrence: number;
  readonly alternatives: readonly string[];
  /** The word's box on the page, in page units. */
  readonly bounds: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
}

const isWordChar = (ch: string | undefined): boolean => ch !== undefined && /[\p{L}\p{N}_]/u.test(ch);

/** Where the nth whole-word match of `word` starts in `text`, or -1. */
export function wordAt(text: string, word: string, occurrence: number): number {
  if (!word) return -1;
  let seen = 0;
  for (let at = text.indexOf(word); at !== -1; at = text.indexOf(word, at + 1)) {
    if (isWordChar(text[at - 1]) || isWordChar(text[at + word.length])) continue;
    if (seen === occurrence) return at;
    seen += 1;
  }
  return -1;
}

/** The text with the nth whole-word match of `word` replaced, or null when the word is no longer there. */
export function replaceWord(text: string, word: string, occurrence: number, next: string): string | null {
  const at = wordAt(text, word, occurrence);
  return at < 0 ? null : text.slice(0, at) + next + text.slice(at + word.length);
}

/**
 * The marks for a line's unsure words once the line went into `block` as `markdown`. `unsure` and `tidy` are
 * features/intel's isUnsure and tidyRecognizedText; `lineOf` gives each unsure word's amber stroke.
 */
export function marksFor(
  words: readonly InkWord[],
  block: string,
  markdown: string,
  strokes: ReadonlyMap<InkWord, string>,
  helpers: { alternatives(word: InkWord): string[]; tidy(text: string): string },
): UnsureMark[] {
  const marks: UnsureMark[] = [];
  const counts = new Map<string, number>();
  for (const word of words) {
    const shown = escapeParagraphText(helpers.tidy(word.text));
    const occurrence = counts.get(shown) ?? 0;
    counts.set(shown, occurrence + 1);
    const stroke = strokes.get(word);
    if (!stroke || wordAt(markdown, shown, occurrence) < 0) continue;
    marks.push({
      stroke,
      block,
      word: shown,
      occurrence,
      alternatives: helpers.alternatives(word),
      bounds: word.bounds,
    });
  }
  return marks;
}

/** The buttons over one surface's amber lines. */
class UnsureLayer {
  private readonly marks = new Map<string, { mark: UnsureMark; button: HTMLButtonElement }>();
  private readonly stop: () => void;

  constructor(
    private readonly host: InkHost,
    private readonly surface: InkSurface,
  ) {
    this.stop = surface.onChange(() => this.place());
  }

  add(marks: readonly UnsureMark[]): void {
    const doc = this.surface.chrome.ownerDocument;
    for (const mark of marks) {
      const button = doc.createElement('button');
      button.type = 'button';
      button.dataset.inkUnsure = mark.stroke;
      button.setAttribute('aria-label', t('ink.handwriting.unsureWord', { word: mark.word }));
      button.title = t('ink.handwriting.unsureHint');
      Object.assign(button.style, { position: 'absolute', pointerEvents: 'auto' });
      button.addEventListener('click', () => void this.choose(mark.stroke));
      this.surface.chrome.append(button);
      this.marks.set(mark.stroke, { mark, button });
    }
    this.place();
  }

  /** Keeps each button over its line, and drops those whose line is gone, as after undo. */
  private place(): void {
    const { zoom, scrollX, scrollY } = this.surface.cameraNow();
    for (const [id, { mark, button }] of this.marks) {
      if (!this.surface.index.has(id)) {
        button.style.display = 'none';
        continue;
      }
      const b = mark.bounds;
      Object.assign(button.style, {
        display: '',
        left: `${b.x * zoom - scrollX}px`,
        top: `${(b.y + b.height - 4) * zoom - scrollY}px`,
        width: `${Math.max(16, b.width * zoom)}px`,
        height: `${Math.max(12, 10 * zoom)}px`,
      });
    }
  }

  /** Opens the word's other readings and puts the chosen one in place of it. */
  async choose(id: string): Promise<void> {
    const entry = this.marks.get(id);
    if (!entry) return;
    const { mark, button } = entry;
    const keep = '\u0000keep';
    const chosen = await openMenu({
      label: t('ink.handwriting.alternatives', { word: mark.word }),
      anchor: button,
      returnFocus: button,
      items: [
        ...mark.alternatives.map((text, index) => ({ id: String(index), label: text })),
        { id: keep, label: t('ink.handwriting.keepWord', { word: mark.word }), separatorBefore: true },
      ],
    });
    if (chosen === null) return;
    if (chosen === keep) return void (await this.settle(mark, null));
    const next = mark.alternatives[Number(chosen)];
    if (next !== undefined) await this.settle(mark, escapeParagraphText(next));
  }

  /** Replaces the word (or keeps it) and removes the amber line, as one undo step. */
  private async settle(mark: UnsureMark, next: string | null): Promise<void> {
    const queue = this.host.queue.get();
    const block = this.host.layer.get()?.block(mark.block);
    const markdown = typeof block?.data?.markdown === 'string' ? block.data.markdown : null;
    if (!queue || markdown === null) return;
    const text = next === null ? markdown : replaceWord(markdown, mark.word, mark.occurrence, next);
    if (text === null) {
      showToast({ message: t('ink.handwriting.wordChanged') });
      return;
    }
    const gone = this.surface.hide([mark.stroke]);
    const edits = [
      ...(next === null ? [] : [{ edit: 'setText' as const, block: mark.block, markdown: text }]),
      { edit: 'removeStrokes' as const, strokes: [mark.stroke] },
    ];
    const ok = await this.surface.send({ edits }, () => this.surface.show(gone));
    if (!ok) return;
    this.marks.get(mark.stroke)?.button.remove();
    this.marks.delete(mark.stroke);
    if (next !== null) {
      showToast({
        id: 'ink-word',
        message: t('ink.handwriting.wordReplaced', { word: next }),
        action: { label: t('ink.gestures.undo'), run: () => queue.undo() },
      });
    } else announce(t('ink.handwriting.wordKept', { word: mark.word }));
  }

  destroy(): void {
    this.stop();
    for (const { button } of this.marks.values()) button.remove();
    this.marks.clear();
  }
}

const layers = new WeakMap<InkSurface, UnsureLayer>();

/** Adds buttons over new amber lines on a surface. */
export function showUnsure(host: InkHost, surface: InkSurface, marks: readonly UnsureMark[]): void {
  if (marks.length === 0) return;
  let layer = layers.get(surface);
  if (!layer) {
    layer = new UnsureLayer(host, surface);
    layers.set(surface, layer);
  }
  layer.add(marks);
}

/** Opens the readings of the amber line with this stroke ID, for tests and the keyboard. */
export function chooseUnsure(surface: InkSurface, stroke: string): Promise<void> {
  return layers.get(surface)?.choose(stroke) ?? Promise.resolve();
}
