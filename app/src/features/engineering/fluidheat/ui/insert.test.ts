import { describe, expect, it } from 'vitest';
import { answerHtml, stepsHtml, type InsertContext } from './insert';

const say: InsertContext['say'] = (key, params) =>
  key.endsWith('.title')
    ? 'Pipe <flow> & heads'
    : key.includes('.row.')
      ? 'Q < 1 & more'
      : `${key}${params ? '!' : ''}`;

const context: InsertContext = {
  tool: 'pipes',
  system: 'si',
  say,
  outcome: { rows: [{ id: 'flow', value: 2, answer: true }], steps: [{ key: 'fhPipesNoFlow' }] },
};

describe('insert HTML', () => {
  it('the answer line is its own escaped paragraph, so it cannot join the last list item', () => {
    expect(answerHtml(context)).toBe('<p>Pipe &lt;flow&gt; &amp; heads: Q &lt; 1 &amp; more = 2</p>');
  });
  it('steps are a list the answer paragraph can follow', () => {
    expect(stepsHtml(context)).toMatch(/<\/ol>$/);
  });
});
