// The MechDyn kit's start-up words: what its palette commands, window title, and registration read before the kit
// loads. The rest of kitMechDyn.ts joins this object when the kit's code loads (features/engineering/mechdyn/text.ts).
import type { kitMechDyn as all } from './kitMechDyn';

export const kitMechDynStart = {
  linkage: {
    title: 'Linkage analyzer',
    keywords:
      'linkage four-bar fourbar slider-crank inverted slider crank rocker ' +
      'coupler grashof transmission angle freudenstein toggle vector loop ' +
      'coupler curve mechanism',
  },
  cam: {
    title: 'Cam designer',
    keywords:
      'cam follower svaj displacement velocity acceleration jerk cycloidal ' + 'harmonic polynomial pressure angle',
  },
  gears: {
    title: 'Gears and gear trains',
    keywords: 'gear spur involute module diametral pitch contact ratio interference gear train planetary epicyclic',
  },
  compliant: {
    title: 'Compliant mechanisms',
    keywords: 'compliant mechanism flexure pseudo-rigid-body large deflection elastica cantilever living hinge',
  },
  kinetics: {
    title: 'Particle and planar rigid-body dynamics',
    keywords:
      'kinematics kinetics particle polar coordinates normal tangential rigid ' +
      'body instantaneous center impact restitution rolling incline',
  },
  lagrange: {
    title: 'Lagrangian mechanics',
    keywords:
      'lagrange lagrangian euler-lagrange generalized coordinates kinetic ' +
      'energy potential energy equations of motion pendulum double pendulum ' +
      'spring pendulum cart equilibrium small oscillations',
  },
  rigid3d: {
    title: 'Three-dimensional rigid bodies and rotations',
    keywords:
      'rigid body inertia tensor moment of inertia product of inertia ' +
      'parallel axis principal axes euler equations torque-free precession ' +
      'nutation gyroscope rotation matrix euler angles quaternion axis angle ' +
      'gimbal lock',
  },
  sdof: {
    title: 'Single-degree-of-freedom vibration',
    keywords: 'vibration natural frequency damping ratio resonance transmissibility isolation spring mass damper',
  },
  mdof: {
    title: 'Multi-degree-of-freedom and continuous vibration',
    keywords:
      'vibration modes mode shape natural frequencies mass matrix stiffness ' +
      'matrix eigenvalue modal analysis absorber string bar beam cantilever ' +
      'continuous',
  },
  robotdyn: {
    title: 'Robot dynamics and control',
    keywords:
      'robot dynamics mass matrix coriolis centrifugal gravity torque newton ' +
      'euler pd control computed torque trajectory',
  },
  robotkin: {
    title: 'Robot arm kinematics',
    keywords:
      'robot kinematics denavit hartenberg dh table forward inverse jacobian ' +
      'singularity manipulability workspace elbow scara',
  },
  ui: {
    calcBlock: 'Mechanisms and dynamics calculation',
  },
  open: 'Open the mechanisms and dynamics kit',
  keywords: 'mechanisms dynamics vibrations robotics linkage cam gear lagrange robot',
  title: 'Mechanisms and dynamics',
  tabs: 'Mechanisms and dynamics tools',
  loading: 'Loading the tool…',
} as const;

/** The whole namespace as t() sees it. A test checks that these words are the same as in kitMechDyn.ts. */
export const kitMechDyn = kitMechDynStart as unknown as typeof all;
