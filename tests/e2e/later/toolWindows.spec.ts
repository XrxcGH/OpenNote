// The tool windows in the real app (A4-50): the calculator answers, a timer runs, Upcoming opens, and each closes
// with Escape. They are windows of the app, so they work with the real shell around them.

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { launchApp, skipReason } from '../harness.ts';
import type { AppSession } from '../harness.ts';
import { runCommand } from './steps.ts';

describe('the tool windows in the real app', { skip: skipReason() }, () => {
  let session: AppSession;

  before(async () => {
    session = await launchApp();
    await session.browser.$('[role="tree"][aria-label="Notebooks"]').waitForExist({ timeout: 20_000 });
  });

  after(async () => {
    await session?.close();
  });

  it('answers in the calculator', async () => {
    const { browser } = session;
    await runCommand(browser, 'calculator', 'Open calculator');
    const expression = browser.$('//label[normalize-space(.)="Expression"]//input');
    await expression.waitForExist({ timeout: 10_000 });
    await expression.setValue('2pi * 3');
    await browser.keys('Enter');
    const result = browser.$('#calc-result');
    await browser.waitUntil(async () => (await result.getText()) === '= 18.8495559215', {
      timeout: 5_000,
      timeoutMsg: 'The calculator gave no answer.',
    });
    await expression.setValue('1 / 0');
    await browser.keys('Enter');
    await browser.waitUntil(async () => (await result.getText()) === 'Dividing by zero has no answer.', {
      timeout: 5_000,
    });
    await browser.keys('Escape');
    await expression.waitForExist({ reverse: true, timeout: 5_000 });
  });

  it('runs a timer', async () => {
    const { browser } = session;
    await runCommand(browser, 'timers', 'Open timers');
    await browser.$('button=Add timer').waitForExist({ timeout: 10_000 });
    await browser.$('button=Add timer').click();
    await browser.$('button=Start').click();
    const running = browser.$('//*[normalize-space(.)="Running"]');
    await running.waitForExist({ timeout: 5_000 });
    assert.match(await browser.$('[role="timer"]').getText(), /^[45]:\d\d$/);
    await browser.$('button=Pause').click();
    await browser.$('//*[normalize-space(.)="Paused"]').waitForExist({ timeout: 5_000 });
  });

  it('opens Upcoming', async () => {
    const { browser } = session;
    await runCommand(browser, 'upcoming', 'Open upcoming');
    await browser
      .$('//*[@role="dialog"][@aria-label="Upcoming"] | //dialog[@open][.//*[normalize-space(.)="Upcoming"]]')
      .waitForExist({ timeout: 10_000 });
  });
});
