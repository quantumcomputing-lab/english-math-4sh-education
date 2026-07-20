#!/usr/bin/env node
// One-off: re-encodes img/hero-math.webp at a lower quality (PageSpeed's
// image-delivery-insight flagged ~42KB of recoverable savings here; the 35
// chapter diagrams were already recompressed in a past commit, this one
// wasn't). NOT part of `npm run build` -- webp is already lossy, so running
// this again would re-compress an already-recompressed image and keep
// degrading it. Only run by hand against a fresh source image.

'use strict';
const path = require('path');
const sharp = require('sharp');

const TARGET = path.join(__dirname, '..', 'img', 'hero-math.webp');
const QUALITY = 72; // visually indistinguishable from the original at this size; ~68KB -> ~43KB

sharp(TARGET)
  .webp({ quality: QUALITY })
  .toBuffer()
  .then((buf) => require('fs').writeFileSync(TARGET, buf))
  .then(() => console.log(`Recompressed img/hero-math.webp at quality ${QUALITY}.`));
