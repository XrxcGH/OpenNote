import { Schema } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { describe, expect, it } from 'vitest';
import { formulaRefsKey, outlineKey } from './refsPlugin';
import { barTextOnly } from './sync';

const schema = new Schema({ nodes: { doc: { content: 'text*' }, text: {} } });

describe('the active cell while the bar is typed in', () => {
  it('is kept for a key that only tells the table the bar text, and worked out again for anything else', () => {
    const state = EditorState.create({ schema, doc: schema.node('doc', null, [schema.text('A')]) });
    expect(barTextOnly(state.tr.setMeta(formulaRefsKey, { bar: '=SUM(1' }))).toBe(true);
    expect(barTextOnly(state.tr.setMeta(formulaRefsKey, { picked: null }))).toBe(false);
    expect(barTextOnly(state.tr.setMeta(formulaRefsKey, { bar: '=1' }).insertText('B', 1))).toBe(false);
    expect(barTextOnly(state.tr)).toBe(false);
  });
});

describe('the outlines while the bar is typed in', () => {
  it('change only when a key changes the references or their colors', () => {
    expect(outlineKey('=SUM(A1,12')).toBe(outlineKey('=SUM(A1,123'));
    expect(outlineKey('=SUM(A1,B')).not.toBe(outlineKey('=SUM(A1,B2'));
    expect(outlineKey('=A1+B2')).not.toBe(outlineKey('=B2+A1'));
    expect(outlineKey('Pen')).toBe('');
    expect(outlineKey(null)).toBeNull();
  });
});
