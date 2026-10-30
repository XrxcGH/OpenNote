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
export { openHumanitiesTool } from './humanities/open';
export { insertIntoPage } from './ui/CalculatorTool';
export type { InsertDetail } from './ui/CalculatorTool';
export { loadStored, saveStored } from './ui/storage';
export { TOOLS, isToolId } from './ui/tools';
export type { ToolId } from './ui/tools';
export { runReminderCheck, showNotice, remindersOn } from './ui/notify';
export { forgetPageItems, setPageItems } from './ui/upcomingStores';
export { readUpcoming, setSourceItems, sourceItems, updateUpcomingItems } from './ui/upcomingMerge';
export { homeUpcoming } from './ui/homeUpcoming';
export { registerToolsEditor } from './editor/register';
export { LIVE_MATH_EVENT, lineAnswersOn, liveSolveOn, setLineAnswersOn, setLiveSolveOn } from './editor/liveMath';
export { default as LiveMathSetting } from './ui/LiveMathSetting';
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
