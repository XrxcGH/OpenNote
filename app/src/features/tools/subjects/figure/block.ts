// The kit figure block on a page: the stored SVG as an image from a data URL (so no script in it can run), its
// alternative text, the summary, and an Open in tool button that reopens the tool with the saved inputs. Plain DOM,
// and it never changes the page itself, so it works on a read-only page too.
import { openKitTool } from '../../kits/registry';
import { sayS } from '../ui/words';
import kitStyles from '../../kits/ui/kit.module.css';
import styles from '../ui/subjects.module.css';
import { readKitFigure, svgDataUrl } from './model';

interface BlockProps {
  data: Record<string, unknown>;
  announce(text: string): void;
}

function render(container: HTMLElement, props: BlockProps): void {
  const figure = readKitFigure(props.data);
  const section = document.createElement('section');
  section.className = kitStyles.block;
  section.setAttribute('aria-label', sayS('figure.label'));
  if (figure.svg) {
    const img = document.createElement('img');
    img.src = svgDataUrl(figure.svg);
    img.alt = figure.alt;
    img.className = styles.figureImage;
    section.append(img);
  } else {
    const empty = document.createElement('p');
    empty.className = kitStyles.note;
    empty.textContent = sayS('figure.empty');
    section.append(empty);
  }
  if (figure.summary) {
    const summary = document.createElement('p');
    summary.className = kitStyles.note;
    summary.textContent = figure.summary;
    section.append(summary);
  }
  const problem = document.createElement('p');
  problem.className = kitStyles.problem;
  problem.hidden = true;
  problem.textContent = sayS('figure.missing');
  if (figure.kit && figure.tool) {
    const buttons = document.createElement('div');
    buttons.className = kitStyles.buttons;
    const open = document.createElement('button');
    open.type = 'button';
    open.className = kitStyles.copy;
    open.textContent = sayS('figure.open');
    open.addEventListener('click', () => {
      void openKitTool(figure.kit, figure.tool, figure.inputs ?? undefined).then((opened) => {
        problem.hidden = opened;
        props.announce(sayS(opened ? 'figure.opened' : 'figure.missing'));
      });
    });
    buttons.append(open);
    section.append(buttons);
  }
  section.append(problem);
  container.replaceChildren(section);
}

/** Mounts the block for the page's panel host. */
export function mountKitFigure(container: HTMLElement, props: BlockProps) {
  render(container, props);
  return { update: (next: BlockProps) => render(container, next), destroy: () => container.replaceChildren() };
}
