// The robotics tools of the mechanisms and dynamics kit: their fields, results, notes, and examples. Part of
// kitMechDyn.
export const robotics = {
  robotdyn: {
    title: 'Robot dynamics and control',
    short: 'Robot dynamics',
    about:
      'The equations of motion of a planar arm of up to three links, and a simulation under a joint-space controller.',
    keywords:
      'robot dynamics mass matrix coriolis centrifugal gravity torque newton euler pd control computed torque trajectory',
    field: {
      links: 'Links, one per line',
      g: 'Gravity, g',
      q: 'Joint angles, q',
      qd: 'Joint rates, q̇',
      qdd: 'Joint accelerations, q̈',
      controller: 'Controller',
      kp: 'Position gain, K_p',
      kd: 'Rate gain, K_d',
      trajectory: 'Reference',
      target: 'Target joint angles',
      moveTime: 'Move time',
      duration: 'Time to simulate',
    },
    option: {
      ct: 'Computed torque',
      pdg: 'PD with gravity compensation',
      pd: 'PD',
      none: 'None (the arm falls)',
      step: 'Step to the target',
      quintic: 'Smooth quintic path to the target',
    },
    hint: {
      links: 'Each line: length, mass, center of mass distance, inertia about it (m, kg, kg·m²; or ft, lb, lb·ft²).',
      q: 'In degrees, one per joint, each measured from the link before (the first from +x).',
      qd: 'In rad/s, one per joint.',
      qdd: 'In rad/s², one per joint.',
      kp: 'Computed torque: in 1/s², so ωₙ = √K_p. PD: in N·m per rad.',
      kd: 'Computed torque: in 1/s, so ζ = K_d/(2√K_p). PD: in N·m·s per rad.',
      target: 'In degrees, one per joint. The simulation starts from the joint angles and rates above.',
    },
    row: {
      tau: 'Torque needed at joint {n}',
      G: 'Gravity torque at joint {n}',
      error: 'Tracking error at the end, joint {n}',
    },
    table: { M: 'Mass matrix M(q)' },
    col: { row: 'Row', c1: 'Column 1', c2: 'Column 2', c3: 'Column 3' },
    word: { r1: 'Row 1', r2: 'Row 2', r3: 'Row 3' },
    note: {
      plane:
        'The arm moves in a vertical plane with gravity along −y. Every joint is revolute, and each link is a rigid body.',
      angles: 'Angles are counterclockwise positive. Torques are what each motor applies to the link after it.',
      exact:
        'Computed torque here uses the exact model of the arm, so each joint error follows the linear second-order equation.',
      gains: 'PD gains act on each joint on its own, so the joints still affect one another through M, C, and G.',
    },
    example: {
      points: 'Two links, point masses at the ends, arm level',
      pdg: 'PD with gravity compensation settles on the target',
      pd: 'Plain PD sags under gravity',
      three: 'Three links following a quintic path',
    },
  },
};
