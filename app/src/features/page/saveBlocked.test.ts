import { describe, expect, it } from 'vitest';
import { saveBlockedText } from './saveBlocked';

describe('a page that cannot save until its file is fixed', () => {
  it('says the file is read-only and how to fix it', () => {
    const text = saveBlockedText({ reason: 'readOnlyFile', action: 'makeEditable' });
    expect(text).toMatch(/isn’t saving/);
    expect(text).toMatch(/read-only/);
    expect(text).toMatch(/Clear Read-only/);
  });

  it('says a cloud file must be downloaded', () => {
    expect(saveBlockedText({ reason: 'cloudPlaceholder', action: null })).toMatch(/Download it/);
  });

  it('says nothing for other reasons or none', () => {
    expect(saveBlockedText({ reason: 'stillClosing', action: null })).toBeNull();
    expect(saveBlockedText(null)).toBeNull();
  });
});
