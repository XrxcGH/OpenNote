// Sources: BibTeX and RIS in and out, Zotero items, the five styles, and merging without repeats.
import { describe, expect, it } from 'vitest';
import { parseBibtex, parseRis, toBibtex, toRis } from './bibtex';
import { blankSource, mergeSources, parsePeople } from './model';
import type { Source } from './model';
import { STYLES, bibliography } from './styles';
import { fromZotero } from './zotero';

const BIB = `
@article{smith2020,
  author = {Smith, Jane Q. and Lee, Wei},
  title = {Sleep and {M}emory in Students},
  journal = {Journal of Learning},
  year = {2020},
  volume = {12},
  number = {3},
  pages = {45--67},
  doi = {10.1000/xyz123}
}
@book{garcia2018, author = "Maria Garcia", title = "Notes on Notes", publisher = {Open Press}, address = {Austin}, year = 2018}
@misc{site, title = {A Web Page}, url = {https://example.org/page}, year = {2022}, month = mar}
@comment{ignored}
@article{broken, author = {Nobody}}
`;

const article = (): Source => ({
  ...blankSource('article'),
  title: 'Sleep and Memory in Students',
  authors: [
    { family: 'Smith', given: 'Jane Q.' },
    { family: 'Lee', given: 'Wei' },
  ],
  year: '2020',
  container: 'Journal of Learning',
  volume: '12',
  issue: '3',
  pages: '45–67',
  doi: '10.1000/xyz123',
});

describe('BibTeX', () => {
  it('reads articles, books, and web pages and skips what has no title', () => {
    const { sources, skipped } = parseBibtex(BIB);
    expect(sources.map((s) => [s.type, s.title])).toEqual([
      ['article', 'Sleep and Memory in Students'],
      ['book', 'Notes on Notes'],
      ['web', 'A Web Page'],
    ]);
    expect(skipped).toBe(1);
    expect(sources[0]).toMatchObject({ year: '2020', volume: '12', issue: '3', pages: '45–67', doi: '10.1000/xyz123' });
    expect(sources[0].authors).toEqual([
      { family: 'Smith', given: 'Jane Q.' },
      { family: 'Lee', given: 'Wei' },
    ]);
    expect(sources[1].authors).toEqual([{ family: 'Garcia', given: 'Maria' }]);
    expect(sources[2]).toMatchObject({ month: '3', url: 'https://example.org/page' });
  });
  it('writes entries it can read back', () => {
    const back = parseBibtex(toBibtex([article()]));
    expect(back.sources[0]).toMatchObject({ title: 'Sleep and Memory in Students', year: '2020', pages: '45–67' });
  });
  it('writes a backslash and the characters BibTeX reserves, and reads them back', () => {
    const title = String.raw`Paths like C:\Notes & 50% of #1 \& more_`;
    const back = parseBibtex(toBibtex([{ ...article(), title }]));
    expect(back.sources[0].title).toBe(title);
  });
});

describe('RIS', () => {
  const RIS =
    'TY  - JOUR\nAU  - Smith, Jane Q.\nAU  - Lee, Wei\nTI  - Sleep and Memory\nJO  - Journal of Learning\nPY  - 2020///\nVL  - 12\nSP  - 45\nEP  - 67\nER  - \n\nTY  - SOUND\nTI  - Lecture One\nPY  - 2021\nER  - \n\nTY  - JOUR\nER  - ';
  it('reads records and counts the ones with no title', () => {
    const { sources, skipped } = parseRis(RIS);
    expect(sources.map((s) => [s.type, s.title, s.year])).toEqual([
      ['article', 'Sleep and Memory', '2020'],
      ['recording', 'Lecture One', '2021'],
    ]);
    expect(sources[0].pages).toBe('45–67');
    expect(skipped).toBe(1);
  });
  it('writes records it can read back', () => {
    expect(parseRis(toRis([article()])).sources[0]).toMatchObject({
      title: 'Sleep and Memory in Students',
      volume: '12',
    });
  });
});

describe('Zotero', () => {
  it('turns library items into sources and leaves attachments out', () => {
    const { sources, skipped } = fromZotero([
      {
        data: {
          itemType: 'journalArticle',
          title: 'T',
          date: '2019-05-02',
          creators: [{ creatorType: 'author', firstName: 'A', lastName: 'B' }],
          publicationTitle: 'J',
          DOI: '10.1/x',
        },
      },
      { data: { itemType: 'attachment', title: 'PDF' } },
      { data: { itemType: 'patent', title: 'P' } },
    ]);
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ type: 'article', year: '2019', month: '5', container: 'J', doi: '10.1/x' });
    expect(skipped).toBe(1);
  });
});

describe('styles', () => {
  const s = article();
  it('write APA', () => {
    expect(STYLES.apa.inline(s)).toBe('(Smith & Lee, 2020)');
    expect(STYLES.apa.reference(s)).toBe(
      'Smith, J. Q., & Lee, W. (2020). Sleep and Memory in Students. *Journal of Learning*, *12*(3), 45–67. https://doi.org/10.1000/xyz123',
    );
  });
  it('write MLA', () => {
    expect(STYLES.mla.inline(s)).toBe('(Smith and Lee)');
    expect(STYLES.mla.reference(s)).toContain(
      'Smith, Jane Q., and Wei Lee. "Sleep and Memory in Students." *Journal of Learning*, vol. 12, no. 3, 2020, pp. 45–67.',
    );
  });
  it('write Chicago, Harvard, and IEEE', () => {
    expect(STYLES.chicago.inline(s)).toBe('(Smith and Lee 2020)');
    expect(STYLES.chicago.reference(s)).toContain('Smith, Jane Q., and Wei Lee. 2020. "Sleep and Memory in Students."');
    expect(STYLES.harvard.reference(s)).toContain("Smith, J.Q. and Lee, W. (2020) 'Sleep and Memory in Students',");
    expect(STYLES.ieee.inline(s, 3)).toBe('[3]');
    expect(STYLES.ieee.reference(s, 3)).toMatch(/^\[3\] J\. Q\. Smith and W\. Lee, "Sleep and Memory in Students,"/);
  });
  it('cite many authors with et al. and sources with no author by title', () => {
    const many: Source = { ...s, authors: [...s.authors, { family: 'Ito', given: 'Aya' }] };
    expect(STYLES.apa.inline(many)).toBe('(Smith et al., 2020)');
    expect(STYLES.apa.inline({ ...s, authors: [] })).toBe('("Sleep and Memory in Students", 2020)');
  });
  it('order a bibliography by author, and keep IEEE in citation order', () => {
    const a = { ...blankSource('book'), title: 'Zed', authors: [{ family: 'Young', given: 'Y' }], year: '2001' };
    const b = { ...blankSource('book'), title: 'Alpha', authors: [{ family: 'Adams', given: 'A' }], year: '2002' };
    expect(bibliography([a, b], 'apa').split('\n\n')[0]).toMatch(/^Adams, A\./);
    expect(bibliography([a, b], 'ieee').split('\n\n')[0]).toMatch(/^\[1\] Y\. Young/);
  });
});

describe('the source list', () => {
  it('reads names in either order', () => {
    expect(parsePeople('Smith, Jane\nWei Lee; Plato')).toEqual([
      { family: 'Smith', given: 'Jane' },
      { family: 'Lee', given: 'Wei' },
      { family: 'Plato', given: '' },
    ]);
  });
  it('merges without repeats by DOI or by title, first author, and year', () => {
    const one = article();
    const same = { ...article(), id: 'other' };
    const other = { ...blankSource('book'), title: 'Different', year: '2001' };
    const { sources, skipped } = mergeSources([one], [same, other]);
    expect(sources).toHaveLength(2);
    expect(skipped).toBe(1);
  });
});
