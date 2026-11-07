import fs from 'node:fs';
import path from 'node:path';
import opentype from 'opentype.js';
import { FONT_DIR } from '../config.js';

const FILES = {
  'display-800': ['bricolage-grotesque', '800ExtraBold', 'BricolageGrotesque_800ExtraBold.ttf'],
  'display-700': ['bricolage-grotesque', '700Bold', 'BricolageGrotesque_700Bold.ttf'],
  'body-400': ['instrument-sans', '400Regular', 'InstrumentSans_400Regular.ttf'],
  'body-600': ['instrument-sans', '600SemiBold', 'InstrumentSans_600SemiBold.ttf'],
};

export const FAMILY = {
  display: 'Bricolage Grotesque',
  body: 'Instrument Sans',
};

const cache = new Map();

export function fontPath(key) {
  const [pkg, dir, file] = FILES[key];
  return path.join(FONT_DIR, pkg, dir, file);
}
export const allFontPaths = () => Object.keys(FILES).map(fontPath);
export const FONT_URLS = Object.fromEntries(Object.keys(FILES).map((k) => [k, `/fonts/${path.basename(fontPath(k))}`]));

export function getFont(key) {
  if (!cache.has(key)) {
    const buf = fs.readFileSync(fontPath(key));
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    cache.set(key, opentype.parse(ab));
  }
  return cache.get(key);
}

// Width from raw glyph advances plus kerning. opentype.js's own shaper throws on some
// contextual lookups in these fonts, so we avoid it. A 2% margin covers small differences
// from the real shaper used when rendering.
export function textWidth(text, key, size) {
  const f = getFont(key);
  const scale = size / f.unitsPerEm;
  let w = 0;
  let prev = null;
  for (const ch of text) {
    const g = f.charToGlyph(ch);
    w += g.advanceWidth || 0;
    if (prev) w += f.getKerningValue(prev, g) || 0;
    prev = g;
  }
  return w * scale * 1.02;
}

// Greedy word wrap using real glyph widths, so exported text never overflows its box.
export function wrap(text, key, size, maxWidth) {
  const out = [];
  // Splits a single over-wide word by characters; returns the leftover piece.
  const breakLong = (word) => {
    let line = word;
    while (textWidth(line, key, size) > maxWidth && line.length > 1) {
      let cut = line.length - 1;
      while (cut > 1 && textWidth(line.slice(0, cut), key, size) > maxWidth) cut -= 1;
      out.push(line.slice(0, cut));
      line = line.slice(cut);
    }
    return line;
  };
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const w of para.split(/\s+/).filter(Boolean)) {
      const test = line ? `${line} ${w}` : w;
      if (line && textWidth(test, key, size) > maxWidth) {
        out.push(line);
        line = breakLong(w);
      } else {
        line = line ? test : breakLong(w);
      }
    }
    if (line) out.push(line);
  }
  return out.length ? out : [''];
}

export function ellipsize(lines, maxLines, key, size, maxWidth) {
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1];
  while (last.length > 1 && textWidth(`${last}…`, key, size) > maxWidth) last = last.slice(0, -1).trimEnd();
  kept[maxLines - 1] = `${last}…`;
  return kept;
}

// Largest size from `sizes` (descending) whose wrapped text fits in maxLines.
export function fit(text, key, sizes, maxWidth, maxLines) {
  for (const size of sizes) {
    const lines = wrap(text, key, size, maxWidth);
    if (lines.length <= maxLines) return { size, lines };
  }
  const size = sizes[sizes.length - 1];
  return { size, lines: ellipsize(wrap(text, key, size, maxWidth), maxLines, key, size, maxWidth) };
}
