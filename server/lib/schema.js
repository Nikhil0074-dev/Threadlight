import { z } from 'zod';

export const CATEGORIES = ['Educational', 'Technical', 'Scientific', 'Business', 'Financial', 'Historical', 'News', 'Tutorial', 'Comparison', 'Opinion', 'Research', 'General'];
export const VISUAL_TYPES = ['text-card', 'stat-card', 'icon-grid', 'process-flow', 'comparison', 'timeline'];
export const TEMPLATES = ['explainer', 'steps', 'compare', 'stats'];
export const THEMES = ['daylight', 'midnight', 'moss', 'coral'];

const str = (max) => z.string().trim().min(1).max(max);

const Section = z.object({
  id: str(40),
  heading: str(80),
  description: z.string().trim().max(420).default(''),
  visualType: z.enum(VISUAL_TYPES),
  importance: z.enum(['high', 'medium', 'low']).default('medium'),
  stat: z.object({ value: str(24), label: str(120) }).optional(),
  items: z.array(str(200)).max(10).optional(),
  columns: z.array(z.object({ label: str(40), items: z.array(str(200)).min(1).max(8) })).min(2).max(3).optional(),
  // A sentence copied word for word from the source. Used to check the section against the source.
  source: z.object({ quote: z.string().trim().max(600) }).optional(),
  sourceVerified: z.boolean().optional(),
  needsReview: z.boolean().optional(),
});

export const InfographicDoc = z.object({
  title: str(110),
  subtitle: z.string().trim().max(160).default(''),
  category: z.enum(CATEGORIES).default('General'),
  summary: z.string().trim().max(500).default(''),
  sections: z.array(Section).min(1).max(12),
  keyTakeaways: z.array(str(200)).max(6).default([]),
  design: z
    .object({
      template: z.enum(TEMPLATES).default('explainer'),
      theme: z.enum(THEMES).default('daylight'),
      orientation: z.enum(['portrait']).default('portrait'),
    })
    .default({ template: 'explainer', theme: 'daylight', orientation: 'portrait' }),
  sourceNote: z.string().trim().max(300).optional(),
}).superRefine((d, ctx) => {
  const ids = new Set();
  d.sections.forEach((s, i) => {
    if (ids.has(s.id)) ctx.addIssue({ code: 'custom', path: ['sections', i, 'id'], message: 'Duplicate section id' });
    ids.add(s.id);
    if (s.visualType === 'stat-card' && !s.stat) ctx.addIssue({ code: 'custom', path: ['sections', i, 'stat'], message: 'stat-card needs a stat' });
    if (s.visualType === 'comparison' && !s.columns) ctx.addIssue({ code: 'custom', path: ['sections', i, 'columns'], message: 'comparison needs columns' });
    if (['process-flow', 'timeline', 'icon-grid'].includes(s.visualType) && !(s.items && s.items.length)) {
      ctx.addIssue({ code: 'custom', path: ['sections', i, 'items'], message: `${s.visualType} needs items` });
    }
  });
});

export const GenerateSettings = z.object({
  sections: z.coerce.number().int().min(2).max(10).default(5),
  template: z.enum(TEMPLATES).optional(),
  theme: z.enum(THEMES).optional(),
  detail: z.enum(['short', 'detailed']).default('short'),
}).default({ sections: 5, detail: 'short' });

export function formatZodError(e) {
  return e.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
}
