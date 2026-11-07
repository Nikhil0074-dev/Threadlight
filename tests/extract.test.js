import test from 'node:test';
import assert from 'node:assert/strict';
import * as extract from '../server/lib/extract.js';
import { SAMPLE, makeDocx, makePdf } from './helpers.js';

test('text input: counts words, rejects short input', () => {
  const r = extract.fromText(SAMPLE, 'T');
  assert.equal(r.sourceType, 'text');
  assert.ok(r.wordCount > 100);
  assert.throws(() => extract.fromText('too short'), (e) => e.code === 'EMPTY_CONTENT');
});
test('thread input from X url is refused with a clear message', () => {
  assert.throws(() => extract.fromThread('https://x.com/a/status/1'), (e) => e.code === 'THREAD_URL_UNSUPPORTED');
});
test('thread input from pasted text', () => {
  const r = extract.fromThread(`1/ ${'Alpha beta gamma delta. '.repeat(5)}\n2/ ${'Epsilon zeta eta theta. '.repeat(5)}`);
  assert.equal(r.postCount, 2);
});
test('html extraction drops nav, ads, scripts and keeps article text', () => {
  const html = `<html><head><title>Site</title><meta property="og:title" content="Real Title"></head><body>
  <nav>Home About Contact</nav><div class="ads">BUY NOW</div><script>var x=1</script>
  <article><h1>Real Title</h1><p>First paragraph of the article with enough text to count.</p><p>Second paragraph, also real content.</p></article>
  <footer>Copyright</footer></body></html>`;
  const { title, text } = extract.extractArticleHtml(html);
  assert.equal(title, 'Real Title');
  assert.match(text, /First paragraph/);
  for (const bad of ['Home About', 'BUY NOW', 'var x', 'Copyright']) assert.ok(!text.includes(bad), bad);
});
test('html without <article> falls back to the densest block', () => {
  const html = '<body><div id="a"><p>short</p></div><div id="b"><p>Long paragraph one with plenty of words inside it.</p><p>Long paragraph two with plenty of words inside it too.</p></div></body>';
  assert.match(extract.extractArticleHtml(html).text, /Long paragraph two/);
});
test('PDF: text is extracted and pages are counted', async () => {
  const pdf = await makePdf([SAMPLE.slice(0, 600)], 2);
  const r = await extract.fromUpload(pdf, 'report.pdf');
  assert.equal(r.sourceType, 'pdf');
  assert.equal(r.pageCount, 2);
  assert.match(r.text, /Machine learning/);
});
test('PDF: a file named .pdf that is not a PDF is rejected by its bytes', async () => {
  await assert.rejects(extract.fromPdf(Buffer.from('hello not a pdf at all'), 'x.pdf'), (e) => e.code === 'BAD_FILE');
  await assert.rejects(extract.fromUpload(Buffer.from('hello not a pdf at all'), 'x.pdf'), (e) => e.code === 'UNSUPPORTED_FILE');
});
test('PDF: damaged file gives a friendly error', async () => {
  await assert.rejects(extract.fromPdf(Buffer.from('%PDF-1.4 garbage garbage'), 'x.pdf'), (e) => ['PDF_FAILED', 'EMPTY_CONTENT'].includes(e.code));
});
test('DOCX: text is extracted', async () => {
  const docx = await makeDocx(['Heading line', ...SAMPLE.split('\n\n').slice(0, 2)]);
  const r = await extract.fromUpload(docx, 'notes.docx');
  assert.equal(r.sourceType, 'docx');
  assert.match(r.text, /Machine learning/);
});
test('ZIP that is not DOCX is rejected', async () => {
  const docx = await makeDocx(['x']);
  await assert.rejects(extract.fromUpload(docx, 'evil.zip'), (e) => e.code === 'UNSUPPORTED_FILE');
});
test('TXT and MD uploads work; binary data is rejected', async () => {
  assert.equal((await extract.fromUpload(Buffer.from(SAMPLE), 'a.md')).sourceType, 'text');
  await assert.rejects(extract.fromUpload(Buffer.from([1, 2, 0, 3, 4]), 'a.txt'), (e) => e.code === 'BAD_FILE');
});
test('empty and oversize uploads are rejected', async () => {
  await assert.rejects(extract.fromUpload(Buffer.alloc(0), 'a.txt'), (e) => e.code === 'EMPTY_FILE');
  await assert.rejects(extract.fromUpload(Buffer.alloc(11 * 1024 * 1024, 65), 'a.txt'), (e) => e.code === 'FILE_TOO_LARGE');
});
test('file names are sanitised in titles', async () => {
  const r = await extract.fromUpload(Buffer.from(SAMPLE), '../../etc/pass wd<>.txt');
  assert.ok(!/[<>/]/.test(r.title));
});
