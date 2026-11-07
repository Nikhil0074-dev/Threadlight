import { containsText, fold } from './clean.js';

const NUM = /\d[\d.,]*/g;

function numbersIn(s) {
  return (String(s).match(NUM) || []).map((n) => n.replace(/[.,]+$/, '').replace(/,/g, ''));
}

// Checks AI output against the source. It never edits text. It only flags what it cannot support.
export function verifyDoc(doc, sourceText) {
  const warnings = [];
  const src = fold(sourceText);
  const srcNums = new Set(numbersIn(sourceText).map((n) => n.replace(/,/g, '')));
  const out = structuredClone(doc);
  for (const s of out.sections) {
    s.needsReview = false;
    if (s.source?.quote) {
      s.sourceVerified = src.includes(fold(s.source.quote));
      if (!s.sourceVerified) {
        s.needsReview = true;
        warnings.push(`"${s.heading}": the quoted source text was not found in your content.`);
      }
    } else {
      s.sourceVerified = false;
    }
    if (s.stat) {
      const nums = numbersIn(s.stat.value);
      const missing = nums.filter((n) => !srcNums.has(n));
      if (nums.length === 0 || missing.length) {
        s.needsReview = true;
        warnings.push(`"${s.heading}": the number ${s.stat.value} does not appear in your content.`);
      }
    }
  }
  return { doc: out, warnings };
}
