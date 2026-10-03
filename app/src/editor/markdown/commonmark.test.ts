// Non-canonical input is read correctly (ARCHITECTURE.md section 9.4). Examples in the style of the CommonMark
// 0.31.2 spec, at least one for each of its sections, parse without error. Those within the dialect map to the
// expected nodes, and writing any of them is stable after the first write.
import { describe, expect, it } from 'vitest';
import { shape } from '../shape';
import { parseTextBlock } from './parse';
import { serializeTextBlock } from './serialize';

/** A source and the document it reads as, or null when only parsing and stable writing are checked. */
type Example = readonly [source: string, expected: string | null];

const p = (...inline: string[]) => `paragraph(${inline.join(', ')})`;
const doc = (...blocks: string[]) => `doc(${blocks.join(', ')})`;
const item = (...blocks: string[]) => `listItem(${blocks.join(', ')})`;
const bullets = (...items: string[]) => `bulletList(${items.join(', ')})`;
const q = (text: string) => JSON.stringify(text);

const SECTIONS: Readonly<Record<string, readonly Example[]>> = {
  tabs: [
    ['\tfoo\tbaz\t\tbim', doc(`codeBlock(${q('foo\tbaz\t\tbim')})`)],
    ['  - foo\n\n\tbar', doc(bullets(item(p(q('foo')), p(q('bar')))))],
    ['>\t\tfoo', doc(`blockquote(codeBlock(${q('  foo')}))`)],
  ],
  'thematic breaks': [
    ['***\n---\n___', doc('horizontalRule', 'horizontalRule', 'horizontalRule')],
    ['+++', doc(p(q('+++')))],
    [' - - -', doc('horizontalRule')],
    ['Foo\n***\nbar', doc(p(q('Foo')), 'horizontalRule', p(q('bar')))],
    ['- foo\n***\n- bar', doc(bullets(item(p(q('foo')))), 'horizontalRule', bullets(item(p(q('bar')))))],
  ],
  'ATX headings': [
    ['# foo\n## foo\n###### foo', doc('heading[level=1]("foo")', 'heading[level=2]("foo")', 'heading[level=6]("foo")')],
    ['####### foo', doc(p(q('####### foo')))],
    ['#5 bolt\n\n#hashtag', doc(p(q('#5 bolt')), p(q('#hashtag')))],
    ['\\## foo', doc(p(q('## foo')))],
    ['# foo *bar* \\*baz\\*', doc(`heading[level=1](${q('foo ')}, italic("bar"), ${q(' *baz*')})`)],
    ['## foo ##\n### foo \\###', doc('heading[level=2]("foo")', 'heading[level=3]("foo ###")')],
    ['## ', doc('heading[level=2]()')],
  ],
  'setext headings': [
    ['Foo *bar*\n=========', doc(`heading[level=1](${q('Foo ')}, italic("bar"))`)],
    ['Foo\nbar\n---', doc('heading[level=2]("Foo bar")')],
    [
      '---\nFoo\n---\nBar\n---\nBaz',
      doc('horizontalRule', 'heading[level=2]("Foo")', 'heading[level=2]("Bar")', p(q('Baz'))),
    ],
    ['> foo\n-----', doc(`blockquote(${p(q('foo'))})`, 'horizontalRule')],
  ],
  'indented code': [
    ['    a simple\n      indented code block', doc(`codeBlock(${q('a simple\n  indented code block')})`)],
    ['    chunk1\n\n    chunk2', doc(`codeBlock(${q('chunk1\n\nchunk2')})`)],
    ['Foo\n    bar', doc(p(q('Foo bar')))],
  ],
  'fenced code': [
    ['```\n<\n >\n```', doc(`codeBlock(${q('<\n >')})`)],
    ['~~~\naaa\n~~~', doc('codeBlock("aaa")')],
    ['```\naaa\n~~~\n```', doc(`codeBlock(${q('aaa\n~~~')})`)],
    ['```', doc('codeBlock()')],
    ['```ruby\ndef foo(x)\n  return 3\nend\n```', doc(`codeBlock[language=ruby](${q('def foo(x)\n  return 3\nend')})`)],
    ['~~~ ruby startline=3 $%@#$\ndef\n~~~', doc('codeBlock[language=ruby]("def")')],
    ['``` aa ```\nfoo', doc(p('code("aa")', q(' foo')))],
  ],
  'HTML blocks': [
    ['<div>\n*hello*\n</div>', doc(p(q('<div>'), 'hardBreak', q('*hello*'), 'hardBreak', q('</div>')))],
    ['<!-- comment -->', doc(p(q('<!-- comment -->')))],
    ['<table><tr><td>\n<pre>\n**Hello**,\n\n_world_.\n</pre>\n</td></tr></table>', null],
    ['<script>\nalert(1)\n</script>\n\nafter', null],
  ],
  'link reference definitions': [
    ['[foo]: /url "title"\n\n[foo]', doc(p('link/url("foo")'))],
    ['[foo]\n\n[foo]: first\n[foo]: second', doc(p('linkfirst("foo")'))],
    ['[Foo]\n\n[foo]: /url', doc(p('link/url("Foo")'))],
    ['[foo]: /url\n===\n[foo]', doc(p(q('=== '), 'link/url("foo")'))],
  ],
  'paragraphs and blank lines': [
    ['aaa\n\nbbb', doc(p(q('aaa')), p(q('bbb')))],
    ['  aaa\n bbb', doc(p(q('aaa bbb')))],
    ['aaa     \nbbb     ', doc(p(q('aaa'), 'hardBreak', q('bbb')))],
    ['\n\naaa\n\n\n\nbbb\n\n', doc(p(q('aaa')), p(q('bbb')))],
  ],
  'block quotes': [
    ['> # Foo\n> bar\n> baz', doc(`blockquote(heading[level=1]("Foo"), ${p(q('bar baz'))})`)],
    ['> bar\nbaz\n> foo', doc(`blockquote(${p(q('bar baz foo'))})`)],
    ['> foo\n\n> bar', doc(`blockquote(${p(q('foo'))})`, `blockquote(${p(q('bar'))})`)],
    ['>', null],
  ],
  'list items': [
    [
      '1.  A paragraph\n    with two lines.\n\n        indented code\n\n    > A block quote.',
      doc(
        `orderedList[start=1](${item(
          p(q('A paragraph with two lines.')),
          'codeBlock("indented code")',
          `blockquote(${p(q('A block quote.'))})`,
        )})`,
      ),
    ],
    ['- one\n\n two', doc(bullets(item(p(q('one')))), p(q('two')))],
    ['123456789. ok', doc(`orderedList[start=123456789](${item(p(q('ok')))})`)],
    ['1234567890. not ok\n\n-1. not ok', doc(p(q('1234567890. not ok')), p(q('-1. not ok')))],
    [
      '- foo\n  - bar\n    - baz',
      doc(bullets(item(p(q('foo')), bullets(item(p(q('bar')), bullets(item(p(q('baz'))))))))),
    ],
    ['10) foo\n    - bar', doc(`orderedList[start=10](${item(p(q('foo')), bullets(item(p(q('bar')))))})`)],
  ],
  lists: [
    ['- foo\n- bar\n+ baz', doc(bullets(item(p(q('foo'))), item(p(q('bar')))), bullets(item(p(q('baz')))))],
    [
      'The number of windows in my house is\n14.  The number of doors is 6.',
      doc(p(q('The number of windows in my house is 14.  The number of doors is 6.'))),
    ],
    ['- a\n- b\n\n- c', doc(bullets(item(p(q('a'))), item(p(q('b'))), item(p(q('c')))))],
  ],
  'backslash escapes': [
    ['\\!\\"\\#\\$\\%\\&', doc(p(q('!"#$%&')))],
    ['\\\\*emphasis*', doc(p(q('\\'), 'italic("emphasis")'))],
    ['foo\\\nbar', doc(p(q('foo'), 'hardBreak', q('bar')))],
    ['`` \\[\\` ``', doc(p(`code(${q('\\[\\`')})`))],
  ],
  'entity and numeric character references': [
    ['&nbsp; &amp; &copy; &AElig;', doc(p(q(String.fromCharCode(0xa0) + ' & © Æ')))],
    ['&#35; &#1234; &#992; &#0;', doc(p(q('# Ӓ Ϡ �')))],
    ['&#X22; &#XD06; &#xcab;', doc(p(q('" ആ ಫ')))],
  ],
  'code spans': [
    ['`foo`', doc(p('code("foo")'))],
    ['`` foo ` bar ``', doc(p(`code(${q('foo ` bar')})`))],
    ['` `` `', doc(p(`code(${q('``')})`))],
    ['`foo\\`bar`', doc(p(`code(${q('foo\\')})`, q('bar`')))],
  ],
  'emphasis and strong emphasis': [
    ['*foo bar*', doc(p('italic("foo bar")'))],
    ['a * foo bar*', doc(p(q('a * foo bar*')))],
    ['foo*bar*', doc(p(q('foo'), 'italic("bar")'))],
    ['_foo_bar', doc(p(q('_foo_bar')))],
    ['**foo bar**', doc(p('bold("foo bar")'))],
    ['__foo, __bar__, baz__', doc(p('bold("foo, bar, baz")'))],
    ['*foo**bar**baz*', doc(p('italic("foo")', 'bold(italic("bar"))', 'italic("baz")'))],
    ['***foo** bar*', doc(p('bold(italic("foo"))', 'italic(" bar")'))],
  ],
  strikethrough: [['~~Hi~~ Hello, world!', doc(p('strike("Hi")', q(' Hello, world!')))]],
  links: [
    ['[link](/uri "title")', doc(p('link/uri("link")'))],
    ['[link](</my uri>)', doc(p('link/my uri("link")'))],
    ['[link](foo(and(bar)))', doc(p('linkfoo(and(bar))("link")'))],
    ['[link](#fragment)', doc(p('link#fragment("link")'))],
    ['[a](<b)c>)', doc(p('linkb)c("a")'))],
    ['[foo][bar]\n\n[bar]: /url "title"', doc(p('link/url("foo")'))],
    ['[link *foo **bar** `#`*](/uri)', null],
  ],
  images: [
    ['![foo](/url "title")', doc(p('image[src=/url,alt=foo]'))],
    ['![foo *bar*][]\n\n[foo *bar*]: train.jpg', doc(p('image[src=train.jpg,alt=foo bar]'))],
  ],
  autolinks: [
    ['<http://foo.bar.baz>', doc(p('linkhttp://foo.bar.baz("http://foo.bar.baz")'))],
    ['<foo@bar.example.com>', doc(p('linkmailto:foo@bar.example.com("foo@bar.example.com")'))],
    ['<http://foo.bar/baz bim>', doc(p(q('<http://foo.bar/baz bim>')))],
  ],
  'raw HTML': [
    ['<a><bab><c2c>', doc(p(q('<a><bab><c2c>')))],
    ['foo <!-- this is a --\ncomment - with hyphens -->', null],
    ['<a href="javascript:alert(1)">x</a>', null],
  ],
  'hard and soft line breaks': [
    ['foo  \nbar', doc(p(q('foo'), 'hardBreak', q('bar')))],
    ['foo\\', doc(p(q('foo\\')))],
    ['### foo\\', doc('heading[level=3]("foo\\\\")')],
    ['foo\nbaz', doc(p(q('foo baz')))],
  ],
  'textual content': [
    ["hello $.;'there", doc(p(q("hello $.;'there")))],
    ['Foo χρῆν', doc(p(q('Foo χρῆν')))],
  ],
};

describe('CommonMark 0.31.2 examples', () => {
  for (const [section, examples] of Object.entries(SECTIONS)) {
    it.each(examples.map(([source, expected]) => [JSON.stringify(source), source, expected] as const))(
      `${section}: %s`,
      (_label, source, expected) => {
        const parsed = parseTextBlock(source);
        parsed.check();
        if (expected !== null) expect(shape(parsed)).toBe(expected);
        const once = serializeTextBlock(parsed);
        expect(serializeTextBlock(parseTextBlock(once)), once).toBe(once);
      },
    );
  }
});
