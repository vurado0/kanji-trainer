/**
 * Minimal stroke matcher.
 *
 * We cannot use hanzi-writer's quiz: hanzi-writer-data-jp ships no character
 * data at all (the published package contains only a stub index.js), and its
 * README points at a CDN, which the offline requirement rules out. So strokes
 * come from KanjiVG and this module decides whether a drawn stroke is the one
 * that was expected.
 *
 * Everything is in KanjiVG viewBox units (109x109).
 */

const N = 16;              // resample resolution
const BASE_THRESHOLD = 19; // average deviation still accepted, in viewBox units
const START_LIMIT = 34;    // a stroke starting this far off is never the right one
const ORDER_BIAS = 0.85;   // slight benefit of the doubt for the expected stroke

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function polylineLength(pts) {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += dist(pts[i - 1], pts[i]);
  return l;
}

/** Resample a polyline to exactly `n` points spaced evenly by arc length. */
export function resample(pts, n = N) {
  if (pts.length === 0) return [];
  if (pts.length === 1) return Array.from({ length: n }, () => [...pts[0]]);
  const total = polylineLength(pts);
  if (total === 0) return Array.from({ length: n }, () => [...pts[0]]);
  const step = total / (n - 1);
  const out = [[...pts[0]]];
  let i = 1;
  let acc = 0;
  let cur = pts[0];
  while (out.length < n && i < pts.length) {
    const seg = dist(cur, pts[i]);
    if (acc + seg >= step) {
      const t = (step - acc) / seg;
      const p = [cur[0] + (pts[i][0] - cur[0]) * t, cur[1] + (pts[i][1] - cur[1]) * t];
      out.push(p);
      cur = p;
      acc = 0;
    } else {
      acc += seg;
      cur = pts[i];
      i += 1;
    }
  }
  while (out.length < n) out.push([...pts[pts.length - 1]]);
  return out;
}

/** Smooth raw pointer input with a small moving average. */
export function smooth(pts, window = 3) {
  if (pts.length <= window) return pts;
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    let sx = 0, sy = 0, n = 0;
    for (let k = -window; k <= window; k++) {
      const p = pts[i + k];
      if (!p) continue;
      sx += p[0]; sy += p[1]; n += 1;
    }
    out.push([sx / n, sy / n]);
  }
  out[0] = pts[0];
  out[out.length - 1] = pts[pts.length - 1];
  return out;
}

/**
 * How well a drawn stroke matches one target stroke.
 * Lower is better; also reports whether it fits noticeably better backwards.
 */
export function score(userPts, targetPts) {
  if (!userPts.length || !targetPts.length) return { value: Infinity, reversed: false };
  const u = resample(userPts);
  const t = resample(targetPts);
  const rev = [...t].reverse();

  const avg = (a, b) => {
    let s = 0;
    for (let i = 0; i < N; i++) s += dist(a[i], b[i]);
    return s / N;
  };
  const fwd = avg(u, t);
  const bwd = avg(u, rev);
  const reversed = bwd < fwd - 3;
  const base = Math.min(fwd, bwd);
  const ref = reversed ? rev : t;

  const startEnd = (dist(u[0], ref[0]) + dist(u[N - 1], ref[N - 1])) / 2;
  const lu = polylineLength(u);
  const lt = polylineLength(t);
  // Very short target strokes (dots) are matched by position, not by shape.
  const lenPenalty = Math.min(18, (Math.abs(lu - lt) / Math.max(10, lt)) * 12);

  return {
    value: 0.6 * base + 0.25 * startEnd + 0.15 * lenPenalty,
    reversed,
    startDist: dist(u[0], ref[0]),
  };
}

/**
 * Decide what the user just drew.
 *
 * @param userPts   drawn polyline in viewBox units
 * @param targets   medians of every stroke of the character
 * @param expected  index of the stroke that should come next
 * @param remaining Set of stroke indices not yet written
 * @returns { kind: 'correct' | 'order' | 'reversed' | 'miss', index, score, reversed }
 */
export function classify(userPts, targets, expected, remaining, tolerance = 1) {
  const threshold = BASE_THRESHOLD * tolerance;
  const scored = [];
  for (const i of remaining) {
    const s = score(userPts, targets[i]);
    if (s.startDist > START_LIMIT * tolerance) s.value += 40;
    scored.push({ index: i, ...s, biased: i === expected ? s.value * ORDER_BIAS : s.value });
  }
  if (!scored.length) return { kind: 'miss', index: -1, score: Infinity, reversed: false };
  scored.sort((a, b) => a.biased - b.biased);
  const best = scored[0];

  if (best.value > threshold) {
    return { kind: 'miss', index: -1, score: best.value, reversed: false, nearest: best.index };
  }
  if (best.index !== expected) {
    return { kind: 'order', index: best.index, score: best.value, reversed: best.reversed };
  }
  if (best.reversed) {
    return { kind: 'reversed', index: best.index, score: best.value, reversed: true };
  }
  return { kind: 'correct', index: best.index, score: best.value, reversed: false };
}

/**
 * Retrospective analysis for the blind mode: greedily assign each drawn stroke
 * to a target and report where the order broke.
 */
export function analyseSequence(userStrokes, targets, tolerance = 1) {
  const remaining = new Set(targets.map((_, i) => i));
  const assigned = [];
  for (const u of userStrokes) {
    let best = null;
    for (const i of remaining) {
      const s = score(u, targets[i]);
      if (!best || s.value < best.value) best = { index: i, ...s };
    }
    if (best && best.value <= BASE_THRESHOLD * tolerance * 1.3) {
      remaining.delete(best.index);
      assigned.push(best.index);
    } else {
      assigned.push(-1);
    }
  }
  let orderErrors = 0;
  let high = -1;
  for (const idx of assigned) {
    if (idx < 0) continue;
    if (idx < high) orderErrors += 1;
    else high = idx;
  }
  return {
    assigned,
    orderErrors,
    unmatched: assigned.filter((i) => i < 0).length,
    missing: [...remaining],
    countMismatch: userStrokes.length - targets.length,
  };
}

export { BASE_THRESHOLD };
