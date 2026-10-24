import { describe, expect, it } from 'vitest';
import { DE_DE, EN_US, FR_FR, type Locale } from './locale';
import { quickMath } from './quickMath';

function run(text: string, locale: Locale = EN_US): string | null {
  const found = quickMath(text, locale);
  if (!found) return null;
  return found.kind === 'result' ? found.text : `error:${found.error}`;
}

describe('quick math results', () => {
  it.each([
    ['2.5*9.81=', '24.525'],
    ['2^10=', '1024'],
    ['sqrt(2)=', '1.414213562'],
    ['200*15%=', '30'],
    ['1/3=', '0.3333333333'],
    ['10 + 20 =', '30'],
    ['(1+2)*3=', '9'],
    ['-2^2=', '-4'],
    ['5×4=', '20'],
    ['9÷3=', '3'],
    ['√16=', '4'],
    ['sin(0)=', '0'],
    ['log10(1000)=', '3'],
    ['ln(1)+exp(0)=', '1'],
    ['pi*2=', '6.283185307'],
    ['max(1,2,3)=', '3'],
    ['round(2.5)=', '3'],
    ['0.1+0.2=', '0.3'],
    ['123456*1000=', '123456000'],
    ['1e8*1e8=', '1E+16'],
    ['1.23456789*1e16=', '1.23456789E+16'],
  ])('%s gives %s', (text, expected) => {
    expect(run(text)).toBe(expected);
  });

  it('finds the calculation after other text, from the left', () => {
    expect(run('Cost: 12*3=')).toBe('36');
    expect(run('x = 3+4=')).toBe('7');
    expect(run('total of 2+2 and 3*3=')).toBe('9');
    expect(quickMath('Cost: 12*3=', EN_US)).toMatchObject({ expression: '12*3', start: 6 });
  });

  it('reads and writes numbers in the region', () => {
    expect(run('2,5*9,81=', DE_DE)).toBe('24,525');
    expect(run('1/3=', FR_FR)).toBe('0,3333333333');
    expect(run('max(1;2,5)=', DE_DE)).toBe('2,5');
    expect(run('1,5+2,5=', DE_DE)).toBe('4');
  });
});

describe('text that must not trigger', () => {
  it.each([
    'a=',
    '2=',
    '=',
    ' =',
    'x=',
    'a1+2=',
    'name[1]=',
    '1=1=',
    '3<4=',
    'TRUE=',
    '"a"+"b"=',
    'https://example.com/?q=',
    'note(3)=',
    'foo bar =',
    '1,000+2=',
    '2==',
    'no equals sign 1+1',
    '',
  ])('%j does nothing', (text) => {
    expect(run(text)).toBeNull();
  });

  it('only reads the text before the equals sign', () => {
    expect(run('1+1')).toBeNull();
    expect(run('1+1=2')).toBeNull();
  });
});

describe('quick math errors', () => {
  it.each([
    ['1/0=', 'error:DIV0'],
    ['sqrt(-1)=', 'error:NUM'],
    ['ln(0)=', 'error:NUM'],
    ['0^-1=', 'error:DIV0'],
  ])('%s gives %s', (text, expected) => {
    expect(run(text)).toBe(expected);
  });
});

describe('quick math cost', () => {
  it('scans a long line of prose quickly, since it runs when Space follows an equals sign', () => {
    const prose =
      'Meeting notes for the quarter were reviewed by the whole team, who agreed that costs and plans matter. '.repeat(
        3,
      );
    const started = performance.now();
    for (let i = 0; i < 50; i++) expect(quickMath(`${prose}what is 6*7=`, EN_US)).toMatchObject({ text: '42' });
    expect(performance.now() - started).toBeLessThan(500);
  });
});
