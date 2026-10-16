// A source (Citation helper): a book, an article, a web page, or a recording, with what a citation needs. Every field
// is plain text so a source can be typed, imported from BibTeX or RIS or Zotero, and written back out unchanged.

export type SourceType = 'book' | 'article' | 'web' | 'recording';
export const SOURCE_TYPES: readonly SourceType[] = ['book', 'article', 'web', 'recording'];

export interface Person {
  family: string;
  given: string;
}

export interface Source {
  id: string;
  type: SourceType;
  title: string;
  authors: Person[];
  year: string;
  /** Month as a number from 1 to 12, or empty. */
  month: string;
  day: string;
  /** The journal, website, or series the source sits in. */
  container: string;
  publisher: string;
  place: string;
  edition: string;
  volume: string;
  issue: string;
  /** Such as 12-34. */
  pages: string;
  url: string;
  doi: string;
  /** The day a web page was read, as YYYY-MM-DD. */
  accessed: string;
}

let counter = 0;
export const newSourceId = (): string => `s${Date.now().toString(36)}${(counter += 1).toString(36)}`;

export function blankSource(type: SourceType = 'book'): Source {
  return {
    id: newSourceId(),
    type,
    title: '',
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
}

/** Reads "Family, Given" or "Given Family" (and "Given Middle Family"). */
export function parsePerson(text: string): Person | null {
  const name = text.trim().replace(/\s+/g, ' ');
  if (name === '') return null;
  if (name.includes(',')) {
    const [family, ...rest] = name.split(',');
    return { family: family.trim(), given: rest.join(',').trim() };
  }
  const words = name.split(' ');
  return words.length === 1
    ? { family: name, given: '' }
    : { family: words[words.length - 1], given: words.slice(0, -1).join(' ') };
}

/** Authors typed one to a line, in either name order. */
export function parsePeople(text: string): Person[] {
  return text
    .split(/\n|;/)
    .map(parsePerson)
    .filter((person): person is Person => person !== null);
}

export const personText = (person: Person): string =>
  person.given ? `${person.family}, ${person.given}` : person.family;

/** Whether two sources are the same work: the same DOI, or the same title, first author, and year. */
export function sameSource(a: Source, b: Source): boolean {
  if (a.doi && b.doi) return a.doi.toLowerCase() === b.doi.toLowerCase();
  const key = (s: Source) => `${s.title}|${s.authors[0]?.family ?? ''}|${s.year}`.toLowerCase().replace(/\s+/g, ' ');
  return key(a) === key(b) && a.title !== '';
}

/** Adds the sources that are not already in the list. Returns the new list and how many repeats were left out. */
export function mergeSources(
  existing: readonly Source[],
  incoming: readonly Source[],
): { sources: Source[]; skipped: number } {
  const sources = [...existing];
  let skipped = 0;
  for (const source of incoming) {
    if (sources.some((one) => sameSource(one, source))) skipped += 1;
    else sources.push(source);
  }
  return { sources, skipped };
}
