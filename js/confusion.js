/**
 * Confusion pairs: the characters that actually get mixed up.
 *
 * Seeded with the list the user supplied, then extended automatically whenever a
 * wrong multiple-choice answer or a mis-drawn character reveals a new pair.
 */

import { kvGet, kvSet } from './store.js';
import * as data from './data.js';

/** [{ a, b, count, source: 'seed' | 'auto' }] */
let pairs = [];

const key = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const index = new Map();

export async function initConfusion() {
  const stored = await kvGet('confusionPairs', null);
  if (stored) pairs = stored;
  else {
    pairs = data.confusionSeed()
      .filter(([a, b]) => data.has(a) && data.has(b))
      .map(([a, b]) => ({ a, b, count: 1, source: 'seed' }));
    await persist();
  }
  reindex();
  return pairs;
}

function reindex() {
  index.clear();
  for (const p of pairs) index.set(key(p.a, p.b), p);
}

const persist = () => kvSet('confusionPairs', pairs);

export const allPairs = () => [...pairs].sort((x, y) => y.count - x.count);

export function confusionPartners(char) {
  return pairs.filter((p) => p.a === char || p.b === char).map((p) => (p.a === char ? p.b : p.a));
}

/** Record that `chosen` was picked while `target` was correct. */
export async function recordConfusion(target, chosen) {
  if (!target || !chosen || target === chosen) return null;
  if (!data.has(target) || !data.has(chosen)) return null;
  const k = key(target, chosen);
  let p = index.get(k);
  if (p) p.count += 1;
  else {
    p = { a: target, b: chosen, count: 1, source: 'auto' };
    pairs.push(p);
    index.set(k, p);
  }
  await persist();
  return p;
}

export async function removePair(a, b) {
  pairs = pairs.filter((p) => key(p.a, p.b) !== key(a, b));
  reindex();
  await persist();
}

export async function addPair(a, b) {
  if (!data.has(a) || !data.has(b) || a === b) return null;
  const k = key(a, b);
  if (index.get(k)) return index.get(k);
  const p = { a, b, count: 1, source: 'manual' };
  pairs.push(p);
  index.set(k, p);
  await persist();
  return p;
}

/** Characters worth drilling, most-confused first. */
export function drillChars(limit = 40) {
  const seen = new Set();
  const out = [];
  for (const p of allPairs()) {
    for (const c of [p.a, p.b]) if (!seen.has(c)) { seen.add(c); out.push(c); }
    if (out.length >= limit) break;
  }
  return out;
}
