// The Aero kit's start-up words: what its palette commands, window title, and registration read before the kit
// loads. The rest of kitAero.ts joins this object when the kit's code loads (features/engineering/aero/text.ts).
import type { kitAero as all } from './kitAero';

export const kitAeroStart = {
  open: 'Open the aerospace tools',
  openKeywords:
    'aerospace aerodynamics gas dynamics propulsion flight mechanics ' + 'compressible airfoil wing rocket jet',
  t: {
    atmosphere: {
      title: 'Standard atmosphere',
      keywords:
        'standard atmosphere isa altitude density altitude pressure altitude speed of sound viscosity lapse rate',
    },
    compressible: {
      title: 'Compressible flow relations',
      keywords:
        'gas dynamics compressible flow isentropic normal shock oblique shock ' +
        'theta beta mach prandtl meyer expansion fanno rayleigh area ratio',
    },
    nozzle: {
      title: 'Nozzle and diffuser flow',
      keywords:
        'converging diverging nozzle de laval choked flow critical pressure ' +
        'ratio normal shock overexpanded underexpanded back pressure mass flow ' +
        'diffuser',
    },
    rocket: {
      title: 'Rocket nozzle performance',
      keywords:
        'rocket nozzle characteristic velocity c star thrust coefficient ' +
        'specific impulse isp optimum expansion area ratio rocket equation ' +
        'tsiolkovsky delta v',
    },
    wing: {
      title: 'Finite wings',
      keywords:
        'finite wing lifting line prandtl glauert induced drag downwash span ' +
        'efficiency oswald elliptic lift distribution taper twist washout ' +
        'aspect ratio',
    },
    performance: {
      title: 'Aircraft performance and static stability',
      keywords:
        'aircraft performance drag polar thrust required power required lift to ' +
        'drag breguet range endurance climb rate glide turn radius load factor ' +
        'neutral point static margin stability',
    },
    potential: {
      title: 'Potential flow',
      keywords:
        'potential flow uniform source sink doublet vortex rankine half body ' +
        'oval cylinder circulation kutta joukowski lift stagnation streamlines ' +
        'stream function complex potential',
    },
    flightmodes: {
      title: 'Aircraft dynamic modes',
      keywords:
        'aircraft dynamic stability modes short period phugoid dutch roll ' +
        'spiral roll subsidence eigenvalues state matrix stability derivatives ' +
        'damping ratio natural frequency',
    },
    jetengine: {
      title: 'Jet engine cycle analysis',
      keywords:
        'jet engine cycle analysis parametric turbojet turbofan ramjet ' +
        'afterburner specific thrust tsfc fuel consumption thermal propulsive ' +
        'overall efficiency bypass ratio compressor pressure ratio station tau ' +
        'pi',
    },
    airfoil: {
      title: 'Airfoils',
      keywords:
        'airfoil aerofoil naca four digit five digit 2412 0012 23012 camber ' +
        'line thickness thin airfoil theory zero lift angle quarter chord ' +
        'moment vortex panel method kutta condition pressure coefficient cp ' +
        'stagnation point section coordinates',
    },
  },
} as const;

/** The whole namespace as t() sees it. A test checks that these words are the same as in kitAero.ts. */
export const kitAero = kitAeroStart as unknown as typeof all;
