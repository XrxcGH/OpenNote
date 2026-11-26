import { describe, expect, it } from 'vitest';
import { PageServiceError } from '../../services/pages/types';
import type { PageErrorCode } from '../../services/pages/types';
import { openFailureOf, openFailureText } from './openFailure';

const failed = (code: string) => new PageServiceError(code as PageErrorCode, 'x');

describe('why a page could not open', () => {
  it('names a damaged page file and offers the saved version', () => {
    const failure = openFailureOf(failed('damaged'));
    expect(failure).toBe('damaged');
    expect(openFailureText(failure)).toMatch(/page\.json\) is damaged/);
    expect(openFailureText(failure)).toMatch(/last saved version/);
  });

  it('says a page from a newer OpenNote is left unchanged', () => {
    const failure = openFailureOf(failed('newerFormat'));
    expect(failure).toBe('newerFormat');
    expect(openFailureText(failure)).toMatch(/newer version of OpenNote/);
    expect(openFailureText(failure)).toMatch(/left unchanged/);
  });

  it('keeps the general message for anything else', () => {
    expect(openFailureText(openFailureOf(new Error('x')))).toMatch(/couldn’t be opened/);
    expect(openFailureOf(null)).toBe('other');
  });
});
