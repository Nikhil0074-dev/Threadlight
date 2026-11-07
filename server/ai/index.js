import { config } from '../config.js';
import { cleanText } from '../lib/clean.js';
import { splitSentences } from '../lib/clean.js';
import { GenerateSettings, InfographicDoc, formatZodError } from '../lib/schema.js';
import { verifyDoc } from '../lib/verify.js';
import { analyzeWithAnthropic } from './anthropic.js';
import { analyzeLocal } from './local.js';
import { PROMPT_VERSION } from './prompts.js';

// Long input is shortened before it goes to an LLM: keep the sentences in original order,
// dropping evenly spaced ones until the text fits.
export function reduceForLlm(text, limit = config.llmInputChars) {
  if (text.length <= limit) return { text, reduced: false };
  const s = splitSentences(text);
  const keepRatio = limit / text.length;
  const out = [];
  let acc = 0;
  s.forEach((sent, i) => {
    acc += keepRatio;
    if (acc >= 1 || i === 0) { out.push(sent); acc -= 1; }
  });
  return { text: out.join(' ').slice(0, limit), reduced: true };
}

// Main entry. Always returns a valid, verified document, or throws.
export async function generateDoc(rawText, { title = '', settings: rawSettings, provider, deps } = {}) {
  const settings = GenerateSettings.parse(rawSettings ?? {});
  const text = cleanText(rawText);
  const warnings = [];
  const wanted = provider || (config.anthropicKey ? 'anthropic' : 'local');
  let doc;
  let used = 'local';

  if (wanted === 'anthropic') {
    try {
      const r = reduceForLlm(text);
      if (r.reduced) warnings.push('The text was long, so some sentences were skipped before AI analysis.');
      doc = await analyzeWithAnthropic(r.text, { title, settings }, deps);
      used = 'anthropic';
    } catch (e) {
      warnings.push(`AI service failed (${e.message}). Used the offline analyzer instead.`);
    }
  }
  if (!doc) doc = analyzeLocal(text, { title, settings });

  if (settings.template) doc.design.template = settings.template;
  if (settings.theme) doc.design.theme = settings.theme;
  const parsed = InfographicDoc.safeParse(doc);
  if (!parsed.success) throw new Error(`Generated content is invalid: ${formatZodError(parsed.error)}`);
  const verified = verifyDoc(parsed.data, text);
  return { doc: verified.doc, warnings: [...warnings, ...verified.warnings], meta: { provider: used, promptVersion: PROMPT_VERSION } };
}
