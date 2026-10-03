import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ExprError } from './errors';
import { GENERAL } from './general';
import { tokenize, type LexSpec, type Token } from './lexer';
import { LETTERS, SHEET, SHEET_COMMA } from './testing';

/** Kind and text of each token except the end, to keep expectations short. */
function kinds(source: string, lex = GENERAL.lex): string[] {
  return tokenize(source, lex)
    .filter((t) => t.kind !== 'eof')
    .map((t) => `${t.kind}:${t.text}`);
}

function failure(source: string, lex = GENERAL.lex): ExprError {
  try {
    tokenize(source, lex);
  } catch (error) {
    if (error instanceof ExprError) return error;
    throw error;
  }
  throw new Error(`${source} should not tokenize`);
}

describe('numbers', () => {
  it('reads whole numbers, decimals, leading and trailing points, and exponents', () => {
    expect(kinds('12 1.5 .5 1. 2e3 1.5E-2 3e+4')).toEqual([
      'num:12',
      'num:1.5',
      'num:.5',
      'num:1.',
      'num:2e3',
      'num:1.5E-2',
      'num:3e+4',
    ]);
  });

  it('reads 2e as a number and a name, because an exponent needs digits', () => {
    expect(kinds('2e')).toEqual(['num:2', 'name:e']);
    expect(kinds('2e3')).toEqual(['num:2e3']);
  });

  it('gives each number its value, with a comma as the decimal mark when asked', () => {
    const tokens = tokenize('1,5e2 + 3', SHEET_COMMA.lex);
    expect(tokens[0]).toMatchObject({ kind: 'num', text: '1,5e2', value: 150 });
    expect(tokenize('1.5e2', SHEET.lex)[0].value).toBe(150);
  });

  it('refuses a number too large for a double', () => {
    expect(failure('1e999')).toMatchObject({ code: 'bad-number', position: 0, detail: '1e999' });
  });
});

describe('grouped digits', () => {
  const grouped: LexSpec = { ...GENERAL.lex, separators: ';', thousands: ',' };
  const european: LexSpec = { ...GENERAL.lex, decimal: ',', separators: ';', thousands: '.' };

  it('reads a mark followed by exactly three digits as part of the number', () => {
    const tokens = tokenize('1,200 + 1,234,567.5', grouped);
    expect(tokens.filter((t) => t.kind === 'num').map((t) => [t.text, t.value])).toEqual([
      ['1,200', 1200],
      ['1,234,567.5', 1234567.5],
    ]);
  });

  it('leaves other uses of the mark alone', () => {
    expect(failure('1,23', grouped)).toMatchObject({ code: 'bad-character', detail: ',' });
    expect(failure('1,2345', grouped)).toMatchObject({ code: 'bad-character', detail: ',' });
    expect(failure('0,125', grouped)).toMatchObject({ code: 'bad-character', detail: ',', position: 1 });
    expect(failure('012,345', grouped)).toMatchObject({ code: 'bad-character', detail: ',', position: 3 });
    expect(kinds('12;345', grouped)).toEqual(['num:12', 'sep:;', 'num:345']);
  });

  it('works with the decimal comma and a period for groups', () => {
    const tokens = tokenize('1.200,50', european);
    expect(tokens[0]).toMatchObject({ kind: 'num', text: '1.200,50', value: 1200.5 });
  });
});

describe('names and symbols', () => {
  it('reads ASCII names with digits and underscores', () => {
    expect(kinds('abc a_1 _x m3')).toEqual(['name:abc', 'name:a_1', 'name:_x', 'name:m3']);
  });

  it('reads pasted symbols as plain operators', () => {
    expect(kinds('6 × 7 ÷ 2 − 1')).toEqual(['num:6', 'op:*', 'num:7', 'op:/', 'num:2', 'op:-', 'num:1']);
    expect(kinds('2 ** 3')).toEqual(['num:2', 'op:^', 'num:3']);
  });

  it('reads symbols that stand for names', () => {
    expect(kinds('π τ √')).toEqual(['name:pi', 'name:tau', 'name:sqrt']);
  });

  it('reads superscript digits and signs as a power', () => {
    expect(kinds('x²')).toEqual(['name:x', 'op:^', 'num:2']);
    expect(kinds('x¹⁰')).toEqual(['name:x', 'op:^', 'num:10']);
    expect(kinds('x⁻³')).toEqual(['name:x', 'op:^', 'op:-', 'num:3']);
  });

  it('leaves runs of letters whole for the parser to split', () => {
    expect(kinds('pix atan2 x3', LETTERS.lex)).toEqual(['word:pix', 'word:atan2', 'word:x3']);
  });

  it('reads cell names with dollar signs and the two-letter operators', () => {
    expect(kinds('$A$1 <= >= <>', SHEET.lex)).toEqual(['name:$A$1', 'op:<=', 'op:>=', 'op:<>']);
    expect(kinds('≤ ≥ ≠', SHEET.lex)).toEqual(['op:<=', 'op:>=', 'op:<>']);
  });
});

describe('strings and brackets', () => {
  it('reads strings with doubled quotes', () => {
    expect(kinds('"a ""quoted"" word"', SHEET.lex)).toEqual(['str:a "quoted" word']);
  });

  it('reads column names with doubled closing brackets, and ids without escapes', () => {
    expect(kinds('[Unit price [EUR]]]', SHEET.lex)).toEqual(['col:Unit price [EUR]']);
    expect(kinds('{c0}{c1}', SHEET.lex)).toEqual(['id:c0', 'id:c1']);
  });

  it('points at the start of an unclosed quote or bracket', () => {
    expect(failure('1+"open', SHEET.lex)).toMatchObject({ code: 'unclosed-quote', position: 2 });
    expect(failure('[Price', SHEET.lex)).toMatchObject({ code: 'unclosed-bracket', position: 0 });
    expect(failure('{', SHEET.lex)).toMatchObject({ code: 'unclosed-bracket', position: 0 });
  });
});

describe('separators', () => {
  it('reads a semicolon and the dialect separator as argument separators', () => {
    expect(kinds('a;b,c', SHEET.lex).filter((t) => t.startsWith('sep'))).toHaveLength(2);
    expect(kinds('a;b', SHEET_COMMA.lex).filter((t) => t.startsWith('sep'))).toHaveLength(1);
  });

  it('refuses a comma in the regional form, where it belongs to numbers', () => {
    expect(failure('A1,B1', SHEET_COMMA.lex)).toMatchObject({ code: 'bad-character', detail: ',' });
  });
});

describe('places and limits', () => {
  it('records where every token starts and ends', () => {
    const tokens = tokenize('12 + abc', GENERAL.lex);
    expect(tokens.map((t) => [t.start, t.end])).toEqual([
      [0, 2],
      [3, 4],
      [5, 8],
      [8, 8],
    ]);
  });

  it('names the character it cannot read', () => {
    expect(failure('2 $ 3')).toMatchObject({ code: 'bad-character', position: 2, detail: '$', length: 1 });
  });

  it('refuses text over the limit', () => {
    expect(failure('1'.repeat(2001))).toMatchObject({ code: 'too-long', position: 0 });
  });
});

describe('any text', () => {
  it('either gives tokens in order or fails with an ExprError, never anything else', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 60 }), fc.constantFrom(GENERAL.lex, LETTERS.lex, SHEET.lex), (text, lex) => {
        let tokens: Token[];
        try {
          tokens = tokenize(text, lex);
        } catch (error) {
          expect(error).toBeInstanceOf(ExprError);
          return;
        }
        expect(tokens.at(-1)?.kind).toBe('eof');
        let at = 0;
        for (const token of tokens) {
          expect(token.start).toBeGreaterThanOrEqual(at);
          expect(token.end).toBeGreaterThanOrEqual(token.start);
          expect(token.end).toBeLessThanOrEqual(text.length);
          at = token.start;
        }
      }),
      { numRuns: 300 },
    );
  });
});
