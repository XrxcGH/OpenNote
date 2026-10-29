// A line of text about an element, for inserting into a page.
import { t } from '../../../strings/t';
import { formatNumber } from '../calculator';
import type { Element } from './data';

export const kelvinToCelsius = (kelvin: number): number => Math.round((kelvin - 273.15) * 100) / 100;

/** "Fe (Iron), atomic number 26, atomic mass 55.845 u, density 7.874 g/cm³, melts at 1811 K, boils at 3134 K". */
export function elementSummary(element: Element): string {
  const parts = [
    t('study.reference.summary.head', { symbol: element.symbol, name: element.name }),
    t('study.reference.summary.number', { number: element.number }),
    t('study.reference.summary.mass', { mass: formatNumber(element.mass) }),
  ];
  if (element.density !== null)
    parts.push(t('study.reference.summary.density', { value: formatNumber(element.density) }));
  if (element.melting !== null)
    parts.push(t('study.reference.summary.melting', { value: formatNumber(element.melting) }));
  if (element.boiling !== null)
    parts.push(t('study.reference.summary.boiling', { value: formatNumber(element.boiling) }));
  if (element.electronegativity !== null) {
    parts.push(t('study.reference.summary.electronegativity', { value: formatNumber(element.electronegativity) }));
  }
  if (element.oxidation !== '') parts.push(t('study.reference.summary.oxidation', { value: element.oxidation }));
  return parts.join(', ');
}
