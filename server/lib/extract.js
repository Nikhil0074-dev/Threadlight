import * as cheerio from 'cheerio';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import { config } from '../config.js';
import { cleanText, countWords } from './clean.js';
import { bad } from './errors.js';
import { safeFetchText } from './ssrf.js';
import { looksLikeThreadUrl, parseThread } from './thread.js';

function finish({ title, text, sourceType, pages, warnings = [], extra = {} }) {
  const cleaned = cleanText(text);
  if (cleaned.length < config.minTextChars) {
    throw bad('EMPTY_CONTENT', `Not enough text found (need at least ${config.minTextChars} characters).`);
  }
  let out = cleaned;
  if (out.length > config.maxTextChars) {
    out = out.slice(0, config.maxTextChars);
    warnings.push(`Text was cut at ${config.maxTextChars} characters.`);
  }
  return {
    title: (title || '').trim().slice(0, 200),
    sourceType,
    text: out,
    wordCount: countWords(out),
    pageCount: pages ?? null,
    warnings,
    ...extra,
  };
}

export function fromText(text, title = '') {
  return finish({ title, text, sourceType: 'text' });
}

export function fromThread(raw) {
  if (looksLikeThreadUrl(raw)) {
    throw bad('THREAD_URL_UNSUPPORTED', 'X does not allow automatic reading of threads. Paste the thread text instead.');
  }
  const { posts, text } = parseThread(raw);
  return finish({ title: '', text, sourceType: 'thread', extra: { postCount: posts.length } });
}

const NOISE = 'script,style,noscript,nav,footer,header,aside,form,iframe,svg,button,[role=navigation],[aria-hidden=true],.advert,.ads,.ad,.cookie,.share,.social,.newsletter,.comments';

export function extractArticleHtml(html) {
  const $ = cheerio.load(html);
  const title =
    $('meta[property="og:title"]').attr('content') || $('h1').first().text() || $('title').text() || '';
  $(NOISE).remove();
  let root = $('article').first();
  if (!root.length) root = $('main').first();
  if (!root.length) {
    // Fall back to the element that holds the most paragraph text.
    let best = null;
    let bestLen = 0;
    $('div,section').each((_, el) => {
      const len = $(el).children('p').text().length;
      if (len > bestLen) { best = el; bestLen = len; }
    });
    root = best ? $(best) : $('body');
  }
  const blocks = [];
  root.find('h1,h2,h3,h4,p,li,blockquote,pre').each((_, el) => {
    const t = $(el).text().replace(/\s+/g, ' ').trim();
    if (t.length >= 3) blocks.push(t);
  });
  return { title: title.replace(/\s+/g, ' ').trim(), text: blocks.join('\n\n') };
}

export async function fromUrl(url) {
  if (looksLikeThreadUrl(url)) {
    throw bad('THREAD_URL_UNSUPPORTED', 'X does not allow automatic reading of threads. Paste the thread text instead.');
  }
  const { body, type, finalUrl } = await safeFetchText(url);
  if (/text\/plain/i.test(type)) return finish({ title: finalUrl, text: body, sourceType: 'url', extra: { url: finalUrl } });
  const { title, text } = extractArticleHtml(body);
  return finish({ title, text, sourceType: 'url', extra: { url: finalUrl } });
}

const isPdf = (b) => b.length > 5 && b.subarray(0, 5).toString('latin1') === '%PDF-';
const isZip = (b) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 3 && b[3] === 4;

export async function fromPdf(buf, filename = '') {
  if (!isPdf(buf)) throw bad('BAD_FILE', 'This file is not a real PDF.');
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  try {
    const res = await parser.getText();
    const pages = res.total ?? res.pages?.length ?? null;
    const warnings = [];
    const perPage = (res.pages || []).map((p) => (p.text || '').trim().length);
    const empty = perPage.filter((n) => n < 20).length;
    if (empty > 0) warnings.push(`${empty} page(s) have little or no text. Scanned pages need OCR, which this version does not include.`);
    return finish({ title: filename.replace(/\.pdf$/i, ''), text: res.text || '', sourceType: 'pdf', pages, warnings });
  } catch (e) {
    if (e.code === 'EMPTY_CONTENT') throw e;
    throw bad('PDF_FAILED', 'Could not read this PDF. It may be damaged or password protected.');
  } finally {
    await parser.destroy().catch(() => {});
  }
}

export async function fromDocx(buf, filename = '') {
  if (!isZip(buf)) throw bad('BAD_FILE', 'This file is not a real Word document.');
  let res;
  try { res = await mammoth.extractRawText({ buffer: buf }); }
  catch { throw bad('DOCX_FAILED', 'Could not read this Word document.'); }
  return finish({ title: filename.replace(/\.docx$/i, ''), text: res.value, sourceType: 'docx', warnings: res.messages.map((m) => m.message) });
}

export function fromPlainFile(buf, filename = '') {
  if (buf.includes(0)) throw bad('BAD_FILE', 'This looks like a binary file, not text.');
  const text = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  return finish({ title: filename.replace(/\.(txt|md|markdown)$/i, ''), text, sourceType: 'text' });
}

export async function fromUpload(buf, originalName = '') {
  const name = String(originalName).replace(/[^\w.\- ]+/g, '_').slice(0, 120);
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (buf.length === 0) throw bad('EMPTY_FILE', 'The file is empty.');
  if (buf.length > config.maxUploadBytes) throw bad('FILE_TOO_LARGE', 'The file is larger than 10 MB.');
  // The file's own bytes decide the type, not its name.
  if (isPdf(buf)) return fromPdf(buf, name);
  if (isZip(buf)) {
    if (ext !== 'docx') throw bad('UNSUPPORTED_FILE', 'Only PDF, DOCX, TXT and MD files are supported.');
    return fromDocx(buf, name);
  }
  if (['txt', 'md', 'markdown'].includes(ext)) return fromPlainFile(buf, name);
  throw bad('UNSUPPORTED_FILE', 'Only PDF, DOCX, TXT and MD files are supported.');
}
