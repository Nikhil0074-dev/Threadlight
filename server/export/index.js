import fs from 'node:fs';
import JSZip from 'jszip';
import PDFDocument from 'pdfkit';
import { Resvg } from '@resvg/resvg-js';
import { FAMILY, allFontPaths, fontPath } from '../render/fonts.js';
import { renderCarousel, renderInfographic } from '../render/svg.js';

export function svgToPng(svg, width) {
  const r = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    font: { fontFiles: allFontPaths(), loadSystemFonts: false, defaultFontFamily: FAMILY.body },
    background: 'rgba(0,0,0,0)',
  });
  return r.render().asPng();
}

// A stand-alone SVG must carry its fonts, or other apps will swap them.
export function embedFonts(svg) {
  const face = (family, weight, key) =>
    `@font-face{font-family:'${family}';font-weight:${weight};src:url(data:font/ttf;base64,${fs.readFileSync(fontPath(key)).toString('base64')}) format('truetype');}`;
  const css = [face(FAMILY.display, 800, 'display-800'), face(FAMILY.display, 700, 'display-700'), face(FAMILY.body, 400, 'body-400'), face(FAMILY.body, 600, 'body-600')].join('');
  return svg.replace(/^(<svg[^>]*>)/, `$1<defs><style>${css}</style></defs>`);
}

function pdfFromPngs(pngs, sizes) {
  return new Promise((resolve, reject) => {
    // PDF points: 1080 px wide becomes 540 pt (7.5 in). The page keeps the design's aspect ratio.
    const doc = new PDFDocument({ autoFirstPage: false, margin: 0, info: { Producer: 'Threadlight' } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    pngs.forEach((png, i) => {
      const w = sizes[i].width / 2;
      const h = sizes[i].height / 2;
      doc.addPage({ size: [w, h], margin: 0 });
      doc.image(png, 0, 0, { width: w, height: h });
    });
    doc.end();
  });
}

export const FORMATS = {
  infographic: ['png', 'svg', 'pdf'],
  carousel: ['zip', 'pdf', 'png'], // png = first slide only is not offered; see below
};

// Returns { buffer, contentType, filename }.
export async function exportDoc(doc, { mode = 'infographic', format = 'png', scale = 1 } = {}) {
  const safe = (doc.title || 'infographic').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'infographic';
  const pxWidth = Math.round(1080 * Math.min(Math.max(scale, 1), 3));
  if (mode === 'infographic') {
    const r = renderInfographic(doc);
    if (format === 'svg') return { buffer: Buffer.from(embedFonts(r.svg)), contentType: 'image/svg+xml', filename: `${safe}.svg` };
    if (format === 'png') return { buffer: svgToPng(r.svg, pxWidth), contentType: 'image/png', filename: `${safe}.png` };
    if (format === 'pdf') return { buffer: await pdfFromPngs([svgToPng(r.svg, 2160)], [r]), contentType: 'application/pdf', filename: `${safe}.pdf` };
  } else {
    const { slides } = renderCarousel(doc);
    if (format === 'zip') {
      const zip = new JSZip();
      slides.forEach((s, i) => zip.file(`slide-${String(i + 1).padStart(2, '0')}.png`, svgToPng(s.svg, pxWidth)));
      return { buffer: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }), contentType: 'application/zip', filename: `${safe}-carousel.zip` };
    }
    if (format === 'pdf') return { buffer: await pdfFromPngs(slides.map((s) => svgToPng(s.svg, 2160)), slides), contentType: 'application/pdf', filename: `${safe}-carousel.pdf` };
  }
  const e = new Error(`Format "${format}" is not available for ${mode}.`);
  e.status = 400; e.code = 'BAD_FORMAT';
  throw e;
}
