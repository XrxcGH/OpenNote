// The clipper's background script. It does one thing: a region screenshot, which outlives the popup. It shows the
// overlay in the page, takes a picture of the visible tab, cuts out the part the person chose, and adds it to
// OpenNote as a new page.

import { connect, toBase64 } from './shared/api.js';
import { regionClip } from './lib/clip.js';
import { selectRegion, showNote } from './lib/inject.js';
import { cropBox } from './lib/region.js';

const LABELS = {
  title: 'Choose a region to clip',
  hint: 'Drag over the part to clip. Enter takes the whole window; Escape cancels.',
};

async function note(tabId, message) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, func: showNote, args: [message] });
  } catch {
    // The page may have gone; the clip itself already finished or failed.
  }
}

async function crop(dataUrl, choice) {
  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);
  const box = cropBox(choice.rect, choice.ratio, bitmap.width, bitmap.height);
  if (!box) return null;
  const canvas = new OffscreenCanvas(box.width, box.height);
  canvas.getContext('2d').drawImage(bitmap, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height);
  const png = await canvas.convertToBlob({ type: 'image/png' });
  return toBase64(new Uint8Array(await png.arrayBuffer()));
}

async function clipRegion({ tabId, section, title }) {
  const tab = await chrome.tabs.get(tabId);
  const [picked] = await chrome.scripting.executeScript({ target: { tabId }, func: selectRegion, args: [LABELS] });
  const choice = picked?.result;
  if (!choice) return;
  const shot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  const data = await crop(shot, choice);
  if (!data) {
    await note(tabId, 'That region was too small. Nothing was clipped.');
    return;
  }
  const { port, token } = await chrome.storage.local.get(['port', 'token']);
  const page = regionClip({ url: tab.url, title: title || tab.title }, data);
  try {
    await connect(port, token).createPage(section, page);
    await chrome.storage.local.set({ section });
    await note(tabId, 'Saved to OpenNote.');
  } catch (error) {
    await note(tabId, error?.message ?? 'OpenNote couldn’t save the clip.');
  }
}

chrome.runtime.onMessage.addListener((message, sender) => {
  // Only this extension's own popup sends messages; pages can't reach this listener.
  if (sender.id !== chrome.runtime.id || message?.kind !== 'region') return false;
  void clipRegion(message);
  return false;
});
