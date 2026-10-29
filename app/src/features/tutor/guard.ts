// The answer-leak guard (ADR 0050). A hint before the full solution must not hand over what the student is working
// toward: the final answer, or the very line a later rung would show. The guard compares a hint with those
// "secrets" after both are written the same way (spacing, one kind of minus, LaTeX wrapping dropped), and also
// catches the value said in words, such as "x is 2" or "the answer is 2". A secret the student already wrote is not
// a secret, so it never trips the guard.

/**
 * Text in one comparable form: lower case, plain signs, LaTeX wrapping removed, and no spaces around signs or between
 * a number and its letter. Spaces between words stay, so "get 2x = 4" still shows where "2x = 4" starts.
 */
export function normalizeMath(text: string): string {
  return text
    .toLowerCase()
    .replace(/\\left|\\right|\\,|\\;|\\!|\\quad/g, ' ')
    .replace(/\\cdot|\\times|×|·/g, '*')
    .replace(/\\div|÷/g, '/')
    .replace(/[−–—]/g, '-')
    .replace(/\*\*/g, '^')
    .replace(/[{}$]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/ ?([^\w\s\\]) ?/g, '$1')
    .replace(/(\d) (?=[a-z])/g, '$1')
    .trim()
    .replace(/[.。]+$/, '');
}

/** Whether `part` stands on its own in `text`: not the tail of a longer term, nor the start of a longer number. */
function standsAlone(text: string, part: string): boolean {
  for (let at = text.indexOf(part); at >= 0; at = text.indexOf(part, at + 1)) {
    const before = text[at - 1] ?? '';
    const after = text[at + part.length] ?? '';
    if (!/[a-z0-9.^_]/.test(before) && !/[0-9.^_]/.test(after)) return true;
  }
  return false;
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The value side of a secret such as "x = 2", or null when the secret is not that shape. */
function valueOf(secret: string): { letter: string; value: string } | null {
  const found = /^\s*([a-z]{1,2})\s*=\s*(-?[\d./]+)\s*$/i.exec(secret);
  return found ? { letter: (found[1] ?? '').toLowerCase(), value: found[2] ?? '' } : null;
}

/** Whether `hint` gives away any of `secrets`. `given` is what the student wrote: what is in it is not secret. */
export function leaks(hint: string, secrets: readonly (string | null | undefined)[], given = ''): boolean {
  const said = normalizeMath(hint);
  const wrote = normalizeMath(given);
  const words = hint.toLowerCase().replace(/[−–—]/g, '-').replace(/\s+/g, ' ');
  for (const secret of secrets) {
    if (!secret) continue;
    const plain = normalizeMath(secret);
    if (plain.length === 0 || standsAlone(wrote, plain)) continue;
    if (plain.length >= 3 && standsAlone(said, plain)) return true;
    const shape = valueOf(secret);
    if (!shape) continue;
    const value = escape(shape.value);
    const letter = escape(shape.letter);
    const pattern = new RegExp(
      `(?:\\b${letter}\\s*(?:=|is|equals|must be|should be)\\s*${value}(?!\\d|[./]\\d)` +
        `|\\b(?:answer|solution|result)\\s+(?:is|=)\\s*${value}(?!\\d|[./]\\d))`,
    );
    if (pattern.test(words)) return true;
  }
  return false;
}
