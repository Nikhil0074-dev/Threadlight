import { FAMILY, fit, textWidth, wrap, ellipsize } from './fonts.js';
import { themeOf } from './themes.js';

export const W = 1080;
const RAIL = 76; // x of the thread
const X0 = 132; // content left edge
const CW = W - X0 - 72; // content width

const STYLE = {
  'display-800': ['display', 800],
  'display-700': ['display', 700],
  'body-400': ['body', 400],
  'body-600': ['body', 600],
};

const XML_BAD = /[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD]/g;
export const esc = (s) =>
  String(s ?? '').replace(XML_BAD, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function txt(x, y, s, key, size, fill, extra = '') {
  const [fam, weight] = STYLE[key];
  return `<text x="${x}" y="${y}" font-family="${FAMILY[fam]}, sans-serif" font-weight="${weight}" font-size="${size}" fill="${fill}" ${extra}>${esc(s)}</text>`;
}
function lines(x, y, arr, key, size, lh, fill, extra = '') {
  return arr.map((l, i) => txt(x, y + i * lh, l, key, size, fill, extra)).join('');
}

// A sized block: `h` is its height, `draw(x, y)` returns SVG for that position.
const block = (h, draw) => ({ h, draw });

function textBlock(text, key, size, lh, width, fill, maxLines = 99) {
  const ls = ellipsize(wrap(text, key, size, width), maxLines, key, size, width);
  return block(ls.length * lh, (x, y) => lines(x, y + size, ls, key, size, lh, fill));
}

function renderSection(sec, width, ctx) {
  const { t } = ctx;
  const parts = [];
  let h = 0;
  const push = (b, gap = 0) => { parts.push({ b, y: h }); h += b.h + gap; };

  const heading = fit(sec.heading, 'display-700', [40, 36, 32, 28], width, 2);
  push(textBlock(sec.heading, 'display-700', heading.size, Math.round(heading.size * 1.2), width, t.ink, 2), 14);

  if (sec.visualType === 'stat-card') {
    const valFit = fit(sec.stat.value, 'display-800', [132, 112, 96, 80, 64, 52], width - 48, 1);
    const label = wrap(sec.stat.label, 'body-400', 28, width - 64);
    const labelLines = ellipsize(label, 4, 'body-400', 28, width - 64);
    const tileH = 40 + valFit.size + 24 + labelLines.length * 38 + 36;
    push(block(tileH, (x, y) =>
      `<rect x="${x}" y="${y}" width="${width}" height="${tileH}" rx="28" fill="${t.panel}"/>` +
      `<rect x="${x}" y="${y + 36}" width="8" height="${valFit.size * 0.8}" rx="4" fill="${t.accent2}"/>` +
      txt(x + 32, y + 36 + valFit.size * 0.8, sec.stat.value, 'display-800', valFit.size, t.accent) +
      lines(x + 32, y + 40 + valFit.size + 24, labelLines, 'body-400', 28, 38, t.ink)), 0);
  } else if (sec.visualType === 'process-flow' || sec.visualType === 'timeline') {
    const isTl = sec.visualType === 'timeline';
    const rows = (sec.items || []).map((it, i) => {
      const m = isTl ? it.match(/^((?:1[5-9]|20)\d{2})\s*[:\-–]\s*(.*)$/) : null;
      const label = m ? m[1] : String(i + 1);
      const body = m ? m[2] : it;
      const lead = m ? 120 : 64;
      const ls = ellipsize(wrap(body, 'body-400', 28, width - lead), 4, 'body-400', 28, width - lead);
      return { label, ls, lead, rh: Math.max(52, ls.length * 38 + 10) };
    });
    const total = rows.reduce((a, r) => a + r.rh + 18, 0) - 18;
    push(block(total, (x, y) => {
      let cy = y; let out = '';
      rows.forEach((r, i) => {
        if (isTl) out += txt(x, cy + 34, r.label, 'display-700', 32, t.accent);
        else out += `<circle cx="${x + 24}" cy="${cy + 26}" r="24" fill="${t.accent}"/>` + txt(x + 24, cy + 36, r.label, 'display-700', 26, t.onAccent, 'text-anchor="middle"');
        if (i < rows.length - 1 && !isTl) out += `<line x1="${x + 24}" y1="${cy + 52}" x2="${x + 24}" y2="${cy + r.rh + 18 + 2}" stroke="${t.line}" stroke-width="3"/>`;
        out += lines(x + r.lead, cy + 34, r.ls, 'body-400', 28, 38, t.ink);
        cy += r.rh + 18;
      });
      return out;
    }));
  } else if (sec.visualType === 'icon-grid') {
    const chips = (sec.items || []).map((it) => ({ s: it, w: Math.min(width, textWidth(it, 'body-600', 26) + 48) }));
    const rowsArr = [[]]; let rx = 0;
    chips.forEach((c) => { if (rx + c.w > width && rowsArr[rowsArr.length - 1].length) { rowsArr.push([]); rx = 0; } rowsArr[rowsArr.length - 1].push({ ...c, x: rx }); rx += c.w + 14; });
    const total = rowsArr.length * 62 - 14;
    push(block(total, (x, y) => rowsArr.map((r, ri) => r.map((c) =>
      `<rect x="${x + c.x}" y="${y + ri * 62}" width="${c.w}" height="48" rx="24" fill="${t.panel}" stroke="${t.line}" stroke-width="2"/>` +
      txt(x + c.x + 24, y + ri * 62 + 33, c.s.length > 40 ? `${c.s.slice(0, 39)}…` : c.s, 'body-600', 26, t.ink)).join('')).join('')));
  } else if (sec.visualType === 'comparison') {
    const n = sec.columns.length; const gap = 20; const cw = Math.floor((width - gap * (n - 1)) / n);
    const cols = sec.columns.map((c) => {
      const items = c.items.map((it) => ellipsize(wrap(it, 'body-400', 26, cw - 72), 5, 'body-400', 26, cw - 72));
      const ih = items.reduce((a, ls) => a + ls.length * 34 + 14, 0);
      return { label: c.label, items, h: 36 + 40 + 20 + ih + 24 };
    });
    const mh = Math.max(...cols.map((c) => c.h));
    push(block(mh, (x, y) => cols.map((c, i) => {
      const cx = x + i * (cw + gap); let cy = y + 36 + 36; const col = i === 0 ? t.accent : t.accent2;
      let out = `<rect x="${cx}" y="${y}" width="${cw}" height="${mh}" rx="20" fill="none" stroke="${col}" stroke-width="3"/>` +
        txt(cx + 28, cy, c.label, 'display-700', 32, t.ink);
      cy += 28;
      c.items.forEach((ls) => {
        out += `<circle cx="${cx + 36}" cy="${cy + 14}" r="6" fill="${col}"/>` + lines(cx + 56, cy + 24, ls, 'body-400', 26, 34, t.ink);
        cy += ls.length * 34 + 14;
      });
      return out;
    }).join('')));
  }

  if (sec.description && sec.visualType !== 'stat-card') {
    push(textBlock(sec.description, 'body-400', 30, 44, width, t.ink, 9));
  }
  if (ctx.showReview && sec.needsReview) {
    push(block(34, (x, y) => `<rect x="${x}" y="${y + 6}" width="196" height="30" rx="15" fill="${t.accent2}"/>` + txt(x + 98, y + 28, 'Check this against source', 'body-600', 15, '#1A1A1A', 'text-anchor="middle"')), 0);
  }
  return block(h, (x, y) => parts.map((p) => p.b.draw(x, y + p.y)).join(''));
}

function header(doc, t, W_) {
  const catW = textWidth(doc.category, 'body-600', 24) + 44;
  const title = fit(doc.title, 'display-800', [92, 80, 70, 60, 52], W_ - X0 - 72, 4);
  const lh = Math.round(title.size * 1.04);
  const sub = doc.subtitle ? wrap(doc.subtitle, 'body-400', 32, W_ - X0 - 72).slice(0, 2) : [];
  const h = 92 + 52 + title.lines.length * lh + (sub.length ? 24 + sub.length * 44 : 0) + 40;
  return {
    h,
    draw: (y) =>
      // the loose thread loop behind the title: the product's signature mark
      `<path d="M ${RAIL} ${y} C ${RAIL} ${y + 90}, 360 ${y + 20}, 600 ${y + 70} S 1010 ${y + 10}, 990 ${y + 120} S 700 ${y + 190}, 780 ${y + 110}" fill="none" stroke="${t.accent2}" stroke-width="5" stroke-linecap="round" opacity="0.9"/>` +
      `<circle cx="780" cy="${y + 110}" r="12" fill="${t.accent2}"/>` +
      `<rect x="${X0}" y="${y + 88}" width="${catW}" height="42" rx="21" fill="${t.accent}"/>` +
      txt(X0 + 22, y + 118, doc.category, 'body-600', 24, t.onAccent) +
      lines(X0, y + 92 + 52 + title.size, title.lines, 'display-800', title.size, lh, t.ink) +
      (sub.length ? lines(X0, y + 92 + 52 + title.lines.length * lh + 24 + 32, sub, 'body-400', 32, 44, t.muted) : ''),
  };
}

function pairable(tpl, sec) {
  if (tpl === 'compare') return sec.visualType === 'text-card';
  if (tpl === 'stats') return sec.visualType === 'stat-card' || sec.visualType === 'text-card';
  return false;
}

export function layoutInfographic(doc, { showReview = false } = {}) {
  const t = themeOf(doc.design.theme);
  const tpl = doc.design.template;
  const ctx = { t, showReview };
  const items = []; // {y, h, draw, node:{y, label}}
  let y = 0;
  const hd = header(doc, t, W);
  items.push({ y: 0, h: hd.h, draw: () => hd.draw(0) });
  y = hd.h;

  if (doc.summary) {
    const ls = ellipsize(wrap(doc.summary, 'body-400', 30, CW - 64), 7, 'body-400', 30, CW - 64);
    const ph = ls.length * 44 + 56;
    const yy = y;
    items.push({ y: yy, h: ph, draw: () =>
      `<rect x="${X0}" y="${yy}" width="${CW}" height="${ph}" rx="28" fill="${t.panel}"/>` + lines(X0 + 32, yy + 28 + 30, ls, 'body-400', 30, 44, t.ink) });
    y += ph + 56;
  }

  const secs = doc.sections;
  let i = 0; let stepNo = 0;
  while (i < secs.length) {
    const s = secs[i];
    const next = secs[i + 1];
    const label = tpl === 'steps' ? String((stepNo += 1)) : '';
    if (pairable(tpl, s) && next && pairable(tpl, next)) {
      const cw = Math.floor((CW - 36) / 2);
      const a = renderSection(s, cw, ctx); const b = renderSection(next, cw, ctx); const h = Math.max(a.h, b.h);
      const yy = y;
      items.push({ y: yy, h, node: { y: yy, label }, draw: () => a.draw(X0, yy) + b.draw(X0 + cw + 36, yy) });
      if (tpl === 'steps') stepNo += 1;
      y += h + 64; i += 2;
    } else {
      const b = renderSection(s, CW, ctx); const yy = y;
      items.push({ y: yy, h: b.h, node: { y: yy, label }, draw: () => b.draw(X0, yy) });
      y += b.h + 64; i += 1;
    }
  }

  if (doc.keyTakeaways?.length) {
    const lsAll = doc.keyTakeaways.map((k) => ellipsize(wrap(k, 'body-400', 30, CW - 120), 4, 'body-400', 30, CW - 120));
    const th = 96 + lsAll.reduce((a, l) => a + l.length * 42 + 22, 0) + 20;
    const yy = y;
    items.push({ y: yy, h: th, node: { y: yy + 20, label: '' }, draw: () => {
      let cy = yy + 96; let out = `<rect x="${X0}" y="${yy}" width="${CW}" height="${th}" rx="32" fill="${t.dark}"/>` + txt(X0 + 40, yy + 62, 'Key takeaways', 'display-700', 36, t.onDark);
      lsAll.forEach((ls) => { out += `<circle cx="${X0 + 52}" cy="${cy + 14}" r="9" fill="${t.accent2}"/>` + lines(X0 + 84, cy + 24, ls, 'body-400', 30, 42, t.onDark); cy += ls.length * 42 + 22; });
      return out;
    } });
    y += th + 56;
  }

  const foot = doc.sourceNote ? `Source: ${doc.sourceNote}` : 'Summarised from the source text';
  const fy = y;
  items.push({ y: fy, h: 60, draw: () =>
    txt(X0, fy + 28, foot.length > 80 ? `${foot.slice(0, 79)}…` : foot, 'body-400', 22, t.muted) + txt(X0, fy + 58, 'Made with Threadlight', 'body-600', 22, t.accent) });
  y += 60 + 56;
  return { items, height: Math.ceil(y), t };
}

export function renderInfographic(doc, opts = {}) {
  const { items, height, t } = layoutInfographic(doc, opts);
  const tpl = doc.design.template;
  const nodes = items.filter((i) => i.node);
  const first = items[0].h - 8;
  const last = nodes.length ? nodes[nodes.length - 1].node.y + 20 : height;
  let body = `<rect width="${W}" height="${height}" fill="${t.bg}"/>`;
  body += `<line x1="${RAIL}" y1="${first}" x2="${RAIL}" y2="${last}" stroke="${t.accent2}" stroke-width="5" stroke-linecap="round"/>`;
  for (const it of nodes) {
    const cy = it.node.y + 24;
    if (tpl === 'steps' && it.node.label) {
      body += `<circle cx="${RAIL}" cy="${cy}" r="26" fill="${t.accent}"/>` + txt(RAIL, cy + 10, it.node.label, 'display-700', 28, t.onAccent, 'text-anchor="middle"');
    } else {
      body += `<circle cx="${RAIL}" cy="${cy}" r="15" fill="${t.bg}" stroke="${t.accent}" stroke-width="6"/>`;
    }
  }
  body += items.map((i) => i.draw()).join('');
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${height}" width="${W}" height="${height}">${body}</svg>`, width: W, height };
}

// ---- Carousel: 1080 x 1350 slides, one idea per slide ----
export const SLIDE_W = 1080;
export const SLIDE_H = 1350;

function slideFrame(t, n, total, inner, opts = {}) {
  const bg = opts.dark ? t.dark : t.bg;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SLIDE_W} ${SLIDE_H}" width="${SLIDE_W}" height="${SLIDE_H}">` +
    `<rect width="${SLIDE_W}" height="${SLIDE_H}" fill="${bg}"/>` +
    `<path d="M 76 0 C 76 160, 300 90, 520 190 S 980 130, 1004 330" fill="none" stroke="${t.accent2}" stroke-width="5" stroke-linecap="round"/>` +
    inner +
    txt(76, SLIDE_H - 64, `${n} / ${total}`, 'body-600', 26, opts.dark ? t.onDark : t.muted) +
    txt(SLIDE_W - 76, SLIDE_H - 64, 'Threadlight', 'body-600', 26, t.accent2, 'text-anchor="end"') +
    `</svg>`;
}

export function renderCarousel(doc, { showReview = false } = {}) {
  const t = themeOf(doc.design.theme);
  const mw = SLIDE_W - 152;
  const slides = [];
  const total = doc.sections.length + 2;

  const title = fit(doc.title, 'display-800', [124, 108, 96, 84, 72, 60], mw, 5);
  const catW = textWidth(doc.category, 'body-600', 28) + 48;
  const sub = doc.subtitle ? wrap(doc.subtitle, 'body-400', 38, mw).slice(0, 3) : [];
  const lh = Math.round(title.size * 1.04);
  slides.push(slideFrame(t, 1, total,
    `<rect x="76" y="470" width="${catW}" height="48" rx="24" fill="${t.accent}"/>` + txt(76 + 24, 503, doc.category, 'body-600', 28, t.onAccent) +
    lines(76, 560 + title.size, title.lines, 'display-800', title.size, lh, t.ink) +
    lines(76, 560 + title.size + (title.lines.length - 1) * lh + 80, sub, 'body-400', 38, 52, t.muted)));

  doc.sections.forEach((s, idx) => {
    const hd = fit(s.heading, 'display-700', [72, 64, 56, 48], mw, 3);
    const hlh = Math.round(hd.size * 1.15);
    let y = 330 + hd.size;
    let out = lines(76, y, hd.lines, 'display-700', hd.size, hlh, t.ink);
    y += (hd.lines.length - 1) * hlh + 70;
    if (s.visualType === 'stat-card') {
      const v = fit(s.stat.value, 'display-800', [220, 180, 150, 120, 96], mw, 1);
      out += txt(76, y + v.size * 0.8, s.stat.value, 'display-800', v.size, t.accent);
      y += v.size + 30;
      const ls = ellipsize(wrap(s.stat.label, 'body-400', 38, mw), 6, 'body-400', 38, mw);
      out += lines(76, y, ls, 'body-400', 38, 54, t.ink);
    } else if (s.items?.length) {
      const room = SLIDE_H - 200 - y; const per = Math.min(s.items.length, 6);
      s.items.slice(0, per).forEach((it, i) => {
        const ls = ellipsize(wrap(it, 'body-400', 32, mw - 80), 3, 'body-400', 32, mw - 80);
        out += `<circle cx="100" cy="${y - 10}" r="22" fill="${t.accent}"/>` + txt(100, y, String(i + 1), 'display-700', 24, t.onAccent, 'text-anchor="middle"') + lines(150, y, ls, 'body-400', 32, 44, t.ink);
        y += Math.max(70, ls.length * 44 + 22);
      });
      void room;
    } else if (s.columns?.length) {
      s.columns.forEach((c, ci) => {
        out += txt(76, y, c.label, 'display-700', 40, ci === 0 ? t.accent : t.accent2); y += 52;
        c.items.slice(0, 3).forEach((it) => { const ls = ellipsize(wrap(it, 'body-400', 30, mw - 40), 2, 'body-400', 30, mw - 40); out += `<circle cx="88" cy="${y - 10}" r="7" fill="${t.ink}"/>` + lines(112, y, ls, 'body-400', 30, 40, t.ink); y += ls.length * 40 + 14; });
        y += 24;
      });
    } else {
      const d = fit(s.description, 'body-400', [44, 40, 36, 32, 28], mw, 12);
      out += lines(76, y, d.lines, 'body-400', d.size, Math.round(d.size * 1.45), t.ink);
    }
    if (showReview && s.needsReview) out += `<rect x="76" y="${SLIDE_H - 170}" width="250" height="34" rx="17" fill="${t.accent2}"/>` + txt(201, SLIDE_H - 147, 'Check this against source', 'body-600', 17, '#1A1A1A', 'text-anchor="middle"');
    slides.push(slideFrame(t, idx + 2, total, out));
  });

  let y = 340; let out = txt(76, y, 'Key takeaways', 'display-800', 72, t.onDark); y += 90;
  (doc.keyTakeaways.length ? doc.keyTakeaways : [doc.summary]).slice(0, 5).forEach((k) => {
    const ls = ellipsize(wrap(k, 'body-400', 36, mw - 70), 4, 'body-400', 36, mw - 70);
    out += `<circle cx="92" cy="${y - 12}" r="11" fill="${t.accent2}"/>` + lines(124, y, ls, 'body-400', 36, 50, t.onDark);
    y += ls.length * 50 + 34;
  });
  slides.push(slideFrame(t, total, total, out, { dark: true }));
  return { slides: slides.map((svg) => ({ svg, width: SLIDE_W, height: SLIDE_H })) };
}
