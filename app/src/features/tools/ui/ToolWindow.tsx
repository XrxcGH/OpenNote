// A tool window (Phase 10): a small floating window with a title, a pin that keeps it above the others, a pop-out
// button where the app can open a window of its own, and a close button. It moves with a drag or, from the
// keyboard, with the arrow keys on its title. It never takes focus from the page by itself and never traps it.
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent, ReactNode } from 'react';
import { t } from '../../../strings/t';
import { tokens } from '../../../theme/tokens';
import { chromeInsets } from '../../../shell/layout/chromeInsets';
import { Button } from '../../../ui';
import { loadStored, saveStored } from './storage';
import styles from './tools.module.css';
import type { ToolDef } from './tools';

interface Place {
  x: number;
  y: number;
}

export interface ToolWindowProps {
  tool: ToolDef;
  /** Where a window without a saved place starts, so the first windows do not sit on top of each other. */
  index: number;
  /** The width, with gaps, of the windows open before this one. */
  taken?: number;
  pinned: boolean;
  onPin(): void;
  onClose(): void;
  onPopOut?(): void;
  children: ReactNode;
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** The row of chips at the top of the page (search/properties/mount.tsx): 8 px down, a chip, and the panel gap. */
const CHIP_ROW = 8 + tokens.size.chromeHit + 8;
/** The shortest a window gets when it sits low, so its title and a few lines still show. */
const MIN_HEIGHT = 160;
/** The lowest top a window can have and still keep MIN_HEIGHT above the status line, with the panel gap. */
const lowest = () => Math.max(0, window.innerHeight - chromeInsets().bottom - 8 - MIN_HEIGHT);

/**
 * Where a window with no saved place opens: left of the ones already open, so none hides another, and with no room
 * it cascades. It opens below the row of the page's chips, such as Properties, so it doesn't cover them.
 */
function firstPlace(width: number, index: number, taken: number): Place {
  const right = window.innerWidth - width - 32 - taken;
  const cascade = 16 + index * 28;
  return {
    x: Math.max(Math.min(cascade, window.innerWidth - width - 16), 16, right),
    y: chromeInsets().top + CHIP_ROW + (right < cascade ? index * 28 : 0),
  };
}

/**
 * Never above the command bar's line, and however far down it sits, the window ends above the status line and its
 * body scrolls (shell/layout/chromeInsets.ts). A window narrower than the tool keeps it inside, 16 px from each edge.
 */
function frameStyle(place: Place, width: number): CSSProperties {
  const top = `max(${place.y}px, var(--panel-top))`;
  return {
    insetInlineStart: place.x,
    insetBlockStart: top,
    inlineSize: `min(${width}px, calc(100vw - 32px))`,
    maxBlockSize: `max(${MIN_HEIGHT}px, calc(100vh - ${top} - var(--panel-bottom)))`,
  };
}

export function ToolWindow({ tool, index, taken = 0, pinned, onPin, onClose, onPopOut, children }: ToolWindowProps) {
  const title = t(tool.title);
  const [place, setPlace] = useState<Place>(() =>
    loadStored<Place>(`place.${tool.id}`, firstPlace(tool.width, index, taken)),
  );
  const drag = useRef<{ x: number; y: number; place: Place } | null>(null);
  const frame = useRef<HTMLElement>(null);

  // A smaller window pulls a tool back inside it, so no button ends up past the edge.
  useEffect(() => {
    const keepInside = () => {
      const box = frame.current;
      const width = box?.offsetWidth ?? tool.width;
      const height = box?.offsetHeight ?? 0;
      setPlace((now) => {
        const x = clamp(now.x, 8, Math.max(8, window.innerWidth - width - 8));
        const y = clamp(now.y, 0, Math.max(0, Math.min(window.innerHeight - height - 8, lowest())));
        return x === now.x && y === now.y ? now : { x, y };
      });
    };
    window.addEventListener('resize', keepInside);
    return () => window.removeEventListener('resize', keepInside);
  }, [tool.width]);

  const move = (next: Place) => {
    const width = frame.current?.offsetWidth ?? tool.width;
    const clamped = {
      x: clamp(next.x, 8 - width + 80, window.innerWidth - 80),
      y: clamp(next.y, 0, lowest()),
    };
    setPlace(clamped);
    saveStored(`place.${tool.id}`, clamped);
  };
  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest('button')) return;
    drag.current = { x: event.clientX, y: event.clientY, place };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const from = drag.current;
    if (from) move({ x: from.place.x + event.clientX - from.x, y: from.place.y + event.clientY - from.y });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) return;
    const step = event.shiftKey ? 64 : 16;
    const deltas: Record<string, Place> = {
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step },
      ArrowDown: { x: 0, y: step },
    };
    const delta = deltas[event.key];
    if (!delta) return;
    event.preventDefault();
    move({ x: place.x + delta.x, y: place.y + delta.y });
  };

  return (
    <section
      ref={frame}
      className={styles.window}
      data-tool={tool.id}
      data-pinned={pinned ? '' : undefined}
      role="dialog"
      aria-modal="false"
      aria-label={title}
      style={frameStyle(place, tool.width)}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.defaultPrevented) {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div
        className={styles.header}
        data-move=""
        tabIndex={0}
        aria-label={t('smart.tools.window.move', { title })}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => (drag.current = null)}
        onKeyDown={onKeyDown}
      >
        <h2 className={styles.title}>{title}</h2>
        <Button variant="quiet" aria-pressed={pinned} onClick={onPin}>
          {t('smart.tools.window.keepOnTop')}
        </Button>
        {onPopOut ? (
          <Button variant="quiet" onClick={onPopOut}>
            {t('smart.tools.window.popOut')}
          </Button>
        ) : null}
        <Button variant="quiet" aria-label={t('smart.tools.window.close', { title })} onClick={onClose}>
          ×
        </Button>
      </div>
      <div className={styles.body}>{children}</div>
    </section>
  );
}
