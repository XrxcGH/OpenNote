// Type as handwriting (flag ink.myHandwriting): while it is on, typing writes in the person's hand, live, where the
// caret is. Each word shows as it is typed and becomes ink when it ends, so one Undo takes back one word; Backspace
// unwrites letter by letter, into the word before. A click or tap on the page moves the caret there, and Escape stops.
// The keys go to a field of its own, named for screen readers; the page's text is never touched.
import { t } from '../../../../strings/t';
import { announce } from '../../../../ui';
import { placement } from '../../myhand/place';
import type { HandStyle } from '../../myhand/style';
import { writeText } from '../../myhand/write';
import type { Placement } from '../../myhand/write';
import type { InkStroke } from '../../model/types';
import type { InkHost } from '../host';
import type { InkSurface } from '../surface';
import { reportMissing, toStrokes } from './writeInk';

interface Word {
  readonly ids: string[];
  readonly text: string;
  readonly before: { x: number; baseline: number };
}

/** How long the writing waits after the last key before a half-typed word becomes ink. */
const SETTLE_MS = 1200;

export class TypeMode {
  private place: Placement;
  private cursor: { x: number; baseline: number };
  private words: Word[] = [];
  private pending = '';
  private preview: InkStroke[] = [];
  private seed = Math.floor(Math.random() * 2 ** 31);
  private readonly missing = new Set<string>();
  private readonly field: HTMLTextAreaElement;
  private readonly caret: HTMLDivElement;
  private readonly stops: (() => void)[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private composing = false;
  private busy: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly host: InkHost,
    private readonly surface: InkSurface,
    private readonly style: HandStyle,
    private readonly onStop: () => void,
  ) {
    const viewport = host.viewport.get();
    const camera = surface.cameraNow();
    const at = viewport ? viewport.toWorld(camera.viewport.x + 64, camera.viewport.y + 64) : { x: 64, y: 64 };
    this.place = this.placeAt(at);
    this.cursor = { x: this.place.startX ?? this.place.left, baseline: this.place.baseline };
    this.field = document.createElement('textarea');
    this.field.setAttribute('aria-label', t('myHand.type.field'));
    this.field.setAttribute('data-myhand-type', '');
    this.field.autocapitalize = 'off';
    this.field.spellcheck = false;
    Object.assign(this.field.style, {
      position: 'fixed',
      opacity: '0',
      inlineSize: '1px',
      blockSize: '1px',
      insetInlineStart: '0',
      insetBlockStart: '0',
    });
    this.caret = document.createElement('div');
    this.caret.className = 'myhand-caret';
    this.caret.setAttribute('aria-hidden', 'true');
    this.caret.style.position = 'fixed';
    document.body.append(this.field, this.caret);
    this.listen();
    this.field.focus();
    this.moveCaret();
    announce(t('myHand.type.on'));
  }

  private placeAt(at: { x: number; y: number }): Placement {
    const lattice = this.host.paper?.get() ?? null;
    const viewport = this.host.viewport.get();
    const right = lattice
      ? lattice.area.x + lattice.area.w
      : Math.max(at.x + 200, (viewport?.world.offsetWidth ?? at.x + 600) - 48);
    return placement(lattice, { at, right, fontSize: 18 }, this.style.metrics);
  }

  private listen(): void {
    const on = <K extends keyof HTMLElementEventMap>(
      target: HTMLElement,
      type: K,
      fn: (event: HTMLElementEventMap[K]) => void,
      capture = false,
    ) => {
      target.addEventListener(type, fn as EventListener, capture);
      this.stops.push(() => target.removeEventListener(type, fn as EventListener, capture));
    };
    on(this.field, 'keydown', (event) => this.key(event));
    on(this.field, 'input', () => {
      if (!this.composing) this.take();
    });
    on(this.field, 'compositionstart', () => (this.composing = true));
    on(this.field, 'compositionend', () => {
      this.composing = false;
      this.take();
    });
    const viewport = this.host.viewport.get();
    if (viewport) {
      // A click or tap on the page moves the caret there; the pen and the other tools carry on as they were.
      on(
        viewport.viewport,
        'pointerdown',
        (event) => {
          if (event.button !== 0) return;
          const at = viewport.toWorld(event.clientX, event.clientY);
          void this.run(async () => {
            await this.commit();
            this.place = this.placeAt(at);
            this.cursor = { x: this.place.startX ?? this.place.left, baseline: this.place.baseline };
            this.words = [];
            this.moveCaret();
          });
          setTimeout(() => this.field.focus({ preventScroll: true }), 0);
        },
        true,
      );
      this.stops.push(viewport.onCamera(() => this.moveCaret()));
    }
  }

  /** Runs edits one after another, so a fast typist's words land in order. */
  private run(fn: () => Promise<void> | void): Promise<unknown> {
    this.busy = this.busy.then(fn, fn);
    return this.busy;
  }

  private key(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.stop();
    } else if (event.key === 'Backspace') {
      event.preventDefault();
      void this.run(() => this.back());
    } else if (event.key === 'Enter') {
      event.preventDefault();
      this.type('\n');
    }
  }

  private take(): void {
    const text = this.field.value;
    this.field.value = '';
    if (text) this.type(text);
  }

  private type(text: string): void {
    void this.run(async () => {
      for (const char of text.replace(/\r/g, '')) {
        this.pending += char;
        if (char === ' ' || char === '\n' || char === '\t') await this.commit();
      }
      this.draw();
    });
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.run(() => this.commit()), SETTLE_MS);
  }

  private layout() {
    const written = writeText(
      this.pending,
      this.style,
      { ...this.place, baseline: this.cursor.baseline, startX: this.cursor.x },
      this.seed + this.words.length,
    );
    written.missing.forEach((char) => this.missing.add(char));
    return written;
  }

  /** Shows the word being typed, without making it ink yet. */
  private draw(): void {
    const drop = this.preview.map((s) => s.id);
    if (this.pending === '') {
      this.preview = [];
      this.surface.preview([], [], drop);
      this.moveCaret();
      return;
    }
    const written = this.layout();
    this.preview = toStrokes(written, this.surface);
    this.surface.preview([], this.preview, drop);
    this.moveCaret(written.end);
  }

  /** The word typed so far becomes ink, as one undo step. */
  private async commit(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    if (this.pending === '') return;
    const text = this.pending;
    const written = this.layout();
    const strokes = toStrokes(written, this.surface);
    this.surface.preview(
      [],
      [],
      this.preview.map((s) => s.id),
    );
    this.preview = [];
    this.pending = '';
    const before = { ...this.cursor };
    this.cursor = { x: written.end.x, baseline: written.end.baseline };
    if (strokes.length > 0 && !(await this.surface.add(strokes))) return;
    this.words.push({ ids: strokes.map((s) => s.id), text, before });
    this.moveCaret();
  }

  /** Backspace: unwrites the last letter, going back into the word before when this one is empty. */
  private async back(): Promise<void> {
    if (this.pending === '') {
      const last = this.words.pop();
      if (!last) return;
      await this.surface.remove(last.ids);
      this.cursor = last.before;
      this.pending = last.text;
    }
    this.pending = [...this.pending].slice(0, -1).join('');
    this.draw();
  }

  private moveCaret(end?: { x: number; baseline: number }): void {
    const camera = this.surface.cameraNow();
    const at = end ?? this.cursor;
    const height = this.place.xHeight * 1.6 * camera.zoom;
    const x = camera.viewport.x + at.x * camera.zoom - camera.scrollX;
    const y = camera.viewport.y + at.baseline * camera.zoom - camera.scrollY - height;
    Object.assign(this.caret.style, { left: `${x}px`, top: `${y}px`, height: `${height}px` });
  }

  /** Stops: the word being typed becomes ink, and the field and caret go. */
  stop(): void {
    void this.run(async () => {
      await this.commit();
      this.stops.forEach((stop) => stop());
      this.field.remove();
      this.caret.remove();
      announce(t('myHand.type.off'));
      reportMissing([...this.missing]);
      this.onStop();
    });
  }
}
