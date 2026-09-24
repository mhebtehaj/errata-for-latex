'use strict';
// Track literal TeX math noads (a base with at most one sub/sup field).
// Macro expansion is deliberately not inferred. An opaque command breaks the
// chain; literal atoms after it are still checked normally.
const TRANSPARENT = new Set('limits nolimits displaylimits displaystyle textstyle scriptstyle scriptscriptstyle relax , ! : ; > quad qquad enspace thinspace negthinspace'.split(' '));
const SYMBOLS = new Set('alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda mu nu xi omicron pi varpi rho varrho sigma varsigma tau upsilon phi varphi chi psi omega Gamma Delta Theta Lambda Xi Pi Sigma Upsilon Phi Psi Omega infty partial nabla ell hbar imath jmath Re Im aleph emptyset sum prod coprod int iint oint lim limsup liminf sup inf max min sin cos tan cot sec csc log ln exp det dim gcd hom ker deg Pr prime lbrace rbrace langle rangle vert Vert lvert rvert lVert rVert lfloor rfloor lceil rceil'.split(' '));
const MATH_ARGUMENTS = new Set('frac dfrac tfrac cfrac binom dbinom tbinom genfrac sqrt overline underline overbrace underbrace hat widehat tilde widetilde bar vec dot ddot acute grave breve check mathrm mathbf mathit mathsf mathtt mathcal mathnormal mathbb mathfrak mathds mathop mathbin mathrel mathord mathopen mathclose mathpunct mathchoice operatorname boldsymbol pmb bm overset underset substack boxed ensuremath'.split(' '));
const { TEXT_ARGUMENTS } = require('../structure');
const fresh = () => ({ sub: false, sup: false, pending: false, primes: false });
class MathScripts {
  constructor(emit) { this.emit = emit; this.reset(); }
  reset() { this.current = fresh(); this.groups = []; this.opaque = false; this.opaqueArguments = false; }
  atom() {
    if (this.current.pending) this.current.pending = false;
    else this.current = fresh();
    this.current.primes = false;
  }
  accept(t, math, def) {
    if (t.kind === 'include') return; // An input does not end the math list.
    if (t.kind === 'open') {
      this.groups.push({ current: this.current, argument: math && this.current.pending, opaque: this.opaque, opaqueArguments: this.opaqueArguments });
      this.opaque ||= this.opaqueArguments;
      this.opaqueArguments = false; this.current = fresh(); return;
    }
    if (t.kind === 'close') {
      const parent = this.groups.pop();
      this.opaque = parent?.opaque || false; this.opaqueArguments = parent?.opaqueArguments || false;
      this.current = parent?.argument ? { ...parent.current, pending: false, primes: false } : fresh();
      return;
    }
    if (['math', 'begin', 'end', 'amp', 'paragraph', 'uncertain'].includes(t.kind)) {
      this.current = fresh(); this.opaqueArguments = false; return;
    }
    if (this.opaque) return;
    this.opaqueArguments = false;
    if (!math) { this.current = fresh(); return; }
    if (t.kind === 'script' || t.kind === 'prime') {
      const key = t.value === '_' ? 'sub' : 'sup';
      // LaTeX collects a prime run and an immediately following ^ argument
      // into one superscript: both f'' and f'^2 are legal.
      if (this.current[key] && !(key === 'sup' && this.current.primes)) {
        const name = key === 'sub' ? 'subscript' : 'superscript';
        this.emit('double-' + name, `Possible double ${name}: this math base already has a ${name}. Combine the scripts or group the intended base. Live source check; not compiler-confirmed.`, t);
      }
      this.current[key] = true;
      this.current.pending = t.kind === 'script';
      this.current.primes = t.kind === 'prime';
      return;
    }
    if (t.kind === 'text') {
      this.atom();
      // In x_ij the i is the script and j starts the next base.
      if ([...t.value].length > 1) this.current = fresh();
    } else if (t.kind === 'ordinary') this.atom();
    else if (t.kind === 'command') {
      if (def?.builtin && TRANSPARENT.has(t.name) && !this.current.pending) { this.current.primes = false; return; }
      if (def?.builtin && SYMBOLS.has(t.name)) this.atom();
      else {
        this.current = fresh();
        this.opaqueArguments = !((def?.builtin && MATH_ARGUMENTS.has(t.name)) || TEXT_ARGUMENTS.has(t.value) || t.name === 'ensuremath' || def?.mathArgument);
      }
    } else if (t.kind === 'definition' || t.kind === 'package' || t.kind === 'class') this.current = fresh();
  }
}
module.exports = { MathScripts };
