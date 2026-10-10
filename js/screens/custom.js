// Custom review: pick exactly what to practise.

import { h, clear } from '../util.js';
import * as data from '../data.js';
import { rec, allRecords, isStarted } from '../store.js';
import { mastery } from '../srs.js';
import { buildCustomSession } from '../session.js';
import { setPendingSession } from '../app-state.js';
import { navigate } from '../router.js';
import { toast, segmented } from '../ui.js';
import { isDue } from '../srs.js';
import * as queue from '../queue.js';

export async function customScreen({ query }) {
  const wrap = h('div.wrap');
  const state = {
    level: null,
    status: 'all',
    tracks: ['both', 'recognition', 'writing'].includes(query.tracks) ? query.tracks : 'both',
    mode: query.mode || 'auto',
    limit: Number(query.limit) || 30,
    onlyDue: false,
    chars: query.chars || '',
    lesson: '',
  };

  const preview = h('div.card.mt');

  // --- source ---------------------------------------------------------------
  const charsInput = h('textarea', { placeholder: 'Zeichen hier einfügen, z. B. 熱費静 …' });
  charsInput.value = state.chars;
  charsInput.addEventListener('input', () => { state.chars = charsInput.value; update(); });

  const levelSel = h('select',
    h('option', { value: '' }, 'Alle Stufen'),
    [5, 4, 3, 2, 1, 0].map((lv) => h('option', { value: String(lv) }, lv === 0 ? 'Ohne Stufe' : `JLPT N${lv}`)));
  levelSel.addEventListener('change', () => { state.level = levelSel.value === '' ? null : Number(levelSel.value); update(); });

  const statusSel = h('select',
    h('option', { value: 'all' }, 'Alle angefangenen'),
    h('option', { value: 'weak' }, 'Schwach (< 60)'),
    h('option', { value: 'writingWeak' }, 'Nur Schreiben schwach'),
    h('option', { value: 'green' }, 'Grün (≥ 90)'),
    h('option', { value: 'leech' }, 'Leeches'),
    h('option', { value: 'new' }, 'Noch nicht angefangen'));
  statusSel.addEventListener('change', () => { state.status = statusSel.value; update(); });

  const lessonSel = h('select', h('option', { value: '' }, 'Keine Lektion'));
  for (const l of queue.lessons().slice(0, 60)) {
    lessonSel.append(h('option', { value: String(l.n) }, `Lektion ${l.n} (${l.chars.join('')})`));
  }
  lessonSel.addEventListener('change', () => { state.lesson = lessonSel.value; update(); });

  wrap.append(h('div.card',
    h('h2', 'Auswahl'),
    h('label.field', h('span', 'Zeichenliste (überschreibt die Filter)'), charsInput),
    h('label.field', h('span', 'JLPT-Stufe'), levelSel),
    h('label.field', h('span', 'Status'), statusSel),
    h('label.field', h('span', 'Lektion'), lessonSel)));

  // --- what to practise -----------------------------------------------------
  const limitInput = h('input', { type: 'number', min: '1', max: '300', value: String(state.limit) });
  limitInput.addEventListener('input', () => { state.limit = Math.max(1, Number(limitInput.value) || 1); update(); });

  const dueBox = h('input', { type: 'checkbox' });
  dueBox.addEventListener('change', () => { state.onlyDue = dueBox.checked; update(); });

  const modeSel = h('select',
    h('option', { value: 'auto' }, 'Automatisch (gemischt)'),
    h('option', { value: 'recognitionMC' }, 'Bedeutung erkennen'),
    h('option', { value: 'reverseMC' }, 'Zeichen finden'),
    h('option', { value: 'reading' }, 'Lesung tippen'),
    h('option', { value: 'writingGuided' }, 'Schreiben (geführt)'),
    h('option', { value: 'writingBlind' }, 'Schreiben (blind)'),
    h('option', { value: 'confusion' }, 'Verwechslungs-Drill'));
  modeSel.value = state.mode;
  modeSel.addEventListener('change', () => {
    state.mode = modeSel.value;
    if (state.mode.startsWith('writing')) { state.tracks = 'writing'; syncTracks(); }
    else if (state.mode !== 'auto') { state.tracks = 'recognition'; syncTracks(); }
    update();
  });

  const trackWrap = h('div');
  function syncTracks() {
    clear(trackWrap);
    trackWrap.append(segmented([
      { value: 'both', label: 'Beides' },
      { value: 'recognition', label: 'Nur Erkennen' },
      { value: 'writing', label: 'Nur Schreiben' },
    ], state.tracks, (v) => { state.tracks = v; update(); }));
  }
  syncTracks();

  wrap.append(h('div.card',
    h('h2', 'Übung'),
    h('label.field', h('span', 'Tracks'), trackWrap),
    h('label.field', h('span', 'Modus'), modeSel),
    h('label.field', h('span', 'Anzahl Karten'), limitInput),
    h('label.field', h('span', h('span.row', dueBox, ' Nur fällige Karten')))));

  wrap.append(preview);

  function selectedChars() {
    if (state.chars.trim()) {
      return [...new Set([...state.chars].filter((c) => data.has(c)))];
    }
    if (state.lesson) {
      const l = queue.lessons().find((x) => String(x.n) === state.lesson);
      return l ? l.chars : [];
    }
    let pool = data.entries();
    if (state.level !== null) pool = pool.filter((e) => e.lv === state.level);
    return pool.filter((e) => {
      const r = rec(e.c);
      const mR = mastery(r.tracks.recognition);
      const mW = mastery(r.tracks.writing);
      if (r.suspended) return false;
      switch (state.status) {
        case 'weak': return isStarted(e.c) && Math.min(mR, mW) < 60;
        case 'writingWeak': return isStarted(e.c) && mW < 60 && mR >= 60;
        case 'green': return Math.min(mR, mW) >= 90;
        case 'leech': return r.leech;
        case 'new': return !isStarted(e.c);
        default: return isStarted(e.c);
      }
    }).map((e) => e.c);
  }

  function update() {
    const chars = selectedChars();
    clear(preview);
    preview.append(h('h2', 'Vorschau'));
    preview.append(h('div.small.muted', `${chars.length} Zeichen ausgewählt`));
    if (chars.length) {
      preview.append(h('div.next-strip.mt', chars.slice(0, 24).map((c) => h('div.kc.jp', c))));
      if (chars.length > 24) preview.append(h('div.small.muted.mt', `… und ${chars.length - 24} weitere`));
    }
    if (state.chars.trim()) {
      const unknown = [...new Set([...state.chars].filter((c) => /\p{Script=Han}/u.test(c) && !data.has(c)))];
      if (unknown.length) preview.append(h('div.pill.gap.mt', `${unknown.length} unbekannt: ${unknown.join(' ')}`));
    }
    preview.append(h('button.btn.primary.wide.mt', {
      disabled: chars.length === 0,
      onclick: () => start(chars),
    }, 'Session starten'));
  }

  async function start(chars) {
    const tracks = state.tracks === 'both' ? ['recognition', 'writing'] : [state.tracks];
    const session = await buildCustomSession({
      chars, tracks, limit: state.limit, onlyDue: state.onlyDue,
      forceMode: state.mode === 'auto' ? null : state.mode,
    });
    if (!session.cards.length) { toast('Keine passenden Karten — Filter lockern.', { bad: true }); return; }
    setPendingSession(session);
    navigate('/session/custom');
  }

  update();
  if (query.go === '1' && state.chars.trim()) setTimeout(() => start(selectedChars()), 0);
  return wrap;
}
