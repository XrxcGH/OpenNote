// Worked steps from the control engines. A step names a message in the kitControl strings namespace, the values
// to put into it, and optionally an equation in LaTeX. Engines never call t(): the interface turns steps into
// words, so the same steps can be shown, read aloud, or inserted into a page.
import '../text';

export interface Step {
  /** A key under kitControl.steps, for example "markov.stationary". */
  readonly key: string;
  readonly vars?: Readonly<Record<string, string>>;
  readonly math?: string;
}

export const step = (key: string, vars?: Record<string, string>, math?: string): Step => ({ key, vars, math });
