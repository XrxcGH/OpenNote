import { describe, expect, it } from 'vitest';
import { applyMergePatch } from '../../../platform/mergePatch';
import {
  applyGroups,
  expandSelection,
  groupChange,
  groupsEdit,
  groupsOf,
  groupsTouched,
  ungroupChange,
} from './groups';

const everything = { block: () => true, stroke: () => true };

describe('object groups in the page view', () => {
  const view = {
    layout: 'freeform',
    groups: {
      g1: { blocks: ['b1'], strokes: ['s1', 's2'] },
      junk: 'not a group',
      empty: { blocks: [], strokes: [] },
    },
  };

  it('reads the groups and skips what is not one', () => {
    const groups = groupsOf(view);
    expect([...groups.keys()]).toEqual(['g1']);
    expect(groups.get('g1')).toEqual({ blocks: ['b1'], strokes: ['s1', 's2'] });
    expect(groupsOf({}).size).toBe(0);
    expect(groupsOf(null).size).toBe(0);
  });

  it('widens a selection of one member to the whole group, leaving out what is gone', () => {
    const groups = groupsOf(view);
    expect(expandSelection(groups, { blocks: [], strokes: ['s1'] }, everything)).toEqual({
      blocks: ['b1'],
      strokes: ['s1', 's2'],
    });
    const noS2 = { block: () => true, stroke: (id: string) => id !== 's2' };
    expect(expandSelection(groups, { blocks: ['b1'], strokes: [] }, noS2)).toEqual({ blocks: ['b1'], strokes: ['s1'] });
    expect(expandSelection(groups, { blocks: ['b1'], strokes: ['s1', 's2'] }, everything)).toBeNull();
    expect(expandSelection(groups, { blocks: ['b9'], strokes: [] }, everything)).toBeNull();
  });

  it('groups a selection into one new group that replaces the groups it took in', () => {
    const groups = groupsOf(view);
    const changes = groupChange(groups, { blocks: ['b1', 'b2'], strokes: ['s1', 's2'] }, 'g2')!;
    expect(changes).toEqual({ g1: null, g2: { blocks: ['b1', 'b2'], strokes: ['s1', 's2'] } });
    const after = applyGroups(groups, changes);
    expect([...after.keys()]).toEqual(['g2']);
    expect(groupChange(groups, { blocks: ['b1'], strokes: [] })).toBeNull();
  });

  it('ungroups the groups a selection touches', () => {
    const groups = groupsOf(view);
    expect(ungroupChange(groups, { blocks: [], strokes: ['s2'] })).toEqual({ g1: null });
    expect(ungroupChange(groups, { blocks: ['b5'], strokes: [] })).toBeNull();
    expect(groupsTouched(groups, { blocks: ['b1'], strokes: [] })).toEqual(['g1']);
  });

  it('writes the change as a setPage view patch that leaves the rest of the view and the reading order alone', () => {
    const edit = groupsEdit({ g1: null, g2: { blocks: ['b1'], strokes: ['s1'] } });
    expect(edit).toEqual({ edit: 'setPage', view: { groups: { g1: null, g2: { blocks: ['b1'], strokes: ['s1'] } } } });
    const before = { ...view, readingOrder: ['b1', 'b2'] };
    const next = applyMergePatch(before, (edit as { view: Record<string, unknown> }).view) as typeof before;
    expect(next.readingOrder).toEqual(['b1', 'b2']);
    expect(next.layout).toBe('freeform');
    expect(groupsOf(next).get('g2')).toEqual({ blocks: ['b1'], strokes: ['s1'] });
    expect(groupsOf(next).has('g1')).toBe(false);
  });
});
