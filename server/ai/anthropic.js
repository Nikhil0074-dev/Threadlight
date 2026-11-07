import { config } from '../config.js';
import { InfographicDoc, formatZodError } from '../lib/schema.js';
import { SYSTEM_PROMPT, buildUserPrompt } from './prompts.js';

function extractJson(text) {
  const cleaned = String(text).replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('No JSON object in the answer.');
  return JSON.parse(cleaned.slice(start, end + 1));
}

// Calls the Anthropic Messages API. The answer must pass the strict schema.
// On a bad answer it retries up to `retries` times, telling the model what was wrong.
export async function analyzeWithAnthropic(text, { title, settings }, { fetchImpl = fetch, retries = 2 } = {}) {
  if (!config.anthropicKey) throw new Error('ANTHROPIC_API_KEY is not set.');
  const messages = [{ role: 'user', content: buildUserPrompt(text, { title, settings }) }];
  let lastError = 'unknown';
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': config.anthropicKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: config.anthropicModel, max_tokens: 4000, system: SYSTEM_PROMPT, messages }),
    });
    if (!res.ok) throw new Error(`AI service answered with status ${res.status}.`);
    const data = await res.json();
    const answer = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    try {
      const parsed = InfographicDoc.safeParse(extractJson(answer));
      if (parsed.success) return parsed.data;
      lastError = formatZodError(parsed.error);
    } catch (e) {
      lastError = e.message;
    }
    messages.push({ role: 'assistant', content: answer });
    messages.push({ role: 'user', content: `That answer was invalid: ${lastError}. Return only the corrected JSON object.` });
  }
  throw new Error(`AI answer failed validation: ${lastError}`);
}
