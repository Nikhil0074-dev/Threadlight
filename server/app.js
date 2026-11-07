import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { z } from 'zod';
import { generateDoc } from './ai/index.js';
import { config, FONT_DIR, ROOT } from './config.js';
import { exportDoc } from './export/index.js';
import { AppError, bad } from './lib/errors.js';
import * as extract from './lib/extract.js';
import { GenerateSettings, InfographicDoc, TEMPLATES, formatZodError } from './lib/schema.js';
import { createStore } from './lib/store.js';
import { renderCarousel, renderInfographic } from './render/svg.js';
import { THEMES } from './render/themes.js';

function rateLimiter({ windowMs, max }) {
  const hits = new Map();
  return (req, _res, next) => {
    const now = Date.now();
    const key = req.ip;
    const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
    arr.push(now);
    hits.set(key, arr);
    if (arr.length > max) return next(new AppError(429, 'RATE_LIMITED', 'Too many requests. Wait a minute and try again.'));
    return next();
  };
}

const parse = (schema, body) => {
  const r = schema.safeParse(body);
  if (!r.success) throw bad('INVALID_INPUT', formatZodError(r.error));
  return r.data;
};
const wrapAsync = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function createApp({ dataDir = config.dataDir } = {}) {
  const app = express();
  const store = createStore(dataDir);
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'",
    });
    next();
  });
  app.use(express.json({ limit: '2mb' }));
  const heavy = rateLimiter({ windowMs: 60_000, max: 40 });
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadBytes, files: 1 } });

  app.get('/api/health', (_req, res) => res.json({ ok: true, ai: config.anthropicKey ? 'anthropic' : 'offline' }));
  app.get('/api/meta', (_req, res) =>
    res.json({ templates: TEMPLATES, themes: Object.entries(THEMES).map(([id, t]) => ({ id, name: t.name, bg: t.bg, accent: t.accent, accent2: t.accent2, ink: t.ink })), ai: config.anthropicKey ? 'anthropic' : 'offline' }));

  // ---- Sources ----
  app.post('/api/sources/text', wrapAsync((req, res) => {
    const { text, title } = parse(z.object({ text: z.string().max(400000), title: z.string().max(200).optional() }), req.body);
    res.json({ source: extract.fromText(text, title) });
  }));
  app.post('/api/sources/thread', wrapAsync((req, res) => {
    const { text } = parse(z.object({ text: z.string().max(400000) }), req.body);
    res.json({ source: extract.fromThread(text) });
  }));
  app.post('/api/sources/url', heavy, wrapAsync(async (req, res) => {
    const { url } = parse(z.object({ url: z.string().max(2000) }), req.body);
    res.json({ source: await extract.fromUrl(url) });
  }));
  app.post('/api/sources/upload', heavy, (req, res, next) => {
    upload.single('file')(req, res, (err) => {
      if (err?.code === 'LIMIT_FILE_SIZE') return next(new AppError(413, 'FILE_TOO_LARGE', 'The file is larger than 10 MB.'));
      return next(err);
    });
  }, wrapAsync(async (req, res) => {
    if (!req.file) throw bad('NO_FILE', 'Choose a file to upload.');
    res.json({ source: await extract.fromUpload(req.file.buffer, req.file.originalname) });
  }));

  // ---- Generate / render / export ----
  app.post('/api/generate', heavy, wrapAsync(async (req, res) => {
    const body = parse(z.object({ text: z.string().min(1).max(400000), title: z.string().max(200).optional(), sourceNote: z.string().max(300).optional(), settings: GenerateSettings.optional() }), req.body);
    if (body.text.trim().length < config.minTextChars) throw bad('EMPTY_CONTENT', `Not enough text (need at least ${config.minTextChars} characters).`);
    const r = await generateDoc(body.text.slice(0, config.maxTextChars), { title: body.title, settings: body.settings });
    if (body.sourceNote) r.doc.sourceNote = body.sourceNote;
    res.json(r);
  }));
  app.post('/api/render', wrapAsync((req, res) => {
    const { doc, mode, preview } = parse(z.object({ doc: InfographicDoc, mode: z.enum(['infographic', 'carousel']).default('infographic'), preview: z.boolean().default(false) }), req.body);
    res.json(mode === 'carousel' ? renderCarousel(doc, { showReview: preview }) : renderInfographic(doc, { showReview: preview }));
  }));
  app.post('/api/export', heavy, wrapAsync(async (req, res) => {
    const { doc, mode, format, scale, projectId } = parse(z.object({
      doc: InfographicDoc, mode: z.enum(['infographic', 'carousel']).default('infographic'),
      format: z.enum(['png', 'svg', 'pdf', 'zip']), scale: z.coerce.number().min(1).max(3).default(1), projectId: z.string().optional(),
    }), req.body);
    const out = await exportDoc(doc, { mode, format, scale });
    if (projectId) {
      const p = await store.get(projectId);
      await store.update(projectId, { status: 'complete', exports: [...p.exports, { format, mode, at: new Date().toISOString() }].slice(-50) });
    }
    res.set({ 'Content-Type': out.contentType, 'Content-Disposition': `attachment; filename="${out.filename}"`, 'X-Filename': out.filename });
    res.send(out.buffer);
  }));

  // ---- Projects ----
  const ProjectIn = z.object({ title: z.string().min(1).max(200), sourceType: z.string().max(20).default('text'), sourceText: z.string().max(400000).default(''), doc: InfographicDoc, mode: z.enum(['infographic', 'carousel']).default('infographic') });
  app.get('/api/projects', wrapAsync(async (_req, res) => res.json({ projects: await store.list() })));
  app.post('/api/projects', wrapAsync(async (req, res) => res.status(201).json({ project: await store.create(parse(ProjectIn, req.body)) })));
  app.get('/api/projects/:id', wrapAsync(async (req, res) => res.json({ project: await store.get(req.params.id) })));
  app.put('/api/projects/:id', wrapAsync(async (req, res) => {
    const patch = parse(ProjectIn.partial().extend({ status: z.enum(['draft', 'complete']).optional() }), req.body);
    res.json({ project: await store.update(req.params.id, patch) });
  }));
  app.delete('/api/projects/:id', wrapAsync(async (req, res) => { await store.remove(req.params.id); res.status(204).end(); }));

  // ---- Static ----
  app.use('/fonts', express.static(path.join(FONT_DIR), { index: false, fallthrough: true, setHeaders: (r) => r.set('Cache-Control', 'public, max-age=86400') }));
  app.use(express.static(path.join(ROOT, 'public')));

  app.use('/api', (_req, _res, next) => next(new AppError(404, 'NOT_FOUND', 'Unknown API route.')));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: { code: 'TOO_LARGE', message: 'That request is too large.' } });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: { code: 'BAD_JSON', message: 'The request body is not valid JSON.' } });
    const status = err.status && err.code ? err.status : 500;
    if (status === 500) console.error(err);
    res.status(status).json({ error: { code: err.code || 'SERVER_ERROR', message: status === 500 ? 'Something went wrong on our side.' : err.message } });
  });
  return app;
}
