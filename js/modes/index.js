// Mode registry — the session screen resolves a mode id through this map.

import * as recognitionMC from './recognitionMC.js';
import * as reverseMC from './reverseMC.js';
import * as reading from './reading.js';
import * as confusion from './confusion.js';
import { guided, blind } from './writing.js';

export const MODES = {
  recognitionMC,
  reverseMC,
  reading,
  confusion,
  writingGuided: guided,
  writingBlind: blind,
};

export const MODE_LABEL = {
  recognitionMC: 'Bedeutung erkennen',
  reverseMC: 'Zeichen finden',
  reading: 'Lesung tippen',
  confusion: 'Verwechslungs-Drill',
  writingGuided: 'Schreiben (geführt)',
  writingBlind: 'Schreiben (blind)',
};

export const getMode = (id) => MODES[id] || MODES.recognitionMC;
