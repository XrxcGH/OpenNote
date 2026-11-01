// The Control kit's start-up words: what its palette commands, window title, and registration read before the kit
// loads. The rest of kitControl.ts joins this object when the kit's code loads (features/engineering/control/text.ts).
import type { kitControl as all } from './kitControl';

export const kitControlStart = {
  distributions: {
    title: 'Probability distributions and inference',
    tab: 'Probability',
    keywords:
      'probability distribution binomial poisson geometric hypergeometric ' +
      'normal lognormal exponential gamma weibull uniform beta student t chi ' +
      'square f quantile confidence interval hypothesis test p value welch ' +
      'paired goodness of fit power statistics',
  },
  markov: {
    title: 'Markov chains and queues',
    tab: 'Markov chains',
    keywords:
      'markov chain transition matrix stationary distribution absorbing ' +
      'fundamental matrix first passage generator continuous time gambler ' +
      'ruin queue mm1 mmc little law utilization',
  },
  reliability: {
    title: 'Reliability, quality, and inventory',
    tab: 'Reliability',
    keywords:
      'reliability hazard mttf series parallel k out of n block diagram ' +
      'weibull exponential life control chart xbar range p chart c chart ' +
      'process capability cp cpk acceptance sampling operating characteristic ' +
      'aoq inventory economic order quantity eoq safety stock reorder point ' +
      'quality',
  },
  digital: {
    title: 'Digital control',
    tab: 'Digital',
    keywords:
      'digital control sampling discretize zero order hold zoh tustin ' +
      'bilinear prewarp matched pole zero z transform difference equation ' +
      'jury stability unit circle z plane root locus aliasing nyquist digital ' +
      'pid',
  },
  statespace: {
    title: 'State-space design',
    tab: 'State space',
    keywords:
      'state space controllability observability rank canonical form pole ' +
      'placement ackermann observer estimator separation principle lqr ' +
      'riccati optimal control integral action',
  },
  stochastic: {
    title: 'Random processes and Kalman filtering',
    tab: 'Random processes',
    keywords:
      'random process stochastic white noise brownian motion wiener ornstein ' +
      'uhlenbeck sde euler maruyama covariance lyapunov power spectral ' +
      'density psd autocorrelation variance kalman filter riccati estimation',
  },
  rootlocus: {
    title: 'Root locus and Routh-Hurwitz',
    tab: 'Root locus',
    keywords:
      'root locus routh hurwitz array stability epsilon row of zeros ' +
      'auxiliary polynomial gain range asymptotes centroid breakaway break in ' +
      'departure arrival angle imaginary axis crossing damping ratio design',
  },
  frequency: {
    title: 'Frequency response: Bode and Nyquist',
    tab: 'Bode and Nyquist',
    keywords:
      'frequency response bode plot magnitude phase asymptote corner gain ' +
      'margin phase margin crossover bandwidth resonant peak nyquist plot ' +
      'encirclement criterion time delay',
  },
  systems: {
    title: 'System models and responses',
    tab: 'Systems',
    keywords:
      'dynamic system model transfer function zero pole gain state space mass ' +
      'spring damper rlc circuit dc motor thermal tank analogy block diagram ' +
      'step impulse ramp response rise time peak time overshoot settling time ' +
      'final value theorem steady state error system type identification ' +
      'first order plus dead time',
  },
  compensator: {
    title: 'Compensator and PID design',
    tab: 'Compensators',
    keywords:
      'compensator design lead lag phase margin error constant root locus ' +
      'design damping ratio settling time pid tuning ziegler nichols ultimate ' +
      'gain simc imc controller lead-lag',
  },
  open: 'Open the dynamics and control tools',
  keywords:
    'dynamics control feedback transfer function root locus bode nyquist ' +
    'state space digital probability statistics markov queue reliability ' +
    'stochastic kalman',
  title: 'Dynamics and control',
  tabs: 'Dynamics and control tools',
  loading: 'Loading the tool…',
} as const;

/** The whole namespace as t() sees it. A test checks that these words are the same as in kitControl.ts. */
export const kitControl = kitControlStart as unknown as typeof all;
