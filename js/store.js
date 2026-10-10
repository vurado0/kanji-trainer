/**
 * Application state.
 *
 * Progress records live in IndexedDB but are mirrored in memory (a few thousand
 * small objects), so screens can read synchronously; every mutation writes
 * through. Settings are the only thing kept in localStorage.
 */

import * as db from './db.js';
import { newTrack, mastery, charMastery, TRACKS } from './srs.js';
import { setDayCutoff, dayNumber, today, uniq } from './util.js';

const SETTINGS_KEY = 'kanji-trainer.settings';
const MAX_BACKUPS = 5;

export const DEFAULT_SETTINGS = {
  newPerDay: 5,
  reviewsPerDay: 60,
  backlogGate: 40,          // no new characters while more than this many reviews are due
  dayCutoffHour: 4,
  lessonSize: 5,
  writingSeedOffset: 1,     // 0 = same, 1 = one step lower, 2 = two steps, 3 = start writing from scratch
  modes: {
    recognitionMC: true,
    reverseMC: true,
    reading: true,
    writingGuided: true,
    writingBlind: true,
    confusion: true,
  },
  audio: true,
  autoAdvance: true,
  strokeTolerance: 1,       // multiplier on the matcher threshold (0.7 strict … 1.5 lenient)
  showStrokeNumbers: true,
  preferKnownVocab: true,
  preferKnownDistractors: true,
};

export let settings = { ...DEFAULT_SETTINGS };

/** char -> record */
const records = new Map();
let reviewCache = null;

// ---------------------------------------------------------------------------
// settings
// ---------------------------------------------------------------------------

export function loadSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    settings = { ...DEFAULT_SETTINGS, ...raw, modes: { ...DEFAULT_SETTINGS.modes, ...(raw.modes || {}) } };
  } catch {
    settings = { ...DEFAULT_SETTINGS };
  }
  setDayCutoff(settings.dayCutoffHour);
  return settings;
}

export function saveSettings(patch) {
  settings = { ...settings, ...patch, modes: { ...settings.modes, ...(patch.modes || {}) } };
  setDayCutoff(settings.dayCutoffHour);
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  return settings;
}

// ---------------------------------------------------------------------------
// records
// ---------------------------------------------------------------------------

export function blankRecord(char) {
  return {
    char,
    tracks: { recognition: newTrack(), writing: newTrack() },
    suspended: false,
    leech: false,
    note: '',
    addedAt: null,
    lastSeen: null,
  };
}

export async function loadRecords() {
  records.clear();
  for (const r of await db.getAll(db.STORES.progress)) records.set(r.char, normalise(r));
}

function normalise(r) {
  const out = { ...blankRecord(r.char), ...r };
  out.tracks = { ...out.tracks };
  for (const t of TRACKS) out.tracks[t] = { ...newTrack(), ...(r.tracks?.[t] || {}) };
  return out;
}

/** Record for a character; created on demand but only persisted when saved. */
export function rec(char) {
  let r = records.get(char);
  if (!r) { r = blankRecord(char); records.set(char, r); }
  return r;
}
export const hasRec = (char) => records.has(char);
export const allRecords = () => [...records.values()];
export const touchedRecords = () =>
  [...records.values()].filter((r) => r.addedAt != null || r.tracks.recognition.reps || r.tracks.writing.reps);

export async function saveRec(r) {
  records.set(r.char, r);
  await db.put(db.STORES.progress, r);
  return r;
}
export async function saveRecs(list) {
  for (const r of list) records.set(r.char, r);
  await db.putMany(db.STORES.progress, list);
}

/** True once a character has left the "never touched" state. */
export const isStarted = (char) => {
  const r = records.get(char);
  return !!r && (r.addedAt != null || r.tracks.recognition.state !== 'new' || r.tracks.writing.state !== 'new');
};

/** Considered "known enough" to build vocabulary and distractors from. */
export const isKnown = (char) => {
  const r = records.get(char);
  return !!r && mastery(r.tracks.recognition) > 0;
};

export const charColorMastery = (char) => {
  const r = records.get(char);
  return r ? charMastery(r) : 0;
};

// ---------------------------------------------------------------------------
// review log
// ---------------------------------------------------------------------------

/** entry: { ts, char, track, mode, grade, ms, ok, strokeOrderErrors?, wrongChar? } */
export async function logReview(entry) {
  const e = { ...entry, day: dayNumber(entry.ts) };
  if (reviewCache) reviewCache.push(e);
  await db.put(db.STORES.reviews, e);
  return e;
}

export async function allReviews() {
  if (!reviewCache) reviewCache = await db.getAll(db.STORES.reviews);
  return reviewCache;
}

export async function reviewsOnDay(day) {
  return (await allReviews()).filter((r) => r.day === day);
}

/** { reviews, newCards } actually done today, used for the daily limits. */
export async function todayCounts() {
  const list = await reviewsOnDay(today());
  const newIds = new Set(list.filter((r) => r.isNew).map((r) => r.char + r.track));
  return { reviews: list.length, newCards: newIds.size, list };
}

export async function dropReview(id) {
  if (reviewCache) reviewCache = reviewCache.filter((r) => r.id !== id);
  await db.del(db.STORES.reviews, id);
}

// ---------------------------------------------------------------------------
// key/value app state (seed flag, queue order, confusion pairs, streak)
// ---------------------------------------------------------------------------

export const kvGet = (k, fallback = null) =>
  db.get(db.STORES.kv, k).then((v) => (v === undefined ? fallback : v));
export const kvSet = (k, v) => db.put(db.STORES.kv, v, k);

// ---------------------------------------------------------------------------
// backups / export / import
// ---------------------------------------------------------------------------

export async function snapshot(label = 'auto') {
  const payload = await exportPayload();
  await db.put(db.STORES.backups, { ts: Date.now(), label, payload });
  const all = await db.getAll(db.STORES.backups);
  all.sort((a, b) => a.ts - b.ts);
  for (const old of all.slice(0, Math.max(0, all.length - MAX_BACKUPS))) {
    await db.del(db.STORES.backups, old.id);
  }
  return all.length;
}

export const listBackups = async () =>
  (await db.getAll(db.STORES.backups)).sort((a, b) => b.ts - a.ts);

export async function exportPayload() {
  const [reviews, queueOrder, confusion, seedDone, streak] = await Promise.all([
    allReviews(),
    kvGet('queueOrder', null),
    kvGet('confusionPairs', null),
    kvGet('seedImported', false),
    kvGet('streak', null),
  ]);
  return {
    format: 'kanji-trainer',
    version: 1,
    exportedAt: new Date().toISOString(),
    settings,
    records: touchedRecords(),
    reviews: reviews.map(({ id, ...r }) => r),
    kv: { queueOrder, confusionPairs: confusion, seedImported: seedDone, streak },
  };
}

export const exportJSON = async () => JSON.stringify(await exportPayload(), null, 1);

/**
 * Replace the whole local state with an exported payload.
 * A snapshot is taken first, so an accidental import is always recoverable.
 */
export async function importPayload(payload, { merge = false } = {}) {
  if (!payload || payload.format !== 'kanji-trainer') {
    throw new Error('Keine gültige Kanji-Trainer-Sicherung (Feld "format" fehlt).');
  }
  await snapshot('vor Import');

  if (!merge) {
    await db.clearStore(db.STORES.progress);
    await db.clearStore(db.STORES.reviews);
    records.clear();
    reviewCache = [];
  }
  const recs = (payload.records || []).map(normalise);
  await saveRecs(recs);

  if (payload.reviews?.length) {
    await db.tx(db.STORES.reviews, 'readwrite', (s) => {
      for (const r of payload.reviews) s.put({ ...r, day: r.day ?? dayNumber(r.ts) });
    });
    reviewCache = null;
  }
  if (payload.settings) saveSettings(payload.settings);
  for (const [k, v] of Object.entries(payload.kv || {})) if (v != null) await kvSet(k, v);
  return { records: recs.length, reviews: payload.reviews?.length || 0 };
}

export async function resetAll({ keepSettings = true } = {}) {
  await snapshot('vor Zurücksetzen');
  await db.clearStore(db.STORES.progress);
  await db.clearStore(db.STORES.reviews);
  await db.clearStore(db.STORES.kv);
  records.clear();
  reviewCache = [];
  if (!keepSettings) localStorage.removeItem(SETTINGS_KEY);
}

// ---------------------------------------------------------------------------
// streak / daily activity
// ---------------------------------------------------------------------------

export async function activityByDay() {
  const map = new Map();
  for (const r of await allReviews()) map.set(r.day, (map.get(r.day) || 0) + 1);
  return map;
}

export async function currentStreak() {
  const act = await activityByDay();
  let d = today();
  if (!act.has(d)) d -= 1; // today may simply not have started yet
  let n = 0;
  while (act.has(d)) { n++; d--; }
  return n;
}

export { uniq };
