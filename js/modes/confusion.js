/**
 * Confusion drill: the target is shown as meaning + reading and must be picked
 * out of the characters it actually gets mixed up with.
 */

import { h } from '../util.js';
import * as data from '../data.js';
import { confusionPartners, recordConfusion } from '../confusion.js';
import { similarChars } from '../distractors.js';
import { shuffle, uniq } from '../util.js';
import { readings } from './recognitionMC.js';

export const id = 'confusion';
export const track = 'recognition';
export const label = 'Verwechslungs-Drill';

export async function render(ctx) {
  const { char } = ctx;
  const e = data.entry(char);
  let partners = confusionPartners(char);
  if (partners.length < 2) partners = uniq([...partners, ...similarChars(char, 3 - partners.length)]);
  const options = shuffle(uniq([char, ...partners.slice(0, 3)]));

  const el = h('div.sess-body');
  el.append(
    h('div.pill', 'Verwechslungs-Drill'),
    h('div.prompt-sub', { style: { fontSize: '21px', color: 'var(--fg)' } }, data.shortMeaning(char, 3)),
    h('div.prompt-sub.small.jp-sans', readings(e)),
  );

  const grid = h('div.choices');
  const buttons = [];
  options.forEach((oc) => {
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
      reveal: h('div.card', options.map((oc2) =>
        h('div.row', { style: { padding: '4px 0' } },
          h('div.jp', { style: { fontSize: '30px', width: '44px', opacity: oc2 === char ? 1 : .65 } }, oc2),
          h('div.small', h('b', data.shortMeaning(oc2, 3)), h('div.muted.jp-sans', readings(data.entry(oc2))))))),
    });
  }

  return {
    el,
    onKey(ev) {
      const n = Number(ev.key);
      if (n >= 1 && n <= options.length) { buttons[n - 1].click(); return true; }
      return false;
    },
  };
}
