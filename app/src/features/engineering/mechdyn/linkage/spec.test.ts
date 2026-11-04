import '../text';
import { describe, expect, it } from 'vitest';
import { firstTexts, runTool } from '../kit/read';
import { shownFields } from '../kit/spec';
import { linkageSpec } from './spec';

const texts = (extra: Record<string, string>) => ({ ...firstTexts(linkageSpec), ...extra });
const ids = (extra: Record<string, string>) => shownFields(linkageSpec, texts(extra)).map((field) => field.id);

describe('the linkage tool circuit control', () => {
  it('is offered only for the mechanisms whose answer depends on it', () => {
    expect(ids({ type: 'fourbar' })).toContain('circuit');
    expect(ids({ type: 'slider' })).toContain('circuit');
    // The inverted slider-crank has one assembly, so Open and Crossed gave identical results (a dead control).
    expect(ids({ type: 'inverted' })).not.toContain('circuit');
  });

  it('changes the result where it is offered', () => {
    const answer = (circuit: string) => {
      const run = runTool(linkageSpec, texts({ circuit }), 'si');
      if (!run.ok) throw new Error('the linkage did not run');
      return run.outcome.rows.map((row) => JSON.stringify(row.value));
    };
    expect(answer('open')).not.toEqual(answer('crossed'));
  });
});
