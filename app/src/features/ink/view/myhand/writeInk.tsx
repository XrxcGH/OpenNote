// Writing in the person's hand on the page (flag ink.myHandwriting). Write in my handwriting turns selected typed
// text, and its math, into ink. The person chooses whether it replaces the text or goes beside it. The ink is
// ordinary ink in the pen's own color and width, with nothing in the file to say it was generated, so it is edited,
// erased, and moved like any other. It sits on the paper's lines, wraps at the text's width, and lists any character
// the person never wrote.
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { newId } from '../../../../editor/ids';
import { t } from '../../../../strings/t';
import { announce, Dialog, RadioCard, RadioGroup, showToast, Switch } from '../../../../ui';
import { mathFigure } from '../../myhand/mathLayout';
import { placement } from '../../myhand/place';
import type { PlaceRequest } from '../../myhand/place';
import type { HandStyle } from '../../myhand/style';
import { writeRuns } from '../../myhand/write';
import type { Run, Written } from '../../myhand/write';
import type { InkStroke } from '../../model/types';
import type { InkHost, SelectedRun } from '../host';
import { activeSlot, styleOf } from '../state';
import type { InkSurface } from '../surface';
import { showMathPen } from './MathPen';
import { loadStyle, styleState } from './store';

/** The style, read from the store once. Null when there is none yet. */
export async function currentStyle(): Promise<HandStyle | null> {
  await loadStyle();
  return styleState.get().doc.style;
}

/** Written paths as ordinary strokes in the current pen's color and width. */
export function toStrokes(written: Written, surface: InkSurface, start = Date.now()): InkStroke[] {
  const pen = styleOf(activeSlot());
  // A highlighter's wide, see-through line is no good for writing, so it writes with a pen's tool in its color.
  const tool = pen.tool === 'highlighter' ? 'pen' : pen.tool;
  return written.paths
    .filter((path) => path.length > 0)
    .map((path) => ({
      id: newId(),
      tool,
      width: pen.width,
      startTime: Math.round(start + path[0].time),
      points: path.map((p) => ({ x: p.x, y: p.y, pressure: p.pressure, time: Math.max(0, p.time - path[0].time) })),
      block: surface.layerFor(),
      slot: pen.slot,
      color: pen.color,
    }));
}

/** Typed runs to the writer's runs: math becomes laid-out handwritten math. */
export function runsOf(runs: readonly SelectedRun[], style: HandStyle | null, seed: number): Run[] {
  return runs.map((run, i) =>
    run.kind === 'text'
      ? { kind: 'text', text: run.text }
      : { kind: 'figure', figure: mathFigure(run.latex, style, seed + i, run.display), display: run.display },
  );
}

/** Says what was written, and offers to add the characters that came from the neutral hand. */
export function reportMissing(missing: readonly string[]): void {
  if (missing.length === 0) {
    announce(t('myHand.write.done'));
    return;
  }
  showToast({
    message: t('myHand.write.doneMissing', { count: missing.length, chars: missing.join(' ') }),
    action: { label: t('myHand.write.addThem'), run: () => void showMathPen(missing) },
  });
}

type Choice = 'replace' | 'beside';
const CHOICE_KEY = 'opennote.myhand.writeChoice';

function remembered(): Choice | null {
  try {
    const value = window.localStorage.getItem(CHOICE_KEY);
    return value === 'replace' || value === 'beside' ? value : null;
  } catch {
    return null;
  }
}

function ChoiceDialog(props: { done: (choice: Choice | null) => void }) {
  const [choice, setChoice] = useState<Choice>('replace');
  const [remember, setRemember] = useState(false);
  const write = () => {
    if (remember) {
      try {
        window.localStorage.setItem(CHOICE_KEY, choice);
      } catch {
        // The choice is asked for again next time.
      }
    }
    props.done(choice);
  };
  return (
    <Dialog
      title={t('myHand.write.chooseTitle')}
      size="small"
      onDismiss={() => props.done(null)}
      actions={[
        { id: 'cancel', label: t('common.cancel'), variant: 'secondary', onPress: () => props.done(null) },
        { id: 'write', label: t('myHand.write.write'), variant: 'primary', onPress: write },
      ]}
    >
      <RadioGroup<Choice> label={t('myHand.write.chooseTitle')} value={choice} onChange={setChoice}>
        <RadioCard<Choice> value="replace" label={t('myHand.write.replace')} />
        <RadioCard<Choice> value="beside" label={t('myHand.write.beside')} />
      </RadioGroup>
      <Switch label={t('myHand.write.remember')} checked={remember} onChange={setRemember} />
    </Dialog>
  );
}

function askChoice(): Promise<Choice | null> {
  const saved = remembered();
  if (saved) return Promise.resolve(saved);
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  return new Promise((resolve) => {
    root.render(
      <ChoiceDialog
        done={(choice) => {
          resolve(choice);
          queueMicrotask(() => {
            root.unmount();
            host.remove();
          });
        }}
      />,
    );
  });
}

/** Where the writing for a selection goes: over the text it replaces, or beside the block. */
export function requestFor(
  choice: Choice,
  page: {
    start: { x: number; y: number };
    box: { x: number; y: number; w: number; h: number };
    pageWidth: number;
    fontSize: number;
  },
): PlaceRequest {
  const { box, start } = page;
  if (choice === 'replace')
    return { at: { x: box.x, y: start.y }, right: box.x + box.w, fontSize: page.fontSize, startX: start.x };
  const gap = page.fontSize * 2;
  const room = page.pageWidth - (box.x + box.w + gap);
  if (room >= Math.min(box.w, page.fontSize * 16)) {
    return {
      at: { x: box.x + box.w + gap, y: box.y },
      right: Math.min(page.pageWidth, box.x + box.w + gap + box.w),
      fontSize: page.fontSize,
    };
  }
  return { at: { x: box.x, y: box.y + box.h + page.fontSize * 0.5 }, right: box.x + box.w, fontSize: page.fontSize };
}

/** Write in my handwriting: the selected typed text, and its math, as the person's own ink. */
export async function writeSelection(host: InkHost, surface: InkSurface): Promise<void> {
  if (surface.readOnly) return;
  const style = await currentStyle();
  if (!style) {
    showToast({ message: t('myHand.write.noStyle') });
    return;
  }
  const selected = await host.text?.selection?.();
  const viewport = host.viewport.get();
  if (
    !selected ||
    !viewport ||
    !selected.runs.some((run) => (run.kind === 'text' ? run.text.trim() !== '' : run.latex.trim() !== ''))
  ) {
    showToast({ message: t('myHand.write.nothingSelected') });
    return;
  }
  const choice = await askChoice();
  if (!choice) return;
  const topLeft = viewport.toWorld(selected.rect.x, selected.rect.y);
  const bottomRight = viewport.toWorld(selected.rect.x + selected.rect.w, selected.rect.y + selected.rect.h);
  const start = viewport.toWorld(selected.start.x, selected.start.y);
  const box = { x: topLeft.x, y: topLeft.y, w: bottomRight.x - topLeft.x, h: bottomRight.y - topLeft.y };
  const lattice = host.paper?.get() ?? null;
  const pageWidth = lattice ? lattice.area.x + lattice.area.w : Math.max(viewport.world.offsetWidth, box.x + box.w);
  const request = requestFor(choice, { start, box, pageWidth, fontSize: selected.fontSize });
  const seed = Math.floor(Math.random() * 2 ** 31);
  const written = writeRuns(
    runsOf(selected.runs, style, seed),
    style,
    placement(lattice, request, style.metrics),
    seed,
  );
  const strokes = toStrokes(written, surface);
  if (strokes.length === 0 || !(await surface.add(strokes))) {
    showToast({ message: t('myHand.write.failed'), tone: 'danger' });
    return;
  }
  if (choice === 'replace') await host.text?.remove(selected.block, selected.from, selected.to);
  host.select({ strokes: strokes.map((s) => s.id), blocks: [] }, { announce: false });
  reportMissing(written.missing);
}
