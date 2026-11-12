// Known answers from ECMA-48 (5th edition, 8.3.117 SGR): 0 resets, 1 is bold, 22 is normal intensity, 30 to 37 pick
// a foreground color in the order black, red, green, yellow, blue, magenta, cyan, white, and 39 is the default.
// 90 to 97 are the bright colors of the aixterm extension. Any other control sequence is removed.
import { describe, expect, it } from 'vitest';
import { AnsiParser, applySgr, parseAnsi, PLAIN, stripAnsi } from './ansi';

const E = '\u001b';

describe('SGR sequences', () => {
  it('colors text with 30 to 37 and resets with 0', () => {
    expect(parseAnsi(`${E}[31mred${E}[0m plain`)).toEqual([
      { text: 'red', fg: 1, bold: false },
      { text: ' plain', fg: null, bold: false },
    ]);
    expect(
      parseAnsi(`${E}[30ma${E}[31mz${E}[32mb${E}[33mc${E}[34md${E}[35me${E}[36mf${E}[37mg`).map((s) => s.fg),
    ).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('reads 90 to 97 as the bright colors 8 to 15', () => {
    expect(parseAnsi(`${E}[90mx${E}[91my${E}[97mz`).map((s) => s.fg)).toEqual([8, 9, 15]);
  });

  it('turns bold on with 1 and off with 22, and takes several parameters at once', () => {
    expect(parseAnsi(`${E}[1;32mok${E}[22m done${E}[m`)).toEqual([
      { text: 'ok', fg: 2, bold: true },
      { text: ' done', fg: 2, bold: false },
    ]);
  });

  it('reads an empty parameter list as reset, and 39 as the default color', () => {
    expect(applySgr({ fg: 3, bold: true }, '')).toEqual(PLAIN);
    expect(applySgr({ fg: 3, bold: true }, '39')).toEqual({ fg: null, bold: true });
  });

  it('skips the numbers of an extended color, so 38;5;31 is not red', () => {
    expect(applySgr(PLAIN, '38;5;31')).toEqual(PLAIN);
    expect(applySgr(PLAIN, '38;2;1;2;3;1')).toEqual({ fg: null, bold: true });
  });
});

describe('unknown sequences', () => {
  it('strips SGR parameters the console does not draw, and keeps the text', () => {
    expect(parseAnsi(`${E}[4munder${E}[44mbg${E}[5mblink`)).toEqual([{ text: 'underbgblink', fg: null, bold: false }]);
  });

  it('strips cursor moves, erase, title strings, and two-byte escapes', () => {
    expect(stripAnsi(`a${E}[2Kb${E}[10;5Hc${E}]0;title${'\u0007'}d${E}]8;;x${E}\\e${E}cf`)).toBe('abcdef');
  });

  it('drops carriage returns and other control characters but keeps tabs and line feeds', () => {
    expect(stripAnsi('a\r\nb\tc\u0000\u0008d')).toBe('a\nb\tcd');
  });
});

describe('output in pieces', () => {
  it('waits for the rest of a sequence cut between two pieces and keeps the style', () => {
    const parser = new AnsiParser();
    expect(parser.push(`one ${E}[3`)).toEqual([{ text: 'one ', fg: null, bold: false }]);
    expect(parser.push('1mtwo')).toEqual([{ text: 'two', fg: 1, bold: false }]);
    expect(parser.push(' three')).toEqual([{ text: ' three', fg: 1, bold: false }]);
  });

  it('drops an unterminated string command too long to be one only to the end of its line', () => {
    expect(stripAnsi(`a${E}]${'x'.repeat(80)}\nnext line\nmore`)).toBe('a\nnext line\nmore');
    const parser = new AnsiParser();
    expect(parser.push(`a${E}P${'y'.repeat(80)}\nnext`)).toEqual([{ text: 'a\nnext', fg: null, bold: false }]);
  });

  it('shows the text after a short unterminated sequence when the run ends', () => {
    const parser = new AnsiParser();
    expect(parser.push(`a${E}]title\nnext line`)).toEqual([{ text: 'a', fg: null, bold: false }]);
    expect(parser.push('', true)).toEqual([{ text: '\nnext line', fg: null, bold: false }]);
    expect(stripAnsi(`a${E}]title\nnext line`)).toBe('a\nnext line');
  });
});
