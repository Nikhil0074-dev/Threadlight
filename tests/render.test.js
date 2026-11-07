import test from 'node:test';
import assert from 'node:assert/strict';
import * as cheerio from 'cheerio';
import { generateDoc } from '../server/ai/index.js';
import { ellipsize, fit, textWidth, wrap } from '../server/render/fonts.js';
import { SLIDE_H, SLIDE_W, W, esc, renderCarousel, renderInfographic } from '../server/render/svg.js';
import { THEMES, contrast } from '../server/render/themes.js';
import { TEMPLATES, THEMES as THEME_IDS } from '../server/lib/schema.js';
import { SAMPLE } from './helpers.js';

const parseXml = (svg) => cheerio.load(svg, { xmlMode: true });

test('wrap never exceeds the box width', () => {
  const text = 'Internationalization and incomprehensibilities make supercalifragilisticexpialidocious words hard to fit nicely';
  for (const w of [180, 300, 600]) for (const line of wrap(text, 'body-400', 28, w)) assert.ok(textWidth(line, 'body-400', 28) <= w + 0.5, `${line} @${w}`);
});
test('fit picks a smaller size or truncates instead of overflowing', () => {
  const long = 'A very long heading that keeps going and going and going well past any reasonable length for a title';
  const r = fit(long, 'display-800', [90, 70, 50], 400, 2);
  assert.ok(r.lines.length <= 2);
  r.lines.forEach((l) => assert.ok(textWidth(l, 'display-800', r.size) <= 400));
});
test('ellipsize adds … only when needed', () => {
  assert.deepEqual(ellipsize(['a', 'b'], 2, 'body-400', 20, 100), ['a', 'b']);
  assert.match(ellipsize(['a', 'b', 'c'], 2, 'body-400', 20, 100)[1], /…$/);
});
test('esc handles XML special and illegal characters', () => {
  assert.equal(esc('a & b < c > "d"\u0000'), 'a &amp; b &lt; c &gt; &quot;d&quot;');
});
test('theme colours meet WCAG AA contrast (4.5) for text pairs', () => {
  for (const [id, t] of Object.entries(THEMES)) {
    for (const [a, b, name] of [[t.ink, t.bg, 'ink/bg'], [t.muted, t.bg, 'muted/bg'], [t.ink, t.panel, 'ink/panel'], [t.onAccent, t.accent, 'onAccent/accent'], [t.onDark, t.dark, 'onDark/dark'], [t.accent, t.panel, 'accent/panel']]) {
      assert.ok(contrast(a, b) >= 4.5, `${id} ${name} = ${contrast(a, b).toFixed(2)}`);
    }
  }
});

test('every template x theme renders valid XML at the right width', async () => {
  const { doc } = await generateDoc(SAMPLE);
  for (const template of TEMPLATES) for (const theme of THEME_IDS) {
    const d = { ...doc, design: { ...doc.design, template, theme } };
    const r = renderInfographic(d);
    const $ = parseXml(r.svg);
    assert.equal($('svg').attr('width'), String(W));
    assert.ok(r.height > 800 && r.height < 6000, `${template}/${theme} height ${r.height}`);
    assert.ok($('text').length > 10);
  }
});
test('hostile text is escaped and cannot add elements', () => {
  const doc = { title: '<script>alert(1)</script> & "x"', subtitle: '', category: 'General', summary: '</text><rect id="pwn"/>', keyTakeaways: ['<b>x</b>'], design: { template: 'explainer', theme: 'daylight', orientation: 'portrait' },
    sections: [{ id: 'a', heading: '<img onerror=x>', description: 'a < b && c > d', visualType: 'text-card', importance: 'high' }] };
  const $ = parseXml(renderInfographic(doc).svg);
  assert.equal($('script').length, 0);
  assert.equal($('#pwn').length, 0);
  assert.equal($('img').length, 0);
});
test('extreme content: very long words and many items stay finite and valid', () => {
  const doc = { title: 'W'.repeat(300), subtitle: 'x'.repeat(400), category: 'General', summary: 'y'.repeat(500), keyTakeaways: Array(6).fill('z'.repeat(200)), design: { template: 'explainer', theme: 'midnight', orientation: 'portrait' },
    sections: Array.from({ length: 12 }, (_, i) => ({ id: `s${i}`, heading: 'H'.repeat(80), description: 'd'.repeat(420), visualType: i % 2 ? 'process-flow' : 'icon-grid', importance: 'low', items: Array(10).fill('q'.repeat(200)) })) };
  const r = renderInfographic(doc);
  parseXml(r.svg);
  assert.ok(Number.isFinite(r.height));
});
test('review badges appear in preview only', async () => {
  const { doc } = await generateDoc(SAMPLE);
  doc.sections[0].needsReview = true;
  assert.ok(renderInfographic(doc, { showReview: true }).svg.includes('Check this against source'));
  assert.ok(!renderInfographic(doc).svg.includes('Check this against source'));
});
test('carousel: sections + 2 slides, fixed size, valid XML', async () => {
  const { doc } = await generateDoc(SAMPLE);
  const { slides } = renderCarousel(doc);
  assert.equal(slides.length, doc.sections.length + 2);
  for (const s of slides) { const $ = parseXml(s.svg); assert.equal($('svg').attr('width'), String(SLIDE_W)); assert.equal($('svg').attr('height'), String(SLIDE_H)); }
});
test('carousel: content stays inside the slide', async () => {
  const { doc } = await generateDoc(SAMPLE);
  for (const s of renderCarousel(doc).slides) {
    const $ = parseXml(s.svg);
    $('text').each((_, el) => { const y = Number($(el).attr('y')); assert.ok(y < SLIDE_H - 40 || /\d+ \/ \d+|Threadlight/.test($(el).text()), `text at y=${y}: ${$(el).text().slice(0, 30)}`); });
  }
});
