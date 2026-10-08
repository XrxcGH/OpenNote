import { beforeEach, describe, expect, it } from 'vitest';
import { installTestHost } from '../testing';
import type { TestHost } from '../testing';
import { previewVocabulary } from './apply';
import { vocabularyFile } from './list';
import { loadVocabulary, saveVocabulary } from './store';

let host: TestHost;
beforeEach(() => {
  host = installTestHost();
});

describe('the vocabulary store', () => {
  it('keeps a list for each notebook on this device', async () => {
    await saveVocabulary('nb1', 'ATP\n');
    expect(host.transport.ext.files.get(vocabularyFile('nb1'))).toBe('ATP\n');
    expect(await loadVocabulary('nb1')).toBe('ATP\n');
    expect(await loadVocabulary('nb2')).toBe('');
  });
});

describe('the preview of a fix', () => {
  it('lists each change without changing anything', async () => {
    await saveVocabulary('nb1', 'Calvin cycle | calvin psyche\n');
    const preview = await previewVocabulary('nb1', 'The calvin psyche makes sugar.');
    expect(preview?.text).toBe('The Calvin cycle makes sugar.');
    expect(preview?.changes.map((change) => change.from)).toEqual(['calvin psyche']);
  });

  it('has nothing to preview without a list', async () => {
    expect(await previewVocabulary('nb1', 'Anything.')).toBeNull();
  });
});
