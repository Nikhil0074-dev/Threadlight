import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanText, containsText, countWords, normalizeText, splitSentences } from '../server/lib/clean.js';

test('normalizeText fixes line endings, spaces and control characters', () => {
  assert.equal(normalizeText('a\r\nb\u0000  c\u200B\n\n\n\nd'), 'a\nb c\n\nd');
});
test('cleanText removes repeated page headers but keeps one-off lines', () => {
  const t = Array.from({ length: 5 }, (_, i) => `ACME REPORT 2024\nParagraph number ${i} has real content in it.`).join('\n');
  const out = cleanText(t);
  assert.ok(!out.includes('ACME REPORT'));
  assert.ok(out.includes('Paragraph number 3'));
});
test('cleanText removes duplicated long paragraphs', () => {
  const p = 'This is a long paragraph that appears twice in the extracted text of a page.';
  assert.equal(cleanText(`${p}\n\n${p}\n\nOther.`).split(p).length - 1, 1);
});
test('countWords', () => { assert.equal(countWords('one two  three\nfour'), 4); assert.equal(countWords(''), 0); });
test('splitSentences does not break on abbreviations or decimals', () => {
  const s = splitSentences('Dr. Smith measured 3.5 litres. The result was clear. Is it true? Yes.');
  assert.deepEqual(s, ['Dr. Smith measured 3.5 litres.', 'The result was clear.', 'Is it true?', 'Yes.']);
});
test('containsText ignores case, spacing and curly quotes', () => {
  assert.ok(containsText('He said “Hello   World”.', 'hello world'));
  assert.ok(!containsText('abc', 'abd'));
});
