// The names a screen reader says for each character the calibration page and the Math and science section ask for,
// so a box is "capital Q, 2 of 3" and not a lone punctuation mark that many readers skip.
import { t } from '../../../../strings/t';
import type { MessageKey } from '../../../../strings/t';

const NAMED: Record<string, MessageKey> = {
  '.': 'myHand.names.period',
  ',': 'myHand.names.comma',
  ';': 'myHand.names.semicolon',
  ':': 'myHand.names.colon',
  '!': 'myHand.names.exclamation',
  '?': 'myHand.names.question',
  "'": 'myHand.names.apostrophe',
  '"': 'myHand.names.quote',
  '‘': 'myHand.names.leftSingle',
  '’': 'myHand.names.rightSingle',
  '“': 'myHand.names.leftDouble',
  '”': 'myHand.names.rightDouble',
  '-': 'myHand.names.hyphen',
  '–': 'myHand.names.enDash',
  '—': 'myHand.names.emDash',
  '(': 'myHand.names.leftParen',
  ')': 'myHand.names.rightParen',
  '[': 'myHand.names.leftBracket',
  ']': 'myHand.names.rightBracket',
  '{': 'myHand.names.leftBrace',
  '}': 'myHand.names.rightBrace',
  '/': 'myHand.names.slash',
  '\\': 'myHand.names.backslash',
  '|': 'myHand.names.bar',
  '@': 'myHand.names.at',
  '#': 'myHand.names.hash',
  $: 'myHand.names.dollar',
  '%': 'myHand.names.percent',
  '^': 'myHand.names.caret',
  '&': 'myHand.names.ampersand',
  '*': 'myHand.names.asterisk',
  _: 'myHand.names.underscore',
  '+': 'myHand.names.plus',
  '=': 'myHand.names.equals',
  '<': 'myHand.names.less',
  '>': 'myHand.names.greater',
  '~': 'myHand.names.tilde',
  '`': 'myHand.names.backtick',
  '€': 'myHand.names.euro',
  '£': 'myHand.names.pound',
  '°': 'myHand.names.degree',
  '•': 'myHand.names.bullet',
  '…': 'myHand.names.ellipsis',
  '∫': 'myHand.names.integral',
  '∑': 'myHand.names.sum',
  '∏': 'myHand.names.product',
  '√': 'myHand.names.root',
  '∞': 'myHand.names.infinity',
  '≤': 'myHand.names.lessEqual',
  '≥': 'myHand.names.greaterEqual',
  '≠': 'myHand.names.notEqual',
  '≈': 'myHand.names.approx',
  '±': 'myHand.names.plusMinus',
  '×': 'myHand.names.times',
  '÷': 'myHand.names.divide',
  '·': 'myHand.names.dot',
  '→': 'myHand.names.arrowRight',
  '←': 'myHand.names.arrowLeft',
  '↔': 'myHand.names.arrowBoth',
  '⇒': 'myHand.names.implies',
  '⇔': 'myHand.names.iff',
  '∂': 'myHand.names.partial',
  '∇': 'myHand.names.nabla',
  '′': 'myHand.names.prime',
  '∈': 'myHand.names.element',
  '⃗': 'myHand.names.vector',
  ˆ: 'myHand.names.hat',
  '˙': 'myHand.names.dotAbove',
};

const GREEK = [
  ...'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu'.split(' '),
  ...'nu xi omicron pi rho final-sigma sigma tau upsilon phi chi psi omega'.split(' '),
];

/** What a screen reader says for a character. */
export function charName(char: string): string {
  const named = NAMED[char];
  if (named) return t(named);
  if (/^[a-z]$/.test(char)) return t('myHand.names.small', { letter: char });
  if (/^[A-Z]$/.test(char)) return t('myHand.names.capital', { letter: char });
  if (/^[0-9]$/.test(char)) return t('myHand.names.digit', { digit: char });
  const code = char.codePointAt(0) ?? 0;
  if (code >= 0x3b1 && code <= 0x3c9) return t('myHand.names.greek', { name: GREEK[code - 0x3b1] });
  if (code >= 0x391 && code <= 0x3a9) return t('myHand.names.greekCapital', { name: GREEK[code - 0x391] });
  return t('myHand.names.symbol', { symbol: char });
}
