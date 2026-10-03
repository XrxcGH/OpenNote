// Compares semantic versions the way semver.org section 11 orders them, so the release scripts can find the
// release before this one. The scripts have no dependencies of their own, so this is small and tested.

/** Splits `1.2.3-beta.1+build` into its numbers and prerelease identifiers. Build metadata is ignored. */
function parse(version: string): { numbers: number[]; pre: string[] } {
  const [core, ...rest] = version.split('+')[0].split('-');
  const numbers = core.split('.').map(Number);
  if (numbers.length !== 3 || numbers.some((part) => !Number.isInteger(part) || part < 0)) {
    throw new Error(`"${version}" is not a semantic version.`);
  }
  return { numbers, pre: rest.length > 0 ? rest.join('-').split('.') : [] };
}

function comparePart(a: string, b: string): number {
  const numeric = /^\d+$/;
  if (numeric.test(a) && numeric.test(b)) return Math.sign(Number(a) - Number(b));
  if (numeric.test(a)) return -1;
  if (numeric.test(b)) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Negative when `a` comes before `b`, positive when after, zero when they are the same release. */
export function compareVersions(a: string, b: string): number {
  const left = parse(a);
  const right = parse(b);
  for (let at = 0; at < 3; at++) {
    if (left.numbers[at] !== right.numbers[at]) return Math.sign(left.numbers[at] - right.numbers[at]);
  }
  if (left.pre.length === 0 || right.pre.length === 0) return Math.sign(right.pre.length - left.pre.length);
  for (let at = 0; at < Math.max(left.pre.length, right.pre.length); at++) {
    if (left.pre[at] === undefined) return -1;
    if (right.pre[at] === undefined) return 1;
    const order = comparePart(left.pre[at], right.pre[at]);
    if (order !== 0) return order;
  }
  return 0;
}
