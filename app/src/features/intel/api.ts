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
  intelExt,
  loadIntel,
  onChoiceChange,
  refreshStatus,
  reportProblem,
  setFeature,
} from './runtime';
export { searchTextInImage, searchTextInInk, searchTextReady } from './search';
export { openActivityPanel } from './background/ActivityPanel';
export { enqueueBackground } from './background';
export { extrasState, isExtraOn, loadExtras } from './extras';
export {
  changeExtra,
  openAsk,
  openFindByMeaning,
  pageIsProtected,
  resumeExtras,
  toggleRelatedPages,
} from './lifecycle';
export { setPagesProtected } from './protectedPages';
export { indexPage } from './meaning/engine';
export { suggestWriting } from './writing/run';
export { getImageText, getImageWords, onImageText, queueImageText, watchImagesForText } from './background/imageText';
export { imageKey } from './background/imageText';
export type { WordBox } from './imageText';
export { editVocabularyForCurrentNotebook } from './vocabulary/open';
export { fixWithVocabulary, offerVocabularyTerm } from './vocabulary/apply';
export type { RecognizedText, RecognizedWord } from './search';
export { cloudSummary, showPageSummary, summarizeBlocks } from './summary';
export { onDeviceTranscriptEngine, transcribeOnDevice, TranscribeStopped } from './transcribe/engine';
export type { OnDeviceTranscribeRequest, OnDeviceTranscribeResult } from './transcribe/engine';
export type { PageSummary, PageText } from './summary';
export { MAX_STROKES as MAX_MATH_STROKES, readWith, recognizeMath } from './math/recognize';
export type { MathResult } from './math/recognize';
// My handwriting's uploads group traced strokes into symbols the same way the math reader does.
export { groupStrokes } from './math/group';
export type { Cluster as MathCluster, MathStroke } from './math/group';
export { listen } from './stream/listen';
export type { Listening, ListenOptions } from './stream/listen';
export { withAnswerFallback, withWritingFallback } from './localModels/fallback';
export { hostOf, loadCloud, usesCloud } from './cloud/store';
export { CloudChoice } from './cloud/CloudChoice';
