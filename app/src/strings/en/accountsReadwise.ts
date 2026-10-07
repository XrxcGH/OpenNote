// Readwise sync: the command, the notebook it fills, and what it says when it finishes.

export const accountsReadwise = {
  commands: {
    sync: 'Sync Readwise',
    keywords: 'readwise highlights books kindle articles import sync notebook',
  },
  notebook: 'Readwise',
  categories: {
    books: 'Books',
    articles: 'Articles',
    tweets: 'Tweets',
    podcasts: 'Podcasts',
    supplementals: 'Supplementals',
    other: 'Other',
  },
  header: {
    by: 'By {author}',
    source: 'Source: {source}',
    open: 'Open in Readwise: {link}',
    summary: 'Summary: {summary}',
  },
  highlight: {
    note: 'Note: {note}',
    location: 'Location {location}',
    page: 'Page {location}',
    time: 'Time {location}',
    tags: 'Tags: {tags}',
  },
  working: 'Syncing Readwise…',
  done: 'Readwise is up to date. {added, plural, one {# new highlight} other {# new highlights}}, {updated} changed, {removed} removed.',
  upToDate: 'Readwise has nothing new since the last sync.',
  rateLimited: 'Readwise asked OpenNote to wait. Try again in a minute. What was synced so far is kept.',
  opened: 'Open the Readwise notebook',
} as const;
