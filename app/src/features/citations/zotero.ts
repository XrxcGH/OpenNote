// Zotero (Citation helper): the desktop program's library, read through its local API on this computer. Nothing is
// sent anywhere else, and a library that cannot be reached is a message, not an error. The shell makes the request,
// because the page may not talk to other addresses.
import { blankSource, parsePerson } from './model';
import type { Person, Source, SourceType } from './model';
import type { Imported } from './bibtex';

const TYPES: Record<string, SourceType> = {
  book: 'book',
  bookSection: 'book',
  thesis: 'book',
  report: 'book',
  journalArticle: 'article',
  magazineArticle: 'article',
  newspaperArticle: 'article',
  conferencePaper: 'article',
  webpage: 'web',
  blogPost: 'web',
  forumPost: 'web',
  audioRecording: 'recording',
  videoRecording: 'recording',
  podcast: 'recording',
  radioBroadcast: 'recording',
  tvBroadcast: 'recording',
  film: 'recording',
};

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

function creators(list: unknown): Person[] {
  if (!Array.isArray(list)) return [];
  return list.flatMap((entry): Person[] => {
    const one = entry as Record<string, unknown>;
    if (
      text(one.creatorType) !== 'author' &&
      text(one.creatorType) !== 'contributor' &&
      text(one.creatorType) !== 'director'
    )
      return [];
    if (text(one.lastName) !== '') return [{ family: text(one.lastName), given: text(one.firstName) }];
    const person = parsePerson(text(one.name));
    return person ? [person] : [];
  });
}

/** Sources from the JSON Zotero's local API returns for a list of items. */
export function fromZotero(json: unknown): Imported {
  const items = Array.isArray(json) ? json : [];
  const sources: Source[] = [];
  let skipped = 0;
  for (const item of items) {
    const data = (item as { data?: Record<string, unknown> })?.data;
    const type = TYPES[text(data?.itemType)];
    if (!data || !type || text(data.title) === '') {
      // Attachments and notes are not sources.
      if (!['attachment', 'note', 'annotation'].includes(text(data?.itemType))) skipped += 1;
      continue;
    }
    const date = /(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?/.exec(text(data.date));
    sources.push({
      ...blankSource(type),
      title: text(data.title),
      authors: creators(data.creators),
      year: date?.[1] ?? '',
      month: date?.[2] ? String(Number(date[2])) : '',
      day: date?.[3] ? String(Number(date[3])) : '',
      container:
        text(data.publicationTitle) ||
        text(data.websiteTitle) ||
        text(data.blogTitle) ||
        text(data.bookTitle) ||
        text(data.proceedingsTitle) ||
        text(data.seriesTitle),
      publisher: text(data.publisher) || text(data.label) || text(data.institution) || text(data.university),
      place: text(data.place),
      edition: text(data.edition),
      volume: text(data.volume),
      issue: text(data.issue),
      pages: text(data.pages),
      url: text(data.url),
      doi: text(data.DOI),
      accessed: text(data.accessDate).slice(0, 10),
    });
  }
  return { sources, skipped };
}

/** Reads the library from Zotero on this computer. Rejects with the message 'off' or 'missing' or 'failed'. */
export async function readZotero(): Promise<Imported> {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) throw new Error('missing');
  const { invoke } = await import('@tauri-apps/api/core');
  try {
    return fromZotero(JSON.parse(await invoke<string>('study_zotero_items')));
  } catch (error) {
    const code = (error as { code?: string })?.code;
    throw new Error(code === 'zoteroOff' ? 'off' : code === 'zoteroMissing' ? 'missing' : 'failed', { cause: error });
  }
}
