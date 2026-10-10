/**
 * Importing the progress carried over from the old iPad app.
 *
 * The recognition track is seeded with real intervals so those characters never
 * show up as "new" again. The writing track deliberately starts lower (default:
 * one step), because the old app trained recognition far more than writing.
 * Due dates are spread across up to three weeks — seeding 490 characters as due
 * on the same day would be useless.
 */

import { seededTrack, newTrack, mastery } from './srs.js';
import { rec, saveRecs, kvGet, kvSet, settings } from './store.js';
import * as data from './data.js';
import { dayNumber, dayStart } from './util.js';

export const SEED_FILE = 'seed-progress.json';

/** Recognition intervals in days, by the colour tier of the old app. */
export const REC_INTERVALS = { mastery_3: 60, mastery_2: 30, mastery_1: 14, mastery_0: 1 };

/** Writing intervals, by "how much lower than recognition" the user chose. */
export const WRITING_LADDERS = [
  { id: 0, label: 'gleich wie Erkennen', iv: { mastery_3: 60, mastery_2: 30, mastery_1: 14, mastery_0: 1 } },
  { id: 1, label: 'eine Stufe niedriger', iv: { mastery_3: 14, mastery_2: 7, mastery_1: 3, mastery_0: 0 } },
  { id: 2, label: 'zwei Stufen niedriger', iv: { mastery_3: 7, mastery_2: 3, mastery_1: 1, mastery_0: 0 } },
  { id: 3, label: 'komplett neu', iv: { mastery_3: 0, mastery_2: 0, mastery_1: 0, mastery_0: 0 } },
];

export const writingLadder = (offset = settings.writingSeedOffset) =>
  WRITING_LADDERS.find((l) => l.id === Number(offset)) || WRITING_LADDERS[1];

/** Streak the seeded tiers start with (they still need 4 fresh days for green). */
const SEED_STREAK = { mastery_3: 3, mastery_2: 2, mastery_1: 1, mastery_0: 0 };

/** Spread `n` characters across `span` days, deterministically. */
const spread = (i, n, span) => (n <= 1 ? 0 : Math.round((i * span) / n));

export async function fetchSeed() {
  const r = await fetch(SEED_FILE, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${SEED_FILE} nicht gefunden (HTTP ${r.status}).`);
  return r.json();
}

/**
 * Apply one tier to a list of characters.
 * Idempotent per run: an existing record is only lifted, never lowered, unless
 * `force` is set (used by the manual correction UI).
 */
export function applyTier(chars, tier, { track = 'both', force = false, now = Date.now(), offset } = {}) {
  const ladder = writingLadder(offset);
  const recIv = REC_INTERVALS[tier] ?? 0;
  const wriIv = ladder.iv[tier] ?? 0;
  const streak = SEED_STREAK[tier] ?? 0;
  const known = [...chars].filter((c) => data.has(c));
  const unknown = [...chars].filter((c) => !data.has(c));
  const touched = [];

  known.forEach((c, i) => {
    const r = { ...rec(c), tracks: { ...rec(c).tracks } };
    const seedTrack = (name, iv, span) => {
      const before = r.tracks[name];
      if (!force && before.reps > 0 && before.interval >= iv) return; // already stronger
      r.tracks[name] = iv > 0
        ? seededTrack(iv, { streak, now, jitterDays: spread(i, known.length, span) })
        : newTrack();
    };
    if (track === 'both' || track === 'recognition') {
      seedTrack('recognition', recIv, Math.min(21, Math.max(1, recIv)));
    }
    if (track === 'both' || track === 'writing') {
      seedTrack('writing', wriIv, Math.min(21, Math.max(1, wriIv)));
    }
    r.addedAt = r.addedAt ?? now;
    r.seedTier = tier;
    touched.push(r);
  });

  return { touched, known: known.length, unknown };
}

/** Full first-run import. Returns a summary for the UI. */
export async function importSeed(seed, { force = false, offset } = {}) {
  const now = Date.now();
  const all = [];
  const summary = { tiers: [], unknown: [] };

  for (const [tier, chars] of Object.entries(seed.learned)) {
    const { touched, known, unknown } = applyTier([...chars], tier, { force, now, offset });
    all.push(...touched);
    summary.tiers.push({ tier, known, unknown: unknown.length });
    summary.unknown.push(...unknown);
  }

  // Characters that were mid-learning in the old app: recognition at 1 day,
  // writing genuinely new. They stay in the queue and come first.
  const { touched, known, unknown } = applyTier([...seed.queue.in_progress], 'mastery_0', { force, now, offset });
  all.push(...touched);
  summary.tiers.push({ tier: 'in_progress', known, unknown: unknown.length });
  summary.unknown.push(...unknown);

  await saveRecs(all);
  await kvSet('seedImported', { at: new Date().toISOString(), records: all.length, offset: writingLadder(offset).id });
  summary.records = all.length;
  summary.dueSpread = describeSpread(all);
  return summary;
}

function describeSpread(recs) {
  const byDay = new Map();
  for (const r of recs) {
    for (const t of ['recognition', 'writing']) {
      const due = r.tracks[t].due;
      if (due == null) continue;
      const d = dayNumber(due) - dayNumber();
      byDay.set(d, (byDay.get(d) || 0) + 1);
    }
  }
  const days = [...byDay.keys()].sort((a, b) => a - b);
  return {
    firstDay: days[0] ?? 0,
    lastDay: days[days.length - 1] ?? 0,
    max: Math.max(0, ...byDay.values()),
    byDay: days.map((d) => [d, byDay.get(d)]),
  };
}

export const seedState = () => kvGet('seedImported', false);

/** Run the seed import exactly once, on the very first start. */
export async function autoImportOnFirstRun() {
  if (await seedState()) return null;
  const seed = await fetchSeed();
  const summary = await importSeed(seed);
  return { seed, summary };
}

/** Preview for the manual correction UI in the settings screen. */
export function previewChars(text) {
  const chars = [...new Set([...text].filter((c) => /\p{Script=Han}/u.test(c)))];
  return {
    chars,
    known: chars.filter((c) => data.has(c)),
    unknown: chars.filter((c) => !data.has(c)),
  };
}

export { mastery, dayStart };
