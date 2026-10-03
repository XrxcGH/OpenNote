// The component gallery's entry point (gallery.html). It starts nothing of the app: no platform, no notes, no
// settings. It reads the theme, the density, and the entry from the address, so each picture is one address.
// The test build includes it. The production build does not.

import '../../styles/layers.css';
import '../../theme/fonts';
import '../../theme/tokens.css';
import '../../styles/base.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { setDensity } from '../../state/layout';
import { Announcer } from '../../ui';
import { Gallery } from './Gallery';
import type { GalleryDensity, GalleryTheme } from './Gallery';
import { entries } from './entries';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

const params = new URLSearchParams(window.location.search);
const theme: GalleryTheme = params.get('theme') === 'dark' ? 'dark' : 'light';
const density: GalleryDensity = params.get('density') === 'touch' ? 'touch' : 'mouse';
document.documentElement.setAttribute('data-theme', theme);
setDensity(density);
window.__OPENNOTE_GALLERY__ = entries.map(({ id, title, group }) => ({ id, title, group }));

createRoot(root).render(
  <StrictMode>
    <Gallery entries={entries} entryId={params.get('entry')} theme={theme} density={density} />
    <Announcer />
  </StrictMode>,
);
