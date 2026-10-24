// Which kind of diagram a text is, and the starting texts.
import { describe, expect, it } from 'vitest';
import { STARTERS, STARTER_TEXT, fallbackOf, kindOf } from './kind';

describe('diagram kinds', () => {
  it('are told from the first word', () => {
    expect(kindOf('flowchart TD\n A-->B')).toBe('flowchart');
    expect(kindOf('graph LR\n A-->B')).toBe('flowchart');
    expect(kindOf('%% a comment\nsequenceDiagram\n A->>B: hi')).toBe('sequence');
    expect(kindOf('---\ntitle: Plan\n---\ntimeline\n 2024 : Idea')).toBe('timeline');
    expect(kindOf('classDiagram\n class A')).toBe('class');
    expect(kindOf('pie title Pets')).toBe('other');
    expect(kindOf('')).toBe('other');
  });
  it('start from an example of each kind', () => {
    for (const kind of STARTERS) expect(kindOf(STARTER_TEXT[kind])).toBe(kind);
  });
  it('keep the text in a fence for readers without the feature', () => {
    expect(fallbackOf('graph TD')).toBe('```mermaid\ngraph TD\n```');
  });
});
