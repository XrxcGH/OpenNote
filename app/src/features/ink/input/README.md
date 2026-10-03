# Input

This folder turns pointer input into strokes and decides which input is allowed to draw. It has no React, no browser calls, and no platform code. Each piece takes plain data and the time, so a recorded pen session replays to the same result and a Node test can drive it.

The page view reads pointer events, copies their fields into the plain types here, and acts on what comes back. The gesture detectors have their own README in `gestures/`.

## What it does

- `samples.ts` turns one raw sample into a stroke point. A pen that reports zero pressure while touching gets the middle pressure. Touch and mouse samples carry no pressure and no tilt. Positions are clamped to the range a record holds. Tilt comes from `tiltX` and `tiltY`, or from the altitude and azimuth angles.
- `strokeBuilder.ts` builds one stroke from samples. It runs pressure through the pen's curve table, steadies the path if the steady pen is on, and drops samples a record could not tell apart. At the 200,000-point limit it ends the stroke and continues from the same point in a new stroke.
- `palm.ts` is the palm rejection state machine. While a pen is near, a single touch is ignored, and two fingers that land together pan and zoom. The next section describes the states.
- `buttons.ts` decides what the pen's barrel button and eraser end do, per pen, and when to block the press-and-hold menu.

## Palm rejection

| Pen state | Entered when                                               | Left when                                                 |
| --------- | ---------------------------------------------------------- | --------------------------------------------------------- |
| Away      | Start-up, or grace ended                                   | Any pen event                                             |
| Hovering  | A pen event with no contact                                | Contact, or the pen leaves                                |
| Down      | Pen contact                                                | Pen up or cancel                                          |
| Grace     | The pen left range, or lifted on a digitizer without hover | 500 ms later (300 to 2,000 in settings), or any pen event |

A hovering pen that sends no event for 2 seconds counts as gone, because a lost leave event would otherwise leave finger scrolling dead. A window that loses focus, a page switch, and a lost pointer capture count as the pen leaving.

While the pen is not away, a single touch on the page is ignored. Two contacts that start within 150 ms pan and zoom, if each is smaller than 76 CSS pixels. Three or more are ignored. Controls outside the page keep working for every finger.

With "Draw with touch" on and the pen away, a contact larger than a palm never draws. A touch stroke is held for the grace period before it commits. If a pen comes near during the stroke or the hold, the stroke is dropped. A touch that Windows cancels as a palm drops its stroke.

## Public API

| Name                                                                  | Use                                                                                   |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `normalizeSample(raw, table?)`, `tiltFromAngles(altitude, azimuth)`   | Each pointer event, before the builder                                                |
| `createStrokeBuilder(options)`                                        | One per stroke: `push`, `snapshot`, `takeCompleted`, `finish`                         |
| `createPalmFilter(settings?)`                                         | One per page view: `pen`, `touchDown`, `touchMove`, `touchEnd`, `heldFate`, `penNear` |
| `resolvePenAction(event, settings)`, `buttonsForPen(saved, deviceId)` | The action chosen at `pointerdown`                                                    |
| `suppressContextMenu(state)`                                          | The `contextmenu` handler for pens                                                    |

## What the interface needs

- Call `palm.pen` for every pen event, hover included, and `palm.penNear(now)` before each frame that changes `data-pen-near`. The page's `touch-action` must be `none` while it returns true, because the browser cannot cancel a native pan once it starts.
- Run a timer that calls `palm.penState(now)` about every 250 ms while the state is hovering or grace, so the watchdog and the grace period end without a pen event. Call `palm.reset()` on a page switch.
- Call `palm.heldFate` for each held touch stroke when its hold ends, and commit it only when the answer is `commit`. Held strokes send no progress record.
- Give the builder the camera cached at contact. Positions are page units, so a scroll mid-stroke must update the cache.
- Read the pen's curve table and steady pen strength from device state, keyed by `persistentDeviceId` when the browser reports one.
- Pass the active tool's width, the palette slot, and the light-theme color from the pen palette. Make stroke IDs with the shared ID generator.
