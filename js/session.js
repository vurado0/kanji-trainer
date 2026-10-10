/**
 * Session engine: turns a set of (character, track) pairs into an ordered run of
 * cards, applies grades, logs reviews and supports undo.
 *
 * Both tracks are scheduled independently but share one queue, interleaved so
 * writing cards never arrive in a long block.
 */

import { GRADE, applyGrade, mastery, isDue, TRACKS } from './srs.js';
import { rec, saveRec, logReview, dropReview, settings, todayCounts, allRecords } from './store.js';
import * as queue from './queue.js';
import * as data from './data.js';
import { shuffle, uniq, today } from './util.js';
import { drillChars } from './confusion.js';

// ---------------------------------------------------------------------------
// Building card lists
// ---------------------------------------------------------------------------

const usable = (r) => !r.suspended;

/** Everything whose due date has passed, per track. */
export function dueItems({ tracks = TRACKS, now = Date.now() } = {}) {
  const out = [];
  for (const r of allRecords()) {
    if (!usable(r)) continue;
    for (const t of tracks) {
      if (isDue(r.tracks[t], now)) out.push({ char: r.char, track: t, kind: 'review', due: r.tracks[t].due });
    }
  }
  out.sort((a, b) => a.due - b.due);
  return out;
}

export function dueCounts(now = Date.now()) {
  const c = { recognition: 0, writing: 0, total: 0 };
  for (const r of allRecords()) {
    if (!usable(r)) continue;
    for (const t of TRACKS) if (isDue(r.tracks[t], now)) { c[t] += 1; c.total += 1; }
  }
  return c;
}

/**
 * The next characters to introduce, honouring the daily limit and the backlog
 * gate ("no new material while more than N reviews are waiting").
 */
export async function newAllowance() {
  const { newCards } = await todayCounts();
  const backlog = dueCounts().total;
  const gateOpen = backlog < settings.backlogGate;
  const left = Math.max(0, settings.newPerDay - newCards);
  return { left: gateOpen ? left : 0, backlog, gateOpen, doneToday: newCards, limit: settings.newPerDay };
}

/** Cards for introducing `chars`: both tracks, recognition first. */
export function newItems(chars) {
  return chars.flatMap((c) => [
    { char: c, track: 'recognition', kind: 'new' },
    { char: c, track: 'writing', kind: 'new' },
  ]);
}

export async function reviewAllowance() {
  const { reviews } = await todayCounts();
  return Math.max(0, settings.reviewsPerDay - reviews);
}

/** Weakest characters, for the 5-minute warm-up and the error notebook. */
export function weakest(n = 10, track = 'writing') {
  return allRecords()
    .filter((r) => usable(r) && r.tracks[track].reps > 0)
    .map((r) => ({ char: r.char, m: mastery(r.tracks[track]), lapses: r.tracks[track].lapses }))
    .sort((a, b) => a.m - b.m || b.lapses - a.lapses)
    .slice(0, n)
    .map((x) => x.char);
}

export function confusionItems(limit = 20) {
  return drillChars(limit).map((c) => ({ char: c, track: 'recognition', kind: 'review', forceMode: 'confusion' }));
}

// ---------------------------------------------------------------------------
// Mode selection
// ---------------------------------------------------------------------------

const RECOGNITION_MODES = ['recognitionMC', 'reverseMC', 'reading'];
const WRITING_MODES = ['writingGuided', 'writingBlind'];

export function enabledModes(track) {
  const list = track === 'writing' ? WRITING_MODES : RECOGNITION_MODES;
  return list.filter((m) => settings.modes[m]);
}

/**
 * Which exercise to use for a card.
 * Writing starts guided and only goes blind once the track is reasonably solid;
 * reading needs example vocabulary, so it is skipped where JMdict has none.
 */
export function chooseMode(item, vocabCount) {
  if (item.forceMode) return item.forceMode;
  const r = rec(item.char);
  const t = r.tracks[item.track];
  const on = enabledModes(item.track);
  if (!on.length) return item.track === 'writing' ? 'writingGuided' : 'recognitionMC';

  if (item.track === 'writing') {
    const m = mastery(t);
    if (item.kind === 'new' || m < 55 || !settings.modes.writingBlind) {
      return settings.modes.writingGuided ? 'writingGuided' : 'writingBlind';
    }
    if (!settings.modes.writingGuided) return 'writingBlind';
    // Mostly blind once it is solid, but keep some guided repetitions.
    return Math.random() < 0.72 ? 'writingBlind' : 'writingGuided';
  }

  let pool = on.filter((m) => m !== 'reading' || vocabCount > 0);
  if (!pool.length) pool = ['recognitionMC'];
  // A brand new character is always introduced with the direct kanji -> meaning
  // question before the reversed one.
  if (item.kind === 'new' && pool.includes('recognitionMC')) return 'recognitionMC';
  return pool[Math.floor(Math.random() * pool.length)];
}

/** Interleave so at most `max` writing cards appear back to back. */
export function interleave(items, max = 2) {
  const w = items.filter((i) => i.track === 'writing');
  const r = items.filter((i) => i.track !== 'writing');
  if (!w.length || !r.length) return items;
  const out = [];
  let run = 0;
  while (w.length || r.length) {
    if (r.length && (run >= max || !w.length || Math.random() < r.length / (r.length + w.length))) {
      out.push(r.shift());
      run = 0;
    } else if (w.length) {
      out.push(w.shift());
      run += 1;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

const RELEARN_GAP = 3;      // failed card returns after this many other cards
const RELEARN_CORRECT = 2;  // and must then be right this many times

let nextCardId = 1;

export class Session {
  constructor(items, { title = 'Review', kind = 'due' } = {}) {
    this.title = title;
    this.kind = kind;
    this.cards = items.map((it) => ({ ...it, id: nextCardId++, need: 1, done: 0, attempts: 0 }));
    this.pos = 0;
    this.answered = 0;
    this.correct = 0;
    this.startedAt = Date.now();
    this.history = [];        // for undo
    this.errors = [];         // for the summary
    this.plannedTotal = this.cards.length;
    this.cardStart = Date.now();
  }

  get total() { return this.plannedTotal; }
  get remaining() { return this.cards.length - this.pos; }
  get progress() { return this.plannedTotal ? this.answered / (this.answered + this.remaining || 1) : 1; }
  get finished() { return this.pos >= this.cards.length; }

  current() { return this.cards[this.pos] || null; }

  peekChars(n = 8) { return this.cards.slice(this.pos, this.pos + n).map((c) => c.char); }

  startTimer() { this.cardStart = Date.now(); }

  /**
   * Grade the current card.
   * @param grade  GRADE.*
   * @param extra  mode-specific metrics (stroke order errors, chosen option, …)
   */
  async grade(grade, extra = {}) {
    const card = this.current();
    if (!card) return null;
    const r = rec(card.char);
    const before = JSON.parse(JSON.stringify(r));
    const ms = Date.now() - this.cardStart;
    const wasNew = r.tracks[card.track].state === 'new';

    const { track: nextTrack, info } = applyGrade(r.tracks[card.track], grade);
    const updated = { ...r, tracks: { ...r.tracks, [card.track]: nextTrack } };
    updated.lastSeen = Date.now();
    updated.addedAt = updated.addedAt ?? Date.now();
    if (info.becameLeech) updated.leech = true;
    await saveRec(updated);

    const review = await logReview({
      ts: Date.now(),
      char: card.char,
      track: card.track,
      mode: card.mode || extra.mode || null,
      grade,
      ms,
      ok: grade !== GRADE.AGAIN,
      isNew: wasNew,
      counted: info.counted,
      ...(extra.strokeOrderErrors != null ? { strokeOrderErrors: extra.strokeOrderErrors } : {}),
      ...(extra.hintsUsed != null ? { hintsUsed: extra.hintsUsed } : {}),
      ...(extra.chosen ? { chosen: extra.chosen } : {}),
      ...(extra.answer ? { answer: extra.answer } : {}),
    });

    this.history.push({ cardId: card.id, pos: this.pos, before, reviewId: review.id, grade, cards: this.cards.length });
    this.answered += 1;
    if (grade !== GRADE.AGAIN) this.correct += 1;
    else {
      this.errors.push({ char: card.char, track: card.track, mode: card.mode, extra, ts: Date.now() });
    }

    if (grade === GRADE.AGAIN) {
      // Back into the session after a few other cards, and it must be right
      // twice before it counts as settled.
      const again = { ...card, id: nextCardId++, need: RELEARN_CORRECT, done: 0, relearn: true, mode: null };
      const at = Math.min(this.cards.length, this.pos + 1 + RELEARN_GAP);
      this.cards.splice(at, 0, again);
      this.pos += 1;
    } else if (card.done + 1 < card.need) {
      const again = { ...card, id: nextCardId++, done: card.done + 1, relearn: true, mode: null };
      const at = Math.min(this.cards.length, this.pos + 1 + RELEARN_GAP);
      this.cards.splice(at, 0, again);
      this.pos += 1;
    } else {
      this.pos += 1;
    }
    this.startTimer();
    return { info, grade };
  }

  /** Undo the most recent grade, restoring both the record and the queue. */
  async undo() {
    const last = this.history.pop();
    if (!last) return false;
    await saveRec(last.before);
    if (last.reviewId != null) await dropReview(last.reviewId);
    // Remove any relearn copy that this grade inserted.
    if (this.cards.length > last.cards) {
      const idx = this.cards.findIndex((c, i) => i > last.pos && c.relearn && c.char === this.cards[last.pos]?.char);
      if (idx > 0) this.cards.splice(idx, 1);
    }
    this.pos = last.pos;
    this.answered = Math.max(0, this.answered - 1);
    if (last.grade !== GRADE.AGAIN) this.correct = Math.max(0, this.correct - 1);
    else this.errors.pop();
    const c = this.current();
    if (c) c.mode = null;
    this.startTimer();
    return true;
  }

  get canUndo() { return this.history.length > 0; }

  summary() {
    const secs = Math.round((Date.now() - this.startedAt) / 1000);
    const byChar = new Map();
    for (const e of this.errors) {
      const k = e.char + '|' + e.track;
      byChar.set(k, { ...e, n: (byChar.get(k)?.n || 0) + 1 });
    }
    return {
      answered: this.answered,
      correct: this.correct,
      accuracy: this.answered ? this.correct / this.answered : 0,
      seconds: secs,
      perMin: secs > 0 ? (this.answered / secs) * 60 : 0,
      errors: [...byChar.values()].sort((a, b) => b.n - a.n),
      strokeOrderErrors: this.errors.reduce((s, e) => s + (e.extra?.strokeOrderErrors || 0), 0),
    };
  }
}

// ---------------------------------------------------------------------------
// Ready-made session builders
// ---------------------------------------------------------------------------

export async function buildDueSession({ tracks = TRACKS, limit } = {}) {
  const cap = limit ?? (await reviewAllowance());
  const items = dueItems({ tracks }).slice(0, cap);
  await data.preload(uniq(items.map((i) => i.char)));
  return new Session(interleave(items), { title: 'Fällige Reviews', kind: 'due' });
}

export async function buildNewSession(count) {
  const allow = await newAllowance();
  const n = Math.max(0, Math.min(count ?? allow.left, allow.left));
  const chars = queue.nextUp(n);
  await data.preload(chars);
  return { session: new Session(interleave(newItems(chars)), { title: 'Neu lernen', kind: 'new' }), chars, allow };
}

export async function buildCustomSession(opts) {
  const {
    chars, tracks = TRACKS, limit = 40, onlyDue = false, shuffleCards = true, forceMode = null,
  } = opts;
  let items = [];
  for (const c of chars) {
    for (const t of tracks) {
      const tr = rec(c).tracks[t];
      if (onlyDue && !isDue(tr)) continue;
      items.push({ char: c, track: t, kind: tr.state === 'new' ? 'new' : 'review', forceMode });
    }
  }
  if (shuffleCards) items = shuffle(items);
  items = interleave(items).slice(0, limit);
  await data.preload(uniq(items.map((i) => i.char)));
  return new Session(items, { title: 'Custom Review', kind: 'custom' });
}

export async function buildWarmup(n = 10) {
  const chars = weakest(n, 'writing');
  await data.preload(chars);
  const items = chars.map((c) => ({ char: c, track: 'writing', kind: 'review' }));
  return new Session(items, { title: '5-Minuten-Warm-up', kind: 'warmup' });
}

export async function buildConfusionSession(limit = 20) {
  const items = confusionItems(limit);
  await data.preload(uniq(items.map((i) => i.char)));
  return new Session(items, { title: 'Verwechslungs-Drill', kind: 'confusion' });
}

export { GRADE, today };
