// The reasoning kit (flag kits.reasoning; owner: the reasoning lane): the window, its commands, and each tool's
// modes, fields, steps, and errors. Each tool's strings are in kitReasoning/, joined here into one namespace.
// Every interface string is a full sentence or a label, never joined from pieces (ARCHITECTURE.md section 19).
import { digital } from './kitReasoning/digital';

export const kitReasoning = {
  title: 'Reasoning kit',
  open: 'Open the reasoning kit',
  keywords:
    'logic truth table proof automata grammar discrete number theory digital karnaugh computer systems ' +
    'cache scheduling algorithms graphs optimization simplex game theory voting',
  tools: {
    digital: {
      tab: 'Digital logic',
      open: 'Open digital logic design',
      keywords:
        'digital logic boolean algebra karnaugh map k-map quine mccluskey minimize sop pos nand nor gates ' +
        'flip-flop state machine mealy moore counter elmore logical effort',
      summary: 'From truth tables to minimal circuits: maps, gates, timing, flip-flops, and state machines.',
    },
  },
  common: {
    mode: 'Mode',
    loading: 'Loading the tool.',
    example: 'Restore the example',
    failed: 'This could not be worked out. Check the fields and try again.',
    steps: 'Steps',
    moreRows: 'Showing the first {shown} of {total} rows. Insert table adds up to 1024 rows.',
    inserted: 'Added to the page.',
    noPage: 'Open a page to insert into it.',
    insertGroup: 'Insert into the page',
    insertAnswer: 'Insert answer',
    insertSteps: 'Insert with steps',
    insertLatex: 'Insert equation',
    insertTable: 'Insert table',
    insertPicture: 'Insert picture',
  },
  digital,
} as const;
