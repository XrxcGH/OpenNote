// Asks the shell how Windows draws captions. The web build and other systems have no such setting, so it is none.
import type { CaptionStyle } from './style';

type Call = (command: string, args?: unknown) => Promise<unknown>;

export async function invokeCaptionStyle(): Promise<CaptionStyle | null> {
  if (import.meta.env.VITE_PLATFORM === 'web') return null;
  try {
    const { invoke } = await import('../../../platform/tauri/invoke');
    return ((await (invoke as unknown as Call)('intel_caption_style')) as CaptionStyle | null) ?? null;
  } catch {
    return null;
  }
}
