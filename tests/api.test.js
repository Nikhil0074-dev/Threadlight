import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { SAMPLE, makeDocx, makePdf } from './helpers.js';

let server; let base; let dir;
before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tl-'));
  server = createApp({ dataDir: dir }).listen(0);
  await new Promise((r) => server.on('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server.close(); await fs.rm(dir, { recursive: true, force: true }); });

const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const upload = (name, buf) => { const f = new FormData(); f.append('file', new Blob([buf]), name); return fetch(`${base}/api/sources/upload`, { method: 'POST', body: f }); };

test('health, meta and static pages', async () => {
  assert.equal((await (await fetch(`${base}/api/health`)).json()).ok, true);
  const meta = await (await fetch(`${base}/api/meta`)).json();
  assert.equal(meta.themes.length, 4);
  const html = await fetch(`${base}/`);
  assert.equal(html.status, 200);
  assert.equal(html.headers.get('x-content-type-options'), 'nosniff');
  assert.match(html.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal((await fetch(`${base}/fonts/bricolage-grotesque/700Bold/BricolageGrotesque_700Bold.ttf`)).status, 200);
});
test('full flow: text -> generate -> project -> render -> export -> reopen -> delete', async () => {
  const src = (await (await post('/api/sources/text', { text: SAMPLE, title: 'ML' })).json()).source;
  assert.ok(src.wordCount > 100);
  const gen = await (await post('/api/generate', { text: src.text, title: 'ML', settings: { sections: 4 } })).json();
  assert.ok(gen.doc.sections.length >= 2);

  const created = await post('/api/projects', { title: 'ML', sourceType: 'text', sourceText: src.text, doc: gen.doc });
  assert.equal(created.status, 201);
  const { project } = await created.json();

  const rend = await (await post('/api/render', { doc: gen.doc, preview: true })).json();
  assert.match(rend.svg, /^<svg/);
  const car = await (await post('/api/render', { doc: gen.doc, mode: 'carousel' })).json();
  assert.equal(car.slides.length, gen.doc.sections.length + 2);

  const edited = structuredClone(gen.doc); edited.title = 'Edited title'; edited.design.theme = 'midnight';
  const put = await fetch(`${base}/api/projects/${project.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ doc: edited }) });
  assert.equal((await put.json()).project.doc.title, 'Edited title');

  const exp = await post('/api/export', { doc: edited, format: 'png', projectId: project.id });
  assert.equal(exp.status, 200);
  assert.equal(exp.headers.get('content-type'), 'image/png');
  assert.ok((await exp.arrayBuffer()).byteLength > 10000);

  const again = (await (await fetch(`${base}/api/projects/${project.id}`)).json()).project;
  assert.equal(again.doc.design.theme, 'midnight');
  assert.equal(again.status, 'complete');
  assert.equal(again.exports.length, 1);
  assert.equal((await (await fetch(`${base}/api/projects`)).json()).projects.length, 1);

  assert.equal((await fetch(`${base}/api/projects/${project.id}`, { method: 'DELETE' })).status, 204);
  assert.equal((await fetch(`${base}/api/projects/${project.id}`)).status, 404);
});
test('uploads: PDF and DOCX work; fake and oversize files are refused', async () => {
  const pdf = await upload('a.pdf', await makePdf([SAMPLE.slice(0, 500)]));
  assert.equal((await pdf.json()).source.sourceType, 'pdf');
  const docx = await upload('a.docx', await makeDocx([SAMPLE.slice(0, 500)]));
  assert.equal((await docx.json()).source.sourceType, 'docx');
  const fake = await upload('a.pdf', Buffer.from('not a pdf'));
  assert.equal(fake.status, 400);
  const big = await upload('a.txt', Buffer.alloc(11 * 1024 * 1024, 65));
  assert.equal(big.status, 413);
  const none = await fetch(`${base}/api/sources/upload`, { method: 'POST', body: new FormData() });
  assert.equal(none.status, 400);
});
test('url source: private addresses and X links are refused', async () => {
  for (const url of ['http://127.0.0.1/', 'http://169.254.169.254/latest/meta-data', 'file:///etc/passwd']) {
    const r = await post('/api/sources/url', { url });
    assert.equal(r.status, 400, url);
    assert.ok((await r.json()).error.message.length > 5);
  }
  assert.equal((await (await post('/api/sources/url', { url: 'https://x.com/a/status/1' })).json()).error.code, 'THREAD_URL_UNSUPPORTED');
});
test('bad input gets clear 400 errors, never a crash', async () => {
  assert.equal((await post('/api/sources/text', { text: 'short' })).status, 400);
  assert.equal((await post('/api/generate', { text: 'x'.repeat(10) })).status, 400);
  assert.equal((await post('/api/render', { doc: { title: 'x', sections: [] } })).status, 400);
  assert.equal((await post('/api/export', { doc: {}, format: 'png' })).status, 400);
  const badJson = await fetch(`${base}/api/render`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oops' });
  assert.equal(badJson.status, 400);
  assert.equal((await fetch(`${base}/api/nope`)).status, 404);
});
test('project ids cannot escape the data folder', async () => {
  for (const id of ['..%2F..%2Fetc%2Fpasswd', 'not-a-uuid', '00000000-0000-0000-0000-000000000000']) {
    assert.equal((await fetch(`${base}/api/projects/${id}`)).status, 404, id);
  }
});
test('thread source keeps post order', async () => {
  const t = Array.from({ length: 4 }, (_, i) => `${i + 1}/ Post ${i + 1}: ${'words words words '.repeat(4)}`).join('\n');
  const r = (await (await post('/api/sources/thread', { text: t })).json()).source;
  assert.equal(r.postCount, 4);
  assert.ok(r.text.indexOf('Post 1') < r.text.indexOf('Post 4'));
});
