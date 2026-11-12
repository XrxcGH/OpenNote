// The Home tab's logic (text:home-tab-ui, B10): what the controls read from the selection (mixed states) and what
// each menu item runs. Expected values are the grammar of the text design (DESIGN.md 2.2 and 4.1), not the code's
// own output.
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Command } from '../../../editor/commands/command';
import { setRunValue, toggleRunMark } from '../../../editor/commands/runFormat';
import { setTextSize } from '../../../editor/commands/marks';
import { marked } from '../../../editor/commands/testing';
import { paraAt, setPara } from '../../../editor/commands/paragraph';
import { BULLET_LIBRARY } from '../../../editor/commands/lists';
import { t } from '../../../strings/t';
import {
  borderItems,
  bulletItems,
  caseItems,
  effectItems,
  multilevelItems,
  numberingItems,
  selectItems,
  shadeItems,
  spacingItems,
  strikeItems,
  underlineItems,
} from './menus';
import { run } from './run';
import { colorAt, fontAt, formatKey, lastColor, pressedAt, rememberColor, sizeAt } from './state';

vi.mock('./run', () => ({ run: vi.fn() }));

/** A state with the selection over the whole text, after `edit` ran on its first `count` characters. */
function stateWith(source: string, edit: (state: EditorState) => EditorState): EditorState {
  const start = edit(marked(source).state);
  const end = start.doc.content.size - 1;
  return start.apply(start.tr.setSelection(TextSelection.between(start.doc.resolve(1), start.doc.resolve(end))));
}

/** Runs a command on the first characters of a paragraph. */
const onFirst =
  (count: number, command: Command) =>
  (state: EditorState): EditorState => {
    const part = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, 1 + count)));
    let after = part;
    command(part, (tr) => (after = part.apply(tr)));
    return after;
  };

describe('what the controls read from the selection', () => {
  it('Bold on half the selection is mixed, and on all of it is pressed', () => {
    const half = stateWith('abcd', onFirst(2, toggleRunMark('bold')));
    expect(pressedAt(half, 'bold')).toBe('mixed');
    const all = stateWith('abcd', onFirst(4, toggleRunMark('bold')));
    expect(pressedAt(all, 'bold')).toBe(true);
    expect(
      pressedAt(
        stateWith('abcd', (s) => s),
        'bold',
      ),
    ).toBe(false);
  });

  it('the font box is blank for two fonts and shows the font for one', () => {
    const mixed = stateWith('abcd', onFirst(2, setRunValue('font', 'Georgia')));
    expect(fontAt(mixed)).toEqual({ value: null, mixed: true });
    const same = stateWith('abcd', onFirst(4, setRunValue('font', 'Georgia')));
    expect(fontAt(same)).toEqual({ value: 'Georgia', mixed: false });
    expect(fontAt(stateWith('abcd', (s) => s))).toEqual({ value: null, mixed: false });
  });

  it('the size box is blank for two sizes, and the body size is 12 points when none is set', () => {
    const mixed = stateWith('abcd', onFirst(2, setTextSize('18')));
    expect(sizeAt(mixed)).toEqual({ points: null, mixed: true });
    const same = stateWith('abcd', onFirst(4, setTextSize('18')));
    expect(sizeAt(same)).toEqual({ points: 18, mixed: false });
    expect(sizeAt(stateWith('abcd', (s) => s))).toEqual({ points: 12, mixed: false });
  });

  it('a caret reads the marks it will type with', () => {
    const { state } = marked('**ab**[]');
    expect(pressedAt(state, 'bold')).toBe(true);
    expect(colorAt(state, 'textColor')).toBeNull();
  });
});

type Menu = readonly { id: string; onSelect?: () => void }[];
const rows: readonly (readonly [string, () => Menu, string, string, unknown])[] = [
  ['underline double', underlineItems, 'underline.double', 'format.underlineStyle', { value: 'double' }],
  ['underline wave', underlineItems, 'underline.wave', 'format.underlineStyle', { value: 'wave' }],
  ['underline none', underlineItems, 'underline.none', 'format.underlineStyle', { value: null }],
  ['strike single', strikeItems, 'strike.single', 'format.strike', {}],
  ['strike double', strikeItems, 'strike.double', 'format.strikeDouble', {}],
  ['effect shadow', effectItems, 'effect.shadow', 'format.effect', { value: 'shadow' }],
  ['effect small caps', effectItems, 'effect.smallCaps', 'format.smallCaps', {}],
  ['effect none', effectItems, 'effect.none', 'format.effect', { value: null }],
  ['case upper', caseItems, 'case.upper', 'format.changeCase', { value: 'upper' }],
  ['case title', caseItems, 'case.title', 'format.changeCase', { value: 'title' }],
  ['bullet diamond', bulletItems, `bullet.${BULLET_LIBRARY[3]}`, 'list.bullet', { value: BULLET_LIBRARY[3] }],
  ['number upper roman', numberingItems, 'number.upperRoman', 'list.numberLook', { value: 'upperRoman' }],
  ['multilevel legal', multilevelItems, 'multilevel.legal', 'list.multilevel', { value: 'legal' }],
  ['spacing 1.5', spacingItems, 'spacing.r15', 'para.lineSpacing', { value: 1.5 }],
  ['spacing 2.0', spacingItems, 'spacing.double', 'para.lineSpacing', { value: 2 }],
  ['space before 12', spacingItems, 'spacing.addBefore', 'para.set', { key: 'before', attrs: { value: 12 } }],
  ['space before 0', spacingItems, 'spacing.removeBefore', 'para.set', { key: 'before', attrs: { value: null } }],
  ['space after 8', spacingItems, 'spacing.addAfter', 'para.set', { key: 'after', attrs: { value: 8 } }],
  ['shade none', () => shadeItems('light'), 'shade.none', 'para.set', { key: 'shade', attrs: { value: null } }],
  [
    'border bottom',
    borderItems,
    'border.bottom',
    'para.set',
    { key: 'border', attrs: { value: { bottom: { style: 'single', width: 0.5, space: 1, color: null } } } },
  ],
  ['border none', borderItems, 'border.none', 'para.set', { key: 'border', attrs: { value: null } }],
  [
    'border left',
    borderItems,
    'border.start',
    'para.set',
    { key: 'border', attrs: { value: { start: { style: 'single', width: 0.5, space: 1, color: null } } } },
  ],
  [
    'border right',
    borderItems,
    'border.end',
    'para.set',
    { key: 'border', attrs: { value: { end: { style: 'single', width: 0.5, space: 1, color: null } } } },
  ],
  [
    'border inside',
    borderItems,
    'border.inside',
    'para.set',
    { key: 'border', attrs: { value: { between: { style: 'single', width: 0.5, space: 1, color: null } } } },
  ],
  [
    'border outside',
    borderItems,
    'border.box',
    'para.set',
    {
      key: 'border',
      attrs: {
        value: {
          top: { style: 'single', width: 0.5, space: 1, color: null },
          bottom: { style: 'single', width: 0.5, space: 1, color: null },
          start: { style: 'single', width: 0.5, space: 1, color: null },
          end: { style: 'single', width: 0.5, space: 1, color: null },
        },
      },
    },
  ],
  [
    'border all',
    borderItems,
    'border.all',
    'para.set',
    {
      key: 'border',
      attrs: {
        value: {
          top: { style: 'single', width: 0.5, space: 1, color: null },
          bottom: { style: 'single', width: 0.5, space: 1, color: null },
          start: { style: 'single', width: 0.5, space: 1, color: null },
          end: { style: 'single', width: 0.5, space: 1, color: null },
          between: { style: 'single', width: 0.5, space: 1, color: null },
        },
      },
    },
  ],
  ['underline thick wave', underlineItems, 'underline.wavyHeavy', 'format.underlineStyle', { value: 'wavyHeavy' }],
  ['select similar', selectItems, 'select.similar', 'format.selectSimilar', {}],
];

describe('each menu item runs its command with the choice as the argument', () => {
  beforeEach(() => vi.mocked(run).mockClear());

  const pick = (items: readonly { id: string; onSelect?: () => void }[], id: string) =>
    items.find((item) => item.id === id)?.onSelect?.();

  for (const [name, items, id, command, args] of rows) {
    it(`${name}`, () => {
      pick(items(), id);
      expect(run).toHaveBeenCalledWith(command, args);
    });
  }

  it('the case menu offers the five modes of the design, the numbering menu the seven looks, and the bullets seven symbols', () => {
    expect(caseItems()).toHaveLength(5);
    expect(numberingItems().filter((item) => item.id.startsWith('number.'))).toHaveLength(7);
    expect(bulletItems()).toHaveLength(7);
  });

  it('every label is a sentence of the strings file', () => {
    const all = [
      ...underlineItems(),
      ...effectItems(),
      ...caseItems(),
      ...spacingItems(),
      ...borderItems(),
      ...selectItems(),
    ];
    for (const item of all) expect(item.label).not.toMatch(/^textHome\./);
    expect(t('textHome.sheet.open')).toBe('Aa');
  });
});

const pick = (items: readonly { id: string; onSelect?: () => void }[], id: string) =>
  items.find((item) => item.id === id)?.onSelect?.();

describe('the menus offer the choices of the design', () => {
  beforeEach(() => vi.mocked(run).mockClear());

  it('the underline menu offers all 17 styles of the design and an Underline color submenu', () => {
    const items = underlineItems();
    expect(
      items.filter(
        (item) => item.id.startsWith('underline.') && !['underline.none', 'underline.color'].includes(item.id),
      ),
    ).toHaveLength(17);
    const color = items.find((item) => item.id === 'underline.color');
    expect(color?.submenu?.length).toBe(7);
    vi.mocked(run).mockClear();
    color?.submenu?.find((item) => item.id === 'underlineColor.accent2')?.onSelect?.();
    expect(run).toHaveBeenCalledWith('format.underlineColor', { value: 'theme:accent2' });
    vi.mocked(run).mockClear();
    color?.submenu?.find((item) => item.id === 'underlineColor.auto')?.onSelect?.();
    expect(run).toHaveBeenCalledWith('format.underlineColor', { value: null });
  });

  it('the borders menu offers eight presets', () => {
    expect(borderItems()).toHaveLength(8);
  });
});

describe('the space menu on a real paragraph', () => {
  const apply = (state: EditorState, id: string) => {
    vi.mocked(run).mockClear();
    pick(spacingItems(), id);
    const [, args] = vi.mocked(run).mock.calls[0];
    const { key, attrs } = args as { key: 'before'; attrs: { value: unknown } };
    let next = state;
    setPara(key, attrs.value)(state, (tr) => (next = state.apply(tr)));
    return next;
  };

  it('Remove space before leaves none, and Add gives 12 points, whatever the paragraph had', () => {
    const plain = marked('abcd').state;
    expect(paraAt(apply(plain, 'spacing.removeBefore')).before ?? null).toBeNull();
    const open = apply(plain, 'spacing.addBefore');
    expect(paraAt(open).before).toBe(12);
    expect(paraAt(apply(open, 'spacing.addBefore')).before).toBe(12);
    expect(paraAt(apply(open, 'spacing.removeBefore')).before ?? null).toBeNull();
  });
});

describe('the bar re-read key', () => {
  it('does not change when text is typed in the same format, and changes with a mark or a paragraph key', () => {
    const plain = marked('abcd').state;
    const typed = plain.apply(plain.tr.insertText('e', 5));
    expect(formatKey(typed)).toBe(formatKey(plain));
    const bold = stateWith('abcd', onFirst(4, toggleRunMark('bold')));
    expect(formatKey(bold)).not.toBe(formatKey(stateWith('abcd', (s) => s)));
    let centered = plain;
    setPara('align', 'center')(plain, (tr) => (centered = plain.apply(tr)));
    expect(formatKey(centered)).not.toBe(formatKey(plain));
  });

  it('shading stores the palette name, not a theme-dependent hex', () => {
    const honey = shadeItems('dark').find((item) => item.id === 'shade.honey');
    vi.mocked(run).mockClear();
    honey?.onSelect?.();
    expect(run).toHaveBeenCalledWith('para.set', { key: 'shade', attrs: { value: { fill: 'honey' } } });
  });
});

describe('the last color picked', () => {
  it('a main button applies the last color chosen, and None does not replace it', () => {
    expect(lastColor('highlight')).toBe('honey');
    rememberColor('highlight', 'mint');
    expect(lastColor('highlight')).toBe('mint');
    rememberColor('highlight', 'none');
    expect(lastColor('highlight')).toBe('mint');
    rememberColor('textColor', 'theme:accent2');
    expect(lastColor('textColor')).toBe('theme:accent2');
  });
});
