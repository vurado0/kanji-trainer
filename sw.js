/**
 * Service worker: makes the app installable and fully offline-capable.
 *
 * The shell and the core JSON are precached on install; the per-chunk stroke and
 * vocabulary files are cached the first time they are used, or all at once via
 * the "Offline-Daten laden" button in the settings.
 */

const VERSION = 'kanji-trainer-v1';
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'vendor/wanakana.min.js',
  'seed-progress.json',
  'data/meta.json',
  'data/kanji.json',
  'data/queue-auto.json',
  'data/confusion-seed.json',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'js/app.js', 'js/router.js', 'js/util.js', 'js/db.js', 'js/store.js', 'js/data.js',
  'js/srs.js', 'js/queue.js', 'js/seed.js', 'js/session.js', 'js/ui.js',
  'js/distractors.js', 'js/confusion.js', 'js/audio.js', 'js/app-state.js',
  'js/stroke/kvg.js', 'js/stroke/matcher.js', 'js/stroke/pad.js',
  'js/modes/index.js', 'js/modes/recognitionMC.js', 'js/modes/reverseMC.js',
  'js/modes/reading.js', 'js/modes/writing.js', 'js/modes/confusion.js',
  'js/screens/dashboard.js', 'js/screens/grid.js', 'js/screens/detail.js',
  'js/screens/queue.js', 'js/screens/custom.js', 'js/screens/stats.js',
  'js/screens/settings.js', 'js/screens/study.js', 'js/screens/session.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // Individually, so one missing file cannot break the whole install.
    await Promise.all(SHELL.map((u) => cache.add(u).catch((err) => console.warn('SW skip', u, err.message))));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const hit = await cache.match(e.request, { ignoreSearch: false });
    if (hit) {
      // Refresh in the background; the app works offline either way.
      fetch(e.request).then((r) => { if (r.ok) cache.put(e.request, r.clone()); }).catch(() => {});
      return hit;
    }
    try {
      const res = await fetch(e.request);
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    } catch (err) {
      const fallback = await cache.match('index.html');
      if (e.request.mode === 'navigate' && fallback) return fallback;
      throw err;
    }
  })());
});

/** Message from the page: pull every data chunk into the cache. */
self.addEventListener('message', (e) => {
  if (e.data?.type !== 'precache-data') return;
  const urls = e.data.urls || [];
  e.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    let done = 0;
    for (const u of urls) {
      try { await cache.add(u); } catch { /* keep going */ }
      done += 1;
      if (done % 8 === 0 || done === urls.length) {
        for (const c of await self.clients.matchAll()) c.postMessage({ type: 'precache-progress', done, total: urls.length });
      }
    }
  })());
});
