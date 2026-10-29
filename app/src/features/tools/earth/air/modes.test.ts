// The weather-report form in words: the planning report must read back each value the plan lists, and a TAF and
// odd reports must give words, not codes or gaps.
import { describe, expect, it } from 'vitest';
import { run } from '../ui/form';
import { AIR_MODES } from './modes';

const report = AIR_MODES.find((m) => m.id === 'report')!;
const decode = (text: string) => {
  const result = run('air', report, { text: { report: text }, unit: {} });
  if (!result.ok) throw new Error(result.message);
  return result.outcome.table!.rows.map((row) => row.join(': ')).join('\n');
};

describe('reports in words', () => {
  it('reads the planning METAR back', () => {
    const words = decode('KORD 231751Z 25012G20KT 10SM FEW020 SCT250 22/14 A2992 RMK AO2 SLP132 T02220139');
    for (const part of [
      '250 degrees at 12 kt, gusting 20 kt',
      '10 statute miles',
      'few clouds at 2000 ft and scattered clouds at 25 000 ft',
      'temperature 22 °C, dew point 14 °C',
      '29.92 inHg',
      '1013.2 hPa',
      'temperature 22.2 °C and dew point 13.9 °C',
    ])
      expect(words).toContain(part);
  });

  it('puts weather into words', () => {
    const words = decode('KBOS 011200Z 18005KT 2SM +TSRA VCSH -FZDZ BR BKN010CB OVC020 M01/M02 A2990');
    for (const part of [
      'heavy thunderstorm with rain',
      'showers in the vicinity',
      'light freezing drizzle',
      'mist',
      'broken clouds at 1000 ft (cumulonimbus)',
    ])
      expect(words).toContain(part);
  });

  it('reads a TAF period by period', () => {
    const words = decode('TAF KJFK 251130Z 2512/2618 31010KT P6SM SCT035 FM251800 33015G25KT BKN040');
    expect(words).toContain('more than 6 statute miles');
    expect(words).toContain('330 degrees at 15 kt, gusting 25 kt');
  });
});
