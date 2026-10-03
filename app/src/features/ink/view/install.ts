// Installs the ink view on the page view's seams: the pointer tools, the Draw tab, the commands, and one ink
// surface for the page that is shown. features/page/registrations/ink.ts calls it once, after start-up.
import { isEnabled } from '../../../app/flags';
import type { CommandDef } from '../../../commands/types';
import { commandBar, commands, settingsSections } from '../../../registries';
import { getSettings, settingsStore, updateSettings } from '../../../state/settings';
import { createStore } from '../../../state/store';
import { applyToPoint } from '../geometry/matrix';
import type { Stroke } from '../geometry/types';
import type { InkHost } from './host';
import { DrawPens, DrawTools } from './DrawBar';
import { handleTouchGesture } from './gestures';
import { registerExportStrokes } from './exportSource';
import { createPenTool } from './input';
import { TouchTool } from './touch';
import { attachSelectionFrame, createFrameTool } from './selection';
import type { SelectionFrame } from './selection';
import { chooseTool, drawState, routerTool } from './state';
import type { DrawTool } from './state';
import { InkSurface } from './surface';
import { installMore } from './more';
import { installInkTestHooks } from './testHooks';

let current: { surface: InkSurface; frame: SelectionFrame; stop: () => void } | null = null;

/** The ink surface of the shown page, as a store, for the parts that sit beside the pen tool and follow the page. */
export const surfaceStore = createStore<InkSurface | null>(null, 'ink surface');

/** The ink surface of the page that is shown, for tests and the benchmark. */
export function shownSurface(): InkSurface | null {
  return current?.surface ?? null;
}

/** A stroke with its own transform applied, keeping each point's time, for the features that read handwriting. */
function placed(stroke: Stroke): Stroke {
  const { transform: m, ...rest } = stroke;
  if (!m) return stroke;
  return { ...rest, points: stroke.points.map((p) => ({ ...p, ...applyToPoint(m, p) })) };
}

/** The shown page's strokes, transforms applied: audio stamps and handwriting to text read them. */
export const shownStrokeReader = {
  all: (): Stroke[] => [...(current?.surface.index.all() ?? [])].map(placed),
  get: (ids: readonly string[]): Stroke[] => (current?.surface.strokes(ids) ?? []).map(placed),
};

function follow(host: InkHost): () => void {
  const sync = () => {
    const page = host.page.get();
    const viewport = host.viewport.get();
    const queue = host.queue.get();
    const same = current && current.surface.parts.page === page && current.surface.parts.viewport === viewport;
    if (same) return;
    current?.stop();
    current = null;
    surfaceStore.set(null);
    if (!page || !viewport || !queue || !isEnabled('ink.core')) return;
    const surface = new InkSurface({ page, viewport, queue, layer: host.layer.get() });
    const frame = attachSelectionFrame(host, surface);
    current = {
      surface,
      frame,
      stop: () => {
        frame.stop();
        surface.destroy();
      },
    };
    surfaceStore.set(surface);
  };
  const stops = [host.page.subscribe(sync), host.viewport.subscribe(sync), host.queue.subscribe(sync)];
  sync();
  return () => {
    stops.forEach((stop) => stop());
    current?.stop();
    current = null;
    surfaceStore.set(null);
  };
}

const tool = (id: `ink.${string}`, title: CommandDef['title'], to: DrawTool, flag: CommandDef['flag']): CommandDef => ({
  id,
  title,
  keywords: 'ink.tools.keywords',
  category: 'editing',
  flag,
  checked: () => drawState.get().tool === to,
  run: () => chooseTool(to),
});

export function installInk(host: InkHost): () => void {
  installInkTestHooks(() => current?.surface ?? null);
  const pen = createPenTool(host, () => current?.surface ?? null);
  const touch = new TouchTool(host, () => current?.surface ?? null);
  touch.onGesture = (kind) => handleTouchGesture(host, kind);
  const stops: (() => void)[] = [
    host.registerPointerTool(pen.tool),
    host.registerPointerTool(touch.tool),
    host.registerPointerTool(createFrameTool(() => current?.frame ?? null)),
    () => pen.destroy(),
    () => touch.destroy(),
    drawState.subscribe(() => host.setActiveTool(routerTool(drawState.get()))),
    follow(host),
    installMore({ host, surface: () => current?.surface ?? null, surfaces: surfaceStore }),
    registerExportStrokes(() => current?.surface ?? null),
    // New settings take effect at the next touch.
    settingsStore.subscribe(() => touch.reset()),
    settingsSections.register({
      id: 'penAndTouch',
      title: 'ink.settings.title',
      icon: 'Hand',
      order: 26,
      flag: 'ink.palm',
      load: () => import('./PenSettings'),
    }),
  ];
  const defs: CommandDef[] = [
    tool('ink.select', 'ink.tools.select', 'select', 'ink.core'),
    tool('ink.pen', 'ink.tools.pen', 'pen', 'ink.core'),
    tool('ink.eraser', 'ink.tools.eraser', 'eraser', 'ink.erasers'),
    tool('ink.partialEraser', 'ink.tools.partialEraser', 'partialEraser', 'ink.erasers'),
    tool('ink.lasso', 'ink.tools.lasso', 'lasso', 'ink.lasso'),
    {
      id: 'ink.inkToShape',
      title: 'ink.shapes.inkToShape',
      keywords: 'ink.shapes.keywords',
      category: 'editing',
      flag: 'ink.shapes',
      checked: () => getSettings().ink.shapes.inkToShape,
      run: () => updateSettings({ ink: { shapes: { inkToShape: !getSettings().ink.shapes.inkToShape } } }),
    },
  ];
  for (const def of defs) stops.push(commands.register(def));
  stops.push(
    commandBar.register({
      id: 'ink.tools',
      tab: 'draw',
      group: 'tools',
      command: 'ink.select',
      priority: 90,
      presentation: 'component',
      Component: DrawTools,
      flag: 'ink.core',
    }),
    commandBar.register({
      id: 'ink.pens',
      tab: 'draw',
      group: 'pens',
      command: 'ink.pen',
      priority: 80,
      presentation: 'component',
      Component: DrawPens,
      flag: 'ink.core',
    }),
    commandBar.register({
      id: 'ink.inkToShape',
      tab: 'draw',
      group: 'shapes',
      command: 'ink.inkToShape',
      priority: 50,
      presentation: 'toggle',
      flag: 'ink.shapes',
    }),
  );
  return () => stops.reverse().forEach((stop) => stop());
}
