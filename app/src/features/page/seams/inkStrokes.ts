// The shown page's strokes for the page features that read handwriting without drawing it: audio stamps (a stroke
// drawn while a recording ran plays from that moment) and handwriting to text. The ink view lives in features/ink
// and loads with the first page shown; registrations/ink.ts sets the reader once it has. Until then there are none.

/** A stroke as these features need it: its ID, its points in page units, and when it was drawn. */
export interface ShownStroke {
  readonly id: string;
  /** Unix milliseconds. */
  readonly startTime: number;
  /** With the stroke's own transform applied. `time` is milliseconds after the start, when the pen gave one. */
  readonly points: readonly { readonly x: number; readonly y: number; readonly time?: number }[];
}

export interface InkStrokeReader {
  /** Every stroke of the shown page. */
  all(): Iterable<ShownStroke>;
  /** The strokes with these IDs. IDs it doesn't know are left out. */
  get(ids: readonly string[]): ShownStroke[];
}

let reader: InkStrokeReader | null = null;

/** Sets the reader. Returns the function that takes it back. */
export function setInkStrokeReader(next: InkStrokeReader): () => void {
  reader = next;
  return () => {
    if (reader === next) reader = null;
  };
}

export function shownStrokes(ids?: readonly string[]): ShownStroke[] {
  if (!reader) return [];
  return ids ? reader.get(ids) : [...reader.all()];
}
