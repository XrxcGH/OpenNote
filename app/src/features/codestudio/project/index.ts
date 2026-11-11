// Code projects (code:L02): the block's store, path rules, fallback, device session, export, and import. The studio
// window (code:L04), the runner (code:L03, code:L16), and the tests panel (code:L15) build on these.

export {
  canEdit,
  readProject,
  sortedFiles,
  starterProject,
  utf8Bytes,
  projectBytes,
  RESERVED_ROOT_FILES,
} from './model';
export { isReservedName, pathKey, pathProblem, pathProblemAmong, pathsProblem } from './paths';
export type { PathProblem } from './paths';
export { fenceLanguage, projectFallback } from './fallback';
export { TYPING_DELAY_MS, createProjectStore, limitRefusal, pathRefusal, refusal } from './store';
export type { Outcome, PatchProject, ProjectStore, ProjectStoreOptions, Refusal, RefusalCode } from './store';
export { CONSOLE_HISTORY, clearSession, loadSession, rememberCommand, updateSession } from './session';
export type { ProjectSession } from './session';
export { exportZip, entriesOf, fileDownload, importSummary, manifestOf, planImport, readmeOf } from './exchange';
export type { ImportPlan, SkipReason } from './exchange';
export { onStudioTarget, setStudioTarget, studioTarget } from './studioTarget';
export type { StudioTarget } from './studioTarget';
export { mountCodeProject } from './mount';
export type { CodeProjectBlockProps } from './mount';
