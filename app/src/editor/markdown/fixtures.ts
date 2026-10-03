// Canonical OpenNote Markdown that must survive `serialize(parse(m)) === m` (SPEC 7.8), and the escape pairs of
// SPEC Appendix B.5. The shared files in docs/format/fixtures/markdown/ will hold the same kinds of cases.

export interface Fixture {
  readonly name: string;
  readonly markdown: string;
}

const lines = (...rows: string[]) => rows.join('\n');

export const DOCUMENTS: readonly Fixture[] = [
  { name: 'an empty block', markdown: '' },
  { name: 'paragraphs', markdown: lines('First paragraph.', '', 'Second paragraph.') },
  { name: 'headings', markdown: lines('# One', '', '## Two', '', '###### Six', '', '#') },
  {
    name: 'delimiter marks',
    markdown: 'A **strong**, *emphasized*, ~~struck~~, ==highlighted==, and `code` word.',
  },
  { name: 'marks inside a word', markdown: 'un**believ**able and in*cred*ible' },
  {
    name: 'a delimiter that would not open becomes a tag',
    markdown: lines('a<strong>(b)</strong>', '', '<em>"quoted"</em>x', '', '**(b)** c'),
  },
  {
    name: 'tags for marks without delimiters',
    markdown: lines(
      'H<sub>2</sub>O and E=mc<sup>2</sup> and <u>under</u>',
      '',
      // checks-disable-next-line brand-consistency: document content, not interface styling
      '<mark data-color="mint">mint</mark> and <span data-color="#aa0000">red</span>',
      '',
      '<span data-color="moss">pen</span> and <span data-size="large">big</span>',
    ),
  },
  { name: 'overlapping ranges close and reopen', markdown: '**a*b***<em>c</em>' },
  { name: 'strong and emphasis together', markdown: '***both*** and **bold *and italic* bold**' },
  { name: 'whitespace moves outside the marks', markdown: 'one **two** three *four*&#32;' },
  { name: 'marks around code and links', markdown: '**`code`** and [**link**](https://example.com) and [`x`](a.md)' },
  {
    name: 'links and images',
    markdown: lines(
      '[text](https://example.com/a?b=1&c=2) and [page](opennote:page/01m3sabc31y0rfa24eeh6j4ky4#01m3sabc32dwqknfawtgwtsgcj)',
      '',
      '[a b](<https://example.com/a b>) and [f(x)](<https://example.com/f(x)>)',
      '',
      '![a chart](asset:01m3sabc31y0rfa24eeh6j4ky4) and ![](https://example.com/x.png)',
    ),
  },
  { name: 'hard breaks', markdown: lines('line one\\', 'line two\\', 'line three') },
  {
    name: 'escapes',
    markdown: lines(
      '5 \\* 3 = 15 \\$5 \\[draft\\] \\<b>',
      '',
      '\\# not a heading',
      '',
      '1\\. not a list and - not a bullet',
      '',
      'a \\=\\= b',
      '',
      '\\- first and > mid and + plus',
    ),
  },
  {
    name: 'a bullet list',
    markdown: lines('- one', '- two', '- three'),
  },
  {
    name: 'a numbered list that starts at 3 and reaches two digits',
    markdown: lines('8. eight', '9. nine', '10. ten', '11. eleven'),
  },
  { name: 'task items', markdown: lines('- [ ] to do', '- [x] done', '- plain', '- [ ]') },
  {
    name: 'a nested list makes its list loose',
    markdown: lines('- one', '', '- two', '', '  - nested', '', '    - deeper', '', '- three'),
  },
  {
    name: 'an item with two blocks',
    markdown: lines('1. intro', '', '   more text', '', '   ```', '   code', '   ```', '', '2. next'),
  },
  {
    name: 'two adjacent lists of different kinds',
    markdown: lines('- bullet', '', '1. numbered', '', '- bullet again'),
  },
  { name: 'a quote', markdown: lines('> quoted', '>', '> - item', '>', '> > inner') },
  {
    name: 'callouts',
    markdown: lines(
      '> [!note]',
      '',
      '> [!tip] A title with **bold**',
      '',
      '> [!warning]- Folded',
      '>',
      '> Body text',
      '>',
      '> - item',
      '',
      '> [!custom]+ Open, unknown type',
    ),
  },
  {
    name: 'code blocks',
    markdown: lines(
      '```js',
      'const a = 1;',
      '',
      'f(a);',
      '```',
      '',
      '```',
      '```',
      '',
      '````',
      '```',
      'inner',
      '```',
      '````',
    ),
  },
  { name: 'a thematic break', markdown: lines('above', '', '---', '', 'below') },
  { name: 'math', markdown: lines('$$', 'x^2 + y^2', '$$', '', 'inline $a_b$ math and \\$5') },
  { name: 'a unicode paragraph', markdown: 'Caf\u00e9 \u2014 \u00fcber \u{1f600} **\u{1f600}** snake_case' },
  { name: 'a line that starts with spaces', markdown: lines('&#32;indented', '', '&#32;&#32;', '', 'tab&#9;here') },
];

/** SPEC B.5: plain text and how a paragraph line holding it is written. */
export const ESCAPES: readonly (readonly [text: string, written: string])[] = [
  ['5 * 3 = 15', '5 \\* 3 = 15'],
  ['a == b', 'a \\=\\= b'],
  ['Costs $5', 'Costs \\$5'],
  ['#biology and C#', '\\#biology and C#'],
  ['snake_case and _draft', 'snake_case and \\_draft'],
  ['[draft]', '\\[draft\\]'],
  ['AT&T and &amp;', 'AT&T and \\&amp;'],
  ['x < y', 'x \\< y'],
  ['~5 minutes', '\\~5 minutes'],
  ['{note}', '\\{note}'],
  ['1. Not a list', '1\\. Not a list'],
  ['- not a bullet', '\\- not a bullet'],
  [' starts with a space', '&#32;starts with a space'],
  ['ends with a space ', 'ends with a space&#32;'],
  ['a\tb', 'a&#9;b'],
  ['> not a quote', '\\> not a quote'],
  ['a|b and back\\slash and `tick`', 'a\\|b and back\\\\slash and \\`tick\\`'],
  ['=first and a=b', '\\=first and a=b'],
];
