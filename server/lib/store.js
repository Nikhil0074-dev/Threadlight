import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { AppError } from './errors.js';

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// File-based project storage. One JSON file per project. Fine for one user on one machine.
// Replace with PostgreSQL before hosting this for several users (see docs/ROADMAP.md).
export function createStore(dataDir) {
  const dir = path.join(dataDir, 'projects');
  const file = (id) => {
    if (!ID.test(id)) throw new AppError(404, 'NOT_FOUND', 'Project not found.');
    return path.join(dir, `${id}.json`);
  };
  const write = async (p) => {
    const tmp = `${file(p.id)}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(p, null, 2));
    await fs.rename(tmp, file(p.id)); // atomic: a crash never leaves half a file
  };
  return {
    async create(input) {
      await fs.mkdir(dir, { recursive: true });
      const now = new Date().toISOString();
      const p = { id: crypto.randomUUID(), status: 'draft', exports: [], ...input, createdAt: now, updatedAt: now };
      await write(p);
      return p;
    },
    async get(id) {
      try { return JSON.parse(await fs.readFile(file(id), 'utf8')); }
      catch (e) { if (e instanceof AppError) throw e; throw new AppError(404, 'NOT_FOUND', 'Project not found.'); }
    },
    async update(id, patch) {
      const p = await this.get(id);
      const next = { ...p, ...patch, id: p.id, createdAt: p.createdAt, updatedAt: new Date().toISOString() };
      await write(next);
      return next;
    },
    async list() {
      await fs.mkdir(dir, { recursive: true });
      const names = (await fs.readdir(dir)).filter((n) => n.endsWith('.json'));
      const all = await Promise.all(names.map((n) => fs.readFile(path.join(dir, n), 'utf8').then(JSON.parse).catch(() => null)));
      return all.filter(Boolean).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map(({ id, title, sourceType, status, createdAt, updatedAt, doc, exports }) => ({
          id, title, sourceType, status, createdAt, updatedAt, exportCount: exports.length,
          template: doc?.design?.template, theme: doc?.design?.theme, sectionCount: doc?.sections?.length ?? 0,
        }));
    },
    async remove(id) {
      await this.get(id);
      await fs.unlink(file(id));
    },
  };
}
