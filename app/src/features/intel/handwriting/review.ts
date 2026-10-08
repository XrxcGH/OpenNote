// The step between recognizing handwriting and adding it to the page: the symbols and formulas are tidied, and when
// the recognizer was unsure of some words the person reviews them first. With no unsure words nothing is shown.
import type { InkRecognition } from '../../../services/intel';
import { reviewLines, reviewText, unsureCount } from './extras';

/** The lines to insert, or null when the person canceled the review. */
export async function reviewHandwriting(recognition: InkRecognition): Promise<string[] | null> {
  const lines = reviewLines(recognition);
  if (unsureCount(lines) === 0) return reviewText(lines);
  const { reviewRecognizedLines } = await import('./ReviewDialog');
  return reviewRecognizedLines(lines);
}
