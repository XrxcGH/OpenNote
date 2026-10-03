// @vitest-environment jsdom
import { Extension, getSchema } from '@tiptap/core';
import type { Schema } from '@tiptap/pm/model';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_EDITING_VIEW } from '../host';
import type { EditorHost } from '../host';
import { createMarkdownCache, parseTextBlock, serializeTextBlock } from '../markdown';
import { tableSchema, textSchema } from '../schema/schema';
import { buildKit, createBlockEditor, editorExtensions } from './kit';

const host: EditorHost = {
  settings: () => DEFAULT_EDITING_VIEW,
  flag: () => true,
  announce: () => {},
  openMenu: () => Promise.resolve(null),
  screenReader: () => false,
  spelling: () => null,
  selectBlocks: () => {},
};

/** What makes two schemas the same: each node's and mark's name, content, groups, attributes, and exclusions. */
function outline(schema: Schema) {
  const attrs = (spec: { attrs?: Record<string, { default?: unknown }> }) =>
    Object.entries(spec.attrs ?? {}).map(([name, attr]) => [name, attr.default]);
  return {
    nodes: Object.values(schema.nodes).map(({ name, spec }) => ({
      name,
      content: spec.content ?? '',
      group: spec.group ?? '',
      inline: !!spec.inline,
      atom: !!spec.atom,
      marks: spec.marks,
      attrs: attrs(spec),
    })),
    marks: Object.values(schema.marks).map(({ name, spec }) => ({ name, excludes: spec.excludes, attrs: attrs(spec) })),
  };
}

describe('the editor kit', () => {
  it('builds the text schema', () => {
    expect(outline(getSchema(buildKit({ kind: 'text', block: 'b1', host })))).toEqual(outline(textSchema));
  });

  it('builds the table schema', () => {
    expect(outline(getSchema(buildKit({ kind: 'table', block: 'b1', host })))).toEqual(outline(tableSchema));
  });

  it('adds registered extensions of its kind whose flags are on, in order', () => {
    const stops = [
      editorExtensions.register({ id: 'b', order: 2, kinds: ['text'], create: () => Extension.create({ name: 'b' }) }),
      editorExtensions.register({ id: 'a', order: 1, kinds: ['text'], create: () => Extension.create({ name: 'a' }) }),
      editorExtensions.register({ id: 't', order: 0, kinds: ['table'], create: () => Extension.create({ name: 't' }) }),
    ];
    const names = buildKit({ kind: 'text', block: 'b1', host }).map((extension) => extension.name);
    expect(names.slice(-2)).toEqual(['a', 'b']);
    expect(names).not.toContain('t');
    stops.forEach((stop) => stop());
  });
});

describe('createBlockEditor', () => {
  let root: HTMLElement;
  afterEach(() => root.remove());

  it('mounts in place of the static text and edits the same document', () => {
    root = document.createElement('div');
    root.textContent = 'static';
    document.body.append(root);
    const doc = parseTextBlock('# Title\n\nSome **bold** text');
    const editor = createBlockEditor(root, doc, { kind: 'text', block: 'b1', host });
    expect(root.textContent).not.toContain('static');
    expect(root.querySelector('[contenteditable="true"]')?.getAttribute('data-block')).toBe('b1');
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, '!');
    expect(serializeTextBlock(editor.state.doc, createMarkdownCache())).toBe('# Title\n\nSome **bold** text!');
    editor.destroy();
  });
});
