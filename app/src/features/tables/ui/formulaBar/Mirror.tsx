// The colored copy of the entry's text that shows through the clear text area: functions, names, text, numbers,
// errors, and each reference in its reference color, with the bracket at the caret and its match marked.
import type { ReactNode } from 'react';
import { coloredRefs } from './refs';
import { matchingBracket, scanFormula } from './scan';
import type { Token, TokenKind } from './scan';
import styles from './formulaBar.module.css';

const CLASS: Partial<Record<TokenKind, string | undefined>> = {
  function: styles.function,
  string: styles.string,
  number: styles.number,
  bool: styles.bool,
  error: styles.error,
  name: styles.name,
  struct: styles.name,
};

/** A zero-width space at the end, so a last empty line keeps its height as the text area's does. */
const END = String.fromCharCode(0x200b);

const REF_CLASS = [styles.ref1, styles.ref2, styles.ref3, styles.ref4, styles.ref5, styles.ref6];

export function Mirror({ text, caret }: { text: string; caret: number }) {
  if (!text.startsWith('=')) return <div className={styles.mirror} aria-hidden="true">{`${text}${END}`}</div>;
  const tokens = scanFormula(text);
  const colors = new Map<Token, number>(coloredRefs(tokens).map((r) => [r.token, r.color]));
  const pair = matchingBracket(tokens, caret) ?? matchingBracket(tokens, caret - 1);
  const parts: ReactNode[] = tokens.map((token) => {
    const color = colors.get(token);
    const className =
      color !== undefined
        ? REF_CLASS[color - 1]
        : pair && (token.start === pair[0] || token.start === pair[1])
          ? styles.bracket
          : CLASS[token.kind];
    return className ? (
      <span key={token.start} className={className} data-token={token.kind} data-ref-color={color}>
        {token.text}
      </span>
    ) : (
      token.text
    );
  });
  return (
    <div className={styles.mirror} aria-hidden="true">
      {parts}
      {END}
    </div>
  );
}
