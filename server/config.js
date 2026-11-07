import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const config = {
  port: Number(process.env.PORT || 3000),
  dataDir: process.env.THREADLIGHT_DATA || path.join(ROOT, 'data'),
  maxUploadBytes: 10 * 1024 * 1024,
  maxTextChars: 60000,
  minTextChars: 80,
  // Max characters sent to an LLM in one request. Longer text is reduced first.
  llmInputChars: 20000,
  anthropicKey: process.env.ANTHROPIC_API_KEY || '',
  anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
  // Test-only switch. Never enable in production: it turns off the SSRF guard.
  allowPrivateUrls: process.env.THREADLIGHT_ALLOW_PRIVATE === '1',
};

export const FONT_DIR = path.join(ROOT, 'node_modules', '@expo-google-fonts');
