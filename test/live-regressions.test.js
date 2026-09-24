'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Project } = require('../src/live/project');
const R = String.raw;
async function check(text, options = {}) {
  const file = '/tmp/errata-regressions/main.tex';
  const result = await new Project().run({ roots: [path.dirname(file)], documents: [{ file, version: 1, text, options }] });
  return result.documents[0].findings;
}
const prefix = R`\documentclass{article}\usepackage{amsthm,thmtools}\newtheorem{theorem}{Theorem}\begin{document}`;
for (const env of ['restatable', 'restatable*']) {
  test(`${env} defines a global restatement command, while body mistakes and misspellings remain visible`, async () => {
    const body = String.raw`{\begin{${env}}[A theorem]{theorem}{mainresult} $\alhpa$ \end{${env}}} \mainresult* \mainreslut*`;
    const text = prefix + body + R`\end{document}`;
    const findings = await check(text);
    assert.deepEqual(findings.map(f => text.slice(f.start, f.end)), [R`\alhpa`, R`\mainreslut`]);
    assert.ok(findings[1].suggestions.includes('mainresult'));
  });
}
test('key-value theorem restatement defines its command', async () => {
  assert.deepEqual(await check(prefix + R`\begin{theorem}[name={A, B},restate={savedclaim}] $x$ \end{theorem}\savedclaim*\end{document}`), []);
});
test('restatement definitions require the package and follow source order', async () => {
  const declaration = R`\begin{restatable}{theorem}{savedclaim}Text\end{restatable}`;
  const f = await check(R`\savedclaim` + prefix + declaration + R`\savedclaim*\end{document}`);
  assert.equal(f.length, 1); assert.equal(f[0].start, 0);
  assert.equal((await check(declaration + R`\savedclaim`))[0].code, 'unknown-command');
});
test('restatement commands from an unsaved included file update the parent', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'errata-restate-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const main = path.join(root, 'main.tex'), child = path.join(root, 'theorems.tex');
  await fs.writeFile(child, '');
  const documents = [{ file: main, version: 1, text: prefix + R`\input{theorems}\savedclaim*\end{document}` },
    { file: child, version: 2, text: R`\begin{restatable}{theorem}{savedclaim} $x$ \end{restatable}` }];
  const project = new Project();
  assert.ok((await project.run({ roots: [root], documents })).documents.every(d => !d.findings.length));
  documents[1].text = documents[1].text.replace('savedclaim', 'otherclaim'); documents[1].version++;
  assert.equal((await project.run({ roots: [root], documents })).documents[0].findings[0].code, 'unknown-command');
});
for (const [body, token, code] of [
  [R`x_i_j`, '_', 'double-subscript'], [R`x^2^3`, '^', 'double-superscript'],
  [R`x_{i}^{2}_{j}`, '_', 'double-subscript'], [R`x^{a_b}^c`, '^', 'double-superscript'],
  [R`\alpha_i_j`, '_', 'double-subscript'], [R`\frac{a}{b}_i_j`, '_', 'double-subscript'],
  [R`\sum\limits_{i}^{n}_{j}`, '_', 'double-subscript'], [R`x'^2^3`, '^', 'double-superscript'],
  [R`x^2'`, "'", 'double-superscript'],
]) {
  test(`double script highlights only the duplicate token: ${body}`, async () => {
    const text = 'é😀 ' + '$' + body + '$';
    const f = await check(text);
    assert.equal(f.length, 1, JSON.stringify(f)); assert.equal(f[0].code, code);
    assert.equal(f[0].start, text.lastIndexOf(token)); assert.equal(text.slice(f[0].start, f[0].end), token);
    assert.match(f[0].message, /not compiler-confirmed/);
  });
}
test('scripts in align, ensuremath and restatable bodies are checked', async () => {
  for (const text of [R`\begin{align}x_i_j &= y^2^3\end{align}`, R`\ensuremath{x_i_j+y^2^3}`,
    prefix + R`\begin{restatable}{theorem}{claim}$x_i_j+y^2^3$\end{restatable}\end{document}`]) {
    assert.deepEqual((await check(text)).map(f => f.code), ['double-subscript', 'double-superscript']);
  }
});
test('valid nested and separate scripts, prime runs, text, comments and stored bodies stay clear', async () => {
  for (const text of [R`$x_i^j + x^j_i + x_{i_j} + {x_i}_j + x_i y_j + x_ij_k$`,
    R`$\frac{x_i}{y_j}_k + \sqrt{x_i}_j + \sqrt[3]{x_i}_j + x_i\,y_j$`,
    R`$x''_i + x'^2 + f^{\prime\prime} + \left(x_i\right)_j + \sum\limits_i^n x_i$`,
    R`$x_i\text{words}_j + x_i\quad y_j$`, R`$x\label{eq:x_i_j} + \ref{eq:x_i_j}$`,
    R`\newcommand{\ignore}[1]{x} $\ignore{x_i_j}$`, R`Text x_i_j \verb|x_i_j|`,
    R`\newcommand{\stored}{$x_i_j$} % x_i_j
$x_i % comment
^j$`, R`\iffalse $x_i_j$\fi $x_i$`,
    R`\newcommand{\nothing}{} $x_i\nothing_j$`]) {
    assert.deepEqual(await check(text), [], text);
  }
});
test('double script rules honor structure disable and uncertain TeX', async () => {
  assert.deepEqual(await check('$x_i_j$', { structure: false }), []);
  assert.deepEqual(await check(R`\ifnum 1=1 $x_i_j$\fi`), []);
});
