// The writing tools (Phase 12): Proofread, Rewrite, Shorten, Make a list, and Tidy structure. This engine works with
// rules and word lists, so it runs on any computer with nothing to download and sends nothing anywhere. Every tool
// returns a suggestion and never changes the page itself. A model that writes new sentences can replace this engine
// behind `WritingEngine`, and the suggestion screen, the marked changes, and Accept stay the same.
import { embed, similarity } from '../meaning/embed';

export const WRITING_TOOLS = ['proofread', 'rewrite', 'shorten', 'list', 'tidy'] as const;
export type WritingTool = (typeof WRITING_TOOLS)[number];

export interface WritingResult {
  /** The suggested text. */
  text: string;
  /** The text is Markdown, such as a list, and should be inserted as rich content and not as plain words. */
  markdown: boolean;
}

export interface WritingEngine {
  readonly name: string;
  run(tool: WritingTool, text: string): Promise<WritingResult>;
}

const matchCase = (from: string, to: string): string =>
  /^[A-Z]/.test(from) ? to.charAt(0).toUpperCase() + to.slice(1) : to;

/** Replaces each whole-word phrase with its plainer form, keeping a capital letter at the start. */
function replacePhrases(text: string, table: ReadonlyArray<readonly [string, string]>): string {
  let out = text;
  for (const [from, to] of table) {
    out = out.replace(new RegExp(`\\b${from}\\b`, 'gi'), (found) => matchCase(found, to));
  }
  return out;
}

const TYPOS: ReadonlyArray<readonly [string, string]> = [
  ['teh', 'the'],
  ['recieve', 'receive'],
  ['recieved', 'received'],
  ['definately', 'definitely'],
  ['seperate', 'separate'],
  ['occured', 'occurred'],
  ['untill', 'until'],
  ['wich', 'which'],
  ['thier', 'their'],
  ['adress', 'address'],
  ['becuase', 'because'],
  ['alot', 'a lot'],
  ['dont', "don't"],
  ['cant', "can't"],
  ['wont', "won't"],
  ['doesnt', "doesn't"],
  ['didnt', "didn't"],
  ['isnt', "isn't"],
  ['wasnt', "wasn't"],
  ['couldnt', "couldn't"],
  ['shouldnt', "shouldn't"],
  ['wouldnt', "wouldn't"],
  ['thats', "that's"],
  ['tommorow', 'tomorrow'],
  ['tomorow', 'tomorrow'],
  ['goverment', 'government'],
  ['enviroment', 'environment'],
  ['neccessary', 'necessary'],
  ['accomodate', 'accommodate'],
  ['occassion', 'occasion'],
  ['refered', 'referred'],
  ['writting', 'writing'],
  ['begining', 'beginning'],
  ['beleive', 'believe'],
  ['freind', 'friend'],
  ['wierd', 'weird'],
  ['truely', 'truly'],
];

/** Fixes spacing, doubled words, capital letters, and a list of common slips. */
export function proofread(text: string): string {
  return (
    replacePhrases(text, TYPOS)
      // Spacing: no space goes before a mark, and one goes after it when a word follows. A dot between letters stays.
      .replace(/[ \t]+([,;:!?])/g, '$1')
      .replace(/[ \t]+\.(?=\s|$)/g, '.')
      .replace(/([,;:!?])(?=[\p{L}])/gu, '$1 ')
      .replace(/(\p{Ll})\.(?=\p{Lu}\p{Ll})/gu, '$1. ')
      .replace(/[ \t]{2,}/g, ' ')
      // A word said twice in a row.
      .replace(/\b([\p{L}']+)\s+\1\b/giu, (all, word: string) => (ALLOWED_TWICE.has(word.toLowerCase()) ? all : word))
      // A lone i, and the i in i'm, i'll, i've, i'd. Not the i in i.e.
      .replace(/(?<![\p{L}\p{N}'’])i(?!\.\p{L})(?=$|[^\p{L}\p{N}])/gu, 'I')
      // The first letter of each sentence and of each line, except after an abbreviation.
      .replace(/(^|[.!?]\s+|\n\s*)(\p{Ll})/gu, (all, lead: string, letter: string, at: number, whole: string) =>
        ABBREVIATION.test(whole.slice(0, at + lead.length)) ? all : lead + letter.toUpperCase(),
      )
  );
}

/** Words that are right twice in a row: "she had had enough", "I know that that is true". */
const ALLOWED_TWICE = new Set(['had', 'that']);
/** The end of text that is an abbreviation, after which a lowercase word does not start a sentence. */
const ABBREVIATION = /\b(?:e\.g|i\.e|etc|vs|dr|mr|mrs|ms|fig|approx|cf)\.\s+$/i;

const PLAIN: ReadonlyArray<readonly [string, string]> = [
  ['in order to', 'to'],
  ['due to the fact that', 'because'],
  ['in the event that', 'if'],
  ['with regard to', 'about'],
  ['with respect to', 'about'],
  ['a number of', 'several'],
  ['is able to', 'can'],
  ['are able to', 'can'],
  ['has the ability to', 'can'],
  ['at this point in time', 'now'],
  ['prior to', 'before'],
  ['subsequent to', 'after'],
  ['in addition', 'also'],
  ['utilize', 'use'],
  ['utilise', 'use'],
  ['commence', 'begin'],
  ['approximately', 'about'],
  ['demonstrate', 'show'],
  ['assistance', 'help'],
  ['purchase', 'buy'],
  ['additional', 'more'],
  ['numerous', 'many'],
  ['sufficient', 'enough'],
  ['regarding', 'about'],
  ['subsequently', 'later'],
  ['nevertheless', 'still'],
  ['endeavor', 'try'],
  ['facilitate', 'help'],
  ['obtain', 'get'],
  ['require', 'need'],
  ['requires', 'needs'],
  ['ascertain', 'find out'],
  ['terminate', 'end'],
  ['inquire', 'ask'],
  ['attempt', 'try'],
  ['therefore', 'so'],
  ['however', 'but'],
];

/** The same text in plainer words. It changes words and phrases, never the order of the ideas. */
export function rewritePlain(text: string): string {
  return replacePhrases(text, PLAIN);
}

const FILLERS: ReadonlyArray<readonly [string, string]> = [
  ['in my opinion,?', ''],
  ['i think that', ''],
  ['it is important to note that', ''],
  ['it should be noted that', ''],
  ['needless to say,?', ''],
  ['as a matter of fact,?', ''],
  ['for all intents and purposes,?', ''],
  ['basically,?', ''],
  ['actually,?', ''],
  ['really', ''],
  ['very', ''],
  ['quite', ''],
  ['just', ''],
  ['a lot of', 'many'],
  ['in order to', 'to'],
  ['due to the fact that', 'because'],
  ['at this point in time', 'now'],
];

function sentencesOf(text: string): string[] {
  return text.match(/[^.!?\n]+[.!?]*\s*|\n+/g)?.filter((one) => one.trim() !== '') ?? [];
}

/**
 * Cuts filler words and phrases, and when the text is still long, the sentences that matter least to the rest. The
 * first sentence always stays. Nothing is added.
 */
export function shorten(text: string): string {
  let out = text;
  for (const [from, to] of FILLERS) {
    out = out.replace(new RegExp(`\\b${from}\\s*`, 'gi'), (found) => (to === '' ? '' : `${matchCase(found, to)} `));
  }
  out = out
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([,.;:!?])/g, '$1')
    .replace(/(^|[.!?]\s+)(\p{Ll})/gu, (_all, lead: string, letter: string) => lead + letter.toUpperCase());
  const sentences = sentencesOf(out);
  if (sentences.length > 3) {
    const whole = embed(out);
    const ranked = sentences
      .map((sentence, index) => ({ index, score: index === 0 ? 2 : similarity(embed(sentence), whole) }))
      .sort((a, b) => b.score - a.score);
    const keep = new Set(ranked.slice(0, Math.max(2, Math.ceil(sentences.length * 0.7))).map((one) => one.index));
    out = sentences
      .filter((_s, index) => keep.has(index))
      .join('')
      .trim();
  }
  return out.trim();
}

/** Items from lines, or from sentences, or from the parts of one long sentence. */
export function toItems(text: string): string[] {
  const lines = text
    .split(/\n+/)
    .map((line) => line.replace(/^\s*(?:[-*+•–]|\d+[.)])\s+/, '').trim())
    .filter(Boolean);
  const clean = (item: string) => item.replace(/[.;,]+$/, '').trim();
  if (lines.length > 1) return lines.map(clean);
  const sentences = sentencesOf(lines[0] ?? '').map((sentence) => sentence.trim());
  if (sentences.length > 1) return sentences.map(clean);
  const parts = (lines[0] ?? '')
    .split(/\s*(?:;|,\s+(?:and then|and|then|plus|or)\s+|,\s+|\s+and then\s+)\s*/i)
    .map(clean)
    .filter(Boolean);
  return parts.length > 1 ? parts : lines.map(clean);
}

/** A Markdown bullet list of the items. */
export function makeList(text: string): string {
  return toItems(text)
    .map((item) => `- ${item.charAt(0).toUpperCase()}${item.slice(1)}`)
    .join('\n');
}

/** One kind of bullet, steady numbering, no trailing spaces, and single blank lines. */
export function tidyStructure(text: string): string {
  const lines = text.split(/\r?\n/).map((line) => line.replace(/[ \t]+$/, ''));
  const out: string[] = [];
  for (const line of lines) {
    const bullet = /^(\s*)[•–—*+·]\s+(.*)$/.exec(line);
    const numbered = /^(\s*)(\d+)[)]\s+(.*)$/.exec(line);
    const next = bullet
      ? `${bullet[1]}- ${bullet[2]}`
      : numbered
        ? `${numbered[1]}${numbered[2]}. ${numbered[3]}`
        : line;
    if (next === '' && out.at(-1) === '') continue;
    out.push(next);
  }
  while (out[0] === '') out.shift();
  while (out.at(-1) === '') out.pop();
  return out.join('\n');
}

export const ruleBasedEngine: WritingEngine = {
  name: 'rules',
  run: (tool, text) =>
    Promise.resolve(
      tool === 'proofread'
        ? { text: proofread(text), markdown: false }
        : tool === 'rewrite'
          ? { text: rewritePlain(text), markdown: false }
          : tool === 'shorten'
            ? { text: shorten(text), markdown: false }
            : tool === 'list'
              ? { text: makeList(text), markdown: true }
              : { text: tidyStructure(text), markdown: /^\s*(?:- |\d+\. )/m.test(tidyStructure(text)) },
    ),
};

let engine: WritingEngine = ruleBasedEngine;

/** Swaps in an engine, such as one backed by a downloaded model. Returns the function that puts the old one back. */
export function useWritingEngine(next: WritingEngine): () => void {
  const before = engine;
  engine = next;
  return () => {
    if (engine === next) engine = before;
  };
}

export function writingEngine(): WritingEngine {
  return engine;
}
