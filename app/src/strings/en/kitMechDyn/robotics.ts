// The robotics tools of the mechanisms and dynamics kit: their fields, results, notes, and examples. Part of
// kitMechDyn.
export const robotics = {
  robotdyn: {
    title: 'Robot dynamics and control',
    short: 'Robot dynamics',
    about:
      'The equations of motion of a planar arm of up to three links, and a simulation under a joint-space controller.',
    keywords:
      'robot dynamics mass matrix coriolis centrifugal gravity torque newton euler pd control computed torque ' +
      'trajectory',
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
        'The arm moves in a vertical plane with gravity along −y. Every joint is revolute, and each link is a ' +
        'rigid body.',
      angles: 'Angles are counterclockwise positive. Torques are what each motor applies to the link after it.',
      exact:
        'Computed torque here uses the exact model of the arm, so each joint error follows the linear ' +
        'second-order equation.',
      gains: 'PD gains act on each joint on its own, so the joints still affect one another through M, C, and G.',
    },
    example: {
      points: 'Two links, point masses at the ends, arm level',
      pdg: 'PD with gravity compensation settles on the target',
      pd: 'Plain PD sags under gravity',
      three: 'Three links following a quintic path',
    },
  },
  robotkin: {
    title: 'Robot arm kinematics',
    short: 'Arm kinematics',
    about:
      'Forward and inverse kinematics of a serial arm from its Denavit-Hartenberg table, with the Jacobian and ' +
      'the workspace.',
    keywords:
      'robot kinematics denavit hartenberg dh table forward inverse jacobian singularity manipulability workspace ' +
      'elbow scara',
    field: {
      convention: 'Table form',
      table: 'Denavit-Hartenberg table, one joint per line',
      x: 'Target x',
      y: 'Target y',
      z: 'Target z',
      phi: 'Target end angle, φ',
    },
    option: {
      standard: 'Standard (distal)',
      modified: 'Modified (proximal, Craig)',
    },
    hint: {
      table:
        'Each line: R or P, then a, α, d, θ, and optional limits low and high. Lengths in m (ft), angles in ' +
        'degrees. θ of a revolute joint and d of a prismatic one are its current values.',
      z: 'Ignored for a planar arm, which stays at its own height.',
      phi: 'Used only for a planar arm of three links, where it fixes the end’s direction from +x.',
    },
    row: {
      x: 'End-effector x',
      y: 'End-effector y',
      z: 'End-effector z',
      yaw: 'End frame yaw, about z',
      pitch: 'End frame pitch, about y',
      roll: 'End frame roll, about x',
      detJ: 'Jacobian determinant, det J',
      manipulability: 'Manipulability, w',
      method: 'Inverse kinematics method',
      solutions: 'Inverse kinematics solutions that reach the target',
    },
    word: {
      closed2R: 'Closed form, two links',
      closed3R: 'Closed form, three links',
      numeric: 'Numerical (damped least squares)',
      elbowUp: 'Elbow up',
      elbowDown: 'Elbow down',
      inLimits: 'Within limits',
      outLimits: 'Outside limits',
      r1: 'Row 1',
      r2: 'Row 2',
      r3: 'Row 3',
      r4: 'Row 4',
      vx: 'vx',
      vy: 'vy',
      vz: 'vz',
      wx: 'ωx',
      wy: 'ωy',
      wz: 'ωz',
    },
    table: { ik: 'Inverse kinematics solutions', T: 'End frame transform T', J: 'Geometric Jacobian J' },
    col: {
      solution: 'Solution',
      j1: 'Joint 1',
      j2: 'Joint 2',
      j3: 'Joint 3',
      j4: 'Joint 4',
      j5: 'Joint 5',
      j6: 'Joint 6',
      miss: 'Distance from target',
      limits: 'Joint limits',
      row: 'Row',
      c1: 'Column 1',
      c2: 'Column 2',
      c3: 'Column 3',
      c4: 'Column 4',
    },
    note: {
      standard:
        'Standard form: row i moves frame i − 1 to frame i by Rot(z, θ), Trans(z, d), Trans(x, a), then Rot(x, ' +
        'α). Joint i turns about z of frame i − 1.',
      modified:
        'Modified form: row i moves frame i − 1 to frame i by Rot(x, α), Trans(x, a), Rot(z, θ), then Trans(z, ' +
        'd). Joint i turns about its own z.',
      units:
        'The Jacobian and the manipulability are in SI units: m/rad for a revolute joint, m/m for a prismatic ' +
        'one. Euler angles are ZYX (yaw, pitch, roll).',
      endAngle:
        'This arm is planar with three links, so the inverse kinematics puts the end at (x, y) pointing along φ.',
      planarZ: 'This arm is planar, so the inverse kinematics works in its plane and leaves z as it is.',
      singular: 'The arm is at or near a singularity: it can’t move its end in some direction from here.',
      unreachable: 'The target is out of reach of this arm, so no solution lands on it.',
      limits: 'At least one solution needs a joint outside its limits.',
    },
    example: {
      planar: 'Planar two-link arm and both elbows',
      spatial: 'Spatial three-joint arm',
      modified: 'The same spatial arm in modified form',
      three: 'Planar three-link arm with an end angle',
      scara: 'SCARA arm with a prismatic joint and limits',
    },
  },
};
