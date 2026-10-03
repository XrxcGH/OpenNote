// Type-level parsing of message text (ARCHITECTURE.md section 19.2) finds the parameters a message takes and
// their types. It follows the runtime formatter's subset of ICU MessageFormat:
// - {name} takes a string or a number.
// - {name, plural, =0 {...} one {...} other {...}} takes a number, and # in a branch shows it.
// - {name, select, key {...} other {...}} takes a string.
// Branches may hold {name} placeholders, but not another plural or select.

type Kind = 'plain' | 'plural' | 'select';
type Arg = [name: string, kind: Kind];

type Trim<S extends string> = S extends ` ${infer Rest}` ? Trim<Rest> : S extends `${infer Rest} ` ? Trim<Rest> : S;

type Identifier<N extends string> = N extends ''
  ? never
  : N extends `${string}${' ' | '#' | '{' | '}' | ','}${string}`
    ? never
    : N;

type WithPlain<Found extends Arg, Name extends string> = [Identifier<Name>] extends [never]
  ? Found
  : Found | [Identifier<Name>, 'plain'];

/** A branch body up to its closing brace, with the placeholders inside it. Returns [found, text after it]. */
type Body<S extends string, Found extends Arg> = S extends `}${infer After}`
  ? [Found, After]
  : S extends `{${infer Rest}`
    ? Rest extends `${infer Name}}${infer After}`
      ? Body<After, WithPlain<Found, Trim<Name>>>
      : [Found, '']
    : S extends `${infer _First}${infer Rest}`
      ? Body<Rest, Found>
      : [Found, ''];

/** The branches of a plural or select, up to the argument's closing brace. Returns [found, text after it]. */
type Branches<S extends string, Found extends Arg> =
  Trim<S> extends `}${infer After}`
    ? [Found, After]
    : Trim<S> extends `${string}{${infer Rest}`
      ? Body<Rest, Found> extends [infer Next extends Arg, infer After extends string]
        ? Branches<After, Next>
        : [Found, '']
      : [Found, ''];

type Complex<Name extends string, Kind extends string, Rest extends string, Found extends Arg> =
  Branches<Rest, Found | [Name, Kind extends 'select' ? 'select' : 'plural']> extends [
    infer Next extends Arg,
    infer After extends string,
  ]
    ? Scan<After, Next>
    : Found;

/** Every argument in top-level text. */
type Scan<S extends string, Found extends Arg = never> = S extends `${string}{${infer Rest}`
  ? Rest extends `${infer Name},${infer Kind},${infer Branches}`
    ? Trim<Kind> extends 'plural' | 'select'
      ? Name extends `${string}}${string}`
        ? Simple<Rest, Found>
        : Complex<Trim<Name>, Trim<Kind>, Branches, Found>
      : Simple<Rest, Found>
    : Simple<Rest, Found>
  : Found;

type Simple<Rest extends string, Found extends Arg> = Rest extends `${infer Name}}${infer After}`
  ? Scan<After, WithPlain<Found, Trim<Name>>>
  : Found;

type ArgsOf<S extends string> = Scan<S>;

/** The parameters a message takes: plural counts are numbers, select values strings, the rest either. */
export type Params<S extends string> = {
  [A in ArgsOf<S> as A[0]]: A[1] extends 'plural' ? number : A[1] extends 'select' ? string : string | number;
};

/** No argument when the message has no placeholders, one params object otherwise. */
export type ParamsArg<S> = S extends string ? ([ArgsOf<S>] extends [never] ? [] : [params: Params<S>]) : never;
