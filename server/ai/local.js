// Offline, rule-based analyzer. No network and no API key. It is the fallback when no LLM is
// configured or when an LLM answer fails validation. It only selects and rearranges sentences
// that exist in the source, so it cannot invent facts. Its output is plainer than an LLM's.
import { splitSentences } from '../lib/clean.js';

const STOP = new Set('a an and are as at be been but by can could did do does for from had has have he her his how i if in into is it its may might more most my new no not of on one or our out over she so some such than that the their them then there these they this those to up us use used using was we were what when which who why will with would you your about also after all any because both each few get got just like make many much only other same should still than too very via while per vs'.split(' ').filter(Boolean));

const words = (s) => (s.toLowerCase().match(/[a-z][a-z'-]{2,}/g) || []).filter((w) => !STOP.has(w));
const STAT_RE = /(?:[$€£₹]\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:billion|million|thousand|crore|lakh|bn|k|m)\b)?|\d[\d,]*(?:\.\d+)?\s?(?:%|percent\b|x\b|×|billion\b|million\b|thousand\b|crore\b|lakh\b|bn\b|k\b|m\b|hours?|days?|weeks?|months?|years?|minutes?|seconds?|km|kg|mph|gb|mb|tb))/i;
const YEAR_RE = /\b(1[5-9]\d{2}|20\d{2})\b/;

const titleCase = (s) => s.replace(/\b([a-z])/g, (m) => m.toUpperCase());
const clip = (s, n) => (s.length <= n ? s : `${s.slice(0, n - 1).replace(/\s+\S*$/, '')}…`);

function classify(text) {
  const t = text.toLowerCase();
  const hit = (re) => (t.match(re) || []).length;
  const scores = {
    Tutorial: hit(/\b(step \d|first,|next,|then,|finally|how to|install|tutorial|guide)\b/g),
    Comparison: hit(/\b(vs\.?|versus|compared to|pros|cons|advantages|disadvantages|whereas|difference between)\b/g),
    Financial: hit(/\b(revenue|profit|stock|market cap|investment|inflation|\$|budget|earnings)\b/g),
    Scientific: hit(/\b(study|researchers?|experiment|hypothesis|participants|results show|published)\b/g),
    Historical: hit(/\b(century|centuries|empire|war|ancient|founded|dynasty|revolution|medieval)\b/g),
    Technical: hit(/\b(api|server|database|algorithm|software|code|protocol|latency|framework)\b/g),
    Business: hit(/\b(customers?|strategy|startup|growth|marketing|company|product|sales)\b/g),
    News: hit(/\b(announced|said on|according to|reported|officials?|yesterday|on monday|on tuesday)\b/g),
    Opinion: hit(/\b(i think|i believe|in my view|should|must|unpopular opinion)\b/g),
  };
  const [name, score] = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  return score >= 3 ? name : 'Educational';
}

function stepsFrom(text) {
  const lines = text.split('\n').map((l) => l.trim());
  const numbered = lines.filter((l) => /^(?:step\s*)?\d{1,2}[.):]\s+\S/i.test(l)).map((l) => l.replace(/^(?:step\s*)?\d{1,2}[.):]\s+/i, ''));
  if (numbered.length >= 3) return numbered.slice(0, 8);
  const seq = splitSentences(text).filter((s) => /^(first|second|third|next|then|after that|finally|lastly)\b/i.test(s));
  return seq.length >= 3 ? seq.slice(0, 8).map((s) => s.replace(/^(first|second|third|next|then|after that|finally|lastly),?\s*/i, '')).map((s) => s.charAt(0).toUpperCase() + s.slice(1)) : [];
}

function prosCons(text) {
  const lines = text.split('\n').map((l) => l.trim());
  const idx = (re) => lines.findIndex((l) => re.test(l));
  const p = idx(/^(pros|advantages|benefits)\b[:\s]*$/i);
  const c = idx(/^(cons|disadvantages|drawbacks)\b[:\s]*$/i);
  if (p < 0 || c < 0) return null;
  const grab = (from, stop) => lines.slice(from + 1, stop).map((l) => l.replace(/^[-*•]\s*/, '')).filter(Boolean).slice(0, 6);
  const [a, b] = p < c ? [grab(p, c), grab(c, lines.length)] : [grab(p, lines.length), grab(c, p)];
  if (!a.length || !b.length) return null;
  return [{ label: 'Pros', items: a }, { label: 'Cons', items: b }];
}

export function analyzeLocal(text, { title = '', settings = {} } = {}) {
  const n = settings.sections ?? 5;
  const sentences = splitSentences(text).filter((s) => s.length >= 30 && s.length <= 420 && !/^[-*•\d]+[.)]?\s*$/.test(s));
  const tf = new Map();
  for (const s of sentences) for (const w of new Set(words(s))) tf.set(w, (tf.get(w) || 0) + 1);
  // Words that appear across several sentences carry the topic.
  const score = (s, i) => {
    const ws = words(s);
    if (!ws.length) return 0;
    const topical = ws.reduce((a, w) => a + Math.min(tf.get(w) || 0, 6), 0) / Math.sqrt(ws.length);
    const pos = i < 3 ? 1.25 : 1;
    const num = STAT_RE.test(s) ? 1.15 : 1;
    const len = s.length > 60 && s.length < 260 ? 1.1 : 0.85;
    return topical * pos * num * len;
  };
  const ranked = sentences.map((s, i) => ({ s, i, v: score(s, i) })).sort((a, b) => b.v - a.v);

  const ctx = { used: new Set(), bigrams: topBigrams(sentences) };
  const category = classify(text);
  const steps = stepsFrom(text);
  const cols = prosCons(text);
  const years = sentences.filter((s) => YEAR_RE.test(s));

  const sections = [];
  const used = new Set();
  const add = (sec) => { sections.push({ ...sec, id: `section-${sections.length + 1}` }); };

  if (steps.length >= 3) {
    add({ heading: 'How it works', description: '', visualType: 'process-flow', importance: 'high', items: steps.map((s) => clip(s, 190)), source: { quote: sentences.find((s) => s.includes(steps[0].slice(0, 25))) || steps[0] } });
  }
  if (cols) {
    add({ heading: 'Pros and cons', description: '', visualType: 'comparison', importance: 'high', columns: cols.map((c) => ({ label: c.label, items: c.items.map((i) => clip(i, 190)) })) });
  }
  if (years.length >= 3 && !steps.length) {
    const ordered = [...years].sort((a, b) => Number(a.match(YEAR_RE)[1]) - Number(b.match(YEAR_RE)[1])).slice(0, 6);
    add({ heading: 'Timeline', description: '', visualType: 'timeline', importance: 'medium', items: ordered.map((s) => { const y = s.match(YEAR_RE)[1]; const rest = s.replace(new RegExp(`^(?:In|By|Since|During)\\s+${y},?\\s*`, 'i'), ''); return clip(`${y}: ${rest.charAt(0).toUpperCase()}${rest.slice(1)}`, 190); }), source: { quote: ordered[0] } });
    ordered.forEach((s) => used.add(s));
  }
  let statCount = 0;
  for (const r of [...ranked].sort((a, b) => a.i - b.i)) {
    if (statCount >= 3) break;
    const m = r.s.match(STAT_RE);
    if (!m || used.has(r.s)) continue;
    used.add(r.s);
    statCount += 1;
    add({ heading: clip(sectionName(r.s, tf, ctx), 60), description: '', visualType: 'stat-card', importance: 'high', stat: { value: m[0].trim().slice(0, 24), label: clip(r.s, 118) }, source: { quote: r.s } });
  }
  const textSlots = Math.max(1, n - sections.length);
  const dep = /^(this|these|those|they|it|because|so|but|and|however|also|such)\b/i;
  const pool = ranked.filter((r) => !used.has(r.s));
  const picked = [...pool.filter((r) => !dep.test(r.s)), ...pool.filter((r) => dep.test(r.s))].slice(0, textSlots).sort((a, b) => a.i - b.i);
  for (const r of picked) {
    used.add(r.s);
    add({ heading: clip(sectionName(r.s, tf, ctx), 60), description: clip(r.s, 280), visualType: 'text-card', importance: r.v > ranked[0].v * 0.7 ? 'high' : 'medium', source: { quote: r.s } });
  }
  if (!sections.length) throw new Error('No usable sentences found.');
  const trimmed = sections.slice(0, 10).map((s, i) => ({ ...s, id: `section-${i + 1}` }));

  const dependent = /^(this|these|those|that|they|it|because|so|but|and|however|also|such|then)\b/i;
  const rest = ranked.filter((r) => !used.has(r.s) && !dependent.test(r.s) && !/\b(this step|this way|the above)\b/i.test(r.s)).slice(0, 3).sort((a, b) => a.i - b.i).map((r) => clip(r.s, 190));
  const top2 = ranked.slice(0, 2).sort((a, b) => a.i - b.i).map((r) => r.s).join(' ');
  const topWords = [...tf].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([w]) => w);

  const template = settings.template || (steps.length >= 3 || category === 'Tutorial' ? 'steps' : cols || category === 'Comparison' ? 'compare' : statCount >= 2 || category === 'Financial' ? 'stats' : 'explainer');
  return {
    title: clip(title || (ctx.bigrams[0] ? `${titleCase(ctx.bigrams[0][0])}: the key points` : topWords.length ? `${titleCase(topWords.slice(0, 2).join(' '))}: the key points` : 'Key points'), 100),
    subtitle: 'A quick visual summary',
    category,
    summary: clip(top2, 480),
    sections: trimmed,
    keyTakeaways: rest.length ? rest : [clip(sentences[0] || trimmed[0].heading, 190)],
    design: { template, theme: settings.theme || 'daylight', orientation: 'portrait' },
  };
}

// Heading: a frequent two-word phrase from the source if the sentence has one,
// else the two most topical words in the order they appear. Always unique.
function sectionName(sentence, tf, ctx = {}) {
  const lower = sentence.toLowerCase();
  const used = ctx.used || new Set();
  const candidates = [];
  if (ctx.bigrams) for (const [bg] of ctx.bigrams) if (lower.includes(bg)) candidates.push(bg);
  const ws = [...new Set(words(sentence))];
  const best = [...ws].sort((a, b) => (tf.get(b) || 0) - (tf.get(a) || 0)).slice(0, 2);
  const ordered = [...new Set((lower.match(/[a-z][a-z'-]{2,}/g) || []).filter((w) => best.includes(w)))];
  const lead = sentence.split(/\s+/).slice(0, 4).map((w) => w.replace(/[,.;:]+$/, ''));
  while (lead.length > 2 && STOP.has(lead[lead.length - 1].toLowerCase())) lead.pop();
  const meaningful = lead.filter((w) => !STOP.has(w.toLowerCase())).length;
  if (meaningful >= 2) candidates.push(lead.join(' '));
  if (ordered.length) candidates.push(ordered.join(' '));
  const pick = candidates.find((c) => !used.has(c)) || `Point ${used.size + 1}`;
  used.add(pick);
  return titleCase(pick);
}

function topBigrams(sentences) {
  const counts = new Map();
  for (const s of sentences) {
    const ws = (s.toLowerCase().match(/[a-z][a-z'-]{2,}/g) || []);
    for (let i = 0; i < ws.length - 1; i += 1) {
      if (STOP.has(ws[i]) || STOP.has(ws[i + 1])) continue;
      const k = `${ws[i]} ${ws[i + 1]}`;
      counts.set(k, (counts.get(k) || 0) + 1);
    }
  }
  return [...counts].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 5);
}
