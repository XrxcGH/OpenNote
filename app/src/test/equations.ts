// A library of equations for rendering tests, grouped by subject. Phase 10 grew it to 200, and a test holds it there. Each line is plain
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

# geometry
A = \pi r^2
C = 2\pi r
V = \frac{4}{3}\pi r^3
a^2 + b^2 = c^2
A = \frac{1}{2} b h
s = \frac{a + b + c}{2},\quad A = \sqrt{s(s - a)(s - b)(s - c)}
\frac{a}{\sin A} = \frac{b}{\sin B} = \frac{c}{\sin C}
d = \sqrt{(x_2 - x_1)^2 + (y_2 - y_1)^2}
(x - h)^2 + (y - k)^2 = r^2
\frac{x^2}{a^2} + \frac{y^2}{b^2} = 1
y^2 = 4px
V = \frac{1}{3}\pi r^2 h
A_{\text{surface}} = 4\pi r^2
\cos\theta = \frac{\mathbf{u} \cdot \mathbf{v}}{\|\mathbf{u}\|\,\|\mathbf{v}\|}

# number theory
\gcd(a, b) \cdot \operatorname{lcm}(a, b) = ab
a^{p-1} \equiv 1 \pmod{p}
\phi(n) = n \prod_{p \mid n} \left(1 - \frac{1}{p}\right)
\sum_{d \mid n} \phi(d) = n
\zeta(s) = \sum_{n=1}^{\infty} \frac{1}{n^s}
\zeta(2) = \frac{\pi^2}{6}
n! \sim \sqrt{2\pi n} \left(\frac{n}{e}\right)^n
\binom{n}{k} = \binom{n-1}{k-1} + \binom{n-1}{k}
F_n = F_{n-1} + F_{n-2}
\varphi = \frac{1 + \sqrt{5}}{2}
x \equiv a_i \pmod{m_i},\quad i = 1, \ldots, k
\pi(x) \sim \frac{x}{\ln x}

# sequences and series
S_n = \frac{a(1 - r^n)}{1 - r}
\sum_{n=0}^{\infty} r^n = \frac{1}{1 - r},\quad |r| < 1
a_n = a_1 + (n - 1)d
\sin x = \sum_{n=0}^{\infty} \frac{(-1)^n x^{2n+1}}{(2n+1)!}
\ln(1 + x) = x - \frac{x^2}{2} + \frac{x^3}{3} - \cdots
\sum_{n=1}^{\infty} \frac{1}{n^2} = \frac{\pi^2}{6}
f(x) = \sum_{n=0}^{\infty} \frac{f^{(n)}(a)}{n!} (x - a)^n
\lim_{n \to \infty} \frac{a_{n+1}}{a_n} = L
\sum_{k=1}^{n} k^2 = \frac{n(n + 1)(2n + 1)}{6}
\sum_{k=1}^{n} k^3 = \left(\frac{n(n + 1)}{2}\right)^2
(1 + x)^{\alpha} = \sum_{k=0}^{\infty} \binom{\alpha}{k} x^k
\cos x = 1 - \frac{x^2}{2!} + \frac{x^4}{4!} - \cdots

# complex numbers
z = a + bi
|z| = \sqrt{a^2 + b^2}
e^{i\theta} = \cos\theta + i\sin\theta
z^n = r^n (\cos n\theta + i\sin n\theta)
\bar{z} = a - bi
\oint_C f(z)\,dz = 2\pi i \sum \operatorname{Res}(f, z_k)
f(a) = \frac{1}{2\pi i} \oint_C \frac{f(z)}{z - a}\,dz
\frac{\partial u}{\partial x} = \frac{\partial v}{\partial y},\quad \frac{\partial u}{\partial y} = -\frac{\partial v}{\partial x}
\Gamma(z) = \int_0^{\infty} t^{z-1} e^{-t}\,dt
\sqrt[n]{z} = r^{1/n} e^{i(\theta + 2\pi k)/n}

# differential equations
\frac{dy}{dt} = ky
y(t) = y_0 e^{kt}
\frac{d^2 x}{dt^2} + \omega^2 x = 0
y'' + p(x) y' + q(x) y = 0
\frac{dN}{dt} = rN\left(1 - \frac{N}{K}\right)
\mathcal{L}\{f(t)\} = \int_0^{\infty} e^{-st} f(t)\,dt
\frac{\partial u}{\partial t} = \alpha \frac{\partial^2 u}{\partial x^2}
\frac{\partial^2 u}{\partial t^2} = c^2 \frac{\partial^2 u}{\partial x^2}
\mu(x) = e^{\int p(x)\,dx}
\begin{cases} x' = ax + by \\ y' = cx + dy \end{cases}
\hat{f}(\xi) = \int_{-\infty}^{\infty} f(x) e^{-2\pi i x \xi}\,dx
\frac{dS}{dt} = -\beta SI,\quad \frac{dI}{dt} = \beta SI - \gamma I

# vector calculus
\nabla f = \left(\frac{\partial f}{\partial x}, \frac{\partial f}{\partial y}, \frac{\partial f}{\partial z}\right)
\nabla \cdot \mathbf{F} = \frac{\partial F_x}{\partial x} + \frac{\partial F_y}{\partial y} + \frac{\partial F_z}{\partial z}
\nabla^2 \phi = \frac{\partial^2 \phi}{\partial x^2} + \frac{\partial^2 \phi}{\partial y^2} + \frac{\partial^2 \phi}{\partial z^2}
\iiint_V (\nabla \cdot \mathbf{F})\,dV = \oint_S \mathbf{F} \cdot d\mathbf{S}
\mathbf{r}(t) = \langle x(t), y(t), z(t) \rangle
\int_C f\,ds = \int_a^b f(\mathbf{r}(t)) \|\mathbf{r}'(t)\|\,dt
\frac{D\mathbf{u}}{Dt} = \frac{\partial \mathbf{u}}{\partial t} + (\mathbf{u} \cdot \nabla)\mathbf{u}
\mathbf{F} = -\nabla U
\iint_R f(x, y)\,dx\,dy = \int_a^b \int_{g(x)}^{h(x)} f(x, y)\,dy\,dx
J = \begin{vmatrix} \frac{\partial x}{\partial u} & \frac{\partial x}{\partial v} \\ \frac{\partial y}{\partial u} & \frac{\partial y}{\partial v} \end{vmatrix}

# probability
P(A \cup B) = P(A) + P(B) - P(A \cap B)
E[X] = \sum_i x_i\, p_i
\operatorname{Cov}(X, Y) = E[XY] - E[X]E[Y]
P(X = k) = \binom{n}{k} p^k (1 - p)^{n-k}
P(X = k) = \frac{\lambda^k e^{-\lambda}}{k!}
f(x) = \lambda e^{-\lambda x},\quad x \ge 0
Z = \frac{X - \mu}{\sigma}
\sigma_{\bar{x}} = \frac{\sigma}{\sqrt{n}}
\chi^2 = \sum \frac{(O_i - E_i)^2}{E_i}
t = \frac{\bar{x} - \mu_0}{s / \sqrt{n}}
r = \frac{\sum (x_i - \bar{x})(y_i - \bar{y})}{\sqrt{\sum (x_i - \bar{x})^2 \sum (y_i - \bar{y})^2}}
\Pr(\left|X - \mu\right| \ge k\sigma) \le \frac{1}{k^2}

# chemistry
\mathrm{pH} = -\log_{10} [\mathrm{H}^+]
\mathrm{CH_4} + 2\,\mathrm{O_2} \rightarrow \mathrm{CO_2} + 2\,\mathrm{H_2O}
K_{eq} = \frac{[\mathrm{C}]^c [\mathrm{D}]^d}{[\mathrm{A}]^a [\mathrm{B}]^b}
\Delta G = \Delta H - T \Delta S
\frac{P_1 V_1}{T_1} = \frac{P_2 V_2}{T_2}
k = A e^{-E_a / RT}
\mathrm{NaCl} \rightleftharpoons \mathrm{Na^+} + \mathrm{Cl^-}
M = \frac{n}{V}
\mathrm{pH} = \mathrm{p}K_a + \log_{10} \frac{[\mathrm{A^-}]}{[\mathrm{HA}]}
E = E^{\circ} - \frac{RT}{nF} \ln Q
\Delta T_f = i K_f m
\lambda = \frac{h}{mv}
E_n = -\frac{13.6\ \mathrm{eV}}{n^2}
6\,\mathrm{CO_2} + 6\,\mathrm{H_2O} \xrightarrow{\text{light}} \mathrm{C_6H_{12}O_6} + 6\,\mathrm{O_2}

# engineering
V = IR
P = VI = I^2 R
\tau = RC
Z = R + j\left(\omega L - \frac{1}{\omega C}\right)
f_0 = \frac{1}{2\pi\sqrt{LC}}
H(s) = \frac{Y(s)}{X(s)} = \frac{1}{s^2 + 2\zeta\omega_n s + \omega_n^2}
\sigma = \frac{F}{A}
\varepsilon = \frac{\Delta L}{L_0}
\delta = \frac{F L^3}{3 E I}
Q = \frac{\pi r^4 \Delta P}{8 \eta L}
\eta = 1 - \frac{T_C}{T_H}
\text{SNR}_{\text{dB}} = 10 \log_{10} \frac{P_{\text{signal}}}{P_{\text{noise}}}

# economics and finance
A = P\left(1 + \frac{r}{n}\right)^{nt}
A = Pe^{rt}
\text{PV} = \frac{\text{FV}}{(1 + r)^n}
\text{NPV} = \sum_{t=0}^{n} \frac{C_t}{(1 + r)^t}
\text{ROI} = \frac{\text{gain} - \text{cost}}{\text{cost}}
\varepsilon_d = \frac{\%\Delta Q}{\%\Delta P}
\text{MR} = \text{MC}
Y = C + I + G + (X - M)
\text{GDP deflator} = \frac{\text{nominal GDP}}{\text{real GDP}} \times 100
\pi = \text{TR} - \text{TC}

# computer science
T(n) = 2T\left(\frac{n}{2}\right) + O(n)
O(n \log n)
f(n) = \Theta(g(n))
\sum_{i=1}^{n} \log i = \Theta(n \log n)
H(X) = -\sum_{x} p(x) \log_2 p(x)
\sigma(z) = \frac{1}{1 + e^{-z}}
\text{softmax}(z)_i = \frac{e^{z_i}}{\sum_j e^{z_j}}
\theta \leftarrow \theta - \eta \nabla_\theta J(\theta)
J(\theta) = \frac{1}{2m} \sum_{i=1}^{m} \left(h_\theta(x^{(i)}) - y^{(i)}\right)^2
\hat{y} = \operatorname{argmax}_k\, P(y = k \mid x)
\text{Precision} = \frac{TP}{TP + FP}
h(k) = k \bmod m
\mathbf{y} = W\mathbf{x} + \mathbf{b}
\text{Attention}(Q, K, V) = \text{softmax}\left(\frac{QK^T}{\sqrt{d_k}}\right)V

# logic and sets
A \subseteq B \iff \forall x\,(x \in A \Rightarrow x \in B)
|A \cup B| = |A| + |B| - |A \cap B|
A \setminus B = \{x \in A : x \notin B\}
\mathcal{P}(A) = \{S : S \subseteq A\}
(p \Rightarrow q) \equiv (\neg p \lor q)
\neg \forall x\, P(x) \equiv \exists x\, \neg P(x)
\bigcup_{i=1}^{n} A_i
f : X \to Y,\quad x \mapsto f(x)
\lvert \mathbb{N} \rvert = \aleph_0
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
