// checks-disable-file modifiability: one catalog of the earth kit's strings, as the lane plan asks for one namespace
// The earth, atmosphere, and ocean sciences kit: its window, palette commands, and shared form text. Step text in
// kitEarthTools.ts shows the governing equation with the numbers put in, so it can be copied into notes.
import type { kitEarthTools } from './kitEarthTools';

const LIGHT = {
  title: 'Earth sciences',
  resultTable: 'Table of values',
  open: 'Open the earth sciences kit',
  keywords: 'earth geology geophysics atmosphere weather ocean climate',
  topic: 'Topic',
  calculation: 'Calculation',
  unitFor: 'Unit for {name}',
  steps: 'Steps',
  quantity: 'Quantity',
  value: 'Value',
  source: 'Source: {source}',
  insertAnswer: 'Insert answer',
  insertMore: 'More ways to insert',
  insertMenu: 'Insert',
  insertEquation: 'Insert the equation',
  insertTable: 'Insert the table',
  insertSteps: 'Insert the answer with its steps',
  insertPicture: 'Insert the picture "{name}"',
  inserted: 'Inserted into the page.',
  noPage: 'Click in a page first, then insert.',
  fill: 'Fill in {name} to see the answer.',
  notNumber: '{name} needs a number, such as 12.5 or 3e-5.',
  cannot: 'These values have no answer. Check each field and try again.',
  errors: {
    rowShort: 'Line {line} needs {count} values.',
    rowNumber: 'Line {line} has "{cell}", which is not a number.',
    rowsNone: 'Paste at least 1 line of values.',
  },
  tools: {
    moist: {
      title: 'Atmospheric thermodynamics and soundings',
      open: 'Open atmospheric thermodynamics and soundings',
      keywords:
        'humidity dew point mixing ratio potential temperature theta-e LCL lapse rate thickness Skew-T CAPE CIN hodograph helicity',
    },
    climate: {
      title: 'Radiation, climate, and footprints',
      open: 'Open radiation, climate, and footprints',
      keywords:
        'energy balance greenhouse radiative forcing climate sensitivity two-box ice-albedo Budyko-Sellers insolation ' +
        'Milankovitch Koppen Walter-Lieth Holdridge Thornthwaite evapotranspiration degree days carbon footprint',
    },
    dating: {
      title: 'Geochronology, isotopes, and the time scale',
      open: 'Open geochronology, isotopes, and the time scale',
      keywords:
        'radiometric age isochron rubidium strontium uranium lead concordia argon plateau radiocarbon ' +
        'calibration delta Rayleigh mixing mineral formula time scale',
    },
    stereonet: {
      title: 'Stereonets and structural geology',
      open: 'Open stereonets and structural geology',
      keywords:
        'stereonet Schmidt Wulff equal-area strike dip pole rake intersection apparent dip three-point fold axis Fisher rose',
    },
    geodiagrams: {
      title: 'Stratigraphy and classification diagrams',
      open: 'Open stratigraphy and classification diagrams',
      keywords:
        'stratigraphic column lithology correlation Harris matrix archaeology ternary diagram soil texture triangle QAPF granite',
    },
    air: {
      title: 'Air quality and weather observations',
      open: 'Open air quality and weather observations',
      keywords:
        'AQI air quality index PM2.5 ozone plume dispersion Pasquill stability ppm METAR TAF station model radar dBZ rain rate',
    },
    seismic: {
      title: 'Seismology and seismic surveys',
      open: 'Open seismology and seismic surveys',
      keywords:
        'earthquake epicenter S-P time Wadati magnitude moment energy Gutenberg-Richter b-value refraction reflection NMO Dix',
    },
    ocean: {
      title: 'Ocean, waves, and planetary flow',
      open: 'Open ocean, waves, and planetary flow',
      keywords:
        'Coriolis geostrophic Ekman Rossby Kelvin seawater density EOS-80 TEOS-10 freezing sound waves dispersion shoaling',
    },
    geophysics: {
      title: 'Gravity, magnetics, heat flow, and plates',
      open: 'Open gravity, magnetics, heat flow, and plates',
      keywords: 'gravity Bouguer anomaly magnetics inclination isostasy geotherm heat flow plate Euler resistivity',
    },
  },
} as const;

/**
 * The whole namespace as t() sees it. Only the window, palette, and shared form text above load at start-up; each
 * tool's text is in kitEarthTools.ts and joins this object when the kit's tools load (features/tools/earth/text.ts).
 */
export const kitEarth = LIGHT as typeof LIGHT & typeof kitEarthTools;
