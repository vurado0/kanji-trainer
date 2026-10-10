// Toasts, modals, and a couple of shared widgets.

import { h, clear, $, masteryColor, masteryInk } from './util.js';

export function toast(msg, { bad = false, ms = 2600 } = {}) {
  const el = h(`div.toast${bad ? '.bad' : ''}`, msg);
  $('#toasts').append(el);
  setTimeout(() => {
    el.style.transition = 'opacity .3s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 320);
  }, ms);
  return el;
}

/** Generic modal. `body` may be a node or a function receiving `close`. */
export function modal({ title, body, actions = [], onClose } = {}) {
  const root = $('#modal-root');
  const back = h('div.modal-back');
  const box = h('div.modal');
  const close = (val) => {
    back.remove();
    document.removeEventListener('keydown', esc);
    onClose?.(val);
  };
  const esc = (e) => { if (e.key === 'Escape') close(null); };
  document.addEventListener('keydown', esc);

  if (title) box.append(h('h2', title));
  const content = typeof body === 'function' ? body(close) : body;
  if (content) box.append(content);
  if (actions.length) {
    box.append(h('div.modal-actions', actions.map((a) =>
      h(`button.btn${a.primary ? '.primary' : ''}${a.danger ? '.danger' : ''}${a.small ? '.sm' : ''}`,
        { onclick: () => { const r = a.onClick?.(close); if (r !== false) close(a.value ?? true); } },
        a.label)
    )));
  }
  back.append(box);
  back.addEventListener('pointerdown', (e) => { if (e.target === back) close(null); });
  root.append(back);
  return { close, box };
}

export function confirmDialog(title, text, { danger = false, okLabel = 'OK' } = {}) {
  return new Promise((resolve) => {
    modal({
      title,
      body: h('div', text),
      actions: [
        { label: 'Abbrechen', onClick: () => resolve(false) },
        { label: okLabel, primary: !danger, danger, onClick: () => resolve(true) },
      ],
      onClose: (v) => { if (v == null) resolve(false); },
    });
  });
}

export function promptDialog(title, { placeholder = '', value = '', multiline = false, okLabel = 'OK' } = {}) {
  return new Promise((resolve) => {
    const input = multiline
      ? h('textarea', { placeholder })
      : h('input', { type: 'text', placeholder });
    input.value = value;
    modal({
      title,
      body: input,
      actions: [
        { label: 'Abbrechen', onClick: () => resolve(null) },
        { label: okLabel, primary: true, onClick: () => resolve(input.value) },
      ],
      onClose: (v) => { if (v == null) resolve(null); },
    });
    setTimeout(() => input.focus(), 40);
  });
}

/** A kanji cell coloured by mastery, as used in the grid and lists. */
export function kanjiCell(char, mastery, { onclick, onlong, writingWeak = false, suspended = false, leech = false, selected = false } = {}) {
  const cell = h(`button.kcell${mastery <= 0 ? '.new' : ''}${suspended ? '.susp' : ''}${leech ? '.leech' : ''}${selected ? '.sel' : ''}`,
    { type: 'button' }, char);
  if (mastery > 0) {
    cell.style.background = masteryColor(mastery);
    cell.style.color = masteryInk(mastery);
  }
  if (writingWeak) cell.append(h('span.wmark', '✎'));
  if (onclick) cell.addEventListener('click', () => onclick(char));
  if (onlong) attachLongPress(cell, () => onlong(char));
  return cell;
}

/** Long-press on touch, right-click on desktop — both open the quick actions. */
export function attachLongPress(el, fn, ms = 480) {
  let timer = null;
  let moved = false;
  const start = (ev) => {
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    moved = false;
    timer = setTimeout(() => { timer = null; if (!moved) fn(ev); }, ms);
  };
  const cancel = () => { clearTimeout(timer); timer = null; };
  el.addEventListener('pointerdown', start);
  el.addEventListener('pointermove', () => { moved = true; cancel(); });
  el.addEventListener('pointerup', cancel);
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('pointerleave', cancel);
  el.addEventListener('contextmenu', (ev) => { ev.preventDefault(); cancel(); fn(ev); });
}

/** Segmented control. `items` = [{value,label}] */
export function segmented(items, value, onChange) {
  const el = h('div.seg');
  for (const it of items) {
    const b = h(`button${it.value === value ? '.on' : ''}`, { type: 'button' }, it.label);
    b.addEventListener('click', () => {
      [...el.children].forEach((c) => c.classList.remove('on'));
      b.classList.add('on');
      onChange(it.value);
    });
    el.append(b);
  }
  return el;
}

/** Progress ring for the daily goal. */
export function ring(done, goal, label = 'heute') {
  const pct = goal > 0 ? Math.min(1, done / goal) : 0;
  const R = 44, C = 2 * Math.PI * R;
  const NS = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('class', 'ring');
  s.setAttribute('viewBox', '0 0 104 104');
  const mk = (tag, a) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(a)) e.setAttribute(k, v);
    return e;
  };
  s.append(mk('circle', { cx: 52, cy: 52, r: R, fill: 'none', stroke: 'var(--bg-4)', 'stroke-width': 8 }));
  s.append(mk('circle', {
    cx: 52, cy: 52, r: R, fill: 'none',
    stroke: pct >= 1 ? 'var(--ok)' : 'var(--accent)', 'stroke-width': 8, 'stroke-linecap': 'round',
    'stroke-dasharray': `${C * pct} ${C}`, transform: 'rotate(-90 52 52)',
  }));
  const t1 = mk('text', { x: 52, y: 52 }); t1.textContent = `${done}/${goal}`;
  const t2 = mk('text', { x: 52, y: 66, class: 'sub' }); t2.setAttribute('class', 'sub'); t2.textContent = label;
  s.append(t1, t2);
  return s;
}

export function emptyState(text, actionLabel, onAction) {
  return h('div.card.center', { style: { padding: '28px 16px' } },
    h('div.muted', text),
    actionLabel && h('button.btn.primary.mt', { onclick: onAction }, actionLabel));
}

export { clear };
