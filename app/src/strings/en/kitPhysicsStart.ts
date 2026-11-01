// The Physics kit's start-up words: what its palette commands, window title, and registration read before the kit
// loads. The rest of kitPhysics.ts joins this object when the kit's code loads (features/tools/physics/text.ts).
import type { kitPhysics as all } from './kitPhysics';

export const kitPhysicsStart = {
  open: 'Open physics tools',
  keywords: 'physics fields waves optics relativity nuclear orbits spacecraft',
  waves: {
    open: 'Open the waves and sound tool',
    keywords: 'waves sound string harmonics standing wave pipe organ doppler beats decibels intensity interference',
  },
  relativity: {
    open: 'Open the special relativity tool',
    keywords:
      'relativity lorentz factor gamma time dilation length contraction ' +
      'spacetime simultaneity velocity addition mass energy momentum ' +
      'relativistic doppler redshift',
  },
  waveoptics: {
    open: 'Open the interference, diffraction, and polarization tool',
    keywords:
      'wave optics interference double slit young single slit diffraction ' +
      'grating rayleigh criterion airy thin film soap film coating malus ' +
      'polarizer brewster fresnel reflection jones wave plate circular ' +
      'polarization',
  },
  geooptics: {
    open: 'Open the geometric optics and Gaussian beams tool',
    keywords:
      'geometric optics lens mirror thin lens equation magnification ray ' +
      'diagram snell refraction total internal reflection critical angle ' +
      'lensmaker abcd ray transfer matrix effective focal length back focal ' +
      'length fiber numerical aperture gaussian beam waist rayleigh range ' +
      'laser',
  },
  nuclear: {
    open: 'Open the nuclear science tool',
    keywords:
      'nuclear radioactive decay half-life activity becquerel curie decay ' +
      'chain bateman mass defect binding energy q-value fusion fission ' +
      'reaction attenuation coefficient half-value layer cross section barn ' +
      'shielding dose rate inverse square reactor four-factor six-factor k ' +
      'infinity criticality buckling migration area',
  },
  spacecraft: {
    open: 'Open the spacecraft sizing and link budgets tool',
    keywords:
      'spacecraft rocket equation tsiolkovsky specific impulse staging ' +
      'optimal staging delta-v budget mass budget solar array battery depth ' +
      'of discharge thermal equilibrium temperature absorptivity emissivity ' +
      'attitude disturbance torque gravity gradient solar pressure drag ' +
      'magnetic reaction wheel momentum link budget eirp free-space loss g/t ' +
      'eb/n0 margin antenna gain rfid read range',
  },
  fields: {
    open: 'Open the electric and magnetic fields tool',
    keywords:
      'electromagnetism coulomb law point charge superposition electric field ' +
      'potential field lines equipotential gauss law capacitance capacitor ' +
      'dielectric series parallel biot-savart magnetic field wire loop ' +
      'solenoid toroid ampere law lorentz force cyclotron faraday law induced ' +
      'emf motional emf generator inductance',
  },
  orbits: {
    open: 'Open the orbital mechanics tool',
    keywords:
      'orbital mechanics astrodynamics two-body orbit conic ellipse hyperbola ' +
      'vis-viva period apogee perigee orbital elements state vector ' +
      'semi-major axis eccentricity inclination raan argument of periapsis ' +
      'true anomaly kepler equation eccentric anomaly propagation universal ' +
      'variables ground track j2 nodal regression sun-synchronous eclipse ' +
      'beta angle geostationary',
  },
  maneuvers: {
    open: 'Open the orbital maneuvers and Lambert’s problem tool',
    keywords:
      'orbital maneuver hohmann transfer bi-elliptic plane change inclination ' +
      'change combined maneuver phasing rendezvous lambert problem delta-v ' +
      'budget transfer orbit gto geostationary',
  },
} as const;

/** The whole namespace as t() sees it. A test checks that these words are the same as in kitPhysics.ts. */
export const kitPhysics = kitPhysicsStart as unknown as typeof all;
