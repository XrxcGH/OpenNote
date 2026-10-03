import { describe, expect, it } from 'vitest';
import { entry } from './fake';
import { Flags } from './flags';
import { StampIndex, isFlag } from './stamps';

const ids = () => {
  let next = 0;
  return () => `f${++next}`;
};

describe('Flags', () => {
  it('drops flags in time order and trims their labels', () => {
    const flags = new Flags();
    const newId = ids();
    flags.add('r1', 9_000, newId, '  Decision  ');
    flags.add('r1', 3_000, newId);
    expect(flags.list('r1').map((f) => [f.captureNs, f.label])).toEqual([
      [3_000, ''],
      [9_000, 'Decision'],
    ]);
    flags.add('r1', 4_000, newId, 'x'.repeat(200));
    expect(flags.get('f3')?.label).toHaveLength(80);
  });

  it('answers a double press on the same instant with the same flag', () => {
    const flags = new Flags();
    const first = flags.add('r1', 5, ids());
    expect(flags.add('r1', 5, ids())).toBe(first);
    expect(flags.size).toBe(1);
  });

  it('renames and removes, and says whether anything changed', () => {
    const flags = new Flags();
    const flag = flags.add('r1', 1, ids());
    expect(flags.rename(flag.id, 'Budget')).toBe(true);
    expect(flags.rename(flag.id, 'Budget')).toBe(false);
    expect(flags.rename('nope', 'x')).toBe(false);
    expect(flags.remove(flag.id)).toBe(true);
    expect(flags.remove(flag.id)).toBe(false);
  });

  it('round-trips through a recording entry and keeps its other fields', () => {
    const recording = { ...entry('r1'), listenedNs: 42 };
    const flags = new Flags();
    flags.add('r1', 7, ids(), 'Start');
    flags.add('r2', 8, ids(), 'Elsewhere');
    const saved = flags.into(recording);
    expect(saved['listenedNs']).toBe(42);
    expect(saved['flags']).toEqual([{ id: 'f1', recording: 'r1', captureNs: 7, label: 'Start' }]);
    expect(Flags.fromEntries([saved]).list()).toEqual(flags.list('r1'));
    expect('flags' in new Flags().into(saved)).toBe(false);
  });

  it('leaves out damaged flags, and keeps a flag that names another recording with the entry that stores it', () => {
    const good = { id: 'ok', recording: 'r1', captureNs: 1, label: '' };
    const other = { id: 'y', recording: 'r2', captureNs: 1, label: '' };
    const recording = { ...entry('r1'), flags: [good, { id: 5 }, 'x', other] };
    const flags = Flags.fromEntries([recording]);
    expect(flags.list().map((f) => [f.id, f.recording])).toEqual([
      ['ok', 'r1'],
      ['y', 'r1'],
    ]);
    // Saving the entry again keeps both.
    expect(Flags.fromEntries([flags.into(recording)]).size).toBe(2);
  });

  it('keeps the flags of a recording whose edit gave it a new ID', () => {
    const flags = new Flags();
    flags.add('old', 7, ids(), 'Start');
    const stored = flags.into(entry('old'));
    // The edit's summary comes back under another ID, and the entry carries its extra fields over.
    const edited = { ...stored, id: 'new' };
    const loaded = Flags.fromEntries([edited]);
    expect(loaded.list('new').map((f) => f.label)).toEqual(['Start']);
    expect(loaded.into(edited)['flags']).toEqual([{ id: 'f1', recording: 'new', captureNs: 7, label: 'Start' }]);
  });

  it('gives each half of a split the flags inside it', () => {
    const flags = new Flags();
    const newId = ids();
    flags.add('r1', 1_000, newId, 'Early');
    flags.add('r1', 9_000, newId, 'Late');
    flags.add('r2', 9_500, newId, 'Other recording');
    const halves = [
      { ...entry('r1'), startedNs: 0, endedNs: 5_000 },
      { ...entry('r1b'), startedNs: 5_000, endedNs: 12_000 },
    ];
    expect(flags.moveToSplit('r1', halves)).toBe(true);
    expect(flags.list('r1').map((f) => f.label)).toEqual(['Early']);
    expect(flags.list('r1b').map((f) => f.label)).toEqual(['Late']);
    expect(flags.list('r2').map((f) => f.label)).toEqual(['Other recording']);
    expect(flags.moveToSplit('r1', halves)).toBe(false);
    const saved = halves.map((half) => flags.into(half));
    expect(Flags.fromEntries(saved).list('r1b')).toHaveLength(1);
  });

  it('feeds the stamp index so keys can jump between flags', () => {
    const flags = new Flags();
    flags.add('r1', 10_000, ids());
    flags.add('r1', 30_000, ids());
    const index = new StampIndex(flags.stampEntries());
    expect(index.nextAfter('r1', 10_000, isFlag)?.startNs).toBe(30_000);
    expect(index.previousBefore('r1', 30_000, isFlag)?.startNs).toBe(10_000);
  });
});
