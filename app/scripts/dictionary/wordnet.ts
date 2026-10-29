// Turns Princeton WordNet's database files (the "dict" folder of WordNet 3.1: index.noun, data.noun, and the same for
// verb, adj, and adv) into the dictionary's chunks, one JSON file for each first letter, in
// app/src/features/tools/dictionary/data/en. WordNet's license lets the data ship with an app as long as its notice
// goes with it; app/src/features/tools/dictionary/README.md says where the notice goes.
//
// Run with: node app/scripts/dictionary/wordnet.ts <path to WordNet's dict folder> [output folder]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type Pos = 'n' | 'v' | 'a' | 'r';
type Sense = [definition: string, synonyms: string[], example?: string];
type Chunk = Record<string, [Pos, Sense[]][]>;

/** The most senses kept for a word in one part of speech, and the most synonyms for one sense. */
export const MAX_SENSES = 8;
export const MAX_SYNONYMS = 12;

export interface Synset {
  pos: Pos;
  words: string[];
  definition: string;
  example: string | null;
}

/** A WordNet word as the app writes it: spaces for underscores, no adjective marker such as "(a)". */
export const wordOf = (raw: string): string => raw.replace(/\((?:a|p|ip)\)$/, '').replace(/_/g, ' ');

/** The synsets of a data file, by their offset. Header lines (they start with spaces) are skipped. */
export function parseData(text: string, pos: Pos): Map<string, Synset> {
  const synsets = new Map<string, Synset>();
  for (const line of text.split('\n')) {
    if (line === '' || line.startsWith('  ')) continue;
    const bar = line.indexOf(' | ');
    if (bar < 0) continue;
    const fields = line.slice(0, bar).split(' ');
    const count = Number.parseInt(fields[3] ?? '', 16);
    if (!Number.isFinite(count) || count < 1) continue;
    const words = Array.from({ length: count }, (_, at) => wordOf(fields[4 + at * 2] ?? '')).filter(Boolean);
    const gloss = line.slice(bar + 3).trim();
    const split = gloss.search(/;\s+"/);
    const definition = (split < 0 ? gloss : gloss.slice(0, split)).trim();
    const example = /"([^"]+)"/.exec(split < 0 ? '' : gloss.slice(split))?.[1] ?? null;
    synsets.set(fields[0], { pos, words, definition, example });
  }
  return synsets;
}

/** The synsets of each word in an index file, the most common first, as WordNet lists them. */
export function parseIndex(text: string): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const line of text.split('\n')) {
    if (line === '' || line.startsWith('  ')) continue;
    const fields = line.split(' ');
    const synsetCount = Number(fields[2]);
    const pointers = Number(fields[3]);
    if (!Number.isInteger(synsetCount) || !Number.isInteger(pointers)) continue;
    // After the pointer symbols come two counts (senses, and senses seen in text), then the offsets.
    const offsets = fields.slice(4 + pointers + 2, 4 + pointers + 2 + synsetCount);
    if (offsets.length > 0) index.set(wordOf(fields[0]), offsets);
  }
  return index;
}

export interface Files {
  n: { index: string; data: string };
  v: { index: string; data: string };
  a: { index: string; data: string };
  r: { index: string; data: string };
}

/** The first-letter chunks for the four parts of speech. */
export function buildChunks(files: Files): Record<string, Chunk> {
  const chunks: Record<string, Chunk> = {};
  for (const pos of ['n', 'v', 'a', 'r'] as const) {
    const synsets = parseData(files[pos].data, pos);
    for (const [lemma, offsets] of parseIndex(files[pos].index)) {
      const senses: Sense[] = [];
      for (const offset of offsets.slice(0, MAX_SENSES)) {
        const synset = synsets.get(offset);
        if (!synset || synset.definition === '') continue;
        const synonyms = [...new Set(synset.words.filter((word) => word.toLowerCase() !== lemma))].slice(
          0,
          MAX_SYNONYMS,
        );
        senses.push(synset.example ? [synset.definition, synonyms, synset.example] : [synset.definition, synonyms]);
      }
      if (senses.length === 0) continue;
      const letter = /^[a-z]/.test(lemma) ? lemma[0] : '_';
      const chunk = (chunks[letter] ??= {});
      (chunk[lemma] ??= []).push([pos, senses]);
    }
  }
  return chunks;
}

function main(): void {
  const [from, to] = process.argv.slice(2);
  if (!from) {
    console.error('Usage: node app/scripts/dictionary/wordnet.ts <WordNet dict folder> [output folder]');
    process.exit(1);
  }
  const out = to ?? join(import.meta.dirname, '..', '..', 'src', 'features', 'tools', 'dictionary', 'data', 'en');
  const read = (name: string) => readFileSync(join(from, name), 'utf8');
  const file = (kind: string) => ({ index: read(`index.${kind}`), data: read(`data.${kind}`) });
  const chunks = buildChunks({ n: file('noun'), v: file('verb'), a: file('adj'), r: file('adv') });
  mkdirSync(out, { recursive: true });
  let words = 0;
  for (const [letter, chunk] of Object.entries(chunks)) {
    words += Object.keys(chunk).length;
    writeFileSync(join(out, `${letter}.json`), `${JSON.stringify(chunk)}\n`);
  }
  console.log(`${words} words in ${Object.keys(chunks).length} files, written to ${out}`);
}

if (process.argv[1] && import.meta.filename === process.argv[1]) main();
