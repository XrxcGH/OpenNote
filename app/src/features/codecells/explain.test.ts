import { describe, expect, it } from 'vitest';
import { t } from '../../strings/t';
import { explainSandboxError } from './explain';

describe('explainSandboxError', () => {
  it('says the sandbox blocks files after a bare OSError 44', () => {
    const text = 'Traceback (most recent call last):\n  File "<stdin>", line 1, in <module>\nOSError: 44\n';
    expect(explainSandboxError(text)).toContain(`OSError: 44\n${t('codeCells.blocked.files')}`);
  });

  it('says the sandbox has no network after a failed import', () => {
    const text = 'Traceback (most recent call last):\nImportError: no module named urllib\n';
    expect(explainSandboxError(text)).toContain(`urllib\n${t('codeCells.blocked.modules')}`);
  });

  it('leaves other errors as they are', () => {
    expect(explainSandboxError('ValueError: bad\n')).toBe('ValueError: bad\n');
  });
});
