// Everything the page and Settings use from the intel feature besides the read-aloud engine, behind one lazy import
// (index.ts, loadApi), so none of it counts against start-up or the page's read-aloud chunk.
export { intelState, isOn } from './choices';
export { readTextInImage, textOfResult } from './imageText';
export { hasInkStrokeSource, readHandwriting, readHandwritingWords, registerInkStrokeSource } from './ink';
export { reviewHandwriting } from './handwriting/review';
export { alternativesFor, isUnsure as isUnsureWord, tidyRecognizedText } from './handwriting/extras';
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
export { openActivityPanel } from './background/ActivityPanel';
export { extrasState, isExtraOn, loadExtras } from './extras';
export { changeExtra, openAsk, openFindByMeaning, resumeExtras, toggleRelatedPages } from './lifecycle';
export { indexPage } from './meaning/engine';
export { suggestWriting } from './writing/run';
export { getImageText, onImageText, queueImageText, watchImagesForText } from './background/imageText';
export { editVocabularyForCurrentNotebook } from './vocabulary/open';
export { fixWithVocabulary, offerVocabularyTerm } from './vocabulary/apply';
export type { RecognizedText, RecognizedWord } from './search';
export { showPageSummary, summarizeBlocks } from './summary';
export type { PageSummary, PageText } from './summary';
