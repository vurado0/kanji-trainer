/**
 * Multiple-choice distractor selection.
 *
 * Random distractors make MC questions answerable by elimination, so candidates
 * are ranked by how plausibly they could be confused with the target:
 * shared components/radical, shared readings, neighbouring meanings, similar
 * stroke count — plus a strong bonus for pairs the user has actually mixed up.
 * Already-learned characters are preferred, so the choice tests knowledge
 * instead of "which one have I never seen before".
 * Random characters are only ever a fallback.
 */

import * as data from './data.js';
import { settings, isKnown } from './store.js';
import { shuffle, uniq } from './util.js';
import { confusionPartners } from './confusion.js';

function candidateSet(e) {
  const out = new Set();
  const comps = [...e.comp, e.rad].filter(Boolean);
  for (const c of comps) for (const o of data.componentIndex().get(c) || []) out.add(o.c);
  for (const r of [...e.on, ...e.kun]) {
    for (const o of data.readingIndex().get(data.normReading(r)) || []) out.add(o.c);
  }
  for (const m of e.m.slice(0, 3)) {
    for (const o of data.meaningIndex().get(m.toLowerCase().split(/[\s(]/)[0]) || []) out.add(o.c);
  }
  for (const p of confusionPartners(e.c)) out.add(p);
  out.delete(e.c);
  return out;
}

function scoreCandidate(e, o) {
  let s = 0;
  const compsA = new Set([...e.comp, e.rad].filter(Boolean));
  const compsB = [...o.comp, o.rad].filter(Boolean);
  const shared = compsB.filter((c) => compsA.has(c)).length;
  s += Math.min(3, shared) * 5;

  const readA = new Set([...e.on, ...e.kun].map(data.normReading));
  const sharedR = [...o.on, ...o.kun].map(data.normReading).filter((r) => readA.has(r)).length;
  s += Math.min(2, sharedR) * 4;

  const meanA = new Set(e.m.map((m) => m.toLowerCase().split(/[\s(]/)[0]));
  if (o.m.some((m) => meanA.has(m.toLowerCase().split(/[\s(]/)[0]))) s += 3;

  if (e.st && o.st && Math.abs(e.st - o.st) <= 2) s += 1;
  if (e.lv === o.lv) s += 1;
  if (settings.preferKnownDistractors && isKnown(o.c)) s += 3;
  return s;
}

/** `n` plausible confusables for `char`, best first. */
export function similarChars(char, n = 3, { exclude = [], requireMeaning = false } = {}) {
  const e = data.entry(char);
  if (!e) return [];
  const banned = new Set([char, ...exclude]);
  const targetMeanings = new Set(e.m.map((m) => m.toLowerCase()));

  const scored = shuffle([...candidateSet(e)])
    .filter((c) => !banned.has(c))
    .map((c) => data.entry(c))
    .filter(Boolean)
    .filter((o) => !requireMeaning || (o.m.length && !o.m.some((m) => targetMeanings.has(m.toLowerCase()))))
    .map((o) => ({ c: o.c, s: scoreCandidate(e, o) }))
    .sort((a, b) => b.s - a.s);

  const out = scored.slice(0, n).map((x) => x.c);
  if (out.length < n) out.push(...fallback(e, n - out.length, new Set([...banned, ...out]), targetMeanings, requireMeaning));
  return out.slice(0, n);
}

function fallback(e, n, banned, targetMeanings, requireMeaning) {
  const pool = data.entries().filter((o) =>
    !banned.has(o.c) &&
    o.lv === e.lv &&
    (!requireMeaning || (o.m.length && !o.m.some((m) => targetMeanings.has(m.toLowerCase()))))
  );
  const known = pool.filter((o) => isKnown(o.c));
  const src = known.length >= n && settings.preferKnownDistractors ? known : pool;
  return shuffle(src).slice(0, n).map((o) => o.c);
}

/** Four answer options for a kanji -> meaning question. */
export function meaningOptions(char, n = 4) {
  const others = similarChars(char, n - 1, { requireMeaning: true });
  return shuffle(uniq([char, ...others])).slice(0, n);
}

/** Four kanji options for a meaning/reading -> kanji question. */
export function charOptions(char, n = 4) {
  const others = similarChars(char, n - 1);
  return shuffle(uniq([char, ...others])).slice(0, n);
}
