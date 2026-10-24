// Nozzle and diffuser flow: the tool's labels, results, plots, and worked steps (kitAero.t.nozzle).
export const nozzle = {
  title: 'Nozzle and diffuser flow',
  short: 'Nozzle',
  keywords:
    'converging diverging nozzle de laval choked flow critical pressure ratio normal shock overexpanded ' +
    'underexpanded back pressure mass flow diffuser',
  about:
    'A converging-diverging nozzle at any back pressure: whether it chokes, where a shock stands, the exit ' +
    'state, and the mass flow.',
  assume:
    'Quasi-one-dimensional steady flow of a calorically perfect gas, isentropic except across a normal shock. ' +
    'The walls are drawn parabolic for the pressure plot; the results depend only on the area ratio. The gas ' +
    'leaves into a still back pressure. Oblique shocks and expansion fans outside the exit are named but not ' +
    'solved.',
  f: {
    areaRatio: 'Exit to throat area ratio Ae/At',
    throat: 'Throat area At',
    p0: 'Stagnation pressure p₀',
    T0: 'Stagnation temperature T₀',
    pb: 'Back pressure pb',
    gamma: 'Ratio of specific heats γ',
    R: 'Gas constant R',
  },
  h: {
    R: 'Air is 287 J/(kg K).',
  },
  r: {
    pbp0: 'Back pressure ratio pb/p₀',
    c1: 'First critical pb/p₀ (choked, subsonic exit)',
    c2: 'Second critical pb/p₀ (shock at the exit)',
    c3: 'Third critical pb/p₀ (design)',
    Me: 'Exit Mach number Me',
    pe: 'Exit pressure pe',
    Te: 'Exit temperature Te',
    Ve: 'Exit velocity Ve',
    mdot: 'Mass flow ṁ',
    As: 'Shock area ratio As/At',
    xs: 'Shock position along the diverging section (0 throat, 1 exit)',
    M1: 'Mach number ahead of the shock',
    p02p01: 'Stagnation pressure ratio across the shock',
  },
  p: {
    pressure: 'Pressure along the nozzle',
    area: 'Nozzle area',
    x: 'Position: −1 inlet, 0 throat, 1 exit',
    pp0: 'Pressure ratio p/p₀',
    AAt: 'Area ratio A/At',
    shock: 'Shock',
    back: 'Back pressure',
  },
  s: {
    nzFirst:
      'First critical back pressure: the throat just chokes and the whole nozzle stays subsonic. Ae/At = {e} ' +
      'on the subsonic branch gives the exit Mach number.',
    nzThird: 'Third critical (design) back pressure: fully supersonic isentropic flow in the diverging section.',
    nzSecond: 'Second critical back pressure: a normal shock stands exactly at the exit plane.',
    nzSubsonic:
      'pb/p0 = {r} is above the first critical value {c1}, so the throat is not choked and the exit pressure ' +
      'equals pb.',
    nzChokedSub: 'pb/p0 = {r} equals the first critical value: the throat is sonic and the exit is subsonic.',
    nzShockRegime:
      'pb/p0 = {r} lies between the second ({c2}) and first ({c1}) critical values, so a normal shock stands ' +
      'inside the diverging section.',
    nzShockSolve:
      'Place the shock by Brent’s method so that the exit pressure equals pb. The stagnation pressure loss ' +
      'enlarges the sonic area downstream. The shock sits at As/At = {As} after {iterations} iterations.',
    nzShockResult:
      'Mach number just ahead of the shock, the stagnation pressure ratio across it, and the subsonic exit ' +
      'Mach number.',
    nzShockExit: 'pb/p0 = {r} equals the second critical value: the normal shock sits at the exit plane.',
    nzOver:
      'pb/p0 = {r} lies between the design value {c3} and the second critical value {c2}: the nozzle is ' +
      'overexpanded and oblique shocks form outside the exit.',
    nzUnder:
      'pb/p0 = {r} is below the design value {c3}: the nozzle is underexpanded and expansion fans form outside ' +
      'the exit.',
    nzDesign: 'pb/p0 = {r} equals the design value: the jet leaves at the back pressure with no waves.',
    nzMassFlow: 'Mass flow through the sonic throat A* (the throat area when choked).',
  },
  e: {
    backflow: 'The back pressure is above the stagnation pressure, so the flow would run backward.',
  },
  regime: {
    noFlow: 'No flow: the back pressure equals the stagnation pressure.',
    subsonic: 'Subsonic throughout: the throat is not choked (a venturi).',
    chokedSubsonic: 'Choked, with a subsonic exit (first critical point).',
    shockInside: 'Choked, with a normal shock inside the diverging section.',
    shockAtExit: 'Choked, with a normal shock at the exit plane (second critical point).',
    overexpanded: 'Overexpanded: supersonic exit, oblique shocks outside the nozzle.',
    design: 'Design condition: the exit pressure equals the back pressure.',
    underexpanded: 'Underexpanded: supersonic exit, expansion fans outside the nozzle.',
  },
} as const;
