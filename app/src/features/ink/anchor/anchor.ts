// Ink that stays with its text (spec 8.1). Underlines, circles, and margin notes are tied to the words they touch.
// An anchor holds the text block, the place in its displayed text as a count of code points, and a quote of the words
// around that place. It also holds how far the ink sits from the place. After an edit the quote finds the place again,
// and the ink moves as far as the place moved. These are the pure rules; the page view reads places off the screen.

/** The words around an anchored place, in the style of a web text-quote selector. */
export interface Quote {
  readonly prefix: string;
  readonly exact: string;
  readonly suffix: string;
}

const PREFIX = 16;
const EXACT = 12;
const SUFFIX = 16;

/** A count of code points: what an anchor stores, so an emoji counts once. */
export const codePoints = (text: string): number => Array.from(text).length;

/** The quote for a place, `at` code points into `text`. */
export function quoteAt(text: string, at: number): Quote {
  const chars = Array.from(text);
  const place = Math.max(0, Math.min(chars.length, at));
  return {
    prefix: chars.slice(Math.max(0, place - PREFIX), place).join(''),
    exact: chars.slice(place, place + EXACT).join(''),
    suffix: chars.slice(place + EXACT, place + EXACT + SUFFIX).join(''),
  };
}

/**
 * Where the anchored place is now, as code points into `text`. The stored place wins when the words there still match
 * the quote. Otherwise the nearest place where the quote reads the same wins, then the nearest where just the words
 * after the place do. When nothing matches, the place is lost and the answer is null.
 */
export function findAnchor(text: string, at: number | undefined, quote: Quote | undefined): number | null {
  const chars = Array.from(text);
  const stored = at === undefined ? null : Math.max(0, Math.min(chars.length, at));
  if (!quote || quote.exact === '') return stored;
  const whole = Array.from(quote.exact);
  const prefix = Array.from(quote.prefix);
  const suffix = Array.from(quote.suffix);
  const matches = (from: number, words: readonly string[]) => words.every((c, i) => chars[from + i] === c);
  const near = stored ?? 0;
  // Words after the place may have been edited too, so a shorter start of the quote is tried when the whole is gone.
  for (let length = whole.length; length >= Math.min(4, whole.length); length--) {
    const exact = whole.slice(0, length);
    const candidates: { place: number; score: number }[] = [];
    for (let place = 0; place + exact.length <= chars.length; place++) {
      if (!matches(place, exact)) continue;
      const before = prefix.length === 0 || (place >= prefix.length && matches(place - prefix.length, prefix));
      const after = length < whole.length ? false : suffix.length === 0 || matches(place + exact.length, suffix);
      candidates.push({ place, score: (before ? 2 : 0) + (after ? 1 : 0) });
    }
    if (candidates.length === 0) continue;
    const best = Math.max(...candidates.map((c) => c.score));
    return candidates
      .filter((c) => c.score === best)
      .reduce((a, b) => (Math.abs(b.place - near) < Math.abs(a.place - near) ? b : a)).place;
  }
  return null;
}

export interface Placed {
  readonly x: number;
  readonly y: number;
}

/** How far ink at `origin` must move to sit where its anchor says: the place plus the stored offset, minus the origin. */
export function followDelta(place: Placed, offset: { dx: number; dy: number }, origin: Placed): Placed {
  return { x: place.x + offset.dx - origin.x, y: place.y + offset.dy - origin.y };
}

/** The offset to store for ink whose top left corner is `origin`, anchored at `place`. */
export function offsetFrom(place: Placed, origin: Placed): { dx: number; dy: number } {
  return { dx: origin.x - place.x, dy: origin.y - place.y };
}

/** The anchor as the note file's ink block holds it (`data.anchor`). */
export interface AnchorData {
  readonly block: string;
  readonly at: number;
  readonly quote: Quote;
  readonly dx: number;
  readonly dy: number;
}

/** Reads `data.anchor` of an ink block, or null when it is no anchor this version understands. */
export function readAnchor(data: Record<string, unknown>): AnchorData | null {
  if (data.role !== 'anchored') return null;
  const a = data.anchor;
  if (typeof a !== 'object' || a === null) return null;
  const record = a as Record<string, unknown>;
  const q = record.quote as Record<string, unknown> | undefined;
  if (typeof record.block !== 'string') return null;
  return {
    block: record.block,
    at: typeof record.at === 'number' ? record.at : 0,
    quote: {
      prefix: typeof q?.prefix === 'string' ? q.prefix : '',
      exact: typeof q?.exact === 'string' ? q.exact : '',
      suffix: typeof q?.suffix === 'string' ? q.suffix : '',
    },
    dx: typeof record.dx === 'number' ? record.dx : 0,
    dy: typeof record.dy === 'number' ? record.dy : 0,
  };
}
