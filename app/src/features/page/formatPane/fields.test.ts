// @vitest-environment jsdom
// The Format pane's fields (text DESIGN.md 5.3): a typed value with a unit is converted and applied through the
// commands, a bad value gives its message and changes nothing, and each field reads back what it set. Expected values
// come from the design and from the grammar of the spec (ranges, units), not from the code's own output.

// checks-disable-file brand-consistency: the colors typed here are inputs to the fields under test
import { afterEach, describe, expect, it } from 'vitest';
import type { Command } from '../../../editor/commands/command';
import { listLevelAt, setListLevel } from '../../../editor/commands/lists';
import { mountEditor } from '../../../editor/commands/testing';
import type { TestEditor } from '../../../editor/commands/testing';
import { paraFormat } from '../../../editor/paragraph/attributes';
import { t } from '../../../strings/t';
import type { MessageKey } from '../../../strings/t';
import {
  applyBorderPreset,
  borderAt,
  clearAllTabStops,
  clearTabStop,
  setBorderSide,
  setShade,
  setTabStop,
  shadeAt,
  tabsAt,
} from './blocks';
import { FIELDS, fieldById } from './fields';

let mounted: TestEditor | null = null;
afterEach(() => {
  mounted?.destroy();
  mounted = null;
});

/** Types a value into a field as the pane does: parse, then apply. Returns the refusal message or null. */
function type(id: string, input: string | boolean): string | null {
  const field = fieldById(id)!;
  const { editor } = mounted!;
  const parsed = field.parse(input, editor.state);
  if (!parsed.ok) return parsed.message;
  field.apply(parsed.value)(editor.state, editor.view.dispatch);
  return null;
}

const shown = (id: string) => fieldById(id)!.read(mounted!.editor.state);
const para = () => paraFormat(mounted!.editor.state.doc.firstChild!.attrs);
const open = (source: string) => (mounted = mountEditor(source));
const run = (command: Command) => command(mounted!.editor.state, mounted!.editor.view.dispatch);
const range = (min: string, max: string) => t('textPane.range', { min, max });

describe('the Text tab', () => {
  it('applies 10.5 in Size as data-size 10.5', () => {
    open('one [two] three');
    expect(type('size', '10.5')).toBeNull();
    expect(mounted!.markdown()).toBe('one <span data-size="10.5">two</span> three');
    expect(shown('size')).toBe('10.5');
  });

  it('converts a size typed in another unit to half points', () => {
    open('one [two] three');
    type('size', '1in');
    expect(shown('size')).toBe('72');
    type('size', '16px');
    expect(shown('size')).toBe('12');
  });

  it('refuses a size outside 1 to 1638 with the range message and changes nothing', () => {
    open('one [two] three');
    const before = mounted!.markdown();
    expect(type('size', '0')).toBe(t('textFonts.sizeRange'));
    expect(type('size', '1639')).toBe(t('textFonts.sizeRange'));
    expect(type('size', 'big')).toBe(t('textFonts.sizeInvalid'));
    expect(mounted!.markdown()).toBe(before);
  });

  it('sets a font, refuses a bad name, and a blank box takes the font off', () => {
    open('one [two] three');
    expect(type('font', 'Georgia')).toBeNull();
    expect(shown('font')).toBe('Georgia');
    expect(type('font', 'bad;name')).toBe(t('textFonts.invalidName'));
    expect(shown('font')).toBe('Georgia');
    type('font', '');
    expect(shown('font')).toBe('');
  });

  it('sets the weight, and 700 is bold', () => {
    open('one [two] three');
    type('weight', '600');
    expect(shown('weight')).toBe('600');
    type('weight', '700');
    expect(mounted!.markdown()).toBe('one **two** three');
    type('weight', '400');
    expect(mounted!.markdown()).toBe('one two three');
  });
});

describe('the Text tab, underline and color', () => {
  it('keeps the underline color when the style changes, and the style when the color changes', () => {
    open('one [two] three');
    type('underline', 'wave');
    type('underlineColor', 'brick');
    expect(shown('underline')).toBe('wave');
    expect(shown('underlineColor')).toBe('brick');
    type('underline', 'dotted');
    expect(shown('underlineColor')).toBe('brick');
    type('underlineColor', '#336699');
    expect(shown('underline')).toBe('dotted');
    type('underline', '');
    expect(shown('underline')).toBe('');
  });

  it('refuses a color that is not one', () => {
    open('one [two] three');
    expect(type('color', 'not a color')).toBe(t('textPane.badColor'));
    expect(type('color', '#aa3355')).toBeNull();
    expect(shown('color')).toBe('#aa3355');
  });
});

describe('the Text tab, effects', () => {
  it('toggles an effect without losing the others, and emboss and engrave exclude each other', () => {
    open('one [two] three');
    type('shadow', true);
    type('outline', true);
    expect(shown('shadow')).toBe(true);
    expect(shown('outline')).toBe(true);
    type('emboss', true);
    type('engrave', true);
    expect(shown('emboss')).toBe(false);
    expect(shown('engrave')).toBe(true);
    type('shadow', false);
    expect(shown('shadow')).toBe(false);
    expect(shown('outline')).toBe(true);
  });

  it('sets capitals, strikethrough, sub and superscript', () => {
    open('one [two] three');
    type('caps', 'small');
    expect(shown('caps')).toBe('small');
    type('strike', 'double');
    expect(shown('strike')).toBe('double');
    type('subscript', true);
    type('superscript', true);
    expect(shown('superscript')).toBe(true);
    expect(shown('subscript')).toBe(false);
  });

  it('reads Mixed when only part of the selection has a mark', () => {
    open('[one **two** three]');
    expect(shown('weight')).toBe('400');
    expect(fieldById('italic')!.read(mounted!.editor.state)).toBe(false);
    open('[one] two');
    type('italic', true);
    expect(shown('italic')).toBe(true);
  });
});

describe('the Advanced tab', () => {
  it('applies scale in percent and 100 is no mark', () => {
    open('one [two] three');
    expect(type('scale', '150%')).toBeNull();
    expect(shown('scale')).toBe('150');
    type('scale', '100');
    expect(shown('scale')).toBe('');
    expect(type('scale', '601')).toBe(range('1', '600'));
    expect(type('scale', '0')).toBe(range('1', '600'));
  });

  it('converts spacing and position to points and refuses values past the range', () => {
    open('one [two] three');
    type('tracking', '0.5pt');
    expect(shown('tracking')).toBe('0.5');
    type('shift', '2');
    expect(shown('shift')).toBe('2');
    expect(type('shift', '2000')).toBe(range('-1584', '1584'));
    type('tracking', '0');
    expect(shown('tracking')).toBe('');
  });

  it('keeps one OpenType token per group, in code point order', () => {
    open('one [two] three');
    type('numberForms', 'onum');
    type('ligatures', 'dlig');
    type('numberForms', 'lnum');
    expect(mounted!.markdown()).toContain('data-otf="dlig lnum"');
    type('stylisticSet', 'ss03');
    expect(mounted!.markdown()).toContain('data-otf="dlig lnum ss03"');
    type('ligatures', '');
    expect(shown('ligatures')).toBe('');
    expect(shown('numberForms')).toBe('lnum');
  });

  it('sets kerning at a size, and 0 turns it off', () => {
    open('one [two] three');
    type('kern', '12');
    expect(shown('kern')).toBe('12');
    type('kern', '0');
    expect(shown('kern')).toBe('0');
  });
});

describe('the Paragraph tab', () => {
  it('applies 0.5in in Left indent as start 36', () => {
    open('one [two] three');
    expect(type('indentStart', '0.5in')).toBeNull();
    expect(para().indent?.start).toBe(36);
    expect(shown('indentStart')).toBe('36');
  });

  it('refuses an indent past 1584 points and changes nothing', () => {
    open('one [two] three');
    expect(type('indentStart', '5000')).toBe(range('-1584', '1584'));
    expect(para().indent).toBeUndefined();
    expect(type('indentStart', 'wide')).toContain('Enter a value');
  });

  it('sets a hanging indent as a negative first line, and takes the key off at zero', () => {
    open('one [two] three');
    type('indentStart', '1in');
    type('special', 'hanging');
    expect(para().indent).toEqual({ start: 72, end: 0, first: -36 });
    type('specialBy', '0.25in');
    expect(para().indent?.first).toBe(-18);
    type('special', '');
    expect(para().indent).toEqual({ start: 72, end: 0, first: 0 });
    type('indentStart', '0');
    expect(para().indent).toBeUndefined();
  });

  it('sets spacing in points with units, and auto', () => {
    open('one [two] three');
    type('before', '6pt');
    type('after', '0.25in');
    expect(para().before).toBe(6);
    expect(para().after).toBe(18);
    type('after', 'auto');
    expect(para().after).toBe('auto');
    expect(type('before', '2000')).toBe(range('0', '1584'));
  });

  it('sets the line spacing rule and value, with the right range for each rule', () => {
    open('one [two] three');
    type('lineRule', 'exact');
    expect(para().line).toEqual({ rule: 'exact', value: 12 });
    type('lineValue', '14pt');
    expect(para().line).toEqual({ rule: 'exact', value: 14 });
    expect(type('lineValue', '0.1')).toBe(range('0.7', '1584'));
    type('lineRule', 'multiple');
    expect(para().line).toBeUndefined();
    type('lineValue', '1.5');
    expect(para().line).toEqual({ rule: 'multiple', value: 1.5 });
    expect(type('lineValue', '200')).toBe(range('0.06', '132'));
  });
});

describe('the Paragraph tab, switches', () => {
  it('sets alignment, the outline level, direction, and the pagination switches', () => {
    open('one [two] three');
    type('align', 'justify');
    type('outlineLevel', '3');
    type('dir', 'rtl');
    type('keepNext', true);
    type('widows', true);
    expect(para()).toMatchObject({ align: 'justify', outline: 3, dir: 'rtl', keepNext: true, widows: true });
    type('keepNext', false);
    expect(para().keepNext).toBeUndefined();
  });
});

describe('every field', () => {
  it('has a label string and a distinct id', () => {
    const ids = FIELDS.map((field) => field.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(t(`textPane.field.${id}` as MessageKey)).not.toContain('textPane.');
  });
});

describe('tab stops', () => {
  it('sets, replaces, and clears stops in position order', () => {
    open('one [two] three');
    run(setTabStop({ pos: 144, align: 'end', leader: 'dot' }));
    run(setTabStop({ pos: 72, align: 'center', leader: 'none' }));
    expect(tabsAt(mounted!.editor.state)).toEqual([
      { pos: 72, align: 'center', leader: 'none' },
      { pos: 144, align: 'end', leader: 'dot' },
    ]);
    run(setTabStop({ pos: 72, align: 'decimal', leader: 'none' }));
    expect(tabsAt(mounted!.editor.state)[0].align).toBe('decimal');
    run(clearTabStop(72));
    expect(tabsAt(mounted!.editor.state)).toHaveLength(1);
    run(clearAllTabStops());
    expect(tabsAt(mounted!.editor.state)).toEqual([]);
  });

  it('refuses the 65th stop', () => {
    open('one [two] three');
    for (let i = 0; i < 64; i += 1) run(setTabStop({ pos: (i + 1) * 10, align: 'start', leader: 'none' }));
    expect(tabsAt(mounted!.editor.state)).toHaveLength(64);
    expect(run(setTabStop({ pos: 1000, align: 'start', leader: 'none' }))).toBe(false);
  });
});

describe('borders and shading', () => {
  it('sets one side, a box preset, and clears them', () => {
    open('one [two] three');
    run(setBorderSide('top', { style: 'double', width: 1, space: 2, color: null }));
    expect(borderAt(mounted!.editor.state).top).toMatchObject({ style: 'double', width: 1, space: 2 });
    run(applyBorderPreset('box', { style: 'single', width: 0.5, space: 1, color: 'brick' }));
    expect(Object.keys(borderAt(mounted!.editor.state)).sort()).toEqual(['bottom', 'end', 'start', 'top']);
    run(setBorderSide('top', null));
    expect(borderAt(mounted!.editor.state).top).toBeUndefined();
    run(applyBorderPreset('none'));
    expect(borderAt(mounted!.editor.state)).toEqual({});
  });

  it('sets and removes shading', () => {
    open('one [two] three');
    run(setShade({ fill: '#ffeecc', pattern: 'solid', color: null }));
    expect(shadeAt(mounted!.editor.state)).toMatchObject({ fill: '#ffeecc', pattern: 'solid' });
    run(setShade({ fill: null, pattern: 'clear', color: null }));
    expect(shadeAt(mounted!.editor.state)).toBeNull();
  });
});

describe('lists', () => {
  it('reads the level and changes its indent, hanging, and symbol as a new definition', () => {
    open('- [one]');
    expect(listLevelAt(mounted!.editor.state)?.level.format).toBe('bullet');
    expect(run(setListLevel({ indent: 72, hanging: 24 }))).toBe(true);
    expect(listLevelAt(mounted!.editor.state)?.level).toMatchObject({ indent: 72, hanging: 24 });
    expect(run(setListLevel({ symbol: '✓' }))).toBe(true);
    expect(listLevelAt(mounted!.editor.state)?.level.symbol).toBe('✓');
    expect(run(setListLevel({ symbol: 'ab' }))).toBe(false);
    expect(run(setListLevel({ indent: 5000 }))).toBe(false);
  });

  it('is null outside a list', () => {
    open('one [two]');
    expect(listLevelAt(mounted!.editor.state)).toBeNull();
  });
});

describe('values the command refuses are refused by the field with a message', () => {
  it('kerning is 0 or 1 to 1638 points', () => {
    open('one [two]');
    expect(type('kern', '0.5')).toBe(t('textPane.kernRange'));
    expect(type('kern', '0')).toBeNull();
    expect(type('kern', '12')).toBeNull();
    expect(type('kern', '2000')).toBe(range('0', '1638'));
  });

  it('highlight takes honey, the highlighter color with no name', () => {
    open('one [two]');
    expect(type('highlight', 'honey')).toBeNull();
    expect(shown('highlight')).not.toBe('');
  });

  it('an underline color needs an underline, and does not turn one on', () => {
    open('one [two]');
    expect(type('underlineColor', 'brick')).toBe(t('textPane.underlineFirst'));
    expect(shown('underline')).toBe('');
    expect(mounted!.markdown()).toBe('one two');
    expect(type('underline', 'single')).toBeNull();
    expect(type('underlineColor', 'brick')).toBeNull();
    expect(shown('underlineColor')).toBe('brick');
  });

  it('a list symbol font is checked like a font name', () => {
    open('- [one]');
    expect(run(setListLevel({ font: 'x'.repeat(5000) }))).toBe(false);
    expect(run(setListLevel({ font: 'Georgia' }))).toBe(true);
  });
});
