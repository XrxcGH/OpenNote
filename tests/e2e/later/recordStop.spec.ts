// Record and stop in the real app (A4-50): the Record button starts the recorder, the indicator shows in the title
// bar and the recording bar in the page, and Stop turns the block into a player with the length of what was
// recorded. A machine with no microphone says so in the Options panel, and the spec then skips with that reason, as
// a hosted runner without an audio device does. The spec never plays the recording through speakers.

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { launchApp, skipReason } from '../harness.ts';
import type { AppSession } from '../harness.ts';
import { openPage } from './steps.ts';

const GROUP = '//*[@role="group"][@aria-label="Recording"]';

describe('recording in the real app', { skip: skipReason() }, () => {
  let session: AppSession;

  before(async () => {
    session = await launchApp();
    await openPage(session.browser);
  });

  after(async () => {
    await session?.close();
  });

  it('records, shows the indicator, and stops into a player', async (context) => {
    const { browser } = session;
    const options = browser.$(`${GROUP}//button[normalize-space(.)="Options"]`);
    await options.waitForExist({ timeout: 20_000 });
    await options.click();
    // The panel lists the microphones once the app has looked for them.
    await browser.$('//*[normalize-space(.)="Microphone"]').waitForExist({ timeout: 10_000 });
    await browser.pause(1_500);
    if ((await browser.$$('//*[contains(normalize-space(.), "No microphone was found")]').length) > 0) {
      context.skip('This machine has no microphone.');
      return;
    }
    await browser.keys('Escape');

    await browser.$(`${GROUP}//button[normalize-space(.)="Record"]`).click();
    const indicator = browser.$('[data-testid="recording-indicator"]');
    await indicator.waitForExist({ timeout: 20_000, timeoutMsg: 'The recording indicator never showed.' });
    assert.match(
      String(await indicator.getAttribute('aria-label')),
      /^Recording \d+:\d\d\. Open the recording controls\.$/,
    );
    await browser.$('[data-testid="recording-bar"]').waitForExist({ timeout: 10_000 });
    await browser.pause(2_000);
    await browser.$(`${GROUP}//button[normalize-space(.)="Stop"]`).click();
    await indicator.waitForExist({ reverse: true, timeout: 20_000 });
    const block = browser.$('//*[@role="group"][starts-with(@aria-label, "Recording, ")]');
    await block.waitForExist({ timeout: 30_000, timeoutMsg: 'The recording never became a player.' });
    assert.match(String(await block.getAttribute('aria-label')), /^Recording, \d+:\d\d$/);
    await block.$('button=Play').waitForExist({ timeout: 5_000 });
  });
});
