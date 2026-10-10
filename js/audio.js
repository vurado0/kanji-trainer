// Optional pronunciation via the Web Speech API. Silent no-op when unavailable.

import { settings } from './store.js';

let voice = null;
let looked = false;

function jaVoice() {
  if (looked) return voice;
  looked = true;
  try {
    const vs = speechSynthesis.getVoices() || [];
    voice = vs.find((v) => v.lang === 'ja-JP') || vs.find((v) => v.lang?.startsWith('ja')) || null;
  } catch { voice = null; }
  return voice;
}

if (typeof speechSynthesis !== 'undefined') {
  speechSynthesis.addEventListener?.('voiceschanged', () => { looked = false; });
}

export function speak(text, { force = false } = {}) {
  if (!text) return false;
  if (!force && !settings.audio) return false;
  if (typeof speechSynthesis === 'undefined') return false;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(String(text));
    u.lang = 'ja-JP';
    const v = jaVoice();
    if (v) u.voice = v;
    u.rate = 0.92;
    speechSynthesis.speak(u);
    return true;
  } catch {
    return false;
  }
}

export const audioAvailable = () => typeof speechSynthesis !== 'undefined';
