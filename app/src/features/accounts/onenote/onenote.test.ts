// OneNote through a mock Microsoft Graph: OneNote's HTML as blocks, notebooks with section groups and pages across result
// pages, pictures fetched onto pages, the Import report, a second import that adds only what is new, and switching from
// one Microsoft account to another without mixing their notebooks.
import { describe, expect, it } from 'vitest';
import { addOneNote } from '../../../../../tests/mock-servers/onenote';
import type { MockOneNotebook } from '../../../../../tests/mock-servers/onenote';
import { MockServer } from '../../../../../tests/mock-servers/server';
import { createMemoryNotesService } from '../../../services/notes/memory';
import { createMemoryPageService } from '../../../services/pages/memory';
import { createFakeConnectors } from '../../connectors';
import { createFakeAccountsHost } from '../fakeHost';
import { isGraphResource, listNotebooks, listSections } from './graph';
import { convertPage } from './html';
import { importNotebooks, stateName } from './import';

const PAGE = `<html><head><title>Cell notes</title><meta name="created" content="2026-10-01"/></head>
<body data-absolute-enabled="true" style="font-family:Calibri;font-size:11pt">
<div id="div:{1}{1}" style="position:absolute;left:48px;top:120px;width:624px">
<h1 id="h:{1}">Mitosis</h1>
<p id="p:{2}" style="margin-top:0pt">The <span style="font-weight:bold">nucleus</span> divides &amp; <span style="font-style:italic">the cell</span> splits. See <a href="https://example.com/a(b)">the lecture</a>.</p>
<p data-tag="to-do">Read chapter 4</p>
<p data-tag="to-do:completed">Draw the phases</p>
<ul><li>Prophase<ul><li>Chromosomes condense</li></ul></li><li>Metaphase</li></ul>
<ol><li>First</li><li>Second</li></ol>
<table><tr><td>Phase</td><td>Time</td></tr><tr><td>Prophase</td><td>30 | 60 min</td></tr></table>
<img src="https://graph.microsoft.com/v1.0/me/onenote/resources/small/$value" data-fullres-src="https://graph.microsoft.com/v1.0/me/onenote/resources/big/$value" alt="A cell" width="300"/>
<p><object data-attachment="slides.pdf" data="https://graph.microsoft.com/v1.0/me/onenote/resources/pdf/$value" type="application/pdf"></object></p>
<p><span style="text-decoration:line-through">Old idea</span> <span style="font-family:Consolas">x = 1</span></p>
</div></body></html>`;

describe('OneNote HTML', () => {
  it('becomes headings, marks, links, to-dos, lists, a table, a picture, and an attachment note', () => {
    const page = convertPage(PAGE);
    expect(page.title).toBe('Cell notes');
    const texts = page.blocks
      .filter((one) => one.kind === 'text')
      .map((one) => (one.kind === 'text' ? one.markdown : ''));
    expect(texts[0]).toBe('# Mitosis');
    expect(texts[1]).toBe(
      'The **nucleus** divides & _the cell_ splits. See [the lecture](https://example.com/a(b%29).',
    );
    expect(texts[2]).toBe('- [ ] Read chapter 4');
    expect(texts[3]).toBe('- [x] Draw the phases');
    expect(texts[4]).toBe('- Prophase\n  - Chromosomes condense\n- Metaphase');
    expect(texts[5]).toBe('1. First\n2. Second');
    expect(texts[6]).toBe('| Phase | Time |\n| --- | --- |\n| Prophase | 30 \\| 60 min |');
    expect(texts.at(-1)).toBe('~~Old idea~~ `x = 1`');
    const image = page.blocks.find((one) => one.kind === 'image');
    expect(image).toEqual({
      kind: 'image',
      src: 'https://graph.microsoft.com/v1.0/me/onenote/resources/big/$value',
      alt: 'A cell',
      width: 300,
    });
    expect(page.losses.tables).toBe(1);
    expect(page.losses.attachments).toEqual(['slides.pdf']);
  });

  it('survives stray and unclosed tags, and takes only addresses on Graph for pictures', () => {
    const page = convertPage('<body><div><p>One<p>Two</div></body></div></p>');
    expect(page.blocks).toEqual([
      { kind: 'text', markdown: 'One' },
      { kind: 'text', markdown: 'Two' },
    ]);
    expect(isGraphResource('https://graph.microsoft.com/v1.0/me/onenote/resources/a/$value')).toBe(true);
    expect(isGraphResource('https://evil.example/x.png')).toBe(false);
    expect(isGraphResource('http://graph.microsoft.com/x')).toBe(false);
    expect(isGraphResource('https://graph.microsoft.com.evil.example/x')).toBe(false);
  });
});

const page = (id: string, title: string, modified = '2026-10-01T10:00:00Z', level = 0, html = PAGE) => ({
  id,
  title,
  modified,
  level,
  html,
});

function notebooks(): MockOneNotebook[] {
  return [
    {
      id: 'nb1',
      name: 'Biology',
      sections: [
        {
          id: 's1',
          name: 'Cells',
          pages: [page('p1', 'Mitosis'), page('p2', 'Meiosis', undefined, 1), page('p3', 'Osmosis')],
        },
      ],
      groups: [
        {
          id: 'g1',
          name: 'Labs',
          sections: [
            {
              id: 's2',
              name: 'Week 1',
              pages: [page('p4', 'Microscope', undefined, 0, '<body><p>Focus first.</p></body>')],
            },
          ],
        },
      ],
    },
  ];
}

function storage() {
  const notes = createMemoryNotesService({ seed: 'empty' });
  const pages = createMemoryPageService([], {
    missing: (id) => ({ id, title: '', created: '', modified: '', tags: [], view: {}, blocks: [], assets: {} }),
  });
  return { notes, pages };
}

function rig(account: string, server: MockServer) {
  const connectors = createFakeConnectors({ connected: { microsoft: account }, respond: server.respond });
  return { client: connectors.client, host: createFakeAccountsHost(() => connectors.client) };
}

const pictures = { big: { type: 'image/png', body: 'PICTURE-BYTES' } };

describe('Graph lists', () => {
  it('follows result pages and finds the sections inside section groups', async () => {
    const server = new MockServer();
    addOneNote(server, notebooks(), pictures, { pageSize: 1 });
    const { client } = rig('alice@example.com', server);
    expect((await listNotebooks(client)).map((one) => one.name)).toEqual(['Biology']);
    expect((await listSections(client, 'nb1')).map((one) => one.name)).toEqual(['Cells', 'Labs - Week 1']);
  });
});

describe('importing notebooks', () => {
  it('brings in sections, pages, levels, pictures, and an Import report', async () => {
    const server = new MockServer();
    addOneNote(server, notebooks(), pictures);
    const { client, host } = rig('alice@example.com', server);
    const { notes, pages } = storage();
    const [report] = await importNotebooks({ client, host, notes, pages, account: 'alice@example.com' }, [
      { id: 'nb1', name: 'Biology' },
    ]);
    expect(report).toMatchObject({ sections: 2, pages: 4, kept: 0, tables: ['Mitosis', 'Meiosis', 'Osmosis'] });
    expect(report?.attachments).toHaveLength(3);
    expect(report?.pictures.fetched).toBe(3);

    const books = await notes.listNotebooks();
    expect(books.map((one) => one.title)).toEqual(['Biology']);
    const sections = await notes.listChildren(books[0]?.id as never);
    expect(sections.map((one) => one.title).sort()).toEqual(['Cells', 'Import report', 'Labs - Week 1']);
    const cells = sections.find((one) => one.title === 'Cells');
    const children = await notes.listChildren(cells?.id as never);
    expect(children.map((one) => [one.title, one.pageLevel])).toEqual([
      ['Mitosis', 0],
      ['Meiosis', 1],
      ['Osmosis', 0],
    ]);
    const open = await pages.open(children[0]?.id as string, { viewport: null });
    const types = open.initial.blocks.map((block) => block.type);
    expect(types).toContain('image');
    expect(open.initial.blocks[0]?.data).toEqual({ markdown: '# Mitosis' });
    await open.close();
    const reportSection = sections.find((one) => one.title === 'Import report');
    const reportPage = (await notes.listChildren(reportSection?.id as never))[0];
    const reportOpen = await pages.open(reportPage?.id as string, { viewport: null });
    const reportText = JSON.stringify(reportOpen.initial.blocks);
    expect(reportText).toContain('slides.pdf');
    expect(reportText).toContain('Ink and handwriting');
    await reportOpen.close();
  });

  it('adds only new pages the second time and leaves changed pages alone', async () => {
    const server = new MockServer();
    const book = notebooks();
    addOneNote(server, book, pictures);
    const { client, host } = rig('alice@example.com', server);
    const { notes, pages } = storage();
    const deps = { client, host, notes, pages, account: 'alice@example.com' };
    await importNotebooks(deps, [{ id: 'nb1', name: 'Biology' }]);

    // OneNote gets a new page, and an old one changes.
    const section = book[0]?.sections[0];
    section?.pages.push(page('p5', 'Cytokinesis'));
    const changed = section?.pages[0];
    if (changed) changed.modified = '2026-10-05T10:00:00Z';
    const [report] = await importNotebooks(deps, [{ id: 'nb1', name: 'Biology' }]);
    expect(report).toMatchObject({ pages: 1, kept: 4, changedInOneNote: ['Mitosis'] });
    expect((await notes.listNotebooks()).map((one) => one.title)).toEqual(['Biology']);
  });

  it('keeps one account’s notebooks apart from another’s when the account is switched', async () => {
    const { notes, pages } = storage();
    const server = new MockServer();
    addOneNote(server, notebooks(), pictures);
    const alice = rig('alice@example.com', server);
    await importNotebooks({ ...alice, notes, pages, account: 'alice@example.com' }, [{ id: 'nb1', name: 'Biology' }]);

    // Bob signs in. His notebook has the same name and a page of his own.
    const bobBook: MockOneNotebook[] = [
      {
        id: 'nbB',
        name: 'Biology',
        sections: [
          { id: 'sB', name: 'Notes', pages: [page('pB', 'Bob’s page', undefined, 0, '<body><p>Mine.</p></body>')] },
        ],
      },
    ];
    const bobServer = new MockServer();
    addOneNote(bobServer, bobBook, pictures);
    const bob = rig('bob@example.com', bobServer);
    await importNotebooks({ ...bob, notes, pages, account: 'bob@example.com' }, [{ id: 'nbB', name: 'Biology' }]);

    const books = await notes.listNotebooks();
    expect(books.map((one) => one.title).sort()).toEqual(['Biology', 'Biology (bob@example.com)']);
    // Alice's notebook gained nothing from Bob.
    const aliceBook = books.find((one) => one.title === 'Biology');
    const aliceSections = await notes.listChildren(aliceBook?.id as never);
    expect(aliceSections.map((one) => one.title)).not.toContain('Notes');
    expect(stateName('Alice@Example.com')).toBe('onenote.alice-example-com');
    expect(stateName('Alice@Example.com')).not.toBe(stateName('bob@example.com'));
    expect(alice.host.state.has(stateName('alice@example.com'))).toBe(true);
    expect(alice.host.state.has(stateName('bob@example.com'))).toBe(false);
  });
});
