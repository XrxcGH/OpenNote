// Turns an engine's error into a sentence: a rule on a named quantity, or a problem with the inputs.
import { kitModPhys } from '../../../../strings/en/kitModPhys';
import './strings';
import { t } from '../../../../strings/t';
import { PhysicsError } from './errors';

type Quantity = keyof typeof kitModPhys.q;

const isQuantity = (name: string): name is Quantity => Object.hasOwn(kitModPhys.q, name);

export function describeError(error: unknown): string {
  if (!(error instanceof PhysicsError)) return t('kitModPhys.errors.unexpected');
  if (error.problem) return t(`kitModPhys.errors.${error.problem}`);
  const what = isQuantity(error.quantity) ? t(`kitModPhys.q.${error.quantity}`) : error.quantity;
  return t(`kitModPhys.rules.${error.rule!}`, { what });
}
