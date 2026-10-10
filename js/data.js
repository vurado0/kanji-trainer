// Static dataset access. Everything lives under /data as plain JSON produced by
// tools/build-data.mjs; chunks are fetched lazily and cached in memory.

let META = null;
let ENTRIES = [];             // ordered master list; index === entry.i
const BY_CHAR = new Map();
let AUTO_QUEUE = [];
let CONFUSION_SEED = [];

const strokeChunks = new Map();
const vocabChunks = new Map();

// Inverted indexes used for distractor selection.
const byComponent = new Map();  // component char -> [entry]
const byReading = new Map();    // normalised reading -> [entry]
const byMeaning = new Map();    // meaning word -> [entry]

const j = async (url) => {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
};

export async function loadData() {
  const [meta, kanji, auto, conf] = await Promise.all([
    j('data/meta.json'),
    j('data/kanji.json'),
    j('data/queue-auto.json'),
    j('data/confusion-seed.json'),
  ]);
  META = meta;
  ENTRIES = kanji.entries;
  AUTO_QUEUE = auto.order;
  CONFUSION_SEED = conf.pairs;
  for (const e of ENTRIES) BY_CHAR.set(e.c, e);
  buildIndexes();
  return META;
}

function buildIndexes() {
  const push = (map, key, e) => {
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(e);
  };
  for (const e of ENTRIES) {
    for (const c of e.comp) push(byComponent, c, e);
    if (e.rad) push(byComponent, e.rad, e);
    for (const r of e.on) push(byReading, normReading(r), e);
    for (const r of e.kun) push(byReading, normReading(r), e);
    for (const m of e.m) push(byMeaning, m.toLowerCase().split(/[\s(]/)[0], e);
  }
}

/** on/kun readings carry okurigana markers — strip them for comparison. */
export const normReading = (r) => r.replace(/[.\-－・]/g, '').trim();

export const meta = () => META;
export const entries = () => ENTRIES;
export const entry = (c) => BY_CHAR.get(c) || null;
export const has = (c) => BY_CHAR.has(c);
export const autoQueue = () => AUTO_QUEUE;
export const confusionSeed = () => CONFUSION_SEED;
export const componentIndex = () => byComponent;
export const readingIndex = () => byReading;
export const meaningIndex = () => byMeaning;

const chunkOf = (e) => Math.floor(e.i / META.chunk);

async function loadChunk(cache, dir, ci) {
  if (!cache.has(ci)) cache.set(ci, j(`data/${dir}/${ci}.json`).catch(() => ({})));
  return cache.get(ci);
}

/** Stroke paths for a character: { s: [pathData], t: [strokeType] } or null. */
export async function strokes(c) {
  const e = entry(c);
  if (!e) return null;
  const chunk = await loadChunk(strokeChunks, 'strokes', chunkOf(e));
  return chunk[c] || null;
}

/** Example words for a character (already ranked); [] when the source has none. */
export async function vocab(c) {
  const e = entry(c);
  if (!e) return [];
  const chunk = await loadChunk(vocabChunks, 'vocab', chunkOf(e));
  return chunk[c] || [];
}

/** Warm the chunks for a set of characters in one go (session preloading). */
export async function preload(chars) {
  const cis = new Set();
  for (const c of chars) { const e = entry(c); if (e) cis.add(chunkOf(e)); }
  await Promise.all([...cis].flatMap((ci) => [
    loadChunk(strokeChunks, 'strokes', ci),
    loadChunk(vocabChunks, 'vocab', ci),
  ]));
}

/** Primary short meaning, for compact UI. */
export function shortMeaning(c, n = 2) {
  const e = entry(c);
  if (!e || !e.m.length) return '—';
  return e.m.slice(0, n).join(', ');
}
