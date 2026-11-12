// Fills "{name}" places in a string of strings/en/codeStudio/cpp.ts. The worker uses this, not t(), so it does not
// load every string of the app.

export function say(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (place, name: string) => (name in values ? String(values[name]) : place));
}
