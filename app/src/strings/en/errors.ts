// Errors shown in toasts and error boundaries.
// Every interface string is a full sentence here, never joined from pieces (ARCHITECTURE.md section 19).

export const errors = {
  commandFailed: "That didn't work, and nothing changed. Try again.",
  pageFailed: "OpenNote ran into a problem and can't show this window. Close it and open OpenNote again.",
} as const;
