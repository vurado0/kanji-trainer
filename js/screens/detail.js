/**
 * Kanji detail: animated stroke order, component breakdown, readings, example
 * words, personal mnemonic and the state of both SRS tracks.
 */

import { h, clear, fmtDue, fmtInterval, fmtDate, LEVEL_NAME, masteryColor } from '../util.js';
import * as data from '../data.js';
import { rec, saveRec, isKnown, settings } from '../store.js';
import { mastery, isGreen } from '../srs.js';
import { animator, buildGlyph } from '../stroke/kvg.js';
import { navigate } from '../router.js';
import { toast } from '../ui.js';
import { speak, audioAvailable } from '../audio.js';
import * as queue from '../queue.js';
import { quickActions } from './grid.js';

export async function detailScreen({ params }) {
  const char = params.char;
  const e = data.entry(char);
  const wrap = h('div.wrap');
  if (!e) {
    wrap.append(h('div.card', h('h2', 'Unbekanntes Zeichen'),
      h('div.muted', `„${char}" ist in den vendorten Datenquellen nicht enthalten.`)));
    return wrap;
  }

  const r = rec(char);
  const st = await data.strokes(char);
  const words = await data.vocab(char);

  // --- header --------------------------------------------------------------
  const animBox = h('div.detail-anim');
  const head = h('div.card');
  head.append(h('div.detail-char',
    animBox,
    h('div.grow',
      h('div.row.wrap-r',
        h('span.pill', LEVEL_NAME(e.lv)),
        h('span.pill', `${e.st ?? st?.s.length ?? '?'} Striche`),
        e.fq ? h('span.pill', `Häufigkeit #${e.fq}`) : h('span.pill.gap', 'kein Häufigkeitsrang'),
        r.leech ? h('span.pill.gap', 'Leech') : null,
        r.suspended ? h('span.pill.gap', 'ausgesetzt') : null),
      h('h2.mt', data.shortMeaning(char, 8)),
      h('dl.kv',
        h('dt', 'On'), h('dd.jp-sans', e.on.length ? e.on.join('・') : '—'),
        h('dt', 'Kun'), h('dd.jp-sans', e.kun.length ? e.kun.join('・') : '—'),
        h('dt', 'Radikal'), h('dd.jp', e.rad || '—')))));

  const ctl = h('div.row.mt');
  head.append(ctl);
  wrap.append(head);

  if (st?.s.length) {
    const anim = animator(animBox, st.s, { numbers: settings.showStrokeNumbers, autoplay: true });
    const label = h('span.small.muted');
    const upd = (i, n) => { label.textContent = `Strich ${i} / ${n}`; };
    anim.onChange(upd);
    upd(0, st.s.length);
    ctl.append(
      h('button.btn.sm', { onclick: () => anim.play() }, '▶ Abspielen'),
      h('button.btn.sm', { onclick: () => anim.stepBack() }, '‹'),
      h('button.btn.sm', { onclick: () => anim.step() }, '›'),
      h('button.btn.sm', { onclick: () => anim.showAll() }, 'Ganz'),
      h('button.btn.sm', { onclick: () => anim.reset() }, 'Zurück'),
      label);
    wrap.cleanup = () => anim.destroy();

    // per-stroke thumbnails
    const strip = h('div.stroke-strip.mt');
    st.s.forEach((_, i) => {
      const box = h('div.sv');
      const { el } = buildGlyph(st.s.slice(0, i + 1), { cls: 'outline' });
      const { el: el2 } = buildGlyph([st.s[i]], { cls: 'done' });
      for (const p of el2.children) el.append(p.cloneNode(true));
      box.append(el);
      strip.append(box);
    });
    head.append(h('h3', 'Striche einzeln'), strip);
  } else {
    animBox.append(h('div.center', { style: { padding: '30% 8px' } },
      h('div.jp', { style: { fontSize: '54px' } }, char),
      h('div.pill.gap', 'keine Strichdaten')));
  }

  // --- components ----------------------------------------------------------
  const comps = e.comp.filter((c) => c !== char);
  const compCard = h('div.card', h('h2', 'Bestandteile'));
  if (comps.length) {
    const row = h('div.next-strip');
    for (const c of comps) {
      const known = data.has(c);
      const b = h('button.kc.jp', {
        title: known ? data.shortMeaning(c) : 'nicht in der Zeichenliste',
        style: known && isKnown(c) ? { outline: '1.5px solid var(--ok)' } : null,
        onclick: () => known && navigate(`/kanji/${encodeURIComponent(c)}`),
      }, c);
      row.append(b);
    }
    compCard.append(row);
    const knownComps = comps.filter((c) => data.has(c) && isKnown(c));
    if (knownComps.length) {
      const others = knownComps.flatMap((kc) => (data.componentIndex().get(kc) || [])
        .filter((o) => o.c !== char && isKnown(o.c)).slice(0, 4).map((o) => o.c));
      const uniqOthers = [...new Set(others)].slice(0, 8);
      compCard.append(h('div.small.muted.mt',
        `Bereits bekannt: ${knownComps.join(' ')}`,
        uniqOthers.length ? ` — kennst du schon aus ${uniqOthers.join(' ')}` : ''));
    } else {
      compCard.append(h('div.small.muted.mt', 'Noch keine dieser Komponenten gelernt.'));
    }
  } else {
    compCard.append(h('div.small.muted', 'KanjiVG listet keine weiteren Bestandteile.'));
  }
  wrap.append(compCard);

  // --- vocabulary ----------------------------------------------------------
  const vCard = h('div.card', h('h2', 'Beispielvokabeln'));
  if (!words.length) {
    vCard.append(h('div.pill.gap', 'Keine häufige Vokabel in JMdict (common)'));
  } else {
    const known = words.filter((w) => w.k.every((k) => k === char || isKnown(k)));
    const rest = words.filter((w) => !known.includes(w));
    const list = [...known, ...rest].slice(0, 6);
    for (const w of list) {
      const isKnownWord = known.includes(w);
      const item = h(`div.vocab-item${isKnownWord ? '' : '.unknown'}`,
        h('div.row',
          h('div.grow',
            h('span.w.jp', w.w), h('span.r.jp-sans', w.r),
            h('div.g', w.g.join(', ')),
            !isKnownWord ? h('div.small.muted', `enthält noch nicht gelernte Zeichen: ${w.k.filter((k) => k !== char && !isKnown(k)).join(' ')}`) : null),
          audioAvailable() ? h('button.btn.sm', { onclick: () => speak(w.w, { force: true }) }, '🔊') : null));
      vCard.append(item);
    }
  }
  wrap.append(vCard);

  // --- SRS status ----------------------------------------------------------
  wrap.append(h('div.card',
    h('h2', 'Lernstand'),
    trackTable(r, 'recognition', 'Erkennen'),
    trackTable(r, 'writing', 'Schreiben')));

  // --- note ----------------------------------------------------------------
  const note = h('textarea', { placeholder: 'Eigenes Mnemonic / Eselsbrücke …' });
  note.value = r.note || '';
  let saveTimer = null;
  note.addEventListener('input', () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      await saveRec({ ...rec(char), note: note.value });
      toast('Notiz gespeichert');
    }, 700);
  });
  wrap.append(h('div.card', h('h2', 'Notiz / Mnemonic'), note));

  // --- actions -------------------------------------------------------------
  const qpos = queue.position(char);
  wrap.append(h('div.card',
    h('div.btn-grid',
      h('button.btn.primary', { onclick: () => navigate(`/custom?chars=${encodeURIComponent(char)}&go=1`) }, 'Jetzt üben'),
      h('button.btn', { onclick: () => navigate(`/custom?chars=${encodeURIComponent(char)}&tracks=writing&go=1`) }, 'Nur schreiben'),
      h('button.btn', { onclick: () => quickActions(char, () => navigate(`/kanji/${encodeURIComponent(char)}`)) }, 'Status ändern')),
    qpos.index >= 0
      ? h('div.small.muted.mt', `Warteschlange: Position ${qpos.index + 1} von ${qpos.total}`)
      : h('div.small.muted.mt', 'Nicht mehr in der Lern-Warteschlange.')));

  return wrap;
}

function trackTable(r, key, label) {
  const t = r.tracks[key];
  const m = mastery(t);
  const bar = h('div', {
    style: {
      height: '8px', borderRadius: '4px', background: 'var(--bg-4)',
      overflow: 'hidden', margin: '6px 0 8px',
    },
  }, h('div', { style: { height: '100%', width: `${m}%`, background: masteryColor(m) } }));

  const STATE = { new: 'neu', learning: 'im Lernen', review: 'Wiederholung', relearning: 'Neu lernen nach Fehler' };
  return h('div', { style: { marginTop: '10px' } },
    h('div.spread', h('b', label), h('span.small.muted', `${m}/100${isGreen(t) ? ' · grün' : ''}`)),
    bar,
    h('dl.kv',
      h('dt', 'Status'), h('dd', STATE[t.state] || t.state),
      h('dt', 'Fällig'), h('dd', t.due ? `${fmtDue(t.due)} (${fmtDate(t.due)})` : '—'),
      h('dt', 'Intervall'), h('dd', fmtInterval(t.interval)),
      h('dt', 'Serie'), h('dd', `${t.streak} · ${new Set(t.days).size} verschiedene Tage`),
      h('dt', 'Wiederholungen'), h('dd', `${t.reps} · ${t.lapses} Fehler`),
      h('dt', 'Ease'), h('dd', t.ease.toFixed(2))));
}
