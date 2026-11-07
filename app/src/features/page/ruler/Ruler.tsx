// The ruler above the focused text block (text DESIGN.md 5.4). This part reads the editor. It finds the content box
// at the current zoom and reads the indent and tab stops. It writes a change back as one command. The bar is RulerBar.
import type { Editor } from '@tiptap/core';
import type { RefObject } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useFlag } from '../../../app/flags';
import { paraAt, setPara } from '../../../editor/commands/paragraph';
import type { Indent, ParaFormat, TabStop } from '../../../editor/paragraph/attributes';
import { useStore } from '../../../state/store';
import { targetEditor } from '../formattingBar/target';
import type { MountedPage } from '../mount';
import { t } from '../../../strings/t';
import { RulerBar, TabTypeButton, UnitSelect } from './RulerBar';
import { rulerState, rulerTabType, setRulerUnit } from './store';
import { roundPoints } from './units';
import styles from './ruler.module.css';

interface Frame {
  editor: Editor;
  /** Where the block's content box starts, in client pixels from the clip's left edge. It is negative when the page
   * is panned left of the ruler. */
  left: number;
  /** The content box's width in points, as the page lays it out (before zoom). */
  width: number;
  zoom: number;
}

const sameFrame = (a: Frame | null, b: Frame | null): boolean =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.editor === b.editor &&
    Math.abs(a.left - b.left) < 0.05 &&
    a.width === b.width &&
    Math.abs(a.zoom - b.zoom) < 0.0005);

/** A key for the paragraph parts the ruler shows, so a keystroke that changes neither redraws nothing. */
const paraKey = (para: ParaFormat | null): string =>
  para ? JSON.stringify([para.indent ?? null, para.tabs ?? null]) : '';

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

/** The frame and paragraph of the target editor, measured only when something that moves them changes. */
function useRulerFrame(mounted: MountedPage, on: boolean, clip: RefObject<HTMLDivElement | null>) {
  const [frame, setFrame] = useState<Frame | null>(null);
  const [para, setPara_] = useState<ParaFormat | null>(null);
  // Measuring forces a layout, so it runs only when the camera, the window, the active block, or the clip's size
  // changes, once per frame at most. A keystroke only reads the paragraph, which is cheap.
  const frameAt = useRef(0);
  const readPara = useCallback((editor: Editor | null) => {
    const next = editor && !editor.isDestroyed ? paraAt(editor.state) : null;
    setPara_((previous) => (paraKey(previous) === paraKey(next) ? previous : next));
  }, []);
  const measure = useCallback(() => {
    const editor = targetEditor();
    const next = editor && clip.current ? measureFrame(editor, clip.current) : null;
    setFrame((previous) => (sameFrame(previous, next) ? previous : next));
    readPara(next?.editor ?? null);
  }, [clip, readPara]);
  const refresh = useCallback(() => {
    if (frameAt.current) return;
    frameAt.current = requestAnimationFrame(() => {
      frameAt.current = 0;
      measure();
    });
  }, [measure]);

  const editor = frame?.editor;
  useEffect(() => {
    if (!on) return;
    refresh();
    const stops = [mounted.pool.onActiveChange(refresh), mounted.viewport.onCamera(refresh)];
    const onTransaction = () => readPara(editor ?? null);
    if (editor) {
      editor.on('transaction', onTransaction);
      stops.push(() => editor.off('transaction', onTransaction));
    }
    const observer = new ResizeObserver(refresh);
    if (clip.current) observer.observe(clip.current);
    window.addEventListener('resize', refresh);
    return () => {
      stops.forEach((stop) => stop());
      observer.disconnect();
      window.removeEventListener('resize', refresh);
      cancelAnimationFrame(frameAt.current);
      frameAt.current = 0;
    };
  }, [on, mounted, clip, refresh, readPara, editor]);
  return { frame, para, editor };
}

export function Ruler({ mounted }: { mounted: MountedPage }) {
  const allowed = useFlag('text.ruler');
  const { shown, unit } = useStore(rulerState, (state) => state);
  const tabType = useStore(rulerTabType, (type) => type);
  const clip = useRef<HTMLDivElement>(null);
  const on = allowed && shown;
  const { frame, para, editor } = useRulerFrame(mounted, on, clip);

  if (!on) return null;
  const ready = frame !== null && para !== null;
  const run = (key: 'indent' | 'tabs', value: unknown) => {
    if (editor) setPara(key, value)(editor.state, editor.view.dispatch);
  };
  return (
    <div className={styles.host} data-ruler-host>
      <span className={styles.control} hidden={!ready}>
        <TabTypeButton tabType={tabType} onTabType={(type) => rulerTabType.set(type)} />
      </span>
      <div ref={clip} className={styles.clip}>
        {ready ? (
          <div className={styles.shift} style={{ transform: `translateX(${frame.left}px)` }}>
            <RulerBar
              unit={unit}
              zoom={frame.zoom}
              width={frame.width}
              indent={para.indent ?? NO_INDENT}
              tabs={(para.tabs ?? []) as TabStop[]}
              tabType={tabType}
              onIndent={(next) => run('indent', storedIndent(next))}
              onTabs={(next) => run('tabs', next.length === 0 ? null : next)}
              onRelease={() => editor?.commands.focus()}
            />
          </div>
        ) : (
          <p className={styles.needsText}>{t('textRuler.needsText')}</p>
        )}
      </div>
      <span className={styles.control} hidden={!ready}>
        <UnitSelect unit={unit} onUnit={setRulerUnit} />
      </span>
    </div>
  );
}
