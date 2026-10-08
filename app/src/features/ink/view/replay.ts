// Ink replay: plays a page's ink (or the selected strokes) back stroke by stroke, in the order it was written, from the
// time each stroke stores. A bar in the page's chrome has play and pause, a slider, a speed from 0.5 to 4 times, and a
// switch that shortens long pauses. When the page has a recording of the time the ink was written, the audio plays
// along. The original strokes hide while it plays and come back when the bar closes: replay changes nothing on the page.
import { isEnabled } from '../../../app/flags';
import { InkReplay } from '../../../core/audio/replay';
import type { ReplayStroke } from '../../../core/audio/replay';
import { t } from '../../../strings/t';
import { announce, buttonClass } from '../../../ui';
import type { InkStroke } from '../model/types';
import type { InkHost, InkPointerTool } from './host';
import { paintStrokes } from './paint';
import type { InkSurface } from './surface';
import type { Store } from '../../../state/store';

export const SPEEDS = [0.5, 1, 2, 4] as const;

/** A stroke as replay times it: when it began and how long it took. */
export function replayEntries(strokes: readonly InkStroke[]): ReplayStroke[] {
  return strokes
    .filter((stroke) => !stroke.startUnknown && stroke.points.length > 0)
    .map((stroke) => ({
      id: stroke.id,
      startMs: stroke.startTime,
      durationMs: stroke.points[stroke.points.length - 1].time ?? 0,
    }));
}

/** The stroke as far as it has been drawn at `progress` (0 to 1) of its time. */
export function partialStroke(stroke: InkStroke, progress: number): InkStroke {
  const end = (stroke.points[stroke.points.length - 1]?.time ?? 0) * Math.min(1, Math.max(0, progress));
  const kept = stroke.points.filter((p) => (p.time ?? 0) <= end);
  return { ...stroke, id: `${stroke.id}:part`, points: kept.length > 0 ? kept : stroke.points.slice(0, 1) };
}

class ReplayBar {
  readonly element: HTMLDivElement;
  private readonly slider: HTMLInputElement;
  private readonly play: HTMLButtonElement;
  private readonly clock: HTMLOutputElement;
  private readonly speeds = new Map<number, HTMLButtonElement>();
  private readonly shortenButton: HTMLButtonElement;
  private readonly ids: string[];
  private readonly byId: Map<string, InkStroke>;
  private replay: InkReplay;
  private at = 0;
  private playing = false;
  private speed = 1;
  private shorten = true;
  private frame = 0;
  private last = 0;
  private audio: boolean | null = null;
  private readonly stops: (() => void)[] = [];

  constructor(
    private readonly host: InkHost,
    private readonly surface: InkSurface,
    strokes: readonly InkStroke[],
    private readonly onClose: () => void,
  ) {
    this.byId = new Map(strokes.map((s) => [s.id, s]));
    this.ids = strokes.map((s) => s.id);
    this.replay = new InkReplay(replayEntries(strokes), { maxGapMs: 1000 });
    const doc = surface.chrome.ownerDocument;
    this.element = doc.createElement('div');
    this.element.dataset.inkReplay = '';
    this.element.setAttribute('role', 'toolbar');
    this.element.setAttribute('aria-label', t('ink.replay.bar'));
    Object.assign(this.element.style, {
      position: 'fixed',
      left: '50%',
      bottom: '16px',
      transform: 'translateX(-50%)',
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-3)',
      padding: 'var(--space-3)',
      border: '1px solid var(--color-border-subtle)',
      borderRadius: 'var(--radius-md)',
      background: 'var(--color-surface-app)',
      pointerEvents: 'auto',
      zIndex: 'var(--layer-page-chrome)',
      maxWidth: 'calc(100% - 16px)',
      flexWrap: 'wrap',
    });
    const button = (label: string, text: string, run: () => void) => {
      const b = doc.createElement('button');
      b.type = 'button';
      b.className = buttonClass('secondary');
      b.setAttribute('aria-label', label);
      b.textContent = text;
      b.addEventListener('click', run);
      return b;
    };
    this.play = button(t('ink.replay.play'), t('ink.replay.play'), () => this.toggle());
    this.slider = doc.createElement('input');
    this.slider.type = 'range';
    this.slider.min = '0';
    this.slider.step = '1';
    this.slider.dataset.inkReplaySlider = '';
    this.slider.setAttribute('aria-label', t('ink.replay.position'));
    this.slider.style.minWidth = '160px';
    this.slider.addEventListener('input', () => this.seek(Number(this.slider.value)));
    this.clock = doc.createElement('output');
    this.element.append(this.play, this.slider, this.clock);
    for (const speed of SPEEDS) {
      const b = button(t('ink.replay.speedLabel', { speed }), t('ink.replay.speed', { speed }), () =>
        this.setSpeed(speed),
      );
      this.speeds.set(speed, b);
      this.element.append(b);
    }
    this.shortenButton = button(t('ink.replay.shorten'), t('ink.replay.shorten'), () => this.setShorten(!this.shorten));
    this.element.append(
      this.shortenButton,
      button(t('ink.replay.close'), t('ink.replay.close'), () => this.close()),
    );
    this.element.addEventListener('keydown', this.onKey);
    // The chrome layer has no height of its own, so a bar anchored to its bottom would sit above the window.
    doc.body.append(this.element);
    this.stops.push(surface.onChange(() => this.draw()));
    this.refresh();
    // The originals hide while the replay draws them again.
    surface.preview(this.ids, []);
    this.draw();
    this.play.focus({ preventScroll: true });
  }

  private refresh(): void {
    this.slider.max = String(Math.max(1, Math.round(this.replay.durationMs)));
    this.slider.value = String(Math.round(this.at));
    this.play.textContent = t(this.playing ? 'ink.replay.pause' : 'ink.replay.play');
    this.play.setAttribute('aria-label', this.play.textContent);
    this.clock.textContent = t('ink.replay.clock', {
      at: Math.round(this.at / 1000),
      total: Math.round(this.replay.durationMs / 1000),
    });
    for (const [speed, b] of this.speeds) b.setAttribute('aria-pressed', String(speed === this.speed));
    this.shortenButton.setAttribute('aria-pressed', String(this.shorten));
  }

  private draw(): void {
    const ctx = this.surface.liveContext();
    if (!ctx) return;
    const frame = this.replay.frameAt(this.at);
    const done = frame.done.flatMap((id) => this.byId.get(id) ?? []);
    const drawing = frame.drawing.flatMap(({ id, progress }) => {
      const stroke = this.byId.get(id);
      return stroke ? [partialStroke(stroke, progress)] : [];
    });
    paintStrokes(ctx, [...done, ...drawing], this.surface.scheme());
  }

  /** The stroke whose audio belongs at the current moment, for the recording to start from. */
  private strokeNow(): string | null {
    const real = this.replay.realTimeOf(this.at);
    const found = this.replay.strokes.find((s) => s.startMs + s.durationMs >= real) ?? this.replay.strokes[0];
    return found?.id ?? null;
  }

  private async startAudio(): Promise<void> {
    const audio = this.host.audio;
    const id = this.strokeNow();
    if (!audio || !id) return;
    const played = await audio.playFrom([id]);
    this.audio = played;
    if (played) {
      audio.setSpeed?.(this.speed);
      // Shortened pauses cannot keep the sound in step, so the pauses stay as they were while it plays.
      if (this.shorten) {
        this.setShorten(false);
        announce(t('ink.replay.audioKeepsPauses'));
      }
    }
  }

  toggle(): void {
    if (this.playing) return this.pause();
    if (this.at >= this.replay.durationMs) this.at = 0;
    this.playing = true;
    this.last = performance.now();
    void this.startAudio();
    this.frame = requestAnimationFrame(this.tick);
    this.refresh();
  }

  private pause(): void {
    this.playing = false;
    cancelAnimationFrame(this.frame);
    if (this.audio) this.host.audio?.pause();
    this.refresh();
  }

  private readonly tick = (now: number) => {
    if (!this.playing) return;
    this.at = Math.min(this.replay.durationMs, this.at + (now - this.last) * this.speed);
    this.last = now;
    this.draw();
    this.refresh();
    if (this.at >= this.replay.durationMs) return this.pause();
    this.frame = requestAnimationFrame(this.tick);
  };

  seek(ms: number): void {
    this.at = Math.min(this.replay.durationMs, Math.max(0, ms));
    this.draw();
    this.refresh();
    if (this.playing && this.audio) void this.startAudio();
  }

  seekFraction(fraction: number): void {
    this.seek(fraction * this.replay.durationMs);
  }

  private setSpeed(speed: number): void {
    this.speed = speed;
    if (this.audio) this.host.audio?.setSpeed?.(speed);
    this.refresh();
  }

  private setShorten(on: boolean): void {
    const real = this.replay.realTimeOf(this.at);
    this.shorten = on;
    this.replay = new InkReplay(replayEntries([...this.byId.values()]), { maxGapMs: on ? 1000 : null });
    this.at = this.replay.replayTimeOf(real);
    this.draw();
    this.refresh();
  }

  private readonly onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      return this.close();
    }
    if (event.target instanceof HTMLButtonElement && (event.key === ' ' || event.key === 'Enter')) return;
    if (event.key === ' ') {
      event.preventDefault();
      this.toggle();
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      const to =
        event.key === 'ArrowRight' ? this.replay.nextStrokeStart(this.at) : this.replay.previousStrokeStart(this.at);
      if (to !== null) {
        event.preventDefault();
        this.seek(to);
      }
    }
  };

  get sliderElement(): HTMLInputElement {
    return this.slider;
  }

  close(): void {
    this.pause();
    this.stops.forEach((stop) => stop());
    this.surface.endPreview();
    this.surface.clearLive();
    this.element.remove();
    this.onClose();
  }
}

let open: ReplayBar | null = null;

/** Replays the selected ink, or all the page's when nothing is selected. */
export function startReplay(host: InkHost, surface: InkSurface): void {
  if (!isEnabled('ink.replay')) return;
  open?.close();
  const selected = host.selection.get().strokes;
  const strokes = (selected.length > 0 ? surface.strokes(selected) : [...surface.index.all()]) as InkStroke[];
  if (replayEntries(strokes).length === 0) {
    announce(t('ink.replay.none'));
    return;
  }
  open = new ReplayBar(host, surface, strokes, () => (open = null));
}

/** Closes the bar when the page goes away. */
export function stopReplay(): void {
  open?.close();
}

/** Lets a press or drag on the slider seek, since the router claims the pointers the slider would otherwise get. */
export function installReplay(host: InkHost, surfaces: Store<InkSurface | null>): () => void {
  const stopSurface = surfaces.subscribe(() => stopReplay());
  const tool: InkPointerTool = {
    id: 'ink.replaySlider',
    priority: 107,
    accepts: (event) => open !== null && event.target === open.sliderElement,
    down(event, ctx) {
      ctx.capture(event.pointerId);
      seekTo(event);
      return 'claim';
    },
    move(events) {
      const last = events.at(-1);
      if (last) seekTo(last);
      return 'claim';
    },
  };
  const seekTo = (event: PointerEvent) => {
    const slider = open?.sliderElement;
    if (!slider) return;
    const rect = slider.getBoundingClientRect();
    open?.seekFraction(Math.min(1, Math.max(0, (event.clientX - rect.left) / (rect.width || 1))));
  };
  const stopTool = host.registerPointerTool(tool);
  return () => {
    stopTool();
    stopSurface();
    stopReplay();
  };
}
