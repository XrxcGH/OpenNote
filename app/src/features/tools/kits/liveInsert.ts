// Insert > Live calculation block for a kit window, loading the insert code only when the button is pressed, so a
// window's own chunk does not carry the kit library (the unit, error, and step words) that the insert needs.
import type { KitCalcData } from './block/model';

/** A live block for the tool whose panel holds `from`; false when the button is in no marked panel or no page took it. */
export async function insertLive(
  from: Element,
  block: Omit<KitCalcData, 'kit' | 'tool' | 'inputs' | 'title'> & { title?: string },
): Promise<boolean> {
  const { insertLiveFromPanel } = await import('./ui/insert');
  return insertLiveFromPanel(from, block);
}
