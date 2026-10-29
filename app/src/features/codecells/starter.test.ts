// The example programs come out of the message formatter whole: a brace in them would be read as a placeholder.
import { describe, expect, it } from 'vitest';
import { t } from '../../strings/t';

describe('the code cell starters', () => {
  it.each(['python', 'javascript'] as const)('%s starter has no gaps from the formatter', (language) => {
    const text = t(`codeCells.starter.${language}`);
    expect(text).not.toContain('undefined');
    expect(text).toContain(language === 'python' ? 'print(step, x)' : 'console.log(step');
  });
});
