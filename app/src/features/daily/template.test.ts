import { describe, expect, it } from 'vitest';
import { DEFAULT_TEMPLATES, renderTemplate } from './template';

describe('daily note templates', () => {
  it('fills the placeholders for the day', () => {
    expect(renderTemplate(DEFAULT_TEMPLATES.day, { y: 2026, m: 10, d: 3 })).toBe('## Saturday, October 3, 2026\n\n');
    expect(renderTemplate(DEFAULT_TEMPLATES.week, { y: 2026, m: 10, d: 3 })).toBe('## Week 40, 2026\n\n');
    expect(renderTemplate(DEFAULT_TEMPLATES.month, { y: 2026, m: 10, d: 3 })).toBe('## October 2026\n\n');
    expect(renderTemplate('{date} {weekday}', { y: 2026, m: 1, d: 5 })).toBe('2026-01-05 Monday');
  });

  it('leaves unknown placeholders alone', () => {
    expect(renderTemplate('{nothing} {year}', { y: 2026, m: 1, d: 1 })).toBe('{nothing} 2026');
  });
});
