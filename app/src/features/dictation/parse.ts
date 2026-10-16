// What was said, as text and commands (A2-24). The speech model hears "hello comma how are you question mark" and
// writes those words; this turns the spoken marks into marks and the spoken commands into actions. Pure functions on
// strings, so every rule is tested without a microphone.

export type Step =
  { kind: 'text'; text: string } | { kind: 'newline' } | { kind: 'paragraph' } | { kind: 'undo' } | { kind: 'stop' };

/** How a mark sits against the words around it. */
type Mark = { text: string; space: 'after' | 'around' | 'before' | 'none' };

/** Spoken marks. The longest phrase wins, so "question mark" is never "question" and "mark". */
const MARKS: Record<string, Mark> = {
  period: { text: '.', space: 'after' },
  'full stop': { text: '.', space: 'after' },
  comma: { text: ',', space: 'after' },
  'question mark': { text: '?', space: 'after' },
  'exclamation mark': { text: '!', space: 'after' },
  'exclamation point': { text: '!', space: 'after' },
  colon: { text: ':', space: 'after' },
  semicolon: { text: ';', space: 'after' },
  'semi colon': { text: ';', space: 'after' },
  ellipsis: { text: '…', space: 'after' },
  'open quote': { text: '“', space: 'before' },
  'close quote': { text: '”', space: 'after' },
  'end quote': { text: '”', space: 'after' },
  'open parenthesis': { text: '(', space: 'before' },
  'open paren': { text: '(', space: 'before' },
  'close parenthesis': { text: ')', space: 'after' },
  'close paren': { text: ')', space: 'after' },
  hyphen: { text: '-', space: 'none' },
  dash: { text: '—', space: 'around' },
  'em dash': { text: '—', space: 'around' },
  'at sign': { text: '@', space: 'none' },
  ampersand: { text: '&', space: 'around' },
  'percent sign': { text: '%', space: 'after' },
  'dollar sign': { text: '$', space: 'before' },
};

const COMMANDS: Record<string, Step> = {
  'new line': { kind: 'newline' },
  newline: { kind: 'newline' },
  'new paragraph': { kind: 'paragraph' },
  'next paragraph': { kind: 'paragraph' },
  'undo that': { kind: 'undo' },
  'scratch that': { kind: 'undo' },
  'delete that': { kind: 'undo' },
  'stop dictation': { kind: 'stop' },
  'stop listening': { kind: 'stop' },
};

const MAX_WORDS = 2;
/** Marks the places where the next word touches the mark; removed once the spaces are tidied. */
const GLUE = '\u0001';
const GLUE_AND_SPACE = new RegExp(`${GLUE}[ \\t\\n]*`, 'g');
const TRAILING = /[.,!?;:]+$/;

interface Word {
  /** As the model wrote it. */
  raw: string;
  /** Lower case letters only. */
  key: string;
}

const words = (text: string): Word[] =>
  text
    .split(/\s+/)
    .filter(Boolean)
    .map((raw) => ({ raw, key: raw.toLowerCase().replace(/[^\p{L}\p{N}'-]/gu, '') }));

/** Whether the words are a whole utterance made of one command, which is how a command is told from a sentence. */
function commandFor(span: Word[]): Step | null {
  return COMMANDS[span.map((w) => w.key).join(' ')] ?? null;
}

/**
 * Splits what was said into steps. A command counts only at the edge of a phrase, where the model wrote
 * a mark or the speech began or ended. "And then new line" breaks the line. A sentence with "new line" in the
 * middle of other words stays text.
 */
export function parseSpeech(spoken: string): Step[] {
  const all = words(spoken);
  const steps: Step[] = [];
  let text = '';
  const flush = () => {
    if (text.trim()) steps.push({ kind: 'text', text: text.trim() });
    text = '';
  };
  const add = (piece: string, space: Mark['space'] = 'around') => {
    if (space === 'after') text = text.replace(/\s+$/, '') + piece + ' ';
    else if (space === 'none') text = text.replace(/\s+$/, '') + piece + GLUE;
    else if (space === 'before') text += (text && !text.endsWith(' ') ? ' ' : '') + piece + GLUE;
    else text = text.replace(/\s*$/, ' ') + piece + ' ';
  };
  for (let i = 0; i < all.length;) {
    // A command: the model usually ends it with its own punctuation, so it is tested at the edges of a phrase.
    const atEdge = i === 0 || /[.,!?;:]$/.test(all[i - 1]?.raw ?? '');
    let matched = false;
    for (let size = Math.min(MAX_WORDS, all.length - i); size >= 1 && !matched; size -= 1) {
      const span = all.slice(i, i + size);
      const phrase = span.map((w) => w.key).join(' ');
      const end = i + size >= all.length || TRAILING.test(span.at(-1)?.raw ?? '');
      const command = atEdge && end ? commandFor(span) : null;
      if (command) {
        flush();
        steps.push(command);
        i += size;
        matched = true;
      } else if (MARKS[phrase]) {
        // The model's own mark before or after a spoken one ("Hello, comma,") would double it, so it is dropped.
        text = text.replace(/[.,!?;:]\s*$/, '');
        add(MARKS[phrase].text, MARKS[phrase].space);
        i += size;
        matched = true;
      }
    }
    if (!matched) {
      const word = all[i]?.raw ?? '';
      add(word, 'around');
      i += 1;
    }
  }
  flush();
  return steps.map(tidy);
}

function tidy(step: Step): Step {
  if (step.kind !== 'text') return step;
  const text = step.text
    .replace(GLUE_AND_SPACE, '')
    .replace(/\s+([.,!?;:…”)])/g, '$1')
    .replace(/([.,!?;:]){2,}/g, (run) => run[run.length - 1] ?? '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return { kind: 'text', text };
}

/** Whether the next word should start with a capital letter, given the text before it. */
export function startsSentence(before: string): boolean {
  const trimmed = before.replace(/[”"')\s]+$/, '');
  return trimmed === '' || /[.!?…]$/.test(trimmed) || /\n\s*$/.test(before);
}

/** The text with its first letter capitalized when it opens a sentence, and left as spoken otherwise. */
export function capitalizeFor(before: string, text: string): string {
  return startsSentence(before)
    ? text.replace(/^(\P{L}*)(\p{L})/u, (_, lead: string, c: string) => lead + c.toUpperCase())
    : text;
}
