// Functions the clipper runs inside the page the person is clipping, through chrome.scripting.executeScript. The
// browser copies each function's source into the page, so each one stands alone: it uses nothing from outside its
// own body. They only read the page, except the region overlay and the short note that says a clip was saved,
// which remove themselves.

/** The page as HTML, with its address, title, and any selected text. Very large pages are cut at 8 MB. */
export function readPage() {
  const html = document.documentElement.outerHTML;
  return {
    url: location.href,
    title: document.title,
    html: html.length > 8 * 1024 * 1024 ? html.slice(0, 8 * 1024 * 1024) : html,
    selection: String(window.getSelection() ?? ''),
  };
}

/** The open Gmail message: subject, sender, recipients, date, body HTML, attachment list, and its address. */
export function readGmail() {
  if (location.hostname !== 'mail.google.com') return null;
  const subject = document.querySelector('h2.hP')?.textContent?.trim() ?? '';
  const messages = [...document.querySelectorAll('div.adn')];
  const message = messages[messages.length - 1];
  if (!message) return null;
  const sender = message.querySelector('.gD');
  const to = [...message.querySelectorAll('.g2')].map((each) => ({
    name: each.getAttribute('name') ?? each.textContent?.trim() ?? '',
    email: each.getAttribute('email') ?? '',
  }));
  const date = message.querySelector('.g3')?.getAttribute('title') ?? '';
  const body = message.querySelector('.a3s');
  const downloads = [...message.querySelectorAll('[download_url]')].map((each) => each.getAttribute('download_url'));
  return {
    subject,
    from: {
      name: sender?.getAttribute('name') ?? sender?.textContent?.trim() ?? '',
      email: sender?.getAttribute('email') ?? '',
    },
    to,
    date,
    html: body ? body.innerHTML : '',
    downloads,
    link: location.href,
  };
}

/**
 * Lets the person drag over a part of the window. Resolves with the box in CSS pixels and the pixel ratio, or null
 * when they press Escape. Enter takes the whole visible window, for people who don't use a mouse.
 */
export function selectRegion(labels) {
  return new Promise((resolve) => {
    const old = document.getElementById('opennote-clip-region');
    old?.remove();
    const layer = document.createElement('div');
    layer.id = 'opennote-clip-region';
    layer.tabIndex = -1;
    layer.setAttribute('role', 'dialog');
    layer.setAttribute('aria-label', labels.title);
    layer.style.cssText =
      'position:fixed;inset:0;z-index:2147483647;cursor:crosshair;background:rgba(40,32,24,.18);outline:none;';
    const hint = document.createElement('p');
    hint.textContent = labels.hint;
    hint.style.cssText =
      'position:fixed;top:16px;left:50%;transform:translateX(-50%);margin:0;padding:8px 14px;border-radius:8px;' +
      'background:#fbf7ef;color:#2b2621;font:14px/1.4 system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.18);';
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;border:2px solid #b5652b;background:rgba(255,255,255,.12);display:none;';
    layer.append(hint, box);
    document.documentElement.append(layer);
    layer.focus();
    let start = null;
    const finish = (value) => {
      layer.remove();
      // Two frames, so the overlay is gone from the screenshot that follows.
      requestAnimationFrame(() => requestAnimationFrame(() => resolve(value)));
    };
    layer.addEventListener('pointerdown', (event) => {
      start = { x: event.clientX, y: event.clientY };
      layer.setPointerCapture(event.pointerId);
      box.style.display = 'block';
    });
    layer.addEventListener('pointermove', (event) => {
      if (!start) return;
      box.style.left = `${Math.min(start.x, event.clientX)}px`;
      box.style.top = `${Math.min(start.y, event.clientY)}px`;
      box.style.width = `${Math.abs(event.clientX - start.x)}px`;
      box.style.height = `${Math.abs(event.clientY - start.y)}px`;
    });
    layer.addEventListener('pointerup', (event) => {
      if (!start) return;
      const rect = { x: start.x, y: start.y, width: event.clientX - start.x, height: event.clientY - start.y };
      finish({ rect, ratio: window.devicePixelRatio || 1 });
    });
    layer.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') finish(null);
      if (event.key === 'Enter') {
        finish({ rect: { x: 0, y: 0, width: innerWidth, height: innerHeight }, ratio: window.devicePixelRatio || 1 });
      }
    });
  });
}

/** A short, quiet note in the corner of the page, read out by screen readers, that goes away by itself. */
export function showNote(message) {
  const note = document.createElement('div');
  note.setAttribute('role', 'status');
  note.textContent = message;
  note.style.cssText =
    'position:fixed;right:16px;bottom:16px;z-index:2147483647;padding:10px 14px;border-radius:8px;' +
    'background:#fbf7ef;color:#2b2621;font:14px/1.4 system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.18);';
  document.documentElement.append(note);
  setTimeout(() => note.remove(), 4000);
}
