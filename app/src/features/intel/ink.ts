// Handwriting to text (Phase 12). The pen layer of Phase 5 owns the strokes, so it registers a source that turns
// stroke IDs into points (each stroke's own transform already applied). This module asks the on-device recognizer to
// read them. The ink stays ink: the words come back as text, and the caller adds them beside the strokes.
import type { IntelClient, InkRecognition, InkStroke } from '../../services/intel';
import { askToTurnOn, intelClient, reportProblem } from './runtime';

/** What the pen layer provides. */
export interface InkStrokeSource {
  /** The strokes with these IDs, in page units. IDs it doesn't know are left out. */
  strokes(ids: readonly string[]): InkStroke[] | Promise<InkStroke[]>;
}

let source: InkStrokeSource | null = null;

/** Registers the pen layer's strokes. Returns the function that removes it. */
export function registerInkStrokeSource(next: InkStrokeSource): () => void {
  source = next;
  return () => {
    if (source === next) source = null;
  };
}

/** Whether a pen layer has registered, so the command knows it can read strokes. */
export function hasInkStrokeSource(): boolean {
  return source !== null;
}

/** The lines of a recognition as text. */
export function linesOf(recognition: InkRecognition): string[] {
  return recognition.lines.map((line) => line.text.trim()).filter(Boolean);
}

export interface HandwritingOptions {
  client?: () => Promise<IntelClient>;
  ensureOn?: () => Promise<boolean>;
}

/**
 * Reads the handwriting in the strokes with these IDs. Null when the person said not now, when no pen layer is
 * registered, or when reading failed, which is reported. An empty list means no words were found.
 */
export async function readHandwriting(
  ids: readonly string[],
  options: HandwritingOptions = {},
): Promise<string[] | null> {
  if (!source) return null;
  if (!(await (options.ensureOn ?? (() => askToTurnOn('handwriting')))())) return null;
  try {
    const strokes = await source.strokes(ids);
    if (strokes.length === 0) return [];
    const client = await (options.client ?? intelClient)();
    return linesOf(await client.recognizeInk(strokes, { kind: 'writing' }));
  } catch (error) {
    reportProblem(error, 'handwriting');
    return null;
  }
}
