// Every word of the statistics kit beyond the palette's, in one object, for the types of the kit's message keys.
// At run time the shared words and each tool's words load separately (statinfer/strings.ts).
import { describe } from './describe';
import { power } from './power';
import { groups } from './groups';
import { bayes } from './bayes';
import { design } from './design';
import { resample } from './resample';
import { multiple } from './multiple';
import { ranks } from './ranks';
import { correlation } from './correlation';
import { epi } from './epi';
import { tables } from './tables';
import { shared } from './shared';

export const kitStatInferDetail = {
  ui: {
    ...shared.ui,
  },
  adjust: {
    ...shared.adjust,
  },
  tails: {
    ...shared.tails,
  },
  err: {
    ...shared.err,
    ...describe.err,
    ...tables.err,
    ...epi.err,
    ...correlation.err,
    ...ranks.err,
    ...multiple.err,
    ...resample.err,
    ...design.err,
    ...bayes.err,
    ...groups.err,
    ...power.err,
  },
  answer: {
    ...shared.answer,
    ...describe.answer,
    ...tables.answer,
    ...epi.answer,
    ...correlation.answer,
    ...ranks.answer,
    ...multiple.answer,
    ...resample.answer,
    ...design.answer,
    ...bayes.answer,
    ...groups.answer,
    ...power.answer,
  },
  note: {
    ...shared.note,
    ...describe.note,
    ...tables.note,
    ...epi.note,
    ...correlation.note,
    ...ranks.note,
    ...multiple.note,
    ...resample.note,
    ...design.note,
    ...bayes.note,
    ...groups.note,
    ...power.note,
  },
  col: {
    ...shared.col,
    ...describe.col,
    ...tables.col,
    ...epi.col,
    ...correlation.col,
    ...ranks.col,
    ...multiple.col,
    ...resample.col,
    ...design.col,
    ...bayes.col,
    ...groups.col,
    ...power.col,
  },
  axis: {
    ...shared.axis,
    ...describe.axis,
    ...tables.axis,
    ...epi.axis,
    ...correlation.axis,
    ...ranks.axis,
    ...multiple.axis,
    ...resample.axis,
    ...design.axis,
    ...bayes.axis,
    ...groups.axis,
    ...power.axis,
  },
  step: {
    ...shared.step,
    ...describe.step,
    ...tables.step,
    ...epi.step,
    ...correlation.step,
    ...ranks.step,
    ...multiple.step,
    ...resample.step,
    ...design.step,
    ...bayes.step,
    ...groups.step,
    ...power.step,
  },
  describe: describe.fields,
  power: power.fields,
  groups: groups.fields,
  bayes: bayes.fields,
  design: design.fields,
  resample: resample.fields,
  multiple: multiple.fields,
  ranks: ranks.fields,
  correlation: correlation.fields,
  epi: epi.fields,
  tables: tables.fields,
};
