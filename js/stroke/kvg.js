/**
 * KanjiVG rendering helpers.
 *
 * All geometry stays in KanjiVG's native 109x109 viewBox. Stroke "medians"
 * (evenly spaced points along a stroke) are sampled in the browser with
 * getPointAtLength instead of being shipped in the data files — the browser
 * already has an exact path implementation, and it halves the payload.
 */

import * as data from '../data.js';

export const VB = 109;
const NS = 'http://www.w3.org/2000/svg';

export const svg = (tag, attrs = {}) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  return el;
};

/** Off-screen measuring surface: detached paths report length 0 in some engines. */
let measure = null;
function measurePath(d) {
  if (!measure) {
    measure = svg('svg', { width: 0, height: 0, viewBox: `0 0 ${VB} ${VB}` });
    Object.assign(measure.style, {
      position: 'absolute', width: '0', height: '0', overflow: 'hidden',
      opacity: '0', pointerEvents: 'none', left: '-9999px',
    });
    document.body.append(measure);
  }
  let p = measure.firstChild;
  if (!p) { p = svg('path'); measure.append(p); }
  p.setAttribute('d', d);
  return p;
}

export function pathLength(d) {
  const p = measurePath(d);
  try { return p.getTotalLength(); } catch { return 0; }
}

const medianCache = new Map();

/** `n` evenly spaced points along a stroke, in viewBox units. */
export function median(d, n = 16) {
  const key = `${n}|${d}`;
  const hit = medianCache.get(key);
  if (hit) return hit;
  const p = measurePath(d);
  let len = 0;
  try { len = p.getTotalLength(); } catch { /* unsupported */ }
  const pts = [];
  if (!len) {
    medianCache.set(key, pts);
    return pts;
  }
  for (let i = 0; i < n; i++) {
    const pt = p.getPointAtLength((len * i) / (n - 1));
    pts.push([pt.x, pt.y]);
  }
  pts.length_ = len;
  medianCache.set(key, pts);
  return pts;
}

export const medians = (paths, n = 16) => paths.map((d) => median(d, n));

/** Stroke data for a character, or null when KanjiVG has no glyph for it. */
export async function charStrokes(c) {
  return data.strokes(c);
}

// ---------------------------------------------------------------------------
// Static rendering
// ---------------------------------------------------------------------------

/** Build an <svg> showing the character; returns { el, paths }. */
export function buildGlyph(paths, { cls = 'outline', numbers = false } = {}) {
  const el = svg('svg', { class: 'kvg', viewBox: `0 0 ${VB} ${VB}` });
  const nodes = paths.map((d) => {
    const p = svg('path', { d, class: cls });
    el.append(p);
    return p;
  });
  if (numbers) el.append(numberLayer(paths));
  return { el, paths: nodes };
}

export function numberLayer(paths) {
  const g = svg('g', { class: 'numbers' });
  paths.forEach((d, i) => {
    const m = median(d, 3);
    if (!m.length) return;
    const [x, y] = m[0];
    g.append(Object.assign(svg('text', { x: x + 1.5, y: y - 1.5 }), { textContent: String(i + 1) }));
  });
  return g;
}

/** Faint guide lines for the blind writing mode. */
export function guideLayer() {
  const g = svg('g', { class: 'grid' });
  const half = VB / 2;
  g.append(svg('line', { x1: half, y1: 0, x2: half, y2: VB }));
  g.append(svg('line', { x1: 0, y1: half, x2: VB, y2: half }));
  g.append(svg('rect', { x: 2, y: 2, width: VB - 4, height: VB - 4, fill: 'none' }));
  return g;
}

// ---------------------------------------------------------------------------
// Animation
// ---------------------------------------------------------------------------

/**
 * Animated stroke order. Returns a controller with play/pause/step/reset.
 * `speed` is in viewBox units per second.
 */
export function animator(container, paths, { speed = 90, numbers = false, autoplay = true } = {}) {
  container.replaceChildren();
  const el = svg('svg', { class: 'kvg', viewBox: `0 0 ${VB} ${VB}` });
  const ghosts = paths.map((d) => svg('path', { d, class: 'outline' }));
  const inks = paths.map((d) => svg('path', { d, class: 'done' }));
  ghosts.forEach((p) => el.append(p));
  inks.forEach((p) => el.append(p));
  if (numbers) el.append(numberLayer(paths));
  container.append(el);

  const lens = paths.map((d) => pathLength(d) || 1);
  let idx = 0;
  let timer = null;
  let playing = false;
  const listeners = new Set();

  const setShown = (n) => {
    inks.forEach((p, i) => {
      p.style.transition = 'none';
      p.style.strokeDasharray = `${lens[i]} ${lens[i]}`;
      p.style.strokeDashoffset = i < n ? '0' : `${lens[i]}`;
    });
    idx = n;
    listeners.forEach((f) => f(idx, paths.length));
  };

  function runStroke(i) {
    const p = inks[i];
    const ms = (lens[i] / speed) * 1000;
    p.style.transition = 'none';
    p.style.strokeDasharray = `${lens[i]} ${lens[i]}`;
    p.style.strokeDashoffset = `${lens[i]}`;
    // force layout so the transition actually runs
    void p.getBoundingClientRect();
    p.style.transition = `stroke-dashoffset ${ms}ms linear`;
    p.style.strokeDashoffset = '0';
    return ms;
  }

  function next() {
    if (idx >= paths.length) { playing = false; listeners.forEach((f) => f(idx, paths.length)); return; }
    const ms = runStroke(idx);
    idx += 1;
    listeners.forEach((f) => f(idx, paths.length));
    timer = setTimeout(() => { if (playing) next(); }, ms + 140);
  }

  const api = {
    play() {
      if (playing) return;
      if (idx >= paths.length) setShown(0);
      playing = true;
      next();
    },
    pause() { playing = false; clearTimeout(timer); },
    reset() { api.pause(); setShown(0); },
    showAll() { api.pause(); setShown(paths.length); },
    step() {
      api.pause();
      if (idx >= paths.length) { setShown(0); return; }
      setShown(idx);
      runStroke(idx);
      idx += 1;
      listeners.forEach((f) => f(idx, paths.length));
    },
    stepBack() { api.pause(); setShown(Math.max(0, idx - 1)); },
    onChange(f) { listeners.add(f); return () => listeners.delete(f); },
    get index() { return idx; },
    get total() { return paths.length; },
    get playing() { return playing; },
    destroy() { api.pause(); listeners.clear(); },
    el,
  };

  setShown(0);
  if (autoplay) setTimeout(() => api.play(), 220);
  return api;
}
