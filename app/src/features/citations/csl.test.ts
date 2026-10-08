// Style files: the bundled Vancouver, AMA, ACS, Turabian, and Nature styles against known-good entries (the golden
// strings), the template language, and reading a style file the person chose.
import { describe, expect, it } from 'vitest';
import { fill, formatNames, problemWith, readStyleFile } from './csl';
import type { StyleFile } from './csl';
import { acs, ama, nature, turabian, vancouver } from './cslStyles';
import { blankSource } from './model';
import type { Source } from './model';
import { addStyleFile, isOwnStyle, removeStyleFile, styleChoices } from './styleList';
import { STYLES, bibliography, bibliographyHtml, styleOf } from './styles';

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

const book = (): Source => ({
  ...blankSource('book'),
  title: 'Notes on Notes',
  authors: [{ family: 'Garcia', given: 'Maria' }],
  publisher: 'Open Press',
  place: 'Austin',
  year: '2018',
});

const web = (): Source => ({
  ...blankSource('web'),
  title: 'A Web Page',
  url: 'https://example.org/page',
  year: '2022',
});

describe('the bundled styles', () => {
  it('write a journal article in Vancouver', () => {
    expect(STYLES.vancouver.reference(article(), 1)).toBe(
      '1. Smith JQ, Lee W. Sleep and Memory in Students. Journal of Learning. 2020;12(3):45-67. doi:10.1000/xyz123',
    );
    expect(STYLES.vancouver.inline(article(), 4)).toBe('[4]');
  });

  it('write a journal article in AMA, with the number raised in the text', () => {
    expect(STYLES.ama.reference(article(), 2)).toBe(
      '2. Smith JQ, Lee W. Sleep and Memory in Students. *Journal of Learning*. 2020;12(3):45-67. doi:10.1000/xyz123',
    );
    expect(STYLES.ama.inline(article(), 12)).toBe('¹²');
  });

  it('write a journal article in ACS, with the year in bold and the volume in italics', () => {
    expect(STYLES.acs.reference(article(), 1)).toBe(
      '1. Smith, J. Q.; Lee, W. Sleep and Memory in Students. *Journal of Learning* **2020**, *12* (3), 45−67. https://doi.org/10.1000/xyz123',
    );
    expect(STYLES.acs.inline(article(), 5)).toBe('(5)');
  });

  it('write a journal article and a book in Turabian', () => {
    expect(STYLES.turabian.reference(article())).toBe(
      'Smith, Jane Q., and Wei Lee. "Sleep and Memory in Students." *Journal of Learning* 12, no. 3 (2020): 45–67. https://doi.org/10.1000/xyz123.',
    );
    expect(STYLES.turabian.reference(book())).toBe('Garcia, Maria. *Notes on Notes*. Austin: Open Press, 2018.');
    expect(STYLES.turabian.inline(article())).toBe('Smith and Lee, "Sleep and Memory in Students"');
  });

  it('write a journal article in Nature', () => {
    expect(STYLES.nature.reference(article(), 1)).toBe(
      '1. Smith, J. Q. & Lee, W. Sleep and Memory in Students. *Journal of Learning* **12**, 45–67 (2020).',
    );
    expect(STYLES.nature.inline(article(), 3)).toBe('³');
  });

  it('write books and web pages without empty brackets where a field is missing', () => {
    expect(STYLES.vancouver.reference(book(), 1)).toBe('1. Garcia M. Notes on Notes. Austin: Open Press; 2018.');
    expect(STYLES.vancouver.reference(web(), 1)).toBe(
      '1. A Web Page [Internet]. 2022. Available from: https://example.org/page',
    );
    expect(STYLES.ama.reference({ ...article(), issue: '', doi: '' }, 1)).toBe(
      '1. Smith JQ, Lee W. Sleep and Memory in Students. *Journal of Learning*. 2020;12:45-67.',
    );
    expect(STYLES.nature.reference({ ...book(), authors: [] }, 1)).toBe('1. *Notes on Notes* (Open Press, 2018).');
  });

  it('cut a long author list to "et al." by each style\'s own rule', () => {
    const many: Source = {
      ...article(),
      authors: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((family) => ({ family, given: 'Pat' })),
    };
    expect(STYLES.vancouver.reference(many, 1)).toContain('A P, B P, C P, D P, E P, F P, et al. Sleep');
    expect(STYLES.ama.reference(many, 1)).toContain('A P, B P, C P, et al. Sleep');
    expect(STYLES.nature.reference(many, 1)).toContain('A, P., et al. Sleep');
  });

  it('keep numbered styles in the order given and the others alphabetical', () => {
    const a = { ...book(), title: 'Zed', authors: [{ family: 'Young', given: 'Y' }] };
    const b = { ...book(), title: 'Alpha', authors: [{ family: 'Adams', given: 'A' }] };
    expect(bibliography([a, b], 'vancouver').split('\n\n')[0]).toMatch(/^1\. Young Y\./);
    expect(bibliography([a, b], 'turabian').split('\n\n')[0]).toMatch(/^Adams, A\./);
  });

  it('turn bold and italic Markdown into tags in a bibliography for the page', () => {
    expect(bibliographyHtml([article()], 'acs')).toContain('<em>Journal of Learning</em> <strong>2020</strong>');
  });
});

describe('the style list', () => {
  it('lists the five built-in styles, then the bundled ones', () => {
    const ids = styleChoices().map((one) => one.id);
    expect(ids.slice(0, 5)).toEqual(['apa', 'mla', 'chicago', 'harvard', 'ieee']);
    expect(ids).toEqual(expect.arrayContaining(['vancouver', 'ama', 'acs', 'turabian', 'nature']));
  });

  it('fall back to APA for a style that is gone', () => {
    expect(styleOf('removed-style')).toBe(STYLES.apa);
  });
});

describe('the template language', () => {
  const rules = vancouver.names;
  it('drops a group when a field in it is empty, and tidies the stops that are left', () => {
    const source = { ...article(), authors: [], volume: '' };
    expect(fill('[{authors}. ]{title}. [vol. {volume}. ]{year}.', source, rules)).toBe(
      'Sleep and Memory in Students. 2020.',
    );
    expect(fill('{title}?.', { ...source, title: 'Why?' }, rules)).toBe('Why??');
  });

  it('writes brackets and braces that are escaped as themselves', () => {
    expect(fill('{title} \\[Internet\\] \\{x\\}', article(), rules)).toBe(
      'Sleep and Memory in Students [Internet] {x}',
    );
  });

  it('changes a field with a modifier', () => {
    expect(fill('{pages}|{pages|hyphen}|{pages|minus}', article(), rules)).toBe('45–67|45-67|45−67');
  });

  it('formats names in each form', () => {
    const people = article().authors;
    const form = (value: StyleFile['names']['form']) =>
      formatNames(people, { form: value, separator: ', ', last: ' and ' });
    expect(form('family-initials')).toBe('Smith JQ and Lee W');
    expect(form('family-initials-dots')).toBe('Smith, J. Q. and Lee, W.');
    expect(form('initials-family')).toBe('J. Q. Smith and W. Lee');
    expect(form('family-given')).toBe('Smith, Jane Q. and Lee, Wei');
    expect(form('given-family')).toBe('Jane Q. Smith and Wei Lee');
    expect(form('first-turned')).toBe('Smith, Jane Q. and Wei Lee');
  });
});

describe('reading a style file', () => {
  const sound = (): StyleFile => ({
    id: 'my-style',
    title: 'My style',
    numbered: false,
    names: { form: 'family-given', separator: '; ', last: ' and ' },
    inline: '({who}, {year})',
    entry: { book: '{authors} ({year}). {title}.' },
  });

  it('accepts a sound file and uses it for any kind of source', () => {
    const read = readStyleFile(JSON.stringify(sound()));
    expect('style' in read).toBe(true);
    expect(problemWith(sound())).toBeNull();
    expect(fill(sound().entry.book, article(), sound().names)).toBe(
      'Smith, Jane Q. and Lee, Wei (2020). Sleep and Memory in Students.',
    );
  });

  it('refuses text that is not JSON, a file missing parts, and a template that cannot be read', () => {
    expect(readStyleFile('not json')).toEqual({ error: 'not-json' });
    expect(readStyleFile(JSON.stringify({ id: 'x' }))).toEqual({ error: 'shape' });
    expect(readStyleFile(JSON.stringify({ ...sound(), id: 'Bad Id!' }))).toEqual({ error: 'shape' });
    const errorOf = (inline: string): string => {
      const read = readStyleFile(JSON.stringify({ ...sound(), inline }));
      return 'error' in read ? read.error : '';
    };
    expect(errorOf('({who')).toMatch(/no \}/);
    expect(errorOf('{nothing}')).toMatch(/does not exist: nothing/);
    expect(errorOf('[{who}')).toMatch(/no \]/);
  });

  it('adds a style the app does not have, uses it, and takes it away again', () => {
    expect(addStyleFile(sound())).toBe(true);
    expect(styleOf('my-style').inline(article())).toBe('(Smith and Lee, 2020)');
    expect(styleChoices().find((one) => one.id === 'my-style')).toMatchObject({ label: 'My style', added: true });
    removeStyleFile('my-style');
    expect(styleOf('my-style')).toBe(STYLES.apa);
  });

  it('will not replace a style the app owns', () => {
    expect(isOwnStyle('apa')).toBe(true);
    expect(isOwnStyle('vancouver')).toBe(true);
    expect(addStyleFile({ ...sound(), id: 'apa' })).toBe(false);
    expect(addStyleFile({ ...sound(), id: 'vancouver' })).toBe(false);
    removeStyleFile('apa');
    expect(STYLES.apa).toBeDefined();
  });

  it('are all sound: every bundled file passes the check', () => {
    for (const file of [vancouver, ama, acs, turabian, nature]) expect(problemWith(file), file.id).toBeNull();
  });
});
