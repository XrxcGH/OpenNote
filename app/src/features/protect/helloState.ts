// Which protected sections open with Windows Hello, as the shell last said. Unlocking reads the section's status,
// and turning Hello on or off changes it, so the section menu offers only the Hello command that applies: never
// both "Unlock with Windows Hello" and "Stop unlocking with Windows Hello" (full walk B2-B14-7).

const hello = new Map<string, boolean>();

/** Notes whether a section opens with Windows Hello. */
export function noteHello(id: string, on: boolean): void {
  hello.set(id, on);
}

/** Whether a section opens with Windows Hello. A section the shell has not described yet does not. */
export function usesHello(id: string): boolean {
  return hello.get(id) ?? false;
}
