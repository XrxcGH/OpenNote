// Ranking without a model (DESIGN 10.2). Every source's candidates are merged and scored. The score is
// match + source prior + proximity + frequency + recency. Ties sort alphabetically, so a document and a caret
// always give the same list.

import { t } from '../../../strings/t';
import type { CompletionContext, CompletionItem, CompletionSourceId } from '../contracts';
import { membersOf, receiverAt } from './members';
import { bindings, namesInScope } from './scope';
import type { SyntaxTree } from './scope';
import { SNIPPETS } from './snippets';
import { BUILTINS, KEYWORDS } from './tables';
import { countWords } from './tokens';

/** Each source's prior weight. */
export const PRIOR: Readonly<Record<Exclude<CompletionSourceId, 'model'>, number>> = {
  scope: 4,
  members: 4,
  keywords: 2,
  snippets: 2,
  words: 1,
  recency: 0,
};

/** How far the top item must lead the second for an explicit request to insert it (DESIGN 10.2). */
export const LEAD_MARGIN = 1;
/** The frequency bonus of the most used item in a table. */
const FREQUENCY = 1.5;
/** The recency bonus of the last accepted item. */
const RECENCY = 2;
const RECENT_KEPT = 10;

/** Items accepted earlier in this session, the latest last. Shared by every editor. */
const recent: string[] = [];

export function rememberPick(label: string): void {
  const at = recent.indexOf(label);
  if (at >= 0) recent.splice(at, 1);
  recent.push(label);
  if (recent.length > RECENT_KEPT) recent.shift();
}

export function forgetPicks(): void {
  recent.length = 0;
}

function recency(label: string): number {
  const at = recent.lastIndexOf(label);
  return at < 0 ? 0 : (RECENCY * (at + 1)) / recent.length;
}

/**
 * How well `label` matches the typed word: 3 for a prefix, 2 for a prefix in another case, 1 for the letters in
 * order with the same first letter, null for no match. An empty word matches everything at 0.
 */
export function matchScore(label: string, typed: string): number | null {
  if (!typed) return 0;
  if (label.startsWith(typed)) return 3;
  const lower = label.toLowerCase();
  const want = typed.toLowerCase();
  if (lower.startsWith(want)) return 2;
  if (lower[0] !== want[0]) return null;
  let at = 0;
  for (const char of lower) if (char === want[at]) at++;
  return at === want.length ? 1 : null;
}

/** What the ranking reads besides the context: the parsed tree and the other open files. */
export interface RankInput {
  tree?: SyntaxTree | null;
  otherTexts?: readonly string[];
}

const frequency = (rank: number, size: number): number => (size > 0 ? FREQUENCY * (1 - rank / size) : 0);

type Candidate = Omit<CompletionItem, 'score'> & { extra: number };

function details() {
  return {
    keyword: t('codeStudio.complete.detail.keyword'),
    builtin: t('codeStudio.complete.detail.builtin'),
    member: t('codeStudio.complete.detail.member'),
    module: t('codeStudio.complete.detail.module'),
    word: t('codeStudio.complete.detail.word'),
  };
}

let wordCache: { text: string; counts: Map<string, number> } | null = null;

/** Identifier counts in the file and the other open files; the last answer is kept for the next keystroke. */
function wordCounts(text: string): Map<string, number> {
  if (wordCache?.text !== text) wordCache = { text, counts: countWords(text) };
  return new Map(wordCache.counts);
}

type Details = ReturnType<typeof details>;

/** Keywords and built-ins from the bundled tables, and the language's snippets. */
function tableCandidates(language: string, detail: Details): Candidate[] {
  const list: Candidate[] = [];
  const keywords = KEYWORDS[language] ?? [];
  keywords.forEach((label, rank) => {
    const extra = frequency(rank, keywords.length);
    list.push({ label, kind: 'keyword', source: 'keywords', detail: detail.keyword, extra });
  });
  const builtins = BUILTINS[language] ?? [];
  builtins.forEach((label, rank) => {
    const extra = frequency(rank, builtins.length);
    list.push({ label, kind: 'function', source: 'keywords', detail: detail.builtin, extra });
  });
  for (const snippet of SNIPPETS[language] ?? []) {
    const note = t(`codeStudio.complete.snippets.${snippet.note}`);
    const { label, template } = snippet;
    list.push({ label, kind: 'snippet', source: 'snippets', detail: note, insert: template, snippet: true, extra: 0 });
  }
  return list;
}

/** Identifiers in the file and the other open files, by frequency; the word being typed does not count itself. */
function wordCandidates(context: CompletionContext, input: RankInput, detail: Details): Candidate[] {
  const { text, word } = context;
  const counts = wordCounts([text, ...(input.otherTexts ?? [])].join('\n'));
  if (word.text) counts.set(word.text, (counts.get(word.text) ?? 1) - 1);
  const list: Candidate[] = [];
  for (const [label, count] of counts) {
    if (count < 1 || label.length < 2) continue;
    const extra = Math.min(1, Math.log2(1 + count) / 3);
    list.push({ label, kind: 'text', source: 'words', detail: detail.word, extra });
  }
  return list;
}

function candidates(context: CompletionContext, input: RankInput): Candidate[] {
  const { language, text, word } = context;
  const detail = details();
  const receiver = receiverAt(text, word.from - 1);
  if (receiver) {
    return membersOf(language, text, receiver).map((member) => ({
      label: member.name,
      kind: member.module ? 'property' : 'method',
      source: 'members',
      detail: member.module ? detail.module : detail.member,
      extra: member.rank < 0 ? -1 : frequency(member.rank, member.size),
    }));
  }
  const scope: Candidate[] = input.tree
    ? namesInScope(bindings(input.tree, text, language), text, context.pos, word.from).map(({ name, proximity }) => ({
        label: name,
        kind: 'variable',
        source: 'scope',
        extra: proximity,
      }))
    : [];
  return [...scope, ...tableCandidates(language, detail), ...wordCandidates(context, input, detail)];
}

/** The ranked list for a context: deduplicated by label (the best source wins), best first, ties alphabetical. */
export function rank(context: CompletionContext, input: RankInput = {}): CompletionItem[] {
  const best = new Map<string, CompletionItem>();
  for (const candidate of candidates(context, input)) {
    const { extra, ...item } = candidate;
    const exact = item.label === context.word.text;
    const match = matchScore(item.label, context.word.text);
    if (match === null || (exact && !item.snippet)) continue;
    const prior = PRIOR[item.source as keyof typeof PRIOR] ?? 0;
    const score = match + prior + extra + recency(item.label);
    const key = item.snippet ? `snippet:${item.label}` : item.label;
    const known = best.get(key);
    if (!known || score > known.score) best.set(key, { ...item, score: Math.round(score * 1000) / 1000 });
  }
  return [...best.values()].sort((a, b) => b.score - a.score || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
}

/**
 * The list's leader for an explicit request. It is the top plain item, when the caret ends a word that the item
 * extends, and the item leads the second by LEAD_MARGIN. Returns the text to insert, or null.
 */
export function leader(context: CompletionContext, input: RankInput = {}): string | null {
  const { text, pos, word } = context;
  if (!word.text || /[\p{L}\p{N}_$]/u.test(text[pos] ?? '')) return null;
  const [top, second] = rank(context, input);
  if (!top || top.snippet || !top.label.startsWith(word.text)) return null;
  if (second && top.score - second.score < LEAD_MARGIN) return null;
  return top.label.slice(word.text.length) || null;
}
