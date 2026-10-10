/**
 * Runs a Session: picks the exercise for each card, shows it, collects the
 * grade, and finishes with a summary including the list of mistakes.
 */

import { h, clear, fmtInterval, fmtMs } from '../util.js';
import { getMode, MODE_LABEL } from '../modes/index.js';
import { GRADE, GRADE_LABEL, previewIntervals } from '../srs.js';
import { rec, settings } from '../store.js';
import { chooseMode } from '../session.js';
import * as data from '../data.js';
import { toast, modal } from '../ui.js';
import { navigate } from '../router.js';

const AUTO_ADVANCE_MS = 800;

export function sessionScreen(session, { onExit } = {}) {
  const root = h('div.sess');
  const bar = h('div.progbar', h('i'));
  const head = h('div.row', { style: { padding: '10px 14px 0' } });
  const body = h('div', { style: { flex: '1' } });
  const foot = h('div.sess-foot');
  root.append(bar, head, body, foot);

  let active = null;      // current mode instance
  let phase = 'ask';      // ask | grade | done
  let autoTimer = null;

  const counts = h('span.small.muted');
  const undoBtn = h('button.btn.sm', { onclick: () => doUndo() }, '↩ Undo');
  const quitBtn = h('button.btn.sm', { onclick: () => quit() }, 'Beenden');
  head.append(counts, h('div.grow'), undoBtn, quitBtn);

  function updateChrome() {
    const total = session.answered + session.remaining;
    bar.firstChild.style.width = `${total ? (session.answered / total) * 100 : 100}%`;
    const c = session.current();
    counts.textContent = c
      ? `${session.answered + 1} / ${total} · ${MODE_LABEL[c.mode] || ''}`
      : `${session.answered} / ${total}`;
    undoBtn.disabled = !session.canUndo;
  }

  async function step() {
    clearTimeout(autoTimer);
    active?.destroy?.();
    active = null;
    clear(body); clear(foot);
    phase = 'ask';

    const card = session.current();
    if (!card) return finish();

    if (!card.mode) {
      const words = await data.vocab(card.char);
      card.mode = chooseMode(card, words.length);
    }
    updateChrome();

    const mod = getMode(card.mode);
    const ctx = {
      char: card.char,
      card,
      entry: data.entry(card.char),
      record: rec(card.char),
      track: card.track,
      result: (res) => onResult(card, res),
    };
    session.startTimer();
    const inst = await mod.render(ctx);
    active = inst;
    body.append(inst.el);
    inst.focus?.();

    foot.append(h('div.small.muted', trackBadge(card)));
  }

  function onResult(card, res) {
    if (phase !== 'ask') return;
    phase = 'grade';
    clear(foot);
    if (res.reveal) foot.append(res.reveal);

    const t = rec(card.char).tracks[card.track];
    const previews = previewIntervals(t);

    const commit = (g) => {
      clearTimeout(autoTimer);
      if (phase !== 'grade') return;
      phase = 'ask';
      session.grade(g, { ...res.extra, mode: card.mode }).then(step);
    };

    if (res.correct === false || res.forceGrade === GRADE.AGAIN) {
      const btn = h('button.btn.primary.wide', { onclick: () => commit(GRADE.AGAIN) },
        `Weiter — ${GRADE_LABEL[0]} (${fmtInterval(previews[0].interval)})`);
      foot.append(btn);
      foot.append(h('div.small.muted', 'Leertaste'));
      pendingCommit = commit;
      pendingKeys = { ' ': GRADE.AGAIN, Enter: GRADE.AGAIN };
      btn.focus?.();
      return;
    }

    const grades = res.correct === null ? [0, 1, 2, 3] : [1, 2, 3];
    const panel = h('div.grades', { style: { gridTemplateColumns: `repeat(${grades.length}, 1fr)` } });
    grades.forEach((g) => {
      const p = previews[g];
      const b = h(`button.grade`, { dataset: { g: String(g) }, onclick: () => commit(g) },
        h('span', GRADE_LABEL[g]),
        h('small', p.sameDay ? 'heute schon geübt' : fmtInterval(p.interval)));
      panel.append(b);
    });
    foot.append(panel);

    pendingCommit = commit;
    pendingKeys = grades.reduce((m, g, i) => ({ ...m, [String(i + 1)]: g }), {});
    if (res.correct === true) {
      pendingKeys[' '] = GRADE.GOOD;
      if (settings.autoAdvance !== false) {
        autoTimer = setTimeout(() => commit(GRADE.GOOD), AUTO_ADVANCE_MS);
        foot.append(h('div.small.muted', 'Richtig — wird automatisch als „Gut" gewertet'));
      } else {
        foot.append(h('div.small.muted', 'Richtig — Bewertung wählen (Leertaste = Gut)'));
      }
    } else {
      foot.append(h('div.small.muted', 'Selbst bewerten — Tasten 1–4'));
    }
  }

  let pendingCommit = null;
  let pendingKeys = {};

  async function doUndo() {
    clearTimeout(autoTimer);
    if (await session.undo()) { toast('Letzte Bewertung zurückgenommen'); step(); }
  }

  function quit() {
    if (session.answered === 0) return leave();
    modal({
      title: 'Session beenden?',
      body: h('div', `${session.answered} Karten bewertet. Der Fortschritt ist bereits gespeichert.`),
      actions: [
        { label: 'Weiter üben' },
        { label: 'Beenden', primary: true, onClick: () => finish(true) },
      ],
    });
  }

  function leave() {
    active?.destroy?.();
    onExit ? onExit() : navigate('/');
  }

  function finish(early = false) {
    clearTimeout(autoTimer);
    active?.destroy?.();
    active = null;
    phase = 'done';
    clear(body); clear(foot); clear(head);
    bar.firstChild.style.width = '100%';
    body.append(summaryView(session, { early, onExit: leave }));
  }

  function onKey(ev) {
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (ev.key === '?') { showHelp(); ev.preventDefault(); return; }
    const tag = document.activeElement?.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA';
    if (phase === 'ask') {
      if (active?.onKey?.(ev)) ev.preventDefault();
      return;
    }
    if (phase === 'grade') {
      if (typing && ev.key !== 'Enter' && ev.key !== ' ') return;
      const g = pendingKeys[ev.key];
      if (g != null) { pendingCommit?.(g); ev.preventDefault(); }
    }
  }
  document.addEventListener('keydown', onKey);

  root.cleanup = () => {
    document.removeEventListener('keydown', onKey);
    clearTimeout(autoTimer);
    active?.destroy?.();
  };

  step();
  return root;
}

function trackBadge(card) {
  const t = card.track === 'writing' ? 'Schreiben' : 'Erkennen';
  const k = card.relearn ? ' · Wiederholung in dieser Session' : card.kind === 'new' ? ' · neu' : '';
  return `${t}${k}`;
}

function showHelp() {
  modal({
    title: 'Tastatur',
    body: h('div.kv',
      h('dt', h('kbd', '1'), '–', h('kbd', '4')), h('dd', 'Antwort wählen bzw. bewerten'),
      h('dt', h('kbd', 'Leertaste')), h('dd', 'Weiter / „Gut"'),
      h('dt', h('kbd', 'Enter')), h('dd', 'Prüfen bzw. auflösen'),
      h('dt', h('kbd', 'Z')), h('dd', 'Letzten Strich zurücknehmen'),
      h('dt', h('kbd', '?')), h('dd', 'Diese Hilfe')),
    actions: [{ label: 'Schließen', primary: true }],
  });
}

// ---------------------------------------------------------------------------

export function summaryView(session, { early = false, onExit } = {}) {
  const s = session.summary();
  const wrap = h('div.wrap');
  wrap.append(h('div.card',
    h('h2', early ? 'Session beendet' : 'Session abgeschlossen'),
    h('div.stat-line',
      stat(s.answered, 'Karten'),
      stat(`${Math.round(s.accuracy * 100)} %`, 'richtig'),
      stat(fmtDuration(s.seconds), 'Dauer'),
      stat(s.answered ? fmtMs(Math.round((s.seconds * 1000) / s.answered)) : '—', 'pro Karte'),
      s.strokeOrderErrors ? stat(s.strokeOrderErrors, 'Strichordnungsfehler') : null)));

  if (s.errors.length) {
    const list = h('div.card', h('h2', `Fehlerliste (${s.errors.length})`));
    for (const e of s.errors) {
      list.append(h('div.qrow',
        h('div.kc.jp', e.char),
        h('div.mn',
          h('div', data.shortMeaning(e.char, 3)),
          h('div.small.muted', `${e.track === 'writing' ? 'Schreiben' : 'Erkennen'} · ${MODE_LABEL[e.mode] || ''}${e.n > 1 ? ` · ${e.n}×` : ''}${e.extra?.strokeOrderErrors ? ` · ${e.extra.strokeOrderErrors}× Reihenfolge` : ''}`)),
        h('button.btn.sm', { onclick: () => navigate(`/kanji/${encodeURIComponent(e.char)}`) }, 'Details')));
    }
    wrap.append(list);
  } else if (s.answered) {
    wrap.append(h('div.card.center', h('div.muted', 'Keine Fehler in dieser Session.')));
  }

  wrap.append(h('div.btn-grid.mt',
    h('button.btn.primary', { onclick: onExit }, 'Fertig'),
    s.errors.length
      ? h('button.btn', { onclick: () => navigate(`/custom?chars=${encodeURIComponent(s.errors.map((e) => e.char).join(''))}`) }, 'Fehler gezielt üben')
      : null));
  return wrap;
}

const stat = (v, l) => (v == null ? null : h('div.stat', h('b', String(v)), h('span', l)));

function fmtDuration(sec) {
  if (sec < 60) return `${sec} s`;
  const m = Math.floor(sec / 60);
  return `${m}:${String(sec % 60).padStart(2, '0')} min`;
}
