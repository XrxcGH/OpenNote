// BibTeX and RIS, read and written (Citation helper). Both are plain text. The readers are forgiving: an entry they
// cannot make sense of is counted and skipped, and the rest are kept.
import { blankSource, parsePeople } from './model';
import type { Person, Source, SourceType } from './model';

export interface Imported {
  sources: Source[];
  skipped: number;
}

const ACCENTS: Record<string, string> = {
  '\\"a': 'ä',
  '\\"o': 'ö',
  '\\"u': 'ü',
  '\\"A': 'Ä',
  '\\"O': 'Ö',
  '\\"U': 'Ü',
  "\\'e": 'é',
  "\\'a": 'á',
  "\\'o": 'ó',
  "\\'i": 'í',
  "\\'u": 'ú',
  "\\'E": 'É',
  '\\`e': 'è',
  '\\`a': 'à',
  '\\^o': 'ô',
  '\\^e': 'ê',
  '\\~n': 'ñ',
  '\\c c': 'ç',
  '\\ss': 'ß',
};

/** Plain text for a BibTeX value: protective braces and common LaTeX marks removed. */
export function cleanLatex(value: string): string {
  let text = value;
  for (const [mark, letter] of Object.entries(ACCENTS))
    text = text.split(`{${mark}}`).join(letter).split(mark).join(letter);
  return text
    .replace(/\\([&%$#_{}])/g, '$1')
    .replace(/---/g, '—')
    .replace(/--/g, '–')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

interface Entry {
  type: string;
  fields: Map<string, string>;
}

/** Reads a value that starts at `at`: braces (balanced), quotes, or a bare word. Returns the text and where it ends. */
function readValue(text: string, at: number): { value: string; end: number } {
  const first = text[at];
  if (first === '{') {
    let depth = 0;
    for (let i = at; i < text.length; i += 1) {
      if (text[i] === '{') depth += 1;
      else if (text[i] === '}' && --depth === 0) return { value: text.slice(at + 1, i), end: i + 1 };
    }
    return { value: text.slice(at + 1), end: text.length };
  }
  if (first === '"') {
    let depth = 0;
    for (let i = at + 1; i < text.length; i += 1) {
      if (text[i] === '{') depth += 1;
      else if (text[i] === '}') depth -= 1;
      else if (text[i] === '"' && depth === 0) return { value: text.slice(at + 1, i), end: i + 1 };
    }
    return { value: text.slice(at + 1), end: text.length };
  }
  const bare = /^[^,}\s]*/.exec(text.slice(at))?.[0] ?? '';
  return { value: bare, end: at + bare.length };
}

function entries(text: string): Entry[] {
  const found: Entry[] = [];
  const start = /@([A-Za-z]+)\s*[{(]/g;
  for (let match = start.exec(text); match; match = start.exec(text)) {
    const type = match[1].toLowerCase();
    if (type === 'comment' || type === 'string' || type === 'preamble') continue;
    let at = start.lastIndex;
    const comma = text.indexOf(',', at);
    if (comma === -1) break;
    at = comma + 1;
    const fields = new Map<string, string>();
    for (;;) {
      const field = /^\s*([A-Za-z][A-Za-z0-9_-]*)\s*=\s*/.exec(text.slice(at));
      if (!field) break;
      const read = readValue(text, at + field[0].length);
      fields.set(field[1].toLowerCase(), read.value);
      at = read.end;
      const next = /^\s*,?/.exec(text.slice(at));
      at += next?.[0].length ?? 0;
    }
    found.push({ type, fields });
    start.lastIndex = Math.max(at, start.lastIndex);
  }
  return found;
}

const BOOKS = new Set([
  'book',
  'inbook',
  'incollection',
  'proceedings',
  'techreport',
  'phdthesis',
  'mastersthesis',
  'manual',
  'booklet',
  'report',
  'thesis',
]);
const ARTICLES = new Set(['article', 'inproceedings', 'conference', 'periodical', 'unpublished']);
const RECORDINGS = new Set(['audio', 'video', 'music', 'movie', 'recording', 'performance']);

function people(value: string | undefined): Person[] {
  if (!value) return [];
  return parsePeople(
    cleanLatex(value)
      .split(/\s+and\s+/i)
      .join('\n'),
  );
}

function sourceOf(entry: Entry): Source | null {
  const get = (...names: string[]) =>
    cleanLatex(names.map((name) => entry.fields.get(name)).find((v) => v !== undefined) ?? '');
  const title = get('title');
  if (title === '') return null;
  const url = get('url');
  const type: SourceType = RECORDINGS.has(entry.type)
    ? 'recording'
    : ARTICLES.has(entry.type)
      ? 'article'
      : BOOKS.has(entry.type)
        ? 'book'
        : url !== ''
          ? 'web'
          : 'book';
  const date = /(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?/.exec(get('date'));
  const month = get('month');
  const source = blankSource(type);
  return {
    ...source,
    title,
    authors: people(entry.fields.get('author') ?? entry.fields.get('editor')),
    year: get('year') || date?.[1] || '',
    month: /^\d+$/.test(month) ? String(Number(month)) : date?.[2] ? String(Number(date[2])) : monthNumber(month),
    day: date?.[3] ? String(Number(date[3])) : '',
    container: get('journal', 'journaltitle', 'booktitle', 'website', 'series'),
    publisher: get('publisher', 'organization', 'institution', 'school'),
    place: get('address', 'location'),
    edition: get('edition'),
    volume: get('volume'),
    issue: get('number', 'issue'),
    pages: get('pages'),
    url,
    doi: get('doi').replace(/^https?:\/\/(dx\.)?doi\.org\//i, ''),
    accessed: get('urldate', 'accessed'),
  };
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
function monthNumber(text: string): string {
  const at = MONTHS.indexOf(text.slice(0, 3).toLowerCase());
  return at === -1 ? '' : String(at + 1);
}

export function parseBibtex(text: string): Imported {
  const all = entries(text);
  const sources = all.flatMap((entry) => sourceOf(entry) ?? []);
  return { sources, skipped: all.length - sources.length };
}

const escapeBibtex = (text: string): string => text.replace(/([&%$#_])/g, '\\$1');

/** The sources as BibTeX entries. */
export function toBibtex(sources: readonly Source[]): string {
  const used = new Set<string>();
  return sources
    .map((source) => {
      const base = `${(source.authors[0]?.family ?? 'source').replace(/[^A-Za-z0-9]/g, '')}${source.year}`;
      let key = base;
      for (let n = 2; used.has(key); n += 1) key = `${base}${String.fromCharCode(96 + n)}`;
      used.add(key);
      const type = source.type === 'article' ? 'article' : source.type === 'book' ? 'book' : 'misc';
      const lines: [string, string][] = [
        [
          'author',
          source.authors
            .map((person) => (person.given ? `${person.family}, ${person.given}` : person.family))
            .join(' and '),
        ],
        ['title', source.title],
        [source.type === 'article' ? 'journal' : source.type === 'web' ? 'howpublished' : 'series', source.container],
        ['publisher', source.publisher],
        ['address', source.place],
        ['edition', source.edition],
        ['year', source.year],
        ['month', source.month],
        ['volume', source.volume],
        ['number', source.issue],
        ['pages', source.pages.replace(/–/g, '--')],
        ['url', source.url],
        ['doi', source.doi],
        ['urldate', source.accessed],
        ['type', source.type === 'recording' ? 'Recording' : ''],
      ];
      const body = lines
        .filter(([, value]) => value !== '')
        .map(([name, value]) => `  ${name} = {${name === 'url' ? value : escapeBibtex(value)}}`);
      return `@${type}{${key},\n${body.join(',\n')}\n}`;
    })
    .join('\n\n');
}

// ---- RIS -------------------------------------------------------------------------------------------------------

const RIS_BOOK = new Set(['BOOK', 'CHAP', 'EBOOK', 'ECHAP', 'EDBOOK', 'THES', 'RPRT', 'GEN']);
const RIS_ARTICLE = new Set(['JOUR', 'JFULL', 'MGZN', 'NEWS', 'CONF', 'CPAPER', 'EJOUR', 'ABST']);
const RIS_WEB = new Set(['ELEC', 'WEB', 'BLOG', 'ICOMM', 'COMP']);
const RIS_RECORDING = new Set(['SOUND', 'VIDEO', 'MUSIC', 'MPCT', 'ADVS', 'GEN_RECORDING']);

function risSource(tags: Map<string, string[]>): Source | null {
  const first = (...names: string[]) =>
    (names.map((name) => tags.get(name)?.[0]).find((v) => v !== undefined) ?? '').trim();
  const title = first('TI', 'T1');
  if (title === '') return null;
  const code = first('TY');
  const type: SourceType = RIS_RECORDING.has(code)
    ? 'recording'
    : RIS_ARTICLE.has(code)
      ? 'article'
      : RIS_WEB.has(code)
        ? 'web'
        : RIS_BOOK.has(code)
          ? 'book'
          : 'book';
  const date = /(\d{4})\/?(\d{1,2})?\/?(\d{1,2})?/.exec(first('DA', 'PY', 'Y1'));
  const start = first('SP');
  const end = first('EP');
  const authors = [...(tags.get('AU') ?? []), ...(tags.get('A1') ?? [])].flatMap((name) => people(name));
  return {
    ...blankSource(type),
    title,
    authors,
    year: date?.[1] ?? '',
    month: date?.[2] ? String(Number(date[2])) : '',
    day: date?.[3] ? String(Number(date[3])) : '',
    container: first('T2', 'JO', 'JF', 'JA', 'BT'),
    publisher: first('PB'),
    place: first('CY'),
    edition: first('ET'),
    volume: first('VL'),
    issue: first('IS'),
    pages: start && end ? `${start}–${end}` : start,
    url: first('UR', 'L1'),
    doi: first('DO').replace(/^https?:\/\/(dx\.)?doi\.org\//i, ''),
    accessed: '',
  };
}

export function parseRis(text: string): Imported {
  const sources: Source[] = [];
  let skipped = 0;
  let tags = new Map<string, string[]>();
  const finish = () => {
    if (tags.size === 0) return;
    const source = risSource(tags);
    if (source) sources.push(source);
    else skipped += 1;
    tags = new Map();
  };
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Z][A-Z0-9])\s{2}-\s?(.*)$/.exec(line);
    if (!match) continue;
    if (match[1] === 'ER') finish();
    else tags.set(match[1], [...(tags.get(match[1]) ?? []), match[2]]);
  }
  finish();
  return { sources, skipped };
}

/** The sources as RIS records. */
export function toRis(sources: readonly Source[]): string {
  const codes: Record<SourceType, string> = { book: 'BOOK', article: 'JOUR', web: 'ELEC', recording: 'SOUND' };
  return sources
    .map((source) => {
      const [start, end] = source.pages.split(/[–-]/);
      const lines: [string, string][] = [
        ['TY', codes[source.type]],
        ...source.authors.map((person): [string, string] => [
          'AU',
          person.given ? `${person.family}, ${person.given}` : person.family,
        ]),
        ['TI', source.title],
        [source.type === 'article' ? 'JO' : 'T2', source.container],
        ['PY', source.year],
        ['PB', source.publisher],
        ['CY', source.place],
        ['ET', source.edition],
        ['VL', source.volume],
        ['IS', source.issue],
        ['SP', start ?? ''],
        ['EP', end ?? ''],
        ['UR', source.url],
        ['DO', source.doi],
      ];
      return [...lines.filter(([, value]) => value !== '').map(([tag, value]) => `${tag}  - ${value}`), 'ER  - '].join(
        '\n',
      );
    })
    .join('\n\n');
}
