// The study feature's public face (Study tools): decks, the schedule, card making, import and export, and the panel
// the Flashcards window and the flashcard block show. Heavy parts load on first use.
export { dayKey, daysBetween, isDayKey } from './deck/dates';
export { requestCards } from './deck/request';
export { cardRequest, importWanted } from './deck/request';
export {
  decksStore,
  createDeck,
  deckById,
  pageDeckId,
  setDeckExam,
  syncInlineDeck,
  forgetInlineDeck,
} from './deck/library';
export { inlineCards } from './deck/inline';
export { DeckPanel } from './ui/DeckPanel';
export { CardFace } from './ui/Review';
export type { Card, Deck } from './deck/types';
export { mountDeck, mountQuiz, mountTape } from './ui/mount';
export { pickQuestions, score as quizScore } from './deck/quiz';
export { sectionText } from './deck/sectionText';
export { saveBytes } from './io/save';
export { ANSWER_KEY_ID, blankTape, blankText, tapeIds } from './tape/blanks';
export type { TapeLabels } from './tape/blanks';
export { measureTape, shareInside } from './tape/coverage';
export { examModelOn, examRequest, examsOn, requestExam, setExamModelOn, setExamsOn } from './exam/request';
export type { ExamScope } from './exam/request';
export { pagesUnder, readPages } from './exam/sources';
export { examSectionTitle } from './exam/save';
/** The Practice exams window, loaded the first time it opens. */
export const loadExamPanel = () => import('./ui/exam/ExamPanel');
/** The Practice exams switches in Settings, then Editing. */
export const loadExamSettings = () => import('./ui/exam/ExamSettings');
