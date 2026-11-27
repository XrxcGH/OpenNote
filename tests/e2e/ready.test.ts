// The start of a launched app, as launchApp waits for it (tests/e2e/ready.ts). The page goes through the states the
// real window went through in the failed nightly: no tree before React renders, then a busy tree while the core
// starts and makes the sample library, then the rows.

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { notesLoaded, waitForNotes } from './ready.ts';
import type { Waiter } from './ready.ts';

type Stage = 'blank' | 'busy' | 'rows';

interface FakeNode {
  readonly attributes: Record<string, string>;
  hasAttribute(name: string): boolean;
}

/** An element with these attributes. */
function element(attributes: Record<string, string>): FakeNode {
  return { attributes, hasAttribute: (name) => name in attributes };
}

/** Whether `node` matches a selector of attribute tests only, such as `[role="tree"][aria-label="Notebooks"]`. */
function matches(node: FakeNode, selector: string): boolean {
  const tests = [...selector.matchAll(/\[([\w-]+)="([^"]*)"\]/g)];
  assert.equal(tests.map((test) => test[0]).join(''), selector, 'the fake page reads attribute tests only');
  return tests.every(([, name, value]) => node.attributes[name] === value);
}

/** Puts a page at `stage` in place of the window's document. */
function page(stage: Stage): void {
  const nodes: FakeNode[] = [element({ role: 'navigation' })];
  if (stage === 'busy') nodes.push(element({ role: 'tree', 'aria-label': 'Notebooks', 'aria-busy': 'true' }));
  if (stage === 'rows') {
    nodes.push(element({ role: 'tree', 'aria-label': 'Notebooks' }), element({ role: 'treeitem' }));
  }
  const document = { querySelector: (selector: string) => nodes.find((node) => matches(node, selector)) ?? null };
  Object.assign(globalThis, { document });
}

/**
 * A browser whose page moves to the next stage after each look, as the real one did between polls. Its waitUntil
 * gives up after `polls` looks, as WebdriverIO's does after its timeout.
 */
function browserThrough(stages: Stage[], polls = 100): Waiter & { looks: number } {
  const browser = {
    looks: 0,
    async execute(script: () => boolean) {
      page(stages[Math.min(browser.looks, stages.length - 1)] ?? 'blank');
      browser.looks += 1;
      return script();
    },
    async waitUntil(condition: () => Promise<boolean>, options: { timeout: number; timeoutMsg: string }) {
      for (let look = 0; look < polls; look += 1) if (await condition()) return true;
      throw new Error(options.timeoutMsg);
    },
  };
  return browser;
}

afterEach(() => {
  delete (globalThis as { document?: Document }).document;
});

describe('a launched app is ready', () => {
  it('not before React renders the tree', () => {
    page('blank');
    assert.equal(notesLoaded(), false);
  });

  it('not while the tree is busy with its first load', () => {
    page('busy');
    assert.equal(notesLoaded(), false);
  });

  it('once the tree shows its rows', () => {
    page('rows');
    assert.equal(notesLoaded(), true);
  });

  it('only after the slow start of the failed nightly has passed', async () => {
    // A blank window, then a tree busy for many polls while the core made the sample library.
    const stages: Stage[] = ['blank', 'blank', ...Array<Stage>(40).fill('busy'), 'rows'];
    const browser = browserThrough(stages);
    await waitForNotes(browser);
    assert.equal(browser.looks, stages.length, 'it waited for the rows, and looked no further');
  });

  it('says what never came when the start stalls', async () => {
    await assert.rejects(waitForNotes(browserThrough(['busy'], 5)), /never loaded its notebooks within 60 s/);
  });
});
