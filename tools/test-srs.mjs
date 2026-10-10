/**
 * Assertions for the rules the spec calls out explicitly.
 *   node tools/test-srs.mjs
 */
import { applyGrade, newTrack, mastery, isGreen, GRADE, seededTrack } from '../js/srs.js';
import { DAY_MS, dayNumber } from '../js/util.js';

let fails = 0;
const ok = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) fails++; };

console.log('green gate');
{
  let t = newTrack();
  let now = Date.now();
  const greenAt = [];
  for (let i = 0; i < 6; i++) {
    t = applyGrade(t, GRADE.EASY, { now }).track;
    if (isGreen(t)) greenAt.push(i + 1);
    now += Math.max(1, t.interval) * DAY_MS;
  }
  ok(greenAt[0] === 4, `earliest green is repetition ${greenAt[0]} (must be 4)`);
}
{
  // Same day, four correct answers in a row: must NOT go green.
  let t = newTrack();
  const now = Date.now();
  for (let i = 0; i < 6; i++) t = applyGrade(t, GRADE.EASY, { now: now + i * 60000 }).track;
  ok(!isGreen(t), 'four correct answers within one session do not turn a card green');
  ok(t.streak === 1, `streak after 6 same-day correct answers is ${t.streak} (must be 1)`);
  ok(mastery(t) < 90, `mastery stays below 90 (${mastery(t)})`);
}
{
  // Four correct answers on four days but a short interval: still not green.
  let t = newTrack();
  let now = Date.now();
  for (let i = 0; i < 4; i++) { t = applyGrade(t, GRADE.HARD, { now }).track; now += DAY_MS; }
  ok(new Set(t.days).size === 4 && t.streak === 4, 'streak 4 over 4 distinct days');
  ok(t.interval < 21 && !isGreen(t), `interval ${t.interval} d < 21 d keeps it out of green`);
}

console.log('lapses');
{
  let t = newTrack();
  let now = Date.now();
  for (let i = 0; i < 5; i++) { t = applyGrade(t, GRADE.GOOD, { now }).track; now += t.interval * DAY_MS; }
  const before = t.interval;
  const r = applyGrade(t, GRADE.AGAIN, { now });
  ok(r.info.lapsed, 'a failed review is recorded as a lapse');
  ok(r.track.interval === Math.max(1, Math.round(before * 0.3)), `interval ${before} -> ${r.track.interval} (~30 %)`);
  ok(r.track.interval >= 1, 'never resets below 1 day');
  ok(r.track.streak === 0 && r.track.days.length === 0, 'streak and day history reset');
  ok(r.track.state === 'relearning', 'card enters relearning');
}
{
  let t = newTrack();
  let now = Date.now();
  for (let i = 0; i < 3; i++) { t = applyGrade(t, GRADE.GOOD, { now }).track; now += t.interval * DAY_MS; }
  let leech = false;
  for (let i = 0; i < 5; i++) {
    const r = applyGrade(t, GRADE.AGAIN, { now: now + i * DAY_MS });
    t = r.track; leech = leech || r.info.becameLeech;
    t = applyGrade(t, GRADE.GOOD, { now: now + i * DAY_MS + 3600000 }).track;
  }
  ok(t.lapses === 5 && leech, `flagged as a leech at ${t.lapses} lapses`);
}

console.log('seed import');
{
  const t = seededTrack(60, { streak: 0, jitterDays: 9 });
  ok(t.state === 'review' && t.interval === 60, 'seeded track starts as a review card with the given interval');
  ok(t.days.length === 0 && !isGreen(t), 'a seeded card is not green until it earns 4 distinct days here');
  ok(dayNumber(t.due) - dayNumber() === 9, 'due date honours the spread-out jitter');
  ok(mastery(t) > 0, `seeded mastery ${mastery(t)} > 0, so it never shows as "new"`);
  ok(seededTrack(0).state === 'new', 'interval 0 means a genuinely new track');
}

console.log(fails ? `\n${fails} FAILED` : '\nall assertions passed');
process.exit(fails ? 1 : 0);
