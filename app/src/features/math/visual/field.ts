// The visual equation editor (A4-9): a MathLive field in place of the LaTeX source field.
// It has its own math
// keyboard for touch and pen, speaks as math to a screen reader, and reads and writes LaTeX, so the page keeps
// the same source it always kept. MathLive loads on first use, so pages without an edited equation never fetch it.
// Its sounds and font folder are off: the page's content security policy allows neither, and KaTeX's fonts are
// already part of the app.
import type { VisualMath, VisualMathField } from '../../../editor/host';

type MathfieldModule = typeof import('mathlive');
let loaded: Promise<MathfieldModule> | null = null;

function load(): Promise<MathfieldModule> {
  loaded ??= import('mathlive').then((module) => {
    module.MathfieldElement.fontsDirectory = null;
    module.MathfieldElement.soundsDirectory = null;
    module.MathfieldElement.plonkSound = null;
    module.MathfieldElement.keypressSound = null;
    return module;
  });
  return loaded;
}

/** The LaTeX MathLive writes for a source, which is what a round trip through the field gives back. */
export async function roundTrip(source: string): Promise<string> {
  const { MathfieldElement } = await load();
  const field = new MathfieldElement();
  field.value = source;
  return field.getValue('latex');
}

export const visualMath: VisualMath = {
  async create({ value, label, display }): Promise<VisualMathField> {
    const { MathfieldElement } = await load();
    const element = new MathfieldElement();
    element.value = value;
    element.mathVirtualKeyboardPolicy = 'auto';
    element.smartFence = true;
    element.setAttribute('aria-label', label);
    element.style.display = display ? 'block' : 'inline-block';
    element.style.minWidth = '8ch';
    element.style.font = 'inherit';
    return {
      element,
      get value() {
        return element.getValue('latex');
      },
      set value(next: string) {
        element.value = next;
      },
      spoken: () => element.getValue('spoken-text'),
      focus: () => element.focus(),
    };
  },
};
