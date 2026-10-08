// Look-up of a source by its DOI or ISBN (Citation helper). It happens only when the person asks for one source: the
// shell sends that identifier to Crossref (a DOI) or Open Library (an ISBN) and nothing else, and the answer comes back
// as a source to look over before it is added. Work offline blocks it, and the Privacy panel lists both sites and when
// it last ran. Tests give their own client, so nothing here needs a network.
import { blankSource } from './model';
import type { Person, Source } from './model';

export type LookupKind = 'doi' | 'isbn';

/** The sites a look-up talks to, as the Privacy panel names them. */
export const LOOKUP_HOSTS: readonly string[] = ['api.crossref.org', 'openlibrary.org'];

/** What the shell hands back, in the fields of a source. */
export interface Found {
  kind: 'article' | 'book';
  title: string;
  authors: Person[];
  year: string;
  month: string;
  day: string;
  container: string;
  publisher: string;
  place: string;
  edition: string;
  volume: string;
  issue: string;
  pages: string;
  url: string;
  doi: string;
}

/** Something that answers a look-up. The desktop app's is `shellLookup`; tests use `memoryLookup`. */
export interface LookupClient {
  /** Null when the site does not know the identifier. Rejects with an error whose `code` says why it failed. */
  find(kind: LookupKind, id: string): Promise<Found | null>;
}

export type LookupFailure = 'badId' | 'offline' | 'notFound' | 'failed' | 'unavailable';
export type LookupResult = { ok: true; source: Source } | { ok: false; reason: LookupFailure };

const DOI = /^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)?(10\.\d{4,9}(?:\.\d+)*\/\S+)$/i;

/** Whether the digits are an ISBN-10 or ISBN-13 with a good check digit. */
export function isIsbn(digits: string): boolean {
  if (!/^(?:\d{9}[\dX]|\d{13})$/.test(digits)) return false;
  const values = [...digits].map((c) => (c === 'X' ? 10 : Number(c)));
  return values.length === 10
    ? values.reduce((sum, v, at) => sum + (10 - at) * v, 0) % 11 === 0
    : values.reduce((sum, v, at) => sum + (at % 2 === 0 ? v : 3 * v), 0) % 10 === 0;
}

/** Reads what was typed as a DOI or an ISBN, or null if it is neither. */
export function readIdentifier(text: string): { kind: LookupKind; id: string } | null {
  const typed = text.trim();
  const doi = DOI.exec(typed);
  if (doi) return { kind: 'doi', id: doi[1] };
  const digits = typed
    .replace(/^isbn(?:-1[03])?:?\s*/i, '')
    .replace(/[-\s]/g, '')
    .toUpperCase();
  return isIsbn(digits) ? { kind: 'isbn', id: digits } : null;
}

/** A source from what a site knew. It is not added to the list until the person says so. */
export function sourceFromFound(found: Found): Source {
  return {
    ...blankSource(found.kind),
    title: found.title,
    authors: found.authors,
    year: found.year,
    month: found.month,
    day: found.day,
    container: found.container,
    publisher: found.publisher,
    place: found.place,
    edition: found.edition,
    volume: found.volume,
    issue: found.issue,
    pages: found.pages,
    url: found.url,
    doi: found.doi,
  };
}

/** The sites answer for the sources they know, so a mock can too. */
export function memoryLookup(known: Record<string, Found>): LookupClient {
  return { find: async (kind, id) => known[`${kind}:${id.toLowerCase()}`] ?? null };
}

/** The desktop shell's client. It is absent in a browser, where nothing is sent anywhere. */
export function shellLookup(): LookupClient | null {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return null;
  return {
    async find(kind, id) {
      const { invoke } = await import('@tauri-apps/api/core');
      return invoke<Found | null>('study_cite_lookup', { kind, id });
    },
  };
}

const LAST_RAN = 'opennote.citations.lookup.lastRan';

/** When a look-up last went out, as an ISO date, for the Privacy panel. */
export function lookupLastRan(): string | null {
  try {
    return window.localStorage.getItem(LAST_RAN);
  } catch {
    return null;
  }
}

function noteRan(): void {
  try {
    window.localStorage.setItem(LAST_RAN, new Date().toISOString());
  } catch {
    // The panel then says it has not run, which is only a little behind the truth.
  }
}

/**
 * Looks up what was typed. Nothing is sent when it is not a DOI or ISBN, when Work offline is on, or when there is no
 * shell to send it. The time is noted when a request goes out, found or not.
 */
export async function lookupSource(
  text: string,
  client: LookupClient | null = shellLookup(),
  offline: () => boolean = () => false,
): Promise<LookupResult> {
  const id = readIdentifier(text);
  if (!id) return { ok: false, reason: 'badId' };
  if (offline()) return { ok: false, reason: 'offline' };
  if (!client) return { ok: false, reason: 'unavailable' };
  noteRan();
  try {
    const found = await client.find(id.kind, id.id);
    return found ? { ok: true, source: sourceFromFound(found) } : { ok: false, reason: 'notFound' };
  } catch (error) {
    const code = (error as { code?: string })?.code;
    return { ok: false, reason: code === 'offline' ? 'offline' : code === 'invalid' ? 'badId' : 'failed' };
  }
}
