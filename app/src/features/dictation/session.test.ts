// Dictation's session: what each finished phrase does to the sink.
import { describe, expect, it } from 'vitest';
import { applySpeech } from './session';
import type { DictationSink } from './session';

function sink(before = ''): DictationSink & { log: string[] } {
  const log: string[] = [];
  return {
    log,
    before: () => before,
    insert: (text) => {
      log.push(`insert:${text}`);
      before += `${text} `;
    },
    newline: () => log.push('newline'),
    paragraph: () => log.push('paragraph'),
    undoLast: () => {
      log.push('undo');
      return true;
    },
  };
}

describe('applySpeech', () => {
  it('types the words with their marks, capitalizing at the start of a sentence', () => {
    const target = sink();
    applySpeech(target, 'hello comma world period', () => undefined);
    expect(target.log).toEqual(['insert:Hello, world.']);
  });

  it('does not capitalize in the middle of a sentence', () => {
    const target = sink('We agreed to ');
    applySpeech(target, 'meet at noon', () => undefined);
    expect(target.log).toEqual(['insert:meet at noon']);
  });

  it('runs commands in order with the text around them', () => {
    const target = sink();
    applySpeech(target, 'First. New line. Second. New paragraph. Third. Scratch that.', () => undefined);
    expect(target.log).toEqual(['insert:First.', 'newline', 'insert:Second.', 'paragraph', 'insert:Third.', 'undo']);
  });

  it('stops listening on the stop command, without typing it', () => {
    const target = sink();
    let stopped = 0;
    applySpeech(target, 'Stop dictation.', () => (stopped += 1));
    expect(stopped).toBe(1);
    expect(target.log).toEqual([]);
  });
});
