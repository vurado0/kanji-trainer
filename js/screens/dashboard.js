// Today's overview: what is due, the daily goal, the streak, and where the
// learning queue currently stands.

import { h, today, dayNumber, dateOfDay, dayStart, fmtDate } from '../util.js';
import { ring, toast } from '../ui.js';
import { settings, todayCounts, currentStreak, activityByDay, allReviews } from '../store.js';
import { dueCounts, newAllowance, weakest } from '../session.js';
import * as queue from '../queue.js';
import * as data from '../data.js';
import { navigate } from '../router.js';
import { allPairs } from '../confusion.js';

export async function dashboardScreen() {
  const wrap = h('div.wrap');
  const due = dueCounts();
  const [{ reviews: doneToday }, streak, act, allow] = await Promise.all([
    todayCounts(), currentStreak(), activityByDay(), newAllowance(),
  ]);

  // --- goal + streak -------------------------------------------------------
  const goal = Math.max(1, Math.min(settings.reviewsPerDay, doneToday + due.total + allow.left * 2) || settings.reviewsPerDay);
  wrap.append(h('div.card',
    h('div.dash-top',
      ring(doneToday, goal, 'Reviews'),
      h('div',
        h('div.stat-line',
          st(due.recognition, 'Erkennen fällig'),
          st(due.writing, 'Schreiben fällig'),
          st(streak, streak === 1 ? 'Tag Serie' : 'Tage Serie'),
          st(allow.left, 'neue Zeichen heute')),
        h('div.small.muted.mt', allow.gateOpen
          ? `Tageslimit: ${settings.newPerDay} neu · ${settings.reviewsPerDay} Reviews`
          : `Neue Zeichen pausiert — ${allow.backlog} Reviews im Rückstand (Grenze ${settings.backlogGate})`)))));

  // --- primary actions -----------------------------------------------------
  wrap.append(h('div.btn-grid.mt',
    h('button.btn.primary', { onclick: () => navigate('/session/due'), disabled: due.total === 0 },
      due.total ? `Fällige Reviews (${due.total})` : 'Keine Reviews fällig'),
    h('button.btn', { onclick: () => navigate('/study'), disabled: allow.left === 0 },
      allow.left ? `Neu lernen (${allow.left})` : 'Neu lernen — Limit erreicht'),
    h('button.btn', { onclick: () => navigate('/custom') }, 'Custom Review')));

  wrap.append(h('div.btn-grid.mt',
    h('button.btn.sm', { onclick: () => navigate('/session/warmup') }, '5-Minuten-Warm-up'),
    h('button.btn.sm', { onclick: () => navigate('/session/confusion') }, `Verwechslungs-Drill (${allPairs().length})`),
    h('button.btn.sm', { onclick: () => navigate('/notebook') }, 'Fehlerheft')));

  // --- next up in the queue -------------------------------------------------
  const next = queue.nextUp(5);
  const lesson = queue.currentLesson();
  const pending = queue.pending();
  if (next.length) {
    const startPos = pending.indexOf(next[0]) + 1;
    const levelOf = data.entry(next[0])?.lv;
    wrap.append(h('div.card.mt',
      h('h2', 'Als Nächstes'),
      h('div.next-strip', next.map((c) =>
        h('button.kc.jp', { onclick: () => navigate(`/kanji/${encodeURIComponent(c)}`), title: data.shortMeaning(c) }, c))),
      h('div.small.muted.mt',
        `Lektion ${lesson?.n ?? 1} von ${queue.lessonCount()} · Position ${startPos}–${startPos + next.length - 1} von ${pending.length}`,
        levelOf ? ` (N${levelOf})` : ''),
      h('div.row.mt',
        h('button.btn.sm', { onclick: () => navigate('/queue') }, 'Warteschlange ansehen'),
        h('button.btn.sm', { onclick: () => navigate('/study') }, 'Lektion starten'))));
  } else {
    wrap.append(h('div.card.mt', h('div.muted', 'Die Warteschlange ist leer — alle Zeichen sind eingeführt.')));
  }

  // --- weak spots -----------------------------------------------------------
  const weak = weakest(8, 'writing');
  if (weak.length) {
    wrap.append(h('div.card.mt',
      h('h2', 'Schwächste Zeichen (Schreiben)'),
      h('div.next-strip', weak.map((c) =>
        h('button.kc.jp', { onclick: () => navigate(`/kanji/${encodeURIComponent(c)}`), title: data.shortMeaning(c) }, c)))));
  }

  // --- month heatmap --------------------------------------------------------
  wrap.append(h('div.card.mt', h('h2', 'Dieser Monat'), monthHeatmap(act)));

  return wrap;
}

const st = (v, l) => h('div.stat', h('b', String(v)), h('span', l));

function monthHeatmap(act) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7; // Monday-first
  const box = h('div');

  box.append(h('div.heat-head', ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((d) => h('div', d))));
  const grid = h('div.heat');
  for (let i = 0; i < lead; i++) grid.append(h('div', { style: { background: 'transparent' } }));

  const max = Math.max(1, ...act.values());
  const td = today();
  for (let d = 1; d <= daysInMonth; d++) {
    const dn = dayNumber(new Date(year, month, d, 12).getTime());
    const n = act.get(dn) || 0;
    const cell = h(`div${dn === td ? '.today' : ''}`, { title: `${fmtDate(new Date(year, month, d))}: ${n} Reviews` }, String(d));
    if (n > 0) {
      const t = Math.min(1, n / max);
      cell.style.background = `rgba(74,158,255,${0.22 + t * 0.62})`;
      cell.style.color = '#fff';
    }
    grid.append(cell);
  }
  box.append(grid);
  const monthTotal = [...act.entries()]
    .filter(([dn]) => { const dt = dateOfDay(dn); return dt.getMonth() === month && dt.getFullYear() === year; })
    .reduce((s, [, n]) => s + n, 0);
  box.append(h('div.small.muted.mt', `${monthTotal} Reviews in ${first.toLocaleDateString('de-DE', { month: 'long' })}`));
  return box;
}

/** Error notebook: what most recently went wrong. */
export async function notebookScreen() {
  const wrap = h('div.wrap');
  const reviews = (await allReviews()).filter((r) => !r.ok).slice(-400).reverse();
  const seen = new Map();
  for (const r of reviews) {
    const k = r.char + '|' + r.track;
    if (!seen.has(k)) seen.set(k, { ...r, n: 0 });
    seen.get(k).n += 1;
  }
  const list = [...seen.values()];

  wrap.append(h('div.card',
    h('h2', 'Fehlerheft'),
    h('div.small.muted', 'Zuletzt falsch beantwortete Karten, neueste zuerst.'),
    list.length
      ? h('div.row.mt',
          h('button.btn.sm.primary', {
            onclick: () => navigate(`/custom?chars=${encodeURIComponent([...new Set(list.map((r) => r.char))].slice(0, 40).join(''))}`),
          }, 'Alle gezielt üben'))
      : null));

  if (!list.length) {
    wrap.append(h('div.card.center.mt', h('div.muted', 'Noch keine Fehler aufgezeichnet.')));
    return wrap;
  }

  const box = h('div.card.mt');
  for (const r of list.slice(0, 80)) {
    box.append(h('div.qrow',
      h('div.kc.jp', r.char),
      h('div.mn',
        h('div', data.shortMeaning(r.char, 3)),
        h('div.small.muted',
          `${r.track === 'writing' ? 'Schreiben' : 'Erkennen'} · ${fmtDate(r.ts)}${r.n > 1 ? ` · ${r.n}×` : ''}` +
          (r.strokeOrderErrors ? ` · ${r.strokeOrderErrors}× Strichreihenfolge` : '') +
          (r.chosen ? ` · gewählt: ${r.chosen}` : ''))),
      h('button.btn.sm', { onclick: () => navigate(`/kanji/${encodeURIComponent(r.char)}`) }, 'Details')));
  }
  wrap.append(box);
  return wrap;
}

export { dayStart };
