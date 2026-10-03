// A link on the page opens only through the Open link command, which sends web and mail links to the browser and
// never opens other kinds (formattingBar/commands.ts). A click on a link in a block rendered without an editor
// would otherwise take the whole window to its address.

/** Stops a click on a link inside `container` from navigating the window. Returns a function that stops it. */
export function keepLinksInPlace(container: HTMLElement): () => void {
  const onClick = (event: MouseEvent) => {
    if (event.target instanceof Element && event.target.closest('a[href]')) event.preventDefault();
  };
  container.addEventListener('click', onClick, true);
  return () => container.removeEventListener('click', onClick, true);
}
