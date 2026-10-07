// The registrations of the ink lane's later features: commands, Draw tab items, and the installers of the pieces that
// sit beside the pen tool. install.ts calls it once, so the rest of the view stays as it was. Each feature adds its
// own block here, behind its own flag.
import type { Chord, CommandDef } from '../../../commands/types';
import type { MessageKey } from '../../../strings/t';
import { commandBar, commands } from '../../../registries';
import { toggleCanvasLock, installCanvasLock } from './canvasLock';
import { anchorSelection, detachSelection, installAnchoring } from './anchoring';
import { describeDrawing } from './describe';
import { convertSelectionToTable } from './gridTable';
import { convertSelection, tidySelection } from './handwriting';
import { EDIT_GESTURES } from './penEditing';
import type { EditGesture } from './penEditing';
import { chooseTool, drawState } from './state';
import { strokeHooks } from './strokeHooks';
import { getSettings, updateSettings } from '../../../state/settings';
import { DrawOptions } from './DrawOptions';
import { DrawSnap } from './DrawSnap';
import type { Store } from '../../../state/store';
import type { InkHost } from './host';
import { setViewContext } from './context';
import { DrawShapes } from './DrawShapes';
import { installHover } from './hover';
import { installReplay, startReplay } from './replay';
import { installZoomBox, toggleZoomBox } from './zoomBox';
import { installShapeHandles } from './shapeEdit';
import { addTextToShape } from './shapeLibrary';
import { insertSpaceByHeight } from './space';
import { installSnapTools } from './snapTools';
import { inkPrefs, setPrefs } from './prefs';
import type { InkSurface } from './surface';

/** What the later features need from the view that installed them. */
export interface MoreContext {
  readonly host: InkHost;
  readonly surface: () => InkSurface | null;
  /** The same surface as a store, for the parts that follow the page. */
  readonly surfaces: Store<InkSurface | null>;
}

const chord = (value: string) => value as Chord;

type GestureKey = 'scribbleErase' | 'circleSelect' | 'twoFingerUndo' | 'threeFingerRedo';

/** One switch for each gesture, listed with the commands so the shortcut list shows it and it can be turned off. */
const gestureCommand = (key: GestureKey): CommandDef => ({
  id: `ink.gestures.${key}`,
  title: `ink.gestures.${key}`,
  keywords: 'ink.gestures.keywords',
  category: 'editing',
  flag: 'ink.gestures',
  checked: () => getSettings().ink.gestures[key],
  run: () => void updateSettings({ ink: { gestures: { [key]: !getSettings().ink.gestures[key] } } }),
});

const EDIT_TITLES: Record<EditGesture, MessageKey> = {
  strike: 'ink.penEdit.strikeThrough',
  space: 'ink.penEdit.addSpace',
  split: 'ink.penEdit.splitParagraph',
  circle: 'ink.penEdit.circleSelect',
};

/** Each pen edit of typed text has its own switch in the command list. */
const penEditCommand = (which: EditGesture): CommandDef => ({
  id: `ink.penEdit.${which}`,
  title: EDIT_TITLES[which],
  keywords: 'ink.penEdit.keywords',
  category: 'editing',
  flag: 'ink.penEditing',
  checked: () => inkPrefs.get().penEdit[which],
  run: () => setPrefs({ penEdit: { ...inkPrefs.get().penEdit, [which]: !inkPrefs.get().penEdit[which] } }),
});

/** The ruler, the protractor, and the grid are switches, so each is a command with a checked state. */
const snapCommand = (key: 'ruler' | 'protractor' | 'gridSnap', title: MessageKey): CommandDef => ({
  id: `ink.snap.${key}`,
  title,
  keywords: 'ink.snap.keywords',
  category: 'view',
  flag: 'ink.snapTools',
  checked: () => inkPrefs.get()[key],
  run: () => setPrefs({ [key]: !inkPrefs.get()[key] }),
});

export function installMore(context: MoreContext): () => void {
  const { host, surface, surfaces } = context;
  setViewContext({ host, surface });
  const stops: (() => void)[] = [
    () => setViewContext(null),
    installHover(surface),
    installCanvasLock(host),
    installSnapTools(host, surfaces),
    installShapeHandles(host, surfaces),
    installReplay(host, surfaces),
    installZoomBox(host, surfaces),
    installAnchoring(host, surfaces),
  ];
  const defs: CommandDef[] = [
    {
      id: 'ink.canvasLock',
      title: 'ink.canvasLock.title',
      keywords: 'ink.canvasLock.keywords',
      category: 'view',
      keys: [chord('Ctrl+Alt+Shift+L')],
      flag: 'ink.canvasLock',
      checked: () => inkPrefs.get().canvasLock,
      run: toggleCanvasLock,
    },
    {
      id: 'ink.hover',
      title: 'ink.hover.title',
      keywords: 'ink.hover.keywords',
      category: 'view',
      flag: 'ink.hover',
      checked: () => inkPrefs.get().hover,
      run: () => setPrefs({ hover: !inkPrefs.get().hover }),
    },
    {
      id: 'ink.describe',
      title: 'ink.describe.title',
      keywords: 'ink.describe.keywords',
      category: 'editing',
      flag: 'ink.describe',
      run: () => {
        const current = surface();
        if (current) void describeDrawing(host, current);
      },
    },
    {
      id: 'ink.insertSpace',
      title: 'ink.space.title',
      keywords: 'ink.space.keywords',
      category: 'insert',
      flag: 'ink.insertSpace',
      run: () => {
        const current = surface();
        if (current) void insertSpaceByHeight(host, current);
      },
    },
    snapCommand('ruler', 'ink.snap.ruler'),
    snapCommand('protractor', 'ink.snap.protractor'),
    snapCommand('gridSnap', 'ink.snap.grid'),
    {
      id: 'ink.convertToTable',
      title: 'ink.gridTable.convert',
      keywords: 'ink.gridTable.keywords',
      category: 'insert',
      flag: 'ink.gridTable',
      enabled: () => host.selection.get().strokes.length > 0,
      run: () => {
        const current = surface();
        if (current) void convertSelectionToTable(host, current);
      },
    },
    {
      id: 'ink.addShapeText',
      title: 'ink.library.addTextTitle',
      keywords: 'ink.library.keywords',
      category: 'insert',
      flag: 'ink.shapeTools',
      run: () => {
        const current = surface();
        if (current) void addTextToShape(host, current);
      },
    },
    {
      id: 'ink.replay',
      title: 'ink.replay.title',
      keywords: 'ink.replay.keywords',
      category: 'view',
      flag: 'ink.replay',
      run: () => {
        const current = surface();
        if (current) startReplay(host, current);
      },
    },
    ...EDIT_GESTURES.map(penEditCommand),
    {
      id: 'ink.writing',
      title: 'ink.tools.writing',
      keywords: 'ink.handwriting.writingKeywords',
      category: 'editing',
      flag: 'ink.handwriting',
      checked: () => drawState.get().tool === 'writing',
      run: () => chooseTool('writing'),
    },
    {
      id: 'ink.writing.showInk',
      title: 'ink.handwriting.showInk',
      keywords: 'ink.handwriting.writingKeywords',
      category: 'editing',
      flag: 'ink.handwriting',
      run: () => strokeHooks()?.toggleWrittenInk(),
    },
    {
      id: 'ink.handwriting.convert',
      title: 'ink.handwriting.convert',
      keywords: 'ink.handwriting.convertKeywords',
      category: 'editing',
      flag: 'ink.handwriting',
      when: () => host.selection.get().strokes.length > 0,
      run: () => {
        const current = surface();
        if (current) void convertSelection(host, current);
      },
    },
    {
      id: 'ink.handwriting.straighten',
      title: 'ink.handwriting.straighten',
      keywords: 'ink.handwriting.tidyKeywords',
      category: 'editing',
      flag: 'ink.handwriting',
      when: () => host.selection.get().strokes.length > 0,
      run: () => {
        const current = surface();
        if (current) void tidySelection(host, current, { kind: 'straighten' });
      },
    },
    {
      id: 'ink.handwriting.evenSpacing',
      title: 'ink.handwriting.evenSpacing',
      keywords: 'ink.handwriting.tidyKeywords',
      category: 'editing',
      flag: 'ink.handwriting',
      when: () => host.selection.get().strokes.length > 0,
      run: () => {
        const current = surface();
        if (current) void tidySelection(host, current, { kind: 'evenSpacing' });
      },
    },
    {
      id: 'ink.zoomBox',
      title: 'ink.zoomBox.title',
      keywords: 'ink.zoomBox.keywords',
      category: 'view',
      keys: [chord('Ctrl+Alt+Shift+Z')],
      flag: 'ink.zoomBox',
      checked: () => inkPrefs.get().zoomBox,
      run: toggleZoomBox,
    },
    {
      id: 'ink.anchor',
      title: 'ink.anchor.anchor',
      keywords: 'ink.anchor.keywords',
      category: 'editing',
      flag: 'ink.anchoring',
      when: () => host.selection.get().strokes.length > 0,
      run: () => {
        const current = surface();
        if (current) void anchorSelection(host, current);
      },
    },
    {
      id: 'ink.detach',
      title: 'ink.anchor.detach',
      keywords: 'ink.anchor.keywords',
      category: 'editing',
      flag: 'ink.anchoring',
      when: () => host.selection.get().strokes.length > 0,
      run: () => {
        const current = surface();
        if (current) void detachSelection(host, current);
      },
    },
    {
      id: 'ink.anchorToText',
      title: 'ink.anchor.auto',
      keywords: 'ink.anchor.keywords',
      category: 'editing',
      flag: 'ink.anchoring',
      checked: () => getSettings().ink.anchorToText,
      run: () => void updateSettings({ ink: { anchorToText: !getSettings().ink.anchorToText } }),
    },
    gestureCommand('scribbleErase'),
    gestureCommand('circleSelect'),
    gestureCommand('twoFingerUndo'),
    gestureCommand('threeFingerRedo'),
  ];
  for (const def of defs) stops.push(commands.register(def));
  stops.push(
    commandBar.register({
      id: 'ink.options',
      tab: 'draw',
      group: 'tools',
      command: 'ink.lasso',
      priority: 70,
      presentation: 'component',
      Component: DrawOptions,
      flag: 'ink.erasers',
    }),
    commandBar.register({
      id: 'ink.snap',
      tab: 'draw',
      group: 'snap',
      command: 'ink.snap.ruler',
      priority: 45,
      presentation: 'component',
      Component: DrawSnap,
      flag: 'ink.snapTools',
    }),
    commandBar.register({
      id: 'ink.library',
      tab: 'draw',
      group: 'shapes',
      command: 'ink.addShapeText',
      priority: 55,
      presentation: 'component',
      Component: DrawShapes,
      flag: 'ink.shapeTools',
    }),
    commandBar.register({
      id: 'ink.replay',
      tab: 'draw',
      group: 'review',
      command: 'ink.replay',
      priority: 25,
      presentation: 'button',
      flag: 'ink.replay',
    }),
    commandBar.register({
      id: 'ink.zoomBox',
      tab: 'draw',
      group: 'view',
      command: 'ink.zoomBox',
      priority: 35,
      presentation: 'toggle',
      flag: 'ink.zoomBox',
    }),
    commandBar.register({
      id: 'ink.canvasLock',
      tab: 'draw',
      group: 'view',
      command: 'ink.canvasLock',
      priority: 40,
      presentation: 'toggle',
      flag: 'ink.canvasLock',
    }),
    commandBar.register({
      id: 'ink.writing',
      tab: 'draw',
      group: 'tools',
      command: 'ink.writing',
      priority: 60,
      presentation: 'toggle',
      flag: 'ink.handwriting',
    }),
    commandBar.register({
      id: 'ink.insertSpace',
      tab: 'draw',
      group: 'tools',
      command: 'ink.insertSpace',
      priority: 30,
      presentation: 'button',
      flag: 'ink.insertSpace',
    }),
    commandBar.register({
      id: 'ink.describe',
      tab: 'draw',
      group: 'review',
      command: 'ink.describe',
      priority: 20,
      presentation: 'button',
      flag: 'ink.describe',
    }),
  );
  return () => stops.reverse().forEach((stop) => stop());
}
