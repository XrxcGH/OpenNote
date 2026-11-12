// The dialog's draft: what it makes of a rule and back, and what stops a save.
import { describe, expect, it } from 'vitest';
import { draftOf, itemsOf, ruleOf } from './draft';
import type { Draft } from './draft';
import { DE_DE } from '../../engine';

const RANGES = [{ col: 'c1' }];
const base = (patch: Partial<Draft>): Draft => ({ ...draftOf(), ...patch });

describe('ruleOf', () => {
  it('writes only what differs from the defaults', () => {
    const made = ruleOf(base({ kind: 'decimal', op: 'between', a: '0', b: '100' }), RANGES);
    expect(made).toEqual({ rule: { ranges: [{ col: 'c1' }], kind: 'decimal', op: 'between', a: '0', b: '100' } });
  });

  it('writes the alert, the messages, and ignoreBlank when they are set', () => {
    const made = ruleOf(
      base({
        kind: 'whole',
        op: 'greater',
        a: '3',
        ignoreBlank: false,
        showInput: true,
        inputTitle: 'Count',
        inputText: 'Whole numbers',
        showError: true,
        alert: 'warning',
        errorTitle: 'Hmm',
        errorText: 'Too small',
      }),
      RANGES,
    );
    expect(made).toEqual({
      rule: {
        ranges: [{ col: 'c1' }],
        kind: 'whole',
        op: 'greater',
        a: '3',
        ignoreBlank: false,
        input: { title: 'Count', text: 'Whole numbers' },
        alert: 'warning',
        error: { title: 'Hmm', text: 'Too small' },
      },
    });
  });

  it('turns typed items into a list, one per line, without blanks and repeats', () => {
    expect(itemsOf(' Red\r\nGreen\n\nRed\n  Blue ')).toEqual(['Red', 'Green', 'Blue']);
    const made = ruleOf(base({ kind: 'list', itemsText: 'a\nb', dropDown: false }), RANGES);
    expect(made).toEqual({ rule: { ranges: [{ col: 'c1' }], kind: 'list', items: ['a', 'b'], dropDown: false } });
  });

  it('keeps a source instead of items', () => {
    const made = ruleOf(base({ kind: 'list', listFrom: 'range', source: 'E2:E4' }), RANGES);
    expect(made).toEqual({ rule: { ranges: [{ col: 'c1' }], kind: 'list', source: 'E2:E4' } });
  });

  it('says what is missing', () => {
    expect(ruleOf(base({ kind: 'whole', a: '' }), RANGES)).toEqual({ problems: ['operand'] });
    expect(ruleOf(base({ kind: 'whole', op: 'between', a: '9', b: '1' }), RANGES)).toEqual({ problems: ['order'] });
    expect(ruleOf(base({ kind: 'list', itemsText: ' ' }), RANGES)).toEqual({ problems: ['items'] });
    expect(ruleOf(base({ kind: 'custom', a: '' }), RANGES)).toEqual({ problems: ['formula'] });
    expect(ruleOf(base({ kind: 'any' }), [])).toEqual({ problems: ['ranges'] });
  });

  it('round-trips a saved rule through the draft', () => {
    const rule = {
      ranges: [{ col: 'c1' }],
      kind: 'checkbox',
      checked: 'Done',
      unchecked: 'Open',
      alert: 'information',
      error: { title: 'T', text: 'X' },
    };
    expect(ruleOf(draftOf(rule), RANGES)).toEqual({ rule });
  });
});

describe('regions', () => {
  it('stores numbers and formulas in the invariant form whatever region typed them', () => {
    const de = ruleOf(base({ kind: 'decimal', op: 'lessOrEqual', a: '2,5' }), RANGES, DE_DE);
    expect(de).toEqual({ rule: { ranges: [{ col: 'c1' }], kind: 'decimal', op: 'lessOrEqual', a: '2.5' } });
    const f = ruleOf(base({ kind: 'custom', a: '=AND(A1>0;A1<1,5)' }), RANGES, DE_DE);
    expect('rule' in f && f.rule.a).toBe('=AND(A1>0,A1<1.5)');
  });

  it('shows a stored rule in the region of the reader', () => {
    expect(draftOf({ kind: 'decimal', op: 'less', a: '2.5' }, DE_DE).a).toBe('2,5');
    expect(draftOf({ kind: 'custom', a: '=SUM(A1,1.5)' }, DE_DE).a).toBe('=SUM(A1;1,5)');
  });

  it('writes a date the region typed as an ISO date', () => {
    const r = ruleOf(base({ kind: 'date', op: 'equal', a: '24.12.2026' }), RANGES, DE_DE);
    expect('rule' in r && r.rule.a).toBe('2026-12-24');
  });

  it('writes no alert when the own-alert box is cleared, and shows it cleared for a rule without one', () => {
    const r = ruleOf(base({ kind: 'whole', op: 'greater', a: '1', showError: false, alert: 'warning' }), RANGES);
    expect('rule' in r && 'alert' in r.rule).toBe(false);
    expect(draftOf({ kind: 'whole', op: 'greater', a: '1' }).showError).toBe(false);
  });
});
