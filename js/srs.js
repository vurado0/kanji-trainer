/**
 * SRS core — an SM-2 variant with four grades.
 *
 * Why SM-2 and not FSRS: FSRS earns its keep by fitting weights to a large
 * personal review history. This profile starts from an *imported* state with no
 * history at all (517 characters seeded from screenshots), and the required
 * behaviour — 30 % interval reset on lapse, in-session relearning, a hard
 * "4 reps on 4 distinct days" gate — maps directly onto SM-2's knobs. SM-2 also
 * stays inspectable, which matters when the seeded intervals are guesses.
 *
 * Each character carries two fully independent tracks (recognition / writing);
 * everything here operates on a single track object.
 */

import { clamp, dayNumber, dayStart, DAY_MS } from './util.js';

export const GRADE = { AGAIN: 0, HARD: 1, GOOD: 2, EASY: 3 };
export const GRADE_LABEL = ['Nochmal', 'Schwer', 'Gut', 'Leicht'];
export const TRACKS = ['recognition', 'writing'];

export const SRS_DEFAULTS = {
  graduatingInterval: 1,   // days, first interval after a "Gut" on a new card
  easyInterval: 3,         // days, first interval after "Leicht"
  hardFactor: 1.2,
  easyBonus: 1.3,
  lapseFactor: 0.3,        // failed review keeps ~30 % of its interval …
  minLapseInterval: 1,     // … but never less than a day
  minEase: 1.3,
  maxEase: 2.8,
  startEase: 2.5,
  maxInterval: 365 * 3,
  leechThreshold: 5,
  fuzzFrom: 4,             // add ±5 % jitter to intervals of at least this many days
  greenInterval: 21,
  greenStreak: 4,
  greenDistinctDays: 4,
};

export function newTrack() {
  return {
    state: 'new',          // new | learning | review | relearning
    due: null,             // timestamp; null while the card is untouched
    interval: 0,           // days
    ease: SRS_DEFAULTS.startEase,
    reps: 0,
    lapses: 0,
    streak: 0,
    days: [],              // day numbers of the last up-to-4 successful reviews
    last: null,            // timestamp of the last review of any outcome
  };
}

/** A track that was seeded from the old app rather than learned here. */
export function seededTrack(intervalDays, { streak = 0, now = Date.now(), jitterDays = 0 } = {}) {
  const t = newTrack();
  if (intervalDays <= 0) return t;
  const d = dayNumber(now);
  t.state = intervalDays >= 1 ? 'review' : 'learning';
  t.interval = intervalDays;
  t.reps = Math.max(1, streak);
  t.streak = streak;
  t.due = dayStart(d + Math.max(0, jitterDays));
  t.last = null;
  // No `days` history: an imported card must still earn its four distinct days
  // here before it can turn green.
  t.days = [];
  return t;
}

const distinctDays = (t) => new Set(t.days || []).size;

/** Would this track satisfy the strict "green" definition right now? */
export function isGreen(t, cfg = SRS_DEFAULTS) {
  return (
    t.interval >= cfg.greenInterval &&
    t.streak >= cfg.greenStreak &&
    distinctDays(t) >= cfg.greenDistinctDays
  );
}

/**
 * Mastery 0–100 from streak, interval and lapses.
 * Hard-gated: 90+ is reachable only through isGreen(), and reaching isGreen()
 * always yields at least 90 — so grid colour and the rule never disagree.
 */
export function mastery(t, cfg = SRS_DEFAULTS) {
  if (!t || t.state === 'new' || t.reps === 0) return 0;
  const ivPart = Math.min(1, Math.log1p(t.interval) / Math.log1p(60));
  const stPart = Math.min(1, t.streak / cfg.greenStreak);
  let m = 100 * (0.55 * ivPart + 0.45 * stPart) - t.lapses * 4;
  m = clamp(m, 1, 100);
  return Math.round(isGreen(t, cfg) ? Math.max(m, 90) : Math.min(m, 89));
}

/** Colour-relevant mastery of a whole character: the weaker of the two tracks. */
export function charMastery(rec) {
  return Math.min(mastery(rec.tracks.recognition), mastery(rec.tracks.writing));
}

export const isDue = (t, now = Date.now()) => t.due != null && t.due <= now;
export const isNew = (t) => t.state === 'new';

function fuzz(days, cfg) {
  if (days < cfg.fuzzFrom) return days;
  const span = Math.max(1, Math.round(days * 0.05));
  return days + Math.round((Math.random() * 2 - 1) * span);
}

/**
 * Apply a grade to a track. Returns a *new* track object plus info about what
 * happened, so callers can log it and the session can react (relearn queue).
 */
export function applyGrade(track, grade, { now = Date.now(), cfg = SRS_DEFAULTS } = {}) {
  const t = { ...track, days: [...(track.days || [])] };
  const d = dayNumber(now);
  const sameDay = t.last != null && dayNumber(t.last) === d;
  const info = { sameDay, lapsed: false, graduated: false, counted: true, becameLeech: false };

  if (grade === GRADE.AGAIN) {
    if (t.state === 'review') {
      t.lapses += 1;
      t.interval = Math.max(cfg.minLapseInterval, Math.round(t.interval * cfg.lapseFactor));
      t.state = 'relearning';
      info.lapsed = true;
      if (t.lapses >= cfg.leechThreshold && track.lapses < cfg.leechThreshold) info.becameLeech = true;
    } else if (t.state === 'relearning') {
      // already relearning; keep the reduced interval
    } else {
      t.state = 'learning';
      t.interval = 0;
    }
    t.streak = 0;
    t.days = [];
    t.ease = clamp(t.ease - 0.2, cfg.minEase, cfg.maxEase);
    t.last = now;
    // Due again immediately — the session re-queues it; across days it is due
    // at the start of the next study day at the earliest.
    t.due = t.state === 'relearning' ? dayStart(d + t.interval) : now;
    if (t.state === 'relearning') t.due = Math.min(t.due, dayStart(d + t.interval));
    return { track: t, info };
  }

  // --- correct answers -----------------------------------------------------
  if (sameDay && t.state !== 'new') {
    // "Several correct answers within one session count as ONE repetition."
    // The card still leaves relearning, but nothing grows.
    info.counted = false;
    if (t.state === 'relearning') {
      t.state = 'review';
      t.due = dayStart(d + Math.max(1, t.interval));
    }
    t.last = now;
    return { track: t, info };
  }

  t.reps += 1;
  t.streak += 1;
  t.days.push(d);
  while (t.days.length > cfg.greenDistinctDays) t.days.shift();

  if (t.state === 'new' || t.state === 'learning') {
    t.interval =
      grade === GRADE.HARD ? 1 : grade === GRADE.GOOD ? cfg.graduatingInterval : cfg.easyInterval;
    t.state = 'review';
    info.graduated = true;
  } else if (t.state === 'relearning') {
    t.state = 'review';
    t.interval = Math.max(cfg.minLapseInterval, t.interval);
    if (grade === GRADE.EASY) t.interval = Math.max(t.interval, 2);
  } else {
    const grown =
      grade === GRADE.HARD ? t.interval * cfg.hardFactor
      : grade === GRADE.GOOD ? t.interval * t.ease
      : t.interval * t.ease * cfg.easyBonus;
    t.interval = clamp(Math.max(t.interval + 1, Math.round(grown)), 1, cfg.maxInterval);
  }

  if (grade === GRADE.HARD) t.ease = clamp(t.ease - 0.15, cfg.minEase, cfg.maxEase);
  if (grade === GRADE.EASY) t.ease = clamp(t.ease + 0.15, cfg.minEase, cfg.maxEase);

  t.interval = clamp(fuzz(t.interval, cfg), 1, cfg.maxInterval);
  t.due = dayStart(d + t.interval);
  t.last = now;
  return { track: t, info };
}

/**
 * What the four buttons would do, for the preview under each grade button.
 * Pure — never mutates.
 */
export function previewIntervals(track, now = Date.now()) {
  return [0, 1, 2, 3].map((g) => {
    const { track: t, info } = applyGrade(track, g, { now });
    return { grade: g, interval: t.interval, due: t.due, sameDay: !info.counted };
  });
}

/** Days until due, negative when overdue. */
export const dueInDays = (t, now = Date.now()) =>
  t.due == null ? Infinity : dayNumber(t.due) - dayNumber(now);

export { DAY_MS };
