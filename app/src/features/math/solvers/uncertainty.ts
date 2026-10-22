// Error propagation: the uncertainty of f(x₁, …, xₙ) from independent measurements xᵢ ± σᵢ, by the first-order
// formula σ_f² = Σ (∂f/∂xᵢ · σᵢ)², with each partial derivative worked symbolically and each variable's share.
import { SolverError, compile, derive, namesIn, numberText, read, show } from './expr';
import { step, type Step } from './steps';

export interface Measured {
  readonly name: string;
  readonly value: number;
  readonly uncertainty: number;
}

export interface Contribution {
  readonly name: string;
  readonly partial: string;
  readonly partialValue: number;
  /** |∂f/∂x · σ|. */
  readonly contribution: number;
  /** The fraction of σ_f² that comes from this variable. */
  readonly share: number;
}

export interface PropagationResult {
  readonly value: number;
  readonly uncertainty: number;
  /** σ_f / |f|, or NaN when f is 0. */
  readonly relative: number;
  /** The result rounded as a lab report writes it, such as 12.3 ± 0.4. */
  readonly text: string;
  readonly contributions: readonly Contribution[];
  readonly steps: readonly Step[];
}

/** A value and its uncertainty, with the uncertainty to two significant figures and the value to match. */
export function roundedPair(value: number, uncertainty: number): string {
  if (!(uncertainty > 0) || !Number.isFinite(uncertainty)) return `${numberText(value)} ± ${numberText(uncertainty)}`;
  const place = Math.floor(Math.log10(uncertainty)) - 1;
  const decimals = Math.max(0, -place);
  if (Math.abs(value) >= 1e6 || Math.abs(value) < 1e-4 || decimals > 10) {
    const exponent = Math.floor(Math.log10(Math.abs(value) || uncertainty));
    const scale = 10 ** exponent;
    const digits = Math.max(0, exponent - place);
    return `(${(value / scale).toFixed(digits)} ± ${(uncertainty / scale).toFixed(digits)})×10^${exponent}`.replace(
      /-/g,
      '−',
    );
  }
  const round = (x: number) => (Math.round(x / 10 ** place) * 10 ** place).toFixed(decimals);
  return `${round(value)} ± ${round(uncertainty)}`.replace(/^-/, '−');
}

export function propagate(expression: string, measured: readonly Measured[]): PropagationResult {
  const node = read(expression);
  const names = measured.map((m) => m.name.trim());
  for (const used of namesIn(node)) if (!names.includes(used)) throw new SolverError('unknown-name', used);
  for (const m of measured)
    if (!Number.isFinite(m.value) || !Number.isFinite(m.uncertainty) || m.uncertainty < 0)
      throw new SolverError('error-values', m.name);
  const values = measured.map((m) => m.value);
  const value = compile(node, names)(values);
  if (!Number.isFinite(value)) throw new SolverError('error-undefined');
  const steps: Step[] = [step('errorFormula', `σ_f = √(${names.map((n) => `(∂f/∂${n}·σ_${n})²`).join(' + ')})`)];
  const used = measured.filter((m) => namesIn(node).has(m.name.trim()));
  const parts = used.map((m) => {
    const d = derive(node, m.name.trim());
    const partialValue = compile(d, names)(values);
    return {
      name: m.name.trim(),
      partial: show(d),
      partialValue,
      contribution: Math.abs(partialValue * m.uncertainty),
    };
  });
  const variance = parts.reduce((sum, p) => sum + p.contribution ** 2, 0);
  const uncertainty = Math.sqrt(variance);
  for (const p of parts) {
    const sigma = used.find((m) => m.name.trim() === p.name)!.uncertainty;
    steps.push(
      step(
        'errorPartial',
        `∂f/∂${p.name} = ${p.partial} = ${numberText(p.partialValue)};  ` +
          `(${numberText(p.partialValue)} · ${numberText(sigma)})² = ${numberText(p.contribution ** 2)}`,
        {
          name: p.name,
        },
      ),
    );
  }
  const relative = value === 0 ? NaN : uncertainty / Math.abs(value);
  const text = roundedPair(value, uncertainty);
  steps.push(
    step('errorResult', `f = ${text}${Number.isFinite(relative) ? `  (${numberText(relative * 100, 3)}%)` : ''}`),
  );
  const contributions = parts.map((p) => ({ ...p, share: variance === 0 ? 0 : p.contribution ** 2 / variance }));
  return { value, uncertainty, relative, text, contributions, steps };
}
