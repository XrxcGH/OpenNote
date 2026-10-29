// The problem an engine throws when it can say in words what is wrong with its inputs. It carries a message key and
// its values, not words, so engines stay free of t(); the kit UI turns it into a sentence.

/** A problem a tool explains in its own words: `key` is a full message key. */
export class KitProblem extends Error {
  constructor(
    readonly key: string,
    readonly vars?: Readonly<Record<string, string | number>>,
  ) {
    super(key);
    this.name = 'KitProblem';
  }
}
