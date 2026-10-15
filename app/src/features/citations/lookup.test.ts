// @vitest-environment jsdom
// Looking up a source by DOI or ISBN, with a mock client in place of the sites: what counts as an identifier, what is
// sent (nothing for text that is not one, nothing while Work offline is on), and what comes back as a source.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isIsbn, lookupLastRan, lookupSource, memoryLookup, readIdentifier, sourceFromFound } from './lookup';
import type { Found, LookupClient } from './lookup';
import { STYLES } from './styles';
import './styleList';

const article: Found = {
  kind: 'article',
  title: 'Sleep and Memory in Students',
  authors: [{ family: 'Smith', given: 'Jane Q.' }],
  year: '2020',
  month: '5',
  day: '',
  container: 'Journal of Learning',
  publisher: 'Open Press',
  place: '',
  edition: '',
  volume: '12',
  issue: '3',
  pages: '45–67',
  url: 'https://doi.org/10.1000/xyz123',
  doi: '10.1000/xyz123',
};
const book: Found = {
  ...article,
  kind: 'book',
  title: 'Notes on Notes',
  authors: [{ family: 'Garcia', given: 'Maria' }],
  container: '',
  volume: '',
  issue: '',
  pages: '',
  doi: '',
  url: '',
  place: 'Austin',
  year: '2018',
};

beforeEach(() => localStorage.clear());

describe('reading what was typed', () => {
  it('finds a DOI written bare, as a web address, or with a label', () => {
    for (const text of [
      '10.1000/xyz123',
      'https://doi.org/10.1000/xyz123',
      'doi: 10.1000/xyz123',
      ' DOI:10.1000/xyz123 ',
    ]) {
      expect(readIdentifier(text), text).toEqual({ kind: 'doi', id: '10.1000/xyz123' });
    }
  });

  it('finds an ISBN with a good check digit, hyphens and a label allowed', () => {
    expect(readIdentifier('978-0-306-40615-7')).toEqual({ kind: 'isbn', id: '9780306406157' });
    expect(readIdentifier('ISBN 0-306-40615-2')).toEqual({ kind: 'isbn', id: '0306406152' });
    expect(readIdentifier('080442957x')).toEqual({ kind: 'isbn', id: '080442957X' });
  });

  it('is nothing for text that is neither', () => {
    for (const text of [
      '',
      'sleep and memory',
      '978-0-306-40615-8',
      '12345',
      'https://example.org/10.1000/x',
      '10.1/x',
    ])
      expect(readIdentifier(text), text).toBeNull();
    expect(isIsbn('9780306406157')).toBe(true);
    expect(isIsbn('9780306406158')).toBe(false);
  });
});

describe('looking a source up', () => {
  const client = memoryLookup({ 'doi:10.1000/xyz123': article, 'isbn:9780306406157': book });

  it('gives back a source to look over, in the fields of a source', async () => {
    const result = await lookupSource('https://doi.org/10.1000/xyz123', client);
    expect(result.ok && result.source).toMatchObject({
      type: 'article',
      title: 'Sleep and Memory in Students',
      year: '2020',
      container: 'Journal of Learning',
      doi: '10.1000/xyz123',
    });
    const isbn = await lookupSource('978-0-306-40615-7', client);
    expect(isbn.ok && isbn.source).toMatchObject({ type: 'book', publisher: 'Open Press', place: 'Austin' });
  });

  it('is written by the styles like any other source', async () => {
    const result = await lookupSource('10.1000/xyz123', client);
    if (!result.ok) throw new Error('not found');
    expect(STYLES.vancouver.reference(result.source, 1)).toContain('Smith JQ. Sleep and Memory in Students.');
  });

  it('says so when the site does not know it', async () => {
    expect(await lookupSource('10.1000/unknown', client)).toEqual({ ok: false, reason: 'notFound' });
  });

  it('sends nothing for text that is not a DOI or ISBN', async () => {
    const find = vi.fn<LookupClient['find']>();
    expect(await lookupSource('hello', { find })).toEqual({ ok: false, reason: 'badId' });
    expect(find).not.toHaveBeenCalled();
    expect(lookupLastRan()).toBeNull();
  });

  it('sends nothing while Work offline is on', async () => {
    const find = vi.fn<LookupClient['find']>();
    expect(await lookupSource('10.1000/xyz123', { find }, () => true)).toEqual({ ok: false, reason: 'offline' });
    expect(find).not.toHaveBeenCalled();
    expect(lookupLastRan()).toBeNull();
  });

  it('says it is only in the desktop app when there is no shell to ask', async () => {
    expect(await lookupSource('10.1000/xyz123', null)).toEqual({ ok: false, reason: 'unavailable' });
  });

  it('notes the time when a request goes out, found or not', async () => {
    await lookupSource('10.1000/unknown', client);
    expect(lookupLastRan()).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("turns the shell's errors into plain reasons", async () => {
    const failing = (code: string): LookupClient => ({
      find: async () => {
        throw Object.assign(new Error('x'), { code });
      },
    });
    expect(await lookupSource('10.1000/xyz123', failing('offline'))).toEqual({ ok: false, reason: 'offline' });
    expect(await lookupSource('10.1000/xyz123', failing('invalid'))).toEqual({ ok: false, reason: 'badId' });
    expect(await lookupSource('10.1000/xyz123', failing('io'))).toEqual({ ok: false, reason: 'failed' });
  });
});

describe('sourceFromFound', () => {
  it('gives a source its own id, and leaves the list alone', () => {
    const one = sourceFromFound(article);
    const two = sourceFromFound(article);
    expect(one.id).not.toBe(two.id);
    expect(one.type).toBe('article');
  });
});
