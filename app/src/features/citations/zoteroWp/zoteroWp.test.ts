// @vitest-environment jsdom
// Zotero's word-processor integration, tried against a pretend Zotero that makes the calls the real one makes for each
// command, in order, and reads the answers. The page is a real ProseMirror state over the page's text schema.
import { EditorState, TextSelection } from '@tiptap/pm/state';
import type { Transaction } from '@tiptap/pm/state';
import { describe, expect, it } from 'vitest';
import { parseTextBlock } from '../../../editor/markdown';
import { serializeTextBlock } from '../../../editor/markdown/serialize';
import { textSchema } from '../../../editor/schema/schema';
import { decodeCode, encodeCode, hrefFor, listFields } from './fields';
import { richParagraphs } from './html';
import { runZotero } from './run';
import type { Outcome, Transport, ZoteroCall, ZoteroCommand } from './run';
import type { Host } from './bridge';

type Reply = { ok: boolean; value: unknown };
type Ask = (method: string, args: unknown[]) => Promise<Reply>;

/** A pretend Zotero: `script` makes the calls, and each is answered by the bridge through `reply`. */
function pretend(script: (ask: Ask, command: ZoteroCommand) => Promise<boolean>): Transport {
  const waiting = new Map<number, (reply: Reply) => void>();
  let txid = 0;
  let errors = 0;
  return {
    async run(command, onCall: (call: ZoteroCall) => void): Promise<Outcome> {
      const ask: Ask = (method, args) =>
        new Promise((resolve) => {
          txid += 1;
          waiting.set(txid, resolve);
          onCall({ txid, method, args });
        });
      const wrapped: Ask = async (method, args) => {
        const reply = await ask(method, args);
        if (!reply.ok) errors += 1;
        return reply;
      };
      const completed = await script(wrapped, command);
      return { calls: txid, completed, errors };
    },
    async reply(id, ok, value) {
      waiting.get(id)?.({ ok, value });
      waiting.delete(id);
    },
  };
}

function page(
  content: string,
  caret: number,
): { host: Host; state: () => EditorState; prefs: string[]; alerts: string[] } {
  let state = EditorState.create({ schema: textSchema, doc: parseTextBlock(content) });
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, caret)));
  const alerts: string[] = [];
  const prefs: string[] = [''];
  return {
    state: () => state,
    prefs,
    alerts,
    host: {
      state: () => state,
      dispatch: (tr: Transaction) => {
        state = state.apply(tr);
      },
      alert: async (text) => {
        alerts.push(text);
        return 1;
      },
    },
  };
}

const prefsOf = (store: string[]) => ({ get: () => store[0], set: (data: string) => void (store[0] = data) });
const CITE_CODE = 'ITEM CSL_CITATION {"citationID":"abc123","properties":{},"citationItems":[{"id":1}],"schema":"x"}';
const BIBL_CODE = 'BIBL {"uncited":[],"omitted":[],"custom":[]} CSL_BIBLIOGRAPHY';

/** The opening of every command, as Zotero makes it. */
async function open(ask: Ask): Promise<void> {
  expect((await ask('Application_getActiveDocument', [])).value).toMatchObject({
    documentID: 'opennote',
    outputFormat: 'html',
    supportedNotes: [],
  });
  await ask('Document_getDocumentData', [1]);
}

describe('field codes', () => {
  it('survive the address they are kept in, in any language', () => {
    const code = `${CITE_CODE} “Ünïcode — 引用” ~~ ??`;
    expect(decodeCode(encodeCode(code))).toBe(code);
    expect(hrefFor(code)).toMatch(/^zotero:field\/[A-Za-z0-9_-]+$/);
  });

  it('stay on the page when it is saved as Markdown and read back', () => {
    const doc = parseTextBlock(`See [(Smith, 2020)](${hrefFor(CITE_CODE)}) here.`);
    const fields = listFields(doc);
    expect(fields).toHaveLength(1);
    expect(fields[0].code).toBe(CITE_CODE);
    const again = parseTextBlock(serializeTextBlock(doc));
    expect(listFields(again).map((one) => one.code)).toEqual([CITE_CODE]);
  });
});

describe('rich text from Zotero', () => {
  it('keeps italics, drops links, and makes a paragraph of each entry', () => {
    const html =
      '<div class="csl-bib-body"><div class="csl-entry">Smith, J. (2020). <i>Sleep</i>. <a href="https://x.org">https://x.org</a></div>' +
      '<div class="csl-entry">Lee, W. (2019). Other.</div></div>';
    const paragraphs = richParagraphs(html);
    expect(paragraphs.map((one) => one.map((piece) => piece.text).join(''))).toEqual([
      'Smith, J. (2020). Sleep. https://x.org',
      'Lee, W. (2019). Other.',
    ]);
    expect(paragraphs[0].find((piece) => piece.text === 'Sleep')?.formats).toEqual(['italic']);
  });
});

describe('Add or edit citation', () => {
  it('inserts a citation at the caret, with the code Zotero gives it', async () => {
    const one = page('See  for details.', 5);
    const transport = pretend(async (ask) => {
      await open(ask);
      expect((await ask('Document_canInsertField', [1, 'Field'])).value).toBe(true);
      expect((await ask('Document_cursorInField', [1, 'Field'])).value).toBeNull();
      const inserted = (await ask('Document_insertField', [1, 'Field', 0])).value as { id: number; code: string };
      await ask('Field_setCode', [1, inserted.id, CITE_CODE]);
      await ask('Field_setText', [1, inserted.id, '(<i>Smith</i>, 2020)', true]);
      await ask('Document_setDocumentData', [1, '<data><session id="s"/></data>']);
      await ask('Document_complete', [1]);
      return true;
    });
    const result = await runZotero('addEditCitation', one.host, prefsOf(one.prefs), transport);
    expect(result).toEqual({ status: 'done', errors: 0 });
    const doc = one.state().doc;
    expect(doc.textContent).toBe('See (Smith, 2020) for details.');
    const fields = listFields(doc);
    expect(fields.map((field) => field.code)).toEqual([CITE_CODE]);
    expect(doc.textBetween(fields[0].from, fields[0].to)).toBe('(Smith, 2020)');
    expect(doc.rangeHasMark(fields[0].from + 1, fields[0].from + 6, textSchema.marks.italic)).toBe(true);
    expect(one.prefs[0]).toContain('session');
    expect(one.state().selection.from).toBe(fields[0].to);
  });

  it('edits the citation the caret is in, keeping its place', async () => {
    const one = page(`Before [(Old, 2001)](${hrefFor(CITE_CODE)}) after.`, 12);
    const transport = pretend(async (ask) => {
      await open(ask);
      const found = (await ask('Document_cursorInField', [1, 'Field'])).value as { id: number; code: string };
      expect(found.code).toBe(CITE_CODE);
      await ask('Field_setText', [1, found.id, '(New, 2024)', false]);
      await ask('Document_complete', [1]);
      return true;
    });
    await runZotero('addEditCitation', one.host, prefsOf(one.prefs), transport);
    expect(one.state().doc.textContent).toBe('Before (New, 2024) after.');
    expect(listFields(one.state().doc)).toHaveLength(1);
  });

  it('puts nothing in the page when the person cancels Zotero', async () => {
    const one = page('Plain text.', 6);
    const before = one.state().doc;
    const transport = pretend(async (ask) => {
      await open(ask);
      await ask('Document_insertField', [1, 'Field', 0]);
      // Zotero's window is closed: the connection ends without Document_complete.
      return false;
    });
    const result = await runZotero('addEditCitation', one.host, prefsOf(one.prefs), transport);
    expect(result).toEqual({ status: 'cancelled', errors: 0 });
    expect(one.state().doc.eq(before)).toBe(true);
  });
});

describe('Bibliography', () => {
  const entries = (...lines: string[]) =>
    `<div class="csl-bib-body">${lines.map((line) => `<div class="csl-entry">${line}</div>`).join('')}</div>`;

  it('adds a paragraph for each entry, then refreshes them in place', async () => {
    const one = page('Intro.', 7);
    await runZotero(
      'addEditBibliography',
      one.host,
      prefsOf(one.prefs),
      pretend(async (ask) => {
        await open(ask);
        const inserted = (await ask('Document_insertField', [1, 'Field', 0])).value as { id: number; code: string };
        await ask('Field_setCode', [1, inserted.id, BIBL_CODE]);
        await ask('Field_setText', [
          1,
          inserted.id,
          entries('Smith (2020). <i>Sleep</i>.', 'Lee (2019). Other.'),
          true,
        ]);
        await ask('Document_complete', [1]);
        return true;
      }),
    );
    expect(one.state().doc.childCount).toBe(3);
    const fields = listFields(one.state().doc);
    expect(fields).toHaveLength(1);
    expect(fields[0].block).toBe(true);

    await runZotero(
      'refresh',
      one.host,
      prefsOf(one.prefs),
      pretend(async (ask) => {
        await open(ask);
        const list = (await ask('Document_getFields', [1, 'Field'])).value as { id: number; code: string }[];
        const ids = list.map((f) => f.id);
        expect(list.map((f) => f.code)).toEqual([BIBL_CODE]);
        await ask('Field_setText', [
          1,
          ids[0],
          entries('Adams (2000). A.', 'Smith (2020). S.', 'Lee (2019). L.'),
          true,
        ]);
        await ask('Document_complete', [1]);
        return true;
      }),
    );
    const doc = one.state().doc;
    expect(doc.childCount).toBe(4);
    expect(doc.child(0).textContent).toBe('Intro.');
    expect(doc.child(1).textContent).toBe('Adams (2000). A.');
    expect(listFields(doc)).toHaveLength(1);
  });

  it('takes the place of an empty paragraph, and a bibliography added after text goes below it', async () => {
    const one = page('Some text here.', 5);
    await runZotero(
      'addEditBibliography',
      one.host,
      prefsOf(one.prefs),
      pretend(async (ask) => {
        await open(ask);
        const inserted = (await ask('Document_insertField', [1, 'Field', 0])).value as { id: number; code: string };
        await ask('Field_setCode', [1, inserted.id, BIBL_CODE]);
        await ask('Field_setText', [1, inserted.id, entries('A (1). X.', 'B (2). Y.'), true]);
        await ask('Document_complete', [1]);
        return true;
      }),
    );
    const doc = one.state().doc;
    expect(doc.childCount).toBe(3);
    expect(doc.child(0).textContent).toBe('Some text here.');
    expect(doc.child(2).textContent).toBe('B (2). Y.');
  });
});

describe('Unlink and other commands', () => {
  it('Unlink keeps the text and drops the field', async () => {
    const one = page(`A [(Smith, 2020)](${hrefFor(CITE_CODE)}) b`, 3);
    await runZotero(
      'removeCodes',
      one.host,
      prefsOf(one.prefs),
      pretend(async (ask) => {
        await open(ask);
        const ids = ((await ask('Document_getFields', [1, 'Field'])).value as { id: number }[]).map((f) => f.id);
        await ask('Field_removeCode', [1, ids[0]]);
        await ask('Document_complete', [1]);
        return true;
      }),
    );
    expect(one.state().doc.textContent).toBe('A (Smith, 2020) b');
    expect(listFields(one.state().doc)).toHaveLength(0);
  });

  it('answers a call it cannot do with an error, and still finishes', async () => {
    const one = page('x', 1);
    const result = await runZotero(
      'setDocPrefs',
      one.host,
      prefsOf(one.prefs),
      pretend(async (ask) => {
        await open(ask);
        const reply = await ask('Document_exportDocument', [1]);
        expect(reply.ok).toBe(false);
        await ask('Document_complete', [1]);
        return true;
      }),
    );
    expect(result).toEqual({ status: 'done', errors: 1 });
  });

  it('shows Zotero its message and passes back the answer', async () => {
    const one = page('x', 1);
    await runZotero(
      'refresh',
      one.host,
      prefsOf(one.prefs),
      pretend(async (ask) => {
        await open(ask);
        expect((await ask('Document_displayAlert', [1, 'Sure?', 0, 2])).value).toBe(1);
        await ask('Document_complete', [1]);
        return true;
      }),
    );
    expect(one.alerts).toEqual(['Sure?']);
  });
});

describe('When Zotero is not running', () => {
  it('is a status, not an error, and the page is untouched', async () => {
    const one = page('Plain.', 3);
    const before = one.state().doc;
    const transport: Transport = {
      run: () => Promise.reject({ code: 'zoteroMissing', message: 'Zotero is not running.' }),
      reply: () => Promise.resolve(null),
    };
    expect(await runZotero('addEditCitation', one.host, prefsOf(one.prefs), transport)).toEqual({ status: 'missing' });
    expect(one.state().doc.eq(before)).toBe(true);
  });

  it('treats any other failure as a failure', async () => {
    const one = page('Plain.', 3);
    const transport: Transport = {
      run: () => Promise.reject(new Error('boom')),
      reply: () => Promise.resolve(null),
    };
    expect(await runZotero('refresh', one.host, prefsOf(one.prefs), transport)).toEqual({ status: 'failed' });
  });
});
