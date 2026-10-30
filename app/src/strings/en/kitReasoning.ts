// The reasoning kit (flag kits.reasoning; owner: the reasoning lane): the window, its commands, and each tool's
// modes, fields, steps, and errors. Each tool's strings are in kitReasoning/, joined here into one namespace.
// Every interface string is a full sentence or a label, never joined from pieces (ARCHITECTURE.md section 19).
import { digital } from './kitReasoning/digital';
import { discrete } from './kitReasoning/discrete';
import { games } from './kitReasoning/games';
import { optimize } from './kitReasoning/optimize';

export const kitReasoning = {
  title: 'Reasoning kit',
  open: 'Open the reasoning kit',
  keywords:
    'logic truth table proof automata grammar discrete number theory digital karnaugh computer systems ' +
    'cache scheduling algorithms graphs optimization simplex game theory voting',
  tools: {
    discrete: {
      tab: 'Numbers and groups',
      open: 'Open numbers, counting, and groups',
      keywords:
        'number theory gcd euclid modular inverse power chinese remainder prime factor miller rabin pollard phi ' +
        'primitive root discrete log continued fraction cipher caesar vigenere hill rsa diffie hellman elgamal ' +
        'combinations permutations stirling bell catalan partitions recurrence master theorem group cayley ' +
        'subgroup coset lattice dihedral symmetric quaternion finite field galois',
      summary:
        'Number theory with every step, classical ciphers and toy public keys, exact counting, and finite groups and fields.',
    },
    digital: {
      tab: 'Digital logic',
      open: 'Open digital logic design',
      keywords:
        'digital logic boolean algebra karnaugh map k-map quine mccluskey minimize sop pos nand nor gates ' +
        'flip-flop state machine mealy moore counter elmore logical effort',
      summary: 'From truth tables to minimal circuits: maps, gates, timing, flip-flops, and state machines.',
    },
    optimize: {
      tab: 'Optimization',
      open: 'Open optimization, projects, and decisions',
      keywords:
        'linear programming simplex tableau shadow price sensitivity dual integer branch and bound transportation ' +
        'vogel modi assignment hungarian cpm pert critical path gantt earned value decision tree evpi evsi ' +
        'utility queue erlang little newsvendor operations research',
      summary:
        'Linear and integer programs, shipping and assignment, project schedules, decisions, and queues, with every step.',
    },
    games: {
      tab: 'Games and voting',
      open: 'Open games, voting, and apportionment',
      keywords:
        'game theory nash equilibrium mixed strategy dominance zero-sum backward induction bargaining auction ' +
        'voting borda condorcet instant runoff stv apportionment shapley banzhaf efficiency gap compactness',
      summary:
        'Solve games, tally elections under many rules, apportion seats, and measure voting power and districts.',
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
  discrete,
  digital,
  optimize,
  games,
} as const;
