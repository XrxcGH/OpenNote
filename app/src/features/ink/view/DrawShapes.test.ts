// The shape library's submenus.
import { describe, expect, it } from 'vitest';
import { groupItems } from './DrawShapes';

describe('the shape library', () => {
  it('lists the database cylinder under Flowchart as well as Network (full walk 2, A1-A10-3)', () => {
    expect(groupItems('flowchart')).toContain('database');
    expect(groupItems('network')).toContain('database');
    expect(new Set(groupItems('flowchart')).size).toBe(groupItems('flowchart').length);
  });
});
