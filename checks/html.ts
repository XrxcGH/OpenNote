// Small HTML helpers for the prose and SVG rules. They are scanners, not regular expressions, and they
// repeat until the text stops changing. A single regex pass can leave a new tag or comment behind when
// removing one piece joins the text around it, as in "<<b>b>" or "<!<!-- x -->-- y -->".

interface CommentEnd {
  index: number;
  length: number;
}

/** Finds where a comment ends: "-->" or "--!>", or, right after "<!--", the short forms "<!-->" and "<!--->". */
function commentEnd(text: string, from: number, justOpened: boolean): CommentEnd | undefined {
  if (justOpened && text.startsWith('>', from)) return { index: from, length: 1 };
  if (justOpened && text.startsWith('->', from)) return { index: from, length: 2 };
  const plain = text.indexOf('-->', from);
  const bang = text.indexOf('--!>', from);
  if (plain === -1 && bang === -1) return undefined;
  if (bang === -1 || (plain !== -1 && plain < bang)) return { index: plain, length: 3 };
  return { index: bang, length: 4 };
}

interface CommentScan {
  text: string;
  /** True when the text ends inside a comment that has no end yet. */
  open: boolean;
}

/** One pass: removes each comment, and everything after an opener that has no end. */
function scanComments(text: string, startsInside: boolean): CommentScan {
  let out = '';
  let pos = 0;
  if (startsInside) {
    const end = commentEnd(text, 0, false);
    if (!end) return { text: '', open: true };
    pos = end.index + end.length;
  }
  for (;;) {
    const start = text.indexOf('<!--', pos);
    if (start === -1) return { text: out + text.slice(pos), open: false };
    out += text.slice(pos, start);
    const end = commentEnd(text, start + 4, true);
    if (!end) return { text: out, open: true };
    pos = end.index + end.length;
  }
}

/**
 * Removes the HTML comments from one line of text, until no "<!--" is left that could be removed.
 * Pass startsInside when an earlier line opened a comment that this line may close. The result says
 * whether the line ends inside a comment, so the caller can carry that to the next line.
 */
export function stripHtmlComments(line: string, startsInside = false): CommentScan {
  let current = line;
  let inside = startsInside;
  let open = false;
  for (;;) {
    const pass = scanComments(current, inside);
    open = open || pass.open;
    inside = false;
    if (pass.text === current) return { text: current, open };
    current = pass.text;
  }
}

/** Finds the ">" that ends the tag starting at `start`, skipping quoted attribute values. Returns -1 if none. */
function tagEnd(text: string, start: number): number {
  let quote = '';
  let previous = '';
  for (let i = start + 1; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = '';
    } else if ((ch === '"' || ch === "'") && previous === '=') {
      quote = ch;
    } else if (ch === '>') {
      return i;
    }
    if (!/\s/.test(ch)) previous = ch;
  }
  // A quote that never closes is not an attribute value, so the tag ends at the first ">".
  return text.indexOf('>', start);
}

/** A tag starts with "<" and a letter, "/", "!" or "?". Other uses of "<", as in "a < b", are text. */
function startsTag(text: string, index: number): boolean {
  return /[A-Za-z/!?]/.test(text[index + 1] ?? '');
}

/** One pass: removes each comment and tag, in any letter case, and puts `replacement` where each one was. */
function removeTagsOnce(text: string, replacement: string): string {
  let out = '';
  let pos = 0;
  while (pos < text.length) {
    const start = text.indexOf('<', pos);
    if (start === -1) break;
    out += text.slice(pos, start);
    pos = start + 1;
    if (text.startsWith('<!--', start)) {
      const end = commentEnd(text, start + 4, true);
      pos = end ? end.index + end.length : text.length;
      out += replacement;
    } else {
      const end = startsTag(text, start) ? tagEnd(text, start) : -1;
      if (end === -1) {
        out += '<';
      } else {
        pos = end + 1;
        out += replacement;
      }
    }
  }
  return out + text.slice(pos);
}

/**
 * Removes HTML tags and comments, repeating until the text is stable, so that "<<b>b>" cannot leave a
 * "<b>" behind. The replacement must not contain "<".
 */
export function stripHtmlTags(text: string, replacement = ''): string {
  let current = text;
  for (;;) {
    const next = removeTagsOnce(current, replacement);
    if (next === current) return current;
    current = next;
  }
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"' };

/**
 * Turns "&amp;", "&lt;", "&gt;" and "&quot;" back into characters in one pass, so a decoded "&" is never
 * decoded a second time: "&amp;lt;" becomes "&lt;", not "<".
 */
export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(amp|lt|gt|quot);/g, (_, name: string) => ENTITIES[name]);
}
