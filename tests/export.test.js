import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import * as cheerio from 'cheerio';
import { PDFParse } from 'pdf-parse';
import { generateDoc } from '../server/ai/index.js';
import { exportDoc } from '../server/export/index.js';
import { SAMPLE } from './helpers.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const dims = (b) => ({ w: b.readUInt32BE(16), h: b.readUInt32BE(20) });
const doc = (await generateDoc(SAMPLE)).doc;

test('PNG: valid file at 1080 px wide, and 2x scale doubles it', async () => {
  const a = await exportDoc(doc, { format: 'png' });
  assert.ok(a.buffer.subarray(0, 8).equals(PNG));
  assert.equal(dims(a.buffer).w, 1080);
  assert.equal(dims((await exportDoc(doc, { format: 'png', scale: 2 })).buffer).w, 2160);
  assert.match(a.filename, /\.png$/);
});
test('PNG is not blank: it contains more than one colour', async () => {
  const { buffer } = await exportDoc(doc, { format: 'png' });
  assert.ok(buffer.length > 20000);
});
test('SVG: stand-alone, valid XML, fonts embedded', async () => {
  const { buffer, contentType } = await exportDoc(doc, { format: 'svg' });
  assert.equal(contentType, 'image/svg+xml');
  const svg = buffer.toString();
  assert.match(svg, /@font-face/);
  assert.match(svg, /Bricolage Grotesque/);
  assert.equal(cheerio.load(svg, { xmlMode: true })('svg').length, 1);
});
test('PDF: valid, one page, text is part of the image so check size and header', async () => {
  const { buffer } = await exportDoc(doc, { format: 'pdf' });
  assert.equal(buffer.subarray(0, 5).toString(), '%PDF-');
  const p = new PDFParse({ data: new Uint8Array(buffer) });
  const r = await p.getText();
  assert.equal(r.total, 1);
  await p.destroy();
});
test('carousel ZIP: one PNG per slide, all 1080x1350', async () => {
  const { buffer, filename } = await exportDoc(doc, { mode: 'carousel', format: 'zip' });
  const zip = await JSZip.loadAsync(buffer);
  const names = Object.keys(zip.files).sort();
  assert.equal(names.length, doc.sections.length + 2);
  assert.equal(names[0], 'slide-01.png');
  for (const n of names) {
    const b = await zip.files[n].async('nodebuffer');
    assert.ok(b.subarray(0, 8).equals(PNG));
    assert.deepEqual(dims(b), { w: 1080, h: 1350 });
  }
  assert.match(filename, /carousel\.zip$/);
});
test('carousel PDF: one page per slide', async () => {
  const { buffer } = await exportDoc(doc, { mode: 'carousel', format: 'pdf' });
  const p = new PDFParse({ data: new Uint8Array(buffer) });
  assert.equal((await p.getText()).total, doc.sections.length + 2);
  await p.destroy();
});
test('unsupported format/mode combinations are refused', async () => {
  await assert.rejects(exportDoc(doc, { mode: 'infographic', format: 'zip' }), (e) => e.code === 'BAD_FORMAT');
  await assert.rejects(exportDoc(doc, { mode: 'carousel', format: 'svg' }), (e) => e.code === 'BAD_FORMAT');
});
test('file names are safe even with hostile titles', async () => {
  const d = structuredClone(doc); d.title = '../../etc/passwd "<>"';
  const { filename } = await exportDoc(d, { format: 'png' });
  assert.match(filename, /^[a-z0-9-]+\.png$/);
});
