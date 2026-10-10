// Statistics: throughput, accuracy per mode, mastery distribution, error hot spots.

import { h, today, dateOfDay, groupBy, masteryColor, fmtDate } from '../util.js';
import { allReviews, allRecords, rec } from '../store.js';
import { mastery, TRACKS } from '../srs.js';
import { MODE_LABEL } from '../modes/index.js';
import * as data from '../data.js';
import { navigate } from '../router.js';

export async function statsScreen() {
  const wrap = h('div.wrap');
  const reviews = await allReviews();

  if (!reviews.length) {
    wrap.append(h('div.card.center', h('div.muted', 'Noch keine Reviews aufgezeichnet.')));
  }

  // --- reviews per day ------------------------------------------------------
  const td = today();
  const days = [];
  const byDay = new Map();
  for (const r of reviews) byDay.set(r.day, (byDay.get(r.day) || 0) + 1);
  for (let i = 29; i >= 0; i--) days.push({ day: td - i, n: byDay.get(td - i) || 0 });
  const maxDay = Math.max(1, ...days.map((d) => d.n));

  wrap.append(h('div.card',
    h('h2', 'Reviews pro Tag (30 Tage)'),
    h('div.bars', days.map((d) => h('div.b', {
      style: { height: `${(d.n / maxDay) * 100}%` },
      title: `${fmtDate(dateOfDay(d.day))}: ${d.n}`,
      class: d.day === td ? 'g' : '',
    }))),
    h('div.small.muted.mt', `Summe: ${reviews.length} Reviews · Maximum an einem Tag: ${maxDay}`)));

  // --- accuracy per mode ----------------------------------------------------
  const byMode = groupBy(reviews.filter((r) => r.mode), (r) => r.mode);
  const modeRows = [...byMode.entries()].map(([mode, list]) => ({
    mode,
    n: list.length,
    acc: list.filter((r) => r.ok).length / list.length,
    ms: Math.round(list.reduce((s, r) => s + (r.ms || 0), 0) / list.length),
  })).sort((a, b) => b.n - a.n);

  wrap.append(h('div.card',
    h('h2', 'Genauigkeit pro Modus'),
    modeRows.length
      ? h('table.data',
          h('tr', h('th', 'Modus'), h('th.num', 'Karten'), h('th.num', 'richtig'), h('th.num', 'Ø Zeit')),
          modeRows.map((r) => h('tr',
            h('td', MODE_LABEL[r.mode] || r.mode),
            h('td.num', String(r.n)),
            h('td.num', `${Math.round(r.acc * 100)} %`),
            h('td.num', `${(r.ms / 1000).toFixed(1)} s`))))
      : h('div.muted', 'Noch keine Daten.')));

  // --- mastery distribution -------------------------------------------------
  const buckets = [
    { label: 'neu', lo: 0, hi: 0 },
    { label: '1–29', lo: 1, hi: 29 },
    { label: '30–59', lo: 30, hi: 59 },
    { label: '60–89', lo: 60, hi: 89 },
    { label: '90–100 (grün)', lo: 90, hi: 100 },
  ];
  const dist = h('table.data', h('tr', h('th', 'Beherrschung'), h('th.num', 'Erkennen'), h('th.num', 'Schreiben')));
  const records = allRecords();
  const total = data.entries().length;
  for (const b of buckets) {
    const count = (track) => {
      if (b.hi === 0) return total - records.filter((r) => mastery(r.tracks[track]) > 0).length;
      return records.filter((r) => { const m = mastery(r.tracks[track]); return m >= b.lo && m <= b.hi; }).length;
    };
    dist.append(h('tr',
      h('td', h('span', { style: { display: 'inline-block', width: '10px', height: '10px', borderRadius: '2px', background: masteryColor(b.hi), marginRight: '7px' } }), b.label),
      h('td.num', String(count('recognition'))),
      h('td.num', String(count('writing')))));
  }
  wrap.append(h('div.card', h('h2', `Verteilung der Beherrschungsgrade (${total} Zeichen)`), dist));

  // --- error hot spots ------------------------------------------------------
  const wrong = reviews.filter((r) => !r.ok);
  const perChar = groupBy(wrong, (r) => r.char);
  const worst = [...perChar.entries()]
    .map(([char, list]) => ({
      char, n: list.length,
      rec: list.filter((r) => r.track === 'recognition').length,
      wri: list.filter((r) => r.track === 'writing').length,
      chosen: mostCommon(list.map((r) => r.chosen).filter(Boolean)),
    }))
    .sort((a, b) => b.n - a.n).slice(0, 20);

  wrap.append(h('div.card',
    h('h2', 'Häufigste Fehler'),
    worst.length
      ? h('table.data',
          h('tr', h('th', 'Zeichen'), h('th', 'Bedeutung'), h('th.num', 'Fehler'), h('th.num', 'E/S'), h('th', 'meist verwechselt mit')),
          worst.map((w) => h('tr', { onclick: () => navigate(`/kanji/${encodeURIComponent(w.char)}`), style: { cursor: 'pointer' } },
            h('td', h('span.jp', { style: { fontSize: '22px' } }, w.char)),
            h('td', data.shortMeaning(w.char, 2)),
            h('td.num', String(w.n)),
            h('td.num', `${w.rec}/${w.wri}`),
            h('td', w.chosen ? h('span.jp', w.chosen) : '—'))))
      : h('div.muted', 'Noch keine Fehler aufgezeichnet.')));

  // --- stroke order ---------------------------------------------------------
  const writing = reviews.filter((r) => r.track === 'writing' && r.strokeOrderErrors != null);
  const perCharStroke = groupBy(writing, (r) => r.char);
  const strokeRows = [...perCharStroke.entries()]
    .map(([char, list]) => ({
      char,
      attempts: list.length,
      errs: list.reduce((s, r) => s + (r.strokeOrderErrors || 0), 0),
      rate: list.filter((r) => (r.strokeOrderErrors || 0) > 0).length / list.length,
    }))
    .filter((x) => x.errs > 0)
    .sort((a, b) => b.rate - a.rate || b.errs - a.errs)
    .slice(0, 20);

  const totalStrokeErrs = writing.reduce((s, r) => s + (r.strokeOrderErrors || 0), 0);
  wrap.append(h('div.card',
    h('h2', 'Strichreihenfolge'),
    h('div.small.muted', `${totalStrokeErrs} Strichordnungsfehler in ${writing.length} Schreib-Karten`),
    strokeRows.length
      ? h('table.data.mt',
          h('tr', h('th', 'Zeichen'), h('th.num', 'Versuche'), h('th.num', 'Fehler'), h('th.num', 'Fehlerquote')),
          strokeRows.map((s) => h('tr', { onclick: () => navigate(`/kanji/${encodeURIComponent(s.char)}`), style: { cursor: 'pointer' } },
            h('td', h('span.jp', { style: { fontSize: '22px' } }, s.char)),
            h('td.num', String(s.attempts)),
            h('td.num', String(s.errs)),
            h('td.num', `${Math.round(s.rate * 100)} %`))))
      : h('div.muted.mt', 'Keine Strichordnungsfehler aufgezeichnet.')));

  return wrap;
}

function mostCommon(arr) {
  if (!arr.length) return null;
  const m = new Map();
  for (const x of arr) m.set(x, (m.get(x) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1])[0][0];
}
