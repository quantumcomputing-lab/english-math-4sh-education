#!/usr/bin/env node
// Minifies css/style.css (the hand-edited source, left as-is) into
// css/style.min.css, which index.html actually links to. Re-run this
// (npm run build) any time style.css is edited.

'use strict';
const fs = require('fs');
const path = require('path');
const CleanCSS = require('clean-css');

const SRC = path.join(__dirname, '..', 'css', 'style.css');
const OUT = path.join(__dirname, '..', 'css', 'style.min.css');

const source = fs.readFileSync(SRC, 'utf8');
const result = new CleanCSS({ level: 2 }).minify(source);

if (result.errors.length) {
  throw new Error(`clean-css errors: ${result.errors.join('; ')}`);
}

fs.writeFileSync(OUT, result.styles);
console.log(`Minified css/style.css (${source.length} bytes) -> css/style.min.css (${result.styles.length} bytes).`);
