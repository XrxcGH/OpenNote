// The registrations of the ink lane's later features: commands, Draw tab items, and the installers of the pieces that
// sit beside the pen tool. install.ts calls it once, so the rest of the view stays as it was. Each feature adds its
// own block here, behind its own flag.
import { isEnabled } from '../../../app/flags';
import type { Chord, CommandDef } from '../../../commands/types';
import type { MessageKey } from '../../../strings/t';
import { commandBar, commands, contextMenus } from '../../../registries';
import { toggleCanvasLock, installCanvasLock } from './canvasLock';
import { anchorSelection, detachSelection, installAnchoring } from './anchoring';
import { describeDrawing } from './describe';
import { groupSelection, installGroups, selectionGrouped, ungroupSelection } from './groups';
import { installLayers } from './layers';
import { installPenFields, systemKeyboard } from './penFields';
import { installMyHand } from './myhand/install';
import { showLayers } from './LayersDialog';
import { installInkLinks, selectionLinked, unlinkSelection } from './inkLinks';
import { installLinkOpening } from './linkOpen';
import { makeLinkFromSelection, showLinkList } from './linkDialogs';
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
import { installShapeHandles, setCurveCommand } from './shapeEdit';
import { editCurve, makeCurve, selectedCurve } from './curves';
import type { CurveEdit } from './curves';
import { addTextToShape } from './shapeLibrary';
import { insertSpaceByHeight } from './space';
import { followPaper, hasPaperLines } from './paperSnap';
import { geometryTool, installSnapTools, setRulerUnits, toggleGeometryTool } from './snapTools';
import { installMeasure, measureSelection } from './measureTool';
import { installCompass } from './compass';
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
  write: 'ink.penEdit.writeInGap',
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

/** The ruler, the protractor, the grid, and paper lines are switches, so each is a command with a checked state. */
const snapCommand = (key: 'ruler' | 'protractor' | 'gridSnap' | 'paperSnap', title: MessageKey): CommandDef => ({
  id: `ink.snap.${key}`,
  title,
  keywords: 'ink.snap.keywords',
  category: 'view',
  flag: key === 'paperSnap' ? 'ink.paperSnap' : 'ink.snapTools',
  checked: () => inkPrefs.get()[key],
  run: () => setPrefs({ [key]: !inkPrefs.get()[key] }),
  // Snap to paper lines is for ruled, grid, and dot paper, and Snap to grid (its own grid) for plain paper.
  ...(key === 'paperSnap' ? { when: () => hasPaperLines() } : {}),
  ...(key === 'gridSnap' ? { when: () => !hasPaperLines() } : {}),
});

/** The ruler's units, as three choices in the command list. */
const unitsCommand = (choice: 'auto' | 'metric' | 'imperial', title: MessageKey): CommandDef => ({
  id: `ink.geometry.units.${choice}`,
  title,
  keywords: 'ink.snap.unitsKeywords',
  category: 'view',
  flag: 'ink.geometry',
  checked: () => inkPrefs.get().rulerUnits === choice,
  run: () => setRulerUnits(choice),
});

export function installMore(context: MoreContext): () => void {
  const { host, surface, surfaces } = context;
  setViewContext({ host, surface });
  const stops: (() => void)[] = [
    () => setViewContext(null),
    installHover(surface),
    installCanvasLock(host),
    followPaper(host),
    installSnapTools(host, surfaces),
    installMeasure(host, surfaces),
    installCompass(host, surfaces),
    installShapeHandles(host, surfaces),
    () => setCurveCommand(null),
    installReplay(host, surfaces),
    installZoomBox(host, surfaces),
    installAnchoring(host, surfaces),
    installGroups(host, surface),
    installInkLinks(host),
    installLinkOpening(host, surfaces),
    installLayers(host, surfaces),
    installMyHand(host, surface),
    installPenFields(document, {
      enabled: () => isEnabled('ink.penFields') && inkPrefs.get().penFields,
      keyboard: systemKeyboard,
    }),
  ];
  setCurveCommand((what: CurveEdit) => editCurve(host, surface(), what));
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
    snapCommand('paperSnap', 'ink.snap.paper'),
    {
      id: 'ink.geometry.measure',
      title: 'ink.measure.title',
      keywords: 'ink.measure.keywords',
      category: 'view',
      keys: [chord('Ctrl+Alt+Shift+R')],
      flag: 'ink.geometry',
      checked: () => geometryTool.get() === 'measure',
      run: () => toggleGeometryTool('measure'),
    },
    {
      id: 'ink.geometry.compass',
      title: 'ink.compass.title',
      keywords: 'ink.compass.keywords',
      category: 'insert',
      keys: [chord('Ctrl+Alt+Shift+C')],
      flag: 'ink.geometry',
      checked: () => geometryTool.get() === 'compass',
      run: () => toggleGeometryTool('compass'),
    },
    {
      id: 'ink.geometry.measureSelection',
      title: 'ink.measure.lineTitle',
      keywords: 'ink.measure.lineKeywords',
      category: 'view',
      flag: 'ink.geometry',
      enabled: () => host.selection.get().strokes.length > 0,
      run: () => void measureSelection(host, surface()),
    },
    unitsCommand('auto', 'ink.snap.unitsAuto'),
    unitsCommand('metric', 'ink.snap.unitsMetric'),
    unitsCommand('imperial', 'ink.snap.unitsImperial'),
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
      id: 'ink.curve.make',
      title: 'ink.curves.make',
      keywords: 'ink.curves.keywords',
      category: 'editing',
      flag: 'ink.splines',
      // Always enabled: the Draw tab's button does not follow the ink selection, and with nothing to work on the
      // command says what to select.
      run: () => void makeCurve(host, surface()),
    },
    ...(
      [
        ['ink.curve.addPoint', 'ink.curves.addPoint', 'add'],
        ['ink.curve.removePoint', 'ink.curves.removePoint', 'remove'],
        ['ink.curve.smooth', 'ink.curves.smooth', 'smooth'],
        ['ink.curve.corner', 'ink.curves.corner', 'corner'],
      ] as const
    ).map(([id, title, what]): CommandDef => ({
      id,
      title,
      keywords: 'ink.curves.keywords',
      category: 'editing',
      flag: 'ink.splines',
      enabled: () => selectedCurve(host, surface()) !== null,
      run: () => void editCurve(host, surface(), what),
    })),
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
    {
      id: 'ink.group',
      title: 'ink.groups.group',
      keywords: 'ink.groups.keywords',
      category: 'editing',
      keys: [chord('Ctrl+G')],
      flag: 'ink.groups',
      enabled: () => host.selection.get().blocks.length + host.selection.get().strokes.length >= 2,
      run: () => {
        const current = surface();
        if (current) void groupSelection(host, current);
      },
    },
    {
      id: 'ink.ungroup',
      title: 'ink.groups.ungroup',
      keywords: 'ink.groups.keywords',
      category: 'editing',
      keys: [chord('Ctrl+Shift+G')],
      flag: 'ink.groups',
      enabled: () => selectionGrouped(host),
      run: () => {
        const current = surface();
        if (current) void ungroupSelection(host, current);
      },
    },
    {
      id: 'ink.makeLink',
      title: 'ink.links.make',
      keywords: 'ink.links.keywords',
      category: 'editing',
      flag: 'ink.links',
      enabled: () => host.selection.get().strokes.length > 0,
      run: () => {
        const current = surface();
        if (current) void makeLinkFromSelection(host, current);
      },
    },
    {
      id: 'ink.removeLink',
      title: 'ink.links.remove',
      keywords: 'ink.links.keywords',
      category: 'editing',
      flag: 'ink.links',
      enabled: () => selectionLinked(host),
      run: () => {
        const current = surface();
        if (current) void unlinkSelection(host, current);
      },
    },
    {
      id: 'ink.links',
      title: 'ink.links.list',
      keywords: 'ink.links.keywords',
      category: 'editing',
      flag: 'ink.links',
      run: () => {
        const current = surface();
        if (current) void showLinkList(host, current);
      },
    },
    {
      id: 'ink.layers',
      title: 'ink.layers.title',
      keywords: 'ink.layers.keywords',
      category: 'editing',
      flag: 'ink.layers',
      run: () => {
        const current = surface();
        if (current) void showLayers(current);
      },
    },
    gestureCommand('scribbleErase'),
    gestureCommand('circleSelect'),
    gestureCommand('twoFingerUndo'),
    gestureCommand('threeFingerRedo'),
  ];
  for (const def of defs) stops.push(commands.register(def));
  // The page's own menu offers the measure and the compass, and the length of the selected line.
  for (const [order, command] of [
    [60, 'ink.geometry.measure'],
    [61, 'ink.geometry.compass'],
    [62, 'ink.geometry.measureSelection'],
  ] as const) {
    stops.push(
      contextMenus.register({
        id: `page.canvas.${command}`,
        menu: 'page.canvas',
        command,
        group: 'geometry',
        order,
        flag: 'ink.geometry',
      }),
    );
  }
  // Selected text boxes and images offer Group and Ungroup in their own menu (features/page/chrome/menu.ts).
  for (const [order, command] of [
    [900, 'ink.group'],
    [901, 'ink.ungroup'],
  ] as const) {
    stops.push(
      contextMenus.register({
        id: `page.object.${command}`,
        menu: 'page.object',
        command,
        group: 'group',
        order,
        flag: 'ink.groups',
      }),
    );
  }
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
      // In More, each switch the group shows: on lined paper, Snap to paper lines in place of Snap to grid.
      overflow: [
        'ink.snap.ruler',
        'ink.snap.protractor',
        'ink.snap.paperSnap',
        'ink.snap.gridSnap',
        'ink.geometry.measure',
        'ink.geometry.compass',
        'ink.geometry.units.auto',
        'ink.geometry.units.metric',
        'ink.geometry.units.imperial',
      ],
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
      id: 'ink.curve.make',
      tab: 'draw',
      group: 'shapes',
      command: 'ink.curve.make',
      priority: 50,
      presentation: 'button',
      flag: 'ink.splines',
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
