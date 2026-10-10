# Kanji Trainer

**Live:** https://vurado0.github.io/kanji-trainer/

A static kanji learning PWA with **two separate SRS tracks**, recognition and writing. It has six practice modes, stroke-order checking on a drawing pad (KanjiVG), confusion pairs and smart multiple-choice distractors. Progress lives in IndexedDB, with export/import and backups. There's no framework, no build step and no backend, and it works offline after the first visit. The data comes from KANJIDIC2, JMdict and KanjiVG (CC BY-SA) and is prepared by a one-time Node pipeline in `tools/`.

---

## Deutsch


Rein statische Lern-App für Kanji mit **zwei getrennten SRS-Tracks** (Erkennen und
Schreiben). Kein Build, kein Framework, kein Backend, keine Laufzeit-Netzwerkzugriffe.

## Starten

```bash
python3 -m http.server 8000
```

Dann <http://localhost:8000> öffnen. Auf dem iPad über Safari → Teilen → „Zum
Home-Bildschirm" installieren (PWA, danach vollständig offline).

> Über `file://` läuft die App nicht — ES-Module und `fetch` brauchen einen Server.

## Aufbau

```
index.html              App-Shell
manifest.webmanifest    PWA-Manifest
sw.js                   Service Worker (Offline-Cache)
css/app.css             Dark Theme
seed-progress.json      Alter Lernstand (Eingabe für den Erstimport)

js/
  app.js                Boot + Routen
  router.js             Hash-Router
  util.js               DOM-, Datums- und Farbhelfer
  db.js                 IndexedDB-Wrapper
  store.js              Fortschritt, Reviews, Settings, Export/Import, Backups
  data.js               Zugriff auf /data (lazy Chunks)
  srs.js                SM-2-Variante, Mastery, Grün-Definition
  queue.js              Lern-Warteschlange und Lektionen
  seed.js               Seed-Import und manuelle Korrektur
  session.js            Session-Engine (Queue, Interleaving, Undo)
  distractors.js        MC-Distraktoren (nicht zufällig)
  confusion.js          Verwechslungspaare
  audio.js              Web Speech (ja-JP), abschaltbar
  ui.js                 Toasts, Modals, Grid-Zelle, Ring
  stroke/kvg.js         KanjiVG-Rendering, Medianen, Strichanimation
  stroke/matcher.js     Strichvergleich und Reihenfolge-Analyse
  stroke/pad.js         Schreibfläche (Pointer Events)
  modes/                Die sechs Übungsmodi
  screens/              Dashboard, Grid, Detail, Study, Session, Custom,
                        Queue, Stats, Settings/About

data/                   Erzeugt von tools/build-data.mjs — nicht von Hand ändern
tools/build-data.mjs    Einmalige Datenpipeline (läuft nie im Browser)
tools/fetch-sources.sh  Lädt die Rohquellen nach tools/cache/
tools/test-srs.mjs      Assertions zu den SRS-Regeln
vendor/wanakana.min.js  Romaji → Kana (MIT)
```

## Daten neu bauen

```bash
bash tools/fetch-sources.sh && node tools/build-data.mjs
```

## Tests

```bash
node tools/test-srs.mjs
```

## Quellen

KANJIDIC2 (EDRDG, CC BY-SA), JMdict simplified eng-common (EDRDG/scriptin, CC BY-SA),
KanjiVG (Ulrich Apel, CC BY-SA 3.0), moderne JLPT-Stufen (Listen von Jonathan Waller,
über `davidluzgouveia/kanji-data`), WanaKana (MIT). Details im About-Screen der App.
