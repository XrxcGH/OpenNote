// Cards from a page, a section, or a transcript (Study tools). The reading is extractive and plain: a heading with
// the paragraph under it, a "Term: meaning" line, and a sentence with a bold word, where the bold word becomes a
// blank. Nothing is added until the person has looked at the candidates and kept the ones they want.
import { cardOfLine, stripMarker } from './inline';
import type { Card } from './types';

export type Reason = 'heading' | 'definition' | 'bold' | 'inline';

export interface Candidate {
  reason: Reason;
  card: Pick<Card, 'kind' | 'front' | 'back'>;
}

const MAX_CANDIDATES = 100;
const MAX_ANSWER = 280;
const HEADING = /^#{1,6}\s+(.+?)\s*#*\s*$/;
const DEFINITION = /^([^:.!?{}]{2,40}?):\s+(.{12,})$/;
const BOLD = /\*\*([^*]+)\*\*|__([^_]+)__/g;

const words = (text: string): number => text.split(/\s+/).filter(Boolean).length;
const plain = (text: string): string => text.replace(BOLD, (_all, a: string, b: string) => a ?? b).trim();

/** The first sentences of a paragraph that fit the answer limit. */
function trimAnswer(text: string): string {
  if (text.length <= MAX_ANSWER) return text;
  const cut = text.slice(0, MAX_ANSWER);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return (end > 40 ? cut.slice(0, end + 1) : cut.slice(0, cut.lastIndexOf(' ')) + '…').trim();
}

function fromHeadings(lines: readonly string[]): Candidate[] {
  const found: Candidate[] = [];
  lines.forEach((line, index) => {
    const heading = HEADING.exec(line.trim());
    if (!heading) return;
    const body: string[] = [];
    for (let next = index + 1; next < lines.length; next += 1) {
      const text = lines[next].trim();
      if (HEADING.test(text) || (text === '' && body.length > 0)) break;
      if (text !== '') body.push(stripMarker(text));
    }
    const answer = trimAnswer(plain(body.join(' ')));
    if (answer.length >= 12)
      found.push({ reason: 'heading', card: { kind: 'basic', front: plain(heading[1]), back: answer } });
  });
  return found;
}

function fromLines(lines: readonly string[]): Candidate[] {
  const found: Candidate[] = [];
  for (const raw of lines) {
    const line = stripMarker(raw);
    if (!line || HEADING.test(raw.trim())) continue;
    // "Question :: Answer" and "{{blank}}" lines are cards already; listing them here lets them be added to any deck.
    const written = cardOfLine(raw);
    if (written) {
      found.push({ reason: 'inline', card: written });
      continue;
    }
    const definition = DEFINITION.exec(plain(line));
    if (definition && words(definition[1]) <= 4 && !/^https?$/i.test(definition[1].trim())) {
      found.push({
        reason: 'definition',
        card: { kind: 'basic', front: definition[1].trim(), back: trimAnswer(definition[2].trim()) },
      });
      continue;
    }
    for (const sentence of line.split(/(?<=[.!?])\s+/)) {
      if (!new RegExp(BOLD.source).test(sentence) || words(sentence) < 4) continue;
      const text = sentence.replace(BOLD, (_all, a: string, b: string) => `{{${(a ?? b).trim()}}}`);
      found.push({ reason: 'bold', card: { kind: 'cloze', front: text.trim(), back: '' } });
    }
  }
  return found;
}

/** The cards the text suggests, without repeats, in the order they appear on the page. */
export function generateCards(markdown: string): Candidate[] {
  const lines = markdown.split('\n');
  const all = [...fromHeadings(lines), ...fromLines(lines)];
  const seen = new Set<string>();
  const unique = all.filter((candidate) => {
    const key = candidate.card.front.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return unique.slice(0, MAX_CANDIDATES);
}
