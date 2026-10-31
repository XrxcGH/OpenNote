// A worked step: the key of its sentence in the tool's strings, the values that fill it, and optional LaTeX, so a
// student can follow the method line by line and copy it into notes.

export interface Step {
  key: string;
  vars?: Readonly<Record<string, string | number>>;
  math?: string;
}

export const step = (key: string, vars?: Step['vars'], math?: string): Step => ({
  key,
  ...(vars ? { vars } : {}),
  ...(math ? { math } : {}),
});
