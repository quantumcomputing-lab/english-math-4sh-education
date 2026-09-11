#!/usr/bin/env node
// Regenerates quadratic_equations.html's hero reference sheet and its
// 51-row practice grid from the book's own LaTeX source in
// PROJECTS/Book-Academics/tex/gen/*.tex -- so when the book's questions,
// hints, or solutions change, this is the one command that needs
// re-running, instead of hand-editing HTML to match.
//
// Usage:
//   node tools/build-practice-content.js            regenerate the hero
//                                                    reference sheet, plus
//                                                    every problem number
//                                                    the book source has
//   node tools/build-practice-content.js 3 5 12     regenerate the hero
//                                                    plus only these
//                                                    problem numbers
//
// A problem's row starts wired up (its four "Coming soon" placeholders
// become real buttons) the first time this script successfully generates
// its content. Problems whose Level-1/Level-2 hint or solution still
// contains a \bookfigure (a TikZ diagram) are skipped with a warning --
// diagram-to-SVG conversion isn't built yet (see convertBookfigure below);
// re-run once that's added.
//
// Content flows source -> HTML with raw LaTeX ($...$, \[...\]) -> KaTeX
// pre-rendered at build time (same jsdom + katex/contrib/auto-render
// approach as tools/build-katex.js) -> spliced into quadratic_equations.html
// between named HTML-comment markers, so re-running only ever touches the
// regions it owns.

'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const SITE_DIR = path.join(__dirname, '..');
const HTML_PATH = path.join(SITE_DIR, 'quadratic_equations.html');

// Assumes the sibling PROJECTS checkout is at this path (both live under
// /workspace on this machine). Point this elsewhere if that ever changes.
const BOOK_DIR = '/workspace/PROJECTS/Book-Academics/tex/gen';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
global.window = dom.window;
global.document = dom.window.document;
global.Node = dom.window.Node;

const katex = require('katex');
const renderMathInElement = require('katex/contrib/auto-render');

const katexOptions = {
  delimiters: [
    { left: '$$', right: '$$', display: true },
    { left: '\\[', right: '\\]', display: true },
    { left: '$', right: '$', display: false },
  ],
  throwOnError: true,
};

// ── LaTeX -> HTML primitives ──────────────────────────────────────────

// Strips LaTeX comments (an unescaped `%` to end of line) -- most
// commonly seen here as `{%` right after a macro's opening brace, a
// standard whitespace-suppression idiom, not real content.
function stripLatexComments(text) {
  return text.replace(/(^|[^\\])%.*$/gm, '$1');
}

// Finds `{...}` starting at text[startIdx] === '{' and returns its
// content plus the index just past the closing brace, respecting nested
// (non-escaped) braces.
function extractBraceArg(text, startIdx) {
  let depth = 0;
  for (let i = startIdx; i < text.length; i++) {
    const c = text[i];
    const prev = text[i - 1];
    if (c === '{' && prev !== '\\') depth++;
    else if (c === '}' && prev !== '\\') {
      depth--;
      if (depth === 0) return { content: text.slice(startIdx + 1, i), end: i + 1 };
    }
  }
  throw new Error(`Unbalanced braces starting at offset ${startIdx}`);
}

// Scans forward from `cursor`, collecting `argCount` consecutive
// brace-delimited arguments (skipping only whitespace between them).
function extractArgsFrom(text, cursor, argCount) {
  const args = [];
  for (let a = 0; a < argCount; a++) {
    while (/\s/.test(text[cursor])) cursor++;
    if (text[cursor] !== '{') {
      throw new Error(`Expected '{' at offset ${cursor}, found ${JSON.stringify(text[cursor])}`);
    }
    const { content, end } = extractBraceArg(text, cursor);
    args.push(content);
    cursor = end;
  }
  return { args, end: cursor };
}

// Finds every `\macroName{arg1}{arg2}...` call (argCount args) in `text`.
function findMacroCalls(text, macroName, argCount) {
  const results = [];
  const needle = '\\' + macroName;
  let i = 0;
  while (true) {
    const idx = text.indexOf(needle, i);
    if (idx === -1) break;
    const after = idx + needle.length;
    if (/[a-zA-Z]/.test(text[after] || '')) { i = after; continue; } // e.g. \macroNameXYZ, not our macro
    const { args, end } = extractArgsFrom(text, after, argCount);
    results.push({ args, start: idx, end });
    i = end;
  }
  return results;
}

// Reads one macro argument the way real LaTeX does: a {...}-delimited
// group, OR -- for macros invoked without braces at all, e.g. this
// book's `\dispfrac\gamma2` -- a single control sequence (`\gamma`) or a
// single bare character (`2`). extractArgsFrom above is deliberately
// stricter (braces-only) for this file's own structural macros
// (\problementry etc.), which are always brace-called by convention;
// this lenient reader is for real LaTeX macros like \dispfrac that
// authors sometimes invoke with LaTeX's single-token shorthand.
function readLatexArg(text, cursor) {
  while (/\s/.test(text[cursor])) cursor++;
  if (text[cursor] === '{') return extractBraceArg(text, cursor);
  if (text[cursor] === '\\') {
    const m = /^\\[a-zA-Z]+|^\\./.exec(text.slice(cursor));
    if (!m) throw new Error(`Malformed control sequence at offset ${cursor}`);
    return { content: m[0], end: cursor + m[0].length };
  }
  if (cursor >= text.length) throw new Error(`Expected a macro argument at offset ${cursor}, found end of input`);
  return { content: text[cursor], end: cursor + 1 };
}
function readLatexArgs(text, cursor, argCount) {
  const args = [];
  for (let a = 0; a < argCount; a++) {
    const { content, end } = readLatexArg(text, cursor);
    args.push(content);
    cursor = end;
  }
  return { args, end: cursor };
}

// Replaces every `\macroName{arg}` (single-arg) with transform(arg).
function replaceBraceMacro(text, macroName, transform) {
  const needle = '\\' + macroName;
  let result = '';
  let i = 0;
  while (true) {
    const idx = text.indexOf(needle, i);
    if (idx === -1) { result += text.slice(i); break; }
    const after = idx + needle.length;
    if (/[a-zA-Z]/.test(text[after] || '')) { result += text.slice(i, after); i = after; continue; }
    result += text.slice(i, idx);
    const { args, end } = extractArgsFrom(text, after, 1);
    result += transform(args[0]);
    i = end;
  }
  return result;
}

function convertDispfrac(text) {
  const needle = '\\dispfrac';
  let result = '';
  let i = 0;
  while (true) {
    const idx = text.indexOf(needle, i);
    if (idx === -1) { result += text.slice(i); break; }
    result += text.slice(i, idx);
    const { args, end } = readLatexArgs(text, idx + needle.length, 2);
    result += `\\displaystyle\\frac{${args[0]}}{${args[1]}}`;
    i = end;
  }
  return result;
}

function convertAlignStar(text) {
  return text.replace(/\\begin\{align\*\}([\s\S]*?)\\end\{align\*\}/g,
    (_m, inner) => `\\[\\begin{aligned}${inner}\\end{aligned}\\]`);
}

function escapeAngleBrackets(text) {
  return text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Finds a `\begin{envName}[...]...\end{envName}` block starting at or
// after `fromIndex`, tracking nesting depth -- unlike a non-greedy regex,
// this correctly finds the OUTER end even when the same environment
// nests inside itself (e.g. the hero's discriminant bullet has a
// 3-item itemize nested inside the 6-item outer one).
function findEnvironment(text, envName, fromIndex = 0) {
  const beginTag = `\\begin{${envName}}`;
  const endTag = `\\end{${envName}}`;
  const start = text.indexOf(beginTag, fromIndex);
  if (start === -1) return null;
  let i = start + beginTag.length;
  if (text[i] === '[') i = text.indexOf(']', i) + 1; // skip [leftmargin=...] etc.
  const contentStart = i;
  let depth = 1;
  while (depth > 0) {
    const nextBegin = text.indexOf(beginTag, i);
    const nextEnd = text.indexOf(endTag, i);
    if (nextEnd === -1) throw new Error(`Unbalanced \\begin{${envName}} starting at offset ${start}`);
    if (nextBegin !== -1 && nextBegin < nextEnd) { depth++; i = nextBegin + beginTag.length; }
    else { depth--; i = nextEnd + endTag.length; }
  }
  return { content: text.slice(contentStart, i - endTag.length), start, end: i };
}

// Splits an itemize body on `\item` at nesting depth 0 only, so a nested
// `\begin{itemize}...\end{itemize}` block's own `\item`s stay attached to
// their parent item instead of becoming siblings of it.
function splitTopLevelItems(body) {
  const items = [];
  let depth = 0;
  let current = '';
  let i = 0;
  while (i < body.length) {
    if (body.startsWith('\\begin{itemize}', i)) { depth++; current += '\\begin{itemize}'; i += 15; continue; }
    if (body.startsWith('\\end{itemize}', i)) { depth--; current += '\\end{itemize}'; i += 13; continue; }
    if (depth === 0 && body.startsWith('\\item', i) && !/[a-zA-Z]/.test(body[i + 5] || '')) {
      items.push(current);
      current = '';
      i += 5;
      continue;
    }
    current += body[i];
    i++;
  }
  items.push(current);
  return items.map((s) => s.trim()).filter(Boolean);
}

function convertItemize(text) {
  let result = '';
  let i = 0;
  while (true) {
    const env = findEnvironment(text, 'itemize', i);
    if (!env) { result += text.slice(i); break; }
    result += text.slice(i, env.start);
    const items = splitTopLevelItems(env.content);
    const lis = items.map((it) => `<li>${convertItemize(it).trim()}</li>`); // recurse for nested lists
    result += '<ul>\n' + lis.join('\n') + '\n</ul>';
    i = env.end;
  }
  return result;
}

function convertTextFormatting(text) {
  let t = text;
  t = replaceBraceMacro(t, 'textbf', (a) => `<strong>${a}</strong>`);
  t = replaceBraceMacro(t, 'textit', (a) => `<em>${a}</em>`);
  t = replaceBraceMacro(t, 'emph', (a) => `<em>${a}</em>`);
  return t;
}

// \medskip(\noindent)? marks a paragraph break in the book's hint/solution
// prose; anything left over (the common case: no \medskip at all) becomes
// one paragraph.
function wrapParagraphs(text) {
  const normalized = text.replace(/\\medskip\s*\\noindent/g, '\n\n').replace(/\\medskip/g, '\n\n');
  const paras = normalized.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return paras.map((p) => `<p>${p}</p>`).join('\n');
}

// ── TikZ (\bookfigure) subset -> inline SVG + HTML label overlay ──────
// Handles exactly the vocabulary this book's \bookfigure diagrams use:
// horizontal \draw lines (plain, bookaxis-arrowed, single/double-headed
// range arrows), \node point markers (filled/open circle or diamond)
// with an attached label, standalone \node text labels, \draw...plot
// curves, one \fill...plot region (the hero's sign-of-a-quadratic
// figure), and \scope blocks with a yshift for stacked sub-diagrams.
// Anything outside this vocabulary throws (caught by the caller, which
// skips that problem) instead of silently mis-rendering -- extend the
// relevant render* function below if the book introduces a new shape.
//
// Geometry (lines/curves/markers) is drawn as SVG. Every label is
// rendered through this same file's KaTeX pipeline and placed as a
// plain HTML <span>, absolutely positioned (in %, so it tracks the SVG
// at any responsive width) over the SVG -- SVG <text> can't host
// KaTeX's HTML+CSS box model, so this is a deliberate hybrid, not an
// oversight.

const PX_PER_UNIT = 44;

// Finds `[...]` starting at text[startIdx] === '[', respecting nested
// brackets (needed because arrow specs like `{Stealth[length=1.6mm]}-`
// contain their own `[...]` inside a \draw style list's own `[...]`).
function extractBracketArg(text, startIdx) {
  let depth = 0;
  for (let i = startIdx; i < text.length; i++) {
    if (text[i] === '[') depth++;
    else if (text[i] === ']') {
      depth--;
      if (depth === 0) return { content: text.slice(startIdx + 1, i), end: i + 1 };
    }
  }
  throw new Error(`Unbalanced '[' starting at offset ${startIdx}`);
}

function parseCoords(text) {
  return [...text.matchAll(/\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/g)]
    .map((m) => ({ x: parseFloat(m[1]), y: parseFloat(m[2]) }));
}

// A tiny, safe (trusted, book-authored input only) evaluator for the
// plot expressions this book uses, e.g. "0.42*\x*\x + 0.55" or
// "0.4+0.55*sin(\x*180/7)" -- TikZ's sin() takes degrees, like this one.
function evalTikzExpr(expr, xValue) {
  const jsExpr = expr.replace(/\\x/g, 'x');
  // eslint-disable-next-line no-new-func
  const fn = new Function('x', 'sin', `return (${jsExpr});`);
  return fn(xValue, (deg) => Math.sin((deg * Math.PI) / 180));
}

// Renders one diagram label through this file's own text/math pipeline
// (same \hintblank/\hintrel/\dispfrac handling and KaTeX pass as every
// other piece of content), so a label reads identically to prose.
function renderLabelHtml(raw) {
  let t = raw;
  t = convertDispfrac(t);
  t = t.replace(/\\hintblank\b/g, '\\rule[-0.2em]{0.5cm}{1.3pt}');
  t = t.replace(/\\hintrel\b/g, '\\genfrac{}{}{0pt}{1}{\\le}{\\ge}');
  t = escapeAngleBrackets(t);
  // Real LaTeX lets a node label use math commands (\rule, \frac, ...) in
  // text mode without $...$ -- KaTeX's auto-render only fires inside
  // math delimiters, so a label that's ENTIRELY a bare command (no $ at
  // all, e.g. a lone \hintblank) needs one added, or it just renders as
  // literal backslash text. A label that already mixes $...$ with plain
  // words (e.g. "Case $k>0$") is left alone.
  if (t.includes('\\') && !t.includes('$')) t = `$${t}$`;
  return renderKatex(t);
}

function createDiagramContext() {
  return {
    minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity,
    lines: [], markers: [], curves: [], fills: [], overlays: [],
    updateBounds(p) {
      this.minX = Math.min(this.minX, p.x); this.maxX = Math.max(this.maxX, p.x);
      this.minY = Math.min(this.minY, p.y); this.maxY = Math.max(this.maxY, p.y);
    },
  };
}

const MARKER_STYLES = {
  bookpt: { shape: 'circle', filled: true, cls: '' },
  bookptopen: { shape: 'circle', filled: false, cls: '' },
  bookpttarget: { shape: 'diamond', filled: true, cls: 'diagram-neg' },
  bookptopentarget: { shape: 'diamond', filled: false, cls: 'diagram-neg' },
};

function extractLabelOption(styleList) {
  const m = /label\s*=\s*(above|below)\s*:\s*\{/.exec(styleList);
  if (!m) return null;
  const braceStart = styleList.indexOf('{', m.index);
  const { content } = extractBraceArg(styleList, braceStart);
  return { pos: m[1], text: content };
}

function renderNode(styleList, rest, dx, dy, ctx) {
  const m = /^(?:\([^)]*\)\s*)?at\s*\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)\s*(\{)/.exec(rest);
  if (!m) throw new Error(`Unrecognized \\node statement: ${JSON.stringify(rest)}`);
  const braceStart = m.index + m[0].length - 1;
  const { content: nodeContent } = extractBraceArg(rest, braceStart);
  const x = parseFloat(m[1]) + dx;
  const y = parseFloat(m[2]) + dy;
  ctx.updateBounds({ x, y });

  const firstToken = styleList.split(',')[0].trim();
  const marker = MARKER_STYLES[firstToken];
  if (marker) {
    ctx.markers.push({ p: { x, y }, marker });
    const labelOpt = extractLabelOption(styleList);
    if (labelOpt) {
      ctx.overlays.push({
        x, y,
        dyPx: labelOpt.pos === 'below' ? 24 : -24,
        html: renderLabelHtml(labelOpt.text),
        cls: marker.cls,
      });
    }
    return;
  }
  const cls = firstToken === 'bookneg' ? 'diagram-neg' : '';
  ctx.overlays.push({ x, y, dyPx: 0, html: renderLabelHtml(nodeContent), cls });
}

function renderLine(styleList, rest, dx, dy, ctx) {
  const nodeMatch = /^([\s\S]*?)\s*node\[right,\s*booklabel\]\s*\{/.exec(rest);
  let coordPart = rest;
  let endLabel = null;
  if (nodeMatch) {
    coordPart = nodeMatch[1];
    const braceStart = rest.indexOf('{', nodeMatch.index + nodeMatch[0].length - 1);
    endLabel = extractBraceArg(rest, braceStart).content;
  }
  const [c1, c2] = parseCoords(coordPart);
  const p1 = { x: c1.x + dx, y: c1.y + dy };
  const p2 = { x: c2.x + dx, y: c2.y + dy };
  ctx.updateBounds(p1); ctx.updateBounds(p2);

  const tokens = styleList.split(',').map((s) => s.trim());
  const isAxis = tokens.includes('bookaxis');
  let colorClass = '';
  let arrowStart = false;
  let arrowEnd = isAxis;
  for (const tok of tokens) {
    if (tok === 'embersun' || tok === 'bookneg') colorClass = 'diagram-neg';
    if (/^\{Stealth[^}]*\}-\{Stealth[^}]*\}$/.test(tok)) { arrowStart = true; arrowEnd = true; }
    else if (/^\{Stealth[^}]*\}-$/.test(tok)) { arrowStart = true; }
    else if (/^-\{Stealth[^}]*\}$/.test(tok)) { arrowEnd = true; }
  }
  ctx.lines.push({ p1, p2, opts: { colorClass, arrowStart, arrowEnd } });
  if (endLabel) {
    ctx.overlays.push({ x: p2.x, y: p2.y, dxPx: 16, dyPx: 0, html: renderLabelHtml(endLabel) });
  }
}

function renderPlainLine(stmt, dx, dy, ctx) {
  const [c1, c2] = parseCoords(stmt);
  const p1 = { x: c1.x + dx, y: c1.y + dy };
  const p2 = { x: c2.x + dx, y: c2.y + dy };
  ctx.updateBounds(p1); ctx.updateBounds(p2);
  ctx.lines.push({ p1, p2, opts: { colorClass: '', arrowStart: false, arrowEnd: false, thin: true } });
}

function renderCurve(styleList, rest, dx, dy, ctx) {
  const domainM = /domain=(-?[\d.]+):(-?[\d.]+)/.exec(styleList);
  const samplesM = /samples=(\d+)/.exec(styleList);
  const [a, b] = [parseFloat(domainM[1]), parseFloat(domainM[2])];
  const n = samplesM ? parseInt(samplesM[1], 10) : 50;
  const expr = /\{([^}]*)\}/.exec(rest)[1];
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const x = a + ((b - a) * i) / n;
    pts.push({ x: x + dx, y: evalTikzExpr(expr, x) + dy });
  }
  pts.forEach((p) => ctx.updateBounds(p));
  ctx.curves.push({ pts, opts: { cls: styleList.includes('bookcurvealt') ? 'diagram-neg' : '' } });
}

function renderFillPlot(rest, dx, dy, ctx) {
  const m = /^\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)\s*--\s*plot\[([^\]]*)\]\s*\(\\x,\s*\{([^}]*)\}\)\s*--\s*\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)\s*--\s*cycle$/.exec(rest);
  if (!m) throw new Error(`Unrecognized \\fill plot statement: ${JSON.stringify(rest)}`);
  const p0 = { x: parseFloat(m[1]) + dx, y: parseFloat(m[2]) + dy };
  const plotOpts = m[3];
  const expr = m[4];
  const p2 = { x: parseFloat(m[5]) + dx, y: parseFloat(m[6]) + dy };
  const domainM = /domain=(-?[\d.]+):(-?[\d.]+)/.exec(plotOpts);
  const samplesM = /samples=(\d+)/.exec(plotOpts);
  const [a, b] = [parseFloat(domainM[1]), parseFloat(domainM[2])];
  const n = samplesM ? parseInt(samplesM[1], 10) : 50;
  const curvePts = [];
  for (let i = 0; i <= n; i++) {
    const x = a + ((b - a) * i) / n;
    curvePts.push({ x: x + dx, y: evalTikzExpr(expr, x) + dy });
  }
  const allPts = [p0, p2, ...curvePts];
  allPts.forEach((p) => ctx.updateBounds(p));
  ctx.fills.push([p0, ...curvePts, p2]);
}

function renderOneStatement(stmt, dx, dy, ctx) {
  if (stmt.startsWith('\\draw[') || stmt.startsWith('\\fill[')) {
    const isFill = stmt.startsWith('\\fill');
    const { content: styleList, end } = extractBracketArg(stmt, stmt.indexOf('['));
    const rest = stmt.slice(end).trim();
    if (isFill) return renderFillPlot(rest, dx, dy, ctx);
    if (/^plot\b/.test(rest)) return renderCurve(styleList, rest, dx, dy, ctx);
    return renderLine(styleList, rest, dx, dy, ctx);
  }
  if (stmt.startsWith('\\draw ') || stmt.startsWith('\\draw(')) return renderPlainLine(stmt, dx, dy, ctx);
  if (stmt.startsWith('\\node[')) {
    const { content: styleList, end } = extractBracketArg(stmt, stmt.indexOf('['));
    return renderNode(styleList, stmt.slice(end).trim(), dx, dy, ctx);
  }
  throw new Error(`Unsupported TikZ statement: ${JSON.stringify(stmt)}`);
}

// Finds top-level `\begin{scope}[...]...\end{scope}` blocks (not nested,
// in this corpus) and returns them plus their start/end offsets so the
// caller can process the surrounding flat statements separately.
function findScopeBlocks(text) {
  const blocks = [];
  const beginRe = /\\begin\{scope\}(\[[^\]]*\])?/g;
  let m;
  while ((m = beginRe.exec(text))) {
    const contentStart = m.index + m[0].length;
    const endTag = '\\end{scope}';
    const endIdx = text.indexOf(endTag, contentStart);
    if (endIdx === -1) throw new Error('Unbalanced \\begin{scope}');
    blocks.push({ start: m.index, end: endIdx + endTag.length, options: m[1] || '', content: text.slice(contentStart, endIdx) });
    beginRe.lastIndex = endIdx + endTag.length;
  }
  return blocks;
}

function parseShift(options) {
  const my = /yshift=(-?[\d.]+)cm/.exec(options);
  const mx = /xshift=(-?[\d.]+)cm/.exec(options);
  return { dx: mx ? parseFloat(mx[1]) : 0, dy: my ? parseFloat(my[1]) : 0 };
}

function renderStatements(text, dx, dy, ctx) {
  const scopes = findScopeBlocks(text);
  let cursor = 0;
  const flatParts = [];
  for (const sc of scopes) { flatParts.push(text.slice(cursor, sc.start)); cursor = sc.end; }
  flatParts.push(text.slice(cursor));
  for (const stmt of flatParts.join(' ').split(';').map((s) => s.trim()).filter(Boolean)) {
    renderOneStatement(stmt, dx, dy, ctx);
  }
  for (const sc of scopes) {
    const shift = parseShift(sc.options);
    renderStatements(sc.content, dx + shift.dx, dy + shift.dy, ctx);
  }
}

function arrowheadSvg(p, angle, colorClass) {
  const size = 7;
  const a1 = angle + Math.PI - 0.4;
  const a2 = angle + Math.PI + 0.4;
  const p1 = { x: p.x + size * Math.cos(a1), y: p.y + size * Math.sin(a1) };
  const p2 = { x: p.x + size * Math.cos(a2), y: p.y + size * Math.sin(a2) };
  const cls = colorClass ? ` class="${colorClass}"` : '';
  return `<path d="M${p.x.toFixed(1)},${p.y.toFixed(1)} L${p1.x.toFixed(1)},${p1.y.toFixed(1)} L${p2.x.toFixed(1)},${p2.y.toFixed(1)} Z"${cls} fill="currentColor"/>`;
}

function buildDiagramSvg(tikzBody) {
  const ctx = createDiagramContext();
  renderStatements(tikzBody.replace(/\s+/g, ' ').trim(), 0, 0, ctx);

  const PAD_X = 0.5, PAD_TOP = 0.85, PAD_BOTTOM = 0.85;
  const minX = ctx.minX - PAD_X, maxX = ctx.maxX + PAD_X;
  const minY = ctx.minY - PAD_BOTTOM, maxY = ctx.maxY + PAD_TOP;
  const w = (maxX - minX) * PX_PER_UNIT;
  const h = (maxY - minY) * PX_PER_UNIT;
  const toPx = (p) => ({ x: (p.x - minX) * PX_PER_UNIT, y: (maxY - p.y) * PX_PER_UNIT });

  const svgParts = [];
  for (const { p1, p2, opts } of ctx.lines) {
    const a = toPx(p1), b = toPx(p2);
    const cls = opts.colorClass ? ` class="${opts.colorClass}"` : '';
    svgParts.push(`<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}"${cls} stroke="currentColor" stroke-width="${opts.thin ? 1.5 : 2.5}"/>`);
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    if (opts.arrowEnd) svgParts.push(arrowheadSvg(b, angle, opts.colorClass));
    if (opts.arrowStart) svgParts.push(arrowheadSvg(a, angle + Math.PI, opts.colorClass));
  }
  for (const { pts, opts } of ctx.curves) {
    const d = pts.map((p, i) => { const q = toPx(p); return `${i === 0 ? 'M' : 'L'}${q.x.toFixed(1)},${q.y.toFixed(1)}`; }).join(' ');
    const cls = opts.cls ? ` class="${opts.cls}"` : '';
    svgParts.push(`<path d="${d}" fill="none" stroke="currentColor" stroke-width="2.5"${cls}/>`);
  }
  for (const pts of ctx.fills) {
    const d = `${pts.map((p, i) => { const q = toPx(p); return `${i === 0 ? 'M' : 'L'}${q.x.toFixed(1)},${q.y.toFixed(1)}`; }).join(' ')} Z`;
    svgParts.push(`<path d="${d}" fill="var(--crimson)" fill-opacity="0.12"/>`);
  }
  for (const { p, marker } of ctx.markers) {
    const q = toPx(p);
    const cls = marker.cls ? ` class="${marker.cls}"` : '';
    if (marker.shape === 'circle') {
      svgParts.push(`<circle cx="${q.x.toFixed(1)}" cy="${q.y.toFixed(1)}" r="5.5"${cls} fill="${marker.filled ? 'currentColor' : '#fff'}" stroke="currentColor" stroke-width="2"/>`);
    } else {
      const r = 7;
      const d = `M${q.x.toFixed(1)},${(q.y - r).toFixed(1)} L${(q.x + r).toFixed(1)},${q.y.toFixed(1)} L${q.x.toFixed(1)},${(q.y + r).toFixed(1)} L${(q.x - r).toFixed(1)},${q.y.toFixed(1)} Z`;
      svgParts.push(`<path d="${d}"${cls} fill="${marker.filled ? 'currentColor' : '#fff'}" stroke="currentColor" stroke-width="2"/>`);
    }
  }

  const overlayHtml = ctx.overlays.map((o) => {
    const q = toPx({ x: o.x, y: o.y });
    const top = q.y + (o.dyPx || 0);
    const left = q.x + (o.dxPx || 0);
    const cls = o.cls === 'diagram-neg' ? ' diagram-label-neg' : '';
    const align = o.dxPx ? 'left' : 'center';
    const translateX = o.dxPx ? '0' : '-50%';
    return `<span class="diagram-label${cls}" style="left:${((left / w) * 100).toFixed(2)}%; top:${((top / h) * 100).toFixed(2)}%; text-align:${align}; transform:translate(${translateX},-50%);">${o.html}</span>`;
  }).join('\n');

  return `<div class="book-diagram" style="aspect-ratio:${w.toFixed(0)}/${h.toFixed(0)}">
<svg viewBox="0 0 ${w.toFixed(1)} ${h.toFixed(1)}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
${svgParts.join('\n')}
</svg>
${overlayHtml}
</div>`;
}

// Finds every `\bookfigure{Part}{id}{caption}{tikzbody}` call (4
// brace-delimited args, tikzbody itself full of nested braces).
function findBookfigureCalls(text) {
  const results = [];
  let i = 0;
  while (true) {
    const idx = text.indexOf('\\bookfigure', i);
    if (idx === -1) break;
    const { args, end } = extractArgsFrom(text, idx + '\\bookfigure'.length, 4);
    results.push({ args, start: idx, end });
    i = end;
  }
  return results;
}

// Replaces every \bookfigure call with a null-byte placeholder token
// before any other text transform runs (escapeAngleBrackets etc. would
// otherwise mangle the real `<`/`>` characters this function's own SVG
// output legitimately contains), then swaps the rendered diagram back
// in as the very last step.
function extractBookfigurePlaceholders(text) {
  const placeholders = [];
  let result = '';
  let i = 0;
  for (const call of findBookfigureCalls(text)) {
    result += text.slice(i, call.start);
    result += ` BOOKFIG${placeholders.length} `;
    placeholders.push(call.args);
    i = call.end;
  }
  result += text.slice(i);
  return { text: result, placeholders };
}
function restoreBookfigures(text, placeholders) {
  return text.replace(/\s*BOOKFIG(\d+)\s*/g, (_m, idxStr) => {
    const [, , caption, tikzBody] = placeholders[parseInt(idxStr, 10)];
    return `<figure class="book-figure">${buildDiagramSvg(tikzBody)}<figcaption>${renderLabelHtml(caption)}</figcaption></figure>`;
  });
}

// Plain prose -> HTML: question text, "understand the problem" recaps,
// and Level-1 hints (all of which are just paragraphs, no lists/diagrams).
function proseToHtml(latex) {
  const { text: stripped, placeholders } = extractBookfigurePlaceholders(latex);
  let t = stripped;
  t = convertDispfrac(t);
  t = escapeAngleBrackets(t);
  t = convertTextFormatting(t);
  t = wrapParagraphs(t);
  t = restoreBookfigures(t, placeholders);
  return t.trim();
}

// Solution body -> HTML: a single \begin{itemize}...\end{itemize} of
// derivation steps, each possibly containing \[...\]/align* display math.
function solutionToHtml(latex, where) {
  const { text: stripped, placeholders } = extractBookfigurePlaceholders(latex);
  let t = stripped;
  t = convertDispfrac(t);
  t = convertAlignStar(t);
  t = escapeAngleBrackets(t);
  t = convertItemize(t);
  t = convertTextFormatting(t);
  t = restoreBookfigures(t, placeholders);
  return t.trim();
}

// Level-2 hint body -> HTML: usually a diagram (\bookfigure) followed by
// a \begin{forkdiagram}...\end{forkdiagram} of \forkarrow-separated
// worked-solution steps with \hintblank/\hintrel fill-in-the-blank slots.
function forkDiagramToHtml(latex, where) {
  const { text: stripped, placeholders } = extractBookfigurePlaceholders(latex);
  const forkStart = stripped.indexOf('\\begin{forkdiagram}');
  if (forkStart === -1) throw new Error(`${where}: expected a forkdiagram environment, found none`);
  // Any \bookfigure calls sit before \begin{forkdiagram} in this book's
  // sources (the diagram, then the step-by-step blanks below it).
  const diagramHtml = restoreBookfigures(stripped.slice(0, forkStart), placeholders).trim();
  const m = stripped.match(/\\begin\{forkdiagram\}([\s\S]*?)\\end\{forkdiagram\}/);
  const steps = m[1].split(/\\forkarrow/g).map((s) => s.trim()).filter(Boolean);
  const stepsHtml = steps.map((step) => {
    let t = step;
    t = convertDispfrac(t);
    t = t.replace(/\\hintblank\b/g, '\\rule[-0.2em]{0.65cm}{1.5pt}');
    t = t.replace(/\\hintrel\b/g, '\\genfrac{}{}{0pt}{1}{\\le}{\\ge}');
    t = convertAlignStar(t);
    t = escapeAngleBrackets(t);
    t = convertTextFormatting(t);
    return `<div class="fork-step">${t.trim()}</div>`;
  });
  // Drawn entirely in CSS (stem + triangle head), not a text glyph -- see
  // .fork-arrow in css/style.css.
  const stepsBlock = stepsHtml.join('\n<div class="fork-arrow"></div>\n');
  return diagramHtml ? `${diagramHtml}\n${stepsBlock}` : stepsBlock;
}

function renderKatex(htmlString) {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = htmlString;
  renderMathInElement(wrapper, katexOptions);
  return wrapper.innerHTML;
}

// ── Parse the book's four source files ────────────────────────────────

function parseBookSource() {
  const readTex = (name) => stripLatexComments(fs.readFileSync(path.join(BOOK_DIR, name), 'utf8'));
  const partA = readTex('partA_questions.tex');
  const partB = readTex('partB_hints1.tex');
  const partC = readTex('partC_hints2.tex');
  const partD = readTex('partD_solutions.tex');

  const problems = new Map();

  for (const { args } of findMacroCalls(partA, 'problementry', 3)) {
    const n = parseInt(args[0], 10);
    problems.set(n, { question: args[1], understand: args[2] });
  }
  for (const { args } of findMacroCalls(partB, 'hintentry', 3)) {
    const n = parseInt(args[0], 10);
    const p = problems.get(n);
    if (p) p.hint1 = args[2];
  }
  for (const { args } of findMacroCalls(partC, 'hintentry', 3)) {
    const n = parseInt(args[0], 10);
    const p = problems.get(n);
    if (p) p.hint2 = args[2];
  }
  for (const { args } of findMacroCalls(partD, 'solutionentry', 2)) {
    const n = parseInt(args[0], 10);
    const p = problems.get(n);
    if (p) p.solution = args[1];
  }
  return problems;
}

function parseHeroSource() {
  const partE = stripLatexComments(fs.readFileSync(path.join(BOOK_DIR, 'partE_basics.tex'), 'utf8'));
  const start = partE.indexOf('\\section*{Core Identities \\& Formulas}');
  if (start === -1) throw new Error('Could not find "Core Identities & Formulas" section in partE_basics.tex');
  const end = partE.indexOf('\\dividerrule', start);
  const section = partE.slice(start, end === -1 ? undefined : end);
  const itemizeEnv = findEnvironment(section, 'itemize');
  if (!itemizeEnv) throw new Error('Could not find the itemize list inside Core Identities & Formulas');
  const items = splitTopLevelItems(itemizeEnv.content);

  const lis = items.map((raw) => {
    const { text: stripped, placeholders } = extractBookfigurePlaceholders(raw);
    let t = stripped;
    t = convertAlignStar(t);
    t = escapeAngleBrackets(t);
    t = convertItemize(t); // the discriminant bullet has a nested itemize
    t = convertTextFormatting(t);
    t = restoreBookfigures(t, placeholders);
    return `<li>${t.trim()}</li>`;
  });
  return renderKatex(`<ul class="hero-formula-list">\n${lis.join('\n')}\n</ul>`);
}

// ── Build one problem's four templates + activate its grid row ───────

// Same button as every homepage chapter slab's own CTA -- shown at the
// bottom of every question/hint/solution card, since each one is a
// natural moment to offer the crash course.
const CTA_HTML = '<a href="index.html#contact" class="btn-chapter-cta">2-Day Crash Course.<br>Master this Chapter.<br>Click here.</a>';

function buildProblemTemplates(n, data) {
  const questionHtml = `<p class="practice-question"><em>${proseToHtml(data.question)}</em></p>` +
    `<div class="understand-box"><span class="understand-label">Understand the problem</span>${proseToHtml(data.understand)}</div>`;
  const hint1Html = proseToHtml(data.hint1);
  const hint2Html = `<div class="fork-diagram">\n${forkDiagramToHtml(data.hint2, `Problem ${n} hint2`)}\n</div>`;
  const solutionHtml = solutionToHtml(data.solution, `Problem ${n} solution`);

  const parts = [
    ['question', questionHtml],
    ['hint1', hint1Html],
    ['hint2', hint2Html],
    ['solution', solutionHtml],
  ];

  return parts.map(([part, html]) =>
    `    <template id="tpl-${part}-${n}">\n${renderKatex(html)}\n${CTA_HTML}\n    </template>`
  ).join('\n');
}

const CARD_LABEL = {
  question: 'Click to see the question',
  hint1: 'Click to see Hint 1',
  hint2: 'Click to see Hint 2',
  solution: 'Click to see the full solution',
};
const MODAL_TITLE = {
  question: 'Question',
  hint1: 'Hint 1',
  hint2: 'Hint 2',
  solution: 'Full Solution',
};

function buildActiveRow(n) {
  const cards = ['question', 'hint1', 'hint2', 'solution'].map((part) =>
    `                <button type="button" class="practice-card" data-template="tpl-${part}-${n}" data-modal-title="Problem ${n} &mdash; ${MODAL_TITLE[part]}">${CARD_LABEL[part]}</button>`
  ).join('\n');
  return `                <div class="practice-row" data-problem="${n}">\n` +
    `                <div class="practice-num">Problem ${n}</div>\n${cards}\n                </div>`;
}

// ── Splice generated HTML into quadratic_equations.html by marker ────

function replaceMarkerRegion(html, startMarker, endMarker, replacement) {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`Could not find marker region ${startMarker} .. ${endMarker}`);
  }
  return html.slice(0, start + startMarker.length) + '\n' + replacement + '\n' +
    html.slice(end);
}

function main() {
  const requestedNums = process.argv.slice(2).map((s) => parseInt(s, 10)).filter((n) => !Number.isNaN(n));
  let html = fs.readFileSync(HTML_PATH, 'utf8');

  // Hero reference sheet
  const heroHtml = parseHeroSource();
  html = replaceMarkerRegion(html, '<!-- HERO-FORMULAS:START -->', '<!-- END HERO-FORMULAS -->', heroHtml);
  console.log('Rendered hero "Core Identities & Formulas" from partE_basics.tex.');

  // Problems
  const problems = parseBookSource();
  const targetNums = requestedNums.length ? requestedNums : [...problems.keys()].sort((a, b) => a - b);

  let built = 0, skipped = 0;
  for (const n of targetNums) {
    const data = problems.get(n);
    if (!data) { console.warn(`Problem ${n}: not found in book source, skipping.`); skipped++; continue; }
    try {
      const templatesHtml = buildProblemTemplates(n, data);
      html = replaceMarkerRegion(html, `<!-- PRACTICE-TEMPLATES:${n} -->`, `<!-- END PRACTICE-TEMPLATES:${n} -->`, templatesHtml);
      html = replaceMarkerRegion(html, `<!-- PRACTICE-ROW:${n} -->`, `<!-- END PRACTICE-ROW:${n} -->`, buildActiveRow(n));
      built++;
    } catch (err) {
      console.warn(`Problem ${n}: skipped -- ${err.message}`);
      skipped++;
    }
  }

  fs.writeFileSync(HTML_PATH, html);
  console.log(`Built ${built} problem(s), skipped ${skipped}. Wrote ${path.relative(SITE_DIR, HTML_PATH)}.`);
}

main();
