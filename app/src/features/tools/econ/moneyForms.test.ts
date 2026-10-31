import { describe, expect, it } from 'vitest';
import type { EconForm, Values } from './forms';
import { MONEY } from './moneyForms';

function run(id: string, text: Record<string, string>) {
  const form = MONEY.forms.find((f) => f.id === id) as EconForm;
  const fields = typeof form.fields === 'function' ? form.fields({ text: {}, unit: {} }) : form.fields;
  const base = Object.fromEntries(
    fields.map((f) => [f.id, f.initial ?? (f.kind === 'select' ? f.options?.[0]?.value : '') ?? '']),
  );
  const values: Values = { text: { ...base, ...text }, unit: {} };
  return form.solve(values);
}

const headline = (o: ReturnType<typeof run>) => (o.ok ? o.headline : o.message);

describe('money forms', () => {
  it('solves the empty field of a single sum', () => {
    expect(headline(run('single', {}))).toBe('Future value: 1,628.89');
    expect(headline(run('single', { fv: '2000', pv: '' }))).toMatch(/Present value: 1,227\.8/);
    expect(headline(run('single', { fv: '2000', rate: '' }))).toMatch(/Rate per period: 7\.1773/);
  });
  it('says what is wrong with a single sum', () => {
    expect(headline(run('single', { fv: '5' }))).toMatch(/Empty one field/);
    expect(headline(run('single', { fv: '', pv: '' }))).toMatch(/exactly one/);
    expect(headline(run('single', { rate: '-100' }))).toMatch(/-100%/);
  });
  it('prices an annuity and a rate', () => {
    expect(headline(run('annuity', {}))).toMatch(/Present value 7,721\.73; future value 12,577\.89/);
    expect(headline(run('rates', {}))).toBe('Effective annual rate: 12.6825%');
  });
  it('prices a mortgage', () => {
    const out = run('loan', {});
    expect(headline(out)).toBe('Payment each period: 1,798.65');
    expect(out.ok && out.steps.join(' ')).toMatch(/Total interest: 347,514/);
    expect(headline(run('loan', { amount: '0' }))).toMatch(/must be positive/);
  });
  it('appraises cash flows', () => {
    const out = run('flows', {});
    expect(headline(out)).toBe('Net present value: −21.04');
    const steps = out.ok ? out.steps.join('|') : '';
    expect(steps).toMatch(/8\.896%/);
    expect(steps).toMatch(/9\.223%/);
    expect(headline(run('flows', { flows: '5' }))).toMatch(/at least two/);
  });
  it('depreciates and reads MACRS', () => {
    expect(headline(run('depr', { method: 'double' }))).toMatch(/First year 4,000/);
    const out = run('depr', { method: 'macrs', salvage: '0', life: '5' });
    expect(out.ok && out.steps[0]).toBe('Year 1: 2,000 (20% of cost)');
    expect(headline(run('depr', { method: 'macrs', life: '4' }))).toMatch(/3, 5, 7/);
  });
  it('reports property and cost-effectiveness ratios', () => {
    expect(headline(run('property', {}))).toBe('Cap rate: 8%');
    expect(headline(run('cea', {}))).toBe('Incremental cost per unit gained: 20,000');
    expect(headline(run('cea', { effectNew: '3.5' }))).toMatch(/same effect/);
  });
});
