// A session handed from one screen to the next (custom review, warm-up, …).

let pending = null;
export const setPendingSession = (s) => { pending = s; };
export const takePendingSession = () => { const s = pending; pending = null; return s; };
export const peekPendingSession = () => pending;
