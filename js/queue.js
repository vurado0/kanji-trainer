/**
 * The learning queue — one strictly ordered list of everything not yet learned.
 *
 * Order is fixed at seed time and then persisted, so "Neu lernen" is
 * deterministic: it always takes from the front, never at random.
 *
 *   1. queue.in_progress   (18, file order)     — started in the old app
 *   2. queue.n3_rest       (97, file order)     — remainder of JLPT N3
 *   3. auto tail           (N2 -> N1, by KANJIDIC2 frequency, unranked last)
 *
 * The user can pull a character forward, push it back or drop it; those edits
 * mutate the persisted order rather than a derived view.
 */

import { kvGet, kvSet, rec, settings, isStarted } from './store.js';
import * as data from './data.js';

let order = [];

export async function initQueue(seed) {
  order = await kvGet('queueOrder', null);
  if (!order) {
    order = buildDefaultOrder(seed);
    await kvSet('queueOrder', order);
  }
  return order;
}

export function buildDefaultOrder(seed) {
  const learned = new Set(Object.values(seed.learned).join(''));
  const seen = new Set();
  const out = [];
  const push = (c) => {
    if (!c || learned.has(c) || seen.has(c) || !data.has(c)) return;
    seen.add(c);
    out.push(c);
  };
  for (const c of seed.queue.in_progress) push(c);
  for (const c of seed.queue.n3_rest) push(c);
  for (const c of data.autoQueue()) push(c);
  return out;
}

export const getOrder = () => order;
export const queueIndex = (c) => order.indexOf(c);

const persist = () => kvSet('queueOrder', order);

/**
 * A character leaves the queue once both tracks have been tested successfully
 * at least once — i.e. it has been properly introduced, not merely seen.
 */
export function isLearned(c) {
  const r = rec(c);
  return r.tracks.recognition.reps >= 1 && r.tracks.writing.reps >= 1;
}

export const isSuspended = (c) => rec(c).suspended === true;

/** Everything still waiting, in order, skipping suspended and finished items. */
export function pending() {
  return order.filter((c) => !isLearned(c) && !isSuspended(c));
}

/** The next `n` characters that "Neu lernen" would introduce. */
export function nextUp(n = 5) {
  return pending().slice(0, n);
}

export function position(c) {
  const p = pending();
  return { index: p.indexOf(c), total: p.length };
}

// --- lessons ---------------------------------------------------------------

/**
 * The queue cut into fixed lessons of `lessonSize`. Lesson N unlocks once every
 * character of lesson N-1 has passed both tracks at least once.
 */
export function lessons() {
  const size = Math.max(1, settings.lessonSize);
  const out = [];
  let prevComplete = true;
  for (let i = 0; i < order.length; i += size) {
    const chars = order.slice(i, i + size);
    const done = chars.filter(isLearned).length;
    out.push({
      n: out.length + 1,
      from: i,
      chars,
      done,
      complete: done === chars.length,
      unlocked: prevComplete,
    });
    prevComplete = done === chars.length;
    if (out.length >= 400) break; // the tail is thousands of characters long
  }
  return out;
}

export function currentLesson() {
  const ls = lessons();
  return ls.find((l) => !l.complete) || ls[ls.length - 1] || null;
}

export function lessonCount() {
  return Math.ceil(order.length / Math.max(1, settings.lessonSize));
}

// --- manual editing --------------------------------------------------------

export async function moveToFront(c) {
  const i = order.indexOf(c);
  if (i < 0) return;
  order.splice(i, 1);
  // In front of the first character that has not been started yet, so an
  // in-flight lesson is not torn apart.
  let at = 0;
  while (at < order.length && isLearned(order[at])) at++;
  order.splice(at, 0, c);
  await persist();
}

export async function moveBack(c, by = 20) {
  const i = order.indexOf(c);
  if (i < 0) return;
  order.splice(i, 1);
  order.splice(Math.min(order.length, i + by), 0, c);
  await persist();
}

export async function moveToEnd(c) {
  const i = order.indexOf(c);
  if (i < 0) return;
  order.splice(i, 1);
  order.push(c);
  await persist();
}

/** Re-derive the default order, keeping already-started characters up front. */
export async function rebuild(seed) {
  const fresh = buildDefaultOrder(seed);
  const started = fresh.filter((c) => isStarted(c) && !isLearned(c));
  const rest = fresh.filter((c) => !started.includes(c));
  order = [...started, ...rest];
  await persist();
  return order;
}

export async function setOrder(next) {
  order = next;
  await persist();
}
