'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { Project } = require('../src/live/project');
const R = String.raw;
const engine = process.env.LATEX_HIGHLIGHTER_TEST_ENGINE || (fs.existsSync('/Library/TeX/texbin/pdflatex') ? '/Library/TeX/texbin/pdflatex' : 'pdflatex');
const probe = spawnSync(engine, ['--version'], { timeout: 10000 });
const cases = [
  [R`\appendix\section{Example}Text`],
  [R`\ExplSyntaxOn\cs_new_protected:Npn \example:n #1 {#1}\ExplSyntaxOff $1_2_3$`, 'double-subscript'],
  [R`\ExplSyntaxOn\cs_new_protected:Npn \example:n #1 {#1}\ExplSyntaxOff $1^2^3$`, 'double-superscript'],
  [R`\ExplSyntaxOn $1_2_3$ \ExplSyntaxOff $1_2^3$`],
  [R`$x + \ExplSyntaxOn 1_2_3 \ExplSyntaxOff 1_2_3$`, 'double-subscript'],
  [R`$x_i_j$`, 'double-subscript'], [R`$x^2^3$`, 'double-superscript'],
  [R`$x_{i}^{2}_{j}$`, 'double-subscript'], [R`$x^{a_b}^c$`, 'double-superscript'],
  [R`$x'^2$`], [R`$x'^2^3$`, 'double-superscript'], [R`$x^2'$`, 'double-superscript'],
  [R`$\sum\limits_i^n_j$`, 'double-subscript'], [R`$\frac{a}{b}_i_j$`, 'double-subscript'],
  [R`$x_i^j + x^j_i + x_{i_j} + {x_i}_j + x_i y_j + x_ij_k$`],
  [R`$\frac{x_i}{y_j}_k + \sqrt{x_i}_j + \sqrt[3]{x_i}_j + x_i\,y_j$`],
  [R`$x''_i + f^{\prime\prime} + \left(x_i\right)_j + \sum\limits_i^n x_i$`],
  [R`$x_i\text{words}_j + x_i\quad y_j$`],
  [R`$x\label{eq:x_i_j} + \ref{eq:x_i_j}$`],
  [R`\begin{restatable}[A theorem]{theorem}{myresult}$x_i^j$\end{restatable}\myresult*`, null, true],
  [R`\begin{restatable*}{theorem}{myresult}$x_i^j$\end{restatable*}\myresult`, null, true],
  [R`\begin{theorem}[name={A, B},restate={myresult}]$x_i^j$\end{theorem}\myresult*`, null, true],
];
test('restatements and script diagnostics agree with real TeX', { skip: probe.status !== 0 && 'pdfLaTeX is unavailable', timeout: 120000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'errata-live-real-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const kpse = path.isAbsolute(engine) ? path.join(path.dirname(engine), 'kpsewhich') : 'kpsewhich';
  const restateProbe = spawnSync(kpse, ['thm-restate.sty'], { encoding: 'utf8', timeout: 10000 });
  for (const [body, code, restatement] of cases) {
    await t.test(body, { skip: restatement && (restateProbe.status !== 0 || !restateProbe.stdout.trim()) && 'thm-restate package is unavailable' }, async () => {
      const text = R`\documentclass{article}\usepackage{amsmath}` + (restatement ? R`\usepackage{amsthm,thm-restate}\newtheorem{theorem}{Theorem}` : '') + '\n' + R`\begin{document}` + body + R`\end{document}`;
      const file = path.join(root, 'main.tex'); fs.writeFileSync(file, text);
      const compiled = spawnSync(engine, ['-interaction=nonstopmode', '-no-shell-escape', 'main.tex'], { cwd: root, encoding: 'utf8', timeout: 15000, maxBuffer: 4 * 1024 * 1024 });
      assert.ifError(compiled.error);
      assert.equal(compiled.status !== 0, !!code, compiled.stdout);
      if (code) assert.match(compiled.stdout, new RegExp('Double ' + code.slice(7)));
      const result = await new Project().run({ roots: [root], documents: [{ file, version: 1, text }] });
      assert.deepEqual(result.documents[0].findings.map(f => f.code), code ? [code] : []);
    });
  }
});
