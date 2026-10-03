// Everything the page and Settings use from the intel feature besides the read-aloud engine, behind one lazy import
// (index.ts, loadApi), so none of it counts against start-up or the page's read-aloud chunk.
export { intelState, isOn } from './choices';
export { readTextInImage, textOfResult } from './imageText';
export { hasInkStrokeSource, readHandwriting, registerInkStrokeSource } from './ink';
export type { InkStrokeSource } from './ink';
export {
  askToTurnOn,
  describeProblem,
  intelClient,
  loadIntel,
  onChoiceChange,
  refreshStatus,
  reportProblem,
  setFeature,
} from './runtime';
export { searchTextInImage, searchTextInInk, searchTextReady } from './search';
export type { RecognizedText, RecognizedWord } from './search';
export { showPageSummary, summarizeBlocks } from './summary';
export type { PageSummary, PageText } from './summary';
