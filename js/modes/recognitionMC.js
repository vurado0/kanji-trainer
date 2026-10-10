// Kanji -> meaning, four options. Distractors come from js/distractors.js.

import { h } from '../util.js';
import * as data from '../data.js';
import { meaningOptions } from '../distractors.js';
import { recordConfusion } from '../confusion.js';

export const id = 'recognitionMC';
export const track = 'recognition';
export const label = 'Bedeutung erkennen';

export async function render(ctx) {
  const { char } = ctx;
  const options = meaningOptions(char, 4);
  const el = h('div.sess-body');
  el.append(
    h('div.prompt-kanji.jp', char),
    h('div.prompt-sub.small', 'Welche Bedeutung?')
  );

  const grid = h('div.choices');
  const buttons = [];
  options.forEach((oc, i) => {
    const b = h('button.choice', { type: 'button' },
      h('span.num', String(i + 1)),
      h('span', data.shortMeaning(oc, 3)));
    b.addEventListener('click', () => choose(oc, b));
    buttons.push(b);
    grid.append(b);
  });
  el.append(grid);

  let answered = false;
  async function choose(oc, btn) {
    if (answered) return;
    answered = true;
    const correct = oc === char;
    buttons.forEach((b, i) => {
      if (options[i] === char) b.classList.add('right');
      else if (b === btn && !correct) b.classList.add('wrong');
      b.disabled = true;
    });
    if (!correct) await recordConfusion(char, oc);
    ctx.result({
      correct,
      extra: { mode: id, chosen: oc },
      reveal: correct ? null : revealNode(char, oc),
    });
  }

  return {
    el,
    onKey(e) {
      const n = Number(e.key);
      if (n >= 1 && n <= options.length) { buttons[n - 1].click(); return true; }
      return false;
    },
  };
}

function revealNode(char, chosen) {
  const e = data.entry(char);
  const w = data.entry(chosen);
  return h('div.card',
    h('div.row', h('div.jp', { style: { fontSize: '38px' } }, char), h('div', h('b', data.shortMeaning(char, 4)), h('div.small.muted', readings(e)))),
    w && h('div.row.mt', h('div.jp', { style: { fontSize: '30px', opacity: .7 } }, chosen),
      h('div.small.muted', 'gewählt: ', data.shortMeaning(chosen, 3), ' — ', readings(w)))
  );
}

export const readings = (e) =>
  [e.on.length ? `On ${e.on.join('・')}` : null, e.kun.length ? `Kun ${e.kun.join('・')}` : null]
    .filter(Boolean).join('   ');
