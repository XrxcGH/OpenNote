// The linear regression tool. A model is written as a formula over the data's columns. The tool fits it and
// reports coefficients, ANOVA, diagnostics, robust standard errors, and intervals for new cases. Other views
// compare nested models, probe moderation, test mediation, and fit a random intercept.
import type { Outcome, ToolSpec, Values } from '../kit/spec';
import { fitOutcome } from './fitview';
import { compareOutcome, mediationOutcome, mixedOutcome, moderationOutcome } from './views';

const TWO_PREDICTORS = 'x1,x2,y\n1,2,3.1\n2,1,3.9\n3,4,6.8\n4,3,7.2\n5,6,10.1\n6,5,10.8\n7,8,13.9\n8,7,14.2\n9,10,17.1\n10,9,17.8';
const GROUPS =
  'hours,method,score,class\n2,lecture,61,A\n4,lecture,66,A\n6,lecture,70,B\n8,lecture,77,B\n3,studio,68,C\n' +
  '5,studio,75,C\n7,studio,83,D\n9,studio,90,D\n1,lecture,58,A\n10,studio,94,D\n6,studio,79,C\n5,lecture,69,B';
const MODERATION =
  'support,stress,wellbeing\n1,2,5.1\n2,3,5.0\n3,5,4.2\n4,2,6.3\n5,6,4.9\n2,6,3.1\n3,1,6.0\n4,4,5.6\n5,3,6.8\n' +
  '1,5,2.9\n2,4,3.9\n3,3,5.2\n4,6,4.8\n5,1,7.7\n1,1,4.8\n2,2,5.1\n3,6,3.6\n4,5,5.1\n5,5,6.0\n1,3,3.9';
const MEDIATION =
  'practice,confidence,score\n1,2.1,52\n2,2.8,55\n3,3.0,61\n4,3.9,60\n5,4.1,66\n6,4.8,70\n7,5.2,69\n8,5.9,75\n' +
  '9,6.1,78\n10,7.0,80\n2,3.1,58\n4,3.2,57\n6,5.0,72\n8,6.2,77\n10,6.4,79';
const NESTED =
  'school,hours,score\nA,1,62\nA,3,66\nA,5,71\nA,7,75\nB,2,70\nB,4,74\nB,6,77\nB,8,83\nC,1,55\nC,3,60\nC,5,63\n' +
  'C,7,69\nD,2,66\nD,4,69\nD,6,75\nD,8,79';

const is = (...modes: string[]) => (v: Values) => modes.includes(String(v.analysis));

function run(values: Values): Outcome {
  if (values.analysis === 'compare') return compareOutcome(values);
  if (values.analysis === 'moderation') return moderationOutcome(values);
  if (values.analysis === 'mediation') return mediationOutcome(values);
  if (values.analysis === 'mixed') return mixedOutcome(values);
  return fitOutcome(values);
}

export const regressionSpec: ToolSpec = {
  fields: [
    { id: 'data', type: 'data', first: TWO_PREDICTORS, rows: 6 },
    { id: 'analysis', type: 'choice', options: ['fit', 'compare', 'moderation', 'mediation', 'mixed'], first: 'fit' },
    { id: 'formula', type: 'text', first: 'y ~ x1 + x2', rows: 2, when: is('fit', 'compare', 'mixed') },
    { id: 'reduced', type: 'text', first: 'y ~ x1', rows: 2, when: is('compare') },
    { id: 'coding', type: 'choice', options: ['reference', 'effect'], first: 'reference', when: is('fit', 'compare', 'mixed') },
    { id: 'center', type: 'choice', options: ['none', 'mean'], first: 'none', when: is('fit', 'compare', 'mixed', 'moderation') },
    { id: 'se', type: 'choice', options: ['classical', 'hc0', 'hc1', 'hc2', 'hc3', 'cluster'], first: 'classical', when: is('fit') },
    { id: 'cluster', type: 'column', data: 'data', first: '', optional: true, when: (v) => is('fit')(v) && v.se === 'cluster' },
    { id: 'predict', type: 'text', first: '', rows: 2, when: is('fit') },
    { id: 'outcome', type: 'column', data: 'data', first: 'y', when: is('moderation', 'mediation') },
    { id: 'x', type: 'column', data: 'data', first: 'x1', when: is('moderation', 'mediation') },
    { id: 'moderator', type: 'column', data: 'data', first: 'x2', when: is('moderation') },
    { id: 'mediator', type: 'column', data: 'data', first: 'x2', when: is('mediation') },
    { id: 'covariates', type: 'column', data: 'data', first: '', optional: true, multi: true, when: is('moderation', 'mediation') },
    { id: 'probe', type: 'text', first: '', rows: 1, when: is('moderation') },
    { id: 'resamples', type: 'number', first: '2000', integer: true, min: 100, max: 20000, when: is('mediation') },
    { id: 'seed', type: 'number', first: '1', integer: true, min: 0, when: is('mediation') },
    { id: 'group', type: 'column', data: 'data', first: '', when: is('mixed') },
    { id: 'level', type: 'number', first: '0.95', min: 0.5, max: 0.999 },
  ],
  run,
  examples: [
    { id: 'twoPredictors', values: { data: TWO_PREDICTORS, analysis: 'fit', formula: 'y ~ x1 + x2', predict: 'x1 = 11, x2 = 10' } },
    { id: 'categorical', values: { data: GROUPS, analysis: 'fit', formula: 'score ~ hours * method', se: 'hc3' } },
    { id: 'cluster', values: { data: GROUPS, analysis: 'fit', formula: 'score ~ hours + method', se: 'cluster', cluster: 'class' } },
    { id: 'compare', values: { data: GROUPS, analysis: 'compare', formula: 'score ~ hours * method', reduced: 'score ~ hours' } },
    {
      id: 'moderation',
      values: { data: MODERATION, analysis: 'moderation', outcome: 'wellbeing', x: 'stress', moderator: 'support', center: 'mean' },
    },
    {
      id: 'mediation',
      values: { data: MEDIATION, analysis: 'mediation', x: 'practice', mediator: 'confidence', outcome: 'score', resamples: '1000' },
    },
    { id: 'mixed', values: { data: NESTED, analysis: 'mixed', formula: 'score ~ hours', group: 'school' } },
  ],
};
