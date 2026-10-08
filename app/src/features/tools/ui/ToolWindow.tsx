// A tool window (Phase 10): a small floating window with a title, a pin that keeps it above the others, a pop-out
// button where the app can open a window of its own, and a close button. It moves with a drag or, from the
// keyboard, with the arrow keys on its title. It never takes focus from the page by itself and never traps it.
import { useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent, ReactNode } from 'react';
import { t } from '../../../strings/t';
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
  pinned: boolean;
  onPin(): void;
  onClose(): void;
  onPopOut?(): void;
  children: ReactNode;
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

export function ToolWindow({ tool, index, pinned, onPin, onClose, onPopOut, children }: ToolWindowProps) {
  const title = t(tool.title);
  const [place, setPlace] = useState<Place>(() =>
    loadStored<Place>(`place.${tool.id}`, {
      x: Math.max(16, window.innerWidth - tool.width - 32 - index * 28),
      y: 72 + index * 28,
    }),
  );
  const drag = useRef<{ x: number; y: number; place: Place } | null>(null);
  const frame = useRef<HTMLElement>(null);

  const move = (next: Place) => {
    const width = frame.current?.offsetWidth ?? tool.width;
    const clamped = {
      x: clamp(next.x, 8 - width + 80, window.innerWidth - 80),
      y: clamp(next.y, 0, window.innerHeight - 40),
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
      style={{ insetInlineStart: place.x, insetBlockStart: place.y, inlineSize: tool.width }}
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
