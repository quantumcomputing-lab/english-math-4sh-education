#!/usr/bin/env python3
"""
Layout calculator for chapter slab-text blocks -- NOT a real renderer.

There is no browser, headless or otherwise, available in this environment
(checked: chrome/chromium/firefox/wkhtmltoimage/weasyprint/playwright/
selenium -- none installed, no network to fetch one). This estimates each
chapter's rendered text height by simulating CSS text-wrapping against the
actual font-size/line-height/padding values in css/style.css, so height
decisions for .slab-image are based on a real (if approximate) computation
instead of a guess.

Calibration / known limitations:
- CHAR_W = 0.50 is a standard typography heuristic for average character
  width (including spaces) in a serif face at a given font-size, in em
  units. Real Georgia metrics vary (~0.45-0.52 depending on the actual
  letter mix), so treat outputs as +/-15%, not exact pixels.
- Word-wrapping is approximated at the character level (chars-per-line),
  not word-boundary-aware, which tends to slightly OVER-estimate height
  (real wrapping wastes a bit of space at line ends, meaning slightly
  fewer real characters fit per line than this assumes -- so this errs
  toward predicting a chapter as taller than it will actually render,
  which is the safer direction for setting an image height that must not
  fall short).
- Font-size/line-height/padding constants below are hand-copied from
  css/style.css at the time of writing. If those rules change, update the
  constants here too -- this script does not read the stylesheet itself.

Usage: python3 tools/layout_calc.py [chapter_start] [chapter_end] [col_width_px]
Defaults to chapters 1-35 at a 720px column (50/50 split on a 1440px
viewport, the assumed common-laptop reference width used throughout this
project's "fits one screen" work).
"""
import re
import sys
import math

with open('index.html', encoding='utf-8') as f:
    HTML = f.read()

CHAR_W = 0.50  # em; see module docstring


def strip_tags(s):
    s = re.sub(r'<[^>]+>', '', s)
    s = re.sub(r'&mdash;', '--', s)
    s = re.sub(r'&ndash;', '-', s)
    s = re.sub(r'&[a-z]+;', ' ', s)
    return s.strip()


def wrapped_lines(text, col_width_px, font_px):
    n_chars = len(text)
    chars_per_line = max(1, col_width_px / (font_px * CHAR_W))
    return max(1, math.ceil(n_chars / chars_per_line))


def block_height(text, col_width_px, font_px, line_height_mult, margin_bottom_px):
    lines = wrapped_lines(text, col_width_px, font_px)
    return lines * font_px * line_height_mult + margin_bottom_px


def estimate_chapter(n, text_col_width_px, padding_px=43):
    """padding_px default is clamp(1.5rem,3vw,2.25rem) evaluated at a
    ~1440px viewport (2.16rem = ~43px), matching css/style.css's
    .slab-inner-full .slab-text padding rule."""
    marker = 'id="topic-' + str(n) + '"'
    s = HTML.index(marker)
    e = HTML.index('</div></div></section>', s)
    seg = HTML[s:e]

    usable_w = text_col_width_px - 2 * padding_px
    total = padding_px * 2

    total += 15 * 1.7 + 20  # section-label

    h2match = re.search(r'<h2>(.*?)</h2>', seg)
    h2 = strip_tags(h2match.group(1))
    total += block_height(h2, usable_w, 40, 1.35, 25)

    for m in re.finditer(r'<p([^>]*)>(.*?)</p>', seg, re.S):
        cls = m.group(1)
        raw = strip_tags(m.group(2))
        if 'slab-definition' in cls:
            total += block_height(raw, usable_w, 19, 1.7, 15)
        elif 'slab-subhead' in cls:
            total += block_height(raw, usable_w, 21, 1.7, 15)
        elif 'pull-quote' in cls:
            total += block_height(raw, usable_w, 24, 1.7, 34) + 24
        else:
            total += block_height(raw, usable_w, 21, 1.7, 14)

    total += 20 * 1.4 + 36 + 25  # CTA button

    return total


if __name__ == '__main__':
    start = int(sys.argv[1]) if len(sys.argv) > 1 else 1
    end = int(sys.argv[2]) if len(sys.argv) > 2 else 35
    col_w = int(sys.argv[3]) if len(sys.argv) > 3 else 720

    for n in range(start, end + 1):
        try:
            h = estimate_chapter(n, col_w)
        except ValueError:
            continue
        print("chapter %2d: ~%.0fpx text height at %dpx column width" % (n, h, col_w))
