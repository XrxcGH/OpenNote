// The modern physics and astronomy tools: the window's name and the tool list, which the palette needs at start-up.
// The rest of the namespace (kitModPhys/body.ts) joins this object when the window loads; its type is here already,
// so every key type-checks.
import type { kitModPhysBody } from './kitModPhys/body';

const startUp = {
  window: {
    title: 'Modern physics and astronomy',
    open: 'Open the modern physics and astronomy tools',
    keywords: 'quantum atom spectra spin solid semiconductor plasma star sky cosmology telescope',
    tool: 'Tool',
    calculation: 'Calculation',
  },
  tools: {
    plasma: {
      open: 'Open the plasma and space physics tool',
      keywords:
        'debye frequency gyroradius larmor alfven beta sheath bohm magnetosphere magnetopause dipole solar ' +
        'wind fusion lawson',
    },
    stars: {
      open: 'Open the stars and exoplanets tool',
      keywords:
        'star magnitude distance modulus parallax luminosity blackbody planck wien hr diagram saha jeans ' +
        'eddington exoplanet transit',
    },
    cosmos: {
      open: 'Open the cosmology and telescopes tool',
      keywords:
        'hubble redshift friedmann lambda cdm age lookback comoving luminosity angular diameter distance cmb ' +
        'rotation curve nfw dark matter telescope plate scale rayleigh dawes ccd signal noise exposure ' +
        'magnitude',
    },
    spin: {
      open: 'Open the spin and qubits tool',
      keywords:
        'clebsch gordan wigner 3j coupling angular momentum matrices pauli dirac gamma commutator stern ' +
        'gerlach bloch larmor qubit circuit bell grover deutsch',
    },
    atoms: {
      open: 'Open the atoms and spectra tool',
      keywords:
        'hydrogen bohr rydberg balmer lyman spectrum wavelength orbital wavefunction laguerre fine structure ' +
        'term symbol hund microstate lande zeeman selection rule moseley x-ray bragg',
    },
    molecules: {
      open: 'Open the molecular spectra and polymers tool',
      keywords:
        'rotor rotational constant vibration anharmonic morse rovibrational branch isotope pattern exact mass ' +
        'unsaturation nmr multiplet coupling polymer molar dispersity carothers flory huggins chain',
    },
    sky: {
      open: 'Open the sky positions and sun paths tool',
      keywords:
        'julian date sidereal time equation of moon position right ascension declination altitude azimuth ' +
        'ecliptic galactic precession sunrise sunset twilight day length path shadow overhang airmass',
    },
    solids: {
      open: 'Open the solids and semiconductors tool',
      keywords:
        'fermi energy free electron density of states kronig penney band gap tight binding phonon dispersion ' +
        'semiconductor intrinsic doping level mobility hall pn junction depletion diode mos capacitor ' +
        'threshold solar cell fill factor',
    },
    schrodinger: {
      open: 'Open the quantum wells and barriers tool',
      keywords:
        'schrodinger equation infinite finite square well harmonic oscillator morse double bound state ' +
        'eigenvalue wavefunction uncertainty tunneling barrier step transmission reflection transfer matrix ' +
        'resonant wave packet crank nicolson dot gamow wkb',
    },
  },
} as const;

export const kitModPhys = startUp as typeof startUp & typeof kitModPhysBody;
