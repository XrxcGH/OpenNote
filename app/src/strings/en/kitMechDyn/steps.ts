// The worked steps of the mechanisms and dynamics kit, one sentence each, keyed by tool. Part of kitMechDyn.
export const steps = {
  sdofNatural: 'The natural frequency comes from the stiffness and the mass.',
  sdofDamping: 'The damping ratio compares the damping with the critical damping, 2√(km).',
  sdofUndamped: 'With no damping, the mass oscillates forever at the natural frequency.',
  sdofUnder: 'The damping ratio is below 1, so the system is underdamped: it oscillates while the motion dies away.',
  sdofCritical: 'The damping ratio is 1, so the system is critically damped: it returns fastest without oscillating.',
  sdofOver: 'The damping ratio is above 1, so the system is overdamped: it creeps back without oscillating.',
  sdofDamped: 'The damped natural frequency is a little below the undamped one.',
  sdofLogDec: 'The logarithmic decrement is the natural log of the ratio of two successive peaks.',
  sdofRatio: 'The frequency ratio compares the forcing frequency with the natural frequency.',
  sdofAmplitude: 'The steady amplitude is the static deflection times the magnification factor.',
  sdofBase:
    'For base motion, the absolute amplitude uses the transmissibility, and the motion relative to the base uses r².',
  sdofUnbalance: 'For a rotating unbalance, the force grows with the square of the speed.',
  sdofPhase: 'The response lags the forcing by the phase angle.',
  sdofIsolation: 'The transmissibility is {tr}, below 1, so the mount isolates {percent}% of the vibration.',
  sdofNoIsolation:
    'The transmissibility is {tr}, not below 1, so the mount doesn’t isolate. Isolation needs r above √2.',
  sdofImpulse: 'An impulse at t = 0 changes the velocity at once by the impulse divided by the mass.',
  sdofCustom:
    'The response to your force F(t) comes from integrating m x″ + c x′ + k x = F(t) numerically, which is what Duhamel’s integral gives.',
  gearPitchCircles: 'The pitch radii are half the module times the tooth count, and they touch at the center distance.',
  gearBaseCircles:
    'The involute unrolls from the base circle, which is the pitch circle times the cosine of the pressure angle.',
  gearAddendum: 'The addendum circle is the pitch circle plus one addendum.',
  gearContactLength: 'The length of action is where the addendum circles cut the line of action.',
  gearContactRatio: 'The contact ratio is {ratio}, the average number of tooth pairs in contact.',
  gearInterference:
    'At {angle}°, this ratio needs at least {min} pinion teeth, so {whole}. With {teeth}, the gears interfere and are undercut.',
  gearNoInterference:
    'At {angle}° pressure angle this ratio needs at least {min} pinion teeth, so {whole}. With {teeth} teeth there is no interference.',
  gearLowContact:
    'A contact ratio under 1.2 is low, so the mesh may run rough. Use more teeth or a smaller pressure angle.',
  gearForces: 'The tangential force carries the torque, and the radial force pushes the gears apart.',
  trainValue: 'The train value multiplies each mesh’s driver over driven teeth. External meshes reverse the turning.',
  trainReverses: 'The train value is negative, so the output turns the opposite way to the input.',
  trainSameWay: 'The train value is positive, so the output turns the same way as the input.',
  planetTeeth: 'The planets must fit between the sun and the ring.',
  planetLocked: 'Tabular method, row 1: lock the gears and turn everything with the carrier by {x}.',
  planetHeld:
    // checks-disable-next-line length: one message with its select argument, kept whole so the argument is typed
    'Row 2: hold the carrier and turn {member, select, sun {the sun} ring {the ring} other {the fixed member}} back by the same amount, so its total is zero. The others follow the gear ratios.',
  planetWillis: 'Check with the Willis formula: speeds relative to the carrier follow an ordinary train.',
  planetRatio: 'The ratio is the input speed over the output speed.',
  planetSpacingOk: '{count} planets can be spaced equally, because the sun plus ring teeth divide by {count}.',
  planetSpacingBad: '{count} planets can’t be spaced equally, because the sun plus ring teeth don’t divide by {count}.',
  kinRectDerivatives:
    'Differentiate each coordinate with respect to time, once for velocity and twice for acceleration.',
  kinRectValues: 'At t = {t} s, the components are:',
  kinPolarDerivatives: 'Differentiate r and θ with respect to time.',
  kinPolarValues: 'At t = {t} s, the values are:',
  kinPolarVelocity: 'In polar coordinates, the velocity has a radial part and a transverse part.',
  kinPolarAcceleration: 'The acceleration has the centripetal term −rθ̇² and the Coriolis term 2ṙθ̇.',
  kinStraight: 'The velocity and acceleration are parallel here, so the path is straight at this instant.',
  kinNormalTangential:
    'The tangential part changes the speed; the normal part turns the path, with the radius of curvature ρ.',
  kinRelative: 'Find the position of B relative to A.',
  kinRelVelocity: 'Rigid-body velocity: B moves with A plus the rotation about A.',
  kinRelAcceleration: 'Rigid-body acceleration: add the tangential part αk × r and the centripetal part −ω²r.',
  kinTranslation: 'The body doesn’t rotate, so every point has the same velocity and there is no instantaneous center.',
  kinInstantCenter: 'The instantaneous center of zero velocity is where the body seems to pivot at this instant.',
  kinImpactCentral: 'Central impact: the velocities lie along the line of impact.',
  kinImpactOblique:
    'Oblique impact: split each velocity along and across the line of impact. For smooth bodies, the parts across it don’t change.',
  kinMomentum: 'Momentum along the line of impact is conserved.',
  kinRestitution: 'The coefficient of restitution relates the speeds of separation and approach.',
  kinImpactSolve: 'Solve the two equations together for the velocities after impact.',
  kinEnergyLost: 'The kinetic energy lost goes into deformation, heat, and sound.',
  kinRollingEquations: 'Newton’s second law for the center, and for rotation about it, with rolling without slipping.',
  kinRollingAcceleration: 'Solve for the acceleration of the center.',
  kinRollingGrips: 'Rolling needs a friction coefficient of at least {needed}.',
  kinRollingSlips:
    'Rolling needs a friction coefficient of at least {needed}, but μ is {mu}, so the body slips as it rolls.',
  kinRollingEnergy:
    'Check by work and energy: the drop in potential energy becomes translational and rotational energy.',
  kinSlidingSpeed: 'While it slips, kinetic friction sets the acceleration, and energy is lost to friction.',
  camLaw_harmonic: 'Simple harmonic motion: smooth velocity, but the acceleration jumps at the ends of each segment.',
  camLaw_cycloidal: 'Cycloidal motion: velocity and acceleration are both zero at the ends, so the jerk stays finite.',
  camLaw_poly345:
    '3-4-5 polynomial: zero velocity and acceleration at both ends, with a lower peak velocity than cycloidal.',
  camLaw_poly4567: '4-5-6-7 polynomial: zero jerk at the ends too, for the smoothest start and stop.',
  camPeaks: 'The largest values over the whole cycle, per radian of cam rotation:',
  camPerSecond: 'Multiply by the cam speed (once for velocity, twice for acceleration) to get values per second.',
  camPressure: 'The largest pressure angle is {angle}° at a cam angle of {at}°.',
  camPressureHigh: 'That is over 30°, so a translating follower may bind. Use a larger base circle or a longer rise.',
  camCurvature:
    'The smallest convex radius of curvature of the cam surface is {rho} mm at {at}°, so the cam isn’t undercut.',
  camUndercut:
    'At {at}°, the cam would need a radius of curvature of {rho} mm, so it’s undercut. Use a larger base circle or a smaller roller.',
  camFlatPressure: 'A flat-faced follower has a pressure angle of zero, because its face is square to its stem.',
  camFlatCurvature: 'The smallest radius of curvature is {rho} mm at {at}°, so the cam has no cusps.',
  camCusp:
    'The radius of curvature drops to {rho} mm at {at}°, so the cam would have a cusp. Use a larger base circle.',
  camFaceWidth:
    'The contact point moves up to {width} mm from the stem, so the face must reach at least that far each side.',
  mdofEquation: 'Free vibration in a mode: every mass moves in step at one frequency, so K − ω²M must be singular.',
  mdofCharacteristic: 'With two degrees of freedom, the determinant is a quadratic in ω².',
  mdofEigen: 'With {n} degrees of freedom, solve the generalized eigenproblem K𝛟 = ω²M𝛟 numerically.',
  mdofFrequencies: 'The natural frequencies, lowest first:',
  mdofNormalize: 'Each mode shape is scaled so that 𝛟ᵀM𝛟 = 1 (mass-normalized):',
  mdofModalDamping:
    'The damping matrix is used through each mode’s damping ratio, which is exact for proportional damping and approximate otherwise.',
  mdofForced: 'The steady amplitude of each mass under the harmonic force:',
  mdofBeamEquation: 'The end conditions give the frequency equation of the beam:',
  mdofBeamRoots: 'Its roots, found numerically:',
  mdofBeamFrequency: 'Each root gives a natural frequency:',
  mdofRigidModes: 'A free-free beam also has two rigid-body modes at zero frequency, which aren’t listed.',
  mdofStringSpeed: 'Waves on the string travel at this speed:',
  mdofBarSpeed: 'Axial waves in the bar travel at this speed:',
  mdofShaftSpeed: 'Torsional waves in the shaft travel at this speed:',
  mdofAxialHalf: 'Both ends alike, so a whole number of half waves fits the length.',
  mdofAxialQuarter: 'One end fixed and one free, so an odd number of quarter waves fits the length.',
  mdofFirstFrequency: 'The lowest natural frequency is {f} Hz.',
  compliantSection: 'The rectangular section gives the second moment of area and the bending stiffness.',
  compliantElastica:
    'The elastica: the curvature follows the bending moment along the beam. Shoot on the root moment until the tip load balances.',
  compliantElasticaResult: 'The elastica gives the tip position and the end angle:',
  compliantPrbmSpring:
    'Pseudo-rigid-body model: a rigid link of length γL pinned at the characteristic pivot, with a torsion spring of stiffness K.',
  compliantGuidedSpring:
    'A fixed-guided flexure bends in an S shape, so model each half as a cantilever of length L/2 with its own pivot and spring.',
  compliantPivotSpring: 'A short flexural pivot acts like a pin at its middle with a torsion spring K = EI/l.',
  compliantBalance:
    'The spring torque balances the moment of the load about the pivot. Solve for the pseudo-rigid angle Θ:',
  compliantPrbmTip: 'The link end gives the tip position, and the end angle is c_θ times Θ:',
  compliantGuidedTip: 'The two halves give the tip position, and the guided end doesn’t turn:',
  compliantOutOfRange: 'Θ is beyond about 64°, where the published constants lose accuracy. Trust the elastica here.',
  compliantCompare: 'The two tip positions differ by {percent}% of the length.',
  compliantStress: 'The largest stress adds the bending stress at the largest moment to the axial stress there.',
  robotDynEquation: 'The equations of motion of the arm, one row per joint:',
  robotDynMass: 'The mass matrix, found by asking Newton-Euler for the torques of each unit joint acceleration:',
  robotDynCoriolis: 'The Coriolis and centrifugal matrix, from the Christoffel symbols of M:',
  robotDynGravity: 'The gravity torques, from Newton-Euler with the arm at rest:',
  robotDynTorque: 'The torques needed for the given rates and accelerations:',
  robotDynPd: 'PD control: τ = K_p e + K_d ė with K_p = {kp} and K_d = {kd}. Gravity pulls the arm off the target.',
  robotDynPdg: 'PD control with gravity compensation: τ = K_p e + K_d ė + G(q), with K_p = {kp} and K_d = {kd}.',
  robotDynCt:
    'Computed torque: τ = M(q)(q̈_d + K_d ė + K_p e) + C q̇ + G, with K_p = {kp} and K_d = {kd}. Each joint error is then linear.',
  robotDynCtError: 'Each error decays like a mass-spring-damper with ω_n = √K_p and ζ = K_d/(2√K_p):',
  robotDynFree: 'No control: the arm falls freely under gravity.',
  linkLoop: 'Write the vector loop around the four links:',
  linkGrashof_crankRocker:
    'Grashof: the shortest plus longest ({s} + {l} = {sl}) is less than the other two ({pq}). The crank is shortest: a crank-rocker.',
  linkGrashof_rockerCrank:
    'Grashof: s + l = {sl} is less than p + q = {pq}. The shortest link is the output, so the output turns fully and the input rocks.',
  linkGrashof_doubleCrank:
    'Grashof: s + l = {sl} is less than p + q = {pq}. The shortest link is the ground, so both cranks turn fully (a drag link).',
  linkGrashof_doubleRocker:
    'Grashof: s + l = {sl} is less than p + q = {pq}. The shortest link is the coupler, so both side links rock.',
  linkGrashof_changePoint:
    'Special case: s + l = p + q = {pq}. The linkage reaches change points where all links line up and the motion can switch circuits.',
  linkGrashof_tripleRocker:
    'Non-Grashof: s + l = {sl} is more than p + q = {pq}, so no link turns fully. It is a triple rocker.',
  linkConstants: 'The Freudenstein constants:',
  linkTheta4:
    // checks-disable-next-line length: one message with its select argument, kept whole so the argument is typed
    'Solve the quadratic in tan(θ₄/2) for the output angle. The {circuit, select, open {open} other {crossed}} circuit takes the {circuit, select, open {minus} other {plus}} sign.',
  linkTheta3: 'Solve the matching quadratic for the coupler angle:',
  linkVelocity: 'Differentiate the loop once and solve the two equations for the angular velocities:',
  linkAcceleration: 'Differentiate again and solve the same matrix for the angular accelerations:',
  linkTransmission: 'The transmission angle between coupler and rocker is {angle}°.',
  linkTransmissionLow: 'That is below 40°, so the linkage transmits force poorly here and may bind.',
  linkToggles: 'Found {count} toggle positions, where the crank and coupler line up and the rocker stops to turn back.',
  linkResidual: 'Check: the vector loop closes to within {residual} of the longest link.',
  linkSliderPosition: 'The slider position follows from the triangle formed by the crank, the rod, and the offset:',
  linkSliderVelocity: 'Differentiate for the rod’s angular velocity and the slider velocity:',
  linkSliderAcceleration: 'Differentiate again for the accelerations:',
  linkStroke: 'The stroke is {stroke} m, between the two dead centers where crank and rod line up.',
  linkSliderLimited: 'The rod is too short for the crank and offset, so the crank can’t turn fully.',
  linkInvertedGeometry: 'The block at A slides along link 4, so link 4 points from O₄ toward A:',
  linkInvertedVelocity: 'The turning rate of link 4 and the sliding speed of the block:',
  linkInvertedAcceleration: 'The accelerations, with the Coriolis term 2ḃω₄ that sliding on a turning link adds:',
  robotKinAStandard: 'Link {i}, standard form: A = Rot(z, θ) Trans(z, d) Trans(x, a) Rot(x, α).',
  robotKinAModified:
    'Link {i}, modified form: A = Rot(x, α) Trans(x, a) Rot(z, θ) Trans(z, d), with the previous link’s length and twist.',
  robotKinProduct: 'Multiply the link transforms in order for the pose of the end frame:',
  robotKinPosition: 'The last column is the end-effector position:',
  robotKinPlanarDet:
    'For a planar two-link arm, the Jacobian’s determinant is zero when the arm is straight or folded.',
  robotKinManipulability: 'The manipulability measure is {w}. It drops to zero at a singularity.',
  robotKinSingular: 'The arm is at or near a singularity here: it can’t move its end in some direction.',
  robotKinWrist: 'Back off the last link along the end angle to find the wrist point:',
  robotKinCosines: 'The law of cosines gives the elbow angle:',
  robotKinElbows: 'Each sign of the elbow angle gives one solution (elbow up and elbow down):',
  robotKinDls:
    'Numerical inverse kinematics: damped least squares, from the current joint values and two other starts, within the joint limits.',
  robotKinUnreachable: 'The target is out of reach, so no solution lands on it.',
  lagrangeL: 'Form the Lagrangian, the kinetic energy minus the potential energy:',
  lagrangePartials:
    'For {q}, take the partial derivatives of L with respect to {q} and its rate, then the time derivative of the second:',
  lagrangeEquation: 'Lagrange’s equation for {q}: d/dt(∂L/∂q̇) − ∂L/∂q = Q, which gives:',
  lagrangeExplicit: 'Solved for the acceleration:',
  lagrangeMass: 'Written as M(q) q̈ = f(q, q̇, t), with the mass matrix:',
  lagrangeStable: 'An equilibrium at ({q}) is stable; small oscillations there have ω = {w} rad/s.',
  lagrangeUnstable: 'An equilibrium at ({q}) is unstable: a small push grows.',
  lagrangeEnergy:
    'Check: the total energy changed by a fraction {drift} over the simulation, so the integration conserves it.',
  lagrangePeriod: 'The simulated period is {period} s, which is {ratio} times the small-angle period.',
};
