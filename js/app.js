/**
 * Boot and routing.
 *
 * Startup order matters: settings (day cutoff) -> static data -> stored
 * progress -> first-run seed import -> queue -> confusion pairs.
 */

import { $, h, today } from './util.js';
import { loadSettings, loadRecords, kvGet, kvSet, snapshot, settings } from './store.js';
import * as data from './data.js';
import { openDB } from './db.js';
import { autoImportOnFirstRun, fetchSeed } from './seed.js';
import * as queue from './queue.js';
import { initConfusion } from './confusion.js';
import { route, startRouter, navigate, render } from './router.js';
import { dueCounts, buildDueSession, buildWarmup, buildConfusionSession } from './session.js';
import { takePendingSession, setPendingSession } from './app-state.js';
import { toast, modal, emptyState } from './ui.js';

import { dashboardScreen, notebookScreen } from './screens/dashboard.js';
import { gridScreen } from './screens/grid.js';
import { detailScreen } from './screens/detail.js';
import { queueScreen } from './screens/queue.js';
import { customScreen } from './screens/custom.js';
import { statsScreen } from './screens/stats.js';
import { settingsScreen, aboutScreen } from './screens/settings.js';
import { studyScreen } from './screens/study.js';
import { sessionScreen } from './screens/session.js';

async function boot() {
  const bootEl = $('#boot');
  const setStatus = (t) => { const e = bootEl.querySelector('.boot-text'); if (e) e.textContent = t; };

  try {
    loadSettings();
    setStatus('Lade Kanji-Daten …');
    await Promise.all([data.loadData(), openDB()]);

    setStatus('Lade Fortschritt …');
    await loadRecords();

    setStatus('Prüfe Erstimport …');
    const first = await autoImportOnFirstRun();

    const seed = first?.seed ?? (await fetchSeed().catch(() => null));
    if (seed) await queue.initQueue(seed);
    else await queue.initQueue({ learned: {}, queue: { in_progress: '', n3_rest: '' } });

    await initConfusion();
    await dailyBackup();

    registerRoutes();
    bootEl.remove();
    $('#topbar').hidden = false;
    $('#view').hidden = false;
    $('#tabbar').hidden = false;
    startRouter();
    updateDueBadge();
    setInterval(updateDueBadge, 60000);
    window.addEventListener('hashchange', updateDueBadge);

    // Only report an import when the seed actually contained learned characters.
    if (first && Object.values(first.seed.learned ?? {}).join('')) showFirstRunReport(first);
    registerServiceWorker();
  } catch (err) {
    console.error(err);
    bootEl.classList.add('err');
    setStatus(`Start fehlgeschlagen: ${err.message}\n\nWird die App über file:// geöffnet? Dann bitte einen lokalen Server nutzen:\npython3 -m http.server 8000`);
  }
}

/** One automatic rolling backup per day. */
async function dailyBackup() {
  const last = await kvGet('lastBackupDay', null);
  const d = today();
  if (last === d) return;
  await snapshot('automatisch');
  await kvSet('lastBackupDay', d);
}

function updateDueBadge() {
  const c = dueCounts();
  $('#tb-due').textContent = c.total ? `${c.total} fällig` : '';
}

function showFirstRunReport({ summary }) {
  const rows = summary.tiers.map((t) =>
    h('tr', h('td', LABELS[t.tier] || t.tier), h('td.num', String(t.known)), h('td.num', t.unknown ? String(t.unknown) : '—')));
  modal({
    title: 'Alter Lernstand importiert',
    body: h('div',
      h('div.small.muted', 'Diese Zeichen erscheinen nicht mehr unter „Neu lernen".'),
      h('table.data.mt', h('tr', h('th', 'Stufe'), h('th.num', 'übernommen'), h('th.num', 'unbekannt')), rows),
      h('div.small.muted.mt',
        `Fälligkeiten über ${summary.dueSpread.lastDay - summary.dueSpread.firstDay + 1} Tage verteilt, ` +
        `höchstens ${summary.dueSpread.max} Karten an einem Tag.`),
      summary.unknown.length
        ? h('div.pill.gap.mt', `${summary.unknown.length} Zeichen nicht in den Datenquellen: ${summary.unknown.join(' ')}`)
        : null),
    actions: [{ label: 'Los geht’s', primary: true }],
  });
}

const LABELS = {
  mastery_3: 'Sicher (grün)',
  mastery_2: 'Gut (hellgrün)',
  mastery_1: 'Wackelig (gelbgrün)',
  in_progress: 'In Arbeit (rot)',
};

// ---------------------------------------------------------------------------

function registerRoutes() {
  route('/', dashboardScreen, { title: 'Heute' });
  route('/grid', gridScreen, { title: 'Alle Kanji' });
  route('/kanji/:char', detailScreen, { title: (p) => p.char, back: true });
  route('/queue', queueScreen, { title: 'Warteschlange' });
  route('/custom', customScreen, { title: 'Custom Review', back: true });
  route('/notebook', notebookScreen, { title: 'Fehlerheft', back: true });
  route('/stats', statsScreen, { title: 'Statistik' });
  route('/settings', settingsScreen, { title: 'Einstellungen & Daten' });
  route('/about', aboutScreen, { title: 'Über', back: true });
  route('/study', studyScreen, { title: 'Neu lernen', back: true, fullscreen: true });
  route('/session/:kind', sessionRoute, { title: 'Session', back: true, fullscreen: true });
}

async function sessionRoute({ params }) {
  const kind = params.kind;
  let session = takePendingSession();

  if (!session) {
    if (kind === 'due') session = await buildDueSession();
    else if (kind === 'warmup') session = await buildWarmup(10);
    else if (kind === 'confusion') session = await buildConfusionSession(20);
    else return emptyState('Diese Session ist abgelaufen.', 'Zur Übersicht', () => navigate('/'));
  }

  if (!session.cards.length) {
    const msg = kind === 'due' ? 'Nichts fällig — alles erledigt.'
      : kind === 'warmup' ? 'Noch keine geübten Zeichen für ein Warm-up.'
      : kind === 'confusion' ? 'Keine Verwechslungspaare vorhanden.'
      : 'Keine Karten in dieser Auswahl.';
    return emptyState(msg, 'Zur Übersicht', () => navigate('/'));
  }
  return sessionScreen(session, { onExit: () => { updateDueBadge(); navigate('/'); } });
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol === 'file:') return;
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW:', e.message));
}

boot();
