/**
 * Writing modes.
 *
 * guided — the outline is shown and every stroke is validated as it is drawn.
 *          Three failed attempts on one stroke animate that stroke as a hint and
 *          force the grade down to "Nochmal". Strokes drawn out of order are
 *          accepted but marked, counted, and logged separately.
 * blind  — empty field with guide lines only. The user draws the whole
 *          character from memory, then reveals an overlay of the correct glyph
 *          and grades themselves; the stroke sequence is still analysed so
 *          stroke-order statistics keep working.
 */

import { h } from '../util.js';
import * as data from '../data.js';
import { settings } from '../store.js';
import { createPad } from '../stroke/pad.js';
import { readings } from './recognitionMC.js';
import { GRADE } from '../srs.js';

export const track = 'writing';

export async function renderWriting(ctx, mode) {
  const { char } = ctx;
  const st = await data.strokes(char);
  const e = data.entry(char);
  const el = h('div.sess-body');

  if (!st || !st.s.length) {
    // KanjiVG has no glyph for this character — show the gap instead of faking it.
    el.append(
      h('div.pill.gap', 'Keine Strichdaten in KanjiVG für dieses Zeichen'),
      h('div.prompt-kanji.jp', char),
      h('div.prompt-sub.small', 'Bitte auf Papier schreiben und selbst bewerten.')
    );
    ctx.result({ correct: null, extra: { mode, strokeDataMissing: true } });
    return { el };
  }

  const guided = mode === 'writingGuided';
  el.append(
    h('div.prompt-sub', { style: { fontSize: '20px', color: 'var(--fg)' } }, data.shortMeaning(char, 3)),
    h('div.prompt-sub.small.jp-sans', readings(e)),
    h('div.prompt-sub.small.muted', guided ? 'Zeichen schreiben — Striche werden geprüft' : 'Aus dem Kopf schreiben, dann auflösen')
  );

  const status = h('div.small.muted', guided ? `Strich 1 von ${st.s.length}` : `${st.s.length} Striche`);
  let finished = false;

  const pad = createPad({
    paths: st.s,
    mode: guided ? 'guided' : 'blind',
    tolerance: settings.strokeTolerance,
    showNumbers: guided && settings.showStrokeNumbers,
    onResult: (r) => {
      if (guided) {
        if (r.kind === 'order') status.textContent = `Strich in falscher Reihenfolge — Strich ${r.index + 1} statt ${r.expected + 1}`;
        else if (r.kind === 'reversed') status.textContent = 'Richtung umgekehrt — von der anderen Seite beginnen';
        else if (r.kind === 'miss') status.textContent = `Strich ${r.expected + 1} nicht erkannt (${r.attempts}/3)`;
        else if (r.kind === 'hint') status.textContent = `Hinweis: Strich ${r.index + 1} wird gezeigt — Bewertung: Nochmal`;
        else status.textContent = `Strich ${Math.min(st.s.length, r.accepted + 1)} von ${st.s.length}`;
      } else {
        status.textContent = `${r.strokeCount} Striche gezeichnet`;
      }
    },
    onFinish: (sum) => {
      if (!guided || finished) return;
      finished = true;
      done(sum);
    },
  });

  el.append(pad.el, status);

  const tools = h('div.row.mt');
  tools.append(
    h('button.btn.sm', { onclick: () => pad.undo() }, 'Strich zurück (Z)'),
    h('button.btn.sm', { onclick: () => pad.clear() }, 'Leeren')
  );
  if (!guided) {
    tools.append(h('button.btn.sm.primary', { onclick: () => revealNow() }, 'Auflösen'));
  }
  el.append(tools);

  function done(sum) {
    const detail = [];
    if (sum.orderErrors) detail.push(`${sum.orderErrors}× falsche Strichreihenfolge`);
    if (sum.hintsUsed) detail.push(`${sum.hintsUsed}× Hinweis genutzt`);
    if (sum.misses) detail.push(`${sum.misses} nicht erkannte Versuche`);
    ctx.result({
      correct: sum.forcedAgain ? false : true,
      forceGrade: sum.forcedAgain ? GRADE.AGAIN : null,
      extra: { mode, strokeOrderErrors: sum.orderErrors, hintsUsed: sum.hintsUsed, misses: sum.misses },
      reveal: detail.length
        ? h('div.card', h('b', 'Fehler in diesem Zeichen'), h('ul', { style: { margin: '6px 0 0 18px' } }, detail.map((d) => h('li', d))))
        : null,
    });
  }

  function revealNow() {
    if (finished) return;
    finished = true;
    const a = pad.reveal();
    const notes = [];
    if (a.countMismatch !== 0) {
      notes.push(`${Math.abs(a.countMismatch)} Striche ${a.countMismatch > 0 ? 'zu viel' : 'zu wenig'} (Soll: ${st.s.length})`);
    }
    if (a.orderErrors) notes.push(`${a.orderErrors}× Strichreihenfolge vertauscht (orange markiert)`);
    if (a.unmatched) notes.push(`${a.unmatched} Striche nicht zuordenbar`);
    status.textContent = notes.length ? notes.join(' · ') : 'Strichreihenfolge sauber';
    tools.replaceChildren();
    ctx.result({
      correct: null, // self-graded
      extra: { mode, strokeOrderErrors: a.orderErrors, drawn: a.drawn, missing: a.missing.length },
      reveal: h('div.card',
        h('b', 'Vergleich'),
        h('div.small.muted', notes.length ? notes.join(' · ') : 'Reihenfolge und Strichzahl stimmen.'),
        h('div.small.muted.mt', 'Weiß = richtig platziert, orange = in falscher Reihenfolge gezeichnet.')),
    });
  }

  return {
    el,
    focus: () => pad.el.focus?.(),
    onKey(ev) {
      if (ev.key === 'z' || ev.key === 'Z') { pad.undo(); return true; }
      if (ev.key === 'Enter' && !guided && !finished) { revealNow(); return true; }
      return false;
    },
    destroy: () => pad.destroy(),
  };
}

export const guided = {
  id: 'writingGuided', track, label: 'Schreiben (geführt)',
  render: (ctx) => renderWriting(ctx, 'writingGuided'),
};
export const blind = {
  id: 'writingBlind', track, label: 'Schreiben (blind)',
  render: (ctx) => renderWriting(ctx, 'writingBlind'),
};
