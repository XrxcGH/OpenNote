import { Fragment } from 'react';

// A folder path for display: Windows paths use backslashes throughout, and a long path breaks only after a
// separator, never in the middle of a folder name (walk 9, W9-VA-16).

const BACKSLASH = String.fromCharCode(92);

/** The path with one kind of separator: backslashes for a Windows path, slashes for any other. */
export function displayPath(path: string): string {
  const windows = /^[A-Za-z]:/.test(path) || path.includes(BACKSLASH);
  return windows ? path.split('/').join(BACKSLASH) : path;
}

export function PathText({ path }: { readonly path: string }) {
  const shown = displayPath(path);
  // Cut after each separator, so each piece ends in one and a break may follow it.
  const parts = shown.split(new RegExp('(?<=[/' + BACKSLASH + BACKSLASH + '])'));
  return (
    <>
      {parts.map((part, index) => (
        // The parts of a path never reorder, so their position is a stable key.
        <Fragment key={index}>
          {part}
          {index < parts.length - 1 ? <wbr /> : null}
        </Fragment>
      ))}
    </>
  );
}
