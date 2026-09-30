import type { Node as PMNode } from '@tiptap/pm/model';
import { describe, expect, it } from 'vitest';
import { joinListsDeep } from './normalize';
import { parseTextBlock } from './parse';
import { serializeTextBlock } from './serialize';
import { textSchema } from '../schema/schema';
import { shape } from '../shape';

const read = (markdown: string) => shape(parseTextBlock(markdown));

describe('parsing OpenNote Markdown', () => {
  it('reads task items, checked or not, in any list', () => {
    expect(read('- [ ] open\n- [x] done\n- [X] shout\n- plain')).toBe(
      'doc(bulletList(listItem[checked=false](paragraph("open")), listItem[checked=true](paragraph("done")), ' +
        'listItem[checked=true](paragraph("shout")), listItem(paragraph("plain"))))',
    );
  });

  it('keeps an escaped task marker as text', () => {
    expect(read('- \\[ \\] not a task')).toBe('doc(bulletList(listItem(paragraph("[ ] not a task"))))');
  });

  it('reads nested lists, numbered starts, and mixed kinds', () => {
    expect(read('3. a\n   - b\n   - c\n4. d')).toBe(
      'doc(orderedList[start=3](listItem(paragraph("a"), bulletList(listItem(paragraph("b")), ' +
        'listItem(paragraph("c")))), listItem(paragraph("d"))))',
    );
  });

  it('reads callouts with a fold and a title, and keeps unknown types', () => {
    expect(read('> [!warning]- Careful now\n>\n> Body')).toBe(
      'doc(callout[type=warning,fold=-](calloutTitle("Careful now"), paragraph("Body")))',
    );
    expect(read('> [!Odd]+ Open')).toBe('doc(callout[type=odd,fold=+](calloutTitle("Open")))');
    expect(read('> \\[!note] plain quote')).toBe('doc(blockquote(paragraph("[!note] plain quote")))');
  });

  it('reads a callout body that follows the title line directly', () => {
    expect(read('> [!tip] Title\n> body line')).toBe(
      'doc(callout[type=tip](calloutTitle("Title"), paragraph("body line")))',
    );
  });

  it('reads highlights in the default color and in the named ones', () => {
    expect(read('==honey== and <mark data-color="mint">mint</mark> and <mark>plain</mark>')).toBe(
      'doc(paragraph(highlight("honey"), " and ", highlightmint("mint"), " and ", highlight("plain")))',
    );
    expect(read('a == b')).toBe('doc(paragraph("a == b"))');
  });

  it('reads the allowed HTML tags as marks, and any other HTML as text', () => {
    // checks-disable-next-line brand-consistency: document content, not interface styling
    expect(read('<u>under</u> <span data-size="large">big</span> <span data-color="#aa0000">red</span>')).toBe(
      'doc(paragraph(underline("under"), " ", textSizelarge("big"), " ", textColor#aa0000("red")))',
    );
    expect(read('<b>bold</b> and <u>open')).toBe('doc(paragraph("<b>bold</b> and <u>open"))');
    expect(read('<u>a <sub>b</u> c</sub>')).toBe('doc(paragraph("<u>a ", subscript("b</u> c")))');
    expect(read('<div>block</div>')).toBe('doc(paragraph("<div>block</div>"))');
  });

  it('turns other CommonMark constructs into their canonical equivalents', () => {
    expect(read('Title\n=====')).toBe('doc(heading[level=1]("Title"))');
    expect(read('    indented code')).toBe('doc(codeBlock("indented code"))');
    expect(read('* star\n* bullets')).toBe(
      'doc(bulletList(listItem(paragraph("star")), listItem(paragraph("bullets"))))',
    );
    expect(read('__strong__ and _em_')).toBe('doc(paragraph(bold("strong"), " and ", italic("em")))');
    expect(read('[ref] and <https://example.com>\n\n[ref]: https://example.com/ref')).toBe(
      'doc(paragraph(linkhttps://example.com/ref("ref"), " and ", linkhttps://example.com("https://example.com")))',
    );
    expect(read('wrapped\nlines')).toBe('doc(paragraph("wrapped lines"))');
  });

  it('keeps links with unknown schemes and drops script links', () => {
    expect(read('[a](ftp://x.y/z) [b](javascript:alert(1)) [c](<data:text/html,x>)')).toBe(
      'doc(paragraph(linkftp://x.y/z("a"), " [b](javascript:alert(1)) [c](<data:text/html,x>)"))',
    );
  });

  it('reads math atoms and keeps their source', () => {
    expect(read('$$\nx^2\n$$\n\nsolve $a_b$ and cost \\$5')).toBe(
      'doc(mathBlock[source=x^2], paragraph("solve ", mathInline[source=a_b], " and cost $5"))',
    );
  });

  it('reads images with any source, and code fences with a language', () => {
    expect(read('![chart](asset:01m3sabc) ![](https://example.com/a.png)')).toBe(
      'doc(paragraph(image[src=asset:01m3sabc,alt=chart], " ", image[src=https://example.com/a.png]))',
    );
    expect(read('```js title="x"\nlet a;\n```')).toBe('doc(codeBlock[language=js]("let a;"))');
  });

  it('gives every string a valid document', () => {
    for (const source of ['', '\n\n', '>', '-', '- >', '> [!note', '```', '$$', '[', '<', '\\', '1.']) {
      parseTextBlock(source).check();
    }
  });
});

describe('writing lists', () => {
  const item = (text: string) =>
    textSchema.nodes.listItem.create(null, textSchema.nodes.paragraph.create(null, textSchema.text(text)));
  const bullets = (...texts: string[]) => textSchema.nodes.bulletList.create(null, texts.map(item));
  const numbers = (...texts: string[]) => textSchema.nodes.orderedList.create({ start: 1 }, texts.map(item));
  const doc = (...blocks: PMNode[]) => textSchema.nodes.doc.create(null, blocks);

  it('joins two adjacent lists of one kind, because Markdown reads them as one', () => {
    const adjacent = doc(bullets('a'), bullets('b'));
    expect(serializeTextBlock(adjacent)).toBe('- a\n- b');
    expect(parseTextBlock('- a\n\n- b').childCount).toBe(1);
    expect(joinListsDeep(adjacent).childCount).toBe(1);
  });

  it('keeps two adjacent lists of different kinds apart', () => {
    const mixed = doc(bullets('a'), numbers('b'), bullets('c'));
    const markdown = serializeTextBlock(mixed);
    expect(markdown).toBe('- a\n\n1. b\n\n- c');
    expect(parseTextBlock(markdown).eq(mixed)).toBe(true);
  });

  it('joins lists that become adjacent inside an item', () => {
    const nested = doc(
      textSchema.nodes.bulletList.create(null, [
        textSchema.nodes.listItem.create(null, [
          textSchema.nodes.paragraph.create(null, textSchema.text('a')),
          bullets('b'),
          bullets('c'),
        ]),
      ]),
    );
    expect(joinListsDeep(nested).firstChild?.firstChild?.childCount).toBe(2);
    expect(serializeTextBlock(nested)).toBe('- a\n\n  - b\n  - c');
  });
});
