import { describe, expect, it } from 'vitest';
import { capitalizeFor, parseSpeech, startsSentence } from './parse';
import type { Step } from './parse';

const text = (value: string): Step => ({ kind: 'text', text: value });

describe('spoken punctuation', () => {
  it.each([
    ['hello comma how are you question mark', 'hello, how are you?'],
    ['it works period', 'it works.'],
    ['it works full stop', 'it works.'],
    ['wait exclamation point', 'wait!'],
    ['wait exclamation mark', 'wait!'],
    ['three items colon one semicolon two', 'three items: one; two'],
    ['and so on ellipsis', 'and so on…'],
    ['he said open quote hello close quote', 'he said “hello”'],
    ['see open paren page two close paren', 'see (page two)'],
    ['a well hyphen known fact', 'a well-known fact'],
    ['this dash that', 'this — that'],
    ['mail me at sign home', 'mail me@home'],
  ])('turns "%s" into "%s"', (spoken, written) => {
    expect(parseSpeech(spoken)).toEqual([text(written)]);
  });

  it('drops the marks the model wrote around a spoken mark', () => {
    expect(parseSpeech('Hello, comma, how are you? Question mark.')).toEqual([text('Hello, how are you?')]);
    expect(parseSpeech('Fine. Period.')).toEqual([text('Fine.')]);
  });

  it('leaves ordinary text alone', () => {
    expect(parseSpeech('Meet me at noon, please.')).toEqual([text('Meet me at noon, please.')]);
    expect(parseSpeech('')).toEqual([]);
  });
});

describe('spoken commands', () => {
  it('breaks lines and paragraphs between pieces of text', () => {
    expect(parseSpeech('First line. New line. Second line. New paragraph. Third.')).toEqual([
      text('First line.'),
      { kind: 'newline' },
      text('Second line.'),
      { kind: 'paragraph' },
      text('Third.'),
    ]);
  });

  it('takes a command that is the whole utterance', () => {
    expect(parseSpeech('New line.')).toEqual([{ kind: 'newline' }]);
    expect(parseSpeech('undo that')).toEqual([{ kind: 'undo' }]);
    expect(parseSpeech('Scratch that.')).toEqual([{ kind: 'undo' }]);
    expect(parseSpeech('Delete that')).toEqual([{ kind: 'undo' }]);
    expect(parseSpeech('Stop dictation.')).toEqual([{ kind: 'stop' }]);
    expect(parseSpeech('stop listening')).toEqual([{ kind: 'stop' }]);
  });

  it('keeps a command word inside a sentence as text', () => {
    expect(parseSpeech('I wrote a new line of code today')).toEqual([text('I wrote a new line of code today')]);
    expect(parseSpeech('please undo that mistake in the draft')).toEqual([
      text('please undo that mistake in the draft'),
    ]);
  });
});

describe('capitals', () => {
  it('starts a sentence with a capital after an end mark or at the start', () => {
    expect(startsSentence('')).toBe(true);
    expect(startsSentence('One. ')).toBe(true);
    expect(startsSentence('One, ')).toBe(false);
    expect(startsSentence('He said “Yes.” ')).toBe(true);
    expect(startsSentence('Line one\n')).toBe(true);
  });

  it('capitalizes only where a sentence starts', () => {
    expect(capitalizeFor('', 'hello there')).toBe('Hello there');
    expect(capitalizeFor('Hello ', 'there again')).toBe('there again');
    expect(capitalizeFor('Done. ', '“quote” here')).toBe('“Quote” here');
  });
});
