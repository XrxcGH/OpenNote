// The reasoning kit's start-up words: its window title and its palette commands. The rest of
// kitReasoning.ts joins this object when the kit's code loads (features/tools/reasoning/text.ts).
import type { kitReasoning as all } from './kitReasoning';

export const kitReasoningStart = {
  title: 'Reasoning kit',
  open: 'Open the reasoning kit',
  keywords:
    'logic truth table proof automata grammar discrete number theory digital karnaugh computer ' +
    'systems cache scheduling algorithms graphs optimization simplex game theory voting',
  tools: {
    logic: {
      open: 'Open the logic workbench',
      keywords:
        'logic truth table tautology cnf dnf natural deduction fitch proof checker syllogism venn ' +
        'first-order model kripke modal resolution dpll sat lambda calculus church numeral argument ' +
        'map fault tree cut set',
    },
    automata: {
      open: 'Open automata and grammars',
      keywords:
        'automata dfa nfa regular expression thompson subset construction minimization pumping lemma ' +
        'pushdown context-free grammar parse tree ambiguity chomsky normal form cyk first follow ll1 ' +
        'lr0 slr turing transducer',
    },
    discrete: {
      open: 'Open numbers, counting, and groups',
      keywords:
        'number theory gcd euclid modular inverse power chinese remainder prime factor miller rabin ' +
        'pollard phi primitive root discrete log continued fraction cipher caesar vigenere hill rsa ' +
        'diffie hellman elgamal combinations permutations stirling bell catalan partitions generating ' +
        'function inclusion exclusion recurrence master theorem group cayley subgroup coset lattice ' +
        'dihedral symmetric quaternion finite field galois',
    },
    digital: {
      open: 'Open digital logic design',
      keywords:
        'digital logic boolean algebra karnaugh map k-map quine mccluskey minimize sop pos nand nor ' +
        'gates flip-flop state machine mealy moore counter elmore logical effort',
    },
    systems: {
      open: 'Open computer systems, networks, and databases',
      keywords:
        'cache tag index offset amat page replacement fifo lru belady tlb virtual memory cpu ' +
        'scheduling round robin srtf gantt rate monotonic edf pipeline hazard forwarding branch ' +
        'prediction amdahl gustafson cpi mips banker deadlock subnet cidr vlsm ipv6 delay bandwidth ' +
        'tcp mathis go-back-n selective repeat routing dijkstra bellman-ford lamport vector clock ' +
        'functional dependency closure candidate key bcnf 3nf normalization relational algebra ' +
        'sha-256 md5 crc checksum',
    },
    algorithms: {
      open: 'Open algorithms, data structures, and networks',
      keywords:
        'sorting quicksort mergesort heapsort binary search stack queue bst avl heap b-tree hash bfs ' +
        'dfs dijkstra bellman-ford floyd prim kruskal max flow matching euler hamilton coloring ' +
        'a-star minimax alpha-beta dynamic programming edit distance lcs knapsack viterbi pagerank ' +
        'betweenness centrality louvain',
    },
    optimize: {
      open: 'Open optimization, projects, and decisions',
      keywords:
        'linear programming simplex tableau shadow price sensitivity dual integer branch and bound ' +
        'transportation vogel modi assignment hungarian cpm pert critical path gantt earned value ' +
        'decision tree evpi evsi utility queue erlang little newsvendor operations research',
    },
    games: {
      open: 'Open games, voting, and apportionment',
      keywords:
        'game theory nash equilibrium mixed strategy dominance zero-sum backward induction bargaining ' +
        'auction voting borda condorcet instant runoff stv apportionment shapley banzhaf efficiency ' +
        'gap compactness three player arrow monotonicity population paradox',
    },
  },
} as const;

/** The whole namespace as t() sees it. A test checks that these words are the same as in kitReasoning.ts. */
export const kitReasoning = kitReasoningStart as unknown as typeof all;
