// The study and productivity tools' public face. The cores hold logic only, with no DOM and no React. The tool
// windows (ui/) show them: timers, the calculator with its graphing tab, and Upcoming.

export * from './timers';
export * from './calculator';
export * from './upcoming';
export { closeTool, openTool, openTools, resetToolWindows } from './ui/host';
export { openMathKit } from './mathkit/open';
export { CALCULATOR_MODES, openCalculator } from './ui/calculatorMode';
export { openPhysicsTool } from './physics/open';
export type { CalculatorMode } from './ui/calculatorMode';
export { PoppedTool } from './ui/PoppedTool';
export { countFigures } from './science/sigfigs';
export { seedSigFigs } from './ui/SigFigsTool';
export { requestWord } from './dictionary/request';
export { INSERT_EVENT } from './flags';
// Loads on first use, so the kit's opener stays out of every window that imports this file.
export const openMindKit = async (tool?: string): Promise<void> => (await import('./mind/open')).openMindKit(tool);
export { insertIntoPage } from './ui/insert';
export type { InsertDetail } from './ui/insert';
export { loadStored, saveStored } from './ui/storage';
export { TOOLS, isToolId } from './ui/tools';
export { MOLBIO_TOOLS } from './molbio/meta';
export type { MolToolId } from './molbio/meta';
export type { ToolId } from './ui/tools';
export type { ReasoningToolId } from './reasoning/meta';
export { runReminderCheck, showNotice, remindersOn } from './ui/notify';
export { forgetPageItems, setPageItems } from './ui/upcomingStores';
export { readUpcoming, setSourceItems, sourceItems, updateUpcomingItems } from './ui/upcomingMerge';
export { homeUpcoming } from './ui/homeUpcoming';
export { registerToolsEditor } from './editor/register';
export { CIVIL_ICONS, CIVIL_TOOL_IDS } from './civil/meta';
export { LIVE_MATH_EVENT, lineAnswersOn, liveSolveOn, setLineAnswersOn, setLiveSolveOn } from './editor/liveMath';
export { default as LiveMathSetting } from './ui/LiveMathSetting';
export { MUSIC_TOOLS } from './music/meta';
export type { MusicToolId } from './music/meta';
export { openDesignKit } from './design/open';
// The tool kits (features/tools/kits/README.md). Registering a kit and opening a tool are light enough for start-up;
// the numerics, properties, units, and interface load with loadKits, inside a kit's own lazy window.
export {
  followKitForm,
  onKitInputs,
  onKitTab,
  openKitTool,
  readFormInputs,
  registerFormKit,
  registerKit,
  savedKitTab,
  selectKitTab,
  takeKitInputs,
} from './kits/registry';
export type { FormInputs, KitId, KitOpener } from './kits/registry';
export type { KitDef, KitInsertContent, KitResultRow, KitStep, KitToolDef, KitToolProps } from './kits/types';
export const loadKits = () => import('./kits');
// The kit figure block's page view (features/tools/subjects/figure), loaded when a page shows a figure.
export const loadKitFigure = () => import('./subjects/figure/block');
export { CHEMMAT_META } from './chemmat/meta';
export { openChemMatTool } from './chemmat/open';

/** A kit's opener that loads its module on first use, so the kits stay out of every window that imports this file. */
function later<M, K extends keyof M>(load: () => Promise<M>, name: K) {
  type Args = M[K] extends (...args: infer A) => unknown ? A : never;
  return async (...args: Args): Promise<void> => {
    await ((await load())[name] as (...args: Args) => unknown)(...args);
  };
}

export const openStatModelsKit = later(() => import('./statmodels/open'), 'openStatModelsKit');
export const openHumanitiesTool = later(() => import('./humanities/open'), 'openHumanitiesTool');
export const openMolBio = later(() => import('./molbio/open'), 'openMolBio');
export const openLifeSys = later(() => import('./lifesys/open'), 'openLifeSys');
export const reopenLifeSys = later(() => import('./lifesys/open'), 'reopenLifeSys');
export const openReasoningKit = later(() => import('./reasoning/open'), 'openReasoningKit');
export const openCivilTool = later(() => import('./civil/open'), 'openCivilTool');
export const reopenCivilCalc = later(() => import('./civil/open'), 'reopenCivilCalc');
export const openModPhys = later(() => import('./modphys/open'), 'openModPhys');
export const openEarthKit = later(() => import('./earth/open'), 'openEarthKit');
export const openMusicKit = later(() => import('./music/open'), 'openKit');
