// Bayesian networks by enumeration. Expected values are published ones: the sprinkler network of K. Murphy's Bayes
// Net Toolbox tutorial (P(S | W) = 0.4298, P(R | W) = 0.7079) and the burglary network of Russell and Norvig,
// Artificial Intelligence: A Modern Approach, section 14.4 (P(B | J, M) = 0.284), plus the Bayes table's diagnostic case.
import { describe, expect, it } from 'vitest';
import { KitError } from '../report';
import { inferNetwork, networkReport, parseEvidence, parseNetwork } from './network';

const close = (actual: number, want: number, tol: number) => expect(Math.abs(actual - want)).toBeLessThanOrEqual(tol);

const SPRINKLER =
  'Cloudy: 0.5\nSprinkler | Cloudy: 0.5, 0.1\nRain | Cloudy: 0.2, 0.8\nWet | Sprinkler, Rain: 0, 0.9, 0.9, 0.99';
const BURGLARY =
  'Burglary: 0.001\nEarthquake: 0.002\nAlarm | Burglary, Earthquake: 0.001, 0.29, 0.94, 0.95\n' +
  'John | Alarm: 0.05, 0.90\nMary | Alarm: 0.01, 0.70';

const solve = (net: string, evidence: string) => {
  const nodes = parseNetwork(net);
  return { nodes, result: inferNetwork(nodes, parseEvidence(evidence, nodes)) };
};

const code = (run: () => unknown) => {
  try {
    run();
    return 'none';
  } catch (error) {
    return error instanceof KitError ? error.code : 'other';
  }
};

describe('Bayesian networks', () => {
  it('sprinkler network, wet grass observed', () => {
    const { result } = solve(SPRINKLER, 'Wet = true');
    close(result.evidence, 0.6471, 1e-4);
    close(result.marginals[1], 0.4298, 1e-4);
    close(result.marginals[2], 0.7079, 1e-4);
    expect(result.marginals[3]).toBe(1);
    expect(result.states).toBe(8);
  });

  it('burglary network, both neighbors call', () => {
    const { result } = solve(BURGLARY, 'John = true, Mary = true');
    close(result.marginals[0], 0.284, 1e-3);
  });

  it('two nodes match the Bayes table: prior 0.01, sensitivity 0.95, specificity 0.90', () => {
    const { result } = solve('Disease: 0.01\nPositive | Disease: 0.10, 0.95', 'Positive = yes');
    close(result.marginals[0], 0.087558, 1e-6);
  });

  it('no evidence gives the prior marginals, in any line order', () => {
    const { result } = solve('Wet | Sprinkler, Rain: 0, 0.9, 0.9, 0.99\nRain: 0.3\nSprinkler: 0.4', '');
    close(result.evidence, 1, 1e-12);
    // P(W) = 0.6 * 0.3 * 0.9 + 0.4 * 0.7 * 0.9 + 0.4 * 0.3 * 0.99 = 0.162 + 0.252 + 0.1188
    close(result.marginals[0], 0.5328, 1e-12);
  });

  it('reports the query, the posterior table and the steps', () => {
    const r = networkReport(SPRINKLER, 'wet=T', 'rain');
    expect(r.answer.vars.node).toBe('Rain');
    expect(r.answer.vars.p).toBe('0.70793');
    expect(r.tables[1].rows).toHaveLength(1 + 2 + 2 + 4);
    expect(r.steps).toHaveLength(3);
  });

  it('rejects bad networks with a clear message', () => {
    expect(code(() => parseNetwork(''))).toBe('networkEmpty');
    expect(code(() => parseNetwork(Array.from({ length: 9 }, (_, i) => `N${i}: 0.5`).join('\n')))).toBe('networkSize');
    expect(code(() => parseNetwork('Rain 0.2'))).toBe('networkLine');
    expect(code(() => parseNetwork('Rain: 0.2\nWet | Rain: 0.9'))).toBe('networkCount');
    expect(code(() => parseNetwork('Rain: 1.2'))).toBe('networkProbability');
    expect(code(() => parseNetwork('Rain: -0.1'))).toBe('networkProbability');
    expect(code(() => parseNetwork('Rain: 0.2\nrain: 0.3'))).toBe('networkDuplicate');
    expect(code(() => parseNetwork('Wet | Rain: 0.1, 0.9'))).toBe('networkParent');
    expect(code(() => parseNetwork('A | B: 0.1, 0.9\nB | A: 0.2, 0.8'))).toBe('networkCycle');
    expect(code(() => parseNetwork('A | A: 0.1, 0.9'))).toBe('networkCycle');
  });

  it('rejects bad evidence, impossible evidence and an unknown query', () => {
    const nodes = parseNetwork(SPRINKLER);
    expect(code(() => parseEvidence('Snow = true', nodes))).toBe('evidenceNode');
    expect(code(() => parseEvidence('Wet = maybe', nodes))).toBe('evidenceValue');
    expect(code(() => parseEvidence('Wet = true, Wet = false', nodes))).toBe('evidenceClash');
    // Grass can't be wet with neither sprinkler nor rain.
    expect(code(() => networkReport(SPRINKLER, 'Wet = true, Sprinkler = false, Rain = false', ''))).toBe(
      'networkImpossible',
    );
    expect(code(() => networkReport(SPRINKLER, '', 'Snow'))).toBe('queryNode');
  });
});
