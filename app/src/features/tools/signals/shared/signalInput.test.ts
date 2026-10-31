// Reading a signal from a table: the value column alone, or with a time column whose even spacing sets the rate.
import { describe, expect, it } from 'vitest';
import { SignalError } from './errors';
import { readSignal, tableSignal, timedSignal } from './signalInput';

describe('signals from text and tables', () => {
  it('takes time and value lines, and refuses uneven times', () => {
    // Times 0, 0.004, 0.008 s are 4 ms apart: 250 Hz.
    expect(readSignal('0 1\n0.004 2\n0.008 3').rate).toBeCloseTo(250, 9);
    expect(() => timedSignal([0, 1, 3], [1, 2, 3])).toThrow(SignalError);
  });

  it('reads the value column of a table, with a time column setting the rate and missing rows dropped', () => {
    const table = { text: 'time\tvolts\tlabel\n0\t1.5\ta\n0.01\t-2\tb\n0.02\tNA\tc\n0.03\t4\td' };
    expect(tableSignal(table, {})).toBeNull();
    expect(tableSignal(table, { response: 'volts' })).toEqual({ samples: [1.5, -2, 4] });
    // With the row at 0.02 s missing, the times 0, 0.01, 0.03 are no longer even.
    expect(() => tableSignal(table, { response: 'volts', time: 'time' })).toThrow(SignalError);
    const even = { text: 'time\tvolts\n0\t1.5\n0.01\t-2\n0.02\t3' };
    const read = tableSignal(even, { response: 'volts', time: 'time' })!;
    expect(read.samples).toEqual([1.5, -2, 3]);
    expect(read.rate).toBeCloseTo(100, 9);
    // One sample a day is 1/86400 Hz.
    const daily = tableSignal(
      { text: 'day\tcount\n2026-01-01\t3\n2026-01-02\t5\n2026-01-03\t4' },
      { response: 'count', time: 'day' },
    )!;
    expect(daily.rate).toBeCloseTo(1 / 86_400, 15);
  });
});
