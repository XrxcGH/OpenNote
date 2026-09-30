// @vitest-environment node
// Where focus goes after a row leaves a list.

import { describe, expect, it } from 'vitest';
import type { NodeId } from '../../services/notes';
import { siblingOrParent } from './focus';
import type { Row } from './rows';

const id = (value: string) => value as NodeId;
const row = (name: string, level: number, parentId: string | null): Row =>
  ({ id: id(name), level, parentId: parentId ? id(parentId) : null }) as Row;

const rows = [row('a', 1, null), row('a1', 2, 'a'), row('a2', 2, 'a'), row('b', 1, null), row('c', 1, null)];

describe('siblingOrParent', () => {
  it('prefers the next sibling, skipping the row’s own children', () => {
    expect(siblingOrParent(rows, id('a'))).toBe('b');
    expect(siblingOrParent(rows, id('a1'))).toBe('a2');
  });

  it('falls back to the previous sibling, then the parent', () => {
    expect(siblingOrParent(rows, id('c'))).toBe('b');
    expect(siblingOrParent(rows, id('a2'))).toBe('a1');
    expect(siblingOrParent(rows.slice(0, 2), id('a1'))).toBe('a');
  });

  it('finds nothing for a missing row, and for an only child at the top', () => {
    expect(siblingOrParent(rows, id('zz'))).toBeNull();
    expect(siblingOrParent([row('only', 1, null)], id('only'))).toBeNull();
  });
});
