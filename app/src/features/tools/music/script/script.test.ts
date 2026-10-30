import { describe, expect, it } from 'vitest';
import { initialValues, runTool } from '../spec';
import { eighthsText, pageCount, parseFountain, wrap } from './fountain';
import { spec } from './tool';

function run(mode: string, script: string, changes: Record<string, string> = {}) {
  return runTool(spec, { ...initialValues(spec), mode, script, ...changes });
}
const rowOf = (result: ReturnType<typeof run>, key: string, who?: string): string | undefined =>
  result.ok
    ? result.rows.find((r) => r.key === key && (who === undefined || r.vars?.n === who || r.vars?.name === who))?.value
    : undefined;
const types = (text: string): string[] => parseFountain(text).elements.map((e) => e.type);

describe('Fountain line classification', () => {
  it('reads a scene, action, a cue, a parenthetical, and dialogue', () => {
    const text = 'INT. KITCHEN - NIGHT\n\nRain on the glass.\n\nANNA\n(quietly)\nHello.\n';
    expect(types(text)).toEqual(['scene', 'action', 'character', 'parenthetical', 'dialogue']);
  });
  it('reads CUT TO: between blank lines as a transition', () => {
    expect(types('Door closes.\n\nCUT TO:\n\nINT. HALL - DAY\n')).toEqual(['action', 'transition', 'scene']);
  });
  it('does not take a capitalized action line with nothing under it for a character', () => {
    expect(types('Door closes.\n\nBANG\n')).toEqual(['action', 'action']);
  });
  it('honors forced elements', () => {
    expect(types('!INT. NOT A HEADING\n\n.FLASHBACK\n\n@mcCoy\nStop.\n\n> FADE OUT.\n')).toEqual([
      'action',
      'scene',
      'character',
      'dialogue',
      'transition',
    ]);
  });
  it('reads centered text, sections, synopses, and page breaks', () => {
    expect(types('> THE END <\n\n# Act one\n\n= They meet.\n\n===\n')).toEqual([
      'centered',
      'section',
      'synopsis',
      'pagebreak',
    ]);
  });
  it('keeps notes and boneyard out of the lines', () => {
    const parsed = parseFountain('INT. A - DAY\n\nHe waits. [[check the clock]]\n\n/* cut this */\n');
    expect(parsed.elements.map((e) => e.text)).toEqual(['INT. A - DAY', 'He waits.']);
    expect(parsed.notes).toEqual([{ scene: 1, text: 'check the clock' }]);
  });
  it('reads a title page', () => {
    expect(parseFountain('Title: A Play\nAuthor: Me\n\nINT. A - DAY\n').title).toEqual({
      title: 'A Play',
      author: 'Me',
    });
  });
  it('gives characters with extensions the same name', () => {
    const result = run('characters', 'INT. A - DAY\n\nANNA\nOne.\n\nANNA (V.O.)\nTwo.\n\nBEN\nThree.\n');
    expect(rowOf(result, 'castRow', 'ANNA')).toMatch(/^2 speeches/);
  });
});

describe('page estimates', () => {
  it('counts 55 lines to a page and rounds up', () => {
    expect(pageCount(110)).toBe(2);
    expect(pageCount(111)).toBe(3);
    expect(pageCount(1)).toBe(1);
  });
  it('estimates two pages and two minutes for a script of 110 typed lines', () => {
    const text = Array.from({ length: 55 }, (_, i) => `Line number ${i + 1}.`).join('\n\n');
    const result = run('format', text);
    expect(rowOf(result, 'linesOut')).toBe('110');
    expect(rowOf(result, 'pagesOut')).toBe('2');
    expect(rowOf(result, 'minutesOut')).toBe('about 2');
  });
  it('wraps action at 60 characters and dialogue at 35', () => {
    expect(wrap('word '.repeat(20).trim(), 60).map((l) => l.length)).toEqual([59, 39]);
    const result = run('format', 'ANNA\n' + 'word '.repeat(20).trim() + '\n');
    expect(result.ok && result.code?.split('\n')[1]).toBe(`${' '.repeat(10)}${'word '.repeat(7).trim()}`);
  });
  it('writes lengths in eighths', () => {
    expect(eighthsText(5)).toBe('5/8');
    expect(eighthsText(8)).toBe('1');
    expect(eighthsText(19)).toBe('2 3/8');
  });
});

describe('lists and sheets', () => {
  const script =
    'INT. KITCHEN - NIGHT\n\nANNA pours a drink from the BOTTLE.\n\nANNA\nOne.\n\nBEN\nTwo.\n\nANNA\nThree.\n\n' +
    'EXT. YARD - DAY\n\nANNA\nFour.\n\nBEN\nFive.\n\n[[Ben needs a coat]]\n';
  it('counts speeches for two characters as 3 and 2, with their scenes', () => {
    const result = run('characters', script);
    expect(rowOf(result, 'castRow', 'ANNA')).toBe('3 speeches, 3 words, scenes 1, 2');
    expect(rowOf(result, 'castRow', 'BEN')).toBe('2 speeches, 2 words, scenes 1, 2');
  });
  it('lists scenes with page and length', () => {
    const result = run('scenes', script);
    expect(rowOf(result, 'sceneRow', '1')).toMatch(/^page 1, \d+(\/8| \d\/8)? — INT\. KITCHEN - NIGHT$/);
    expect(result.ok && result.rows).toHaveLength(2);
  });
  it('splits headings into places and times', () => {
    const result = run('locations', script);
    expect(rowOf(result, 'placeRow', 'KITCHEN')).toBe('scenes 1; NIGHT');
    expect(rowOf(result, 'placeRow', 'YARD')).toBe('scenes 2; DAY');
  });
  it('seeds a breakdown sheet with cast, props, and notes', () => {
    const result = run('breakdown', script);
    expect(rowOf(result, 'sheetRow', '1')).toBe('INT. KITCHEN - NIGHT. Cast: ANNA, BEN. Props: BOTTLE. Notes: —');
    expect(rowOf(result, 'sheetRow', '2')).toContain('Notes: Ben needs a coat');
  });
  it('lays a stage play out with a narrower direction column', () => {
    const result = run('format', 'INT. A ROOM - DAY\n\nHe waits.\n', { layout: 'stage' });
    expect(result.ok && result.code?.split('\n')[2]).toBe(`${' '.repeat(15)}He waits.`);
  });
});

describe('problems', () => {
  it.each([
    ['format', '', 'scEmpty'],
    ['format', '   \n\n', 'scEmpty'],
    ['scenes', 'Just action.\n', 'scNoScenes'],
    ['characters', 'INT. A - DAY\n\nNothing said.\n', 'scNoCharacters'],
    ['format', 'x'.repeat(300_001), 'scTooLong'],
  ])('rejects %s of %j as %s', (mode, text, error) => {
    const result = run(mode, text);
    expect(!result.ok && result.error).toBe(error);
  });
});
