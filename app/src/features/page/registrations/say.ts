// What a command says when it cannot do its job: a toast anyone can see, which the screen reader also speaks. A bare
// announcement is silent on the screen, so a command that only announced looked as if it did nothing.
import { showToast } from '../../../ui';

export function say(message: string): void {
  if (message) showToast({ message });
}
