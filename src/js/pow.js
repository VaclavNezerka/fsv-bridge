// Neviditelná ochrana proti robotům: prohlížeč vyřeší výpočetní úlohu (proof-of-work),
// kterou server podepsal. Člověk nic nevyplňuje, robota rozesílající spam to zdrží a prodraží.
import { api } from './api.js';

const MAX_AGE_MS = 25 * 60 * 1000; // výzva platí 30 min, obnovíme ji s rezervou

let state = null; // { promise, fetchedAt }

function solveInWorker(ch) {
  return new Promise((resolve, reject) => {
    let w;
    try {
      w = new Worker(new URL('./pow-worker.js', import.meta.url));
    } catch (e) {
      reject(e);
      return;
    }
    w.onmessage = (e) => { w.terminate(); e.data.number >= 0 ? resolve(e.data.number) : reject(new Error('pow_unsolved')); };
    w.onerror = (e) => { w.terminate(); reject(e); };
    w.postMessage({ salt: ch.salt, challenge: ch.challenge, max: ch.maxnumber });
  });
}

async function solveInline(ch) {
  const enc = new TextEncoder();
  for (let n = 0; n <= ch.maxnumber; n++) {
    const buf = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(ch.salt + n)));
    const hex = Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
    if (hex === ch.challenge) return n;
  }
  throw new Error('pow_unsolved');
}

async function run() {
  const ch = await api.challenge();
  const receivedAt = Date.now();
  let number;
  try {
    number = await solveInWorker(ch);
  } catch {
    number = await solveInline(ch);
  }
  // Server přijme řešení nejdříve 3 s po vydání výzvy (roboti odesílají okamžitě) – počkáme, pokud je třeba.
  const wait = receivedAt + 3500 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  return { algorithm: ch.algorithm, challenge: ch.challenge, salt: ch.salt, signature: ch.signature, number: String(number) };
}

/** Spustí výpočet na pozadí (např. při otevření formuláře). */
export function prepare() {
  if (!state || Date.now() - state.fetchedAt > MAX_AGE_MS || state.failed) {
    const promise = run();
    state = { promise, fetchedAt: Date.now(), failed: false };
    promise.catch(() => { if (state && state.promise === promise) state.failed = true; });
  }
  return state.promise;
}

/** Vrátí vyřešenou výzvu (případně počká na dokončení výpočtu). */
export function solution() {
  return prepare();
}

/** Výzvu lze použít jen jednou – po odeslání ji zahodíme. */
export function reset() {
  state = null;
}
