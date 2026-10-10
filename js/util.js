// Small shared helpers: DOM building, dates/day numbers, RNG, formatting.

/** Create an element. `h('div.card', {onclick}, 'text', childEl)` */
export function h(spec, props, ...kids) {
  const [tag, ...cls] = String(spec).split('.');
  const el = document.createElement(tag || 'div');
  if (cls.length) el.className = cls.join(' ');
  if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) {
    kids.unshift(props);
  } else if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className += (el.className ? ' ' : '') + v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  add(el, kids);
  return el;
}
function add(el, kids) {
  for (const k of kids) {
    if (k == null || k === false) continue;
    if (Array.isArray(k)) add(el, k);
    else el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// ---------------------------------------------------------------------------
// Dates. A "study day" starts at `dayCutoffHour` local time (default 04:00) so
// a late-night session still counts towards the previous day.
// ---------------------------------------------------------------------------

let dayCutoffHour = 4;
export function setDayCutoff(hour) { dayCutoffHour = Number(hour) || 0; }
export function getDayCutoff() { return dayCutoffHour; }

export const DAY_MS = 86400000;

/** Integer day index for a timestamp, respecting the cutoff hour and local tz. */
export function dayNumber(ts = Date.now()) {
  const d = new Date(ts - dayCutoffHour * 3600000);
  return Math.floor((d.getTime() - d.getTimezoneOffset() * 60000) / DAY_MS);
}

/** Timestamp at which the study day `n` starts. */
export function dayStart(n) {
  const probe = new Date(n * DAY_MS);
  const local = new Date(probe.getUTCFullYear(), probe.getUTCMonth(), probe.getUTCDate(), dayCutoffHour);
  return local.getTime();
}

export function dateOfDay(n) { return new Date(dayStart(n)); }

export const today = () => dayNumber();

export function fmtDate(ts) {
  return new Date(ts).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
export function fmtDateTime(ts) {
  return new Date(ts).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** "in 3 Tagen" / "heute" / "seit 2 Tagen fällig" */
export function fmtDue(due) {
  if (due == null) return '—';
  const d = dayNumber(due) - today();
  if (d < 0) return `${-d} ${-d === 1 ? 'Tag' : 'Tage'} überfällig`;
  if (d === 0) return 'heute';
  if (d === 1) return 'morgen';
  if (d < 31) return `in ${d} Tagen`;
  const mo = Math.round(d / 30);
  return `in ${mo} ${mo === 1 ? 'Monat' : 'Monaten'}`;
}

export function fmtInterval(days) {
  if (!days) return '—';
  if (days < 1) return '<1 T';
  if (days < 31) return `${Math.round(days)} T`;
  if (days < 365) return `${(days / 30).toFixed(1)} Mon`;
  return `${(days / 365).toFixed(1)} J`;
}

export function fmtMs(ms) {
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

// ---------------------------------------------------------------------------
// Randomness — seedable so "next up" previews stay stable within a render.
// ---------------------------------------------------------------------------

export function shuffle(arr, rnd = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/** Deterministic 32-bit PRNG (mulberry32). */
export function rngFrom(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const sum = (a) => a.reduce((x, y) => x + y, 0);
export const uniq = (a) => [...new Set(a)];
export function groupBy(arr, fn) {
  const m = new Map();
  for (const x of arr) {
    const k = fn(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}

export const LEVEL_NAME = (lv) => (lv === 0 ? 'Ohne JLPT-Stufe' : `JLPT N${lv}`);
export const TRACK_NAME = { recognition: 'Erkennen', writing: 'Schreiben' };

/** Mastery -> colour along the reference app's white->red->orange->yellowgreen->green ramp. */
const RAMP = [
  [0, [242, 245, 250]],   // new / untouched
  [1, [229, 84, 75]],     // just started
  [35, [232, 135, 61]],
  [60, [216, 201, 63]],
  [80, [141, 198, 63]],
  [90, [53, 169, 91]],
  [100, [46, 158, 84]],
];
export function masteryColor(m) {
  if (m <= 0) return 'rgb(242,245,250)';
  for (let i = 1; i < RAMP.length; i++) {
    const [p1, c1] = RAMP[i - 1];
    const [p2, c2] = RAMP[i];
    if (m <= p2) {
      const t = p2 === p1 ? 0 : (m - p1) / (p2 - p1);
      const c = c1.map((v, k) => Math.round(v + (c2[k] - v) * t));
      return `rgb(${c.join(',')})`;
    }
  }
  return 'rgb(46,158,84)';
}

/** Text colour readable on top of masteryColor(m). */
export const masteryInk = (m) => (m <= 0 ? '#1d2230' : m >= 1 && m < 55 ? '#fff' : m < 88 ? '#1d2230' : '#fff');

export function download(filename, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function pickFile(accept = 'application/json') {
  return new Promise((resolve) => {
    const inp = h('input', { type: 'file', accept, style: { display: 'none' } });
    inp.addEventListener('change', () => { resolve(inp.files[0] || null); inp.remove(); });
    document.body.append(inp);
    inp.click();
  });
}
