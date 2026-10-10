/**
 * Settings and data management: limits, modes, seed import and corrections,
 * export/import, rolling backups, reset, licences.
 */

import { h, clear, download, pickFile, fmtDateTime } from '../util.js';
import {
  settings, saveSettings, DEFAULT_SETTINGS, exportJSON, exportPayload, importPayload,
  resetAll, snapshot, listBackups, loadRecords, allRecords, saveRec, rec, kvGet,
} from '../store.js';
import { mastery } from '../srs.js';
import * as data from '../data.js';
import { toast, confirmDialog, modal, segmented } from '../ui.js';
import { WRITING_LADDERS, importSeed, fetchSeed, applyTier, previewChars, seedState, REC_INTERVALS } from '../seed.js';
import { navigate } from '../router.js';
import { audioAvailable } from '../audio.js';
import { allPairs, addPair, removePair } from '../confusion.js';
import * as queue from '../queue.js';

export async function settingsScreen() {
  const wrap = h('div.wrap');
  const seeded = await seedState();

  // --- limits ---------------------------------------------------------------
  wrap.append(card('Tageslimits', [
    numberField('Neue Kanji pro Tag', 'newPerDay', 0, 100),
    numberField('Reviews pro Tag', 'reviewsPerDay', 5, 1000),
    numberField('Neue Zeichen erst unter … fälligen Reviews', 'backlogGate', 0, 2000),
    numberField('Zeichen pro Lektion', 'lessonSize', 1, 20),
    numberField('Tagesbeginn (Stunde)', 'dayCutoffHour', 0, 12),
    h('div.small.muted', 'Ein Lerntag beginnt zur eingestellten Stunde — eine Session um 1 Uhr nachts zählt so noch zum Vortag.'),
  ]));

  // --- modes ----------------------------------------------------------------
  const modeList = [
    ['recognitionMC', 'Bedeutung erkennen (Kanji → Bedeutung)'],
    ['reverseMC', 'Zeichen finden (Bedeutung → Kanji)'],
    ['reading', 'Lesung tippen (Vokabel → Kana)'],
    ['writingGuided', 'Schreiben geführt (mit Umriss)'],
    ['writingBlind', 'Schreiben blind (ohne Umriss)'],
    ['confusion', 'Verwechslungs-Drill'],
  ];
  wrap.append(card('Übungsmodi', [
    ...modeList.map(([id, label]) => toggle(label, settings.modes[id], (v) => saveSettings({ modes: { [id]: v } }))),
    h('div.small.muted', 'Mindestens ein Modus je Track sollte aktiv bleiben.'),
  ]));

  // --- behaviour ------------------------------------------------------------
  const tol = h('input', { type: 'range', min: '0.6', max: '1.6', step: '0.05', value: String(settings.strokeTolerance) });
  const tolLabel = h('span.small.muted', tolText(settings.strokeTolerance));
  tol.addEventListener('input', () => {
    saveSettings({ strokeTolerance: Number(tol.value) });
    tolLabel.textContent = tolText(Number(tol.value));
  });

  wrap.append(card('Verhalten', [
    toggle('Richtige Antworten automatisch als „Gut" werten', settings.autoAdvance, (v) => saveSettings({ autoAdvance: v })),
    toggle('Strichnummern im Schreibfeld anzeigen', settings.showStrokeNumbers, (v) => saveSettings({ showStrokeNumbers: v })),
    toggle('Beispielvokabeln aus bekannten Zeichen bevorzugen', settings.preferKnownVocab, (v) => saveSettings({ preferKnownVocab: v })),
    toggle('MC-Distraktoren aus bekannten Zeichen bevorzugen', settings.preferKnownDistractors, (v) => saveSettings({ preferKnownDistractors: v })),
    audioAvailable()
      ? toggle('Audio für Vokabeln (Web Speech, ja-JP)', settings.audio, (v) => saveSettings({ audio: v }))
      : h('div.small.muted', 'Audio: keine Sprachausgabe in diesem Browser verfügbar.'),
    h('label.field', h('span', 'Toleranz der Strichprüfung'), tol, tolLabel),
  ]));

  // --- seed -----------------------------------------------------------------
  const ladderWrap = h('div');
  ladderWrap.append(segmented(
    WRITING_LADDERS.map((l) => ({ value: l.id, label: l.label })),
    settings.writingSeedOffset,
    (v) => saveSettings({ writingSeedOffset: Number(v) })));

  wrap.append(card('Seed-Import (alter Lernstand)', [
    h('div.small.muted', seeded
      ? `Zuletzt importiert: ${fmtDateTime(new Date(seeded.at).getTime())} — ${seeded.records} Zeichen.`
      : 'Noch nicht importiert.'),
    h('label.field', h('span', 'Schreib-Track beim Import'), ladderWrap),
    h('div.small.muted', 'Erkennen: 60 / 30 / 14 / 1 Tage je nach Farbstufe der alten App.'),
    h('div.row.mt',
      h('button.btn.sm', { onclick: () => runSeed(false) }, 'Seed erneut anwenden'),
      h('button.btn.sm.danger', { onclick: () => runSeed(true) }, 'Erzwingen (überschreibt)')),
  ]));

  async function runSeed(force) {
    const text = force
      ? 'Bestehende Intervalle werden mit den Seed-Werten überschrieben. Vorher wird automatisch gesichert.'
      : 'Nur Zeichen ohne stärkeren Stand werden angehoben. Vorher wird automatisch gesichert.';
    if (!(await confirmDialog('Seed anwenden?', text, { okLabel: 'Anwenden' }))) return;
    await snapshot('vor Seed-Import');
    const seed = await fetchSeed();
    const s = await importSeed(seed, { force });
    await queue.initQueue(seed);
    toast(`${s.records} Zeichen eingespielt, Fälligkeiten über ${s.dueSpread.lastDay - s.dueSpread.firstDay + 1} Tage verteilt.`);
    navigate('/settings');
  }

  // --- manual correction ----------------------------------------------------
  wrap.append(manualImportCard());

  // --- confusion pairs ------------------------------------------------------
  wrap.append(confusionCard());

  // --- data -----------------------------------------------------------------
  wrap.append(card('Daten', [
    h('div.btn-grid',
      h('button.btn', { onclick: exportFull }, 'Export JSON (voller Stand)'),
      h('button.btn', { onclick: exportWeakTSV }, 'Export TSV (schwache Zeichen, Anki)'),
      h('button.btn', { onclick: doImport }, 'Import JSON'),
      h('button.btn', { onclick: async () => { await snapshot('manuell'); toast('Sicherung angelegt'); navigate('/settings'); } }, 'Jetzt sichern')),
    h('div.small.muted.mt', 'Automatische Sicherung bei jedem Start (max. 5 Stände) sowie vor Import, Seed und Zurücksetzen.'),
  ]));

  wrap.append(offlineCard());

  wrap.append(await backupsCard());

  wrap.append(card('Zurücksetzen', [
    h('div.small.muted', 'Löscht Fortschritt, Reviews und Warteschlange. Eine Sicherung wird vorher automatisch angelegt.'),
    h('button.btn.danger.mt', {
      onclick: async () => {
        if (!(await confirmDialog('Alles zurücksetzen?', 'Der gesamte Lernfortschritt wird gelöscht. Eine Sicherung wird vorher angelegt und bleibt unter „Sicherungen" abrufbar.', { danger: true, okLabel: 'Zurücksetzen' }))) return;
        await resetAll();
        toast('Zurückgesetzt — die App startet neu.');
        setTimeout(() => location.reload(), 700);
      },
    }, 'Alles zurücksetzen'),
  ]));

  wrap.append(h('div.card.mt',
    h('h2', 'Über / Lizenzen'),
    h('button.btn.sm', { onclick: () => navigate('/about') }, 'Datenquellen und Lizenzen anzeigen')));

  return wrap;
}

// ---------------------------------------------------------------------------

const tolText = (v) => (v < 0.85 ? 'streng' : v > 1.2 ? 'nachsichtig' : 'normal');

function card(title, children) {
  return h('div.card', h('h2', title), children);
}

function numberField(label, key, min, max) {
  const inp = h('input', { type: 'number', min: String(min), max: String(max), value: String(settings[key]) });
  inp.addEventListener('change', () => {
    const v = Math.max(min, Math.min(max, Number(inp.value) || 0));
    inp.value = String(v);
    saveSettings({ [key]: v });
    toast('Gespeichert');
  });
  return h('label.field', h('span', label), inp);
}

function toggle(label, value, onChange) {
  const box = h('input', { type: 'checkbox' });
  box.checked = !!value;
  box.addEventListener('change', () => { onChange(box.checked); toast('Gespeichert'); });
  return h('label.field', h('span.row', box, h('span', label)));
}

// ---------------------------------------------------------------------------

function manualImportCard() {
  const input = h('textarea', { placeholder: 'Kanji hier einfügen, z. B. 熱費静科降岡' });
  const preview = h('div.small.muted.mt', 'Noch nichts eingegeben.');
  const tierSel = h('select',
    h('option', { value: 'mastery_3' }, 'Sicher — Erkennen 60 T'),
    h('option', { value: 'mastery_2' }, 'Gut — 30 T'),
    h('option', { value: 'mastery_1' }, 'Wackelig — 14 T'),
    h('option', { value: 'mastery_0' }, 'Angefangen — 1 T'));
  const trackSel = h('select',
    h('option', { value: 'both' }, 'Beide Tracks'),
    h('option', { value: 'recognition' }, 'Nur Erkennen'),
    h('option', { value: 'writing' }, 'Nur Schreiben'));

  input.addEventListener('input', () => {
    const p = previewChars(input.value);
    clear(preview);
    preview.append(`${p.known.length} Zeichen erkannt, ${p.unknown.length} unbekannt`);
    if (p.unknown.length) preview.append(h('div.pill.gap.mt', `unbekannt: ${p.unknown.join(' ')}`));
  });

  return card('Lernstand nachpflegen', [
    h('div.small.muted', 'Die Seed-Liste stammt aus OCR — hier lassen sich einzelne Zeichen korrigieren. Idempotent: erneutes Anwenden ändert nichts, außer die Stufe ist höher.'),
    h('label.field', h('span', 'Zeichen'), input),
    h('label.field', h('span', 'Stufe'), tierSel),
    h('label.field', h('span', 'Track'), trackSel),
    preview,
    h('div.row.mt',
      h('button.btn.sm.primary', {
        onclick: async () => {
          const p = previewChars(input.value);
          if (!p.known.length) { toast('Keine bekannten Zeichen gefunden.', { bad: true }); return; }
          const { touched } = applyTier(p.known, tierSel.value, { track: trackSel.value, force: true });
          for (const r of touched) await saveRec(r);
          toast(`${touched.length} Zeichen aktualisiert${p.unknown.length ? `, ${p.unknown.length} ignoriert` : ''}.`);
          input.value = '';
          clear(preview); preview.append('Noch nichts eingegeben.');
        },
      }, 'Anwenden')),
  ]);
}

function confusionCard() {
  const pairs = allPairs();
  const box = h('div');
  const list = h('div.qlist.mt');
  const rerender = () => {
    clear(list);
    for (const p of allPairs().slice(0, 40)) {
      list.append(h('div.qrow',
        h('div.kc.jp', p.a), h('div.kc.jp', p.b),
        h('div.mn', h('div.small.muted', `${data.shortMeaning(p.a, 1)} / ${data.shortMeaning(p.b, 1)} · ${p.count}× · ${p.source}`)),
        h('button.btn.sm', { onclick: async () => { await removePair(p.a, p.b); rerender(); } }, 'Entfernen')));
    }
  };
  rerender();

  const inp = h('input', { type: 'text', placeholder: 'Paar eingeben, z. B. 連運' });
  box.append(
    h('div.small.muted', `${pairs.length} Paare. Neue Paare kommen automatisch dazu, sobald zwei Zeichen in einem Review verwechselt werden.`),
    h('label.field', h('span', 'Paar ergänzen'), inp),
    h('button.btn.sm', {
      onclick: async () => {
        const cs = [...inp.value].filter((c) => /\p{Script=Han}/u.test(c));
        if (cs.length < 2) { toast('Bitte zwei Zeichen eingeben.', { bad: true }); return; }
        const p = await addPair(cs[0], cs[1]);
        if (!p) { toast('Unbekannte Zeichen.', { bad: true }); return; }
        inp.value = ''; rerender(); toast('Paar ergänzt');
      },
    }, 'Hinzufügen'),
    list);
  return card('Verwechslungs-Paare', box);
}

async function backupsCard() {
  const list = await listBackups();
  const box = h('div');
  if (!list.length) box.append(h('div.small.muted', 'Noch keine Sicherungen.'));
  for (const b of list) {
    box.append(h('div.qrow',
      h('div.mn',
        h('div', fmtDateTime(b.ts)),
        h('div.small.muted', `${b.label} · ${b.payload.records?.length || 0} Zeichen · ${b.payload.reviews?.length || 0} Reviews`)),
      h('button.btn.sm', { onclick: () => download(`kanji-backup-${b.ts}.json`, JSON.stringify(b.payload, null, 1)) }, 'Herunterladen'),
      h('button.btn.sm', {
        onclick: async () => {
          if (!(await confirmDialog('Sicherung wiederherstellen?', `Der aktuelle Stand wird durch die Sicherung vom ${fmtDateTime(b.ts)} ersetzt. Der jetzige Stand wird vorher gesichert.`, { okLabel: 'Wiederherstellen' }))) return;
          await importPayload(b.payload);
          await loadRecords();
          toast('Wiederhergestellt');
          setTimeout(() => location.reload(), 600);
        },
      }, 'Wiederherstellen')));
  }
  return card(`Sicherungen (max. 5)`, box);
}

async function exportFull() {
  download(`kanji-trainer-${new Date().toISOString().slice(0, 10)}.json`, await exportJSON());
  toast('Export erstellt');
}

async function exportWeakTSV() {
  const rows = [['Kanji', 'Bedeutung', 'On', 'Kun', 'Erkennen', 'Schreiben', 'Fehler']];
  for (const r of allRecords()) {
    const mR = mastery(r.tracks.recognition);
    const mW = mastery(r.tracks.writing);
    if (Math.min(mR, mW) >= 60) continue;
    const e = data.entry(r.char);
    if (!e) continue;
    rows.push([r.char, e.m.slice(0, 4).join('; '), e.on.join(' '), e.kun.join(' '),
      String(mR), String(mW), String(r.tracks.recognition.lapses + r.tracks.writing.lapses)]);
  }
  if (rows.length === 1) { toast('Keine schwachen Zeichen.', { bad: true }); return; }
  download(`kanji-schwach-${new Date().toISOString().slice(0, 10)}.tsv`,
    rows.map((r) => r.join('\t')).join('\n'), 'text/tab-separated-values');
  toast(`${rows.length - 1} Zeichen exportiert`);
}

async function doImport() {
  const file = await pickFile();
  if (!file) return;
  let payload;
  try {
    payload = JSON.parse(await file.text());
  } catch (e) {
    toast('Datei ist kein gültiges JSON.', { bad: true });
    return;
  }
  if (!(await confirmDialog('Import starten?',
    `„${file.name}" ersetzt den aktuellen Stand (${payload.records?.length ?? '?'} Zeichen). Der jetzige Stand wird vorher gesichert.`,
    { okLabel: 'Importieren' }))) return;
  try {
    const res = await importPayload(payload);
    toast(`${res.records} Zeichen, ${res.reviews} Reviews importiert.`);
    setTimeout(() => location.reload(), 700);
  } catch (e) {
    toast(String(e.message || e), { bad: true });
  }
}

function offlineCard() {
  const status = h('div.small.muted', 'Strich- und Vokabeldaten werden sonst erst beim ersten Gebrauch gespeichert.');
  const btn = h('button.btn.sm', {
    onclick: () => {
      const sw = navigator.serviceWorker?.controller;
      if (!sw) { toast('Service Worker noch nicht aktiv — Seite einmal neu laden.', { bad: true }); return; }
      const m = data.meta();
      const urls = [];
      for (let i = 0; i < m.chunkCount; i++) { urls.push(`data/strokes/${i}.json`, `data/vocab/${i}.json`); }
      navigator.serviceWorker.addEventListener('message', (ev) => {
        if (ev.data?.type !== 'precache-progress') return;
        status.textContent = ev.data.done >= ev.data.total
          ? `Alle ${ev.data.total} Datendateien offline verfügbar.`
          : `Lade ${ev.data.done} / ${ev.data.total} …`;
      });
      sw.postMessage({ type: 'precache-data', urls });
      status.textContent = 'Start …';
    },
  }, 'Alle Daten offline verfügbar machen');
  return card('Offline', [
    h('div.small.muted', 'Die App läuft als PWA und lässt sich auf dem iPad über „Zum Home-Bildschirm" installieren.'),
    h('div.row.mt', btn),
    status,
  ]);
}

// ---------------------------------------------------------------------------

export async function aboutScreen() {
  const meta = data.meta();
  const wrap = h('div.wrap');
  wrap.append(h('div.card',
    h('h2', 'Kanji Trainer'),
    h('div.small.muted', 'Rein statische, lokal laufende Lern-App. Keine Laufzeit-Netzwerkzugriffe, alle Daten im Projektordner.'),
    h('dl.kv.mt',
      h('dt', 'Zeichen'), h('dd', String(meta.counts.characters)),
      h('dt', 'mit Strichdaten'), h('dd', String(meta.counts.withStrokes)),
      h('dt', 'mit Beispielvokabeln'), h('dd', String(meta.counts.withVocab)),
      h('dt', 'Daten erzeugt'), h('dd', fmtDateTime(new Date(meta.generated).getTime())))));

  const gaps = meta.gaps;
  wrap.append(h('div.card',
    h('h2', 'Bekannte Lücken in den Quelldaten'),
    h('div.small.muted', 'Fehlende Daten werden in der App als Lücke markiert und nicht geraten.'),
    h('ul', { style: { margin: '8px 0 0 18px' } },
      h('li', `${gaps.noStrokes.length} Zeichen ohne KanjiVG-Strichdaten${gaps.noStrokes.length ? ': ' + gaps.noStrokes.join(' ') : ''}`),
      h('li', `${gaps.noDic.length} Zeichen ohne KANJIDIC2-Eintrag`),
      h('li', `${gaps.noVocab} Zeichen ohne häufige JMdict-Vokabel`),
      h('li', 'KANJIDIC2 enthält keine deutschen Kanji-Bedeutungen — angezeigt werden die englischen Originalglossen.'))));

  const src = h('div.card', h('h2', 'Datenquellen und Lizenzen'));
  for (const s of meta.sources) {
    src.append(h('div', { style: { padding: '8px 0', borderBottom: '1px solid var(--line)' } },
      h('b', s.name),
      h('div.small.muted', `${s.by} — ${s.license}`),
      h('div.small', h('a', { href: s.url, target: '_blank', rel: 'noreferrer' }, s.url))));
  }
  src.append(h('div.small.muted.mt',
    'KANJIDIC2, JMdict und KanjiVG stehen unter CC BY-SA; abgeleitete Daten in /data unterliegen denselben Bedingungen. ' +
    'hanzi-writer-data-jp wurde geprüft und nicht verwendet: das veröffentlichte npm-Paket enthält keine Zeichendaten und ' +
    'verweist auf ein CDN, was der Offline-Anforderung widerspricht. Strichdaten und Strichprüfung basieren daher direkt auf KanjiVG.'));
  wrap.append(src);
  return wrap;
}
