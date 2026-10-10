/**
 * "Neu lernen": introduce the next batch from the queue, then drill it.
 *
 * Introduction shows the character, its animated stroke order, a free tracing
 * pad, readings/meanings, which components are already known, and example
 * words. Only afterwards does the drill start — and each character must be
 * correct twice per track before the batch is done.
 */

import { h, clear } from '../util.js';
import * as data from '../data.js';
import { isKnown, settings } from '../store.js';
import { animator } from '../stroke/kvg.js';
import { createPad } from '../stroke/pad.js';
import { buildNewSession, newAllowance } from '../session.js';
import { sessionScreen } from './session.js';
import { navigate } from '../router.js';
import { emptyState } from '../ui.js';
import { speak, audioAvailable } from '../audio.js';
import * as queue from '../queue.js';

export async function studyScreen() {
  const allow = await newAllowance();
  const root = h('div');

  if (allow.left === 0) {
    return emptyState(
      allow.gateOpen
        ? `Tageslimit erreicht — ${allow.doneToday} von ${allow.limit} neuen Zeichen heute.`
        : `Neue Zeichen sind gesperrt: ${allow.backlog} Reviews im Rückstand (Grenze ${settings.backlogGate}).`,
      'Zu den Reviews', () => navigate('/session/due'));
  }

  const { session, chars } = await buildNewSession();
  if (!chars.length) return emptyState('Die Warteschlange ist leer.', 'Zur Übersicht', () => navigate('/'));

  // Every new character must sit twice per track before the batch is finished.
  for (const c of session.cards) c.need = 2;

  let idx = 0;
  let cleanupIntro = null;

  async function showIntro() {
    cleanupIntro?.();
    clear(root);
    if (idx >= chars.length) return startDrill();
    const node = await introCard(chars[idx], {
      index: idx, total: chars.length,
      onNext: () => { idx += 1; showIntro(); },
      onBack: () => { idx = Math.max(0, idx - 1); showIntro(); },
    });
    cleanupIntro = node.cleanup;
    root.append(node);
  }

  function startDrill() {
    cleanupIntro?.();
    clear(root);
    const s = sessionScreen(session, { onExit: () => navigate('/') });
    root.append(s);
    root.cleanup = () => s.cleanup?.();
  }

  root.cleanup = () => cleanupIntro?.();
  await showIntro();
  return root;
}

async function introCard(char, { index, total, onNext, onBack }) {
  const e = data.entry(char);
  const st = await data.strokes(char);
  const words = await data.vocab(char);
  const wrap = h('div.wrap');
  const lesson = queue.currentLesson();

  wrap.append(h('div.spread',
    h('span.small.muted', `Einführung ${index + 1} von ${total}${lesson ? ` · Lektion ${lesson.n}` : ''}`),
    h('span.pill', e.lv ? `N${e.lv}` : 'ohne Stufe')));

  const animBox = h('div.detail-anim');
  wrap.append(h('div.card.mt',
    h('div.detail-char',
      animBox,
      h('div.grow',
        h('h2', data.shortMeaning(char, 6)),
        h('dl.kv',
          h('dt', 'On'), h('dd.jp-sans', e.on.join('・') || '—'),
          h('dt', 'Kun'), h('dd.jp-sans', e.kun.join('・') || '—'),
          h('dt', 'Striche'), h('dd', String(e.st ?? st?.s.length ?? '?')),
          h('dt', 'Radikal'), h('dd.jp', e.rad || '—'))))));

  let anim = null;
  if (st?.s.length) {
    anim = animator(animBox, st.s, { numbers: true, autoplay: true });
    wrap.append(h('div.row',
      h('button.btn.sm', { onclick: () => anim.play() }, '▶ Nochmal'),
      h('button.btn.sm', { onclick: () => anim.step() }, 'Strich für Strich'),
      h('button.btn.sm', { onclick: () => anim.showAll() }, 'Ganz')));
  } else {
    animBox.append(h('div.center', { style: { padding: '30% 8px' } },
      h('div.jp', { style: { fontSize: '54px' } }, char),
      h('div.pill.gap', 'keine Strichdaten')));
  }

  // known components
  const comps = e.comp.filter((c) => c !== char && data.has(c));
  const knownComps = comps.filter(isKnown);
  const compCard = h('div.card', h('h2', 'Bestandteile'));
  compCard.append(h('div.next-strip', comps.length
    ? comps.map((c) => h('div.kc.jp', { style: isKnown(c) ? { outline: '1.5px solid var(--ok)' } : null, title: data.shortMeaning(c) }, c))
    : [h('span.small.muted', 'KanjiVG listet keine weiteren Bestandteile.')]));
  if (knownComps.length) {
    const seen = [...new Set(knownComps.flatMap((kc) =>
      (data.componentIndex().get(kc) || []).filter((o) => o.c !== char && isKnown(o.c)).slice(0, 3).map((o) => o.c)))].slice(0, 8);
    compCard.append(h('div.small.muted.mt',
      `Schon bekannt: ${knownComps.join(' ')}`, seen.length ? ` — kennst du schon aus ${seen.join(' ')}` : ''));
  }
  wrap.append(compCard);

  // tracing pad (no grading — this is practice, not a test)
  let pad = null;
  if (st?.s.length) {
    const padCard = h('div.card', h('h2', 'Nachfahren'));
    pad = createPad({
      paths: st.s, mode: 'guided', tolerance: Math.max(1.4, settings.strokeTolerance * 1.4),
      showNumbers: true,
      onResult: () => {}, onFinish: () => {},
    });
    padCard.append(h('div.center', pad.el));
    padCard.append(h('div.row.mt',
      h('button.btn.sm', { onclick: () => pad.undo() }, 'Strich zurück'),
      h('button.btn.sm', { onclick: () => pad.clear() }, 'Leeren'),
      h('span.small.muted', 'Übung ohne Bewertung')));
    wrap.append(padCard);
  }

  if (words.length) {
    const vc = h('div.card', h('h2', 'Beispiele'));
    const known = words.filter((w) => w.k.every((k) => k === char || isKnown(k)));
    for (const w of [...known, ...words.filter((x) => !known.includes(x))].slice(0, 4)) {
      vc.append(h('div.vocab-item' + (known.includes(w) ? '' : '.unknown'),
        h('div.row',
          h('div.grow', h('span.w.jp', w.w), h('span.r.jp-sans', w.r), h('div.g', w.g.join(', '))),
          audioAvailable() ? h('button.btn.sm', { onclick: () => speak(w.w, { force: true }) }, '🔊') : null)));
    }
    wrap.append(vc);
  } else {
    wrap.append(h('div.card', h('h2', 'Beispiele'), h('div.pill.gap', 'Keine häufige Vokabel in JMdict')));
  }

  wrap.append(h('div.btn-grid.mt',
    index > 0 ? h('button.btn', { onclick: onBack }, '‹ Zurück') : null,
    h('button.btn.primary', { onclick: onNext }, index + 1 < total ? 'Nächstes Zeichen ›' : 'Übung starten ›')));

  wrap.cleanup = () => { anim?.destroy(); pad?.destroy(); };
  return wrap;
}
