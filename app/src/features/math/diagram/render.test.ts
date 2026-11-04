// The diagram window says what is wrong with the text in plain words, never with the parser's list of tokens.
import { describe, expect, it } from 'vitest';
import { plainProblem } from './render';

describe('a diagram text problem', () => {
  it('names the line and leaves out the parser tokens', () => {
    const raw = "Parse error on line 2:\n...-->\n-----^\nExpecting 'SEMI', 'NEWLINE', 'SPACE', got 'EOF'";
    expect(plainProblem(raw)).toBe('Check line 2 for a missing word, arrow, or bracket.');
  });

  it('gives general advice when the message has no line', () => {
    expect(plainProblem('No diagram type detected for text: hello')).toBe(
      'Check the first line and each arrow or bracket.',
    );
  });
});
