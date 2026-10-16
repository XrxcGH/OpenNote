// How a Readwise book and its highlights are written as Markdown blocks. Pure functions of the data and the strings, so
// a sync that runs twice writes the same text.

import { t } from '../../../strings/t';
import type { ExportBook, ExportHighlight } from './api';

/** The section a book goes in, by its Readwise category. */
export function categoryTitle(category: string | null | undefined): string {
  switch ((category ?? '').toLowerCase()) {
    case 'books':
      return t('accounts.readwise.categories.books');
    case 'articles':
      return t('accounts.readwise.categories.articles');
    case 'tweets':
      return t('accounts.readwise.categories.tweets');
    case 'podcasts':
      return t('accounts.readwise.categories.podcasts');
    case 'supplementals':
      return t('accounts.readwise.categories.supplementals');
    default:
      return t('accounts.readwise.categories.other');
  }
}

/** The block at the top of a book's page: who wrote it, where it came from, and a link back. */
export function headerMarkdown(book: ExportBook): string {
  const lines: string[] = [];
  if (book.author) lines.push(t('accounts.readwise.header.by', { author: book.author }));
  if (book.source) lines.push(t('accounts.readwise.header.source', { source: book.source }));
  if (book.summary) lines.push(t('accounts.readwise.header.summary', { summary: book.summary }));
  if (book.readwise_url) lines.push(t('accounts.readwise.header.open', { link: book.readwise_url }));
  return lines.join('\n\n');
}

function locationLine(highlight: ExportHighlight): string | null {
  if (highlight.location === null || highlight.location === undefined) return null;
  const location = String(highlight.location);
  switch (highlight.location_type) {
    case 'page':
      return t('accounts.readwise.highlight.page', { location });
    case 'time_offset':
      return t('accounts.readwise.highlight.time', { location });
    default:
      return t('accounts.readwise.highlight.location', { location });
  }
}

/** One highlight as one block: the quote, then the note, the place, and the tags when it has them. */
export function highlightMarkdown(highlight: ExportHighlight): string {
  const quote = highlight.text
    .trim()
    .split(/\r?\n+/)
    .map((line) => `> ${line}`)
    .join('\n');
  const extras: string[] = [];
  if (highlight.note?.trim()) extras.push(t('accounts.readwise.highlight.note', { note: highlight.note.trim() }));
  const place = locationLine(highlight);
  if (place) extras.push(place);
  const tags = (highlight.tags ?? []).map((tag) => tag.name).filter(Boolean);
  if (tags.length > 0) extras.push(t('accounts.readwise.highlight.tags', { tags: tags.join(', ') }));
  return [quote, ...extras].join('\n\n');
}
