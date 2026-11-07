import { normalizeText } from './clean.js';

const MARKER = /^\s*(?:\(?\d{1,3}\s*(?:\/\s*\d{0,3}|[.)])|\d{1,3}\s*\/)\s+/;
const SPLIT_LINE = /^\s*(?:-{3,}|_{3,}|={3,}|🧵.*)\s*$/;

// Turns a pasted X/Twitter thread into one ordered document.
// Posts are separated by "1/", "2/8", "(3)", "---" or blank lines. Order is preserved.
export function parseThread(raw) {
  const text = normalizeText(raw);
  const lines = text.split('\n');
  const posts = [];
  let cur = [];
  const flush = () => {
    const joined = cur.join(' ').replace(/\s+/g, ' ').trim();
    if (joined) posts.push(joined);
    cur = [];
  };
  const hasMarkers = lines.some((l) => MARKER.test(l));
  for (const line of lines) {
    if (SPLIT_LINE.test(line)) { flush(); continue; }
    if (hasMarkers) {
      if (MARKER.test(line)) { flush(); cur.push(line.replace(MARKER, '')); }
      else if (line.trim()) cur.push(line.trim());
    } else if (!line.trim()) flush();
    else cur.push(line.trim());
  }
  flush();
  const seen = new Set();
  const unique = posts
    .map((p) => p.replace(/\s*\d{1,3}\s*\/\s*\d{1,3}\s*$/, '').trim()) // trailing "3/9"
    .filter((p) => {
      const k = p.toLowerCase();
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  return { posts: unique, text: unique.join('\n\n') };
}

export function looksLikeThreadUrl(s) {
  return /^https?:\/\/(?:www\.)?(?:x|twitter)\.com\//i.test(String(s).trim());
}
