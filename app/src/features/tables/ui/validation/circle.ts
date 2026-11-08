// What a circled cell carries: a data attribute the stylesheet draws as an ellipse (circle.css), and aria-invalid
// with a title that says why, so the circle is never the only sign.
import { sentenceOf } from '../../sheet/validation';
import type { Invalid } from '../../sheet/validation';
import { t } from '../../../../strings/t';
import './circle.css';

export function circleAttributes(invalid: Invalid): { 'data-invalid': string; 'aria-invalid': 'true'; title: string } {
  return {
    'data-invalid': invalid.verdict.reason,
    'aria-invalid': 'true',
    title: t('sheetValidation.circleLabel', { text: sentenceOf(invalid.verdict) }),
  };
}
