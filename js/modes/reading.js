/**
 * Vocabulary in context -> type the reading in kana.
 * Input goes through WanaKana, so romaji typing produces hiragana directly.
 */

import { h } from '../util.js';
import * as data from '../data.js';
import { isKnown, settings } from '../store.js';
import { speak } from '../audio.js';

export const id = 'reading';
export const track = 'recognition';
export const label = 'Lesung tippen';

const wk = () => globalThis.wanakana;
const toHira = (s) => (wk() ? wk().toHiragana(String(s), { passRomaji: false }) : String(s));
const norm = (s) => toHira(String(s).trim()).replace(/[・\s]/g, '');

/** Prefer words built only from kanji the user already knows. */
export function pickWord(char, words) {
  if (!words.length) return null;
  const known = words.filter((w) => w.k.every((k) => k === char || isKnown(k)));
  const pool = settings.preferKnownVocab && known.length ? known : words;
  return pool[Math.floor(Math.random() * pool.length)];
}

export async function render(ctx) {
  const { char } = ctx;
  const words = await data.vocab(char);
  const word = pickWord(char, words);
  const el = h('div.sess-body');

  if (!word) {
    // No common JMdict entry — say so rather than invent one.
    el.append(
      h('div.prompt-kanji.jp', char),
      h('div.pill.gap', 'Keine häufige Beispielvokabel in JMdict'),
      h('div.prompt-sub.small', 'Lesung des Zeichens eingeben (On oder Kun):')
    );
  } else {
    el.append(
      h('div.prompt-word.jp', word.w),
      h('div.prompt-sub.small.muted', word.g.join(', ')),
      h('div.prompt-sub.small', 'Wie wird das gelesen?')
    );
  }

  const input = h('input', {
    type: 'text', placeholder: 'z. B. kanji → かんじ', autocomplete: 'off',
    autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', lang: 'ja',
    style: { maxWidth: '340px', fontSize: '22px', textAlign: 'center' },
  });
  el.append(input);
  el.append(h('button.btn.primary', { onclick: () => check() }, 'Prüfen'));

  if (wk()) wk().bind(input, { IMEMode: 'toHiragana' });

  const e = data.entry(char);
  const accepted = word
    ? [word.r]
    : [...e.on, ...e.kun].map((r) => data.normReading(r));

  let answered = false;
  function check() {
    if (answered) return;
    const val = norm(input.value);
    if (!val) return;
    answered = true;
    const correct = accepted.some((a) => norm(a) === val);
    input.disabled = true;
    input.style.borderColor = correct ? 'var(--ok)' : 'var(--bad)';
    if (correct && settings.audio && word) speak(word.w);
    ctx.result({
      correct,
      extra: { mode: id, answer: input.value, word: word?.w },
      reveal: correct ? null : h('div.card.center',
        word && h('div.jp', { style: { fontSize: '32px' } }, word.w),
        h('div', { style: { fontSize: '24px' } }, h('span.jp-sans', accepted.join(' / '))),
        h('div.small.muted.mt', word ? word.g.join(', ') : data.shortMeaning(char, 3)),
        h('div.small.muted', 'deine Eingabe: ', input.value || '—')),
    });
  }

  return {
    el,
    focus: () => setTimeout(() => input.focus(), 60),
    onKey(ev) {
      if (ev.key === 'Enter') { check(); return true; }
      return false;
    },
    destroy() { if (wk()) try { wk().unbind(input); } catch { /* not bound */ } },
  };
}
