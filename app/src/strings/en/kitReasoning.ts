// The reasoning kit (flag kits.reasoning; owner: the reasoning lane): the window, its commands, and each tool's
// modes, fields, steps, and errors. Each tool's strings are in kitReasoning/, joined here into one namespace.
// Every interface string is a full sentence or a label, never joined from pieces (ARCHITECTURE.md section 19).
import { algorithms } from './kitReasoning/algorithms';
import { logic } from './kitReasoning/logic';
import { automata } from './kitReasoning/automata';
import { digital } from './kitReasoning/digital';
import { discrete } from './kitReasoning/discrete';
import { games } from './kitReasoning/games';
import { optimize } from './kitReasoning/optimize';
import { systems } from './kitReasoning/systems';

export const kitReasoning = {
  title: 'Reasoning kit',
  open: 'Open the reasoning kit',
  keywords:
    'logic truth table proof automata grammar discrete number theory digital karnaugh computer systems ' +
    'cache scheduling algorithms graphs optimization simplex game theory voting',
  tools: {
    logic: {
      tab: 'Logic',
      open: 'Open the logic workbench',
      keywords:
        'logic truth table tautology cnf dnf natural deduction fitch proof checker syllogism venn first-order model ' +
        'kripke modal resolution dpll sat lambda calculus church numeral argument map fault tree cut set',
      summary:
        'Truth tables, normal forms, proof checking, syllogisms, models, resolution, lambda terms, argument maps, and fault trees.',
    },
    automata: {
      tab: 'Automata and grammars',
      open: 'Open automata and grammars',
      keywords:
        'automata dfa nfa regular expression thompson subset construction minimization pumping lemma pushdown ' +
        'context-free grammar parse tree ambiguity chomsky normal form cyk first follow ll1 lr0 slr turing transducer',
      summary:
        'Finite automata, regular expressions, pumping, pushdown automata, grammars and parsing tables, Turing machines, and transducers.',
    },
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
    systems: {
      tab: 'Computer systems',
      open: 'Open computer systems, networks, and databases',
      keywords:
        'cache tag index offset amat page replacement fifo lru belady tlb virtual memory cpu scheduling round robin ' +
        'srtf gantt rate monotonic edf pipeline hazard forwarding branch prediction amdahl gustafson cpi mips ' +
        'banker deadlock subnet cidr vlsm ipv6 delay bandwidth tcp mathis go-back-n selective repeat routing ' +
        'dijkstra bellman-ford lamport vector clock functional dependency closure candidate key bcnf 3nf ' +
        'normalization relational algebra sha-256 md5 crc checksum',
      summary:
        'Caches, paging, scheduling, pipelines, deadlock, subnets, delays, routing, clocks, normal forms, relational algebra, and digests.',
    },
    algorithms: {
      tab: 'Algorithms',
      open: 'Open algorithms, data structures, and networks',
      keywords:
        'sorting quicksort mergesort heapsort binary search stack queue bst avl heap b-tree hash bfs dfs dijkstra ' +
        'bellman-ford floyd prim kruskal max flow matching euler hamilton coloring a-star minimax alpha-beta ' +
        'dynamic programming edit distance lcs knapsack viterbi pagerank betweenness centrality louvain',
      summary:
        'Sorting and searching with counts, data structures, graph algorithms, search, dynamic programming, and network measures.',
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
  logic,
  automata,
  discrete,
  digital,
  systems,
  algorithms,
  optimize,
  games,
} as const;
