// A library of equations for rendering tests, grouped by subject. Phase 10 grows it to 200. Each line is plain
// LaTeX that a student or teacher would type, so a rendering change that breaks real notes fails a test.
// A line starting with # names a subject, and blank lines are ignored. Write LaTeX as it is, with single backslashes.

const LIBRARY = String.raw`
# algebra
x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}
(a + b)^n = \sum_{k=0}^{n} \binom{n}{k} a^{n-k} b^k
a^2 - b^2 = (a - b)(a + b)
\log_b(xy) = \log_b x + \log_b y
|x| = \begin{cases} x & x \ge 0 \\ -x & x < 0 \end{cases}
\sqrt[3]{x^3} = x
\frac{a}{b} + \frac{c}{d} = \frac{ad + bc}{bd}
y - y_1 = m(x - x_1)

# calculus
f'(x) = \lim_{h \to 0} \frac{f(x + h) - f(x)}{h}
\int_a^b f(x)\,dx = F(b) - F(a)
\int_{-\infty}^{\infty} e^{-x^2}\,dx = \sqrt{\pi}
e^x = \sum_{n=0}^{\infty} \frac{x^n}{n!}
\frac{d}{dx} \sin x = \cos x
\frac{dy}{dx} = \frac{dy}{du} \cdot \frac{du}{dx}
\iint_D f(x, y)\,dA
\oint_C \vec{F} \cdot d\vec{r} = \iint_S (\nabla \times \vec{F}) \cdot d\vec{S}
\frac{\partial^2 u}{\partial x^2} + \frac{\partial^2 u}{\partial y^2} = 0
\lim_{n \to \infty} \left(1 + \frac{1}{n}\right)^n = e

# trigonometry
\sin^2\theta + \cos^2\theta = 1
e^{i\pi} + 1 = 0
\cos(\alpha \pm \beta) = \cos\alpha\cos\beta \mp \sin\alpha\sin\beta
c^2 = a^2 + b^2 - 2ab\cos C
\tan\theta = \frac{\sin\theta}{\cos\theta}
\widehat{ABC} = 90^\circ

# linear algebra
\begin{pmatrix} a & b \\ c & d \end{pmatrix}
\det\begin{vmatrix} a & b \\ c & d \end{vmatrix} = ad - bc
A\mathbf{x} = \lambda\mathbf{x}
\begin{bmatrix} 1 & 0 \\ 0 & 1 \end{bmatrix}
\|\mathbf{v}\| = \sqrt{\sum_{i=1}^{n} v_i^2}
\mathbf{a} \times \mathbf{b} = \|\mathbf{a}\| \|\mathbf{b}\| \sin\theta\, \hat{n}

# statistics
P(A \mid B) = \frac{P(B \mid A)\,P(A)}{P(B)}
f(x) = \frac{1}{\sigma\sqrt{2\pi}} e^{-\frac{1}{2}\left(\frac{x - \mu}{\sigma}\right)^2}
\bar{x} = \frac{1}{n} \sum_{i=1}^{n} x_i
\binom{n}{k} = \frac{n!}{k!\,(n - k)!}
\operatorname{Var}(X) = E[X^2] - (E[X])^2
\hat{\beta} = (X^T X)^{-1} X^T y

# physics
E = mc^2
F = G \frac{m_1 m_2}{r^2}
i\hbar \frac{\partial}{\partial t} \Psi = \hat{H} \Psi
\nabla \cdot \mathbf{E} = \frac{\rho}{\varepsilon_0}
\nabla \times \mathbf{B} = \mu_0 \mathbf{J} + \mu_0 \varepsilon_0 \frac{\partial \mathbf{E}}{\partial t}
\Delta x\, \Delta p \ge \frac{\hbar}{2}
PV = nRT
\vec{F} = m\vec{a}

# discrete math
\forall x \in \mathbb{R},\ \exists y : y > x
A \cup B = \{x \mid x \in A \lor x \in B\}
\neg(p \land q) \equiv \neg p \lor \neg q
\sum_{i=1}^{n} i = \frac{n(n + 1)}{2}
\prod_{i=1}^{n} i = n!
a \equiv b \pmod{n}
\lfloor x \rfloor \le x < \lfloor x \rfloor + 1

# layout
\text{speed} = \frac{\text{distance}}{\text{time}}
\boxed{x = 5}
\underbrace{1 + 2 + \cdots + n}_{n \text{ terms}}
\begin{aligned} a &= b + c \\ &= d \end{aligned}
\xrightarrow{\text{heat}}
2\,\mathrm{H_2} + \mathrm{O_2} \rightarrow 2\,\mathrm{H_2O}
\dfrac{1}{1 + \dfrac{1}{1 + \dfrac{1}{x}}}
\overset{!}{=}
`;

function parseLibrary(text: string): Record<string, string[]> {
  const subjects: Record<string, string[]> = {};
  let current: string[] = [];
  for (const line of text.split('\n').map((l) => l.trim())) {
    if (line === '') continue;
    if (line.startsWith('#')) {
      current = [];
      subjects[line.slice(1).trim()] = current;
    } else {
      current.push(line);
    }
  }
  return subjects;
}

/** The equations by subject. */
export const EQUATIONS: Readonly<Record<string, readonly string[]>> = parseLibrary(LIBRARY);

/** Every equation in one list. */
export const ALL_EQUATIONS: readonly string[] = Object.values(EQUATIONS).flat();

/** LaTeX that KaTeX rejects, with the position of the first problem. */
export const BROKEN_EQUATIONS: readonly { latex: string; position: number }[] = [
  { latex: String.raw`\frac{1}{2`, position: 10 },
  { latex: String.raw`a + \foo b`, position: 4 },
  { latex: 'x^', position: 1 },
  { latex: String.raw`\begin{pmatrix} 1 & 2`, position: 21 },
  { latex: 'a }', position: 2 },
];
