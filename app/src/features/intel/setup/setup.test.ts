import { beforeEach, describe, expect, it } from 'vitest';
import type { SetupContext, SetupDraft } from '../../../registries';
import { resetStores } from '../../../state/store';
import { isOn } from '../choices';
import { refreshModels } from '../models/store';
import { installTestHost } from '../testing';
import type { TestHost } from '../testing';
import { draftForMode, featuresOn, NOT_NOW, RECOMMENDED_SPEECH_MODEL, speechModelToDownload } from './choices';
import type { SmartDraft } from './choices';
import { commitSmartFeatures } from './commit';

const ctx = {} as SetupContext;
let host: TestHost;
beforeEach(() => {
  resetStores();
  host = installTestHost();
});

describe('the choices', () => {
  it('starts with everything off', () => {
    expect(featuresOn(NOT_NOW)).toEqual([]);
    expect(speechModelToDownload(NOT_NOW)).toBeNull();
  });

  it('turns on four features and offers the balanced model when Recommended is chosen', () => {
    const draft = draftForMode('recommended', NOT_NOW);
    expect(featuresOn(draft)).toEqual(['ocr', 'handwriting', 'summaries', 'transcription']);
    expect(speechModelToDownload(draft)).toBe(RECOMMENDED_SPEECH_MODEL);
  });

  it('lets Custom start from what Recommended chose', () => {
    const custom = draftForMode('custom', draftForMode('recommended', NOT_NOW));
    expect(custom.mode).toBe('custom');
    expect(custom.features.ocr).toBe(true);
  });

  it('downloads no model when transcription is off', () => {
    const custom: SmartDraft = { mode: 'custom', features: { ocr: true }, speechModel: 'speech-tiny-en' };
    expect(speechModelToDownload(custom)).toBeNull();
  });

  it('forgets everything when Not now is chosen again', () => {
    expect(draftForMode('notNow', draftForMode('recommended', NOT_NOW))).toEqual(NOT_NOW);
  });
});

describe('finishing the step', () => {
  it('changes nothing for Not now', async () => {
    await commitSmartFeatures(ctx, { smart: NOT_NOW } as SetupDraft);
    expect(host.saved).toEqual([]);
    expect(host.transport.ext.calls).toEqual([]);
  });

  it('turns on the chosen features and starts the chosen model', async () => {
    await commitSmartFeatures(ctx, { smart: draftForMode('recommended', NOT_NOW) } as SetupDraft);
    expect(isOn('ocr') && isOn('handwriting') && isOn('summaries') && isOn('transcription')).toBe(true);
    expect(isOn('readAloud')).toBe(false);
    const list = await refreshModels();
    expect(list?.models.find((model) => model.id === RECOMMENDED_SPEECH_MODEL)?.state).toBe('downloading');
    expect(host.transport.ext.files.get('speech-model.txt')).toBe(RECOMMENDED_SPEECH_MODEL);
  });

  it('does nothing when the step was never shown', async () => {
    await commitSmartFeatures(ctx, {});
    expect(host.saved).toEqual([]);
  });
});
