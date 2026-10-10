/**
 * Queue view: the strict learning order, cut into lessons, with manual control
 * (pull forward, push back, suspend).
 */

import { h, clear } from '../util.js';
import * as data from '../data.js';
import * as queue from '../queue.js';
import { rec, saveRec, settings } from '../store.js';
import { mastery } from '../srs.js';
import { navigate } from '../router.js';
import { toast, confirmDialog } from '../ui.js';

const PAGE = 15; // lessons rendered per page

export async function queueScreen({ query }) {
  const wrap = h('div.wrap');
  let page = Number(query.page || 0);
  const body = h('div');

  function render() {
    clear(body);
    const lessons = queue.lessons();
    const pending = queue.pending();
    const done = queue.getOrder().filter(queue.isLearned).length;

    body.append(h('div.card',
      h('h2', 'Lern-Warteschlange'),
      h('div.stat-line',
        h('div.stat', h('b', String(pending.length)), h('span', 'offen')),
        h('div.stat', h('b', String(done)), h('span', 'eingeführt')),
        h('div.stat', h('b', String(queue.lessonCount())), h('span', 'Lektionen')),
        h('div.stat', h('b', String(settings.lessonSize)), h('span', 'pro Lektion'))),
      h('div.small.muted.mt',
        'Reihenfolge: begonnene Zeichen aus der alten App → Rest von N3 → N2 und N1 nach Häufigkeit. ' +
        '„Neu lernen" nimmt immer von vorne.')));

    const from = page * PAGE;
    const slice = lessons.slice(from, from + PAGE);
    for (const l of slice) {
      body.append(h(`div.lesson-head${l.unlocked ? '' : '.locked'}`,
        h('b', `Lektion ${l.n}`),
        h('span.muted', `${l.done}/${l.chars.length}`),
        l.complete ? h('span.pill', 'fertig') : l.unlocked ? h('span.pill.on', 'offen') : h('span.pill', 'gesperrt')));
      const list = h('div.qlist');
      l.chars.forEach((c, i) => {
        const e = data.entry(c);
        const r = rec(c);
        const learned = queue.isLearned(c);
        const row = h(`div.qrow${learned ? '.done' : ''}`,
          h('div.idx', String(l.from + i + 1)),
          h('div.kc.jp', c),
          h('div.mn',
            h('div', data.shortMeaning(c, 3)),
            h('div.small.muted',
              `${e?.lv ? 'N' + e.lv : 'ohne Stufe'} · E ${mastery(r.tracks.recognition)} / S ${mastery(r.tracks.writing)}` +
              (r.suspended ? ' · ausgesetzt' : ''))),
          h('button.btn.sm', { onclick: () => navigate(`/kanji/${encodeURIComponent(c)}`) }, 'Details'),
          h('button.btn.sm', { onclick: async () => { await queue.moveToFront(c); toast(`${c} vorgezogen`); render(); } }, '↑'),
          h('button.btn.sm', { onclick: async () => { await queue.moveToEnd(c); toast(`${c} ans Ende gestellt`); render(); } }, '↓'),
          h('button.btn.sm', {
            onclick: async () => {
              await saveRec({ ...rec(c), suspended: !r.suspended });
              toast(r.suspended ? `${c} wieder aktiv` : `${c} ausgesetzt`);
              render();
            },
          }, r.suspended ? '▶' : '⏸'));
        list.append(row);
      });
      body.append(list);
    }

    const pages = Math.ceil(lessons.length / PAGE);
    body.append(h('div.row.mt',
      h('button.btn.sm', { disabled: page === 0, onclick: () => { page -= 1; render(); body.scrollIntoView(); } }, '‹ Zurück'),
      h('span.small.muted', `Seite ${page + 1} von ${pages}`),
      h('button.btn.sm', { disabled: page + 1 >= pages, onclick: () => { page += 1; render(); body.scrollIntoView(); } }, 'Weiter ›')));

    body.append(h('div.card.mt',
      h('h2', 'Reihenfolge zurücksetzen'),
      h('div.small.muted', 'Stellt die ursprüngliche Reihenfolge aus seed-progress.json wieder her. Bereits begonnene Zeichen bleiben vorn.'),
      h('button.btn.sm.mt', {
        onclick: async () => {
          if (!(await confirmDialog('Reihenfolge zurücksetzen?', 'Manuelle Umsortierungen gehen verloren. Der Lernfortschritt bleibt erhalten.', { okLabel: 'Zurücksetzen' }))) return;
          const seed = await (await fetch('seed-progress.json')).json();
          await queue.rebuild(seed);
          toast('Reihenfolge neu aufgebaut');
          render();
        },
      }, 'Neu aufbauen')));
  }

  render();
  wrap.append(body);
  return wrap;
}
