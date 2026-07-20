#!/usr/bin/env node
// Pre-renders every $...$, $$...$$, and \[...\] math expression in
// index.html to static KaTeX HTML at build time, so browsers never have to
// download/parse/execute katex.min.js. Re-run this (npm run build) any time
// chapter text/math in index.html changes.
//
// IMPORTANT: the rendered output is NOT inlined directly into the live
// prose. KaTeX's HTML+MathML output is extremely verbose (dozens of nested
// spans per formula), and inlining all ~2,400 formulas across 35 chapters
// at once previously ballooned the DOM to ~79,000 elements -- which tripled
// Total Blocking Time (all that markup has to be laid out on first paint)
// and made the Lighthouse accessibility gatherer time out entirely.
//
// Instead, each chapter's rendered formulas are stored in a <template>
// (parsed by the browser but not part of the live DOM/render tree -- zero
// layout cost, not counted by DOM-size or accessibility tooling) with a
// lightweight raw-LaTeX-text placeholder left in the actual prose. A small
// IntersectionObserver in js/main.js clones each chapter's template
// content into its placeholders only as that chapter nears the viewport --
// the same lazy, spread-out-over-the-scroll-session strategy the site
// used before, except hydration is now a cheap DOM clone instead of an
// expensive katex.render() parse.
//
// Only the substring inside each <section class="slab topic-slab"> block is
// touched (found by string index, not re-serialized from a parsed DOM), so
// nothing else in the file is reformatted.

'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const INDEX_HTML = path.join(__dirname, '..', 'index.html');

// katex/contrib/auto-render reads the global `document` directly, so it
// needs one in scope before it's required.
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
  throwOnError: false,
};

let html = fs.readFileSync(INDEX_HTML, 'utf8');

const SLAB_START = '<section class="slab topic-slab"';
let cursor = 0;
let count = 0;
let formulaCount = 0;

while (true) {
  const start = html.indexOf(SLAB_START, cursor);
  if (start === -1) break;
  const end = html.indexOf('</section>', start);
  if (end === -1) throw new Error(`Unclosed topic-slab section at offset ${start}`);
  const sectionEnd = end + '</section>'.length;

  const block = html.slice(start, sectionEnd);

  const wrapper = document.createElement('div');
  wrapper.innerHTML = block;
  renderMathInElement(wrapper, katexOptions);

  // Pull every rendered formula back out into a <template>, leaving a
  // plain-text placeholder (the original LaTeX source, exactly what a
  // visitor would have seen before any JS ran on the very first version of
  // this site) in its place.
  const collected = [];
  const katexSpans = wrapper.querySelectorAll('.katex');
  const seen = new Set();
  katexSpans.forEach((span) => {
    const topNode = span.closest('.katex-display') || span;
    if (seen.has(topNode)) return;
    seen.add(topNode);

    const latex = topNode.querySelector('annotation')?.textContent || '';
    const isDisplay = topNode.classList.contains('katex-display');
    const placeholderText = isDisplay ? `$$${latex}$$` : `$${latex}$`;

    const placeholder = document.createElement('span');
    placeholder.className = 'katex-lazy';
    placeholder.appendChild(document.createTextNode(placeholderText));

    topNode.replaceWith(placeholder);
    collected.push(topNode);
    formulaCount++;
  });

  if (collected.length > 0) {
    const template = document.createElement('template');
    template.className = 'katex-tpl';
    collected.forEach((node) => template.content.appendChild(node));
    // Append inside the <section> itself (wrapper's only child), not
    // wrapper -- otherwise the template ends up as wrapper.innerHTML's
    // trailing sibling of </section> instead of nested inside it, and the
    // runtime hydration script's section.querySelector('template') can't
    // find it.
    wrapper.firstElementChild.appendChild(template);
  }

  const rendered = wrapper.innerHTML;
  html = html.slice(0, start) + rendered + html.slice(sectionEnd);

  cursor = start + rendered.length;
  count++;
}

if (count !== 35) {
  throw new Error(`Expected to pre-render 35 topic-slab sections, found ${count}`);
}

// Runtime KaTeX is no longer needed -- math is now static HTML, hydrated by
// plain DOM cloning (see js/main.js). Remove the CDN script tags and the
// old lazy per-chapter render script (everything from the katex.min.js
// include up to, but not including, the Google Analytics comment that
// follows it). Safe to re-run: no-ops once already removed.
const runtimeStart = html.indexOf('    <script src="https://cdn.jsdelivr.net/npm/katex');
const runtimeEnd = html.indexOf('    <!-- Google Analytics');
if (runtimeStart !== -1 && runtimeEnd !== -1 && runtimeEnd > runtimeStart) {
  html = html.slice(0, runtimeStart) + html.slice(runtimeEnd);
}

fs.writeFileSync(INDEX_HTML, html);
console.log(`Pre-rendered ${formulaCount} formulas across ${count} topic-slab sections (stored in <template> tags, hydrated lazily).`);

// Self-host KaTeX's CSS + the woff2 fonts it references, same-origin, so
// the page no longer depends on jsDelivr's CDN. Every font family this
// content actually uses ships a woff2 file (confirmed: 20 @font-face
// rules, 20 woff2 files in dist/fonts) -- the .woff/.ttf fallback URLs in
// katex.min.css are left as-is (harmless dead links) since no supported
// browser will ever fetch them.
const katexDistDir = path.join(__dirname, '..', 'node_modules', 'katex', 'dist');
const vendorDir = path.join(__dirname, '..', 'css', 'katex');
const fontsDir = path.join(vendorDir, 'fonts');
fs.mkdirSync(fontsDir, { recursive: true });

let css = fs.readFileSync(path.join(katexDistDir, 'katex.min.css'), 'utf8');
// swap instead of block: don't hide already-rendered math text while a font
// file is still loading.
css = css.replace(/font-display:block/g, 'font-display:swap');
fs.writeFileSync(path.join(vendorDir, 'katex.min.css'), css);

const fontFiles = fs.readdirSync(path.join(katexDistDir, 'fonts')).filter((f) => f.endsWith('.woff2'));
for (const file of fontFiles) {
  fs.copyFileSync(path.join(katexDistDir, 'fonts', file), path.join(fontsDir, file));
}
console.log(`Self-hosted katex.min.css + ${fontFiles.length} woff2 fonts into css/katex/.`);
