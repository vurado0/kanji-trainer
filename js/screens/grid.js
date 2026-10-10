/**
 * The full kanji grid, grouped by JLPT level and coloured by mastery.
 * Colour is min(recognition, writing) — a character only turns green once it
 * can also be written.
 */

import { h, clear, LEVEL_NAME, masteryColor } from '../util.js';
import { kanjiCell, modal, toast, segmented } from '../ui.js';
import * as data from '../data.js';
import { rec, allRecords, saveRec, isStarted } from '../store.js';
import { mastery, charMastery } from '../srs.js';
import { navigate } from '../router.js';
import { applyTier, REC_INTERVALS } from '../seed.js';
import * as queue from '../queue.js';

const STATUS = [
  { id: 'all', label: 'Alle' },
  { id: 'new', label: 'Neu' },
  { id: 'started', label: 'Angefangen' },
  { id: 'weak', label: 'Schwach' },
  { id: 'green', label: 'Grün' },
  { id: 'writingWeak', label: 'Schreiben schwach' },
  { id: 'leech', label: 'Leeches' },
  { id: 'suspended', label: 'Ausgesetzt' },
];

export async function gridScreen({ query }) {
  const wrap = h('div.wrap.wide');
  let filter = { level: query.level ? Number(query.level) : null, status: query.status || 'all', q: query.q || '' };

  const search = h('input', { type: 'search', placeholder: 'Zeichen, Lesung oder Bedeutung suchen …', value: filter.q });
  const chips = h('div.chips');
  const levelChips = h('div.chips');
  const body = h('div');
  const countLine = h('div.small.muted');

  const bar = h('div.filter-bar', search, h('div.mt', levelChips), h('div.mt', chips), h('div.mt', countLine));
  wrap.append(bar, body);

  for (const s of STATUS) {
    const p = h('button.pill', { type: 'button' }, s.label);
    p.addEventListener('click', () => { filter.status = s.id; sync(); });
    p.dataset.id = s.id;
    chips.append(p);
  }
  for (const lv of [null, 5, 4, 3, 2, 1, 0]) {
    const p = h('button.pill', { type: 'button' }, lv === null ? 'Alle Stufen' : lv === 0 ? 'Sonstige' : `N${lv}`);
    p.addEventListener('click', () => { filter.level = lv; sync(); });
    p.dataset.lv = String(lv);
    levelChips.append(p);
  }
  search.addEventListener('input', () => { filter.q = search.value; renderList(); });

  function sync() {
    for (const p of chips.children) p.classList.toggle('on', p.dataset.id === filter.status);
    for (const p of levelChips.children) p.classList.toggle('on', p.dataset.lv === String(filter.level));
    renderList();
  }

  function matches(e) {
    if (filter.level !== null && e.lv !== filter.level) return false;
    const r = rec(e.c);
    const mRec = mastery(r.tracks.recognition);
    const mWri = mastery(r.tracks.writing);
    const m = Math.min(mRec, mWri);
    switch (filter.status) {
      case 'new': if (isStarted(e.c)) return false; break;
      case 'started': if (!isStarted(e.c)) return false; break;
      case 'weak': if (!isStarted(e.c) || m >= 60) return false; break;
      case 'green': if (m < 90) return false; break;
      case 'writingWeak': if (!isStarted(e.c) || mWri >= 60 || mRec < 60) return false; break;
      case 'leech': if (!r.leech) return false; break;
      case 'suspended': if (!r.suspended) return false; break;
      default: break;
    }
    if (filter.q.trim()) {
      const q = filter.q.trim().toLowerCase();
      const hay = [e.c, ...e.m, ...e.on, ...e.kun].join(' ').toLowerCase();
      const kana = globalThis.wanakana ? globalThis.wanakana.toHiragana(q) : q;
      if (!hay.includes(q) && !hay.includes(kana)) return false;
    }
    return true;
  }

  function renderList() {
    clear(body);
    const all = data.entries().filter(matches);
    countLine.textContent = `${all.length} von ${data.entries().length} Zeichen`;
    if (!all.length) {
      body.append(h('div.card.center.mt', h('div.muted', 'Keine Treffer.')));
      return;
    }
    const byLevel = new Map();
    for (const e of all) {
      if (!byLevel.has(e.lv)) byLevel.set(e.lv, []);
      byLevel.get(e.lv).push(e);
    }
    for (const lv of [5, 4, 3, 2, 1, 0]) {
      const list = byLevel.get(lv);
      if (!list?.length) continue;
      const section = h('div.level-section');
      const green = list.filter((e) => charMastery(rec(e.c)) >= 90).length;
      const started = list.filter((e) => isStarted(e.c)).length;
      section.append(h('div.level-head',
        h('h2', LEVEL_NAME(lv)),
        h('span.muted', `${list.length} Zeichen · ${started} angefangen · ${green} grün`)));
      const g = h('div.kgrid');
      for (const e of list) {
        const r = rec(e.c);
        const mWri = mastery(r.tracks.writing);
        const mRec = mastery(r.tracks.recognition);
        g.append(kanjiCell(e.c, Math.min(mRec, mWri), {
          onclick: (c) => navigate(`/kanji/${encodeURIComponent(c)}`),
          onlong: (c) => quickActions(c, renderList),
          writingWeak: mRec >= 60 && mWri < 60,
          suspended: r.suspended,
          leech: r.leech,
        }));
      }
      section.append(g);
      body.append(section);
    }
  }

  sync();
  return wrap;
}

/**
 * Long-press / right-click menu. The seed list came from OCR, so being able to
 * correct a character's status directly in the grid matters.
 */
export function quickActions(char, onChange = () => {}) {
  const r = rec(char);
  const box = h('div');
  box.append(h('div.row',
    h('div.jp', { style: { fontSize: '42px' } }, char),
    h('div',
      h('div', data.shortMeaning(char, 4)),
      h('div.small.muted', `Erkennen ${mastery(r.tracks.recognition)} · Schreiben ${mastery(r.tracks.writing)}`))));

  const tiers = [
    ['mastery_3', 'Sicher (Erkennen 60 T)'],
    ['mastery_2', 'Gut (30 T)'],
    ['mastery_1', 'Wackelig (14 T)'],
    ['mastery_0', 'Angefangen (1 T)'],
  ];
  box.append(h('h3', 'Status setzen'));
  const tierRow = h('div.chips');
  for (const [tier, label] of tiers) {
    tierRow.append(h('button.pill', {
      onclick: async () => {
        const { touched } = applyTier([char], tier, { force: true });
        for (const t of touched) await saveRec(t);
        toast(`${char} auf „${label}" gesetzt`);
        onChange();
        close();
      },
    }, label));
  }
  box.append(tierRow);

  box.append(h('h3', 'Zurücksetzen'));
  box.append(h('div.chips',
    h('button.pill', {
      onclick: async () => {
        const { blankRecord } = await import('../store.js');
        const fresh = { ...blankRecord(char), note: r.note };
        await saveRec(fresh);
        toast(`${char} auf „neu" zurückgesetzt`);
        onChange(); close();
      },
    }, 'Als neu markieren')));

  let close = () => {};
  const m = modal({
    title: 'Schnellaktionen',
    body: box,
    actions: [
      { label: r.suspended ? 'Fortsetzen' : 'Aussetzen', onClick: async () => {
          await saveRec({ ...rec(char), suspended: !r.suspended });
          toast(r.suspended ? `${char} wieder aktiv` : `${char} ausgesetzt`);
          onChange();
        } },
      { label: 'Vorziehen', onClick: async () => { await queue.moveToFront(char); toast(`${char} nach vorne geholt`); onChange(); } },
      { label: 'Details', primary: true, onClick: () => navigate(`/kanji/${encodeURIComponent(char)}`) },
    ],
  });
  close = m.close;
  return m;
}
