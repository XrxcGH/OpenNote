// The ruler above the focused text block (text DESIGN.md 5.4). This part reads the editor: it finds the block's
// content box at the current zoom, reads the paragraph's indent and tab stops, and writes a change back as one
// command, so each drag is one undo step. The bar itself is in RulerBar.tsx.
import type { Editor } from '@tiptap/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useFlag } from '../../../app/flags';
import { paraAt, setPara } from '../../../editor/commands/paragraph';
import type { Indent, TabStop } from '../../../editor/paragraph/attributes';
import { useStore } from '../../../state/store';
import { targetEditor } from '../formattingBar/target';
import type { MountedPage } from '../mount';
import { RulerBar } from './RulerBar';
import { rulerState, rulerTabType, setRulerUnit } from './store';
import { roundPoints } from './units';
import styles from './ruler.module.css';

interface Frame {
  editor: Editor;
  /** Where the block's content box starts, in client pixels from the host's left edge. */
  left: number;
  /** The content box's width in points, as the page lays it out (before zoom). */
  width: number;
  zoom: number;
}

const NO_INDENT: Indent = { start: 0, end: 0, first: 0 };

/** The editor's content box: the page's zoom (its scale), its width, and its left edge. */
export function measureFrame(editor: Editor, host: HTMLElement): Frame | null {
  const dom = editor.view.dom as HTMLElement;
  if (!dom.isConnected || dom.offsetWidth === 0) return null;
  const rect = dom.getBoundingClientRect();
  const zoom = rect.width / dom.offsetWidth;
  const style = getComputedStyle(dom);
  const pad = (side: string) => Number.parseFloat(style.getPropertyValue(`padding-${side}`)) || 0;
  const widthPx = dom.clientWidth - pad('left') - pad('right');
  return {
    editor,
    left: rect.left + pad('left') * zoom - host.getBoundingClientRect().left,
    width: roundPoints(widthPx * 0.75),
    zoom,
  };
}

const storedIndent = (indent: Indent): Indent | null =>
  indent.start === 0 && indent.end === 0 && indent.first === 0 ? null : indent;

export function Ruler({ mounted }: { mounted: MountedPage }) {
  const allowed = useFlag('text.ruler');
  const { shown, unit } = useStore(rulerState, (state) => state);
  const tabType = useStore(rulerTabType, (type) => type);
  const host = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<Frame | null>(null);
  const [, bump] = useState(0);
  const on = allowed && shown;

  const refresh = useCallback(() => {
    const editor = targetEditor();
    setFrame(editor && host.current ? measureFrame(editor, host.current) : null);
    bump((n) => n + 1);
  }, []);

  const editor = frame?.editor;
  useEffect(() => {
    if (!on) return;
    refresh();
    const stops = [mounted.pool.onActiveChange(refresh), mounted.viewport.onCamera(refresh)];
    if (editor) {
      editor.on('transaction', refresh);
      stops.push(() => editor.off('transaction', refresh));
    }
    const observer = new ResizeObserver(refresh);
    if (host.current) observer.observe(host.current);
    window.addEventListener('resize', refresh);
    return () => {
      stops.forEach((stop) => stop());
      observer.disconnect();
      window.removeEventListener('resize', refresh);
    };
  }, [on, mounted, refresh, editor]);

  if (!on) return null;
  const para = editor && !editor.isDestroyed ? paraAt(editor.state) : null;
  const run = (key: 'indent' | 'tabs', value: unknown) => {
    if (editor) setPara(key, value)(editor.state, editor.view.dispatch);
  };
  return (
    <div ref={host} className={styles.host} hidden={!frame || !para}>
      {frame && para && (
        <div style={{ paddingInlineStart: Math.max(0, frame.left) }}>
          <RulerBar
            unit={unit}
            zoom={frame.zoom}
            width={frame.width}
            indent={para.indent ?? NO_INDENT}
            tabs={(para.tabs ?? []) as TabStop[]}
            tabType={tabType}
            onTabType={(type) => rulerTabType.set(type)}
            onUnit={setRulerUnit}
            onIndent={(next) => run('indent', storedIndent(next))}
            onTabs={(next) => run('tabs', next.length === 0 ? null : next)}
          />
        </div>
      )}
    </div>
  );
}
