/**
 * build-data.mjs — one-off, offline data pipeline.
 *
 * Reads the vendored upstream dumps in tools/cache/ and emits the static JSON
 * the app consumes at runtime. This NEVER runs in the browser; the app itself
 * makes no network calls beyond fetching these local files.
 *
 *   node tools/build-data.mjs
 *
 * Inputs (see tools/fetch-sources.sh):
 *   cache/kanjidic2.xml      KANJIDIC2  (EDRDG, CC BY-SA 4.0)
 *   cache/kanji-data.json    modern JLPT levels (tanos.co.uk lists, MIT repo)
 *   cache/kanjivg.xml        KanjiVG    (Ulrich Apel, CC BY-SA 3.0)
 *   cache/jm/*.json          JMdict simplified, eng-common (EDRDG, CC BY-SA 4.0)
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, 'tools', 'cache');
const OUT = join(ROOT, 'data');

/** Characters per lazily-loaded chunk file. */
const CHUNK = 100;
/** Max example words kept per kanji (runtime picks 3-5 from these). */
const VOCAB_PER_KANJI = 10;

const log = (...a) => console.log('[build]', ...a);

// ---------------------------------------------------------------------------
// 1. KANJIDIC2 — meanings, readings, stroke count, frequency, grade
// ---------------------------------------------------------------------------

function parseKanjidic() {
  const xml = readFileSync(join(CACHE, 'kanjidic2.xml'), 'utf8');
  const out = new Map();
  const blocks = xml.split('<character>').slice(1);
  for (const raw of blocks) {
    const block = raw.slice(0, raw.indexOf('</character>'));
    const literal = /<literal>(.*?)<\/literal>/.exec(block)?.[1];
    if (!literal) continue;

    const num = (re) => {
      const m = re.exec(block);
      return m ? Number(m[1]) : null;
    };
    // English meanings only: entries without m_lang are English by definition.
    // KANJIDIC2 carries no German glosses, so we surface English as-is rather
    // than inventing translations.
    const meanings = [...block.matchAll(/<meaning>([^<]+)<\/meaning>/g)].map((m) => decode(m[1]));
    const on = [...block.matchAll(/<reading r_type="ja_on">([^<]+)<\/reading>/g)].map((m) => m[1]);
    const kun = [...block.matchAll(/<reading r_type="ja_kun">([^<]+)<\/reading>/g)].map((m) => m[1]);
    const nanori = [...block.matchAll(/<nanori>([^<]+)<\/nanori>/g)].map((m) => m[1]);

    out.set(literal, {
      c: literal,
      st: num(/<stroke_count>(\d+)<\/stroke_count>/),
      fq: num(/<freq>(\d+)<\/freq>/),
      gr: num(/<grade>(\d+)<\/grade>/),
      jlptOld: num(/<jlpt>(\d+)<\/jlpt>/),
      radNr: num(/<rad_value rad_type="classical">(\d+)<\/rad_value>/),
      m: meanings,
      on,
      kun,
      nanori,
    });
  }
  return out;
}

const ENT = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&apos;': "'" };
const decode = (s) => s.replace(/&(lt|gt|amp|quot|apos);/g, (m) => ENT[m]);

// ---------------------------------------------------------------------------
// 2. KanjiVG — stroke paths (in original 109x109 viewBox) + component tree
// ---------------------------------------------------------------------------

/**
 * Re-emit an SVG path `d` with coordinates rounded to 1 decimal
 * (0.1 of a 109-unit viewBox — about a quarter pixel when drawn at 300px).
 *
 * Tokenises properly instead of regex-replacing numbers in place: rounding can
 * turn "-0.05" into "-0" -> "0", and a lost minus sign silently welds two
 * numbers into one, corrupting the stroke. Numbers are re-joined with explicit
 * commas so separation never depends on a sign character.
 */
const PATH_TOKEN = /([MmCcSsLlHhVvZz])|(-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g;

function shrinkPath(d) {
  let out = '';
  let pendingNumbers = [];
  const flush = () => {
    if (pendingNumbers.length) out += pendingNumbers.join(',');
    pendingNumbers = [];
  };
  for (const m of d.matchAll(PATH_TOKEN)) {
    if (m[1]) {
      flush();
      out += m[1];
    } else {
      const v = Math.round(Number(m[2]) * 10) / 10;
      // Normalise -0 to 0; the explicit comma separator keeps tokens apart.
      pendingNumbers.push(String(Object.is(v, -0) ? 0 : v));
    }
  }
  flush();
  return out;
}

function parseKanjiVG() {
  const xml = readFileSync(join(CACHE, 'kanjivg.xml'), 'utf8');
  const out = new Map();
  const blocks = xml.split('<kanji ').slice(1);

  for (const raw of blocks) {
    const block = raw.slice(0, raw.indexOf('</kanji>'));
    const id = /^id="kvg:kanji_([0-9a-f]+)"/.exec(block)?.[1];
    if (!id) continue;
    // KanjiVG ships variant glyphs as e.g. 05f3e-Kaisho; skip those, keep the base.
    if (/-/.test(id)) continue;
    const char = String.fromCodePoint(parseInt(id, 16));

    const strokes = [];
    const types = [];
    for (const m of block.matchAll(/<path\b([^>]*)>/g)) {
      const attrs = m[1];
      const d = /\sd="([^"]+)"/.exec(attrs)?.[1];
      if (!d) continue;
      types.push(decode(/kvg:type="([^"]*)"/.exec(attrs)?.[1] ?? ''));
      strokes.push(shrinkPath(d));
    }
    if (!strokes.length) continue;

    // Components: the <g> elements directly beneath the root group that carry a
    // kvg:element. Nested groups give the sub-decomposition.
    const comps = componentsOf(block, char);
    const radical =
      /kvg:element="([^"]+)"[^>]*kvg:radical="general"/.exec(block)?.[1] ||
      /kvg:radical="general"[^>]*kvg:element="([^"]+)"/.exec(block)?.[1] ||
      null;

    out.set(char, { s: strokes, t: types, comp: comps, rad: radical });
  }
  return out;
}

/**
 * Collect distinct kvg:element values inside a kanji block, excluding the
 * character itself and single-stroke noise, preserving document order.
 */
function componentsOf(block, self) {
  const seen = new Set();
  const comps = [];
  for (const m of block.matchAll(/<g\b[^>]*kvg:element="([^"]+)"/g)) {
    const el = decode(m[1]);
    if (el === self || seen.has(el)) continue;
    seen.add(el);
    comps.push(el);
  }
  return comps;
}

// ---------------------------------------------------------------------------
// 3. Modern JLPT levels
// ---------------------------------------------------------------------------

function parseJlpt() {
  const d = JSON.parse(readFileSync(join(CACHE, 'kanji-data.json'), 'utf8'));
  const out = new Map();
  for (const [c, v] of Object.entries(d)) if (v.jlpt_new) out.set(c, v.jlpt_new);
  return out;
}

// ---------------------------------------------------------------------------
// 4. JMdict (common subset) — example vocabulary per kanji
// ---------------------------------------------------------------------------

const KANJI_RE = /[一-龯㐀-䶿]/gu;

function parseVocab(charSet) {
  const file = readdirSync(join(CACHE, 'jm')).find((f) => f.endsWith('.json'));
  const d = JSON.parse(readFileSync(join(CACHE, 'jm', file), 'utf8'));
  /** char -> array of word records */
  const byChar = new Map();

  for (const w of d.words) {
    const kForm = w.kanji?.find((k) => k.common) || w.kanji?.[0];
    if (!kForm) continue;
    const word = kForm.text;
    const kanjiIn = [...new Set(word.match(KANJI_RE) || [])];
    if (!kanjiIn.length) continue;

    const kana =
      w.kana?.find((k) => k.common && (k.appliesToKanji.includes('*') || k.appliesToKanji.includes(word))) ||
      w.kana?.find((k) => k.appliesToKanji.includes('*') || k.appliesToKanji.includes(word)) ||
      w.kana?.[0];
    if (!kana) continue;

    const glosses = [];
    for (const s of w.sense) {
      for (const g of s.gloss) if (g.lang === 'eng') glosses.push(g.text);
      if (glosses.length >= 3) break;
    }
    if (!glosses.length) continue;

    const rec = {
      w: word,
      r: kana.text,
      g: glosses.slice(0, 3),
      k: kanjiIn,
      // Shorter + fully-common words make better first examples.
      _score: (kForm.common ? 0 : 20) + kanjiIn.length * 2 + word.length,
    };
    for (const c of kanjiIn) {
      if (!charSet.has(c)) continue;
      if (!byChar.has(c)) byChar.set(c, []);
      byChar.get(c).push(rec);
    }
  }

  for (const [c, list] of byChar) {
    list.sort((a, b) => a._score - b._score);
    byChar.set(
      c,
      list.slice(0, VOCAB_PER_KANJI).map(({ _score, ...r }) => r)
    );
  }
  return byChar;
}

// ---------------------------------------------------------------------------
// 5. Assemble
// ---------------------------------------------------------------------------

function main() {
  log('parsing KANJIDIC2 …');
  const dic = parseKanjidic();
  log(`  ${dic.size} characters`);

  log('parsing KanjiVG …');
  const vg = parseKanjiVG();
  log(`  ${vg.size} characters with stroke data`);

  log('parsing JLPT levels …');
  const jlpt = parseJlpt();
  log(`  ${jlpt.size} characters with a modern JLPT level`);

  const seed = JSON.parse(readFileSync(join(ROOT, 'seed-progress.json'), 'utf8'));
  const seedChars = new Set(
    [...Object.values(seed.learned), seed.queue.in_progress, seed.queue.n3_rest].join('')
  );

  // Character universe: every JLPT N5-N1 kanji plus anything the seed mentions
  // (the old app contained a handful of non-JLPT characters).
  const universe = new Set([...jlpt.keys(), ...seedChars]);
  log(`universe: ${universe.size} characters (${jlpt.size} JLPT + ${universe.size - jlpt.size} extra from seed)`);

  const entries = [];
  const gaps = { noDic: [], noStrokes: [], noVocab: [] };

  for (const c of universe) {
    const d = dic.get(c);
    const v = vg.get(c);
    if (!d) gaps.noDic.push(c);
    if (!v) gaps.noStrokes.push(c);
    entries.push({
      c,
      lv: jlpt.get(c) || 0, // 5..1, 0 = outside the JLPT lists
      st: d?.st ?? v?.s.length ?? null,
      fq: d?.fq ?? null,
      gr: d?.gr ?? null,
      m: d?.m ?? [],
      on: d?.on ?? [],
      kun: d?.kun ?? [],
      nanori: d?.nanori ?? [],
      rad: v?.rad ?? null,
      comp: v?.comp ?? [],
      ns: v?.s.length ?? 0, // number of strokes we have paths for
    });
  }

  // Stable, deterministic ordering of the master list: level (N5 first), then
  // frequency, then codepoint. Index in this array == the id used everywhere.
  entries.sort((a, b) => {
    const la = a.lv || 0, lb = b.lv || 0;
    if (la !== lb) return lb - la; // 5,4,3,2,1,0
    const fa = a.fq ?? 99999, fb = b.fq ?? 99999;
    if (fa !== fb) return fa - fb;
    return a.c.codePointAt(0) - b.c.codePointAt(0);
  });
  entries.forEach((e, i) => (e.i = i));
  const indexOf = new Map(entries.map((e) => [e.c, e.i]));

  log('parsing JMdict …');
  const vocab = parseVocab(universe);
  log(`  vocabulary for ${vocab.size} characters`);
  for (const e of entries) if (!vocab.has(e.c)) gaps.noVocab.push(e.c);

  // -- auto-generated tail of the learning queue -----------------------------
  // Everything not covered by the seed, ordered N2 -> N1, by frequency asc,
  // characters without a frequency rank last.
  const seedOrdered = new Set([
    ...seed.queue.in_progress,
    ...seed.queue.n3_rest,
    ...Object.values(seed.learned).join(''),
  ]);
  const autoTail = entries
    .filter((e) => !seedOrdered.has(e.c))
    .sort((a, b) => {
      const la = a.lv || 0, lb = b.lv || 0;
      if (la !== lb) return lb - la; // N2 (2) before N1 (1) before 0
      const fa = a.fq ?? Infinity, fb = b.fq ?? Infinity;
      if (fa !== fb) return fa - fb;
      return a.c.codePointAt(0) - b.c.codePointAt(0);
    })
    .map((e) => e.c);

  // -- write ------------------------------------------------------------------
  if (existsSync(OUT)) rmSync(OUT, { recursive: true });
  mkdirSync(join(OUT, 'strokes'), { recursive: true });
  mkdirSync(join(OUT, 'vocab'), { recursive: true });

  writeFileSync(
    join(OUT, 'kanji.json'),
    JSON.stringify({
      chunk: CHUNK,
      entries: entries.map((e) => ({
        i: e.i, c: e.c, lv: e.lv, st: e.st, fq: e.fq, gr: e.gr,
        m: e.m, on: e.on, kun: e.kun, rad: e.rad, comp: e.comp, ns: e.ns,
      })),
    })
  );

  const chunkCount = Math.ceil(entries.length / CHUNK);
  for (let ci = 0; ci < chunkCount; ci++) {
    const slice = entries.slice(ci * CHUNK, (ci + 1) * CHUNK);
    const strokes = {}, vocs = {};
    for (const e of slice) {
      const v = vg.get(e.c);
      if (v) strokes[e.c] = { s: v.s, t: v.t };
      const vo = vocab.get(e.c);
      if (vo) vocs[e.c] = vo;
    }
    writeFileSync(join(OUT, 'strokes', `${ci}.json`), JSON.stringify(strokes));
    writeFileSync(join(OUT, 'vocab', `${ci}.json`), JSON.stringify(vocs));
  }

  writeFileSync(
    join(OUT, 'queue-auto.json'),
    JSON.stringify({ order: autoTail })
  );

  writeFileSync(
    join(OUT, 'meta.json'),
    JSON.stringify(
      {
        generated: new Date().toISOString(),
        chunk: CHUNK,
        chunkCount,
        counts: {
          characters: entries.length,
          withStrokes: entries.length - gaps.noStrokes.length,
          withVocab: vocab.size,
          byLevel: [5, 4, 3, 2, 1, 0].map((lv) => ({ lv, n: entries.filter((e) => e.lv === lv).length })),
        },
        gaps: {
          noStrokes: gaps.noStrokes,
          noDic: gaps.noDic,
          noVocab: gaps.noVocab.length,
        },
        sources: [
          { name: 'KANJIDIC2', by: 'Electronic Dictionary Research and Development Group', license: 'CC BY-SA 4.0', url: 'http://www.edrdg.org/wiki/index.php/KANJIDIC_Project' },
          { name: 'JMdict (simplified, eng-common)', by: 'EDRDG / scriptin', license: 'CC BY-SA 4.0', url: 'https://github.com/scriptin/jmdict-simplified' },
          { name: 'KanjiVG', by: 'Ulrich Apel', license: 'CC BY-SA 3.0', url: 'http://kanjivg.tagaini.net' },
          { name: 'JLPT-Stufen (modern)', by: "Jonathan Waller's JLPT resources, via davidluzgouveia/kanji-data", license: 'MIT (Datenbank), Listen frei verfügbar', url: 'https://github.com/davidluzgouveia/kanji-data' },
          { name: 'WanaKana', by: 'WaniKani / Tofugu', license: 'MIT', url: 'https://github.com/WaniKani/WanaKana' },
        ],
      },
      null,
      1
    )
  );

  // Confusion pairs the user reported, as the drill's starting list.
  writeFileSync(
    join(OUT, 'confusion-seed.json'),
    JSON.stringify({
      pairs: '連/運 変/恋 治/政 老/考 他/地 待/持 未/末 借/惜 席/度 確/薬'
        .split(' ')
        .map((p) => p.split('/')),
    })
  );

  log(`wrote ${entries.length} entries in ${chunkCount} chunks`);
  log(`gaps: ${gaps.noStrokes.length} without strokes, ${gaps.noDic.length} without KANJIDIC entry, ${gaps.noVocab.length} without vocabulary`);
  if (gaps.noStrokes.length) log('  no strokes:', gaps.noStrokes.join(''));
  log(`auto queue tail: ${autoTail.length} characters`);
}

main();
