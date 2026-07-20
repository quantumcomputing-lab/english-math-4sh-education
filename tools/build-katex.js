#!/usr/bin/env node
// Pre-renders every $...$, $$...$$, and \[...\] math expression in
// index.html to static KaTeX HTML at build time, so browsers never have to
// download/parse/execute katex.min.js at runtime. Re-run this (npm run
// build) any time chapter text/math in index.html changes.
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
  const rendered = wrapper.innerHTML;

  html = html.slice(0, start) + rendered + html.slice(sectionEnd);

  cursor = start + rendered.length;
  count++;
}

if (count !== 35) {
  throw new Error(`Expected to pre-render 35 topic-slab sections, found ${count}`);
}

// Runtime KaTeX is no longer needed -- math is now static HTML. Remove the
// CDN script tags and the lazy per-chapter render script (everything from
// the katex.min.js include up to, but not including, the Google Analytics
// comment that follows it). Safe to re-run: no-ops once already removed.
const runtimeStart = html.indexOf('    <script src="https://cdn.jsdelivr.net/npm/katex');
const runtimeEnd = html.indexOf('    <!-- Google Analytics');
if (runtimeStart !== -1 && runtimeEnd !== -1 && runtimeEnd > runtimeStart) {
  html = html.slice(0, runtimeStart) + html.slice(runtimeEnd);
}

fs.writeFileSync(INDEX_HTML, html);
console.log(`Pre-rendered math in ${count} topic-slab sections; removed runtime KaTeX <script> tags.`);

// Self-host KaTeX's CSS + the woff2 fonts it references, same-origin, so
// the page no longer depends on jsDelivr's CDN (a separate DNS/TLS
// round-trip that PageSpeed flagged as the biggest render-blocking cost on
// mobile). Every font family this content actually uses ships a woff2 file
// (confirmed: 20 @font-face rules, 20 woff2 files in dist/fonts) -- the
// .woff/.ttf fallback URLs in katex.min.css are left as-is (harmless dead
// links) since no supported browser will ever fetch them.
const katexDistDir = path.join(__dirname, '..', 'node_modules', 'katex', 'dist');
const vendorDir = path.join(__dirname, '..', 'css', 'katex');
const fontsDir = path.join(vendorDir, 'fonts');
fs.mkdirSync(fontsDir, { recursive: true });

let css = fs.readFileSync(path.join(katexDistDir, 'katex.min.css'), 'utf8');
// swap instead of block: don't hide already-static math text while a font
// file is still loading (font-display-insight's remaining flagged cost).
css = css.replace(/font-display:block/g, 'font-display:swap');
fs.writeFileSync(path.join(vendorDir, 'katex.min.css'), css);

const fontFiles = fs.readdirSync(path.join(katexDistDir, 'fonts')).filter((f) => f.endsWith('.woff2'));
for (const file of fontFiles) {
  fs.copyFileSync(path.join(katexDistDir, 'fonts', file), path.join(fontsDir, file));
}
console.log(`Self-hosted katex.min.css + ${fontFiles.length} woff2 fonts into css/katex/.`);
