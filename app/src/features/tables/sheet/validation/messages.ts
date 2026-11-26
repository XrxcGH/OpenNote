// The words of an alert: the rule's own title and text, or the plain default for the reason.
import { t } from '../../../../strings/t';
import type { Message, Verdict } from './types';

type Bad = Extract<Verdict, { ok: false }>;

export function messageOf(verdict: Bad): Message {
  const own = verdict.message;
  return {
    title: own !== null && own.title !== '' ? own.title : t('sheetValidation.defaultTitle'),
    text: own !== null && own.text !== '' ? own.text : t(`sheetValidation.reason.${verdict.reason}`),
  };
}

/** The sentence a screen reader and the alert show: refused, asks first, or only a note. */
export function sentenceOf(verdict: Bad): string {
  const { title, text } = messageOf(verdict);
  const key = verdict.alert === 'stop' ? 'refused' : verdict.alert === 'warning' ? 'warned' : 'noted';
  return t(`sheetValidation.${key}`, { title, text });
}
