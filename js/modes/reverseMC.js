// Meaning (+ reading) -> kanji, four options.

import { h } from '../util.js';
import * as data from '../data.js';
import { charOptions } from '../distractors.js';
import { recordConfusion } from '../confusion.js';
import { readings } from './recognitionMC.js';

export const id = 'reverseMC';
export const track = 'recognition';
export const label = 'Zeichen finden';

export async function render(ctx) {
  const { char } = ctx;
  const e = data.entry(char);
  const options = charOptions(char, 4);
  const el = h('div.sess-body');
  el.append(
    h('div.prompt-sub.mt', { style: { fontSize: '22px', color: 'var(--fg)' } }, data.shortMeaning(char, 3)),
    h('div.prompt-sub.small.jp-sans', readings(e)),
    h('div.prompt-sub.small.muted', 'Welches Zeichen ist das?')
  );

  const grid = h('div.choices');
  const buttons = [];
  options.forEach((oc, i) => {
    const b = h('button.choice.big.jp', { type: 'button' }, oc);
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
      reveal: correct ? null : h('div.card',
        h('div.row', h('div.jp', { style: { fontSize: '38px' } }, char), h('div.small.muted', readings(e))),
        h('div.small.muted.mt', 'gewählt: ', h('span.jp', { style: { fontSize: '22px' } }, oc), ' — ', data.shortMeaning(oc, 3))),
    });
  }

  return {
    el,
    onKey(e2) {
      const n = Number(e2.key);
      if (n >= 1 && n <= options.length) { buttons[n - 1].click(); return true; }
      return false;
    },
  };
}
