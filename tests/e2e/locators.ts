// XPath locators the real-app specs share, and that tests/ui/behavior/e2eLocators.spec.ts runs against the web build
// in every pull request. The specs run only at night, so a locator that no longer matches the interface would stay
// hidden until then. Each one says what the interface shows a person, not how it is built.

/** The record control in the command bar (the group named Recording). */
export const RECORDING_GROUP = '//*[@role="group"][@aria-label="Recording"]';

/** The calculator's expression field. */
export const CALCULATOR_EXPRESSION = '//label[normalize-space(.)="Expression"]//input';

/** The XPath string literal for `text`, in the quote style it does not contain. */
export function literal(text: string): string {
  return text.includes('"') ? `'${text}'` : `"${text}"`;
}

/**
 * A button in `scope` that is named `name`. A command bar button draws its name twice: the visible copy, and an
 * aria-hidden copy in semibold that keeps the button's width when it turns bold. The button's own text is then the
 * name twice, so a match on the whole text finds nothing. This matches the visible copy, and a plain button too.
 */
export function namedButton(scope: string, name: string): string {
  const quoted = literal(name);
  const visible = `.//*[not(@aria-hidden="true")][normalize-space(.)=${quoted}]`;
  return `${scope}//button[normalize-space(.)=${quoted} or ${visible}]`;
}

/**
 * The option of the command palette that offers `title`. The palette lists its results a moment after the typing,
 * and Enter runs the one that is highlighted by then, so a spec waits for this option and clicks it.
 */
export function paletteOption(title: string): string {
  return `//*[@role="option"][contains(normalize-space(.), ${literal(title)})]`;
}
