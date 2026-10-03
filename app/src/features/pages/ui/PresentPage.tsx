// Present a page: the whole page full screen, with a laser pointer and ink that fades. The page is a picture made from
// the note (the same picture Export selection makes), so nothing here can change the note. Marks are drawn on a canvas
// over it and fade by themselves. A finger, a pen, and a mouse all work: a laser follows the pointer, and ink is drawn
// while it is down. The Move tool hands a touch screen back its scrolling.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { announce, Button } from '../../../ui';
import { t } from '../../../strings/t';
import type { Picture } from '../host/picture';
import { INK_LIFE, LASER_LIFE, alive, extend, finish, segments } from '../slides';
import type { Trail } from '../slides';
import styles from './pagesUi.module.css';

export interface PresentPageProps {
  readonly picture: Picture;
  close(): void;
}

type Tool = 'laser' | 'ink' | 'move';
const TOOLS: readonly { id: Tool; label: 'laser' | 'ink' | 'move'; key: string }[] = [
  { id: 'laser', label: 'laser', key: 'L' },
  { id: 'ink', label: 'ink', key: 'P' },
  { id: 'move', label: 'move', key: 'M' },
];

interface Marks {
  ink: Trail[];
  laser: Trail[];
  /** Where the laser dot is, or null while the pointer is away. */
  dot: { x: number; y: number } | null;
}

interface Colors {
  readonly laser: string;
  readonly ink: string;
}

/** The colors of the marks, read from the theme because a canvas can't use custom properties. */
function readColors(element: HTMLElement): Colors {
  const style = getComputedStyle(element);
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return { laser: read('--color-accent-clay', '#A9502F'), ink: read('--color-accent-night', '#4A5590') };
}

function paint(canvas: HTMLCanvasElement, marks: Marks, colors: Colors, now: number): void {
  const context = canvas.getContext('2d');
  if (!context) return;
  const ratio = canvas.width / Math.max(1, canvas.clientWidth);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
  context.lineCap = 'round';
  context.lineJoin = 'round';
  const stroke = (trails: readonly Trail[], life: number, color: string, width: number) => {
    context.strokeStyle = color;
    context.lineWidth = width;
    for (const trail of trails) {
      for (const s of segments(trail, now, life)) {
        context.globalAlpha = s.alpha;
        context.beginPath();
        context.moveTo(s.x1, s.y1);
        context.lineTo(s.x2, s.y2);
        context.stroke();
      }
    }
  };
  stroke(marks.ink, INK_LIFE, colors.ink, 4);
  stroke(marks.laser, LASER_LIFE, colors.laser, 7);
  if (marks.dot) {
    context.fillStyle = colors.laser;
    context.globalAlpha = 0.25;
    context.beginPath();
    context.arc(marks.dot.x, marks.dot.y, 18, 0, Math.PI * 2);
    context.fill();
    context.globalAlpha = 0.95;
    context.beginPath();
    context.arc(marks.dot.x, marks.dot.y, 8, 0, Math.PI * 2);
    context.fill();
  }
  context.globalAlpha = 1;
}

/** What draws the marks on a canvas: it keeps them, repaints while any is still showing, and stops when none is. */
function createOverlay(element: HTMLCanvasElement) {
  const marks: Marks = { ink: [], laser: [], dot: null };
  const colors = readColors(element);
  let frame = 0;
  let pressed = false;
  const draw = (): void => {
    frame = 0;
    const now = performance.now();
    marks.ink = alive(marks.ink, now, INK_LIFE);
    marks.laser = alive(marks.laser, now, LASER_LIFE);
    paint(element, marks, colors, now);
    if (marks.ink.length + marks.laser.length > 0 || marks.dot !== null) frame = requestAnimationFrame(draw);
  };
  const wake = () => {
    frame ||= requestAnimationFrame(draw);
  };
  // The canvas is as sharp as the screen: one pixel of canvas for each device pixel.
  const size = () => {
    const ratio = window.devicePixelRatio || 1;
    element.width = Math.round(element.clientWidth * ratio);
    element.height = Math.round(element.clientHeight * ratio);
    wake();
  };
  size();
  const observer = new ResizeObserver(size);
  observer.observe(element);
  const point = (event: PointerEvent) => {
    const box = element.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top, t: performance.now() };
  };
  return {
    down(event: PointerEvent, tool: Tool) {
      pressed = true;
      element.setPointerCapture(event.pointerId);
      const p = point(event);
      if (tool === 'ink') marks.ink = extend(finish(marks.ink), p);
      else marks.laser = extend(finish(marks.laser), p);
      marks.dot = { x: p.x, y: p.y };
      wake();
    },
    move(event: PointerEvent, tool: Tool) {
      // A finger is only a pointer while it touches; a pen and a mouse point before they touch.
      if (event.pointerType === 'touch' && !pressed) return;
      const p = point(event);
      if (tool === 'ink') {
        if (pressed) marks.ink = extend(marks.ink, p);
        marks.dot = pressed ? null : { x: p.x, y: p.y };
      } else {
        marks.laser = extend(marks.laser, p);
        marks.dot = { x: p.x, y: p.y };
      }
      wake();
    },
    up(event: PointerEvent) {
      pressed = false;
      marks.ink = finish(marks.ink);
      marks.laser = finish(marks.laser);
      if (event.pointerType === 'touch') marks.dot = null;
      wake();
    },
    leave() {
      if (pressed) return;
      marks.dot = null;
      marks.laser = finish(marks.laser);
      wake();
    },
    clear() {
      marks.ink = [];
      marks.laser = [];
      marks.dot = null;
      wake();
    },
    destroy() {
      observer.disconnect();
      cancelAnimationFrame(frame);
    },
  };
}

type Overlay = ReturnType<typeof createOverlay>;

export function PresentPage({ picture, close }: PresentPageProps) {
  const stage = useRef<HTMLDivElement>(null);
  const view = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [tool, setTool] = useState<Tool>('laser');
  const [width, setWidth] = useState(0);
  const overlay = useRef<Overlay | null>(null);
  const clear = () => overlay.current?.clear();
  const url = useMemo(() => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(picture.svg)}`, [picture.svg]);

  // Full screen, and focus back where it was when the show ends.
  useEffect(() => {
    const element = stage.current;
    const opener = document.activeElement as HTMLElement | null;
    element?.focus();
    void element?.requestFullscreen?.().catch(() => undefined);
    return () => {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
      opener?.focus?.();
    };
  }, []);
  // The marks are drawn on the canvas for as long as the stage shows.
  useEffect(() => {
    if (!canvas.current) return;
    overlay.current = createOverlay(canvas.current);
    return () => {
      overlay.current?.destroy();
      overlay.current = null;
    };
  }, []);
  // The page is as wide as the window.
  useEffect(() => {
    const element = view.current;
    if (!element) return;
    const fit = () => setWidth(element.clientWidth);
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const choose = (next: Tool) => {
    setTool(next);
    announce(t(`pagesPlus.present.tools.${next}`));
  };
  const scroll = (screens: number) => {
    const element = view.current;
    if (element) element.scrollBy({ top: element.clientHeight * 0.85 * screens, behavior: 'smooth' });
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.target instanceof HTMLButtonElement && (event.key === ' ' || event.key === 'Enter')) return;
    const keys: Record<string, () => void> = {
      l: () => choose('laser'),
      p: () => choose('ink'),
      m: () => choose('move'),
      c: clear,
      Escape: close,
      PageDown: () => scroll(1),
      ' ': () => scroll(1),
      ArrowDown: () => scroll(0.4),
      PageUp: () => scroll(-1),
      ArrowUp: () => scroll(-0.4),
      Home: () => view.current?.scrollTo({ top: 0, behavior: 'smooth' }),
      End: () => view.current?.scrollTo({ top: view.current.scrollHeight, behavior: 'smooth' }),
    };
    const run = keys[event.key.length === 1 ? event.key.toLowerCase() : event.key];
    if (!run) return;
    event.preventDefault();
    event.stopPropagation();
    run();
  };

  const scale = width > 0 ? width / picture.width : 1;
  const box = { width: picture.width * scale, height: picture.height * scale };
  return (
    <div
      ref={stage}
      className={styles.stage}
      role="dialog"
      aria-modal="true"
      aria-label={t('pagesPlus.present.title')}
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <div ref={view} className={styles.presentView}>
        <div className={styles.presentSheet} style={box}>
          <img className={styles.presentPicture} src={url} alt={t('pageViews.image.preview')} draggable={false} />
          <canvas
            ref={canvas}
            className={styles.presentMarks}
            data-tool={tool}
            aria-hidden="true"
            onPointerDown={(event) => overlay.current?.down(event.nativeEvent, tool)}
            onPointerMove={(event) => overlay.current?.move(event.nativeEvent, tool)}
            onPointerUp={(event) => overlay.current?.up(event.nativeEvent)}
            onPointerCancel={(event) => overlay.current?.up(event.nativeEvent)}
            onPointerLeave={() => overlay.current?.leave()}
          />
        </div>
      </div>
      <div className={styles.stageBar} role="toolbar" aria-label={t('pagesPlus.present.tool')}>
        {TOOLS.map(({ id, label, key }) => (
          <Button
            key={id}
            variant={tool === id ? 'primary' : 'quiet'}
            aria-pressed={tool === id}
            onClick={() => choose(id)}
          >
            {t('pagesPlus.present.withKey', { name: t(`pagesPlus.present.tools.${label}`), key })}
          </Button>
        ))}
        <Button variant="quiet" onClick={clear}>
          {t('pagesPlus.present.withKey', { name: t('pagesPlus.present.clear'), key: 'C' })}
        </Button>
        <span className={styles.stageHelp}>{t('pagesPlus.present.help')}</span>
        <Button variant="quiet" onClick={close}>
          {t('pagesPlus.present.exit')}
        </Button>
      </div>
    </div>
  );
}
