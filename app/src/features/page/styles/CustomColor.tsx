// A custom text color (owner: WP4, then text:format-pane). The text color picker's "Custom color…" opens the full
// picker in a dialog: theme colors with tints, standard colors, recent colors, and hex, RGB, and HSL fields with the
// contrast badge. A pick closes the dialog; Cancel or Escape answers null.
import { createRoot } from 'react-dom/client';
import { t } from '../../../strings/t';
import { Dialog } from '../../../ui';
import { ColorPalette } from '../../../ui/color';
import { currentScheme } from '../formatPane/ColorPicker';

const HEX = /^#[0-9a-f]{6}$/i;
const SHORT_HEX = /^#[0-9a-f]{3}$/i;

/** A color typed as `#rrggbb`, `rrggbb`, `#rgb`, or `rgb`, as lowercase `#rrggbb`; null when it is none of these. */
export function normalizeHex(value: string): string | null {
  const text = value.trim();
  const hashed = text.startsWith('#') ? text : `#${text}`;
  if (HEX.test(hashed)) return hashed.toLowerCase();
  if (SHORT_HEX.test(hashed)) return `#${[...hashed.slice(1)].map((digit) => digit + digit).join('')}`.toLowerCase();
  return null;
}

function CustomColorDialog({ initial, finish }: { initial: string; finish(answer: string | null): void }) {
  return (
    <Dialog
      title={t('editor.colorMenu.label')}
      size="small"
      onDismiss={() => finish(null)}
      actions={[
        {
          id: 'cancel',
          label: t('common.cancel'),
          variant: 'secondary',
          leastDestructive: true,
          onPress: () => finish(null),
        },
      ]}
    >
      <ColorPalette
        scheme={currentScheme()}
        automatic={false}
        noColor={false}
        current={normalizeHex(initial)}
        onPick={(pick) => finish(pick.kind === 'color' ? pick.value : null)}
      />
    </Dialog>
  );
}

/** Asks for a custom color. Resolves to a color value (#rrggbb, a pen name, or theme:NAME), or null when canceled. */
export function chooseCustomColor(initial = '#'): Promise<string | null> {
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  return new Promise((resolve) => {
    const finish = (answer: string | null) => {
      queueMicrotask(() => {
        root.unmount();
        host.remove();
      });
      resolve(answer);
    };
    root.render(<CustomColorDialog initial={initial} finish={finish} />);
  });
}
