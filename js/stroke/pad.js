/**
 * The writing surface: pointer-driven canvas over a KanjiVG layer.
 *
 * Pointer Events throughout, so Apple Pencil, finger and mouse behave the same.
 * Raw input is smoothed before it is scored, and the pad is fully controllable
 * with the keyboard (Z = undo stroke).
 */

import { svg, VB, median, guideLayer, pathLength } from './kvg.js';
import { classify, analyseSequence, smooth } from './matcher.js';
import { h } from '../util.js';

const INK_WIDTH = 5.4;      // in viewBox units
const MAX_ATTEMPTS = 3;     // failed tries on one stroke before the hint fires

/**
 * @param opts.paths      array of KanjiVG path strings
 * @param opts.mode       'guided' (outline + live validation) | 'blind'
 * @param opts.tolerance  matcher leniency multiplier
 * @param opts.onResult   (result) => void, per attempted stroke (guided only)
 * @param opts.onFinish   (summary) => void, when every stroke is written
 */
export function createPad({
  paths,
  mode = 'guided',
  tolerance = 1,
  showNumbers = false,
  onResult = () => {},
  onFinish = () => {},
} = {}) {
  const targets = paths.map((d) => median(d, 16));

  const root = h('div.writepad', { tabindex: '0' });
  const layer = svg('svg', { class: 'kvg', viewBox: `0 0 ${VB} ${VB}` });
  const canvas = h('canvas');
  const flash = h('div.flash');
  root.append(layer, canvas, flash);

  // --- background ---------------------------------------------------------
  const outlineGroup = svg('g');
  if (mode === 'guided') {
    for (const d of paths) outlineGroup.append(svg('path', { d, class: 'outline' }));
  } else {
    outlineGroup.append(guideLayer());
  }
  layer.append(outlineGroup);
  const inkGroup = svg('g');       // accepted strokes, drawn as the ideal shape
  const hintGroup = svg('g');
  layer.append(inkGroup, hintGroup);
  if (showNumbers && mode === 'guided') {
    const nums = svg('g', { class: 'numbers' });
    layer.append(nums);
    paths.forEach((d, i) => {
      const m = median(d, 3);
      if (!m.length) return;
      const t = svg('text', { x: m[0][0] + 1.5, y: m[0][1] - 1.5 });
      t.textContent = String(i + 1);
      t.dataset.i = i;
      nums.append(t);
    });
  }

  // --- state --------------------------------------------------------------
  const state = {
    mode,
    accepted: [],            // stroke indices in the order they were accepted
    userStrokes: [],         // raw polylines (viewBox units), kept for blind mode
    attempts: 0,
    orderErrors: 0,
    misses: 0,
    hintsUsed: 0,
    reversedCount: 0,
    finished: false,
    startedAt: performance.now(),
  };
  const remaining = new Set(paths.map((_, i) => i));

  // --- canvas -------------------------------------------------------------
  const ctx = canvas.getContext('2d');
  let scale = 1;
  function resize() {
    const r = root.getBoundingClientRect();
    if (!r.width) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    scale = (r.width * dpr) / VB;
    redraw();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(root);

  function strokeStyle() {
    ctx.lineWidth = INK_WIDTH * scale;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = getComputedStyle(root).getPropertyValue('--fg').trim() || '#e8edf5';
  }

  function drawPolyline(pts) {
    if (pts.length < 2) {
      if (pts.length === 1) {
        ctx.beginPath();
        ctx.arc(pts[0][0] * scale, pts[0][1] * scale, (INK_WIDTH / 2) * scale, 0, Math.PI * 2);
        ctx.fillStyle = ctx.strokeStyle;
        ctx.fill();
      }
      return;
    }
    ctx.beginPath();
    ctx.moveTo(pts[0][0] * scale, pts[0][1] * scale);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = ((pts[i][0] + pts[i + 1][0]) / 2) * scale;
      const my = ((pts[i][1] + pts[i + 1][1]) / 2) * scale;
      ctx.quadraticCurveTo(pts[i][0] * scale, pts[i][1] * scale, mx, my);
    }
    const last = pts[pts.length - 1];
    ctx.lineTo(last[0] * scale, last[1] * scale);
    ctx.stroke();
  }

  function redraw() {
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    strokeStyle();
    // Guided mode replaces accepted ink with the ideal path, so only the
    // in-flight stroke lives on the canvas. Blind mode keeps everything.
    const keep = mode === 'blind' ? state.userStrokes : [];
    for (const s of keep) drawPolyline(s);
    if (live.length) drawPolyline(live);
  }

  // --- pointer ------------------------------------------------------------
  let live = [];
  let activeId = null;

  const toVB = (ev) => {
    const r = root.getBoundingClientRect();
    return [((ev.clientX - r.left) / r.width) * VB, ((ev.clientY - r.top) / r.height) * VB];
  };

  root.addEventListener('pointerdown', (ev) => {
    if (state.finished && mode === 'guided') return;
    if (activeId !== null) return;
    activeId = ev.pointerId;
    try { root.setPointerCapture(ev.pointerId); } catch { /* e.g. synthetic events */ }
    live = [toVB(ev)];
    ev.preventDefault();
    redraw();
  });

  root.addEventListener('pointermove', (ev) => {
    if (ev.pointerId !== activeId) return;
    const p = toVB(ev);
    const prev = live[live.length - 1];
    if (!prev || Math.hypot(p[0] - prev[0], p[1] - prev[1]) > 0.35) live.push(p);
    ev.preventDefault();
    redraw();
  });

  const end = (ev) => {
    if (ev.pointerId !== activeId) return;
    activeId = null;
    try { root.releasePointerCapture(ev.pointerId); } catch { /* already gone */ }
    const pts = smooth(live, 2);
    live = [];
    if (pts.length && polyLen(pts) < 1.2 && pts.length < 3) { redraw(); return; } // stray tap
    commitStroke(pts);
  };
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', end);
  root.addEventListener('contextmenu', (e) => e.preventDefault());

  const polyLen = (pts) => {
    let l = 0;
    for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    return l;
  };

  // --- stroke handling ----------------------------------------------------
  function acceptStroke(index, { orderError = false } = {}) {
    remaining.delete(index);
    state.accepted.push(index);
    const p = svg('path', { d: paths[index], class: orderError ? 'done order-err' : 'done' });
    inkGroup.append(p);
    state.attempts = 0;
    clearHint();
  }

  function commitStroke(pts) {
    if (!pts.length) { redraw(); return; }

    if (mode === 'blind') {
      state.userStrokes.push(pts);
      redraw();
      onResult({ kind: 'drawn', strokeCount: state.userStrokes.length });
      return;
    }

    const expected = nextExpected();
    const res = classify(pts, targets, expected, remaining, tolerance);
    state.userStrokes.push(pts);

    if (res.kind === 'correct') {
      acceptStroke(res.index);
    } else if (res.kind === 'order') {
      state.orderErrors += 1;
      acceptStroke(res.index, { orderError: true });
    } else if (res.kind === 'reversed') {
      state.reversedCount += 1;
      state.attempts += 1;
      state.userStrokes.pop();
      bad();
    } else {
      state.misses += 1;
      state.attempts += 1;
      state.userStrokes.pop();
      bad();
    }

    redraw();
    onResult({ ...res, expected, attempts: state.attempts, accepted: state.accepted.length, total: paths.length });

    if (res.kind !== 'correct' && res.kind !== 'order' && state.attempts >= MAX_ATTEMPTS) {
      state.hintsUsed += 1;
      state.attempts = 0;
      showHint(expected);
      onResult({ kind: 'hint', index: expected, expected, accepted: state.accepted.length, total: paths.length });
    }

    if (!remaining.size && !state.finished) {
      state.finished = true;
      onFinish(summary());
    }
  }

  const nextExpected = () => {
    for (let i = 0; i < paths.length; i++) if (remaining.has(i)) return i;
    return paths.length;
  };

  function bad() {
    flash.className = 'flash bad';
    setTimeout(() => { flash.className = 'flash'; }, 360);
  }

  // --- hint ---------------------------------------------------------------
  let hintTimer = null;
  function showHint(index) {
    clearHint();
    if (index >= paths.length) return;
    const d = paths[index];
    const p = svg('path', { d, class: 'hint' });
    const len = pathLength(d) || 1;
    hintGroup.append(p);
    p.style.strokeDasharray = `${len} ${len}`;
    p.style.strokeDashoffset = `${len}`;
    void p.getBoundingClientRect();
    p.style.transition = 'stroke-dashoffset 900ms linear';
    p.style.strokeDashoffset = '0';
    hintTimer = setTimeout(() => { p.style.opacity = '.45'; }, 1000);
  }
  function clearHint() {
    clearTimeout(hintTimer);
    hintGroup.replaceChildren();
  }

  // --- public API ---------------------------------------------------------
  function undo() {
    if (mode === 'blind') {
      state.userStrokes.pop();
      redraw();
      return;
    }
    const last = state.accepted.pop();
    if (last == null) return;
    remaining.add(last);
    state.userStrokes.pop();
    inkGroup.lastChild?.remove();
    state.finished = false;
    state.attempts = 0;
    clearHint();
    redraw();
  }

  function clearAll() {
    state.accepted.length = 0;
    state.userStrokes.length = 0;
    state.attempts = 0;
    state.finished = false;
    remaining.clear();
    paths.forEach((_, i) => remaining.add(i));
    inkGroup.replaceChildren();
    clearHint();
    redraw();
  }

  /** Blind mode: overlay the correct glyph and grade the drawn sequence. */
  function reveal() {
    const analysis = analyseSequence(state.userStrokes, targets, tolerance);
    state.orderErrors = analysis.orderErrors;
    outlineGroup.replaceChildren();
    for (const d of paths) outlineGroup.append(svg('path', { d, class: 'outline' }));
    inkGroup.replaceChildren();
    // Highlight strokes that were drawn out of order.
    let high = -1;
    analysis.assigned.forEach((idx) => {
      if (idx < 0) return;
      const wrong = idx < high;
      if (idx > high) high = idx;
      inkGroup.append(svg('path', { d: paths[idx], class: wrong ? 'done order-err' : 'done' }));
    });
    state.finished = true;
    return { ...analysis, ...summary() };
  }

  function summary() {
    return {
      strokes: paths.length,
      drawn: state.userStrokes.length,
      orderErrors: state.orderErrors,
      misses: state.misses,
      reversed: state.reversedCount,
      hintsUsed: state.hintsUsed,
      ms: Math.round(performance.now() - state.startedAt),
      /** A hint or a wrong order forces the grade down to "Nochmal". */
      forcedAgain: state.hintsUsed > 0 || state.orderErrors > 0,
    };
  }

  function destroy() { ro.disconnect(); clearHint(); }

  root.addEventListener('keydown', (ev) => {
    if (ev.key === 'z' || ev.key === 'Z') { undo(); ev.preventDefault(); }
  });

  requestAnimationFrame(resize);

  return { el: root, state, undo, clear: clearAll, reveal, summary, destroy, get remaining() { return remaining; }, nextExpected };
}
