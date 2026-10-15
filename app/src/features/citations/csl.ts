// Citation style files (Citation helper). A style file says how a source is written as an entry and as a short form
// in the text, in a small template language, so a new style is a few lines of data and not new code. The bundled
// Vancouver, ACS, AMA, Turabian, and Nature styles are files of this kind (cslStyles.ts), and so is one the person
// adds. The templates:
//
//   {name}     a field of the source: authors, who, title, container, year, month, monthname, day, volume, issue,
//              pages, publisher, place, edition, url, doi, doiurl, accessed, n (the entry's number)
//   {name|mod} the same, changed: hyphen (a plain hyphen in a page range), minus (a minus sign in one), sup
//              (small raised digits, for a number)
//   [ ... ]    shown only when every field inside it has a value, so a missing issue leaves no empty brackets
//   *italic*   and **bold**, written in Markdown
//   \[ \] \{   a bracket or brace that is meant as itself
import type { Person, Source, SourceType } from './model';
import { initials, inTextNames, monthName, shortMonth } from './styles';

export type NameForm =
  /** Smith JQ */
  | 'family-initials'
  /** Smith, J. Q. */
  | 'family-initials-dots'
  /** J. Q. Smith */
  | 'initials-family'
  /** Smith, Jane Q. */
  | 'family-given'
  /** Jane Q. Smith */
  | 'given-family'
  /** Smith, Jane Q., then Wei Lee: the first name is turned around and the others are not (Chicago, Turabian). */
  | 'first-turned';

export const NAME_FORMS: readonly NameForm[] = [
  'family-initials',
  'family-initials-dots',
  'initials-family',
  'family-given',
  'given-family',
  'first-turned',
];

export interface NameRules {
  form: NameForm;
  /** Between names. */
  separator: string;
  /** Before the last name. */
  last: string;
  /** More authors than this are cut to `keep` and "et al.". */
  etAlOver?: number;
  keep?: number;
}

export interface StyleFile {
  id: string;
  title: string;
  /** The entries are numbered in the order they were first cited, and are not sorted. */
  numbered: boolean;
  names: NameRules;
  /** The short form in the text. */
  inline: string;
  /** The entry for each kind of source, with `book` standing for any kind that is not listed. */
  entry: Partial<Record<SourceType, string>> & { book: string };
}

const SUPER = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const raised = (text: string): string => text.replace(/\d/g, (digit) => SUPER[Number(digit)]);

function nameText(person: Person, form: NameForm, first: boolean): string {
  const { family, given } = person;
  if (!given) return family;
  switch (form) {
    case 'family-initials':
      return `${family} ${initials(given, false)}`;
    case 'family-initials-dots':
      return `${family}, ${initials(given)}`;
    case 'initials-family':
      return `${initials(given)} ${family}`;
    case 'family-given':
      return `${family}, ${given}`;
    case 'given-family':
      return `${given} ${family}`;
    case 'first-turned':
      return first ? `${family}, ${given}` : `${given} ${family}`;
  }
}

/** The authors as the style writes them. */
export function formatNames(authors: readonly Person[], rules: NameRules): string {
  let shown = authors;
  let more = false;
  if (rules.etAlOver !== undefined && authors.length > rules.etAlOver) {
    shown = authors.slice(0, rules.keep ?? 1);
    more = true;
  }
  const names = shown.map((person, index) => nameText(person, rules.form, index === 0));
  if (more) return `${names.join(rules.separator)}${rules.separator}et al.`;
  if (names.length <= 1) return names.join('');
  if (names.length === 2) return `${names[0]}${rules.last}${names[1]}`;
  return `${names.slice(0, -1).join(rules.separator)}${rules.last}${names.at(-1)}`;
}

/** What each {field} stands for, for one source. An empty string is a field with no value. */
export function fieldsOf(source: Source, rules: NameRules, number: number): Record<string, string> {
  return {
    authors: formatNames(source.authors, rules),
    who: source.authors.length === 0 ? source.title : inTextNames(source, 'and'),
    title: source.title,
    container: source.container,
    year: source.year,
    month: source.month,
    monthname: source.month ? shortMonth(source.month) : '',
    monthfull: source.month ? monthName(source.month) : '',
    day: source.day,
    volume: source.volume,
    issue: source.issue,
    pages: source.pages.replace(/-+/g, '–'),
    publisher: source.publisher,
    place: source.place,
    edition: source.edition,
    url: source.url,
    doi: source.doi,
    doiurl: source.doi ? `https://doi.org/${source.doi}` : '',
    accessed: source.accessed,
    n: String(number),
  };
}

const MODIFIERS: Record<string, (text: string) => string> = {
  hyphen: (text) => text.replace(/[–—−]/g, '-'),
  minus: (text) => text.replace(/[–—-]/g, '−'),
  sup: raised,
};

// A template is read into pieces: text, a field, or an optional group of pieces.
type Piece = { text: string } | { field: string; modifier: string } | { group: Piece[] };

function parse(template: string): Piece[] {
  let at = 0;
  const read = (inGroup: boolean): Piece[] => {
    const pieces: Piece[] = [];
    let text = '';
    const flush = () => {
      if (text !== '') pieces.push({ text });
      text = '';
    };
    while (at < template.length) {
      const char = template[at];
      if (char === '\\' && at + 1 < template.length) {
        text += template[at + 1];
        at += 2;
      } else if (char === '{') {
        const close = template.indexOf('}', at);
        if (close < 0) throw new Error(`A { in the style has no }: ${template}`);
        const [field, modifier = ''] = template.slice(at + 1, close).split('|');
        flush();
        pieces.push({ field: field.trim(), modifier: modifier.trim() });
        at = close + 1;
      } else if (char === '[') {
        flush();
        at += 1;
        pieces.push({ group: read(true) });
      } else if (char === ']') {
        if (!inGroup) throw new Error(`A ] in the style has no [: ${template}`);
        at += 1;
        flush();
        return pieces;
      } else {
        text += char;
        at += 1;
      }
    }
    if (inGroup) throw new Error(`A [ in the style has no ]: ${template}`);
    flush();
    return pieces;
  };
  return read(false);
}

function render(pieces: readonly Piece[], fields: Readonly<Record<string, string>>): { text: string; empty: boolean } {
  let text = '';
  let empty = false;
  for (const piece of pieces) {
    if ('text' in piece) text += piece.text;
    else if ('field' in piece) {
      const value = fields[piece.field];
      if (value === undefined) throw new Error(`The style names a field that does not exist: ${piece.field}`);
      if (value === '') empty = true;
      else text += piece.modifier ? (MODIFIERS[piece.modifier]?.(value) ?? value) : value;
    } else {
      const inner = render(piece.group, fields);
      if (!inner.empty) text += inner.text;
    }
  }
  return { text, empty };
}

/** Tidies what is left where a field was empty: doubled stops and commas, stray spaces. */
export function tidy(text: string): string {
  return text
    .replace(/([.?!])\s*\.(?=\s|$|\*|")/g, '$1')
    .replace(/([,;:])\s*([,;:])/g, '$2')
    .replace(/,\s*\./g, '.')
    .replace(/\s+([.,;:])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Writes a template for a source. */
export function fill(template: string, source: Source, rules: NameRules, number = 1): string {
  return tidy(render(parse(template), fieldsOf(source, rules, number)).text);
}

/** Checks a style file's templates read, naming the first that does not. Returns null when it is sound. */
export function problemWith(file: StyleFile): string | null {
  try {
    const blank: Source = {
      id: 'x',
      type: 'book',
      title: 'T',
      authors: [],
      year: '',
      month: '',
      day: '',
      container: '',
      publisher: '',
      place: '',
      edition: '',
      volume: '',
      issue: '',
      pages: '',
      url: '',
      doi: '',
      accessed: '',
    };
    const sample = fieldsOf(blank, file.names, 1);
    for (const template of [file.inline, ...Object.values(file.entry)]) render(parse(template), sample);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** Reads a style file the person chose: JSON with the fields of {@link StyleFile}. */
export function readStyleFile(text: string): { style: StyleFile } | { error: 'not-json' | 'shape' | string } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { error: 'not-json' };
  }
  const file = data as Partial<StyleFile> | null;
  if (
    !file ||
    typeof file.id !== 'string' ||
    !/^[a-z0-9-]{2,40}$/.test(file.id) ||
    typeof file.title !== 'string' ||
    file.title.trim() === '' ||
    typeof file.numbered !== 'boolean' ||
    typeof file.inline !== 'string' ||
    !file.entry ||
    typeof file.entry.book !== 'string' ||
    !file.names ||
    !NAME_FORMS.includes(file.names.form) ||
    typeof file.names.separator !== 'string' ||
    typeof file.names.last !== 'string'
  )
    return { error: 'shape' };
  for (const value of Object.values(file.entry)) if (typeof value !== 'string') return { error: 'shape' };
  const problem = problemWith(file as StyleFile);
  return problem ? { error: problem } : { style: file as StyleFile };
}
