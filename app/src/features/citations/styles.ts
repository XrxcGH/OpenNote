// Citation styles (Citation helper): APA, MLA, Chicago (author-date), Harvard, and IEEE. Each gives the short form
// that goes in the text and the full entry for the bibliography, as Markdown with *italics* for titles. The styles
// follow the usual rules for the four kinds of source and are meant as a good first draft: check a style guide for
// unusual sources.
import type { Person, Source } from './model';

export type BuiltinStyleId = 'apa' | 'mla' | 'chicago' | 'harvard' | 'ieee';
export const BUILTIN_STYLE_IDS: readonly BuiltinStyleId[] = ['apa', 'mla', 'chicago', 'harvard', 'ieee'];
/** A style's id: one of the five above, a bundled style file (cslStyles.ts), or a style file the person added. */
export type StyleId = string;

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
export const monthName = (month: string): string => MONTH_NAMES[Number(month) - 1] ?? '';
export const shortMonth = (month: string): string => {
  const name = monthName(month);
  return name.length > 4 ? `${name.slice(0, 3)}.` : name;
};

export const initials = (given: string, dots = true): string =>
  given
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((word) => `${word[0].toUpperCase()}${dots ? '.' : ''}`)
    .join(dots ? ' ' : '');

const full = (person: Person): string => (person.given ? `${person.given} ${person.family}` : person.family);
const andList = (names: readonly string[], word = 'and', comma = true): string =>
  names.length <= 2
    ? names.join(` ${word} `)
    : `${names.slice(0, -1).join(', ')}${comma ? ',' : ''} ${word} ${names.at(-1)}`;

const end = (text: string): string => (text === '' ? '' : /[.?!]$/.test(text) ? text : `${text}.`);
const italic = (text: string): string => (text === '' ? '' : `*${text}*`);
const join = (...parts: string[]): string => parts.filter((part) => part !== '').join(' ');
const pages = (text: string): string => text.replace(/-+/g, '–');
const doiUrl = (source: Source): string => (source.doi ? `https://doi.org/${source.doi}` : source.url);

/** The year, or the word the style uses when there is none. */
const yearOf = (source: Source, none: string): string => source.year || none;

function lead(source: Source): string {
  return source.authors[0]?.family ?? source.title;
}

// ---- APA 7 -----------------------------------------------------------------------------------------------------

function apaNames(source: Source): string {
  const names = source.authors.map((person) =>
    person.given ? `${person.family}, ${initials(person.given)}` : person.family,
  );
  if (names.length > 20) return `${names.slice(0, 19).join(', ')}, ... ${names.at(-1)}`;
  return names.length <= 2
    ? names.join(', & ').replace(', & ', ', & ')
    : `${names.slice(0, -1).join(', ')}, & ${names.at(-1)}`;
}

const apa = {
  inline(source: Source): string {
    const who = source.authors.length === 0 ? `"${source.title}"` : inTextNames(source, '&');
    return `(${who}, ${yearOf(source, 'n.d.')})`;
  },
  reference(source: Source): string {
    const by = apaNames(source);
    const date = source.year
      ? source.type === 'web' && source.month
        ? `(${source.year}, ${monthName(source.month)}${source.day ? ` ${source.day}` : ''})`
        : `(${source.year})`
      : '(n.d.)';
    const link = doiUrl(source);
    switch (source.type) {
      case 'article':
        return join(
          by ? end(by) : '',
          `${date}.`,
          end(source.title),
          source.container
            ? `${italic(source.container)}${source.volume ? `, ${italic(source.volume)}` : ''}${source.issue ? `(${source.issue})` : ''}${source.pages ? `, ${pages(source.pages)}` : ''}.`
            : '',
          link,
        );
      case 'web':
        return join(
          by ? end(by) : '',
          `${date}.`,
          `${italic(source.title)}.`,
          source.container && source.container !== by ? `${end(source.container)}` : '',
          source.url,
        );
      case 'recording':
        return join(by ? end(by) : '', `${date}.`, `${italic(source.title)} [Recording].`, end(source.publisher), link);
      default:
        return join(
          by ? end(by) : '',
          `${date}.`,
          `${italic(source.title)}${source.edition ? ` (${source.edition} ed.)` : ''}.`,
          end(source.publisher),
          link,
        );
    }
  },
};

/** The names for an in-text citation: one family name, two joined, or the first with "et al.". */
export function inTextNames(source: Source, joiner: string): string {
  const families = source.authors.map((person) => person.family);
  if (families.length <= 2) return families.join(` ${joiner} `);
  return `${families[0]} et al.`;
}

// ---- MLA 9 -----------------------------------------------------------------------------------------------------

function mlaNames(source: Source): string {
  const [first, ...rest] = source.authors;
  if (!first) return '';
  if (rest.length === 0) return end(first.given ? `${first.family}, ${first.given}` : first.family);
  if (rest.length === 1)
    return end(`${first.given ? `${first.family}, ${first.given}` : first.family}, and ${full(rest[0])}`);
  return end(`${first.given ? `${first.family}, ${first.given}` : first.family}, et al`);
}

const mla = {
  inline(source: Source): string {
    const who =
      source.authors.length === 0
        ? `"${source.title}"`
        : source.authors.length <= 2
          ? source.authors.map((p) => p.family).join(' and ')
          : `${source.authors[0].family} et al.`;
    return `(${who})`;
  },
  reference(source: Source): string {
    const by = mlaNames(source);
    const date = source.day && source.month ? `${source.day} ${shortMonth(source.month)} ${source.year}` : source.year;
    const link = source.url.replace(/^https?:\/\//, '');
    switch (source.type) {
      case 'article':
        return join(
          by,
          `"${end(source.title).replace(/\.$/, '')}."`,
          source.container
            ? italic(source.container) +
                [
                  source.volume ? `, vol. ${source.volume}` : '',
                  source.issue ? `, no. ${source.issue}` : '',
                  date ? `, ${date}` : '',
                  source.pages ? `, pp. ${pages(source.pages)}` : '',
                ].join('') +
                '.'
            : '',
          source.doi ? `https://doi.org/${source.doi}.` : link ? `${link}.` : '',
        );
      case 'web':
        return join(
          by,
          `"${source.title.replace(/\.$/, '')}."`,
          source.container ? `${italic(source.container)},` : '',
          date ? `${date},` : '',
          link ? `${link}.` : '',
        );
      case 'recording':
        return join(
          by,
          `${italic(source.title)}.`,
          source.publisher ? `${source.publisher},` : '',
          date ? `${date}.` : '',
          link ? `${link}.` : '',
        );
      default:
        return join(
          by,
          `${italic(source.title)}${source.edition ? `. ${source.edition} ed` : ''}.`,
          source.publisher ? `${source.publisher},` : '',
          source.year ? `${source.year}.` : '',
        );
    }
  },
};

// ---- Chicago author-date and Harvard ---------------------------------------------------------------------------

function surnameFirst(person: Person): string {
  return person.given ? `${person.family}, ${initials(person.given).replace(/\. /g, '.')}` : person.family;
}

function chicagoNames(source: Source): string {
  const [first, ...rest] = source.authors;
  if (!first) return '';
  const firstName = first.given ? `${first.family}, ${first.given}` : first.family;
  if (rest.length === 0) return firstName;
  return rest.length === 1
    ? `${firstName}, and ${full(rest[0])}`
    : andList([firstName, ...rest.map(full)], 'and', true);
}

const chicago = {
  inline(source: Source): string {
    const who = source.authors.length === 0 ? source.title : inTextNames(source, 'and');
    return `(${who} ${yearOf(source, 'n.d.')})`;
  },
  reference(source: Source): string {
    const by = chicagoNames(source);
    const year = yearOf(source, 'n.d.');
    const link = doiUrl(source);
    switch (source.type) {
      case 'article':
        return join(
          by ? end(by) : '',
          `${year}.`,
          `"${source.title.replace(/\.$/, '')}."`,
          source.container
            ? `${italic(source.container)}${source.volume ? ` ${source.volume}` : ''}${source.issue ? ` (${source.issue})` : ''}${source.pages ? `: ${pages(source.pages)}` : ''}.`
            : '',
          end(link),
        );
      case 'web':
        return join(
          by ? end(by) : '',
          `${year}.`,
          `"${source.title.replace(/\.$/, '')}."`,
          source.container ? end(source.container) : '',
          end(link),
        );
      case 'recording':
        return join(
          by ? end(by) : '',
          `${year}.`,
          `${italic(source.title)}.`,
          source.publisher ? `${end(source.publisher)}` : '',
          end(link),
        );
      default: {
        const pub = `${source.place ? `${source.place}: ` : ''}${source.publisher}`.trim();
        return join(
          by ? end(by) : '',
          `${year}.`,
          `${italic(source.title)}${source.edition ? `. ${source.edition} ed` : ''}.`,
          pub ? end(pub) : '',
        );
      }
    }
  },
};

const harvard = {
  inline(source: Source): string {
    const who = source.authors.length === 0 ? source.title : inTextNames(source, 'and');
    return `(${who} ${yearOf(source, 'n.d.')})`;
  },
  reference(source: Source): string {
    const names = source.authors.map((person) => surnameFirst(person));
    const by = andList(names, 'and', false);
    const year = `(${yearOf(source, 'n.d.')})`;
    const link = doiUrl(source);
    switch (source.type) {
      case 'article':
        return join(
          by,
          year,
          `'${source.title}',`,
          source.container
            ? `${italic(source.container)}${source.volume ? `, ${source.volume}` : ''}${source.issue ? `(${source.issue})` : ''}${source.pages ? `, pp. ${pages(source.pages)}` : ''}.`
            : '',
          link ? `Available at: ${link}` : '',
        );
      case 'web':
        return join(
          by,
          year,
          `${italic(source.title)}.`,
          source.accessed
            ? `Available at: ${source.url} (Accessed: ${source.accessed}).`
            : source.url
              ? `Available at: ${source.url}.`
              : '',
        );
      default:
        return join(
          by,
          year,
          `${italic(source.title)}${source.type === 'recording' ? ' [Recording]' : ''}.`,
          source.edition ? `${source.edition} edn.` : '',
          end(`${source.place ? `${source.place}: ` : ''}${source.publisher}`.trim()),
          link && source.type === 'recording' ? `Available at: ${link}` : '',
        );
    }
  },
};

// ---- IEEE ------------------------------------------------------------------------------------------------------

const ieee = {
  inline(_source: Source, number = 1): string {
    return `[${number}]`;
  },
  reference(source: Source, number = 1): string {
    const names = source.authors.map((person) =>
      person.given ? `${initials(person.given)} ${person.family}` : person.family,
    );
    const by = names.length > 6 ? `${names[0]} et al.` : andList(names, 'and');
    const date = source.month ? `${shortMonth(source.month)} ${source.year}` : source.year;
    const link = source.doi ? `doi: ${source.doi}.` : source.url ? `[Online]. Available: ${source.url}` : '';
    const parts =
      source.type === 'article'
        ? [
            `"${source.title},"`,
            source.container ? `${italic(source.container)},` : '',
            source.volume ? `vol. ${source.volume},` : '',
            source.issue ? `no. ${source.issue},` : '',
            source.pages ? `pp. ${pages(source.pages)},` : '',
            date ? `${date}.` : '',
            link,
          ]
        : source.type === 'web'
          ? [
              `"${source.title},"`,
              source.container ? `${italic(source.container)}.` : '',
              link,
              source.accessed ? `Accessed: ${source.accessed}.` : '',
            ]
          : [
              `${italic(source.title)}${source.type === 'recording' ? ' [Recording]' : ''}${source.edition ? `, ${source.edition} ed.` : ''}`,
              `${source.place ? `${source.place}: ` : ''}${source.publisher}${date ? `, ${date}` : ''}.`.replace(
                /^[:,\s]+/,
                '',
              ),
              link,
            ];
    return `[${number}] ${join(by ? `${by},` : '', ...parts)}`.replace(/,\s*\./g, '.').replace(/,$/, '.');
  },
};

export interface CitationStyle {
  inline(source: Source, number?: number): string;
  reference(source: Source, number?: number): string;
  /** Whether the bibliography is in the order sources were first cited rather than alphabetical. */
  numbered: boolean;
}

export const STYLES: Record<StyleId, CitationStyle> = {
  apa: { ...apa, numbered: false },
  mla: { ...mla, numbered: false },
  chicago: { ...chicago, numbered: false },
  harvard: { ...harvard, numbered: false },
  ieee: { ...ieee, numbered: true },
};

/** The style with this id, or APA when it is gone (a style file that was removed). */
export const styleOf = (id: StyleId): CitationStyle => STYLES[id] ?? STYLES.apa;

/** The sources in the order a bibliography lists them: alphabetical by lead and year, or as given for IEEE. */
export function bibliographyOrder(sources: readonly Source[], style: StyleId): Source[] {
  if (styleOf(style).numbered) return [...sources];
  return [...sources].sort(
    (a, b) => lead(a).localeCompare(lead(b)) || a.year.localeCompare(b.year) || a.title.localeCompare(b.title),
  );
}

/** The bibliography as Markdown lines. */
export function bibliography(sources: readonly Source[], style: StyleId): string {
  const ordered = bibliographyOrder(sources, style);
  return ordered.map((source, index) => styleOf(style).reference(source, index + 1)).join('\n\n');
}

const htmlOf = (markdown: string): string =>
  markdown
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');

/** The bibliography as HTML paragraphs, which the editor takes in with the titles in italics. */
export function bibliographyHtml(sources: readonly Source[], style: StyleId): string {
  return bibliographyOrder(sources, style)
    .map((source, index) => `<p>${htmlOf(styleOf(style).reference(source, index + 1))}</p>`)
    .join('');
}
