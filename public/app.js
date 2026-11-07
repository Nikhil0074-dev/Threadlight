const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  for (const k of kids.flat()) if (k != null) n.append(k.nodeType ? k : document.createTextNode(k));
  return n;
};
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

const S = { meta: null, tab: 'text', source: null, doc: null, mode: 'infographic', projectId: null, hist: [], hi: -1, lastGoodSvg: null, dirty: false };

async function api(path, opts = {}) {
  const init = { method: opts.method || 'GET', headers: {} };
  if (opts.body instanceof FormData) init.body = opts.body;
  else if (opts.body) { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
  let res;
  try { res = await fetch(path, init); } catch { throw new Error('Cannot reach the server. Is it running?'); }
  if (opts.raw && res.ok) return res;
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || `Request failed (${res.status}).`);
  return data;
}

let toastT;
function toast(msg, err = false) {
  const t = $('#toast'); t.textContent = msg; t.className = `toast${err ? ' err' : ''}`; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, err ? 6000 : 2500);
}
const setMsg = (id, text, err = false) => { const m = $(id); m.textContent = text; m.className = `msg${err ? ' err' : ''}`; };
const busy = (on, text = 'Working…') => { $('#busy').hidden = !on; $('#busyText').textContent = text; };

// ---------- views ----------
function show(view) {
  $('#home').hidden = view !== 'home';
  $('#work').hidden = view !== 'work';
  $('#projectBar').hidden = view !== 'work';
  if (view === 'home') loadProjects();
}
async function loadProjects() {
  try {
    const { projects } = await api('/api/projects');
    const ul = $('#projectList'); ul.replaceChildren();
    $('#emptyProjects').hidden = projects.length > 0;
    for (const p of projects) {
      ul.append(el('li', {},
        el('button', { className: 't', onclick: () => openProject(p.id) }, p.title),
        el('span', { className: 'm' }, `${p.sectionCount} sections · ${p.template} · ${p.status} · ${new Date(p.updatedAt).toLocaleDateString()}`),
        el('div', { className: 'row' },
          el('button', { onclick: () => openProject(p.id) }, 'Open'),
          el('button', { className: 'del', onclick: async () => { if (confirm(`Delete “${p.title}”? This cannot be undone.`)) { await api(`/api/projects/${p.id}`, { method: 'DELETE' }); loadProjects(); } } }, 'Delete'))));
    }
  } catch (e) { toast(e.message, true); }
}
function resetWork() {
  Object.assign(S, { source: null, doc: null, projectId: null, hist: [], hi: -1, lastGoodSvg: null, mode: 'infographic' });
  for (const id of ['#srcText', '#srcThread', '#srcUrl', '#reviewText']) $(id).value = '';
  $('#srcFile').value = ''; $('#fileLabel').textContent = 'Drop a PDF, DOCX, TXT or MD file here, or click to choose (max 10 MB)';
  $('#projectTitle').value = 'Untitled project';
  $('#stepReview').hidden = true; $('#stepGen').hidden = true; $('#inspector').hidden = true;
  $('#sheetWrap').hidden = true; $('#empty').hidden = false; $('#srcCount').textContent = '0 words';
  setMsg('#srcMsg', ''); setMsg('#genMsg', ''); syncMode(); updateUndo();
}
async function openProject(id) {
  try {
    const { project: p } = await api(`/api/projects/${id}`);
    resetWork(); show('work');
    S.projectId = p.id; S.doc = p.doc; S.mode = p.mode || 'infographic';
    S.source = { title: p.title, sourceType: p.sourceType };
    $('#projectTitle').value = p.title; $('#reviewText').value = p.sourceText || '';
    $('#srcMeta').textContent = `${p.sourceType} source · saved with this project`; 
    $('#stepReview').hidden = false; $('#stepGen').hidden = false;
    afterDoc(true);
    location.hash = '#work';
  } catch (e) { toast(e.message, true); }
}

// ---------- source ----------
$$('.tabs button').forEach((b) => b.addEventListener('click', () => {
  S.tab = b.dataset.tab;
  $$('.tabs button').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
  $$('.tabpane').forEach((p) => { p.hidden = p.dataset.pane !== S.tab; });
}));
const countWords = (t) => (t.match(/\S+/g) || []).length;
$('#srcText').addEventListener('input', (e) => { $('#srcCount').textContent = `${countWords(e.target.value).toLocaleString()} words`; });
const dz = $('#dropZone');
$('#srcFile').addEventListener('change', (e) => { if (e.target.files[0]) $('#fileLabel').textContent = e.target.files[0].name; });
['dragover', 'dragenter'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, () => dz.classList.remove('over')));
dz.addEventListener('drop', (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) { const dt = new DataTransfer(); dt.items.add(f); $('#srcFile').files = dt.files; $('#fileLabel').textContent = f.name; } });

$('#readBtn').addEventListener('click', async () => {
  setMsg('#srcMsg', '');
  const btn = $('#readBtn'); btn.disabled = true;
  try {
    busy(true, 'Reading source…');
    let r;
    if (S.tab === 'text') r = await api('/api/sources/text', { method: 'POST', body: { text: $('#srcText').value } });
    else if (S.tab === 'thread') r = await api('/api/sources/thread', { method: 'POST', body: { text: $('#srcThread').value } });
    else if (S.tab === 'url') r = await api('/api/sources/url', { method: 'POST', body: { url: $('#srcUrl').value } });
    else {
      const f = $('#srcFile').files[0]; if (!f) throw new Error('Choose a file first.');
      const fd = new FormData(); fd.append('file', f); r = await api('/api/sources/upload', { method: 'POST', body: fd });
    }
    const s = r.source; S.source = s;
    $('#reviewText').value = s.text;
    $('#srcMeta').textContent = `${s.sourceType.toUpperCase()} · ${s.wordCount.toLocaleString()} words${s.pageCount ? ` · ${s.pageCount} pages` : ''}${s.postCount ? ` · ${s.postCount} posts` : ''}`;
    const w = $('#srcWarn'); w.replaceChildren(...(s.warnings || []).map((x) => el('li', {}, x)));
    if (s.title && $('#projectTitle').value === 'Untitled project') $('#projectTitle').value = s.title.slice(0, 120);
    $('#stepReview').hidden = false; $('#stepGen').hidden = false;
    setMsg('#srcMsg', 'Source read. Fix any mistakes below, then generate.');
  } catch (e) { setMsg('#srcMsg', e.message, true); } finally { busy(false); btn.disabled = false; }
});

// ---------- generate ----------
function syncMode() {
  $$('.seg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === S.mode)));
  $('#sheetWrap').classList.toggle('wide', S.mode === 'carousel');
}
$$('.seg button').forEach((b) => b.addEventListener('click', () => { S.mode = b.dataset.mode; syncMode(); if (S.doc) { scheduleRender(); scheduleSave(); } }));
$('#secRange').addEventListener('input', (e) => { $('#secOut').textContent = e.target.value; });

$('#genBtn').addEventListener('click', async () => {
  const text = $('#reviewText').value;
  const btn = $('#genBtn'); btn.disabled = true; setMsg('#genMsg', '');
  try {
    busy(true, 'Finding the key points…');
    const tpl = $('#tplSelect').value;
    const settings = { sections: Number($('#secRange').value), ...(tpl !== 'auto' ? { template: tpl } : {}) };
    const note = S.source?.url || S.source?.title || '';
    const r = await api('/api/generate', { method: 'POST', body: { text, title: S.source?.title || undefined, sourceNote: note || undefined, settings } });
    S.doc = r.doc; S.hist = []; S.hi = -1;
    const msgs = r.warnings.length ? `${r.warnings.length} point(s) need a check. See the orange marks in the sections list.` : 'Done. Every quote was found in your source.';
    setMsg('#genMsg', msgs);
    afterDoc(true);
    const body = { title: $('#projectTitle').value || 'Untitled project', sourceType: S.source?.sourceType || 'text', sourceText: text, doc: S.doc, mode: S.mode };
    if (S.projectId) await api(`/api/projects/${S.projectId}`, { method: 'PUT', body });
    else S.projectId = (await api('/api/projects', { method: 'POST', body })).project.id;
  } catch (e) { setMsg('#genMsg', e.message, true); } finally { busy(false); btn.disabled = false; }
});

// ---------- document state ----------
function afterDoc(resetHistory) {
  $('#inspector').hidden = false; $('#empty').hidden = true; $('#sheetWrap').hidden = false;
  if (resetHistory) { S.hist = [JSON.stringify(S.doc)]; S.hi = 0; }
  syncMode(); buildInspector(); renderNow(); updateUndo();
}
const pushHistory = debounce(() => {
  const snap = JSON.stringify(S.doc);
  if (snap === S.hist[S.hi]) return;
  S.hist = S.hist.slice(0, S.hi + 1); S.hist.push(snap); if (S.hist.length > 100) S.hist.shift();
  S.hi = S.hist.length - 1; updateUndo();
}, 450);
function touch(rebuild = false) {
  S.dirty = true; pushHistory(); scheduleRender(); scheduleSave();
  if (rebuild) buildInspector();
}
function updateUndo() { $('#undoBtn').disabled = S.hi <= 0; $('#redoBtn').disabled = S.hi >= S.hist.length - 1; }
function restore(i) { S.hi = i; S.doc = JSON.parse(S.hist[i]); buildInspector(); renderNow(); scheduleSave(); updateUndo(); }
$('#undoBtn').addEventListener('click', () => { pushHistory.flush?.(); if (S.hi > 0) restore(S.hi - 1); });
$('#redoBtn').addEventListener('click', () => { if (S.hi < S.hist.length - 1) restore(S.hi + 1); });
document.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z' || !S.doc) return;
  if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return; // let text fields use their own undo
  e.preventDefault(); (e.shiftKey ? $('#redoBtn') : $('#undoBtn')).click();
});

// ---------- preview ----------
async function renderNow() {
  if (!S.doc) return;
  try {
    const r = await api('/api/render', { method: 'POST', body: { doc: S.doc, mode: S.mode, preview: true } });
    const sheet = $('#sheet');
    sheet.className = S.mode === 'carousel' ? 'sheet carousel' : 'sheet';
    if (S.mode === 'carousel') sheet.replaceChildren(...r.slides.map((s) => { const d = el('div', { className: 'slide' }); d.innerHTML = s.svg; return d; }));
    else sheet.innerHTML = r.svg;
  } catch (e) { toast(`Preview not updated: ${e.message}`, true); }
}
const scheduleRender = debounce(renderNow, 250);

// ---------- save ----------
async function save(quiet = true) {
  if (!S.doc) return;
  const body = { title: $('#projectTitle').value.trim() || 'Untitled project', doc: S.doc, mode: S.mode, sourceText: $('#reviewText').value, sourceType: S.source?.sourceType || 'text' };
  try {
    if (S.projectId) await api(`/api/projects/${S.projectId}`, { method: 'PUT', body });
    else S.projectId = (await api('/api/projects', { method: 'POST', body })).project.id;
    S.dirty = false; if (!quiet) toast('Saved');
  } catch (e) { toast(`Not saved: ${e.message}`, true); }
}
const scheduleSave = debounce(() => save(true), 1500);
$('#saveBtn').addEventListener('click', () => save(false));
$('#projectTitle').addEventListener('input', scheduleSave);

// ---------- export ----------
const EXPORTS = {
  infographic: [['png', 1, 'PNG', 'For social posts. 1080 px wide'], ['png', 2, 'PNG, sharp', '2160 px wide, for print or zoom'], ['svg', 1, 'SVG', 'Scalable, fonts included'], ['pdf', 1, 'PDF', 'One page']],
  carousel: [['zip', 1, 'ZIP of PNG slides', 'One image per slide'], ['zip', 2, 'ZIP, sharp', '2160 px wide slides'], ['pdf', 1, 'PDF', 'One page per slide']],
};
$('#exportBtn').addEventListener('click', () => {
  const m = $('#exportMenu'); const open = m.hidden;
  m.replaceChildren(...EXPORTS[S.mode].map(([format, scale, label, hint]) => el('button', { role: 'menuitem', onclick: () => doExport(format, scale) }, label, el('small', {}, hint))));
  m.hidden = !open; $('#exportBtn').setAttribute('aria-expanded', String(open));
});
document.addEventListener('click', (e) => { if (!e.target.closest('.menuwrap')) { $('#exportMenu').hidden = true; $('#exportBtn').setAttribute('aria-expanded', 'false'); } });
async function doExport(format, scale) {
  $('#exportMenu').hidden = true;
  if (!S.doc) return toast('Generate something first.', true);
  const flagged = S.doc.sections.filter((s) => s.needsReview).length;
  if (flagged && !confirm(`${flagged} section(s) are marked “check against source”. Export anyway?`)) return;
  try {
    busy(true, 'Rendering your export…');
    if (S.dirty) await save(true);
    const res = await api('/api/export', { method: 'POST', raw: true, body: { doc: S.doc, mode: S.mode, format, scale, projectId: S.projectId || undefined } });
    const blob = await res.blob();
    const name = res.headers.get('X-Filename') || `threadlight.${format}`;
    const a = el('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); a.remove();
    toast(`Downloaded ${name}`);
  } catch (e) { toast(e.message, true); } finally { busy(false); }
}

// ---------- inspector ----------
function fillSelect(sel, withAuto) {
  const labels = { explainer: 'Explainer', steps: 'Step by step', compare: 'Side by side', stats: 'Numbers first' };
  sel.replaceChildren(...[...(withAuto ? ['auto'] : []), ...S.meta.templates].map((t) => el('option', { value: t }, t === 'auto' ? 'Let the app choose' : labels[t])));
}
function field(label, input) { return el('label', { className: 'field' }, label, input); }

function buildInspector() {
  const d = S.doc;
  $('#fTitle').value = d.title; $('#fSubtitle').value = d.subtitle || ''; $('#fSummary').value = d.summary || ''; $('#fTake').value = (d.keyTakeaways || []).join('\n');
  $('#tplSelect2').value = d.design.template;
  const sw = $('#swatches'); sw.replaceChildren(...S.meta.themes.map((t) => {
    const b = el('button', { className: 'swatch', role: 'radio', title: t.name, 'aria-label': t.name, onclick: () => { d.design.theme = t.id; buildInspector(); touch(); } });
    b.setAttribute('aria-checked', String(d.design.theme === t.id));
    b.style.background = t.bg; b.append(el('i')); b.firstChild.style.background = t.accent; return b;
  }));
  const list = $('#secList'); list.replaceChildren();
  d.sections.forEach((s, i) => {
    const status = s.needsReview ? 'bad' : s.sourceVerified ? '' : 'none';
    const det = el('details', { className: 'sec' });
    det.append(el('summary', {}, el('span', { className: `dot ${status}`, title: s.needsReview ? 'Check against source' : s.sourceVerified ? 'Matches source' : 'No source link' }), s.heading, el('span', { className: 'k' }, s.visualType.replace('-', ' '))));
    const body = el('div', { className: 'body' });
    const h = el('input', { value: s.heading, maxLength: 80 }); h.addEventListener('input', () => { s.heading = h.value; touch(); det.querySelector('summary').childNodes[1].textContent = h.value; });
    body.append(field('Heading', h));
    if (s.visualType === 'text-card' || s.description) {
      const t = el('textarea', { rows: 4, value: s.description || '', maxLength: 420 }); t.addEventListener('input', () => { s.description = t.value; touch(); });
      body.append(field('Text', t));
    }
    if (s.visualType === 'stat-card') {
      const v = el('input', { value: s.stat.value, maxLength: 24 }); v.addEventListener('input', () => { s.stat.value = v.value; touch(); });
      const l = el('textarea', { rows: 3, value: s.stat.label, maxLength: 120 }); l.addEventListener('input', () => { s.stat.label = l.value; touch(); });
      body.append(field('Number', v), field('What it means', l));
    }
    if (s.items) {
      const t = el('textarea', { rows: Math.min(8, s.items.length + 1), value: s.items.join('\n') }); t.addEventListener('input', () => { s.items = t.value.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 10); touch(); });
      body.append(field('Items (one per line)', t));
    }
    if (s.columns) {
      s.columns.forEach((c) => {
        const t = el('textarea', { rows: 4, value: c.items.join('\n') }); t.addEventListener('input', () => { const v = t.value.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 8); if (v.length) { c.items = v; touch(); } });
        body.append(field(`${c.label} (one per line)`, t));
      });
    }
    if (s.source?.quote) body.append(el('div', { className: `trace ${s.needsReview ? 'bad' : 'ok'}` }, el('b', {}, s.needsReview ? 'Check this: not found in your source' : 'Found in your source'), `“${s.source.quote.slice(0, 220)}${s.source.quote.length > 220 ? '…' : ''}”`));
    else body.append(el('div', { className: 'trace' }, el('b', {}, 'No source link'), 'This section was added or edited by hand.'));
    body.append(el('div', { className: 'ctl' },
      el('button', { disabled: i === 0, onclick: () => { [d.sections[i - 1], d.sections[i]] = [d.sections[i], d.sections[i - 1]]; touch(true); } }, 'Move up'),
      el('button', { disabled: i === d.sections.length - 1, onclick: () => { [d.sections[i + 1], d.sections[i]] = [d.sections[i], d.sections[i + 1]]; touch(true); } }, 'Move down'),
      el('button', { className: 'del', disabled: d.sections.length <= 1, onclick: () => { d.sections.splice(i, 1); touch(true); } }, 'Remove')));
    det.append(body); list.append(det);
  });
}
const bind = (id, fn) => $(id).addEventListener('input', (e) => { fn(e.target.value); touch(); });
bind('#fTitle', (v) => { S.doc.title = v; });
bind('#fSubtitle', (v) => { S.doc.subtitle = v; });
bind('#fSummary', (v) => { S.doc.summary = v; });
bind('#fTake', (v) => { S.doc.keyTakeaways = v.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 6); });
$('#tplSelect2').addEventListener('change', (e) => { S.doc.design.template = e.target.value; touch(); });
$('#addSec').addEventListener('click', () => {
  if (S.doc.sections.length >= 12) return toast('A sheet can hold up to 12 sections.', true);
  S.doc.sections.push({ id: `section-${Date.now()}`, heading: 'New section', description: 'Write your point here.', visualType: 'text-card', importance: 'medium', sourceVerified: false, needsReview: false });
  touch(true); const all = $$('.sec'); all[all.length - 1]?.setAttribute('open', '');
});

// ---------- start ----------
$('#newBtn').addEventListener('click', () => { resetWork(); show('work'); location.hash = '#work'; });
window.addEventListener('beforeunload', (e) => { if (S.dirty) { e.preventDefault(); e.returnValue = ''; } });
window.addEventListener('hashchange', () => { if (location.hash === '#home' || !location.hash) show('home'); });
(async function init() {
  try {
    S.meta = await api('/api/meta');
    $('#aiBadge').textContent = S.meta.ai === 'anthropic' ? 'AI: Claude' : 'AI: offline mode';
    $('#aiBadge').title = S.meta.ai === 'anthropic' ? 'Content is written by the Anthropic API' : 'Using the built-in rule-based analyzer. Set ANTHROPIC_API_KEY for better results.';
    fillSelect($('#tplSelect'), true); fillSelect($('#tplSelect2'), false);
    resetWork(); show('home');
  } catch (e) { toast(e.message, true); }
})();
