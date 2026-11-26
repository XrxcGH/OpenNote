// @vitest-environment jsdom
// A new table is a sheet-version table (walk bug T3-C04-1): it follows Excel's rules, so 2^3^2 is 64 and -2^2 is 4.
import { describe, expect, it, vi } from 'vitest';
import { newTableData } from '../../../editor/table/mapping';
import { SHEET_VERSION } from '../../tables';
import { withKeys } from './insert';

vi.mock('../../../app/flags', () => ({ isEnabled: () => true }));

describe('withKeys', () => {
  it('stores the newest sheet version in a new table', () => {
    const data = withKeys(newTableData(3, 3, false));
    expect((data.sheet as { v?: number }).v).toBe(SHEET_VERSION);
  });

  it('keeps a version the data already has', () => {
    const base = { ...newTableData(3, 3, false), sheet: { v: 1, table: { keys: true } } };
    expect(withKeys(base as never)).toBe(base);
  });
});
