// Stage 1 of the pipeline: make extracted text predictable.

export function normalizeText(input) {
  let t = String(input ?? '');
  t = t.normalize('NFKC');
  t = t.replace(/\r\n?/g, '\n');
  t = t.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ''); // control chars
  t = t.replace(/[\u200B-\u200D\uFEFF]/g, ''); // zero-width
  t = t.replace(/[ \t\u00A0]+/g, ' ');
  t = t.replace(/ *\n */g, '\n');
  t = t.replace(/\n{3,}/g, '\n\n');
  return t.trim();
}

// Removes lines that repeat many times (page headers/footers) and exact duplicate paragraphs.
export function removeRepeats(text) {
  const lines = text.split('\n');
  const counts = new Map();
  for (const l of lines) {
    const k = l.trim();
    if (k.length > 0 && k.length < 80) counts.set(k, (counts.get(k) || 0) + 1);
  }
  const repeated = new Set(
    [...counts].filter(([k, n]) => n >= 4 && !/^[-*•\d]/.test(k)).map(([k]) => k),
  );
  const kept = lines.filter((l) => !repeated.has(l.trim()));
  const seen = new Set();
  const paras = kept
    .join('\n')
    .split(/\n{2,}/)
    .filter((p) => {
      const k = p.trim().toLowerCase();
      if (k.length < 40) return true; // short lines may legitimately repeat
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  return paras.join('\n\n');
}

export function cleanText(input) {
  return normalizeText(removeRepeats(normalizeText(input)));
}

export function countWords(text) {
  const m = String(text).match(/\S+/g);
  return m ? m.length : 0;
}

const ABBREV = /\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|vs|etc|e\.g|i\.e|Inc|Ltd|No|Fig|St)\.$/i;

export function splitSentences(text) {
  const out = [];
  const blocks = text.split(/\n+/);
  for (const block of blocks) {
    const b = block.trim();
    if (!b) continue;
    const parts = b.split(/(?<=[.!?])["')\]]*\s+(?=[A-Z0-9"“(])/);
    let buf = '';
    for (const p of parts) {
      buf = buf ? `${buf} ${p}` : p;
      if (!ABBREV.test(p.trim())) {
        out.push(buf.trim());
        buf = '';
      }
    }
    if (buf) out.push(buf.trim());
  }
  return out.filter((s) => s.length > 0);
}

// Case-insensitive, whitespace- and quote-insensitive containment test.
export function fold(s) {
  return String(s)
    .toLowerCase()
    .replace(/[“”„"]/g, '"')
    .replace(/[‘’']/g, "'")
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}
export function containsText(haystack, needle) {
  return fold(haystack).includes(fold(needle));
}
