// The mechanism tools of the mechanisms and dynamics kit: their fields, results, notes, and examples. Part of
// kitMechDyn.
export const mechanisms = {
  compliant: {
    title: 'Compliant mechanisms',
    short: 'Flexures',
    about:
      'Large deflection of a flexure, solved exactly (the elastica) and by the pseudo-rigid-body model, side by side.',
    keywords: 'compliant mechanism flexure pseudo-rigid-body large deflection elastica cantilever living hinge',
    field: {
      type: 'Flexure',
      length: 'Flexure length, L',
      rigidLength: 'Rigid link beyond the pivot',
      E: 'Young’s modulus, E',
      width: 'Width, w',
      thickness: 'Thickness, t (in the bending direction)',
      force: 'End force, P',
      forceAngle: 'Force direction',
      moment: 'End moment, M₀',
    },
    option: {
      cantilever: 'Cantilever with an end load',
      fixedGuided: 'Fixed-guided beam',
      pivot: 'Small-length flexural pivot',
    },
    hint: {
      forceAngle: 'From the undeformed beam, counterclockwise. 90° is square to the beam.',
    },
    row: {
      I: 'Second moment of area, I',
      EI: 'Bending stiffness, EI',
      loadIndex: 'Load index, PL²/EI',
      exactA: 'Tip x, a (elastica)',
      exactB: 'Tip y, b (elastica)',
      exactAL: 'a/L (elastica)',
      exactBL: 'b/L (elastica)',
      exactTheta: 'End angle, θ₀ (elastica)',
      rootMoment: 'Moment at the root (elastica)',
      K: 'Torsion spring, K (model)',
      Theta: 'Pseudo-rigid angle, Θ (model)',
      prbmA: 'Tip x, a (model)',
      prbmB: 'Tip y, b (model)',
      prbmAL: 'a/L (model)',
      prbmBL: 'b/L (model)',
      prbmTheta: 'End angle, θ₀ (model)',
      positionError: 'Model tip error, of the length',
      bending: 'Bending stress at the root',
      axial: 'Axial stress there',
      stress: 'Largest stress, σ_max',
    },
    note: {
      elastic: 'The material stays linear elastic, and the beam is thin, so shear and stretching are left out.',
      sign: 'The beam starts along +x from a fixed root; angles and moments are counterclockwise positive.',
      prbm: 'The model uses γ = 0.85, K_Θ = 2.65, and c_θ = 1.24, which hold for Θ up to about 64°.',
      prbmRange: 'Θ is beyond about 64°, where the model’s constants lose accuracy. Trust the elastica here.',
    },
    example: {
      index2: 'Cantilever with PL²/EI = 2',
      guided: 'Fixed-guided beam, 2 N',
      pivot: 'Flexural pivot with a rigid link',
    },
  },
};
