// Hash router. Screens are plain functions returning a DOM node; a node may
// expose `cleanup()` which is called before it is replaced.

import { $, clear } from './util.js';

const routes = [];
let currentNode = null;
let currentPath = null;

/** `pattern` like '/kanji/:char'. */
export function route(pattern, handler, opts = {}) {
  const keys = [];
  const rx = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ rx, keys, handler, ...opts });
}

export function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  return { path: path || '/', query: Object.fromEntries(new URLSearchParams(qs || '')) };
}

export function navigate(to, { replace = false } = {}) {
  const target = `#${to.startsWith('/') ? to : '/' + to}`;
  if (location.hash === target) return render();
  if (replace) location.replace(target);
  else location.hash = target;
}

export const back = () => history.back();

let renderToken = 0;

export async function render() {
  const { path, query } = parseHash();
  const token = ++renderToken;

  for (const r of routes) {
    const m = r.rx.exec(path);
    if (!m) continue;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));

    const view = $('#view');
    let node;
    try {
      node = await r.handler({ params, query, path });
    } catch (err) {
      console.error(err);
      node = errorNode(err);
    }
    if (token !== renderToken) return; // a newer navigation won

    currentNode?.cleanup?.();
    clear(view);
    if (node) view.append(node);
    currentNode = node;
    currentPath = path;
    view.scrollTop = 0;
    setChrome(r, params, query);
    updateTabs(path);
    return;
  }
  navigate('/', { replace: true });
}

function errorNode(err) {
  const d = document.createElement('div');
  d.className = 'wrap';
  d.innerHTML = '<div class="card"><h2>Fehler beim Anzeigen</h2></div>';
  d.querySelector('.card').append(Object.assign(document.createElement('pre'),
    { textContent: String(err?.stack || err), style: 'white-space:pre-wrap;font-size:12px;color:var(--fg-3)' }));
  return d;
}

function setChrome(r, params, query) {
  const title = typeof r.title === 'function' ? r.title(params, query) : r.title || 'Kanji Trainer';
  $('#tb-title').textContent = title;
  const backBtn = $('#tb-back');
  backBtn.hidden = !r.back;
  backBtn.onclick = () => (history.length > 1 ? history.back() : navigate('/'));
  $('#tabbar').hidden = !!r.fullscreen;
  $('#topbar').hidden = !!r.chromeless;
}

function updateTabs(path) {
  for (const a of document.querySelectorAll('#tabbar a')) {
    const t = a.dataset.tab;
    a.classList.toggle('active', t === '/' ? path === '/' : path.startsWith(t));
  }
}

export function startRouter() {
  window.addEventListener('hashchange', render);
  render();
}

export const currentRoutePath = () => currentPath;
